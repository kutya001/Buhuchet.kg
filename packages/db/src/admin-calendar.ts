import {
  ADMIN_CALENDAR_COLUMNS,
  ADMIN_CALENDAR_SORT,
  auditActorName,
  calendarAddKind,
  calendarAddProblems,
  calendarAdminYears,
  calendarCopyPlan,
  isEveryYear,
  isIsoDate,
  weekdayMondayFirst,
  type CalendarAddInput,
  type CalendarAddProblem,
  type CalendarCopyItem,
  type CalendarDayKind,
  type CalendarEntry,
  type HistoryChange,
  type IsoDate,
  type ListQuery,
} from '@buhuchet/domain';
import { and, asc, count, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { AdminDictHistoryItem } from './admin-platform-dicts';
import type { Tx } from './client';
import {
  selectListExport,
  selectListPage,
  selectListValues,
  type ListColumn,
  type ListColumns,
  type ListFrom,
  type ListTexts,
} from './list';
import { writePlatformHistory } from './platform-history';
import { platformAuditLog, productionCalendar } from './schema';

/*
 * Админка → «Справочники платформы» → «Календарь» (задача 2.36; ТЗ «Производственный календарь КР»;
 * прототип admin/platform-dicts.js и platform-dicts-edit.js: holidayRows, holidayDlg, calCopyDlg): дни
 * текущего и следующего года, «Нерабочий день», «Удалить» и «Календарь на следующий год копированием».
 * Пишет администратор платформы функциями базы (миграция 0051), история — в `platform_audit_log`
 * (сущность `platform_dict`, ключ `calendar:<день>`).
 */

/** День календаря в Админке: запись (`key`) на дату года списка. */
export interface AdminCalendarDayRecord {
  key: string;
  date: IsoDate;
  kind: CalendarDayKind;
  name: string;
  everyYear: boolean;
  audit: {
    createdAt: Date | null;
    createdBy: string | null;
    updatedAt: Date;
    updatedBy: string | null;
  };
  version: number;
}

const entityId = (day: string) => `calendar:${day}`;

/** Все записи календаря как есть — для правил (`calendarYear`, `calendarAddProblems`). */
async function calendarRecords(tx: Tx) {
  return tx.select().from(productionCalendar).orderBy(asc(productionCalendar.day));
}

const entryOf = (r: { day: string; kind: CalendarDayKind; name: string }): CalendarEntry => ({
  day: r.day,
  kind: r.kind,
  name: r.name,
});

/**
 * Дни текущего и следующего года по Бишкеку (прототип: holidayRows(y) и holidayRows(y + 1)): праздник
 * «каждый год» — в обоих годах, 29 февраля — только в високосном.
 */
async function calendarDays(tx: Tx, today: IsoDate): Promise<AdminCalendarDayRecord[]> {
  const years = calendarAdminYears(today);
  const rows = await calendarRecords(tx);
  return rows
    .flatMap((r) => {
      const everyYear = isEveryYear(r.day);
      const dates = everyYear ? years.map((y) => `${y}-${r.day}`) : [r.day];
      const createdBy = auditActorName(r.createdBy, null);
      return dates
        .filter((d) => isIsoDate(d) && years.includes(Number(d.slice(0, 4))))
        .map((date): AdminCalendarDayRecord => ({
          key: r.day,
          date,
          kind: r.kind,
          name: r.name,
          everyYear,
          audit: {
            createdAt: r.createdAt,
            createdBy,
            updatedAt: r.updatedAt,
            updatedBy: auditActorName(r.updatedBy, null) ?? createdBy,
          },
          version: r.version,
        }));
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.key < b.key ? -1 : 1));
}

/* ───────────── Список ───────────── */

/** Столбец строки из `jsonb_to_recordset`: ключи — постоянные имена столбцов, не ввод пользователя. */
const field = (key: string) => sql.raw(`"r"."${key}"`);

/** Строка списка: тексты столбцов, подписи кодов (`<ключ>_text`) и служебные поля. */
function listRow(x: AdminCalendarDayRecord, ord: number, t: ListTexts) {
  const dow = weekdayMondayFirst(x.date);
  const rule = x.everyYear ? 'every' : 'once';
  return {
    id: `${x.date}|${x.key}`,
    ord,
    date: x.date,
    dow: String(dow),
    dow_text: t(`pdicts.cal.dow.${dow}`),
    // У рабочей субботы без названия — «Рабочая суббота» (прототип holidayRows).
    name: x.name || t('dicts.platform.calendar.workday'),
    kind: x.kind,
    kind_text: t(`dicts.platform.calendar.${x.kind}`),
    rule,
    rule_text: t(`pdicts.cal.rule.${rule}`),
    created_at: x.audit.createdAt?.toISOString() ?? null,
    updated_at: x.audit.updatedAt.toISOString(),
    created_by: x.audit.createdBy,
    updated_by: x.audit.updatedBy,
  };
}

const RECORD_DEFS = [
  'id text',
  'ord integer',
  'date date',
  'dow text',
  'dow_text text',
  'name text',
  'kind text',
  'kind_text text',
  'rule text',
  'rule_text text',
  'created_at timestamptz',
  'updated_at timestamptz',
  'created_by text',
  'updated_by text',
].join(', ');

function recordset(rows: readonly ReturnType<typeof listRow>[]): SQL {
  return sql`jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as r(${sql.raw(RECORD_DEFS)})`;
}

/** Столбцы с кодом в значении: на экране и в сортировке — подпись. */
const TEXT_SHOWN = new Set(['dow', 'kind', 'rule']);

export function adminCalendarListColumns(): ListColumns {
  const columns: Record<string, ListColumn> = {};
  for (const c of ADMIN_CALENDAR_COLUMNS) {
    const column: ListColumn = { type: c.type, label: c.label, value: field(c.key) };
    if (TEXT_SHOWN.has(c.key)) {
      column.display = field(`${c.key}_text`);
      // День недели — по порядку недели, остальные — по подписи.
      column.sort =
        c.key === 'dow'
          ? { value: field('dow'), text: false }
          : { value: field(`${c.key}_text`), text: true };
    }
    columns[c.key] = column;
  }
  return {
    ...columns,
    createdAt: { type: 'datetime', label: 'grid.col.created_at', value: field('created_at') },
    updatedAt: { type: 'datetime', label: 'grid.col.updated_at', value: field('updated_at') },
    createdBy: { type: 'enum', label: 'grid.col.created_by', value: field('created_by') },
    updatedBy: { type: 'enum', label: 'grid.col.updated_by', value: field('updated_by') },
  };
}

const NATURAL = [field('ord')];

const sorted = (query: ListQuery): ListQuery =>
  query.sort === undefined ? { ...query, sort: ADMIN_CALENDAR_SORT } : query;

async function listSource(tx: Tx, t: ListTexts, today: IsoDate) {
  const days = await calendarDays(tx, today);
  return { days, source: recordset(days.map((x, i) => listRow(x, i + 1, t))) };
}

const fromOf =
  (tx: Tx, source: SQL): ListFrom =>
  (fields) =>
    tx.select(fields).from(source).$dynamic();

/**
 * Страница «Календаря»: поиск, фильтры, сортировка (по умолчанию — по дате) и группы — общим механизмом
 * списков. `nextFilled` — в следующем году уже есть переносы или плавающие праздники: иначе над списком
 * предупреждение (прототип).
 */
export async function listAdminCalendarPage(
  tx: Tx,
  query: ListQuery,
  t: ListTexts,
  today: IsoDate,
) {
  const { days, source } = await listSource(tx, t, today);
  const byId = new Map(days.map((x) => [`${x.date}|${x.key}`, x]));
  const [year, next] = calendarAdminYears(today);
  const page = await selectListPage({
    query: sorted(query),
    columns: adminCalendarListColumns(),
    natural: NATURAL,
    defaultSort: ADMIN_CALENDAR_SORT,
    scope: undefined,
    select: ({ window, where, orderBy, limit, offset }) =>
      tx
        .select({ id: sql<string>`${field('id')}`, ...window })
        .from(source)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset),
    from: fromOf(tx, source),
  });
  return {
    ...page,
    rows: page.rows.map((r) => byId.get(r.id)!),
    year,
    nextFilled: days.some((x) => !x.everyYear && x.date.startsWith(`${next}-`)),
  };
}

