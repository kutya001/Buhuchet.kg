import {
  addMonths,
  auditActorName,
  fillMonth,
  KPI_LOOKBACK_MONTHS,
  monthIndicators,
  monthFilled,
  monthOf,
  monthRange,
  nextFillStatus,
  RecordChangedError,
  RecordNotFoundError,
  type FillStatus,
  type HistoryChange,
  type IndicatorScope,
  type IndicatorTotal,
  type IndicatorType,
  type IsoDate,
  type KpiBook,
  type KpiContractor,
  type KpiIndicator,
  type KpiTarget,
  type KpiValueOf,
  type YearMonth,
} from '@buhuchet/domain';
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, sql, type SQL } from 'drizzle-orm';
import type { Tx } from './client';
import { updateWithHistory, writeHistory } from './history';
import { writeStatusChange } from './status';
import {
  auditLog,
  contractorGkedExtra,
  contractors,
  employees,
  indicatorMonths,
  indicators,
  indicatorTargets,
  indicatorValues,
  orgSettings,
  statusHistory,
  taxRegimes,
} from './schema';

/*
 * Показатели контрагентов (задача 2.27; ТЗ «Показатели контрагентов»; прототип modules/kpi.js): чтение
 * показателей, «Кому вести», значений и статусов месяцев, запись с историей и пересчёт статуса
 * заполнения месяца. Правила — @buhuchet/domain (`kpi/*`); здесь — только данные. Всё — в
 * `withOrgContext`: чужая организация не видна (RLS), область «Свои контрагенты» передаёт API.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ───────────── Показатели ───────────── */

export interface IndicatorRecord {
  id: string;
  name: string;
  unit: string;
  type: IndicatorType;
  total: IndicatorTotal;
  description: string;
  required: boolean;
  dueDay: number;
  startMonth: YearMonth;
  scope: IndicatorScope;
  autoNew: boolean;
  archived: boolean;
  sortOrder: number;
  version: number;
  /** Сколько внесённых значений (без пустых строк): тип и единицу при них не меняют. */
  valueCount: number;
  /** Есть ли строки значений (и пустые): показатель с ними не удаляется — только в архив. */
  hasRows: boolean;
}

// Подзапросы — с явными именами таблиц: в запросе одной таблицы drizzle пишет столбцы без её имени.
const VALUE_COUNT =
  sql<number>`(select count(*) from indicator_values v where v.indicator_id = "indicators"."id" and v.value is not null)`.mapWith(
    Number,
  );
const HAS_ROWS = sql<boolean>`exists (select 1 from indicator_values v where v.indicator_id = "indicators"."id")`;

const indicatorFields = {
  id: indicators.id,
  name: indicators.name,
  unit: indicators.unit,
  type: indicators.type,
  total: indicators.total,
  description: indicators.description,
  required: indicators.required,
  dueDay: indicators.dueDay,
  startMonth: indicators.startMonth,
  scope: indicators.scope,
  autoNew: indicators.autoNew,
  archived: indicators.archived,
  sortOrder: indicators.sortOrder,
  version: indicators.version,
  valueCount: VALUE_COUNT,
  hasRows: HAS_ROWS,
};

/** Все показатели организации (и в архиве) по порядку. */
export function listIndicators(tx: Tx): Promise<IndicatorRecord[]> {
  return tx
    .select(indicatorFields)
    .from(indicators)
    .orderBy(asc(indicators.sortOrder), asc(indicators.createdAt));
}

export async function getIndicator(tx: Tx, id: string): Promise<IndicatorRecord | null> {
  if (!UUID_RE.test(id)) return null;
  const [row] = await tx.select(indicatorFields).from(indicators).where(eq(indicators.id, id));
  return row ?? null;
}

/** Показатель глазами правил заполнения. */
export const kpiIndicatorOf = (r: IndicatorRecord): KpiIndicator => ({
  id: r.id,
  required: r.required,
  dueDay: r.dueDay,
  start: r.startMonth,
  archived: r.archived,
  scope: r.scope,
  autoNew: r.autoNew,
  order: r.sortOrder,
});

/** Поля окна показателя. */
export interface IndicatorFields {
  name: string;
  unit: string;
  type: IndicatorType;
  total: IndicatorTotal;
  description: string;
  required: boolean;
  dueDay: number;
  startMonth: YearMonth;
  scope: IndicatorScope;
  autoNew: boolean;
}

