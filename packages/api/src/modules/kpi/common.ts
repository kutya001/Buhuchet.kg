import {
  contractorScope,
  lastFillEvents,
  orgMenuSettings,
  withOrgContext,
  type IndicatorMonthRecord,
  type IndicatorRecord,
  type KpiContractorRecord,
  type Tx,
} from '@buhuchet/db';
import {
  bishkekDate,
  canSeeContractor,
  hasPermission,
  KPI_MESSAGES,
  monthOf,
  scopeOf,
  type AccessSubject,
  type Feature,
  type IsoDate,
  type KpiRefusal,
  type YearMonth,
} from '@buhuchet/domain';
import { ApiError, type KpiColumn, type MonthStatus } from '@buhuchet/shared';
import type { SQL } from 'drizzle-orm';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { orgContextOf } from '../../middleware/access';

/*
 * Общее для методов модуля «Показатели контрагентов» (задача 2.27): функция учётной политики, область
 * «Свои контрагенты» группы «Показатели контрагентов», кто вносит значения, ответ по показателю и статусу.
 */

export const error = { 'application/json': { schema: ApiError } };

export const noAuth = { description: 'Нет входа', content: error };

/** Отказ модуля: код — ключ словаря `err.<код>`, текст — по умолчанию. */
export function kpiFail(status: 400 | 403 | 404 | 409, code: KpiRefusal, details?: unknown): never {
  return apiFail(status, code, KPI_MESSAGES[code], details);
}

/** Сотрудник, который действует (общий слой уже проверил право метода). */
export function subjectOf(c: Context<AppEnv>): AccessSubject {
  return c.get('access')!.subject;
}

/** Сегодня по Бишкеку — от часов приложения, а не базы: так это проверяется тестом. */
export const todayOf = (deps: ApiDeps): IsoDate => bishkekDate(deps.clock.now());
export const currentMonthOf = (deps: ApiDeps): YearMonth => monthOf(todayOf(deps));

/** Область «Свои контрагенты» группы «Показатели контрагентов»: условие для запросов. */
export function kpiScopeOf(subject: AccessSubject): SQL | undefined {
  return contractorScope(scopeOf(subject, 'kpi') === 'own' ? subject.employeeId : null);
}

/**
 * Транзакция организации для метода модуля: функция «Показатели контрагентов» выключена в учётной
 * политике — 403 `indicators_off` (сервер проверяет её сам, а не только прячет модуль).
 */
export function inKpi<T>(
  deps: ApiDeps,
  c: Context<AppEnv>,
  fn: (tx: Tx, features: Record<Feature, boolean>) => Promise<T>,
  kind?: 'export',
) {
  const ctx = orgContextOf(c);
  return withOrgContext(deps.db, kind ? { ...ctx, kind } : ctx, async (tx) => {
    const { features } = await orgMenuSettings(tx, ctx.orgId);
    if (!features.indicators) kpiFail(403, 'indicators_off');
    return fn(tx, features);
  });
}

/**
 * Вносит ли сотрудник значения контрагента (прототип `kCanEdit`): право «Вносить значения
 * показателей» и контрагент в области; разовым и архивным значения не вносятся.
 */
export function canEditValues(
  subject: AccessSubject,
  contractor: Pick<KpiContractorRecord, 'kind' | 'serviceStatus' | 'responsibleEmployeeId'>,
): boolean {
  return (
    hasPermission(subject, 'kpiEdit') &&
    canSeeContractor(subject, 'kpi', contractor) &&
    contractor.kind !== 'oneoff' &&
    contractor.serviceStatus !== 'archived'
  );
}

/** Показатель для столбца таблицы и окна значения. */
export const kpiColumnOf = (i: IndicatorRecord): KpiColumn => ({
  id: i.id,
  name: i.name,
  unit: i.unit,
  type: i.type,
  total: i.total,
  description: i.description,
  required: i.required,
  archived: i.archived,
});

/** Статусы месяцев для ответа: последняя смена — когда и кто (подсказка компактной шкалы). */
export async function monthStatuses(
  tx: Tx,
  rows: readonly IndicatorMonthRecord[],
): Promise<Map<string, MonthStatus>> {
  const events = await lastFillEvents(
    tx,
    rows.map((r) => r.id),
  );
  return new Map(
    rows.map((r) => {
      const e = events.get(r.id);
      return [
        `${r.contractorId}|${r.month}`,
        {
          id: r.id,
          code: r.status,
          version: r.version,
          at: (e?.at ?? r.statusAt).toISOString(),
          actor: e?.actor ?? null,
        },
      ];
    }),
  );
}