/** Значения столбца «Календаря» для фильтра-галочек; `q` — «Найти значение». */
export async function listAdminCalendarValues(
  tx: Tx,
  key: string,
  t: ListTexts,
  today: IsoDate,
  q?: string,
) {
  const { source } = await listSource(tx, t, today);
  return selectListValues({
    columns: adminCalendarListColumns(),
    key,
    scope: undefined,
    from: fromOf(tx, source),
    q,
  });
}

/** «Календарь» для выгрузки в Excel: все дни под поиском и фильтрами, столбцы `keys`. */
export async function exportAdminCalendar(
  tx: Tx,
  query: ListQuery,
  keys: readonly string[],
  t: ListTexts,
  today: IsoDate,
) {
  const { source } = await listSource(tx, t, today);
  return selectListExport({
    query: sorted(query),
    columns: adminCalendarListColumns(),
    keys,
    natural: NATURAL,
    defaultSort: ADMIN_CALENDAR_SORT,
    scope: undefined,
    from: fromOf(tx, source),
  });
}

/* ───────────── Правка ───────────── */

/**
 * Пересчёт сроков несданных отчётов после правки календаря (прототип recalcDues): отчётов организаций
 * ещё нет — пересчёт подключит задача отчётов (правило стыков, docs/decisions.md п. Д-3).
 */
