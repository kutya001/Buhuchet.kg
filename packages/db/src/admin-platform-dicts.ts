import {
  ADMIN_DICT_COLUMNS,
  ADMIN_DICT_META,
  adminDictDefaultSort,
  auditActorName,
  dictValueProblems,
  nextDictCode,
  toHistoryValue,
  sameHistoryValue,
  UGNS_CONTRACTOR_TABLE,
  type AdminValueDict,
  type AuthorityContact,
  type BankKind,
  type DictUsage,
  type DictValueProblem,
  type HistoryChange,
  type HistoryValue,
  type ListQuery,
} from '@buhuchet/domain';
import { and, asc, count, desc, eq, getTableColumns, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
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
import {
  authorities,
  banks,
  dueChangeReasons,
  ownershipForms,
  platformAuditLog,
  taxOffices,
} from './schema';

/*
 * Админка → «Справочники платформы» (задача 2.36; ТЗ «Общие правила для всех справочников»; прототип
 * admin/platform-dicts.js, renderPDicts0): список значений справочника со столбцами «№»,
 * «Используется», «Статус» и служебными, и правка — добавить, изменить, «Выше»/«Ниже», отключить,
 * удалить неиспользуемое. Таблицы справочников роль приложения только читает: пишут функции
 * администратора платформы (`app.admin_dict_*`, миграция 0037) по перечню `app.platform_dict_specs`.
 * Все вызовы — в `withUserContext` администратора; «было → стало» — в историю платформы
 * (`platform_dict`, ключ `<справочник>:<код>`) в той же транзакции.
 */

/** Таблица справочника: общие столбцы справочников платформы (код, название, порядок, служебные). */
type DictTable = PgTable & {
  code: PgColumn;
  name: PgColumn;
  active: PgColumn;
  sortOrder: PgColumn;
  version: PgColumn;
};

const TABLES: Readonly<Record<AdminValueDict, DictTable>> = {
  forms: ownershipForms,
  organs: authorities,
  ugns: taxOffices,
  banks,
  reasons: dueChangeReasons,
};

/**
 * Поля значения сверх кода и названия — как в таблице (`contacts` — массив, `gnsCode` — null,
 * `byPhone` — да или нет).
 */
export type AdminDictData = Record<string, string | boolean | null | AuthorityContact[]>;

/** Значение справочника в Админке. */
export interface AdminDictValueRecord {
  code: string;
  /** «№» — место в порядке справочника; у справочника без порядка — null. */
  n: number | null;
  name: string;
  data: AdminDictData;
  active: boolean;
  usage: DictUsage;
  audit: {
    createdAt: Date | null;
    createdBy: string | null;
    updatedAt: Date;
    updatedBy: string | null;
  };
  version: number;
}

type TableRow = Record<string, unknown> & {
  code: string;
  name: string;
  active: boolean;
  version: number;
  createdAt: Date | null;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
};

/** Поля правки справочника без названия (`ADMIN_DICT_META.fields`). */
const dataFields = (dict: AdminValueDict) =>
  ADMIN_DICT_META[dict].fields.filter((f) => f !== 'name');

/**
 * Сколько раз используется каждое значение (`app.admin_dict_usage`): всего и у контрагентов —
 * ссылками из любых таблиц, в том числе организаций.
 */
export async function adminDictUsage(
  tx: Tx,
  dict: AdminValueDict,
): Promise<Map<string, DictUsage>> {
  const rows = await tx.execute<{ code: string; ref: string; n: number | string }>(
    sql`select code, ref, n from app.admin_dict_usage(${dict})`,
  );
  const usage = new Map<string, DictUsage>();
  for (const r of rows) {
    const u = usage.get(r.code) ?? { total: 0, contractors: 0 };
    const n = Number(r.n);
    u.total += n;
    if (r.ref === UGNS_CONTRACTOR_TABLE) u.contractors += n;
    usage.set(r.code, u);
  }
  return usage;
}

const NO_USAGE: DictUsage = { total: 0, contractors: 0 };

/** Все значения справочника в его порядке (`sort_order`, при равных — код), с «№» и «Используется». */
async function dictRecords(tx: Tx, dict: AdminValueDict): Promise<AdminDictValueRecord[]> {
  const table = TABLES[dict];
  const [rows, usage] = await Promise.all([
    tx.select().from(table).orderBy(asc(table.sortOrder), asc(table.code)) as unknown as Promise<
      TableRow[]
    >,
    adminDictUsage(tx, dict),
  ]);
  const ordered = ADMIN_DICT_META[dict].ordered;
  return rows.map((r, i) => {
    const createdBy = auditActorName(r.createdBy, null);
    return {
      code: r.code,
      n: ordered ? i + 1 : null,
      name: r.name,
      data: Object.fromEntries(
        dataFields(dict).map((f) => [f, (r[f] ?? null) as AdminDictData[string]]),
      ),
      active: r.active,
      usage: usage.get(r.code) ?? NO_USAGE,
      audit: {
        createdAt: r.createdAt,
        createdBy,
        updatedAt: r.updatedAt,
        updatedBy: auditActorName(r.updatedBy, null) ?? createdBy,
      },
      version: r.version,
    };
  });
}

/* ───────────── Список ───────────── */

/** Столбец строки из `jsonb_to_recordset`: ключи — постоянные имена столбцов, не ввод пользователя. */
const field = (key: string) => sql.raw(`"r"."${key}"`);

/** Телефоны органа одной строкой: «Колл-центр: 1202; Приёмная: …». */
const contactsText = (value: unknown) =>
  Array.isArray(value)
    ? (value as AuthorityContact[]).map((c) => `${c.label}: ${c.value}`).join('; ')
    : '';

/** Строка списка для `jsonb_to_recordset`: тексты столбцов, подписи кодов и служебные поля. */
function listRow(dict: AdminValueDict, x: AdminDictValueRecord, ord: number, t: ListTexts) {
  const row: Record<string, string | number | null> = {
    id: x.code,
    ord,
    n: x.n,
    code: x.code,
    name: x.name,
    used: x.usage.total,
    contractors: x.usage.contractors,
    active: x.active ? 'on' : 'off',
    active_text: t(x.active ? 'pdicts.status.on' : 'pdicts.status.off'),
    created_at: x.audit.createdAt?.toISOString() ?? null,
    updated_at: x.audit.updatedAt.toISOString(),
    created_by: x.audit.createdBy,
    updated_by: x.audit.updatedBy,
  };
  for (const f of dataFields(dict)) {
    const value = x.data[f];
    if (f === 'contacts') row[f] = contactsText(value);
    else if (f === 'byPhone') row[f] = value ? 'yes' : 'no';
    else row[f] = (value as string | null) ?? '';
  }
  if (dict === 'forms') row.declarationFor_text = t(`dicts.platform.end.${x.data.declarationFor}`);
  if (dict === 'banks') {
    row.kind_text = t(`pdicts.bank.kind.${x.data.kind as BankKind}`);
    row.byPhone_text = t(x.data.byPhone ? 'pdicts.bank.by_phone.yes' : 'pdicts.bank.by_phone.no');
  }
  return row;
}

const RECORD_TYPES: Readonly<Record<string, string>> = {
  ord: 'integer',
  n: 'integer',
  used: 'integer',
  contractors: 'integer',
  created_at: 'timestamptz',
  updated_at: 'timestamptz',
};

/** Строки — одним параметром запроса. */
function recordset(rows: readonly Record<string, string | number | null>[]) {
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const defs = keys.map((k) => `"${k}" ${RECORD_TYPES[k] ?? 'text'}`).join(', ');
  return sql`jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as r(${sql.raw(defs || 'id text')})`;
}

/** Столбцы с кодом в значении (фильтр по коду), на экране и в сортировке — подпись (`<ключ>_text`). */
const TEXT_SHOWN = new Set(['active', 'declarationFor', 'kind', 'byPhone']);

/** Столбцы списка справочника на сервере — ключи и подписи, как у экрана (`ADMIN_DICT_COLUMNS`). */
export function adminDictListColumns(dict: AdminValueDict): ListColumns {
  const columns: Record<string, ListColumn> = {};
  for (const c of ADMIN_DICT_COLUMNS[dict]) {
    const column: ListColumn = { type: c.type, label: c.label, value: field(c.key) };
    if (TEXT_SHOWN.has(c.key)) {
      column.display = field(`${c.key}_text`);
      column.sort = { value: field(`${c.key}_text`), text: true };
    }
    if (c.key === 'gnsCode') column.display = sql`coalesce(nullif(${field('gnsCode')}, ''), '—')`;
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

/** Без выбранной сортировки — порядок справочника или регион (как в прототипе), не «Создано». */
const naturalQuery = (dict: AdminValueDict, query: ListQuery): ListQuery =>
  query.sort === undefined ? { ...query, sort: adminDictDefaultSort(dict) } : query;

async function listSource(tx: Tx, dict: AdminValueDict, t: ListTexts) {
  const records = await dictRecords(tx, dict);
  const source = recordset(records.map((x, i) => listRow(dict, x, i + 1, t)));
  return { records, source };
}

const fromOf =
  (tx: Tx, source: SQL): ListFrom =>
  (fields) =>
    tx.select(fields).from(source).$dynamic();

/** Страница списка справочника: поиск, фильтры, сортировка и группы — общим механизмом списков. */
export async function listAdminDictPage(
  tx: Tx,
  dict: AdminValueDict,
  query: ListQuery,
  t: ListTexts,
) {
  const { records, source } = await listSource(tx, dict, t);
  const byCode = new Map(records.map((x) => [x.code, x]));
  const page = await selectListPage({
    query: naturalQuery(dict, query),
    columns: adminDictListColumns(dict),
    natural: NATURAL,
    defaultSort: adminDictDefaultSort(dict),
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
  return { ...page, rows: page.rows.map((r) => byCode.get(r.id)!), count: records.length };
}

/** Значения столбца справочника для фильтра-галочек; `q` — «Найти значение». */
export async function listAdminDictValues(
  tx: Tx,
  dict: AdminValueDict,
  key: string,
  t: ListTexts,
  q?: string,
) {
  const { source } = await listSource(tx, dict, t);
  return selectListValues({
    columns: adminDictListColumns(dict),
    key,
    scope: undefined,
    from: fromOf(tx, source),
    q,
  });
}

/** Справочник для выгрузки в Excel: все значения под поиском и фильтрами, столбцы `keys`. */
export async function exportAdminDict(
  tx: Tx,
  dict: AdminValueDict,
  query: ListQuery,
  keys: readonly string[],
  t: ListTexts,
) {
  const { source } = await listSource(tx, dict, t);
  return selectListExport({
    query: naturalQuery(dict, query),
    columns: adminDictListColumns(dict),
    keys,
    natural: NATURAL,
    defaultSort: adminDictDefaultSort(dict),
    scope: undefined,
    from: fromOf(tx, source),
  });
}

/** Одно значение справочника с «№» и «Используется»; нет такого — null. */
export async function getAdminDictValue(
  tx: Tx,
  dict: AdminValueDict,
  code: string,
): Promise<AdminDictValueRecord | null> {
  return (await dictRecords(tx, dict)).find((x) => x.code === code) ?? null;
}

/* ───────────── Правка ───────────── */

/** Поля значения из формы: название и поля справочника (`ADMIN_DICT_META.fields`). */
export interface AdminDictInput {
  name: string;
  data: AdminDictData;
}

/**
 * Поля для функции базы: имена столбцов таблицы, строки без пробелов по краям, пустой код ГНС — null,
 * «Переводы по номеру телефона» — да или нет, тип провайдера по умолчанию — банк.
 */
function dbRow(dict: AdminValueDict, input: AdminDictInput): Record<string, unknown> {
  const columns = getTableColumns(TABLES[dict]) as Record<string, PgColumn>;
  const value = (f: string): unknown => {
    if (f === 'name') return input.name.trim();
    const v = input.data[f];
    if (f === 'contacts') {
      return (Array.isArray(v) ? v : [])
        .map((c) => ({ label: c.label.trim(), value: c.value.trim() }))
        .filter((c) => c.label || c.value);
    }
    if (f === 'byPhone') return v === true;
    const text = typeof v === 'string' ? v.trim() : '';
    if (f === 'gnsCode') return text || null;
    if (f === 'kind') return text || 'bank';
    return text;
  };
  return Object.fromEntries(ADMIN_DICT_META[dict].fields.map((f) => [columns[f]!.name, value(f)]));
}

/** Поля значения для истории: название и поля справочника, как их сохранит база. */
function historyFields(dict: AdminValueDict, input: AdminDictInput): Record<string, HistoryValue> {
  const columns = getTableColumns(TABLES[dict]) as Record<string, PgColumn>;
  const row = dbRow(dict, input);
  return Object.fromEntries(
    ADMIN_DICT_META[dict].fields.map((f) => [f, toHistoryValue(row[columns[f]!.name])]),
  );
}

const recordInput = (x: AdminDictValueRecord): AdminDictInput => ({ name: x.name, data: x.data });

export type AdminDictSaveResult =
  | { ok: true; record: AdminDictValueRecord }
  | { ok: false; reason: 'not_found' | 'changed' }
  | { ok: false; reason: 'taken'; problems: DictValueProblem[] }
  | { ok: false; reason: 'used'; usage: DictUsage };

const entityId = (dict: AdminValueDict, code: string) => `${dict}:${code}`;

/** Повтор названия или кода ГНС среди значений справочника. */
function problemsOf(
  dict: AdminValueDict,
  code: string,
  input: AdminDictInput,
  records: readonly AdminDictValueRecord[],
): DictValueProblem[] {
  const gns = (x: AdminDictInput) =>
    dict === 'ugns' ? ((x.data.gnsCode as string) ?? null) : null;
  return dictValueProblems(
    { code, name: input.name, gnsCode: gns(input) },
    records.map((x) => ({ code: x.code, name: x.name, gnsCode: gns(recordInput(x)) })),
  );
}

/**
 * «+ Добавить» → «Значение» (прототип valueDlg, ugnsDlg): новое значение действующее, в конце
 * порядка, с кодом `nextDictCode`; повтор названия («Такое значение уже есть») или кода ГНС («Такой
 * код уже есть») — `taken`. Создание и поля — в историю.
 */
export async function adminDictCreate(
  tx: Tx,
  dict: AdminValueDict,
  input: AdminDictInput,
  random: () => string,
): Promise<AdminDictSaveResult> {
  const records = await dictRecords(tx, dict);
  const code = nextDictCode(
    dict,
    records.map((x) => x.code),
    random,
    input.data.kind === 'wallet' ? 'wallet' : 'bank',
  );
  const problems = problemsOf(dict, code, input, records);
  if (problems.length) return { ok: false, reason: 'taken', problems };
  const [row] = await tx.execute<{ version: number | null }>(
    sql`select app.admin_dict_insert(${dict}, ${code}, ${JSON.stringify(dbRow(dict, input))}::jsonb) as version`,
  );
  // Пусто — в контексте не администратор: права проверил вызывающий (`requirePlatformAdmin`).
  if (row?.version == null) return { ok: false, reason: 'not_found' };
  const fields = historyFields(dict, input);
  await writePlatformHistory(tx, {
    entity: 'platform_dict',
    entityId: entityId(dict, code),
    action: 'create',
    changes: Object.entries(fields)
      .filter(([, to]) => to !== '' && to !== null && !(Array.isArray(to) && !to.length))
      .map(([f, to]) => ({ field: f, to })),
  });
  const created = await getAdminDictValue(tx, dict, code);
  return created ? { ok: true, record: created } : { ok: false, reason: 'not_found' };
}

/**
 * «Изменить» / «Переименовать» (прототип valueDlg «Новое название увидят все организации, в том числе
 * в старых записях»): записи ссылаются на код, поэтому новое название сразу видно везде. Без изменений —
 * без новой версии и записи в историю; устаревшая версия — `changed`.
 */
export async function adminDictUpdate(
  tx: Tx,
  dict: AdminValueDict,
  code: string,
  input: AdminDictInput,
  version: number,
): Promise<AdminDictSaveResult> {
  const records = await dictRecords(tx, dict);
  const before = records.find((x) => x.code === code);
  if (!before) return { ok: false, reason: 'not_found' };
  if (before.version !== version) return { ok: false, reason: 'changed' };
  const was = historyFields(dict, recordInput(before));
  const now = historyFields(dict, input);
  const changes: HistoryChange[] = ADMIN_DICT_META[dict].fields
    .filter((f) => !sameHistoryValue(was[f] ?? null, now[f] ?? null))
    .map((f) => ({ field: f, from: was[f] ?? null, to: now[f] ?? null }));
  if (!changes.length) return { ok: true, record: before };
  const problems = problemsOf(dict, code, input, records);
  if (problems.length) return { ok: false, reason: 'taken', problems };
  const [row] = await tx.execute<{ version: number | null }>(
    sql`select app.admin_dict_update(${dict}, ${code}, ${JSON.stringify(dbRow(dict, input))}::jsonb, ${version}) as version`,
  );
  if (row?.version == null) return { ok: false, reason: 'changed' };
  await writePlatformHistory(tx, {
    entity: 'platform_dict',
    entityId: entityId(dict, code),
    action: 'update',
    changes,
  });
  const after = await getAdminDictValue(tx, dict, code);
  return after ? { ok: true, record: after } : { ok: false, reason: 'not_found' };
}

/**
 * «Отключить» / «Включить»: отключённое не предлагается в новых записях, в старых остаётся. То же
 * состояние — без новой версии.
 */
export async function adminDictSetActive(
  tx: Tx,
  dict: AdminValueDict,
  code: string,
  active: boolean,
  version: number,
): Promise<AdminDictSaveResult> {
  const before = await getAdminDictValue(tx, dict, code);
  if (!before) return { ok: false, reason: 'not_found' };
  if (before.version !== version) return { ok: false, reason: 'changed' };
  if (before.active === active) return { ok: true, record: before };
  const [row] = await tx.execute<{ version: number | null }>(
    sql`select app.admin_dict_set_active(${dict}, ${code}, ${active}, ${version}) as version`,
  );
  if (row?.version == null) return { ok: false, reason: 'changed' };
  await writePlatformHistory(tx, {
    entity: 'platform_dict',
    entityId: entityId(dict, code),
    action: 'update',
    changes: [{ field: 'active', from: before.active, to: active }],
  });
  const after = await getAdminDictValue(tx, dict, code);
  return after ? { ok: true, record: after } : { ok: false, reason: 'not_found' };
}

/**
 * «Выше» (`step` −1) и «Ниже» (1): место с соседним; в историю — «перемещено с № i на № j». У первого
 * «Выше» и у последнего «Ниже» нет (на экране кнопка недоступна) — `not_found`, как и у справочника
 * без порядка.
 */
export async function adminDictMove(
  tx: Tx,
  dict: AdminValueDict,
  code: string,
  step: -1 | 1,
  version: number,
): Promise<AdminDictSaveResult> {
  if (!ADMIN_DICT_META[dict].ordered) return { ok: false, reason: 'not_found' };
  const records = await dictRecords(tx, dict);
  const before = records.find((x) => x.code === code);
  if (!before?.n) return { ok: false, reason: 'not_found' };
  if (before.version !== version) return { ok: false, reason: 'changed' };
  const to = before.n + step;
  if (to < 1 || to > records.length) return { ok: false, reason: 'not_found' };
  const [row] = await tx.execute<{ version: number | null }>(
    sql`select app.admin_dict_move(${dict}, ${code}, ${step}, ${version}) as version`,
  );
  if (row?.version == null) return { ok: false, reason: 'changed' };
  await writePlatformHistory(tx, {
    entity: 'platform_dict',
    entityId: entityId(dict, code),
    action: 'update',
    changes: [{ field: 'n', from: before.n, to }],
  });
  const after = await getAdminDictValue(tx, dict, code);
  return after ? { ok: true, record: after } : { ok: false, reason: 'not_found' };
}

export type AdminDictDeleteResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'changed' }
  | { ok: false; reason: 'used'; usage: DictUsage };

/** Ошибка базы «значение используется» (23503): внешний ключ или отказ `app.admin_dict_delete`. */
function isForeignKeyViolation(err: unknown): boolean {
  const cause = (err as { cause?: { code?: string } })?.cause ?? err;
  return (cause as { code?: string })?.code === '23503';
}

/**
 * «Удалить» — только значение, которое нигде не используется (ТЗ: используемое — только отключить);
 * используется — `used` с числом записей. Ссылку могли сохранить между проверкой и удалением — тогда
 * отказ базы, и тоже `used` с новым числом. В историю — что удалено (название, у УГНС — код и кратко).
 */
export async function adminDictDelete(
  tx: Tx,
  dict: AdminValueDict,
  code: string,
  version: number,
): Promise<AdminDictDeleteResult> {
  const before = await getAdminDictValue(tx, dict, code);
  if (!before) return { ok: false, reason: 'not_found' };
  if (before.version !== version) return { ok: false, reason: 'changed' };
  if (before.usage.total > 0) return { ok: false, reason: 'used', usage: before.usage };
  let deleted: boolean | null | undefined;
  try {
    // Точка сохранения: после отказа базы транзакция остаётся рабочей, чтобы пересчитать «Используется».
    deleted = await tx.transaction(async (sp) => {
      const [row] = await sp.execute<{ deleted: boolean | null }>(
        sql`select app.admin_dict_delete(${dict}, ${code}, ${version}) as deleted`,
      );
      return row?.deleted;
    });
  } catch (err) {
    if (!isForeignKeyViolation(err)) throw err;
    const now = await getAdminDictValue(tx, dict, code);
    return { ok: false, reason: 'used', usage: now?.usage ?? before.usage };
  }
  if (!deleted) return { ok: false, reason: 'changed' };
  const fields = historyFields(dict, recordInput(before));
  const kept = dict === 'ugns' ? ['name', 'shortName', 'gnsCode'] : ['name'];
  await writePlatformHistory(tx, {
    entity: 'platform_dict',
    entityId: entityId(dict, code),
    action: 'delete',
    changes: kept.map((f) => ({ field: f, from: fields[f] ?? null })),
  });
  return { ok: true };
}

/**
 * Значение уже есть (уникальный индекс названия или кода ГНС): другой администратор успел сохранить
 * такое же между проверкой и записью. Поле формы — по имени индекса; иначе null.
 */
export function dictValueTakenField(err: unknown): 'name' | 'gnsCode' | null {
  const cause = (err as { cause?: { code?: string; constraint?: string } })?.cause ?? err;
  const db = cause as { code?: string; constraint?: string };
  if (db?.code !== '23505') return null;
  if (db.constraint === 'tax_offices_gns_code_key') return 'gnsCode';
  return db.constraint?.endsWith('_name_key') ? 'name' : null;
}

/* ───────────── История ───────────── */

/** Запись «Истории изменений» справочника: код и подпись значения, что изменилось. */
export interface AdminDictHistoryItem {
  id: string;
  at: Date;
  actor: string | null;
  action: string;
  code: string;
  /** Как значение называлось: название, у УГНС — «код кратко»; у удалённого — из записи удаления. */
  label: string;
  changes: HistoryChange[];
}

/** Подпись значения: у УГНС — «002 Ленинский р-н, Бишкек» (прототип pdLog), у остальных — название. */
function labelOf(dict: AdminValueDict, fields: Record<string, HistoryValue | undefined>): string {
  const text = (v: HistoryValue | undefined) => (typeof v === 'string' ? v : '');
  if (dict === 'ugns')
    return [text(fields.gnsCode), text(fields.shortName)].filter(Boolean).join(' ');
  return text(fields.name);
}

/**
 * «История изменений · N» под справочником (прототип pdHistHtml): последние `limit` записей, сначала
 * новые, и сколько их всего. Подпись у добавления и удаления — из самой записи, у правки — нынешняя.
 */
export async function adminDictHistory(
  tx: Tx,
  dict: AdminValueDict,
  limit: number,
): Promise<{ total: number; items: AdminDictHistoryItem[] }> {
  const where = and(
    eq(platformAuditLog.entity, 'platform_dict'),
    sql`starts_with(${platformAuditLog.entityId}, ${`${dict}:`})`,
  );
  const [rows, [counted], records] = await Promise.all([
    tx
      .select()
      .from(platformAuditLog)
      .where(where)
      .orderBy(desc(platformAuditLog.at), desc(platformAuditLog.id))
      .limit(limit),
    tx.select({ n: count() }).from(platformAuditLog).where(where),
    dictRecords(tx, dict),
  ]);
  const labels = new Map(
    records.map((x) => [x.code, labelOf(dict, historyFields(dict, recordInput(x)))]),
  );
  return {
    total: counted?.n ?? 0,
    items: rows.map((r) => {
      const code = r.entityId.slice(dict.length + 1);
      const changes = (r.changes ?? []) as HistoryChange[];
      const own = Object.fromEntries(changes.map((c) => [c.field, c.from ?? c.to]));
      return {
        id: String(r.id),
        at: r.at,
        actor: auditActorName(r.actorUserId, null),
        action: r.action,
        code,
        label: (r.action === 'update' ? labels.get(code) : labelOf(dict, own)) || code,
        changes,
      };
    }),
  };
}
