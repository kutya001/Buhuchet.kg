import {
  botChatUsers,
  contractorTelegramChats,
  logPageCodeSent,
  messageTemplates,
  pageCodeTarget,
  takeRateLimit,
  withOrgContext,
  type PageCodeTarget,
  type RateLimit,
} from '@buhuchet/db';
import {
  bishkekDate,
  botTemplate,
  formatText,
  isPageCodeCommand,
  PAGE_CODE_TG_MAX,
  PAGE_CODE_TG_WINDOW_HOURS,
  pageCodeText,
  pageLink,
  type BotMessage,
  type PageCodeVia,
  type PageForgotOutcome,
} from '@buhuchet/domain';
import type { ApiDeps } from '../../../deps';
import { orgAccessClosed } from '../../contractor-page/org-closed';
import { serverTexts } from '../../l10n/texts';
import { botText, sendNow } from '../bot';
import { botSendOptions } from '../outbox';

/*
 * Код страницы контрагента в Telegram (доработки 14.11.2026, блок 6, этап 3, поток К; прототип v116
 * modules/cp-paid.js `pgCodeSend`, `pubForgot`, `pgCodeCmd`): «Забыли код? Прислать в Telegram» на
 * странице и команда бота «Код от страницы». Код уходит только в Telegram, подключённый к этому
 * контрагенту (подключение подтверждено), пока раздел «Telegram» страницы действует; не больше 3 раз
 * за сутки на страницу — по ссылке и командой вместе; закрытая после неверных кодов страница код не
 * присылает. Сообщение с кодом — мимо очереди и журнала отправок (как коды входа); каждая отправка — в
 * историю контрагента без самого кода.
 */

/** Отправки кода за сутки на страницу — по ссылке и командой вместе (прототип `PG_CODE_TG`). */
export const PAGE_CODE_TG_RATE_LIMIT: RateLimit = {
  kind: 'cp_code_tg',
  max: PAGE_CODE_TG_MAX,
  windowSeconds: PAGE_CODE_TG_WINDOW_HOURS * 3600,
};

/** Команда из одного сообщения клиента разбирается один раз: Telegram повторяет доставку. */
export const CP_TG_CODE_ONCE: RateLimit = {
  kind: 'cp_tg_code_once',
  max: 1,
  windowSeconds: 43_200,
};

/** Команд «Код от страницы» с одного чата за час — ответы на них уходят и при пределе страницы. */
export const CP_TG_CODE_CMD_RATE_LIMIT: RateLimit = {
  kind: 'cp_tg_code_cmd',
  max: 10,
  windowSeconds: 3600,
};

/** Бот подключён: раздел «Telegram» страницы есть, только когда у бота есть имя (задача К3). */
const botOn = (deps: ApiDeps) => !!deps.telegram && !!deps.config.TELEGRAM_BOT_USERNAME;

/**
 * Сообщение с кодом (прототип `pgCodeMsg`): код «482 915» моноширинным и кнопка «Скопировать код» —
 * она копирует 6 цифр без пробела. Текст — шаблон `tgCpCode` (код в нём обязателен).
 */
async function codeMessage(
  deps: ApiDeps,
  target: PageCodeTarget,
): Promise<{ text: string; message: BotMessage }> {
  const code = pageCodeText(target.code);
  const text = await botText(deps, 'tgCpCode', {
    контрагент: target.contractor,
    код: code,
    ссылка: pageLink(deps.config.APP_BASE_URL, target.slug, target.inn),
  });
  if (!text.includes(code)) return { text, message: { text } };
  const copy = await botText(deps, 'tgBtnCopyCode');
  return { text, message: { text, code, buttons: [[{ text: copy, copy: target.code }]] } };
}

/** `org_closed` — доступ организации закрыт по подписке: код не уходит (п. К-24). */
export type PageCodeSendOutcome = PageForgotOutcome | 'unavailable' | 'org_closed';

/**
 * Прислать код страницы контрагента в его подключённые Telegram (прототип `pgCodeSend`): `chatId` —
 * только в этот чат (команда бота), иначе во все подключённые. Чтение страницы и запись в историю —
 * транзакциями организации без пользователя, отправка — между ними (п. О-48). Страница выключена,
 * контрагент в архиве, организация заблокирована или функция выключена — `unavailable`; доступ
 * организации закрыт по подписке — `org_closed`, код не уходит (прототип v152 `pubForgot`), но только
 * подключённому чату с показанным разделом «Telegram»: остальным — `none`, как при открытом доступе.
 */