async function recalcOpenReportDues(_tx: Tx): Promise<number> {
  return 0;
}

/** Вставка дня функцией базы: версия; 0 — день уже есть; null — не администратор. */
async function insertDay(tx: Tx, day: string, kind: CalendarDayKind, name: string) {
  const [row] = await tx.execute<{ version: number | null }>(
    sql`select app.admin_calendar_insert(${day}, ${kind}, ${name}) as version`,
  );
  return row?.version ?? null;
}

const createdHistory = (day: string, kind: CalendarDayKind, name: string) => ({
  entity: 'platform_dict' as const,
  entityId: entityId(day),
  action: 'create' as const,
  changes: [{ field: 'kind', to: kind }, ...(name ? [{ field: 'name', to: name }] : [])],
});

export type AdminCalendarAddResult =
  | { ok: true; recalculated: number }
  | { ok: false; reason: 'invalid'; problems: CalendarAddProblem[] }
  | { ok: false; reason: 'not_found' };

/**
 * «Нерабочий день» (прототип holidayDlg): праздник или перенос — на эту дату только в этом году,
 * рабочая суббота — без названия. Дата в годах вкладки, у рабочей субботы — суббота, дата ещё не занята
 * (`calendarAddProblems`); другой администратор успел добавить ту же дату — тоже «Эта дата уже есть».
 */
export async function adminCalendarAdd(
  tx: Tx,
  input: CalendarAddInput,
  today: IsoDate,
): Promise<AdminCalendarAddResult> {
  const entries = (await calendarRecords(tx)).map(entryOf);
  const problems = calendarAddProblems(input, entries, today);
  if (problems.length) return { ok: false, reason: 'invalid', problems };
  const kind = calendarAddKind(input.type, input.name);
  const name = kind === 'workday' ? '' : input.name.trim();
  const version = await insertDay(tx, input.date.trim(), kind, name);
  if (version === null) return { ok: false, reason: 'not_found' };
  if (version === 0) {
    return { ok: false, reason: 'invalid', problems: [{ field: 'date', code: 'date_taken' }] };
  }
  await writePlatformHistory(tx, createdHistory(input.date.trim(), kind, name));
  return { ok: true, recalculated: await recalcOpenReportDues(tx) };
}

export type AdminCalendarDeleteResult =
  | { ok: true; recalculated: number }
  | { ok: false; reason: 'not_found' | 'fixed' }
  /** Версия устарела: `version` — нынешняя. */
  | { ok: false; reason: 'changed'; version: number };

/**
 * «Удалить» день той версии, что видел администратор; государственный праздник «каждый год» удалить
 * нельзя — `fixed` (прототип). В историю — что удалено.
 */
