import { isDmParamType, type DmParamType, type DmRewriteNote } from '@buhuchet/domain';
import { useSyncExternalStore } from 'react';

/*
 * Вкладки консоли запросов «Витрины данных» (доработки 27.11.2026: консоль запросов, блок 1, пункты 2 и
 * 5; этап 1, П4; прототип v166 `DMC`, `dmcState`, `dmcSave`, `dmConOpen`): недописанный запрос не
 * теряется при уходе с вкладки — держится в памяти страницы, а в браузере (localStorage) — только как
 * удобство: нет хранилища — всё работает и без него. Одна функция «открыть в консоли» — `consoleOpen`:
 * её зовут шаблон, метод API (П6) и потом сборщик (П9).
 */

/** Откуда пришёл запрос метода API: что заменено само и что заменить руками (блок 5, пункты 3–4). */
export interface ConsoleNotes {
  from: string;
  changed: DmRewriteNote[];
  replace: DmRewriteNote[];
  money: string[];
}

/** Шаблон, из которого открыт запрос: «Сохранить в шаблон» пишет в него (готовый — копией). */
export interface ConsoleTemplateRef {
  id: string;
  name: string;
  builtin: boolean;
}

export interface ConsoleTab {
  id: string;
  /** Пусто — «Запрос N» по номеру `n`. */
  name: string;
  n: number;
  sql: string;
  params: Record<string, string>;
  /** Типы параметров шаблона, открытого в консоли: в базу значения уходят с этим приведением. */
  types: Record<string, DmParamType> | null;
  tpl: ConsoleTemplateRef | null;
  /** Запрос «Моих запросов»: номер и версия записи. */
  mine: { id: string; version: number } | null;
  notes: ConsoleNotes | null;
  /**
   * Откуда вкладка (этап 2, П8–П9; прототип v167 `src`): «Заготовки» или «Собрать запрос» — на телефоне
   * её запрос показывается для запуска, как «Мои запросы» и шаблон.
   */
  src: ConsoleTabSource | null;
}

export type ConsoleTabSource = 'pre' | 'build';
const isSource = (v: unknown): v is ConsoleTabSource => v === 'pre' || v === 'build';

export type ConsoleSide = 'db' | 'api' | 'pre' | 'mine';

export interface ConsoleState {
  tabs: ConsoleTab[];
  cur: number;
  side: ConsoleSide;
  mineTab: 'mine' | 'hist';
  q: string;
  /** Открыть окно шаблона сразу после перехода («Создать шаблон на основе», П6). */
  toTemplate: string | null;
  /** Счётчик для названий «Запрос N». */
  seq: number;
  /**
   * «Выполнять как» (этап 2, П7; прототип v167 `DMC.as`): номер организации или пусто — «Администратор».
   * Организации, которой больше нет в списке, экран не предлагает и выполняет как администратор.
   */
  as: string | null;
}

/** Запрос новой вкладки (прототип `dmcNewTab`). */
export const CONSOLE_START_SQL =
  'SELECT c.name AS cp, c.inn\nFROM contractors c\nORDER BY c.name\nLIMIT 100';

let user = '';
let state: ConsoleState = fresh();
const listeners = new Set<() => void>();

const isNote = (v: unknown): v is DmRewriteNote =>
  !!v &&
  typeof v === 'object' &&
  typeof (v as DmRewriteNote).code === 'string' &&
  !!(v as DmRewriteNote).vars &&
  typeof (v as DmRewriteNote).vars === 'object';

/** Пометка метода API из браузера: прежний вид (строки) или испорченная — без пометки. */
function savedNotes(v: unknown): ConsoleNotes | null {
  const n = v as Partial<ConsoleNotes> | null;
  if (!n || typeof n !== 'object' || typeof n.from !== 'string') return null;
  const ok = (a: unknown): a is DmRewriteNote[] => Array.isArray(a) && a.every(isNote);
  if (!ok(n.changed) || !ok(n.replace) || !Array.isArray(n.money)) return null;
  return { from: n.from, changed: n.changed, replace: n.replace, money: n.money.map(String) };
}