export async function sendPageCode(
  deps: ApiDeps,
  o: { orgId: string; contractorId: string; via: PageCodeVia; chatId?: number },
): Promise<{ outcome: PageCodeSendOutcome; contractor: string | null }> {
  const ctx = { orgId: o.orgId, userId: null };
  const today = bishkekDate(deps.clock.now());
  const found = await withOrgContext(deps.db, ctx, async (tx) => ({
    target: await pageCodeTarget(tx, o.contractorId),
    closed: await orgAccessClosed(tx, today),
  }));
  const { target } = found;
  if (!target) return { outcome: 'unavailable', contractor: null };
  const { contractor } = target;
  const chats = target.chats.filter((x) => o.chatId === undefined || x.chatId === o.chatId);
  if (!botOn(deps) || !target.tgShown || !chats.length) return { outcome: 'none', contractor };
  // Закрытие — после подключения: чат, которому раздел «Telegram» не показан, получает тот же ответ,
  // что и при открытом доступе, и не узнаёт, что подписка не оплачена (п. К-24).
  if (found.closed) return { outcome: 'org_closed', contractor };
  if (target.closed) return { outcome: 'closed', contractor };
  const slot = await takeRateLimit(deps.db, PAGE_CODE_TG_RATE_LIMIT, o.contractorId);
  if (!slot.ok) return { outcome: 'limit', contractor };
  const { text, message } = await codeMessage(deps, target);
  const sent: string[] = [];
  for (const chat of chats) {
    // Мимо журнала отправок: код не хранится нигде, кроме страницы.
    const ok = await sendNow(
      deps,
      chat.chatId,
      text,
      'cp_page_code',
      botSendOptions(message, { plain: true }),
    );
    if (ok) sent.push(chat.name);
  }
  // Telegram не принял ни одного сообщения — кода у клиента нет: «спросите у бухгалтера».
  if (!sent.length) return { outcome: 'none', contractor };
  await withOrgContext(deps.db, ctx, (tx) =>
    logPageCodeSent(tx, o.contractorId, { chats: sent, via: o.via }),
  );
  return { outcome: 'sent', contractor };
}

/**
 * Команда клиента «Код от страницы» («/code» или кнопка меню; прототип `pgCodeCmd`): по сообщению на
 * каждую страницу, к которой подключён этот чат, — код, «уже присылали 3 раза» или «страница закрыта»;
 * чат ни к одной действующей странице не подключён — «спросите код у бухгалтера». false — это не эта
 * команда (или она прислана ответом на сообщение): разбирает дальше вебхук.
 */
export async function clientCodeCommand(
  deps: ApiDeps,
  msg: { chatId: number; fromId: number; messageId: number | null; reply: boolean; text: string },
): Promise<boolean> {
  if (msg.reply || msg.fromId !== msg.chatId) return false;
  const templates = await messageTemplates(deps.db);
  if (!isPageCodeCommand(msg.text, botTemplate('tgCmdCpCode', templates.tgCmdCpCode))) {
    return false;
  }
  const links = await contractorTelegramChats(deps.db, msg.chatId);
  // ОТКЛОНЕНИЕ: docs/deviations.md#О-79
  // Чат привязан к учётной записи сотрудника и ни к одной странице не подключён — это не клиент: его
  // текст разбирает бот сотрудника («спросите код у бухгалтера» ему ни к чему).
  if (!links.length && (await botChatUsers(deps.db, msg.chatId)).length > 0) return false;
  if (msg.messageId !== null) {
    const once = await takeRateLimit(deps.db, CP_TG_CODE_ONCE, `${msg.chatId}:${msg.messageId}`);
    if (!once.ok) return true;
  }
  const slot = await takeRateLimit(deps.db, CP_TG_CODE_CMD_RATE_LIMIT, String(msg.chatId));
  if (!slot.ok) return true;
  let answered = false;
  for (const link of links) {
    const r = await sendPageCode(deps, {
      orgId: link.orgId,
      contractorId: link.contractorId,
      via: 'cmd',
      chatId: msg.chatId,
    });
    if (r.outcome === 'sent') answered = true;
    else if (r.outcome === 'org_closed') {
      // Доступ организации закрыт по подписке: кода нет, ответ — как у кнопок старых сообщений (п. К-24).
      const t = await serverTexts(deps);
      const text = formatText(t('cppage.tg.org_closed_code'), {
        contractor: r.contractor ?? link.contractor,
      });
      await sendNow(deps, msg.chatId, text, 'cp_telegram');
      answered = true;
    } else if (r.outcome === 'limit' || r.outcome === 'closed') {
      const key = r.outcome === 'limit' ? 'tgCpCodeLimit' : 'tgCpCodeClosed';
      const text = await botText(deps, key, {
        контрагент: r.contractor ?? link.contractor,
        лимит: PAGE_CODE_TG_MAX,
      });
      await sendNow(deps, msg.chatId, text, 'cp_telegram');
      answered = true;
    }
  }
  if (!answered) {
    await sendNow(deps, msg.chatId, await botText(deps, 'tgCpCodeNone'), 'cp_telegram');
  }
  return true;
}
