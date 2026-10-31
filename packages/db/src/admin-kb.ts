import {
  auditActorName,
  formatText,
  KB_ADMIN_COLUMNS,
  KB_ADMIN_SORT,
  KB_MODULE_TITLES,
  kbArticleText,
  kbFlag,
  kbStepRule,
  isMenuModuleId,
  sameHistoryValue,
  toHistoryValue,
  type HistoryChange,
  type KbAdminList,
  type KbArticleInput,
  type KbHistorySection,
  type KbLevelDef,
  type KbLevelSet,
  type KbStepInput,
  type ListQuery,
} from '@buhuchet/domain';
import { and, asc, count, desc, eq, sql, type SQL } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { readReference, saveReference } from './admin-gked';
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
import { permissions, platformAuditLog } from './schema';

/*
 * Админка → «База знаний (содержимое)» (задача 2.39, docs/decisions.md п. Д-11; прототип
 * admin/kb-content.js): шаги уроков, статьи и уровни — разделы `platform_reference` (`kbSteps`,
 * `kbArticles`, `kbLevels`), из которых строится «База знаний» всех организаций (`kb.ts`). Правка —
 * той же функцией `app.admin_set_reference`, что у налогов: раздел целиком, той версии, что прочитана
 * в этой же транзакции. У каждой записи раздела своя версия `v` (нет — 1): «запись изменена другим
 * пользователем» — по ней, правка соседней записи не мешает. Поля, которых окно не меняет (экраны шага,
 * первое использование), сохраняются как были. Изменения пишутся в историю платформы
 * (`kbsteps:<код>`, `kbarts:<код>`, `kblevels:<набор>`) в той же транзакции. Всё — в
 * `withUserContext` администратора платформы.
 */

const CODE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const text = z.string().catch('');
const flag = z.union([z.boolean(), z.number()]).optional().catch(undefined);

/** Запись раздела как есть: известные поля читаются, остальные остаются в `raw`. */
const RawItem = z.record(z.string(), z.unknown());
type RawItem = z.infer<typeof RawItem>;

const StoredStep = z.object({
  id: z.string().regex(CODE),
  t: text,
  w: text,
  g: text,
  ord: z.number().catch(0),
  learn: flag,
  star: flag,
  perm: text,
  featk: text,
  evk: text,
  art: text,
  active: z.boolean().optional().catch(undefined),
  isNew: z.boolean().optional().catch(undefined),
  mod: z.string().optional().catch(undefined),
  at: z.array(z.string()).optional().catch(undefined),
  v: z.number().int().positive().optional().catch(undefined),
});
type StoredStep = z.infer<typeof StoredStep>;

const StoredArticle = z.object({
  id: z.string().regex(CODE),
  sec: text,
  t: text,
  mod: z.string().nullable().optional().catch(null),
  perm: z.string().nullable().optional().catch(null),
  aud: text,
  active: z.boolean().optional().catch(undefined),
  html: text,
  v: z.number().int().positive().optional().catch(undefined),
});
type StoredArticle = z.infer<typeof StoredArticle>;

const Group = z.object({ id: z.string(), t: text, adm: flag });

/** Записи раздела-массива с разобранными полями; неразборчивая запись пропускается. */
function itemsOf<T>(payload: unknown, schema: z.ZodType<T>): { raw: RawItem; item: T }[] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((x) => {
    const raw = RawItem.safeParse(x);
    const item = schema.safeParse(x);
    return raw.success && item.success ? [{ raw: raw.data, item: item.data }] : [];
  });
}

const versionOf = (x: { v?: number | undefined }) => x.v ?? 1;

/* ───────────── Шаги уроков ───────────── */

export interface AdminKbGroup {
  id: string;
  t: string;
  adm: boolean;
}