/** Типы параметров из браузера: только известные (запись могли изменить руками). */
function savedTypes(v: unknown): Record<string, DmParamType> | null {
  if (!v || typeof v !== 'object') return null;
  const out = Object.entries(v as Record<string, unknown>).filter(
    (e): e is [string, DmParamType] => typeof e[1] === 'string' && isDmParamType(e[1]),
  );
  return out.length ? Object.fromEntries(out) : null;
}

function fresh(): ConsoleState {
  return {
    tabs: [],
    cur: 0,
    side: 'db',
    mineTab: 'mine',
    q: '',
    toTemplate: null,
    seq: 0,
    as: null,
  };
}

const storeKey = (u: string) => `bh_dmcon_${u}`;
const newId = () => `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function load(u: string): ConsoleState {
  const base = fresh();
  try {
    const raw = window.localStorage.getItem(storeKey(u));
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<ConsoleState>;
    const tabs = Array.isArray(saved.tabs)
      ? saved.tabs
          .filter(
            (x): x is ConsoleTab => !!x && typeof x.sql === 'string' && typeof x.name === 'string',
          )
          .map((x, k) => ({
            id: typeof x.id === 'string' ? x.id : newId(),
            name: x.name,
            n: typeof x.n === 'number' ? x.n : k + 1,
            sql: x.sql,
            params: x.params && typeof x.params === 'object' ? x.params : {},
            types: savedTypes(x.types),
            tpl: x.tpl ?? null,
            mine: x.mine ?? null,
            notes: savedNotes(x.notes),
            src: isSource(x.src) ? x.src : null,
          }))
      : [];
    return {
      ...base,
      tabs,
      cur: Math.max(0, Math.min(Number(saved.cur) || 0, tabs.length - 1)),
      seq: Number(saved.seq) || tabs.length,
      as: typeof saved.as === 'string' && saved.as ? saved.as : null,
    };
  } catch {
    return base;
  }
}

function save() {
  // Вход ещё не известен — в браузер не пишем: иначе вкладки легли бы под общий ключ.
  if (!user) return;
  try {
    const { tabs, cur, seq, as } = state;
    window.localStorage.setItem(storeKey(user), JSON.stringify({ tabs, cur, seq, as }));
  } catch {
    // Хранилища нет (частное окно, запрет): вкладки живут, пока открыта страница.
  }
}

function set(next: Partial<ConsoleState>, persist = true) {
  state = { ...state, ...next };
  if (persist) save();
  for (const l of listeners) l();
}

/** Состояние консоли пользователя: при смене входа — своё. */
function ensure(u: string) {
  if (u === user && state.tabs.length) return;
  if (u !== user) state = load(u);
  user = u;
  if (!state.tabs.length) {
    const seq = state.seq + 1;
    state = { ...state, seq, tabs: [makeTab({ name: '', sql: CONSOLE_START_SQL }, seq)], cur: 0 };
  }
}

function makeTab(o: Partial<ConsoleTab> & { name: string; sql: string }, seq: number): ConsoleTab {
  return {
    id: newId(),
    name: o.name,
    n: seq,
    sql: o.sql,
    params: o.params ?? {},
    types: o.types ?? null,
    tpl: o.tpl ?? null,
    mine: o.mine ?? null,
    notes: o.notes ?? null,
    src: o.src ?? null,
  };
}

export const consoleStore = {
  get: () => state,
  ensure,
  setSide: (side: ConsoleSide) => set({ side, q: '' }, false),
  setMineTab: (mineTab: 'mine' | 'hist') => set({ mineTab }, false),
  setQ: (q: string) => set({ q }, false),
  select: (cur: number) => set({ cur }),
  setAs: (as: string | null) => set({ as }),
  patch: (id: string, p: Partial<ConsoleTab>) =>
    set({ tabs: state.tabs.map((x) => (x.id === id ? { ...x, ...p } : x)) }),
  add: () => {
    const seq = state.seq + 1;
    set({
      seq,
      tabs: [...state.tabs, makeTab({ name: '', sql: '' }, seq)],
      cur: state.tabs.length,
    });
  },
  close: (i: number) => {
    let tabs = state.tabs.filter((_, k) => k !== i);
    let seq = state.seq;
    if (!tabs.length) {
      seq += 1;
      tabs = [makeTab({ name: '', sql: CONSOLE_START_SQL }, seq)];
    }
    const cur = Math.min(state.cur > i ? state.cur - 1 : state.cur, tabs.length - 1);
    set({ tabs, cur, seq });
  },
  /** Запрос «Моих запросов» удалён: вкладки с ним больше на него не ссылаются. */
  forgetMine: (id: string) =>
    set({ tabs: state.tabs.map((x) => (x.mine?.id === id ? { ...x, mine: null } : x)) }),
  takeToTemplate: () => {
    const id = state.toTemplate;
    if (id) set({ toTemplate: null }, false);
    return id;
  },
};

/** Что открыть в консоли: текст, значения параметров, название вкладки и откуда. */
export interface ConsoleOpen {
  sql: string;
  params?: Record<string, string>;
  types?: Record<string, DmParamType>;
  name: string;
  tpl?: ConsoleTemplateRef;
  mine?: { id: string; version: number };
  notes?: ConsoleNotes;
  src?: ConsoleTabSource;
  /** Сразу открыть окно шаблона с этим запросом. */
  toTemplate?: boolean;
}

/**
 * «Открыть в консоли» (прототип `dmConOpen`): вкладка того же шаблона или того же запроса «Моих
 * запросов» получает текст заново, иначе — новая вкладка. Переход на вкладку «Консоль» делает вызывающий.
 */
export function consoleOpen(userId: string, o: ConsoleOpen) {
  ensure(userId);
  let i = o.tpl
    ? state.tabs.findIndex((x) => x.tpl?.id === o.tpl!.id)
    : o.mine
      ? state.tabs.findIndex((x) => x.mine?.id === o.mine!.id)
      : -1;
  let { tabs, seq } = state;
  if (i < 0) {
    seq += 1;
    tabs = [...tabs, makeTab(o, seq)];
    i = tabs.length - 1;
  } else {
    tabs = tabs.map((x, k) =>
      k === i
        ? {
            ...x,
            // Новый номер вкладки: прежний результат не показывается (прототип `dmConOpen`: `res:null`).
            id: newId(),
            sql: o.sql,
            params: o.params ?? x.params,
            types: o.types ?? x.types,
            notes: o.notes ?? x.notes,
            ...(o.mine ? { mine: o.mine, name: o.name } : {}),
          }
        : x,
    );
  }
  set({ tabs, seq, cur: i, toTemplate: o.toTemplate ? tabs[i]!.id : null });
}

/**
 * Выход: стереть вкладки консоли всех входов из браузера и из памяти страницы — на общем компьютере
 * тексты запросов и значения параметров (ИНН, суммы) не остаются.
 */
export function forgetConsoleTabs() {
  user = '';
  state = fresh();
  try {
    const ls = window.localStorage;
    const keys: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k?.startsWith('bh_dmcon_')) keys.push(k);
    }
    for (const k of keys) ls.removeItem(k);
  } catch {
    // Хранилища нет — стирать нечего.
  }
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/**
 * Что рисует сервер и первый проход в браузере (до чтения localStorage): одна вкладка с начальным
 * запросом. Состояние модуля на сервере не трогается — оно общее для всех запросов страницы.
 */
const SERVER_STATE: ConsoleState = {
  ...fresh(),
  seq: 1,
  tabs: [makeTab({ name: '', sql: CONSOLE_START_SQL }, 1)].map((x) => ({ ...x, id: 'start' })),
};
const serverState = () => SERVER_STATE;

export function useConsoleState(userId: string): ConsoleState {
  if (typeof window !== 'undefined') ensure(userId);
  return useSyncExternalStore(subscribe, consoleStore.get, serverState);
}
