import { orgSubscriptionClosed, withOrgContext } from '@buhuchet/db';
import { bishkekDate } from '@buhuchet/domain';
import type { ApiDeps } from './deps';
import { serverTexts } from './modules/l10n/texts';

/*
 * Доступ организации, закрытый по подписке (доработки 20.11.2026, блок 4, пункты 4–5): со следующего
 * дня после «Оплачено до» без оплаты, а у организации без подписки — сразу; чек, открывший доступ до
 * проверки, держит его открытым. Сотрудник не входит, его открытый сеанс закрывается при первом
 * запросе, бот сотрудникам сам не пишет, а кнопки и команды отвечают «Доступ организации закрыт».
 * Владелец входит, и ему открыта только «Моя организация» → «Подписка» — иначе организации не
 * заплатить. Закрыт ли доступ — одна функция базы `app.org_usage` (этап 0), «сегодня» — по Бишкеку от
 * часов приложения. Демо-организация не закрывается.
 */

/** Сегодня по Бишкеку — день, на который проверяется подписка. */
export const subscriptionToday = (deps: Pick<ApiDeps, 'clock'>) => bishkekDate(deps.clock.now());

/** Закрыт ли доступ организации сейчас: своя короткая транзакция организации без пользователя. */
export function orgClosedNow(
  deps: Pick<ApiDeps, 'db' | 'clock'>,
  orgId: string,
): Promise<boolean> {
  return withOrgContext(deps.db, { orgId, userId: null }, (tx) =>
    orgSubscriptionClosed(tx, subscriptionToday(deps)),
  );
}

/**
 * Что открыто владельцу при закрытом доступе (прототип subLockMods, orgTabs): «кто я», смена
 * пароля, привязка Telegram (в него приходят напоминания об оплате) и всё под `/api/org/subscription` —
 * экран «Подписка» и окно оплаты с чеком. Выход и словарь открыты и без входа.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#О-89
const OWNER_OPEN_PATHS = new Set([
  '/api/auth/me',
  '/api/auth/password',
  '/api/telegram/link',
  '/api/telegram/plain',
]);
const OWNER_OPEN_PREFIX = '/api/org/subscription';

export const ownerOpenWhenClosed = (path: string) =>
  OWNER_OPEN_PATHS.has(path) ||
  path === OWNER_OPEN_PREFIX ||
  path.startsWith(`${OWNER_OPEN_PREFIX}/`);

/** Ответ бота сотруднику, пока доступ организации закрыт: кнопки, просьбы, команды (блок 4, пункт 4). */
export async function closedBotText(deps: ApiDeps): Promise<string> {
  return (await serverTexts(deps))('subs.tg.closed');
}