/** Шаг для окна и списка: поля окна, код, версия, «Новое». */
export interface AdminKbStep extends Required<Omit<KbStepInput, 'mod'>> {
  id: string;
  ord: number;
  isNew: boolean;
  /** Место для «Перейти» шага, добавленного администратором. */
  mod: string | null;
  /** Модуль шага: из правила шага или места для «Перейти». */
  module: string | null;
  version: number;
}

async function groupsOf(tx: Tx): Promise<AdminKbGroup[]> {
  const ref = await readReference(tx, 'kbGroups');
  return itemsOf(ref?.payload, Group).map(({ item }) => ({
    id: item.id,
    t: item.t,
    adm: kbFlag(item.adm),
  }));
}

const stepOf = (s: StoredStep): AdminKbStep => ({
  id: s.id,
  g: s.g,
  t: s.t,
  w: s.w,
  learn: kbFlag(s.learn),
  art: s.art,
  star: kbFlag(s.star),
  perm: s.perm,
  featk: s.featk,
  evk: s.evk,
  active: s.active !== false,
  ord: s.ord,
  isNew: s.isNew === true,
  mod: s.mod ?? null,
  module:
    kbStepRule({ id: s.id, evk: s.evk, ...(s.mod ? { mod: s.mod } : {}) })?.module ??
    s.mod ??
    s.at?.[0]?.split('.')[0] ??
    null,
  version: versionOf(s),
});

/** Шаги по порядку программ (прототип: по порядку групп, затем `ord`). */
function sortSteps(steps: StoredStep[], groups: readonly AdminKbGroup[]): StoredStep[] {
  const k = (g: string) => {
    const i = groups.findIndex((x) => x.id === g);
    return i < 0 ? groups.length : i;
  };
  return [...steps].sort((a, b) => k(a.g) - k(b.g) || a.ord - b.ord);
}

/** Все шаги, выключенные тоже, по порядку программ. */
export async function adminKbSteps(tx: Tx): Promise<AdminKbStep[]> {
  const [ref, groups] = await Promise.all([readReference(tx, 'kbSteps'), groupsOf(tx)]);
  return sortSteps(
    itemsOf(ref?.payload, StoredStep).map((x) => x.item),
    groups,
  ).map(stepOf);
}

export type AdminKbSaveResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'not_found' | 'changed' };

const CHANGED = { ok: false, reason: 'changed' } as const;
const NOT_FOUND = { ok: false, reason: 'not_found' } as const;

/** «Было → стало» по полям; у новой записи — только заполненные. */
function diff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
): HistoryChange[] {
  return Object.keys(after)
    .filter((f) => !sameHistoryValue(toHistoryValue(before?.[f]), toHistoryValue(after[f])))
    .map((f) =>
      before
        ? { field: f, from: toHistoryValue(before[f]), to: toHistoryValue(after[f]) }
        : { field: f, to: toHistoryValue(after[f]) },
    )
    .filter((c) => before || (c.to !== null && c.to !== '' && c.to !== false));
}

/** Поля шага в истории: как в окне. */
const stepFields = (s: Omit<AdminKbStep, 'id' | 'version' | 'isNew' | 'module' | 'ord'>) => ({
  g: s.g,
  t: s.t,
  w: s.w,
  learn: s.learn,
  art: s.art,
  star: s.star,
  perm: s.perm,
  featk: s.featk,
  evk: s.evk,
  active: s.active,
  ...(s.mod ? { mod: s.mod } : {}),
});

/** Код нового шага (прототип `'u'+Date.now().toString(36)`): латиница и цифры, не занятый. */
function freshCode(prefix: string, taken: ReadonlySet<string>): string {
  for (;;) {
    const code = `${prefix}${randomBytes(6).toString('hex')}`;
    if (!taken.has(code)) return code;
  }
}

/** Записать раздел-массив той версии, что прочитана; null — раздел изменили между чтением и записью. */
async function saveItems(
  tx: Tx,
  key: 'kbSteps' | 'kbArticles',
  items: RawItem[],
  version: number,
): Promise<number | null> {
  return saveReference(tx, key, items, version);
}

