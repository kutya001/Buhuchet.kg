import {
  CP_FAQ_ACTS,
  CP_FAQ_SECS,
  CP_HELP_EMPTY,
  CP_HELP_HINT_KEYS,
  CP_HELP_WELCOME_KEYS,
  CP_TOUR_ALT_SECS,
  CP_TOUR_SECS,
  cpAlsoClean,
  cpAnswerClean,
  cpFaqMove,
  cpFaqNewId,
  cpFaqNextOrd,
  cpGlossKey,
  cpTourMove,
  toHistoryValue,
  type CpFaq,
  type CpFaqAct,
  type CpFaqSec,
  type CpGloss,
  type CpHelp,
  type CpHelpDict,
  type CpHelpHintKey,
  type CpHelpWelcomeKey,
  type CpTourStep,
  type HistoryChange,
} from '@buhuchet/domain';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { readReference, saveReference } from './admin-gked';
import type { Db, Tx } from './client';
import { writeContractorPageHistory } from './contractor-page';
import { writePlatformHistory } from './platform-history';
import { platformReference } from './schema';

/*
 * Подсказки и обучение на странице контрагента (доработки 15.11.2026; прототип v120
 * modules/cp-help.js, admin/cp-help-admin.js): тексты — раздел `cpHelp` справочника
 * (`platform_reference`; в refDB.json — `kbUi.cpHelp`, наполнение кладёт его отдельной строкой, чтобы
 * правка в Админке не останавливала обновление остального `kbUi`). Один набор для всех организаций:
 * страница читает его после кода, экран кода — только «Что это за страница?». Правка — функцией
 * `app.admin_set_reference` (миграция 0156) той версии раздела, что видел администратор; каждая
 * правка — строкой истории платформы (`cpwel:<ключ>`, `cphints:<ключ>`, `cptour:<облачко>`,
 * `cpfaq:<вопрос>`, `cpgloss:<слово>`) в той же транзакции.
 */

export const CP_HELP_KEY = 'cpHelp';

const text = z.string().catch('');
const texts = <K extends string>(keys: readonly K[]) =>
  z
    .record(z.string(), z.unknown())
    .catch({})
    .transform((o) => {
      const out: Partial<Record<K, string>> = {};
      for (const k of keys) {
        const v = o[k];
        if (typeof v === 'string' && v) out[k] = v;
      }
      return out;
    });

const Tour = z.object({
  id: z.string().min(1),
  sec: z.enum(CP_TOUR_SECS),
  t: text,
  x: text,
  x2: z.string().optional().catch(undefined),
  on: z.boolean().catch(true),
});
const Faq = z.object({
  id: z.string().min(1),
  q: text,
  a: text,
  sec: z.enum(CP_FAQ_SECS).catch(''),
  act: z.enum(CP_FAQ_ACTS).catch(''),
  ord: z.number().int().catch(0),
  on: z.boolean().catch(true),
});
const Gloss = z.object({
  w: z.string().min(1),
  x: text,
  also: z.string().optional().catch(undefined),
});

/** Записи, которые не читаются, пропускаются — остальное раздела остаётся. */
const items = <T>(schema: z.ZodType<T>) =>
  z
    .array(z.unknown())
    .catch([])
    .transform((list) =>
      list.flatMap((x) => {
        const r = schema.safeParse(x);
        return r.success ? [r.data] : [];
      }),
    );

const HelpPayload = z
  .object({
    welcome: texts(CP_HELP_WELCOME_KEYS),
    tour: items(Tour),
    faq: items(Faq),
    gloss: items(Gloss),
    hints: texts(CP_HELP_HINT_KEYS),
  })
  .catch({ ...CP_HELP_EMPTY });

/** Раздел из базы: что не читается — пусто; у облачка «Готово!» «Шаг активен» — всегда да. */
export function parseCpHelp(payload: unknown): CpHelp {
  const h = HelpPayload.parse(payload ?? {});
  return {
    ...h,
    tour: h.tour.map((s) => {
      const step: CpTourStep = {
        id: s.id,
        sec: s.sec,
        t: s.t,
        x: s.x,
        on: s.sec === 'end' || s.on,
      };
      return s.x2 !== undefined ? { ...step, x2: s.x2 } : step;
    }),
    gloss: h.gloss.map((g) => (g.also ? { w: g.w, x: g.x, also: g.also } : { w: g.w, x: g.x })),
  };
}

