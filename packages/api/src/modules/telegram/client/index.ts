import { hashSessionToken } from '@buhuchet/adapters/tokens';
import {
  contextOrgName,
  contractorTelegramChats,
  leaveContractorTelegram,
  messageTemplates,
  notifyTarget,
  pageClosedNotice,
  peekContractorTelegramLink,
  startContractorTelegram,
  telegramChat,
  withOrgContext,
  type Db,
  type Tx,
} from '@buhuchet/db';
import {
  botPlainText,
  botTemplate,
  CP_TG_NO_ACTION,
  CP_TG_OK_ACTION,
  cpTgLeaveCommand,
  cpTgName,
  fillTemplate,
  formatText,
  withOrganization,
  type BotMessage,
  type TelegramTemplateKey,
} from '@buhuchet/domain';
import type { ApiDeps } from '../../../deps';
import { serverTexts } from '../../l10n/texts';
import { botText, sendNow } from '../bot';
import { flushEvents, queueEvents } from '../outbox';

/*
 * Бот для клиента — Telegram контрагента (доработки 13.11.2026, задача К3; прототип v92
 * modules/cp-telegram.js). Клиент — не сотрудник: входа, прав и области у него нет. Поэтому каждый
 * обработчик сам проверяет главное: чат действует только по одноразовой ссылке со страницы контрагента
 * (её получает лишь браузер с запомненным кодом страницы) и только в пределах контрагента этой ссылки;
 * отключается чат только сам. Данных других контрагентов, задач и сотрудников бот клиенту не
 * показывает. Запрос подтверждает сотрудник организации (карточка контрагента).
 */

/** Куда ведёт ссылка в сообщении сотруднику: модуль «Контрагенты». */
const CONTRACTORS_PATH = '/app/cps/all';

/** Ответ клиенту: сразу, мимо очереди; в журнал сервера — без текста. */
async function reply(
  deps: ApiDeps,
  chatId: number,
  key: TelegramTemplateKey,
  values: Readonly<Record<string, string | number>> = {},
  /** Внутри открытой транзакции — она сама (docs/decisions.md п. О-46). */
  db: Db | Tx = deps.db,
): Promise<void> {
  await sendNow(deps, chatId, await botText(deps, key, values, db), 'cp_telegram');
}

/**
 * Сообщение клиенту о решении сотрудника или об отключении (прототип pgTgToClient). Ошибка Telegram
 * действие не отменяет: решение уже записано.
 */
export async function notifyContractorTelegramClient(
  deps: ApiDeps,
  chatId: number,
  key: 'tgCpOn' | 'tgCpNo' | 'tgCpOff',
  contractor: string,
  /** Решение из кнопки бота пишется в транзакции нажатия — шаблон читается ею же. */
  db: Db | Tx = deps.db,
): Promise<void> {
  await reply(deps, chatId, key, { контрагент: contractor }, db);
}

/**
 * Запрос на подключение — ответственному сотруднику, без него (или он заблокирован, без Telegram) —
 * первому владельцу с Telegram (прототип pgTgStaff). Строка очереди пишется в контексте организации и
 * отправляется сразу, с повторами очереди; ошибка не мешает ответу клиенту.
 */
async function notifyStaff(
  deps: ApiDeps,
  orgId: string,
  contractorId: string,
  request: { linkId: string; name: string },
): Promise<void> {
  try {
    // Словарь читается до транзакции: внутри неё он занял бы второе соединение пула.
    const t = await serverTexts(deps);
    const ids = await withOrgContext(deps.db, { orgId, userId: null }, async (tx) => {
      const notice = await pageClosedNotice(tx, contractorId);
      if (!notice) return [];
      for (const employeeId of notice.employeeIds) {
        const target = await notifyTarget(tx, employeeId);
        if (!target?.chatId) continue;
        const chat = await telegramChat(tx, target.userId);
        if (!chat) continue;
        const [templates, orgName] = await Promise.all([messageTemplates(tx), contextOrgName(tx)]);
        const body = fillTemplate(botTemplate('tgCpReq', templates.tgCpReq), {
          контрагент: notice.contractor,
          телеграм: request.name,
        });
        const link = formatText(t('telegram.open'), {
          link: new URL(CONTRACTORS_PATH, deps.config.APP_BASE_URL).href,
        });
        // Кнопки «Подтвердить» и «Отклонить» (задача К5; прототип pgTgStaffMsg): решение — тем же
        // правилом, что в карточке (право, область, версия записи) — `cpTelegramActions`.
        const message: BotMessage = {
          heading: t('cppage.tg.title'),
          text: withOrganization(`${body}\n\n${link}`, orgName, chat.shared),
          buttons: [
            [
              {
                text: botTemplate('tgBtnCpOk', templates.tgBtnCpOk),
                action: CP_TG_OK_ACTION,
                arg: request.linkId,
              },
              {
                text: botTemplate('tgBtnCpNo', templates.tgBtnCpNo),
                action: CP_TG_NO_ACTION,
                arg: request.linkId,
              },
            ],
          ],
        };
        return queueEvents(
          tx,
          [
            {
              userId: target.userId,
              chatId: chat.chatId,
              kind: 'cp_tg_request',
              text: botPlainText(message),
              message,
            },
          ],
          deps.clock.now(),
        );
      }
      return [];
    });
    await flushEvents(deps, orgId, ids);
  } catch (err) {
    deps.logger.warn(
      { err, orgId },
      'Telegram: запрос на подключение Telegram контрагента не записан',
    );
  }
}