/**
 * Новый шаг (`id` нет) или правка шага той версии, что видел администратор (прототип kbStepDlg
 * «Сохранить»). Новый — с отметкой «Новое», последним по порядку и с местом для «Перейти»; у шага
 * «Посмотреть» без экранов экран — модуль этого места (прототип kbBind: `at=[mod]`).
 */
export async function adminKbStepSave(
  tx: Tx,
  id: string | null,
  input: KbStepInput,
  version: number,
): Promise<AdminKbSaveResult<AdminKbStep>> {
  const ref = await readReference(tx, 'kbSteps');
  if (!ref) return NOT_FOUND;
  const items = itemsOf(ref.payload, StoredStep);
  const raws = Array.isArray(ref.payload) ? (ref.payload as RawItem[]) : [];
  const value = {
    g: input.g,
    t: input.t.trim(),
    w: input.w.trim(),
    learn: input.learn ? 1 : 0,
    art: input.art,
    star: input.star ? 1 : 0,
    perm: input.perm,
    featk: input.featk,
    evk: input.evk,
    active: input.active,
  };
  let saved: RawItem;
  let before: AdminKbStep | null = null;
  if (id === null) {
    const taken = new Set(items.map((x) => x.item.id));
    const ord = Math.max(0, ...items.map((x) => x.item.ord)) + 1;
    const mod = input.mod!;
    saved = {
      id: freshCode('u', taken),
      ...value,
      ord,
      isNew: true,
      mod,
      ...(input.evk === 'open' ? { at: [mod] } : {}),
      v: 1,
    };
    raws.push(saved);
  } else {
    const k = raws.findIndex((r) => r.id === id);
    const found = items.find((x) => x.item.id === id);
    if (k < 0 || !found) return NOT_FOUND;
    if (versionOf(found.item) !== version) return CHANGED;
    before = stepOf(found.item);
    saved = { ...raws[k], ...value, v: versionOf(found.item) + 1 };
    raws[k] = saved;
  }
  if ((await saveItems(tx, 'kbSteps', raws, ref.version)) === null) return CHANGED;
  const after = stepOf(StoredStep.parse(saved));
  const changes = diff(before && stepFields(before), stepFields(after));
  if (changes.length) {
    await writePlatformHistory(tx, {
      entity: 'platform_dict',
      entityId: `kbsteps:${after.id}`,
      action: before ? 'update' : 'create',
      changes,
    });
  }
  return { ok: true, value: after };
}

/**
 * «Выше» / «Ниже» (прототип: обмен порядком с соседним шагом того же модуля программы). Крайний шаг
 * не двигается — `not_found`.
 */
export async function adminKbStepMove(
  tx: Tx,
  id: string,
  dir: 'up' | 'down',
  version: number,
): Promise<AdminKbSaveResult<AdminKbStep>> {
  const ref = await readReference(tx, 'kbSteps');
  if (!ref) return NOT_FOUND;
  const items = itemsOf(ref.payload, StoredStep);
  const found = items.find((x) => x.item.id === id);
  if (!found) return NOT_FOUND;
  if (versionOf(found.item) !== version) return CHANGED;
  const siblings = items
    .filter((x) => x.item.g === found.item.g)
    .sort((a, b) => a.item.ord - b.item.ord);
  const k = siblings.indexOf(found);
  const other = siblings[dir === 'up' ? k - 1 : k + 1];
  if (!other) return NOT_FOUND;
  // Равный порядок (так бывает в наполнении) — шаг всё равно встаёт по другую сторону соседа.
  const [a, b] =
    other.item.ord === found.item.ord
      ? dir === 'up'
        ? [found.item.ord - 1, found.item.ord]
        : [found.item.ord + 1, found.item.ord]
      : [other.item.ord, found.item.ord];
  const raws = (ref.payload as RawItem[]).map((r) => {
    if (r.id === id) return { ...r, ord: a, v: versionOf(found.item) + 1 };
    if (r.id === other.item.id) return { ...r, ord: b, v: versionOf(other.item) + 1 };
    return r;
  });
  if ((await saveItems(tx, 'kbSteps', raws, ref.version)) === null) return CHANGED;
  await writePlatformHistory(tx, {
    entity: 'platform_dict',
    entityId: `kbsteps:${id}`,
    action: 'update',
    changes: [{ field: 'ord', from: found.item.ord, to: a }],
  });
  const moved = raws.find((r) => r.id === id)!;
  return { ok: true, value: stepOf(StoredStep.parse(moved)) };
}