export async function adminCalendarDelete(
  tx: Tx,
  key: string,
  version: number,
): Promise<AdminCalendarDeleteResult> {
  if (isEveryYear(key)) return { ok: false, reason: 'fixed' };
  const [before] = await tx
    .select()
    .from(productionCalendar)
    .where(eq(productionCalendar.day, key));
  if (!before) return { ok: false, reason: 'not_found' };
  if (before.version !== version) return { ok: false, reason: 'changed', version: before.version };
  const [row] = await tx.execute<{ deleted: boolean | null }>(
    sql`select app.admin_calendar_delete(${key}, ${version}) as deleted`,
  );
  if (row?.deleted == null) return { ok: false, reason: 'not_found' };
  // Другой администратор успел изменить или удалить день между чтением и удалением.
  if (!row.deleted) return { ok: false, reason: 'not_found' };
  await writePlatformHistory(tx, {
    entity: 'platform_dict',
    entityId: entityId(key),
    action: 'delete',
    changes: [
      { field: 'kind', from: before.kind },
      ...(before.name ? [{ field: 'name', from: before.name }] : []),
    ],
  });
  return { ok: true, recalculated: await recalcOpenReportDues(tx) };
}

/** Что скопирует «Календарь на следующий год копированием»: год, в который копируется, и дни. */
export async function adminCalendarCopyPlan(
  tx: Tx,
  today: IsoDate,
): Promise<{ year: number; items: CalendarCopyItem[] }> {
  const [year, next] = calendarAdminYears(today);
  const entries = (await calendarRecords(tx)).map(entryOf);
  return { year: next, items: calendarCopyPlan(entries, year) };
}

/**
 * «Календарь на следующий год копированием» (прототип calCopyDlg): дни «только в этом году» текущего
 * года — на ту же дату следующего; уже занятые даты не трогаются. Отвечает, сколько скопировано.
 */
export async function adminCalendarCopy(
  tx: Tx,
  today: IsoDate,
): Promise<{ ok: true; year: number; copied: number; recalculated: number } | { ok: false }> {
  const plan = await adminCalendarCopyPlan(tx, today);
  const history = [];
  for (const [i, x] of plan.items.entries()) {
    const version = await insertDay(tx, x.to, x.kind, x.name);
    // Пусто — в контексте не администратор: тогда уже первый день не записан. После записанных дней
    // так не бывает, но если случится — исключение откатывает всё копирование.
    if (version === null && i === 0) return { ok: false };
    if (version === null) throw new Error(`День ${x.to} не скопирован`);
    if (version > 0) history.push(createdHistory(x.to, x.kind, x.name));
  }
  await writePlatformHistory(tx, ...history);
  return {
    ok: true,
    year: plan.year,
    copied: history.length,
    recalculated: history.length ? await recalcOpenReportDues(tx) : 0,
  };
}

// ОТКЛОНЕНИЕ: docs/deviations.md#Д-6
/**
 * «История изменений» календаря (ТЗ: «История видна блоком «История изменений» под каждым
 * справочником»; в прототипе у календаря блока нет): последние записи, сначала новые, и сколько всего.
 * Код записи — день, подпись — название дня из самой записи (у удалённого дня — из записи удаления).
 */
export async function adminCalendarHistory(
  tx: Tx,
  limit: number,
): Promise<{ total: number; items: AdminDictHistoryItem[] }> {
  const where = and(
    eq(platformAuditLog.entity, 'platform_dict'),
    sql`starts_with(${platformAuditLog.entityId}, 'calendar:')`,
  );
  const [rows, [counted]] = await Promise.all([
    tx
      .select()
      .from(platformAuditLog)
      .where(where)
      .orderBy(desc(platformAuditLog.at), desc(platformAuditLog.id))
      .limit(limit),
    tx.select({ n: count() }).from(platformAuditLog).where(where),
  ]);
  return {
    total: counted?.n ?? 0,
    items: rows.map((r) => {
      const changes = (r.changes ?? []) as HistoryChange[];
      const name = changes.find((c) => c.field === 'name');
      return {
        id: String(r.id),
        at: r.at,
        actor: auditActorName(r.actorUserId, null),
        action: r.action,
        code: r.entityId.slice('calendar:'.length),
        label: String(name?.to ?? name?.from ?? ''),
        changes,
      };
    }),
  };
}
