import {
  ADMIN_DICT_META,
  ADMIN_VALUE_DICTS,
  auditActorName,
  type AdminValueDict,
  type IoRef,
  type IoRefs,
  type IoValue,
  type ListQuery,
} from '@buhuchet/domain';
import { and, asc, count, eq, isNull, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { Tx } from './client';
import {
  adminDictDelete,
  adminDictRecords,
  adminDictSetActive,
  adminDictUpdate,
  type AdminDictDeleteResult,
  type AdminDictSaveResult,
} from './admin-platform-dicts';
import {
  auditActorValue,
  selectListExport,
  selectListPage,
  selectListValues,
  type ListColumns,
  type ListFrom,
  type ListPageResult,
  type ListTexts,
} from './list';
import { writePlatformHistory } from './platform-history';
import {
  authorities,
  dictLoads,
  reportBases,
  reportTypes,
  taxOffices,
  taxRegimes,
  type DictLoadAdded,
  type DictLoadBefore,
  type DictLoadState,
} from './schema';
import { textLiteral } from './sql-text';

/*
 * Админка → «Справочники платформы» → «Выгрузить» и «Загрузить» (задача 2.37; ТЗ «Выгрузка и загрузка
 * справочников»; прототип admin/platform-dicts-io.js): значения справочника для файла, подписи ссылок
 * («Орган», «Применимые режимы», «Виды отчётов»…), запись загрузки и её откат («Загрузки»). Столбцы
 * файла, разбор и сравнение — `@buhuchet/domain` (`IO_COLUMNS`, `parseIoRows`, `ioChanges`); проверка и
 * запись значений — те же функции, что у окна правки (`adminDictCreate`, `adminDictUpdate`). Всё — в
 * `withUserContext` администратора платформы.
 */

export type { DictLoadAdded, DictLoadBefore, DictLoadState };

/** Значение справочника для файла и сравнения — и его версия. */
export interface IoRecord extends IoValue {
  version: number;
}

/** Значения справочника в его порядке — для выгрузки и сравнения с файлом. */
export async function ioRecords(tx: Tx, dict: AdminValueDict): Promise<IoRecord[]> {
  return (await adminDictRecords(tx, dict)).map((x) => ({
    code: x.code,
    name: x.name,
    active: x.active,
    data: x.data,
    version: x.version,
  }));
}

/**
 * Подписи ссылок в файле: органы, режимы и основания — названием, виды отчётов и УГНС — кратким
 * названием; узнаются и код, и другие написания (полное название, код ГНС). Подпись, которая есть у
 * двух значений (у видов отчётов краткие названия форм Нацстаткома повторяются: «1-Т», «2-инвест»), —
 * кодом, иначе загрузка не поймёт, какое значение имелось в виду.
 */
export async function ioRefs(tx: Tx): Promise<IoRefs> {
  const [organs, regimes, bases, types, ugns] = await Promise.all([
    tx
      .select({ code: authorities.code, label: authorities.name })
      .from(authorities)
      .orderBy(asc(authorities.sortOrder), asc(authorities.code)),
    tx
      .select({ code: taxRegimes.code, label: taxRegimes.name, full: taxRegimes.fullName })
      .from(taxRegimes)
      .orderBy(asc(taxRegimes.sortOrder), asc(taxRegimes.code)),
    tx
      .select({ code: reportBases.code, label: reportBases.name })
      .from(reportBases)
      .orderBy(asc(reportBases.sortOrder), asc(reportBases.code)),
    tx
      .select({ code: reportTypes.code, label: reportTypes.shortName, name: reportTypes.name })
      .from(reportTypes)
      .orderBy(asc(reportTypes.sortOrder), asc(reportTypes.code)),
    tx
      .select({
        code: taxOffices.code,
        label: taxOffices.shortName,
        name: taxOffices.name,
        gns: taxOffices.gnsCode,
      })
      .from(taxOffices)
      .orderBy(asc(taxOffices.sortOrder), asc(taxOffices.code)),
  ]);
  return {
    organs: uniqueLabels(organs.map((x) => ({ code: x.code, label: x.label }))),
    regimes: uniqueLabels(regimes.map((x) => ({ code: x.code, label: x.label, alt: [x.full] }))),
    bases: uniqueLabels(bases.map((x) => ({ code: x.code, label: x.label }))),
    types: uniqueLabels(types.map((x) => ({ code: x.code, label: x.label, alt: [x.name] }))),
    ugns: uniqueLabels(
      ugns.map((x) => ({ code: x.code, label: x.label, alt: [x.name, ...(x.gns ? [x.gns] : [])] })),
    ),
  };
}

/**
 * Подпись, которая повторяется, — кодом значения (ОТКЛОНЕНИЕ: docs/deviations.md#Д-16); сама подпись
 * остаётся другим написанием: по ней загрузка ответит «есть у нескольких значений — укажите код».
 */
function uniqueLabels(refs: IoRef[]): IoRef[] {
  const seen = new Map<string, number>();
  for (const r of refs) {
    const key = r.label.trim().toLowerCase();
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return refs.map((r) =>
    (seen.get(r.label.trim().toLowerCase()) ?? 0) > 1
      ? { ...r, label: r.code, alt: [r.label, ...(r.alt ?? [])] }
      : r,
  );
}

/* ───────────── Загрузки ───────────── */

/** Загрузка справочника: сколько строк, что сделано, кто и когда; откат — кто и когда. */
export interface DictLoadRecord {
  id: string;
  dict: AdminValueDict;
  rows: number;
  added: number;
  changed: number;
  disabled: number;
  errors: number;
  at: Date;
  by: string | null;
  rolledBackAt: Date | null;
  rolledBackBy: string | null;
  /** Последняя не откаченная загрузка: откатить можно только её. */
  last: boolean;
}

/** Что записать о загрузке: числа, значения до неё и добавленные. */
export interface DictLoadInput {
  dict: AdminValueDict;
  rows: number;
  errors: number;
  changed: number;
  disabled: number;
  before: DictLoadBefore[];
  added: DictLoadAdded[];
}

const historyId = (dict: AdminValueDict) => `${dict}:`;

/**
 * Запись «Загрузок» (прототип: `PD_LOADS.push`, `pdLog(… загрузка из Excel — добавлено N, изменено N,
 * отключено N)`) и строка «Истории изменений» справочника — в той же транзакции, что и правка значений.
 */
export async function insertDictLoad(tx: Tx, input: DictLoadInput): Promise<string> {
  const [row] = await tx
    .insert(dictLoads)
    .values({
      dict: input.dict,
      rows: input.rows,
      added: input.added.length,
      changed: input.changed,
      disabled: input.disabled,
      errors: input.errors,
      before: input.before,
      addedValues: input.added,
    })
    .returning({ id: dictLoads.id });
  await writePlatformHistory(tx, {
    entity: 'platform_dict',
    entityId: historyId(input.dict),
    action: 'import',
    changes: [
      { field: 'added', to: input.added.length },
      { field: 'changed', to: input.changed },
      { field: 'disabled', to: input.disabled },
    ],
  });
  return row!.id;
}

const l = dictLoads;

/** Последняя не откаченная загрузка (по всем справочникам): откатить можно только её (прототип). */
const LAST: SQL = sql`${l.id} = (select ${l.id} from ${l} where ${l.rolledBackAt} is null order by ${l.createdAt} desc, ${l.id} desc limit 1)`;

const BY = auditActorValue(l.createdBy, sql`null::text`);

/** Порядок кодов для сортировки и подпись по словарю — как у «Запросов». */
const dictLabel = (t: ListTexts) =>
  sql`case ${l.dict} ${sql.join(
    ADMIN_VALUE_DICTS.map((d) => sql`when ${textLiteral(d)} then ${t(`pdicts.title.${d}`)}`),
    sql` `,
  )} else ${l.dict} end`;
const dictOrder = sql`case ${l.dict} ${sql.join(
  ADMIN_VALUE_DICTS.map((d, i) => sql`when ${textLiteral(d)} then ${sql.raw(String(i))}`),
  sql` `,
)} end`;

/** Статус загрузки: «Последняя», «Применена», «Откачена» (прототип renderLoads). */
const STATUS: SQL = sql`case when ${l.rolledBackAt} is not null then 'rolled' when ${LAST} then 'last' else 'applied' end`;
const LOAD_STATUSES = ['last', 'applied', 'rolled'] as const;

const statusLabel = (t: ListTexts) =>
  sql`case ${STATUS} ${sql.join(
    LOAD_STATUSES.map((s) => sql`when ${textLiteral(s)} then ${t(`pdicts.loads.status.${s}`)}`),
    sql` `,
  )} end`;

const int = (column: AnyColumn, label: string) => ({ type: 'int' as const, label, value: column });

/**
 * Столбцы «Загрузок» (прототип renderLoads): «Когда», «Справочник», «Кто», «Строк», «Добавлено»,
 * «Изменено», «Отключено», «Ошибок», «Статус».
 */
export function dictLoadListColumns(t: ListTexts): ListColumns {
  return {
    at: { type: 'datetime', label: 'pdicts.loads.col.at', value: l.createdAt },
    dict: {
      type: 'enum',
      label: 'pdicts.loads.col.dict',
      value: l.dict,
      display: dictLabel(t),
      sort: { value: dictOrder, text: false },
    },
    by: { type: 'enum', label: 'pdicts.loads.col.by', value: BY },
    rows: int(l.rows, 'pdicts.loads.col.rows'),
    added: int(l.added, 'pdicts.loads.col.added'),
    changed: int(l.changed, 'pdicts.loads.col.changed'),
    disabled: int(l.disabled, 'pdicts.loads.col.disabled'),
    errors: int(l.errors, 'pdicts.loads.col.errors'),
    status: {
      type: 'enum',
      label: 'pdicts.loads.col.status',
      value: STATUS,
      display: statusLabel(t),
      sort: {
        value: sql`case ${STATUS} when 'last' then 0 when 'applied' then 1 else 2 end`,
        text: false,
      },
    },
    createdAt: { type: 'datetime', label: 'grid.col.created_at', value: l.createdAt },
    createdBy: { type: 'enum', label: 'grid.col.created_by', value: BY },
  };
}

const fields = {
  id: l.id,
  dict: l.dict,
  rows: l.rows,
  added: l.added,
  changed: l.changed,
  disabled: l.disabled,
  errors: l.errors,
  createdAt: l.createdAt,
  createdBy: l.createdBy,
  rolledBackAt: l.rolledBackAt,
  rolledBackBy: l.rolledBackBy,
  last: sql<boolean>`${LAST}`,
};

type Row = { [K in keyof typeof fields]: unknown };

function toRecord(r: Row): DictLoadRecord {
  return {
    id: r.id as string,
    dict: r.dict as AdminValueDict,
    rows: r.rows as number,
    added: r.added as number,
    changed: r.changed as number,
    disabled: r.disabled as number,
    errors: r.errors as number,
    at: r.createdAt as Date,
    by: auditActorName(r.createdBy as string, null),
    rolledBackAt: (r.rolledBackAt as Date | null) ?? null,
    rolledBackBy: auditActorName((r.rolledBackBy as string | null) ?? null, null),
    last: r.last === true,
  };
}

const NATURAL = [l.createdAt, l.id];

const loadsFrom =
  (tx: Tx): ListFrom =>
  (f) =>
    tx.select(f).from(l).$dynamic();

/** Страница «Загрузок»: по умолчанию — сначала новые. */
export async function listDictLoadsPage(
  tx: Tx,
  query: ListQuery,
  t: ListTexts,
): Promise<ListPageResult<DictLoadRecord>> {
  const page = await selectListPage({
    query,
    columns: dictLoadListColumns(t),
    natural: NATURAL,
    scope: undefined,
    select: ({ window, where, orderBy, limit, offset }) =>
      tx
        .select({ ...fields, ...window })
        .from(l)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset),
    from: loadsFrom(tx),
  });
  return { ...page, rows: page.rows.map((r) => toRecord(r as Row)) };
}

/** Значения столбца «Загрузок» для фильтра-галочек. */
export function listDictLoadValues(tx: Tx, key: string, t: ListTexts, q?: string) {
  return selectListValues({
    columns: dictLoadListColumns(t),
    key,
    scope: undefined,
    from: loadsFrom(tx),
    q,
  });
}

/** «Загрузки» для выгрузки в Excel. */
export function exportDictLoads(tx: Tx, query: ListQuery, keys: readonly string[], t: ListTexts) {
  return selectListExport({
    query,
    columns: dictLoadListColumns(t),
    keys,
    natural: NATURAL,
    scope: undefined,
    from: loadsFrom(tx),
  });
}

/* ───────────── Откат ───────────── */

/** JSON с ключами по алфавиту: поля значения сравниваются без учёта порядка ключей. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

/**
 * Значение не меняли после загрузки: та же версия или тот же вид, что сразу после неё (версию поднял
 * откат следующей загрузки, вернув значение к этому виду).
 */
function unchangedSince(
  now: { version: number; name: string; active: boolean; data: unknown },
  loaded: { version: number; after: DictLoadState },
): boolean {
  if (now.version === loaded.version) return true;
  const { name, active, data } = loaded.after;
  return now.name === name && now.active === active && stableJson(now.data) === stableJson(data);
}

/** Отказ функции правки при откате. */
type RollbackStepFailure = Extract<AdminDictSaveResult | AdminDictDeleteResult, { ok: false }>;

export type DictLoadRollbackResult =
  | { ok: true; load: DictLoadRecord }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'not_last' }
  /** Значение изменили или удалили после загрузки: откат затёр бы эту правку. */
  | { ok: false; reason: 'changed_after'; code: string; name: string }
  /** Прежнее значение не сохраняется (связь отключили, название заняли) или не убирается добавленное. */
  | {
      ok: false;
      reason: 'restore_failed';
      code: string;
      name: string;
      result: RollbackStepFailure;
    };