/** «Выключить» / «Включить» шаг (прототип: выключенный пропадает из программ и из подсчёта). */
export async function adminKbStepActive(
  tx: Tx,
  id: string,
  active: boolean,
  version: number,
): Promise<AdminKbSaveResult<AdminKbStep>> {
  const steps = await adminKbSteps(tx);
  const step = steps.find((s) => s.id === id);
  if (!step) return NOT_FOUND;
  const { id: _id, version: _v, isNew: _n, module: _m, ord: _o, mod, ...rest } = step;
  return adminKbStepSave(tx, id, { ...rest, ...(mod ? { mod } : {}), active }, version);
}

/* ───────────── Статьи ───────────── */

/** Статья для окна: поля окна, код и версия. */
export interface AdminKbArticle extends KbArticleInput {
  id: string;
  version: number;
}

const articleOf = (a: StoredArticle): AdminKbArticle => ({
  id: a.id,
  sec: a.sec,
  t: a.t,
  mod: a.mod ?? '',
  perm: a.perm ?? '',
  aud: a.aud === 'biz' || a.aud === 'adm' ? a.aud : 'all',
  active: a.active !== false,
  html: a.html,
  version: versionOf(a),
});

/** Все статьи, отключённые тоже, по порядку справочника. */
export async function adminKbArticles(tx: Tx): Promise<AdminKbArticle[]> {
  const ref = await readReference(tx, 'kbArticles');
  return itemsOf(ref?.payload, StoredArticle).map(({ item }) => articleOf(item));
}

const articleFields = (a: KbArticleInput) => ({
  sec: a.sec,
  t: a.t,
  mod: a.mod,
  perm: a.perm,
  aud: a.aud,
  active: a.active,
  html: a.html,
});

/** Новая статья (`id` нет) или правка той версии, что видел администратор (прототип kbArtEditDlg). */
export async function adminKbArticleSave(
  tx: Tx,
  id: string | null,
  input: KbArticleInput,
  version: number,
): Promise<AdminKbSaveResult<AdminKbArticle>> {
  const ref = await readReference(tx, 'kbArticles');
  if (!ref) return NOT_FOUND;
  const items = itemsOf(ref.payload, StoredArticle);
  const raws = Array.isArray(ref.payload) ? (ref.payload as RawItem[]) : [];
  const value = {
    sec: input.sec.trim(),
    t: input.t.trim(),
    mod: input.mod || null,
    perm: input.perm || null,
    aud: input.aud,
    active: input.active,
    html: input.html,
  };
  let saved: RawItem;
  let before: AdminKbArticle | null = null;
  if (id === null) {
    saved = { id: freshCode('a_u', new Set(items.map((x) => x.item.id))), ...value, v: 1 };
    raws.push(saved);
  } else {
    const k = raws.findIndex((r) => r.id === id);
    const found = items.find((x) => x.item.id === id);
    if (k < 0 || !found) return NOT_FOUND;
    if (versionOf(found.item) !== version) return CHANGED;
    before = articleOf(found.item);
    saved = { ...raws[k], ...value, v: versionOf(found.item) + 1 };
    raws[k] = saved;
  }
  if ((await saveItems(tx, 'kbArticles', raws, ref.version)) === null) return CHANGED;
  const after = articleOf(StoredArticle.parse(saved));
  const changes = diff(before && articleFields(before), articleFields(after));
  if (changes.length) {
    await writePlatformHistory(tx, {
      entity: 'platform_dict',
      entityId: `kbarts:${after.id}`,
      action: before ? 'update' : 'create',
      changes,
    });
  }
  return { ok: true, value: after };
}