/** Раздел `cpHelp`; нет его — пусто (страница без подсказок). */
export async function readCpHelp(db: Db | Tx): Promise<CpHelp> {
  const [row] = await db
    .select({ payload: platformReference.payload })
    .from(platformReference)
    .where(eq(platformReference.key, CP_HELP_KEY));
  return parseCpHelp(row?.payload);
}

/**
 * Что уходит странице (после кода): облачка и вопросы — только включённые, слова — с объяснением.
 * Какие из них показать при этом виде страницы, решает сама страница (`cpTourSteps`, `cpFaqList`).
 */
export function cpHelpForPage(h: CpHelp): CpHelp {
  return {
    welcome: h.welcome,
    tour: h.tour.filter((s) => s.on),
    faq: h.faq.filter((q) => q.on && q.q),
    gloss: h.gloss.filter((g) => g.w && g.x),
    hints: h.hints,
  };
}

/** Экран ввода кода: только «Что это за страница?» и объяснение — до кода больше ничего. */
export async function cpCodeHelp(db: Db): Promise<{ what: string; whatX: string }> {
  const h = await readCpHelp(db);
  return { what: h.hints.codeWhat ?? '', whatX: h.hints.codeWhatX ?? '' };
}

/**
 * Конец обзора страницы (прототип `cphTourEnd`): «Контрагент посмотрел обзор страницы» или «…закрыл
 * обзор на шаге N из M» — в историю контрагента. Вызывается в `withOrgContext` открытой страницы.
 */
export async function writeContractorPageTour(
  tx: Tx,
  contractorId: string,
  tour: { full: boolean; step: number; of: number },
): Promise<void> {
  const changes: HistoryChange[] = tour.full
    ? [{ field: 'of', to: tour.of }]
    : [
        { field: 'step', to: tour.step },
        { field: 'of', to: tour.of },
      ];
  await writeContractorPageHistory(tx, contractorId, 'page_tour', { changes });
}

/* ───────────── Админка ───────────── */

export interface AdminCpHelpView {
  help: CpHelp;
  version: number;
}

/** Раздел с версией для Админки; нет раздела — null. */
export async function adminCpHelp(tx: Tx): Promise<AdminCpHelpView | null> {
  const ref = await readReference(tx, CP_HELP_KEY);
  return ref ? { help: parseCpHelp(ref.payload), version: ref.version } : null;
}

export type AdminCpHelpEdit =
  | { op: 'welcome'; key: CpHelpWelcomeKey; text: string; version: number }
  | { op: 'hint'; key: CpHelpHintKey; text: string; version: number }
  | { op: 'tour'; id: string; t: string; x: string; x2?: string; on: boolean; version: number }
  | { op: 'tourMove'; id: string; dir: -1 | 1; version: number }
  | {
      op: 'faq';
      id?: string;
      /** Код нового вопроса из файла загрузки (у окна — нет: код придумывает сервер). */
      newId?: string;
      q: string;
      a: string;
      sec: CpFaqSec;
      act: CpFaqAct;
      on: boolean;
      /** «Порядок» из файла загрузки (у окна — нет: порядок меняют «Выше» / «Ниже»). */
      ord?: number;
      version: number;
    }
  | { op: 'faqMove'; id: string; dir: -1 | 1; version: number }
  | { op: 'faqDelete'; id: string; version: number }
  | { op: 'gloss'; was?: string; w: string; x: string; also: string; version: number }
  | { op: 'glossDelete'; w: string; version: number };

export type AdminCpHelpResult =
  | { ok: true; value: AdminCpHelpView }
  | { ok: false; reason: 'changed' | 'not_found' }
  | { ok: false; reason: 'invalid'; problem: 'cph_word_taken'; field: 'w' };

interface Applied {
  help: CpHelp;
  /** Строка истории: раздел и код записи, действие, что изменилось. */
  dict: CpHelpDict;
  code: string;
  action: 'create' | 'update' | 'delete';
  changes: HistoryChange[];
}