/** Новый показатель — последним по порядку; история — «создан». */
export async function insertIndicator(tx: Tx, fields: IndicatorFields): Promise<string> {
  const [row] = await tx
    .insert(indicators)
    .values({
      ...fields,
      orgId: sql`app.current_org_id()`,
      sortOrder: sql`coalesce((select max(${indicators.sortOrder}) from ${indicators}), 0) + 1`,
      createdBy: sql`app.current_user_id()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .returning({ id: indicators.id });
  await writeHistory(tx, {
    entity: 'indicator',
    entityId: row!.id,
    action: 'create',
    changes: [{ field: 'name', to: fields.name }],
  });
  return row!.id;
}

/**
 * Порядок показателей (перетаскиванием): `ids` — все показатели в новом порядке. Версия показателя не
 * меняется — порядок не мешает открытому окну показателя; в историю — у каждого сдвинутого.
 */
export async function reorderIndicators(tx: Tx, ids: readonly string[]): Promise<boolean> {
  const rows = await tx
    .select({ id: indicators.id, sortOrder: indicators.sortOrder })
    .from(indicators)
    .orderBy(asc(indicators.sortOrder))
    .for('update');
  const known = new Set(rows.map((r) => r.id));
  if (
    ids.length !== rows.length ||
    new Set(ids).size !== ids.length ||
    !ids.every((id) => known.has(id))
  ) {
    return false;
  }
  const before = new Map(rows.map((r) => [r.id, r.sortOrder]));
  const moved = ids.flatMap((id, i) =>
    before.get(id) === i + 1 ? [] : [{ id, from: before.get(id)!, to: i + 1 }],
  );
  for (const m of moved) {
    await tx.update(indicators).set({ sortOrder: m.to }).where(eq(indicators.id, m.id));
  }
  await writeHistory(
    tx,
    ...moved.map((m) => ({
      entity: 'indicator' as const,
      entityId: m.id,
      action: 'update' as const,
      changes: [{ field: 'sortOrder', from: m.from, to: m.to }],
    })),
  );
  return true;
}

/**
 * Сохранить окно показателя (с версией): изменённые поля — в историю показателя. Порядок, архив и
 * «Кому вести» меняются отдельно.
 */
export async function updateIndicator(
  tx: Tx,
  id: string,
  version: number,
  fields: IndicatorFields,
): Promise<void> {
  await updateWithHistory(tx, {
    table: indicators,
    entity: 'indicator',
    id,
    version,
    patch: fields,
  });
}

/** «В архив» и «Вернуть из архива» (с версией, в историю показателя). */
export async function archiveIndicator(
  tx: Tx,
  id: string,
  version: number,
  archived: boolean,
): Promise<void> {
  await updateWithHistory(tx, {
    table: indicators,
    entity: 'indicator',
    id,
    version,
    patch: { archived },
  });
}

/** Строка «Истории показателя». */
export interface IndicatorHistoryRecord {
  at: Date;
  actor: string | null;
  action: string;
  /** Контрагент строки «Ведётся» → «Не ведётся»; null — правка самого показателя. */
  contractor: string | null;
  changes: HistoryChange[];
}

/**
 * «История показателя» в окне показателя (прототип: последние 30 записей): сначала новые. Строки
 * контрагентов вне области `scope` не показываются.
 */
export async function indicatorHistory(
  tx: Tx,
  id: string,
  scope: SQL | undefined,
  limit = 30,
): Promise<IndicatorHistoryRecord[]> {
  const rows = await tx
    .select({
      at: auditLog.at,
      actorUserId: auditLog.actorUserId,
      actorName: employees.shortName,
      action: auditLog.action,
      contractorId: auditLog.contractorId,
      contractor: contractors.name,
      changes: auditLog.changes,
    })
    .from(auditLog)
    .leftJoin(employees, eq(employees.userId, auditLog.actorUserId))
    .leftJoin(contractors, eq(contractors.id, auditLog.contractorId))
    .where(
      and(
        eq(auditLog.entity, 'indicator'),
        eq(auditLog.entityId, id),
        scope ? sql`(${auditLog.contractorId} is null or (${scope}))` : undefined,
      ),
    )
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(limit);
  return rows.map((r) => ({
    at: r.at,
    actor: auditActorName(r.actorUserId, r.actorName),
    action: r.action,
    contractor: r.contractorId ? (r.contractor ?? null) : null,
    changes: r.changes,
  }));
}

/** Удалить показатель без значений (проверку `hasRows` делает вызывающий; держит и внешний ключ). */
export async function deleteIndicator(
  tx: Tx,
  row: Pick<IndicatorRecord, 'id' | 'name' | 'version'>,
): Promise<void> {
  const [locked] = await tx
    .select({ version: indicators.version })
    .from(indicators)
    .where(eq(indicators.id, row.id))
    .for('update');
  if (!locked) throw new RecordNotFoundError('indicator', row.id);
  if (locked.version !== row.version)
    throw new RecordChangedError('indicator', row.id, locked.version);
  await writeHistory(tx, {
    entity: 'indicator',
    entityId: row.id,
    action: 'delete',
    changes: [{ field: 'name', from: row.name }],
  });
  await tx.delete(indicators).where(eq(indicators.id, row.id));
}

/* ───────────── Контрагенты глазами показателей ───────────── */

export interface KpiContractorRecord {
  id: string;
  name: string;
  inn: string;
  kind: 'regular' | 'oneoff';
  serviceStatus: 'active' | 'paused' | 'archived';
  startDate: IsoDate;
  responsibleEmployeeId: string | null;
  /** Краткое ФИО ответственного; пусто — без ответственного. */
  responsibleName: string | null;
  regimeCode: string | null;
  regimeName: string | null;
  /** Основной и дополнительные коды ГКЭД — для фильтра «ГКЭД» в «Кому вести». */
  gked: string[];
}

const GKED_CODES = sql<
  string[]
>`array_remove(array[${contractors.gked}] || coalesce((select array_agg(${contractorGkedExtra.gked} order by ${contractorGkedExtra.sortOrder}) from ${contractorGkedExtra} where ${contractorGkedExtra.contractorId} = ${contractors.id}), '{}'), null)`;

/**
 * Контрагенты для показателей в области сотрудника (`scope`): `archived` — и архивные (их значения видны
 * в «За период»), `ids` — только эти. Разовые тоже приходят: правила сами их не учитывают. Порядок — по
 * названию.
 */
export function kpiContractorRecords(
  tx: Tx,
  options: { scope: SQL | undefined; archived?: boolean; ids?: readonly string[] },
): Promise<KpiContractorRecord[]> {
  const ids = options.ids?.filter((id) => UUID_RE.test(id));
  return tx
    .select({
      id: contractors.id,
      name: contractors.name,
      inn: contractors.inn,
      kind: contractors.kind,
      serviceStatus: contractors.serviceStatus,
      startDate: contractors.startDate,
      responsibleEmployeeId: contractors.responsibleEmployeeId,
      responsibleName: employees.shortName,
      regimeCode: contractors.regimeCode,
      regimeName: taxRegimes.name,
      gked: GKED_CODES,
    })
    .from(contractors)
    .leftJoin(employees, eq(employees.id, contractors.responsibleEmployeeId))
    .leftJoin(taxRegimes, eq(taxRegimes.code, contractors.regimeCode))
    .where(
      and(
        options.scope,
        options.archived ? undefined : sql`${contractors.serviceStatus} <> 'archived'`,
        ids ? (ids.length ? inArray(contractors.id, ids) : sql`false`) : undefined,
      ),
    )
    .orderBy(sql`${contractors.name} collate app.ru_natural`, asc(contractors.id));
}

/**
 * Контрагент глазами правил заполнения. Периоды обслуживания с приостановкой и возобновлением добавит
 * задача 2.12 (таблица contractor_service_periods); до неё — один период с начала обслуживания, а у
 * приостановленного — ни одного: показатели у него не требуются (ТЗ «У разовых и приостановленных
 * контрагентов показатель не требуется»).
 */
export function kpiContractorOf(
  r: Pick<KpiContractorRecord, 'id' | 'kind' | 'serviceStatus' | 'startDate'>,
): KpiContractor {
  return {
    id: r.id,
    oneOff: r.kind === 'oneoff',
    archived: r.serviceStatus === 'archived',
    periods: r.serviceStatus === 'active' ? [{ from: monthOf(r.startDate), to: null }] : [],
  };
}

/* ───────────── «Кому вести», значения, статусы месяцев ───────────── */

const targetKey = (indicatorId: string, contractorId: string) => `${indicatorId}|${contractorId}`;
const valueKey = (contractorId: string, indicatorId: string, month: YearMonth) =>
  `${contractorId}|${indicatorId}|${month}`;
const monthKey = (contractorId: string, month: YearMonth) => `${contractorId}|${month}`;

/**
 * Правки показателей организации — по одной (значения, «Кому вести», настройки и статусы месяцев): так
 * пересчёт статуса не видит половину чужой правки, а строка статуса месяца не создаётся дважды.
 */
export async function lockKpi(tx: Tx): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('kpi:' || app.current_org_id()::text, 0))`,
  );
}

/** «Кому вести» контрагентов (`contractorIds` — только их; без него — все). */
export async function loadTargets(
  tx: Tx,
  contractorIds?: readonly string[],
): Promise<Map<string, KpiTarget>> {
  if (contractorIds && contractorIds.length === 0) return new Map();
  const rows = await tx
    .select({
      indicatorId: indicatorTargets.indicatorId,
      contractorId: indicatorTargets.contractorId,
      on: indicatorTargets.enabled,
      from: indicatorTargets.fromMonth,
      offSince: indicatorTargets.offSince,
    })
    .from(indicatorTargets)
    .where(contractorIds ? inArray(indicatorTargets.contractorId, [...contractorIds]) : undefined);
  return new Map(
    rows.map((r) => [
      targetKey(r.indicatorId, r.contractorId),
      { on: r.on, from: r.from, offSince: r.offSince },
    ]),
  );
}

export interface IndicatorValueRecord {
  id: string;
  contractorId: string;
  indicatorId: string;
  month: YearMonth;
  /** Сотые; null — пусто. */
  value: number | null;
  note: string;
  version: number;
  updatedAt: Date;
  /** Кто внёс или изменил последним — краткое ФИО. */
  updatedBy: string | null;
}

const author = sql<
  string | null
>`(select e.short_name from employees e where e.user_id = ${indicatorValues.updatedBy})`;

/**
 * Строки значений: `contractorIds` — только этих контрагентов, `from`/`to` — месяцы, `filled` — только
 * внесённые (без пустых строк).
 */
export function loadValues(
  tx: Tx,
  options: {
    contractorIds?: readonly string[];
    from?: YearMonth;
    to?: YearMonth;
    filled?: boolean;
  } = {},
): Promise<IndicatorValueRecord[]> {
  const ids = options.contractorIds;
  return tx
    .select({
      id: indicatorValues.id,
      contractorId: indicatorValues.contractorId,
      indicatorId: indicatorValues.indicatorId,
      month: indicatorValues.month,
      value: indicatorValues.value,
      note: indicatorValues.note,
      version: indicatorValues.version,
      updatedAt: indicatorValues.updatedAt,
      updatedBy: author,
    })
    .from(indicatorValues)
    .where(
      and(
        ids
          ? ids.length
            ? inArray(indicatorValues.contractorId, [...ids])
            : sql`false`
          : undefined,
        options.from ? gte(indicatorValues.month, options.from) : undefined,
        options.to ? lte(indicatorValues.month, options.to) : undefined,
        options.filled ? isNotNull(indicatorValues.value) : undefined,
      ),
    )
    .orderBy(asc(indicatorValues.month));
}

export interface IndicatorMonthRecord {
  id: string;
  contractorId: string;
  month: YearMonth;
  status: FillStatus;
  statusAt: Date;
  version: number;
}

/** Строки статусов месяцев: `contractorIds` — только этих контрагентов, `from`/`to` — месяцы. */
export function loadMonths(
  tx: Tx,
  options: { contractorIds?: readonly string[]; from?: YearMonth; to?: YearMonth } = {},
): Promise<IndicatorMonthRecord[]> {
  const ids = options.contractorIds;
  return tx
    .select({
      id: indicatorMonths.id,
      contractorId: indicatorMonths.contractorId,
      month: indicatorMonths.month,
      status: indicatorMonths.status,
      statusAt: indicatorMonths.statusAt,
      version: indicatorMonths.version,
    })
    .from(indicatorMonths)
    .where(
      and(
        ids
          ? ids.length
            ? inArray(indicatorMonths.contractorId, [...ids])
            : sql`false`
          : undefined,
        options.from ? gte(indicatorMonths.month, options.from) : undefined,
        options.to ? lte(indicatorMonths.month, options.to) : undefined,
      ),
    );
}

/**
 * Данные показателей для правил: показатели, «Кому вести» и значения. Значения хранятся по ключу и
 * меняются при записи (`saveIndicatorValues`) — пересчёт статуса видит новые значения без перечитывания.
 */
export interface KpiData {
  indicators: IndicatorRecord[];
  book: KpiBook;
  valueOf: KpiValueOf;
  /** Строка значения по ключу (и пустая). */
  valueRow(
    contractorId: string,
    indicatorId: string,
    month: YearMonth,
  ): IndicatorValueRecord | undefined;
  /** Записать строку значения в данные (после сохранения). */
  putValue(row: IndicatorValueRecord): void;
}

export function kpiData(
  list: IndicatorRecord[],
  targets: Map<string, KpiTarget>,
  values: readonly IndicatorValueRecord[],
): KpiData {
  const byKey = new Map(values.map((v) => [valueKey(v.contractorId, v.indicatorId, v.month), v]));
  const valueOf: KpiValueOf = (c, i, m) => byKey.get(valueKey(c, i, m))?.value ?? null;
  return {
    indicators: list,
    book: {
      indicators: list.map(kpiIndicatorOf),
      target: (i, c) => targets.get(targetKey(i, c)),
      hasValue: (c, i, m) => valueOf(c, i, m) !== null,
    },
    valueOf,
    valueRow: (c, i, m) => byKey.get(valueKey(c, i, m)),
    putValue: (row) => byKey.set(valueKey(row.contractorId, row.indicatorId, row.month), row),
  };
}

/**
 * Загрузить данные показателей: контрагенты `contractorIds` (без него — все), значения за месяцы
 * `from`…`to` (без них — все).
 */
export async function loadKpiData(
  tx: Tx,
  options: {
    contractorIds?: readonly string[];
    from?: YearMonth;
    to?: YearMonth;
    filled?: boolean;
  } = {},
): Promise<KpiData> {
  const [list, targets, values] = await Promise.all([
    listIndicators(tx),
    loadTargets(tx, options.contractorIds),
    loadValues(tx, options),
  ]);
  return kpiData(list, targets, values);
}

/* ───────────── Статус заполнения месяца ───────────── */

export interface FillStatusChange {
  contractorId: string;
  month: YearMonth;
  from: FillStatus;
  to: FillStatus;
}

/**
 * Пересчитать статусы месяцев (прототип `kSync`): «Заполнено» — само, когда внесены все обязательные
 * показатели месяца; не всё внесено — «Не заполнено»; правка значения в «Проверено» (`edited`) возвращает
 * месяц на «Заполнено». Строка месяца появляется, когда статус впервые становится не «Не заполнено».
 * Смена — в «Историю статусов» (автор — кто изменил данные).
 */
export async function syncFillStatuses(
  tx: Tx,
  data: KpiData,
  pairs: readonly { contractor: KpiContractor; month: YearMonth; edited?: boolean }[],
): Promise<FillStatusChange[]> {
  if (pairs.length === 0) return [];
  await lockKpi(tx);
  const ids = [...new Set(pairs.map((p) => p.contractor.id))];
  const months = pairs.map((p) => p.month).sort();
  const rows = await tx
    .select({
      id: indicatorMonths.id,
      contractorId: indicatorMonths.contractorId,
      month: indicatorMonths.month,
      status: indicatorMonths.status,
    })
    .from(indicatorMonths)
    .where(
      and(
        inArray(indicatorMonths.contractorId, ids),
        gte(indicatorMonths.month, months[0]!),
        lte(indicatorMonths.month, months[months.length - 1]!),
      ),
    );
  const existing = new Map(rows.map((r) => [monthKey(r.contractorId, r.month), r]));
  const out: FillStatusChange[] = [];
  const seen = new Set<string>();
  for (const p of pairs) {
    const key = monthKey(p.contractor.id, p.month);
    if (seen.has(key)) continue;
    seen.add(key);
    const row = existing.get(key);
    const current = row?.status ?? 'empty';
    const needed = monthIndicators(data.book, p.contractor, p.month).length > 0;
    // Месяц без показателей (выключили все) не трогаем: его статус остаётся как был.
    if (!needed) continue;
    const to = nextFillStatus(current, monthFilled(data.book, p.contractor, p.month), !!p.edited);
    if (to === current) continue;
    let id = row?.id;
    if (id) {
      await tx
        .update(indicatorMonths)
        .set({
          status: to,
          statusAt: sql`now()`,
          updatedAt: sql`now()`,
          version: sql`${indicatorMonths.version} + 1`,
        })
        .where(eq(indicatorMonths.id, id));
    } else {
      const [created] = await tx
        .insert(indicatorMonths)
        .values({
          orgId: sql`app.current_org_id()`,
          contractorId: p.contractor.id,
          month: p.month,
          status: to,
        })
        .returning({ id: indicatorMonths.id });
      id = created!.id;
    }
    await writeStatusChange(tx, {
      scale: 'indicator',
      entityId: id,
      from: current,
      to,
      reason: current === 'checked' ? 'Значение изменено — нужна повторная проверка' : null,
    });
    out.push({ contractorId: p.contractor.id, month: p.month, from: current, to });
  }
  return out;
}

/**
 * Пересчитать статусы месяцев контрагентов после правки настроек (прототип `kResync`): месяцы от
 * текущего месяца заполнения на 35 назад, у которых есть строка статуса или нужны показатели.
 * `contractorIds` — только этих контрагентов; без него — всех.
 */
export async function resyncFillStatuses(
  tx: Tx,
  today: IsoDate,
  contractorIds?: readonly string[],
): Promise<FillStatusChange[]> {
  const last = fillMonth(today);
  const from = addMonths(last, -KPI_LOOKBACK_MONTHS);
  const list = await kpiContractorRecords(tx, {
    scope: undefined,
    archived: false,
    ...(contractorIds ? { ids: contractorIds } : {}),
  });
  const regular = list.filter((c) => c.kind !== 'oneoff');
  if (regular.length === 0) return [];
  const ids = regular.map((c) => c.id);
  const [data, rows] = await Promise.all([
    loadKpiData(tx, { contractorIds: ids, from, to: last, filled: true }),
    loadMonths(tx, { contractorIds: ids, from, to: last }),
  ]);
  const withRow = new Set(rows.map((r) => monthKey(r.contractorId, r.month)));
  const pairs = regular.flatMap((r) => {
    const contractor = kpiContractorOf(r);
    return monthRange(from, last)
      .filter(
        (m) =>
          withRow.has(monthKey(r.id, m)) || monthIndicators(data.book, contractor, m).length > 0,
      )
      .map((month) => ({ contractor, month }));
  });
  return syncFillStatuses(tx, data, pairs);
}

/** Последняя смена статуса месяцев: когда и кто (подсказка компактной шкалы). */
export async function lastFillEvents(
  tx: Tx,
  monthIds: readonly string[],
): Promise<Map<string, { at: Date; actor: string | null }>> {
  if (monthIds.length === 0) return new Map();
  const rows = await tx
    .selectDistinctOn([statusHistory.entityId], {
      entityId: statusHistory.entityId,
      at: statusHistory.at,
      actorUserId: statusHistory.actorUserId,
      actorName: employees.shortName,
    })
    .from(statusHistory)
    .leftJoin(employees, eq(employees.userId, statusHistory.actorUserId))
    .where(
      and(eq(statusHistory.scale, 'indicator'), inArray(statusHistory.entityId, [...monthIds])),
    )
    .orderBy(statusHistory.entityId, desc(statusHistory.at), desc(statusHistory.id));
  return new Map(
    rows.map((r) => [r.entityId, { at: r.at, actor: auditActorName(r.actorUserId, r.actorName) }]),
  );
}

/** Строка статуса месяца с проверкой версии — для «Проверено» и отката. */
export async function lockFillMonth(
  tx: Tx,
  contractorId: string,
  month: YearMonth,
): Promise<IndicatorMonthRecord | null> {
  await lockKpi(tx);
  const [row] = await tx
    .select({
      id: indicatorMonths.id,
      contractorId: indicatorMonths.contractorId,
      month: indicatorMonths.month,
      status: indicatorMonths.status,
      statusAt: indicatorMonths.statusAt,
      version: indicatorMonths.version,
    })
    .from(indicatorMonths)
    .where(and(eq(indicatorMonths.contractorId, contractorId), eq(indicatorMonths.month, month)))
    .for('update');
  return row ?? null;
}

/**
 * Поставить статус месяца вручную: «Проверено» (право «Проверять показатели») или откат на шаг назад
 * (право «Откат статусов», с причиной). Правила перехода проверяет вызывающий.
 */
export async function setFillStatus(
  tx: Tx,
  row: IndicatorMonthRecord,
  to: FillStatus,
  options: { version: number; reason?: string | null; rollback?: boolean },
): Promise<IndicatorMonthRecord> {
  if (row.version !== options.version) {
    throw new RecordChangedError('indicator_month', row.id, row.version);
  }
  const [updated] = await tx
    .update(indicatorMonths)
    .set({
      status: to,
      statusAt: sql`now()`,
      updatedAt: sql`now()`,
      version: sql`${indicatorMonths.version} + 1`,
    })
    .where(eq(indicatorMonths.id, row.id))
    .returning({
      id: indicatorMonths.id,
      contractorId: indicatorMonths.contractorId,
      month: indicatorMonths.month,
      status: indicatorMonths.status,
      statusAt: indicatorMonths.statusAt,
      version: indicatorMonths.version,
    });
  await writeStatusChange(tx, {
    scale: 'indicator',
    entityId: row.id,
    from: row.status,
    to,
    reason: options.reason ?? null,
    rollback: options.rollback ?? false,
  });
  return updated!;
}

/* ───────────── Запись «Кому вести» ───────────── */

export interface TargetWrite {
  contractorId: string;
  /** Вёлся ли до правки; null — показатель новый (в историю не пишется). */
  before: boolean | null;
  after: boolean;
  /** Строка «Кому вести» после правки; null — строки нет. */
  target: KpiTarget | null;
  /** Месяц «с <месяц>» до правки — для истории, если его меняли из карточки. */
  fromBefore?: YearMonth | null;
}

/**
 * Записать «Кому вести» показателя: строки ставятся и снимаются, изменения «Ведётся» → «Не ведётся» и
 * «вести с» — в историю показателя с контрагентом (видна и в карточке контрагента).
 */
export async function writeTargets(
  tx: Tx,
  indicatorId: string,
  writes: readonly TargetWrite[],
): Promise<void> {
  await lockKpi(tx);
  const keep = writes.filter((w) => w.target);
  const drop = writes.filter((w) => !w.target).map((w) => w.contractorId);
  if (drop.length) {
    await tx
      .delete(indicatorTargets)
      .where(
        and(
          eq(indicatorTargets.indicatorId, indicatorId),
          inArray(indicatorTargets.contractorId, drop),
        ),
      );
  }
  for (let i = 0; i < keep.length; i += 1000) {
    await tx
      .insert(indicatorTargets)
      .values(
        keep.slice(i, i + 1000).map((w) => ({
          orgId: sql`app.current_org_id()`,
          indicatorId,
          contractorId: w.contractorId,
          enabled: w.target!.on,
          fromMonth: w.target!.from,
          offSince: w.target!.offSince,
          updatedBy: sql`app.current_user_id()`,
        })),
      )
      .onConflictDoUpdate({
        target: [indicatorTargets.indicatorId, indicatorTargets.contractorId],
        set: {
          enabled: sql`excluded.enabled`,
          fromMonth: sql`excluded.from_month`,
          offSince: sql`excluded.off_since`,
          updatedBy: sql`excluded.updated_by`,
          updatedAt: sql`now()`,
        },
        // Строки без изменений (например, контрагенты вне области сотрудника) не трогаются:
        // «Изменил» и время у них остаются прежними.
        setWhere: sql`(${indicatorTargets.enabled}, ${indicatorTargets.fromMonth}, ${indicatorTargets.offSince})
          is distinct from (excluded.enabled, excluded.from_month, excluded.off_since)`,
      });
  }
  const history = writes.flatMap((w) => {
    const changes: HistoryChange[] = [];
    if (w.before !== null && w.before !== w.after) {
      changes.push({ field: 'enabled', from: w.before, to: w.after });
    }
    if (w.fromBefore !== undefined && w.fromBefore !== (w.target?.from ?? null)) {
      changes.push({ field: 'fromMonth', from: w.fromBefore, to: w.target?.from ?? null });
    }
    return changes.length
      ? [
          {
            entity: 'indicator' as const,
            entityId: indicatorId,
            action: 'update' as const,
            contractorId: w.contractorId,
            changes,
          },
        ]
      : [];
  });
  await writeHistory(tx, ...history);
}

/* ───────────── Запись значений ───────────── */

export interface ValueWrite {
  contractorId: string;
  indicatorId: string;
  month: YearMonth;
  /** Сотые; null — стереть («не заполнено»). */
  value: number | null;
  /** Комментарий; не задан — без изменений. */
  note?: string;
  /** Значение и комментарий, которые видел сотрудник; другие в базе — `RecordChangedError`. */
  prev?: number | null;
  prevNote?: string;
}

/** Ячеек в одном запросе записи: параметров запроса не больше 65 535. */
const VALUE_BATCH = 1000;

/**
 * Записать значения (одно или блок, вставленный из Excel) с историей «было → стало» и пересчитать
 * статусы их месяцев. Ячейки уже проверены вызывающим (показатель ведётся у контрагента или месяц раньше
 * «с <месяц>», показатель не в архиве, контрагент в области). Значение без изменений не пишется.
 * `reason` — пометка в истории (например, «Из Excel»).
 */
export async function saveIndicatorValues(
  tx: Tx,
  data: KpiData,
  contractorsById: ReadonlyMap<string, KpiContractor>,
  writes: readonly ValueWrite[],
  reason: string | null = null,
): Promise<{ changed: ValueWrite[]; statuses: FillStatusChange[] }> {
  if (writes.length === 0) return { changed: [], statuses: [] };
  await lockKpi(tx);
  const ids = [...new Set(writes.map((w) => w.contractorId))];
  const months = writes.map((w) => w.month).sort();
  // Значения перечитаны под блокировкой: правку, сохранённую другим сотрудником, видно по `prev`.
  const fresh = await loadValues(tx, {
    contractorIds: ids,
    from: months[0]!,
    to: months[months.length - 1]!,
  });
  for (const row of fresh) data.putValue(row);

  // Одна ячейка — одна запись: повтор ячейки в запросе — берётся последний.
  const unique = new Map(writes.map((w) => [valueKey(w.contractorId, w.indicatorId, w.month), w]));
  const pending: {
    w: ValueWrite;
    row: IndicatorValueRecord | undefined;
    changes: HistoryChange[];
    edited: boolean;
  }[] = [];
  for (const w of unique.values()) {
    const row = data.valueRow(w.contractorId, w.indicatorId, w.month);
    const before = row?.value ?? null;
    const noteChanged = w.note !== undefined && w.note !== (row?.note ?? '');
    if (before === w.value && !noteChanged) continue;
    if (!row && w.value === null && !noteChanged) continue;
    // Пока сотрудник правил, значение сохранил другой: не затирать молча (ТЗ, общие правила).
    if (
      (w.prev !== undefined && w.prev !== before) ||
      (noteChanged && w.prevNote !== undefined && w.prevNote !== (row?.note ?? ''))
    ) {
      throw new RecordChangedError(
        'indicator_value',
        row?.id ?? valueKey(w.contractorId, w.indicatorId, w.month),
        row?.version ?? 0,
      );
    }
    const changes: HistoryChange[] = [];
    if (before !== w.value) changes.push({ field: 'value', from: before, to: w.value });
    if (noteChanged) changes.push({ field: 'note', from: row?.note ?? '', to: w.note! });
    pending.push({ w, row, changes, edited: before !== w.value });
  }

  // Записи — пачками: загрузка из Excel пишет тысячи ячеек одним запросом на пачку, а не по одной.
  const saved = new Map<string, { id: string; version: number; updatedAt: Date }>();
  const updates = pending.filter((p) => p.row);
  for (let i = 0; i < updates.length; i += VALUE_BATCH) {
    const batch = updates.slice(i, i + VALUE_BATCH).map((p) => ({
      id: p.row!.id,
      value: p.w.value,
      note: p.w.note ?? null,
    }));
    const rows = await tx.execute<{ id: string; version: number; updated_at: Date | string }>(sql`
      update ${indicatorValues} as v
      set value = x.value,
          note = coalesce(x.note, v.note),
          updated_by = app.current_user_id(),
          updated_at = now(),
          version = v.version + 1
      from jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) as x(id uuid, value bigint, note text)
      where v.id = x.id
      returning v.id, v.version, v.updated_at`);
    for (const r of rows) {
      saved.set(r.id, { id: r.id, version: r.version, updatedAt: new Date(r.updated_at) });
    }
  }
  const inserts = pending.filter((p) => !p.row);
  for (let i = 0; i < inserts.length; i += VALUE_BATCH) {
    const rows = await tx
      .insert(indicatorValues)
      .values(
        inserts.slice(i, i + VALUE_BATCH).map(({ w }) => ({
          orgId: sql`app.current_org_id()`,
          contractorId: w.contractorId,
          indicatorId: w.indicatorId,
          month: w.month,
          value: w.value,
          note: w.note ?? '',
          createdBy: sql`app.current_user_id()`,
          updatedBy: sql`app.current_user_id()`,
        })),
      )
      .returning({
        id: indicatorValues.id,
        version: indicatorValues.version,
        updatedAt: indicatorValues.updatedAt,
        contractorId: indicatorValues.contractorId,
        indicatorId: indicatorValues.indicatorId,
        month: indicatorValues.month,
      });
    for (const r of rows) {
      saved.set(valueKey(r.contractorId, r.indicatorId, r.month as YearMonth), r);
    }
  }

  const changed: ValueWrite[] = [];
  const edited = new Map<
    string,
    { contractor: KpiContractor; month: YearMonth; edited: boolean }
  >();
  const history: Parameters<typeof writeHistory>[1][] = [];
  for (const { w, row, changes, edited: valueEdited } of pending) {
    const s = row ? saved.get(row.id) : saved.get(valueKey(w.contractorId, w.indicatorId, w.month));
    if (!s) throw new Error('indicator value was not saved');
    history.push({
      entity: 'indicator_value',
      entityId: s.id,
      action: row ? 'update' : 'create',
      contractorId: w.contractorId,
      changes,
      reason,
    });
    data.putValue({
      id: s.id,
      contractorId: w.contractorId,
      indicatorId: w.indicatorId,
      month: w.month,
      value: w.value,
      note: w.note ?? row?.note ?? '',
      version: s.version,
      updatedAt: s.updatedAt,
      updatedBy: null,
    });
    changed.push(w);
    const contractor = contractorsById.get(w.contractorId);
    if (contractor) {
      const key = monthKey(w.contractorId, w.month);
      const x = edited.get(key) ?? { contractor, month: w.month, edited: false };
      if (valueEdited) x.edited = true;
      edited.set(key, x);
    }
  }
  for (let i = 0; i < history.length; i += VALUE_BATCH) {
    await writeHistory(tx, ...history.slice(i, i + VALUE_BATCH));
  }
  const statuses = await syncFillStatuses(tx, data, [...edited.values()]);
  return { changed, statuses };
}

/** Строка значения по номеру — для блока «Файлы»: контрагент и показатель. */
export async function indicatorValueOwner(
  tx: Tx,
  id: string,
  scope: SQL | undefined,
): Promise<{
  id: string;
  contractorId: string;
  responsibleEmployeeId: string | null;
  contractorArchived: boolean;
  contractorOneOff: boolean;
  indicatorArchived: boolean;
  /** Функция «Показатели контрагентов» включена в учётной политике. */
  enabled: boolean;
} | null> {
  if (!UUID_RE.test(id)) return null;
  const [row] = await tx
    .select({
      id: indicatorValues.id,
      contractorId: indicatorValues.contractorId,
      responsibleEmployeeId: contractors.responsibleEmployeeId,
      contractorArchived: sql<boolean>`${contractors.serviceStatus} = 'archived'`,
      contractorOneOff: sql<boolean>`${contractors.kind} = 'oneoff'`,
      indicatorArchived: indicators.archived,
      enabled: sql<boolean>`coalesce((select (${orgSettings.features} ->> 'indicators')::boolean from ${orgSettings} where ${orgSettings.orgId} = app.current_org_id()), false)`,
    })
    .from(indicatorValues)
    .innerJoin(contractors, eq(contractors.id, indicatorValues.contractorId))
    .innerJoin(indicators, eq(indicators.id, indicatorValues.indicatorId))
    .where(and(eq(indicatorValues.id, id), scope));
  return row ?? null;
}

/* ───────────── История значений ───────────── */

export interface ValueHistoryItem {
  at: Date;
  indicatorId: string;
  from: number | null;
  to: number | null;
  /** Пометка, например «Из Excel». */
  reason: string | null;
  actor: string | null;
}

/** История значений контрагента за месяц: сначала новые (прототип `IHIST` в окне значения). */
export async function valueHistory(
  tx: Tx,
  contractorId: string,
  month: YearMonth,
): Promise<ValueHistoryItem[]> {
  const rows = await tx.execute<{
    at: Date;
    indicator_id: string;
    changes: HistoryChange[];
    reason: string | null;
    actor_user_id: string | null;
    short_name: string | null;
  }>(sql`
    select a.at, v.indicator_id, a.changes, a.reason, a.actor_user_id, e.short_name
    from audit_log a
    join indicator_values v on v.id::text = a.entity_id
    left join employees e on e.user_id = a.actor_user_id
    where a.entity = 'indicator_value' and v.contractor_id = ${contractorId} and v.month = ${month}
    order by a.at desc, a.id desc
    limit 200`);
  return rows.flatMap((r) => {
    const change = r.changes.find((c) => c.field === 'value');
    if (!change) return [];
    const num = (v: unknown) => (typeof v === 'number' ? v : v == null ? null : Number(v));
    return [
      {
        at: new Date(r.at),
        indicatorId: r.indicator_id,
        from: num(change.from),
        to: num(change.to),
        reason: r.reason,
        actor: auditActorName(r.actor_user_id, r.short_name),
      },
    ];
  });
}