/* ───────────── Уровни ───────────── */

const Level = z.object({ n: z.string(), p: z.number() });
const Levels = z.object({ business: z.array(Level), admin: z.array(Level) });

export interface AdminKbLevels {
  business: KbLevelDef[];
  admin: KbLevelDef[];
  version: number;
}

export async function adminKbLevels(tx: Tx): Promise<AdminKbLevels | null> {
  const ref = await readReference(tx, 'kbLevels');
  const levels = Levels.safeParse(ref?.payload);
  if (!ref || !levels.success) return null;
  return { ...levels.data, version: ref.version };
}

/**
 * Названия и пороги одного набора уровней (прототип: «Сохранить» под таблицей): столько же уровней,
 * сколько было; полученные пользователями уровни не отнимаются (их хранит `kb_levels`). Без изменений —
 * `null` в `changes`, ничего не пишется.
 */
export async function adminKbLevelsSave(
  tx: Tx,
  set: KbLevelSet,
  levels: readonly KbLevelDef[],
  version: number,
): Promise<AdminKbSaveResult<AdminKbLevels & { changed: boolean }>> {
  const ref = await readReference(tx, 'kbLevels');
  const current = Levels.safeParse(ref?.payload);
  if (!ref || !current.success) return NOT_FOUND;
  if (ref.version !== version) return CHANGED;
  const before = current.data[set];
  const next = levels.map((l, j) => ({ n: l.n.trim(), p: j === 0 ? 0 : l.p }));
  const changes: HistoryChange[] = next.flatMap((l, j) =>
    before[j]?.n === l.n && before[j]?.p === l.p
      ? []
      : [{ field: String(j + 1), from: { n: before[j]?.n ?? '', p: before[j]?.p ?? 0 }, to: l }],
  );
  if (!changes.length) return { ok: true, value: { ...current.data, version, changed: false } };
  const payload = { ...(ref.payload as Record<string, unknown>), [set]: next };
  const saved = await saveReference(tx, 'kbLevels', payload, ref.version);
  if (saved === null) return CHANGED;
  await writePlatformHistory(tx, {
    entity: 'platform_dict',
    entityId: `kblevels:${set}`,
    action: 'update',
    changes,
  });
  return {
    ok: true,
    value: { ...current.data, [set]: next, version: saved, changed: true },
  };
}

/* ───────────── Списки ───────────── */

export interface AdminKbRow {
  id: string;
  version: number;
  active: boolean;
  isNew: boolean;
  star: boolean;
  /** Шаг можно поднять или опустить в своём модуле программы («Выше», «Ниже»). */
  canUp: boolean;
  canDown: boolean;
  values: Record<string, string | number>;
}

async function permissionNames(tx: Tx): Promise<Map<string, string>> {
  const rows = await tx
    .select({ id: permissions.id, name: permissions.name })
    .from(permissions)
    .orderBy(asc(permissions.sortOrder));
  return new Map(rows.map((r) => [r.id, r.name]));
}

const moduleTitle = (t: ListTexts, mod: string | null) =>
  mod && isMenuModuleId(mod) ? t(KB_MODULE_TITLES[mod]) : '';