type ApplyFail = Exclude<AdminCpHelpResult, { ok: true }>;

const NOT_FOUND: ApplyFail = { ok: false, reason: 'not_found' };
const CHANGED_FAIL: ApplyFail = { ok: false, reason: 'changed' };
const CHANGED: AdminCpHelpResult = { ok: false, reason: 'changed' };

/** «Было → стало» по полям, которые поменялись. */
function diff(before: Readonly<Record<string, unknown>>, after: Readonly<Record<string, unknown>>) {
  return Object.keys(after)
    .filter((f) => JSON.stringify(before[f] ?? null) !== JSON.stringify(after[f] ?? null))
    .map((f) => ({ field: f, from: toHistoryValue(before[f]), to: toHistoryValue(after[f]) }));
}

/** Правка без изменений — запись не нужна. */
const same = (a: Applied | ApplyFail): boolean => 'help' in a && !a.changes.length;

/** Применить правку к разделу (без записи): новый раздел и строка истории, или отказ. */
export function applyCpHelpEdit(h: CpHelp, e: AdminCpHelpEdit, seed: number): Applied | ApplyFail {
  switch (e.op) {
    case 'welcome':
    case 'hint': {
      const help: CpHelp =
        e.op === 'welcome'
          ? { ...h, welcome: { ...h.welcome, [e.key]: e.text } }
          : { ...h, hints: { ...h.hints, [e.key]: e.text } };
      const was = (e.op === 'welcome' ? h.welcome[e.key] : h.hints[e.key]) ?? '';
      return {
        help,
        dict: e.op === 'welcome' ? 'cpwel' : 'cphints',
        code: e.key,
        action: 'update',
        changes: was === e.text ? [] : [{ field: 'text', from: was, to: e.text }],
      };
    }
    case 'tour': {
      const s = h.tour.find((x) => x.id === e.id);
      if (!s) return NOT_FOUND;
      const next: CpTourStep = {
        ...s,
        t: e.t,
        x: e.x,
        on: s.sec === 'end' ? true : e.on,
        ...(CP_TOUR_ALT_SECS.includes(s.sec) && e.x2 !== undefined ? { x2: e.x2 } : {}),
      };
      return {
        help: { ...h, tour: h.tour.map((x) => (x.id === s.id ? next : x)) },
        dict: 'cptour',
        code: s.id,
        action: 'update',
        changes: diff(
          s as unknown as Record<string, unknown>,
          next as unknown as Record<string, unknown>,
        ),
      };
    }
    case 'tourMove': {
      const tour = cpTourMove(h.tour, e.id, e.dir);
      if (!tour) return NOT_FOUND;
      const from = h.tour.findIndex((x) => x.id === e.id) + 1;
      return {
        help: { ...h, tour },
        dict: 'cptour',
        code: e.id,
        action: 'update',
        changes: [{ field: 'n', from, to: from + e.dir }],
      };
    }
    case 'faq': {
      const fields = {
        q: e.q,
        a: cpAnswerClean(e.a),
        sec: e.sec,
        act: e.act,
        on: e.on,
      };
      if (e.id === undefined) {
        const taken = new Set(h.faq.map((q) => q.id));
        if (e.newId !== undefined && taken.has(e.newId)) return CHANGED_FAIL;
        const id = e.newId ?? cpFaqNewId(seed, taken);
        const q: CpFaq = { id, ...fields, ord: e.ord ?? cpFaqNextOrd(h.faq) };
        return {
          help: { ...h, faq: [...h.faq, q] },
          dict: 'cpfaq',
          code: id,
          action: 'create',
          changes: diff({}, q as unknown as Record<string, unknown>),
        };
      }
      const q = h.faq.find((x) => x.id === e.id);
      if (!q) return NOT_FOUND;
      const next: CpFaq = { ...q, ...fields, ...(e.ord !== undefined ? { ord: e.ord } : {}) };
      const changes = diff(
        q as unknown as Record<string, unknown>,
        next as unknown as Record<string, unknown>,
      );
      return {
        help: { ...h, faq: h.faq.map((x) => (x.id === q.id ? next : x)) },
        dict: 'cpfaq',
        code: q.id,
        action: 'update',
        // Название вопроса — в строке истории, даже когда сам вопрос не менялся.
        changes:
          changes.length && !changes.some((c) => c.field === 'q')
            ? [...changes, { field: 'q', from: q.q, to: q.q }]
            : changes,
      };
    }
    case 'faqMove': {
      const faq = cpFaqMove(h.faq, e.id, e.dir);
      const q = h.faq.find((x) => x.id === e.id);
      if (!faq || !q) return NOT_FOUND;
      const to = faq.find((x) => x.id === e.id)!.ord;
      return {
        help: { ...h, faq },
        dict: 'cpfaq',
        code: q.id,
        action: 'update',
        changes: [
          { field: 'ord', from: q.ord, to },
          { field: 'q', from: q.q, to: q.q },
        ],
      };
    }
    case 'faqDelete': {
      const q = h.faq.find((x) => x.id === e.id);
      if (!q) return NOT_FOUND;
      return {
        help: { ...h, faq: h.faq.filter((x) => x.id !== q.id) },
        dict: 'cpfaq',
        code: q.id,
        action: 'delete',
        changes: [{ field: 'q', from: q.q }],
      };
    }
    case 'gloss': {
      const was = e.was === undefined ? null : h.gloss.find((g) => g.w === e.was);
      if (e.was !== undefined && !was) return NOT_FOUND;
      const key = cpGlossKey(e.w);
      if (h.gloss.some((g) => g !== was && cpGlossKey(g.w) === key)) {
        return { ok: false, reason: 'invalid', problem: 'cph_word_taken', field: 'w' };
      }
      const also = cpAlsoClean(e.also);
      const next: CpGloss = also ? { w: e.w, x: e.x, also } : { w: e.w, x: e.x };
      return {
        help: {
          ...h,
          gloss: was ? h.gloss.map((g) => (g === was ? next : g)) : [...h.gloss, next],
        },
        dict: 'cpgloss',
        code: next.w,
        action: was ? 'update' : 'create',
        changes: diff(was ? { w: was.w, x: was.x, also: was.also ?? '' } : {}, {
          w: next.w,
          x: next.x,
          also: next.also ?? '',
        }).filter((c) => was || (c.to !== '' && c.to !== null)),
      };
    }
    case 'glossDelete': {
      const g = h.gloss.find((x) => x.w === e.w);
      if (!g) return NOT_FOUND;
      return {
        help: { ...h, gloss: h.gloss.filter((x) => x !== g) },
        dict: 'cpgloss',
        code: g.w,
        action: 'delete',
        changes: [{ field: 'w', from: g.w }],
      };
    }
  }
}

