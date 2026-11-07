import {
  contextOrgName,
  messageTemplates,
  notifyTarget,
  pageClosedNotice,
  telegramChat,
  withOrgContext,
} from '@buhuchet/db';
import {
  fillTemplate,
  formatText,
  PAGE_DAY_MAX_FAILURES,
  TELEGRAM_TEMPLATE_DEFAULTS,
  withOrganization,
} from '@buhuchet/domain';
import type { ApiDeps } from '../../deps';
import { serverTexts } from '../l10n/texts';
import { flushEvents, queueEvents } from '../telegram/outbox';

/** Куда ведёт ссылка в сообщении: модуль «Контрагенты». */
const CONTRACTORS_PATH = '/app/cps/all';

/**
 * Страница контрагента закрылась после 5 неверных кодов за сутки (решение заказчика 07.11.2026, Р-5 А):
 * ответственный сотрудник получает сообщение в Telegram — нажать «Сменить код» и отправить контрагенту
 * новый. Нет ответственного, он заблокирован или без Telegram — владелец организации. Это сообщение о
 * защите: приходит и при выключенных «Напоминаниях в Telegram» и переключателях профиля, как сообщения
 * о смене пароля. Строка очереди пишется в контексте организации страницы и отправляется сразу, с
 * повторами очереди; ошибка не мешает ответу странице.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#О-21
export async function notifyPageClosed(
  deps: ApiDeps,
  orgId: string,
  contractorId: string,
): Promise<void> {
  if (!deps.telegram) return;
  try {
    const ids = await withOrgContext(deps.db, { orgId, userId: null }, async (tx) => {
      const notice = await pageClosedNotice(tx, contractorId);
      if (!notice) return [];
      for (const employeeId of notice.employeeIds) {
        const target = await notifyTarget(tx, employeeId);
        if (!target?.chatId) continue;
        const chat = await telegramChat(tx, target.userId);
        if (!chat) continue;
        const [templates, t, orgName] = await Promise.all([
          messageTemplates(tx),
          serverTexts(deps),
          contextOrgName(tx),
        ]);
        const body = fillTemplate(
          templates.tgPageClosed ?? TELEGRAM_TEMPLATE_DEFAULTS.tgPageClosed,
          {
            контрагент: notice.contractor,
            неверных: PAGE_DAY_MAX_FAILURES,
          },
        );
        const link = formatText(t('telegram.open'), {
          link: new URL(CONTRACTORS_PATH, deps.config.APP_BASE_URL).href,
        });
        return queueEvents(
          tx,
          [
            {
              userId: target.userId,
              chatId: chat.chatId,
              kind: 'page_closed',
              text: withOrganization(`${body}\n\n${link}`, orgName, chat.shared),
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
      'Telegram: сообщение о закрытой странице контрагента не записано',
    );
  }
}