/** Строки списка по порядку справочника (у шагов — по порядку программ). */
async function kbRows(tx: Tx, list: KbAdminList, t: ListTexts): Promise<AdminKbRow[]> {
  const perms = await permissionNames(tx);
  const yes = t('kbadm.v.yes');
  const no = t('kbadm.v.no');
  const none = t('kbadm.v.none');
  if (list === 'steps') {
    const [steps, groups] = await Promise.all([adminKbSteps(tx), groupsOf(tx)]);
    return steps.map((s, i) => {
      const group = groups.find((g) => g.id === s.g);
      const module = moduleTitle(t, s.module);
      const siblings = steps.filter((x) => x.g === s.g);
      return {
        id: s.id,
        version: s.version,
        active: s.active,
        isNew: s.isNew,
        star: s.star,
        canUp: siblings[0] !== s,
        canDown: siblings[siblings.length - 1] !== s,
        values: {
          n: i + 1,
          id: s.id,
          prog: t(group?.adm ? 'kbadm.prog.admin' : 'kbadm.prog.business'),
          g: group?.t ?? s.g,
          t: s.t,
          type: t(s.learn ? 'kbadm.step.type.look' : 'kbadm.step.type.do'),
          star: s.star ? t('kbadm.v.star') : none,
          perm: s.perm
            ? (perms.get(s.perm) ?? s.perm)
            : module
              ? formatText(t('kbadm.v.perm_view'), { module })
              : none,
          feat: s.featk ? t(`org.feature.${s.featk}`) : none,
          evk: s.evk ? t(`kbadm.ev.${s.evk}`) : none,
          active: s.active ? yes : no,
        },
      };
    });
  }
  return (await adminKbArticles(tx)).map((a) => ({
    id: a.id,
    version: a.version,
    active: a.active,
    isNew: false,
    star: false,
    canUp: false,
    canDown: false,
    values: {
      id: a.id,
      sec: a.sec,
      t: a.t,
      mod: moduleTitle(t, a.mod) || t('kbadm.v.mod_none'),
      perm: a.perm ? (perms.get(a.perm) ?? a.perm) : none,
      aud: t(`kbadm.v.aud.${a.aud}`),
      len: kbArticleText(a.html).length,
      active: a.active ? yes : no,
    },
  }));
}

/** Столбец строки из `jsonb_to_recordset`: ключи — постоянные имена столбцов, не ввод пользователя. */
const field = (key: string) => sql.raw(`"r"."${key}"`);

const SQL_TYPE: Readonly<Record<string, string>> = { int: 'integer' };

function recordset(list: KbAdminList, rows: readonly AdminKbRow[]): SQL {
  const records = rows.map((x, i) => ({ ...x.values, id: x.id, ord: i + 1 }));
  const defs = ['"ord" integer'];
  for (const c of KB_ADMIN_COLUMNS[list]) defs.push(`"${c.key}" ${SQL_TYPE[c.type] ?? 'text'}`);
  return sql`jsonb_to_recordset(${JSON.stringify(records)}::jsonb) as r(${sql.raw(defs.join(', '))})`;
}

export function adminKbListColumns(list: KbAdminList): ListColumns {
  const columns: Record<string, ListColumn> = {};
  for (const c of KB_ADMIN_COLUMNS[list]) {
    columns[c.key] = { type: c.type, label: c.label, value: field(c.key) };
  }
  return columns;
}

const NATURAL = [field('ord')];

/** Без своей сортировки: шаги — по «№», статьи — по порядку справочника (null — без сортировки). */
const sorted = (list: KbAdminList, query: ListQuery): ListQuery =>
  query.sort === undefined ? { ...query, sort: KB_ADMIN_SORT[list] } : query;

const fromOf =
  (tx: Tx, source: SQL): ListFrom =>
  (fields) =>
    tx.select(fields).from(source).$dynamic();

async function listSource(tx: Tx, list: KbAdminList, t: ListTexts) {
  const rows = await kbRows(tx, list, t);
  return { rows, source: recordset(list, rows) };
}