/**
 * Клиент открыл ссылку со страницы контрагента и нажал «Старт» («/start cp_<токен>»): ссылка
 * одноразовая, появляется запрос «ждёт подтверждения», сотруднику уходит сообщение. Запрос и история
 * контрагента — одной транзакцией в контексте организации ссылки.
 */
export async function clientStart(
  deps: ApiDeps,
  chat: { chatId: number; username: string | null; firstName: string | null },
  token: string | null,
): Promise<void> {
  if (!token) return reply(deps, chat.chatId, 'tgCpLinkBad');
  const tokenHash = hashSessionToken(token);
  const target = await peekContractorTelegramLink(deps.db, tokenHash, chat.chatId);
  if (!target) return reply(deps, chat.chatId, 'tgCpLinkBad');
  // Telegram повторил то же сообщение после запроса — второй раз не отвечаем.
  if (target.state === 'repeat') return;
  const name = cpTgName(chat);
  const res = await withOrgContext(deps.db, { orgId: target.orgId, userId: null }, (tx) =>
    startContractorTelegram(tx, { tokenHash, chatId: chat.chatId, name }),
  );
  if (res.outcome === 'invalid') return reply(deps, chat.chatId, 'tgCpLinkBad');
  const values = { контрагент: res.contractor };
  if (res.outcome === 'limit') return reply(deps, chat.chatId, 'tgCpLimit', values);
  if (res.outcome === 'already') return reply(deps, chat.chatId, 'tgCpAlready', values);
  await reply(deps, chat.chatId, 'tgCpAsk', values);
  if (res.outcome === 'asked') {
    await notifyStaff(deps, target.orgId, res.contractorId, { linkId: res.linkId, name });
  }
}

/**
 * Подсказка для чата клиента (договорённость с потоком Т, задача Т5): бот отвечает ею вместо «привяжите
 * Telegram» на текст или команду сотрудника из чата, подключённого к контрагенту. null — чат ни к кому
 * не подключён: отвечает обычная подсказка бота. Тексты читаются вне транзакций (docs/decisions.md
 * п. О-46).
 */
export async function clientChatHint(deps: ApiDeps, chatId: number): Promise<string | null> {
  const links = await contractorTelegramChats(deps.db, chatId);
  if (links.length === 0) return null;
  const t = await serverTexts(deps);
  return formatText(t('cppage.tg.client_hint'), {
    contractors: links.map((l) => l.contractor).join(', '),
  });
}

/**
 * Сообщение клиента без ссылки. «Отключить» — отключает этот чат от контрагента; подключён к
 * нескольким — бот присылает их список с номерами и ждёт «Отключить N». false — это не команда клиента
 * или чат ни к кому не подключён: отвечает обычная подсказка бота.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#К-2
export async function clientText(deps: ApiDeps, chatId: number, text: string): Promise<boolean> {
  const command = cpTgLeaveCommand(text);
  if (!command) return false;
  const links = await contractorTelegramChats(deps.db, chatId);
  if (links.length === 0) return false;
  // Подключён к одному контрагенту — номер не нужен и не мешает.
  const link = links.length === 1 ? links[0] : links[(command.index ?? 0) - 1];
  if (!link) {
    await reply(deps, chatId, 'tgCpOffWhich', {
      список: links.map((l, i) => `${i + 1}. ${l.contractor}`).join('; '),
    });
    return true;
  }
  const left = await withOrgContext(deps.db, { orgId: link.orgId, userId: null }, (tx) =>
    leaveContractorTelegram(tx, { linkId: link.linkId, chatId }),
  );
  if (left) await reply(deps, chatId, 'tgCpOff', { контрагент: link.contractor });
  return true;
}