/**
 * «Откатить» последнюю загрузку (прототип rollbackLoad): сначала убираются добавленные значения
 * (удаляются, а используемые и неудаляемые — отключаются), затем изменённые и отключённые возвращаются
 * к виду до неё — так прежнее название, которое загрузка отдала новому значению, снова свободно.
 * Значение, изменённое или удалённое после загрузки, откат не трогает: отказ с его названием
 * (ОТКЛОНЕНИЕ: docs/deviations.md#Д-15). В историю — строки значений и «загрузка от … откачена».
 * Отказ может прийти после части записей: вызывающий обязан откатить транзакцию (бросить исключение),
 * тогда справочник не меняется.
 */
export async function rollbackDictLoad(tx: Tx, id: string): Promise<DictLoadRollbackResult> {
  await lockDictLoads(tx);
  const [load] = await tx
    .select({ ...fields, before: l.before, addedValues: l.addedValues })
    .from(l)
    .where(eq(l.id, id));
  if (!load || load.rolledBackAt) return { ok: false, reason: 'not_found' };
  if (!load.last) return { ok: false, reason: 'not_last' };
  const dict = load.dict as AdminValueDict;
  const records = new Map((await adminDictRecords(tx, dict)).map((x) => [x.code, x]));
  for (const b of load.before) {
    const now = records.get(b.code);
    if (!now || !unchangedSince(now, b)) {
      return { ok: false, reason: 'changed_after', code: b.code, name: now?.name ?? b.name };
    }
  }
  for (const a of load.addedValues) {
    const now = records.get(a.code);
    if (now && !unchangedSince(now, a)) {
      return { ok: false, reason: 'changed_after', code: a.code, name: now.name };
    }
  }
  const failed = (code: string, name: string, result: RollbackStepFailure) =>
    ({ ok: false, reason: 'restore_failed', code, name, result }) as const;
  for (const a of load.addedValues) {
    // Удалённое после загрузки добавленное значение убирать уже не нужно.
    const now = records.get(a.code);
    if (!now) continue;
    let off = now.usage.total > 0 || ADMIN_DICT_META[dict].undeletable === true;
    if (!off) {
      const deleted = await adminDictDelete(tx, dict, a.code, now.version);
      // Ссылку успели сохранить между проверкой и удалением — тогда только отключить.
      if (!deleted.ok && deleted.reason === 'used') off = true;
      else if (!deleted.ok) return failed(a.code, now.name, deleted);
    }
    if (off && now.active) {
      const active = await adminDictSetActive(tx, dict, a.code, false, now.version);
      if (!active.ok) return failed(a.code, now.name, active);
    }
  }
  for (const b of load.before) {
    const now = records.get(b.code)!;
    const saved = await adminDictUpdate(
      tx,
      dict,
      b.code,
      { name: b.name, data: b.data as never },
      now.version,
    );
    if (!saved.ok) return failed(b.code, b.name, saved);
    if (saved.record.active !== b.active) {
      const active = await adminDictSetActive(tx, dict, b.code, b.active, saved.record.version);
      if (!active.ok) return failed(b.code, b.name, active);
    }
  }
  await tx
    .update(l)
    .set({ rolledBackAt: sql`now()`, rolledBackBy: sql`app.current_user_id()` })
    .where(and(eq(l.id, id), isNull(l.rolledBackAt)));
  await writePlatformHistory(tx, {
    entity: 'platform_dict',
    entityId: historyId(dict),
    action: 'rollback',
    changes: [{ field: 'loadedAt', to: (load.createdAt as Date).toISOString() }],
  });
  const [after] = await tx.select(fields).from(l).where(eq(l.id, id));
  return { ok: true, load: toRecord(after as Row) };
}

/** Запись загрузки по номеру (после «Применить» — для ответа). */
export async function getDictLoad(tx: Tx, id: string): Promise<DictLoadRecord | null> {
  const [row] = await tx.select(fields).from(l).where(eq(l.id, id));
  return row ? toRecord(row as Row) : null;
}

/** Число на вкладке «Загрузки» — неоткаченных загрузок (прототип pdTabs). */
export async function countActiveDictLoads(tx: Tx): Promise<number> {
  const [row] = await tx.select({ n: count() }).from(l).where(isNull(l.rolledBackAt));
  return row?.n ?? 0;
}

/** Загрузки и откаты — по одному: последняя загрузка не меняется, пока идёт откат или «Применить». */
export async function lockDictLoads(tx: Tx): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('dict_loads'))`);
}
