import {
  auditActorName,
  formatText,
  KB_ADMIN_COLUMNS,
  KB_ADMIN_SORT,
  KB_MODULE_TITLES,
  kbArticleText,
  kbFlag,
  kbShowEdit,
  kbShowSubTab,
  kbStepRule,
  isMenuModuleId,
  PLATFORM_ADMIN_NAME,
  sameHistoryValue,
  toHistoryValue,
  type HistoryChange,
  type KbAdminList,
  type KbArticleInput,
  type KbHistorySection,
  type KbLevelDef,
  type KbLevelSet,
  type KbShowInput,
  type KbShowProblem,
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
import { news, permissions, platformAuditLog } from './schema';

/*
 * Админка → «База знаний (содержимое)» (задача 2.39, docs/decisions.md п. Д-11; прототип
 * admin/kb-content.js): шаги уроков, статьи, уровни и сценарии показов — разделы `platform_reference`
 * (`kbSteps`, `kbArticles`, `kbLevels`, `kbShows`), из которых строится «База знаний» всех организаций
 * (`kb.ts`). Правка —
 * той же функцией `app.admin_set_reference`, что у налогов: раздел целиком, той версии, что прочитана
 * в этой же транзакции. У каждой записи раздела своя версия `v` (нет — 1): «запись изменена другим
 * пользователем» — по ней, правка соседней записи не мешает. Поля, которых окно не меняет (экраны шага,
 * первое использование, что подсвечивает облачко) сохраняются как были. Изменения пишутся в историю
 * платформы (`kbsteps:<код>`, `kbarts:<код>`, `kblevels:<набор>`, `kbshows:<шаг>`) в той же
 * транзакции. Всё — в
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
  { ok: true; value: T } | { ok: false; reason: 'not_found' | 'changed' };

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
  key: 'kbSteps' | 'kbArticles' | 'kbShows',
  items: RawItem[],
  version: number,
): Promise<number | null> {
  return saveReference(tx, key, items, version);
}

/** Код и порядок шага из файла Excel (прототип DX.kbsteps: код новой строки, «Порядок»). */
export interface AdminKbStepFileFields {
  code?: string;
  ord?: number;
}

/**
 * Новый шаг (`id` нет) или правка шага той версии, что видел администратор (прототип kbStepDlg
 * «Сохранить»). Новый — с отметкой «Новое», последним по порядку и с местом для «Перейти»; у шага
 * «Посмотреть» без экранов экран — модуль этого места (прототип kbBind: `at=[mod]`). Загрузка из Excel
 * задаёт код нового шага и «Порядок» (`file`); занятый код — `changed`.
 */
export async function adminKbStepSave(
  tx: Tx,
  id: string | null,
  input: KbStepInput,
  version: number,
  file: AdminKbStepFileFields = {},
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
    if (file.code && taken.has(file.code)) return CHANGED;
    const ord = file.ord ?? Math.max(0, ...items.map((x) => x.item.ord)) + 1;
    const mod = input.mod!;
    saved = {
      id: file.code ?? freshCode('u', taken),
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
    saved = {
      ...raws[k],
      ...value,
      ...(file.ord !== undefined ? { ord: file.ord } : {}),
      v: versionOf(found.item) + 1,
    };
    // Как kbBind прототипа: шаг администратора, переключённый на «Перейти» и 3 секунды, получает
    // экран своего модуля.
    if (saved.evk === 'open' && !saved.at && typeof saved.mod === 'string') {
      saved = { ...saved, at: [saved.mod] };
    }
    raws[k] = saved;
  }
  if ((await saveItems(tx, 'kbSteps', raws, ref.version)) === null) return CHANGED;
  const after = stepOf(StoredStep.parse(saved));
  const changes = diff(before && stepFields(before), stepFields(after));
  if (before && before.ord !== after.ord) {
    changes.push({ field: 'ord', from: before.ord, to: after.ord });
  }
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

/**
 * Убрать запись раздела-массива (откат загрузки из Excel убирает добавленные ею шаги и статьи):
 * удаление — в историю с прежним названием. Записи нет — `not_found`, раздел изменили — `changed`.
 */
async function deleteItem(
  tx: Tx,
  key: 'kbSteps' | 'kbArticles',
  section: 'kbsteps' | 'kbarts',
  id: string,
): Promise<AdminKbSaveResult<null>> {
  const ref = await readReference(tx, key);
  const raws = Array.isArray(ref?.payload) ? (ref.payload as RawItem[]) : [];
  const k = raws.findIndex((r) => r && r.id === id);
  if (!ref || k < 0) return NOT_FOUND;
  if (
    (await saveItems(
      tx,
      key,
      raws.filter((_, i) => i !== k),
      ref.version,
    )) === null
  )
    return CHANGED;
  await writePlatformHistory(tx, {
    entity: 'platform_dict',
    entityId: `${section}:${id}`,
    action: 'delete',
    changes: [{ field: 't', from: str(raws[k]!.t) }],
  });
  return { ok: true, value: null };
}

/** Шаг, добавленный загрузкой из Excel, — при её откате (отметки шага у пользователей не считаются). */
export function adminKbStepDelete(tx: Tx, id: string): Promise<AdminKbSaveResult<null>> {
  return deleteItem(tx, 'kbSteps', 'kbsteps', id);
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

/**
 * Новая статья (`id` нет) или правка той версии, что видел администратор (прототип kbArtEditDlg).
 * Загрузка из Excel задаёт код новой статьи (`code`); занятый код — `changed`.
 */
export async function adminKbArticleSave(
  tx: Tx,
  id: string | null,
  input: KbArticleInput,
  version: number,
  code?: string,
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
    const taken = new Set(items.map((x) => x.item.id));
    if (code && taken.has(code)) return CHANGED;
    saved = { id: code ?? freshCode('a_u', taken), ...value, v: 1 };
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

/**
 * Статья, добавленная загрузкой из Excel, — при её откате. Статья шага (`art`) или «Подробнее» новости
 * не удаляется, а отключается: иначе ссылка вела бы на статью, которой нет.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Д-27
export async function adminKbArticleRemove(
  tx: Tx,
  id: string,
): Promise<AdminKbSaveResult<AdminKbArticle | null>> {
  // На статью ссылается шаг или «Подробнее» новости — статья отключается, ссылки не повисают.
  const [steps, linked] = await Promise.all([
    adminKbSteps(tx),
    tx
      .select({ id: news.id })
      .from(news)
      .where(and(eq(news.linkKind, 'art'), eq(news.linkId, id)))
      .limit(1),
  ]);
  if (!steps.some((s) => s.art === id) && !linked.length) {
    return deleteItem(tx, 'kbArticles', 'kbarts', id);
  }
  const found = (await adminKbArticles(tx)).find((a) => a.id === id);
  if (!found) return NOT_FOUND;
  if (!found.active) return { ok: true, value: found };
  const { id: _id, version, ...fields } = found;
  return adminKbArticleSave(tx, id, { ...fields, active: false }, version);
}

/* ───────────── Показы ───────────── */

const StoredShow = z.object({
  id: z.string().regex(CODE),
  step: z.string().regex(CODE),
  scr: z.string().optional().catch(undefined),
  items: z.array(RawItem).catch([]),
  doit: z.array(z.unknown()).optional().catch(undefined),
  active: z.boolean().optional().catch(undefined),
  v: z.number().int().positive().optional().catch(undefined),
});
type StoredShow = z.infer<typeof StoredShow>;

/** Облачко сценария для окна: что подсвечивает (задаёт разработчик) и тексты (меняет администратор). */
export interface AdminKbShowItem {
  auto: string | null;
  txt: string | null;
  /** Подсвечивает элемент экрана. */
  el: boolean;
  /** Вкладка, которую облачко открывает перед показом. */
  tab: string | null;
  t: string;
  x: string;
  common: boolean;
}

/** Сценарий шага для окна и предпросмотра; своего нет — `own: false`, облачко «Все элементы экрана». */
export interface AdminKbShow {
  step: { id: string; t: string; w: string; learn: boolean };
  own: boolean;
  active: boolean;
  /** Версия сценария; своего нет — 0. */
  version: number;
  items: AdminKbShowItem[];
  /** Последнее облачко показа: «Готово» у «Посмотреть», «Сделать сейчас» у «Сделать» (`kbUi.ui`). */
  fin: { t: string; x: string };
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

export function showItemOf(raw: RawItem): AdminKbShowItem {
  return {
    auto: typeof raw.auto === 'string' ? raw.auto : null,
    txt: typeof raw.txt === 'string' && raw.txt ? raw.txt : null,
    el: typeof raw.s === 'string' && raw.s !== '',
    tab: kbShowSubTab(Array.isArray(raw.sub) ? (raw.sub as never[]) : null),
    t: str(raw.t),
    x: str(raw.x),
    common: raw.common === true,
  };
}

/** Шаги программы организаций (сценарии показов — только у них, прототип: `!adm`). */
async function businessSteps(tx: Tx): Promise<{ steps: StoredStep[]; groups: AdminKbGroup[] }> {
  const [ref, groups] = await Promise.all([readReference(tx, 'kbSteps'), groupsOf(tx)]);
  const admin = new Set(groups.filter((g) => g.adm).map((g) => g.id));
  const steps = itemsOf(ref?.payload, StoredStep)
    .map((x) => x.item)
    .filter((s) => !admin.has(s.g));
  return { steps: sortSteps(steps, groups), groups };
}

/** Запись раздела — этот сценарий (разобранная запись — копия, сравнение по коду и шагу). */
const isShowOf = (r: unknown, show: StoredShow) =>
  !!r &&
  typeof r === 'object' &&
  (r as RawItem).id === show.id &&
  (r as RawItem).step === show.step;

/** Сценарии шагов: у шага — первый (прототип kbShowOf). */
async function showsOf(tx: Tx) {
  const ref = await readReference(tx, 'kbShows');
  const list = itemsOf(ref?.payload, StoredShow);
  const byStep = new Map<string, StoredShow>();
  for (const { item } of list) if (!byStep.has(item.step)) byStep.set(item.step, item);
  return { ref, byStep };
}

const UiTexts = z.object({ ui: z.record(z.string(), z.string()).catch({}) }).catch({ ui: {} });

async function finOf(tx: Tx, learn: boolean): Promise<{ t: string; x: string }> {
  const ref = await readReference(tx, 'kbUi');
  const { ui } = UiTexts.parse(ref?.payload ?? {});
  return learn
    ? { t: ui.finLookT ?? '', x: ui.finLook ?? '' }
    : { t: ui.finDoT ?? '', x: ui.finDo ?? '' };
}

/** Сценарий шага программы организаций для окна «Сценарий показа» и предпросмотра; шага нет — null. */
export async function adminKbShow(tx: Tx, stepId: string): Promise<AdminKbShow | null> {
  const [{ steps }, { byStep }] = await Promise.all([businessSteps(tx), showsOf(tx)]);
  const step = steps.find((s) => s.id === stepId);
  if (!step) return null;
  const show = byStep.get(stepId);
  const learn = kbFlag(step.learn);
  return {
    step: { id: step.id, t: step.t, w: step.w, learn },
    own: !!show,
    active: show ? show.active !== false : true,
    version: show ? versionOf(show) : 0,
    items: (show ? show.items : [{ auto: 'screen' }]).map(showItemOf),
    fin: await finOf(tx, learn),
  };
}

/** Свой сценарий шага для выгрузки в Excel: шаг, «Активен», версия и облачка, как они в разделе. */
export interface AdminKbOwnShow {
  id: string;
  step: string;
  stepTitle: string;
  active: boolean;
  version: number;
  items: RawItem[];
}

/**
 * Свои сценарии шагов программы организаций по порядку раздела (прототип DX.kbshows: `KBSH`); у шага —
 * первый, как в показе.
 */
export async function adminKbOwnShows(tx: Tx): Promise<AdminKbOwnShow[]> {
  const [{ steps }, { byStep }] = await Promise.all([businessSteps(tx), showsOf(tx)]);
  const titles = new Map(steps.map((s) => [s.id, s.t]));
  return [...byStep.values()].flatMap((h) =>
    titles.has(h.step)
      ? [
          {
            id: h.id,
            step: h.step,
            stepTitle: titles.get(h.step)!,
            active: h.active !== false,
            version: versionOf(h),
            items: h.items,
          },
        ]
      : [],
  );
}

export type AdminKbShowSaveResult =
  | AdminKbSaveResult<AdminKbShow>
  | { ok: false; reason: 'invalid'; problem: KbShowProblem; index: number };

/** Заголовки облачков в истории: у «Автоматически» — его вид. */
const showTitles = (items: readonly RawItem[]) =>
  items.map((p) => (typeof p.auto === 'string' ? `auto:${p.auto}` : str(p.t)));

/**
 * Свой сценарий шага: новый (`version` 0, прототип «Создать свой сценарий») или правка той версии, что
 * видел администратор (kbShowDlg «Сохранить»): порядок облачков, тексты, «Общий элемент», «Активен».
 * Что подсвечивает облачко и действия перед ним сохраняются как были (`kbShowEdit`). Без изменений —
 * ничего не пишется.
 */
export async function adminKbShowSave(
  tx: Tx,
  stepId: string,
  input: KbShowInput,
  version: number,
): Promise<AdminKbShowSaveResult> {
  const [{ steps }, { ref }] = await Promise.all([businessSteps(tx), showsOf(tx)]);
  if (!ref || !steps.some((s) => s.id === stepId)) return NOT_FOUND;
  const shows = itemsOf(ref.payload, StoredShow);
  const raws = Array.isArray(ref.payload) ? (ref.payload as RawItem[]) : [];
  const found = shows.find((x) => x.item.step === stepId);
  if ((found ? versionOf(found.item) : 0) !== version) return CHANGED;
  const edited = kbShowEdit(found?.item.items ?? [], input);
  if ('problem' in edited) return { ok: false, reason: 'invalid', ...edited };
  const before = found?.item ?? null;
  const wasActive = before ? before.active !== false : true;
  if (
    before &&
    wasActive === input.active &&
    JSON.stringify(before.items) === JSON.stringify(edited.items)
  ) {
    return { ok: true, value: (await adminKbShow(tx, stepId))! };
  }
  let next: RawItem[];
  if (found) {
    const k = raws.findIndex((r) => isShowOf(r, found.item));
    next = raws.map((r, i) =>
      i === k ? { ...r, items: edited.items, active: input.active, v: version + 1 } : r,
    );
  } else {
    const taken = new Set(shows.map((x) => x.item.id));
    const own = `sh-${stepId}`;
    const id = own.length <= 64 && !taken.has(own) ? own : freshCode('sh-', taken);
    next = [...raws, { id, step: stepId, active: input.active, items: edited.items, v: 1 }];
  }
  if ((await saveItems(tx, 'kbShows', next, ref.version)) === null) return CHANGED;
  const changes: HistoryChange[] = [
    before
      ? { field: 'n', from: before.items.length, to: edited.items.length }
      : { field: 'n', to: edited.items.length },
  ];
  if (wasActive !== input.active || (!before && !input.active)) {
    changes.push({ field: 'active', from: wasActive, to: input.active });
  }
  const titles = showTitles(edited.items);
  if (!before || JSON.stringify(showTitles(before.items)) !== JSON.stringify(titles)) {
    changes.push({
      field: 'items',
      ...(before ? { from: toHistoryValue(showTitles(before.items)) } : {}),
      to: toHistoryValue(titles),
    });
  }
  await writePlatformHistory(tx, {
    entity: 'platform_dict',
    entityId: `kbshows:${stepId}`,
    action: before ? 'update' : 'create',
    changes,
  });
  return { ok: true, value: (await adminKbShow(tx, stepId))! };
}

/** «Вернуть автоматический» (прототип): свой сценарий удаляется, показ снова собирается сам. */
export async function adminKbShowAuto(
  tx: Tx,
  stepId: string,
  version: number,
): Promise<AdminKbSaveResult<AdminKbShow>> {
  const { ref } = await showsOf(tx);
  if (!ref) return NOT_FOUND;
  const found = itemsOf(ref.payload, StoredShow).find((x) => x.item.step === stepId);
  if (!found) return NOT_FOUND;
  if (versionOf(found.item) !== version) return CHANGED;
  const raws = ref.payload as RawItem[];
  const k = raws.findIndex((r) => isShowOf(r, found.item));
  const next = raws.filter((_, i) => i !== k);
  if ((await saveItems(tx, 'kbShows', next, ref.version)) === null) return CHANGED;
  await writePlatformHistory(tx, {
    entity: 'platform_dict',
    entityId: `kbshows:${stepId}`,
    action: 'delete',
    changes: [{ field: 'n', from: found.item.items.length }],
  });
  const show = await adminKbShow(tx, stepId);
  return show ? { ok: true, value: show } : NOT_FOUND;
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
  /** «Показы»: у шага свой сценарий. */
  own?: boolean;
  values: Record<string, string | number>;
  audit: AdminKbAudit;
}

/** «Создал», «Изменил», «Создано», «Изменено» строки; null — значение из наполнения, без правок. */
export interface AdminKbAudit {
  createdAt: string | null;
  createdBy: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

type KbRowBase = Omit<AdminKbRow, 'audit'>;

const NO_AUDIT: AdminKbAudit = {
  createdAt: null,
  createdBy: null,
  updatedAt: null,
  updatedBy: null,
};

const LIST_SECTION: Readonly<Record<KbAdminList, KbHistorySection>> = {
  steps: 'kbsteps',
  arts: 'kbarts',
  shows: 'kbshows',
};

/**
 * Служебные столбцы (прототип ui/grid.js, `auditCols`: у значений refDB пусто, правка ставит «Изменил»)
 * — по истории платформы значения (`<раздел>:<код>`, у «Показов» — сценарий шага): «Создано» —
 * последнее добавление, «Изменено» — последняя запись. Пишет только администратор платформы.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Д-29
async function kbAudits(tx: Tx, list: KbAdminList): Promise<Map<string, AdminKbAudit>> {
  const prefix = `${LIST_SECTION[list]}:`;
  const h = platformAuditLog;
  const created = sql`${h.action} = 'create'`;
  const rows = await tx
    .select({
      entityId: h.entityId,
      createdAt: sql<Date | null>`max(${h.at}) filter (where ${created})`.mapWith(h.at),
      created: sql<boolean>`bool_or(${created})`,
      updatedAt: sql<Date>`max(${h.at})`.mapWith(h.at),
    })
    .from(h)
    .where(
      and(
        eq(h.entity, 'platform_dict'),
        sql`${h.entityId} like ${`${prefix}%`}`,
        sql`${h.entityId} <> ${prefix}`,
      ),
    )
    .groupBy(h.entityId);
  return new Map(
    rows.map((r) => [
      r.entityId.slice(prefix.length),
      {
        createdAt: r.createdAt ? r.createdAt.toISOString() : null,
        createdBy: r.created ? PLATFORM_ADMIN_NAME : null,
        updatedAt: r.updatedAt.toISOString(),
        updatedBy: PLATFORM_ADMIN_NAME,
      },
    ]),
  );
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
  const [rows, audits] = await Promise.all([kbRowsOf(tx, list, t), kbAudits(tx, list)]);
  return rows.map((x) => ({ ...x, audit: audits.get(x.id) ?? NO_AUDIT }));
}

async function kbRowsOf(tx: Tx, list: KbAdminList, t: ListTexts): Promise<KbRowBase[]> {
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
  if (list === 'shows') return showRows(tx, t);
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

/**
 * «Показы» (прототип renderKbAdm, вкладка `shows`): шаги программы организаций по порядку; «Экран» —
 * экран сценария, иначе первый экран шага или его модуль; «Сделать сейчас» — у шага «Сделать»: по
 * сценарию (`doit`) или форма шага. Версия строки — версия своего сценария (нет — 0).
 */
async function showRows(tx: Tx, t: ListTexts): Promise<KbRowBase[]> {
  const [{ steps, groups }, { byStep }] = await Promise.all([businessSteps(tx), showsOf(tx)]);
  const yes = t('kbadm.v.yes');
  const no = t('kbadm.v.no');
  return steps.map((s) => {
    const show = byStep.get(s.id);
    const learn = kbFlag(s.learn);
    const active = show ? show.active !== false : true;
    return {
      id: s.id,
      version: show ? versionOf(show) : 0,
      active,
      isNew: false,
      star: false,
      canUp: false,
      canDown: false,
      own: !!show,
      values: {
        g: groups.find((g) => g.id === s.g)?.t ?? s.g,
        t: s.t,
        type: t(learn ? 'kbadm.step.type.look' : 'kbadm.step.type.do'),
        sc: t(show ? 'kbadm.v.sc.own' : 'kbadm.v.sc.auto'),
        // ОТКЛОНЕНИЕ: docs/deviations.md#Д-28
        scr: show?.scr || s.at?.[0] || stepOf(s).module || '',
        n: show ? show.items.length : 0,
        doit: learn
          ? t('kbadm.v.none')
          : t(show?.doit?.length ? 'kbadm.v.doit.show' : 'kbadm.v.doit.form'),
        active: active ? yes : no,
      },
    };
  });
}

/** Столбец строки из `jsonb_to_recordset`: ключи — постоянные имена столбцов, не ввод пользователя. */
const field = (key: string) => sql.raw(`"r"."${key}"`);

const SQL_TYPE: Readonly<Record<string, string>> = { int: 'integer' };

function recordset(list: KbAdminList, rows: readonly AdminKbRow[]): SQL {
  const records = rows.map((x, i) => ({
    ...x.values,
    id: x.id,
    ord: i + 1,
    created_at: x.audit.createdAt,
    updated_at: x.audit.updatedAt,
    created_by: x.audit.createdBy,
    updated_by: x.audit.updatedBy,
  }));
  const defs = [
    '"ord" integer',
    '"created_at" timestamptz',
    '"updated_at" timestamptz',
    '"created_by" text',
    '"updated_by" text',
  ];
  // Код строки — и у списка без столбца «Код» («Показы»).
  if (!KB_ADMIN_COLUMNS[list].some((c) => c.key === 'id')) defs.push('"id" text');
  for (const c of KB_ADMIN_COLUMNS[list]) defs.push(`"${c.key}" ${SQL_TYPE[c.type] ?? 'text'}`);
  return sql`jsonb_to_recordset(${JSON.stringify(records)}::jsonb) as r(${sql.raw(defs.join(', '))})`;
}

export function adminKbListColumns(list: KbAdminList): ListColumns {
  const columns: Record<string, ListColumn> = {};
  for (const c of KB_ADMIN_COLUMNS[list]) {
    columns[c.key] = { type: c.type, label: c.label, value: field(c.key) };
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
  /** Шаги программы организаций — для «Показ для шага»: код, модуль программы, название. */
  steps: { id: string; g: string; t: string }[];
}

const ShowRef = z.object({ step: z.string(), items: z.array(z.unknown()).catch([]) });

export async function adminKbMeta(tx: Tx): Promise<AdminKbMeta> {
  const [groups, articles, perms, shows, business] = await Promise.all([
    groupsOf(tx),
    adminKbArticles(tx),
    permissionNames(tx),
    readReference(tx, 'kbShows'),
    businessSteps(tx),
  ]);
  return {
    steps: business.steps.map((s) => ({ id: s.id, g: s.g, t: s.t })),
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
  if (section === 'kbshows') for (const s of await adminKbSteps(tx)) titles.set(s.id, s.t);
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
        label: String(title?.to ?? title?.from ?? '') || titles.get(code) || code,
        changes,
      };
    }),
  };
}
