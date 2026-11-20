import {
  contractorPageState,
  orgUsage,
  withOrgContext,
  type ContractorPageState,
  type Db,
  type Tx,
} from '@buhuchet/db';
import { bishkekDate, type IsoDate } from '@buhuchet/domain';
import type { ApiDeps } from '../../deps';

/*
 * Доступ организации закрыт по подписке (доработки 20.11.2026, блок 4, пункт 4; этап 1, П9; прототип
 * v152 `pubOrgClosed`, `pubForgot`): страница контрагента по ссылке после верного кода — «Страница
 * временно недоступна» без данных, «Забыли код?» код не присылает и отвечает как без Telegram, бот сам
 * клиенту не пишет, а кнопки и сообщения клиента получают ответ «Доступ организации закрыт». Данные не
 * удаляются; после оплаты всё работает снова. Закрыт ли доступ — одна функция базы `app.org_usage`
 * (этап 0), «сегодня» — по Бишкеку от часов приложения.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#К-24

/** Закрыт ли доступ организации контекста `tx` (`withOrgContext`) на день `today`. */
export async function orgAccessClosed(tx: Tx, today: IsoDate): Promise<boolean> {
  const usage = await orgUsage(tx, today, { bytes: false });
  if (!usage?.closed) return false;
  // Организация без подписки закрыта так же (блок 4, пункт 5), но вход для неё закрывает этап 1, П1 треда
  // сборки вместе с бесплатным периодом у тестовых организаций; до сборки этапа 1 «Нет подписки» здесь не
  // закрывает — строку убирает сборка.
  return usage.status !== 'none';
}

/** То же вне транзакции: своя короткая транзакция организации без пользователя. */
export async function orgClosedNow(
  deps: { db: Db; clock: ApiDeps['clock'] },
  orgId: string,
): Promise<boolean> {
  return withOrgContext(deps.db, { orgId, userId: null }, (tx) =>
    orgAccessClosed(tx, bishkekDate(deps.clock.now())),
  );
}

/** Страница по ссылке (`contractorPageState`) с закрытым доступом организации — `org_closed`. */
export type PageAccess = ContractorPageState | { state: 'org_closed' };

/**
 * Что видит браузер по ссылке: закрытый доступ организации виден только браузеру с запомненным верным
 * кодом (как вход сотрудника узнаёт о закрытии только после верного пароля); без кода — тот же ввод кода,
 * по ссылке не узнать, что подписка фирмы не оплачена.
 */
export async function pageAccess(
  deps: { db: Db; clock: ApiDeps['clock'] },
  slug: string,
  inn: string,
  tokenHash: string | null,
): Promise<PageAccess> {
  const state = await contractorPageState(deps.db, slug, inn, tokenHash);
  if (state.state !== 'open') return state;
  return (await orgClosedNow(deps, state.orgId)) ? { state: 'org_closed' } : state;
}