/** Страница списка вкладки: поиск, фильтры, сортировка и группы — общим механизмом. */
export async function listAdminKbPage(tx: Tx, list: KbAdminList, query: ListQuery, t: ListTexts) {
  const { rows, source } = await listSource(tx, list, t);
  const byId = new Map(rows.map((x) => [x.id, x]));
  const page = await selectListPage({
    query: sorted(list, query),
    columns: adminKbListColumns(list),
    natural: NATURAL,
    defaultSort: KB_ADMIN_SORT[list],
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
  return { ...page, rows: page.rows.map((r) => byId.get(r.id)!) };
}

/** Значения столбца для фильтра-галочек; `q` — «Найти значение». */
export async function listAdminKbValues(
  tx: Tx,
  list: KbAdminList,
  key: string,
  t: ListTexts,
  q?: string,
) {
  const { source } = await listSource(tx, list, t);
  return selectListValues({
    columns: adminKbListColumns(list),
    key,
    scope: undefined,
    from: fromOf(tx, source),
    q,
  });
}

/** Список для «В Excel»: все строки под поиском и фильтрами, столбцы `keys`. */
export async function exportAdminKb(
  tx: Tx,
  list: KbAdminList,
  query: ListQuery,
  keys: readonly string[],
  t: ListTexts,
) {
  const { source } = await listSource(tx, list, t);
  return selectListExport({
    query: sorted(list, query),
    columns: adminKbListColumns(list),
    keys,
    natural: NATURAL,
    defaultSort: KB_ADMIN_SORT[list],
    scope: undefined,
    from: fromOf(tx, source),
  });
}

/* ───────────── Для окон ───────────── */

export interface AdminKbMeta {
  groups: AdminKbGroup[];
  /** Статьи для «Статья» шага: код, раздел, название. */
  articles: { id: string; sec: string; t: string }[];
  permissions: { id: string; name: string }[];
  /** Шаги со своим сценарием «Показать как»: код шага → облачков. */
  shows: Record<string, number>;
}

const ShowRef = z.object({ step: z.string(), items: z.array(z.unknown()).catch([]) });

export async function adminKbMeta(tx: Tx): Promise<AdminKbMeta> {
  const [groups, articles, perms, shows] = await Promise.all([
    groupsOf(tx),
    adminKbArticles(tx),
    permissionNames(tx),
    readReference(tx, 'kbShows'),
  ]);
  return {
    groups,
    articles: articles.map((a) => ({ id: a.id, sec: a.sec, t: a.t })),
    permissions: [...perms].map(([id, name]) => ({ id, name })),
    shows: Object.fromEntries(
      itemsOf(shows?.payload, ShowRef).map(({ item }) => [item.step, item.items.length]),
    ),
  };
}

/* ───────────── История ───────────── */

export interface AdminKbHistoryItem {
  id: string;
  at: Date;
  actor: string | null;
  section: KbHistorySection;
  code: string;
  action: string;
  /** Название: из записи (новое или прежнее), иначе нынешнее, иначе код. */
  label: string;
  changes: HistoryChange[];
}

/**
 * «История изменений · N» под вкладкой (прототип pdHistHtml): последние записи раздела, сначала новые,
 * и сколько их всего.
 */
export async function adminKbHistory(
  tx: Tx,
  section: KbHistorySection,
  limit: number,
): Promise<{ total: number; items: AdminKbHistoryItem[] }> {
  const where = and(
    eq(platformAuditLog.entity, 'platform_dict'),
    sql`starts_with(${platformAuditLog.entityId}, ${`${section}:`})`,
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
  const titles = new Map<string, string>();
  if (section === 'kbsteps') for (const s of await adminKbSteps(tx)) titles.set(s.id, s.t);
  if (section === 'kbarts') for (const a of await adminKbArticles(tx)) titles.set(a.id, a.t);
  return {
    total: counted?.n ?? 0,
    items: rows.map((r) => {
      const code = r.entityId.slice(section.length + 1);
      const changes = (r.changes ?? []) as HistoryChange[];
      const title = changes.find((c) => c.field === 't');
      return {
        id: String(r.id),
        at: r.at,
        actor: auditActorName(r.actorUserId, null),
        section,
        code,
        action: r.action,
        label: String(title?.to ?? '') || titles.get(code) || code,
        changes,
      };
    }),
  };
}