/** Записать раздел и строку истории; null — раздел изменили между чтением и записью. */
export async function saveCpHelp(
  tx: Tx,
  a: Applied,
  version: number,
): Promise<AdminCpHelpView | null> {
  const saved = await saveReference(tx, CP_HELP_KEY, a.help, version);
  if (saved === null) return null;
  await writePlatformHistory(tx, {
    entity: 'platform_dict',
    entityId: `${a.dict}:${a.code}`,
    action: a.action,
    changes: a.changes,
  });
  return { help: a.help, version: saved };
}

/**
 * Правка одной записи «Страницы контрагента» той версии раздела, что видел администратор (прототип
 * cphTextDlg, cphTourDlg, cphFaqDlg, cphGlossDlg, «Выше» / «Ниже», «Удалить»). `seed` — число для кода
 * нового вопроса (прототип `Date.now()`). Правка без изменений ничего не пишет.
 */
export async function adminCpHelpEdit(
  tx: Tx,
  edit: AdminCpHelpEdit,
  seed: number,
): Promise<AdminCpHelpResult> {
  const ref = await adminCpHelp(tx);
  if (!ref) return NOT_FOUND;
  if (ref.version !== edit.version) return CHANGED;
  const a = applyCpHelpEdit(ref.help, edit, seed);
  if (!('help' in a)) return a;
  if (same(a)) return { ok: true, value: ref };
  const saved = await saveCpHelp(tx, a, ref.version);
  return saved ? { ok: true, value: saved } : CHANGED;
}
