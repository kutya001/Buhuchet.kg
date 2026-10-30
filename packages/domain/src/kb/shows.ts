import type { KbStepDef } from './catalog';

/*
 * «Показать как» и «Обзор экрана» (ТЗ «База знаний» → «Уроки» → «Показать как», «Знакомые элементы»;
 * прототип ui/tour.js): из чего собирается показ и какие облачка пропускаются как знакомые. Тексты
 * облачков и сценарии шагов — refDB.json `kbShows` и `kbUi` (меняет администратор платформы), что
 * подсвечивать на экране продукта — `apps/web/src/kb/tour` (задаёт разработчик, docs/decisions.md
 * п. Г-5).
 */

/**
 * Действие перед облачком (прототип tAct): `row` — открыть первую запись списка, `menu` — меню «…»
 * первой строки, `add`, `cols`, `grp`, `opts`, `filter` — открыть эту кнопку списка, `stepgo` —
 * «Перейти» шага; объектом — `{ row: 'К сдаче' }`, `{ tab: 'Обслуживание' }`, `{ click, in, pop }`,
 * `{ menuWith }`, `{ rowWith }`, `{ nav: 'модуль.вкладка' }`.
 */
export type KbShowAction = string | Readonly<Record<string, string | number | boolean>>;

/** Раскрываемая часть показа: элементы экрана, окна или меню по порядку (прототип tExpand). */
export const KB_SHOW_AUTOS = [
  'screen',
  'tabs',
  'add',
  'plates',
  'boxes',
  'grid',
  'fields',
  'form',
  'card',
  'menu',
] as const;
export type KbShowAuto = (typeof KB_SHOW_AUTOS)[number];

/** Облачко сценария (refDB `kbShows[].items`). */
export interface KbShowItemDef {
  /** Элемент на ПК и, если другой, на телефоне — обозначение прототипа (`#og-save`, `#mbody .box`). */
  s?: string | null;
  m?: string | null;
  /** Заголовок и 1–3 предложения: за что отвечает и когда нажимать. */
  t?: string;
  x?: string;
  /** Где искать элемент: верхнее окно (`.modal`), открытое меню (`.pop`), рабочая область. */
  in?: string;
  /** Найти элемент по тексту; `up` — подняться от текста до этого элемента. */
  txt?: string;
  up?: string;
  /** Контекст: облачка одного контекста идут без закрытия окон; `pre` открывает его с экрана. */
  ctx?: string;
  pre?: readonly KbShowAction[];
  /** Что сделать внутри контекста: вкладка карточки, меню. */
  sub?: readonly KbShowAction[];
  auto?: KbShowAuto;
  /** «Общий элемент»: пройденный один раз, не показывается ни на одном экране. */
  common?: boolean;
  /** Карточка без блоков: только шапка, вкладки и кнопки. */
  noBody?: boolean;
}

/** Сценарий показа шага (refDB `kbShows`). */
export interface KbShowDef {
  id: string;
  /** Шаг урока. */
  step: string;
  /** Экран показа «модуль.вкладка». */
  scr?: string;
  items: readonly KbShowItemDef[];
  /** «Сделать сейчас»: что открыть вместо «Перейти» (форма из карточки записи). */
  doit?: readonly KbShowAction[];
  active?: boolean;
}

/** Последнее облачко: «Готово» (`done`, `end`), «Сделать сейчас» (`doit`), «Понятно, заполню» (`save`). */
export type KbShowKind = 'intro' | 'done' | 'doit' | 'end' | 'save';

/** Облачко показа, готовое к ключу знакомого элемента. */
export interface KbShowPoint {
  t?: string;
  x?: string;
  kind?: KbShowKind;
  /** Код общего элемента («На весь экран», «Столбцы», поиск, кнопки формы). */
  g?: string;
  common?: boolean;
  /** Экран облачка «модуль.вкладка». */
  scr?: string;
  /** Окно элемента: у формы — её заголовок, у карточки — `card:<модуль>`. */
  mt?: string;
  /** Ключ вместо названия (у шапки карточки название — запись, а элемент один). */
  ck?: string;
}

/** Ключ знакомого элемента не длиннее (ограничение и в базе). */
export const KB_KNOWN_KEY_MAX = 300;
/** Сколько знакомых элементов хранится у пользователя; больше — новые не запоминаются. */
export const KB_KNOWN_LIMIT = 3000;
/** Сколько ключей принимается за один запрос. */
export const KB_KNOWN_BATCH = 100;

const KNOWN_KEY = /^[gs]:\P{Cc}+$/u;

/** Ключ знакомого элемента принимается сервером: `g:` или `s:`, без управляющих символов. */
export function kbKnownKeyOk(key: string): boolean {
  return key.length <= KB_KNOWN_KEY_MAX && KNOWN_KEY.test(key);
}

/**
 * Ключ знакомого элемента (прототип tKnownKey; ТЗ «Знакомые элементы»): общий элемент — один на всю
 * систему (`g:` + код), свой — по экрану и окну (`s:` + экран | окно | название), так что поле «ИНН»
 * профиля организации и поле «ИНН» формы контрагента — разные элементы. Вступление и последнее
 * облачко знакомыми не становятся (null). Длинный ключ обрезается до `KB_KNOWN_KEY_MAX`.
 */
export function kbKnownKey(p: KbShowPoint, screen: string): string | null {
  if (p.kind || !p.t) return null;
  const key =
    p.g || p.common
      ? `g:${p.g || p.t}`
      : `s:${p.scr || screen}${p.mt ? `|${p.mt}` : ''}|${p.ck || p.t}`;
  return key.replace(/\p{Cc}+/gu, ' ').slice(0, KB_KNOWN_KEY_MAX);
}

/** Тексты облачков из `kbUi.ui`: заголовок и текст «Всё на этом экране вам уже знакомо». */
export interface KbShowTexts {
  allKnownT: string;
  allKnown: string;
}

/** Показ после пропуска знакомых: облачка и «Пропущено знакомых элементов: N» в первом из них. */
export interface KbSmartList<T> {
  list: T[];
  /** Сколько пропущено; null — ничего (или показ целиком по «Показать всё»). */
  skipped: number | null;
}

const isLast = (p: KbShowPoint) => !!p.kind && p.kind !== 'intro';

/**
 * Пропустить знакомые облачка (прототип tSmart; ТЗ: «знакомые элементы пропускаются, счётчик считает
 * только новые»): последнее облачко шага показывается всегда; если новых нет — показ из одного
 * последнего облачка, у «Готово» шага «Посмотреть» и обзора экрана — «Всё на этом экране вам уже
 * знакомо». `all` — «Показать всё»: показ целиком.
 */
export function kbSmartList<T extends KbShowPoint>(
  list: readonly T[],
  known: (key: string) => boolean,
  screen: string,
  texts: KbShowTexts,
  all = false,
): KbSmartList<T> {
  if (all) return { list: [...list], skipped: null };
  const keep = list.filter((p) => {
    const key = kbKnownKey(p, screen);
    return !key || !known(key);
  });
  const skipped = list.length - keep.length;
  if (!skipped) return { list: [...list], skipped: null };
  if (keep.some((p) => !p.kind)) return { list: keep, skipped };
  const last = keep.findLast(isLast) ?? keep[keep.length - 1];
  if (!last) return { list: [], skipped };
  const solo =
    last.kind === 'done' || last.kind === 'end'
      ? { ...last, t: texts.allKnownT, x: texts.allKnown }
      : { ...last };
  return { list: [solo], skipped };
}

/** Тексты вступления и последнего облачка шага и обзора (`kbUi.ui`). */
export type KbShowUiTexts = Readonly<Record<string, string>>;

const ui = (texts: KbShowUiTexts, key: string) => texts[key] ?? '';

/** Облачко сценария или служебное (вступление, последнее). */
export type KbShowEntry = KbShowItemDef & Pick<KbShowPoint, 'kind'>;

/**
 * Место шага без своего сценария (прототип tItemsForStep, ветка без `kbShows`): `add` — «Перейти»
 * открывает «+ Добавить» модуля (облачка кнопки и её пунктов), `place` — подсвечивает своё место
 * (одно облачко с названием шага), null — экран целиком.
 */
export type KbStepPlace = 'add' | 'place' | null;

/** Обозначение места шага из «Перейти» в облачке: продукт подставляет свой элемент. */
export const KB_SHOW_GO_TARGET = '@go';

/**
 * Облачка «Показать как» шага (прототип tItemsForStep): вступление с «зачем это нужно», сценарий из
 * `kbShows` (или собранный по виду шага: «Посмотреть» с экраном — экран целиком, «Сделать» — место из
 * «Перейти») и последнее облачко — «Готово» у «Посмотреть», «Сделать сейчас» у «Сделать».
 */
export function kbStepShowItems(
  step: Pick<KbStepDef, 't' | 'w' | 'learn' | 'at'>,
  show: KbShowDef | null,
  place: KbStepPlace,
  texts: KbShowUiTexts,
): KbShowEntry[] {
  const learn = step.learn === true || step.learn === 1;
  const intro: KbShowEntry = {
    t: step.t,
    x: [step.w ?? '', ui(texts, learn ? 'introLook' : 'introDo')].filter(Boolean).join(' '),
    kind: 'intro',
  };
  let items: readonly KbShowEntry[];
  if (show) items = show.items;
  else if (learn && step.at?.length) items = [{ auto: 'screen' }];
  else if (place === 'add') items = [{ auto: 'add' }];
  else if (place === 'place') items = [{ s: KB_SHOW_GO_TARGET, t: step.t, x: step.w ?? '' }];
  else items = [{ auto: 'screen' }];
  const fin: KbShowEntry = learn
    ? { t: ui(texts, 'finLookT'), x: ui(texts, 'finLook'), kind: 'done' }
    : { t: ui(texts, 'finDoT'), x: ui(texts, 'finDo'), kind: 'doit' };
  return [intro, ...items, fin];
}

/** Облачка «Обзора экрана» (прототип tItemsForScreen): `title` — «Обзор экрана: модуль · вкладка». */
export function kbScreenShowItems(title: string, texts: KbShowUiTexts): KbShowEntry[] {
  return [
    { t: title, x: ui(texts, 'introScreen'), kind: 'intro' },
    { auto: 'screen' },
    { t: ui(texts, 'finScreenT'), x: ui(texts, 'finScreen'), kind: 'end' },
  ];
}

/** Сценарий шага: первый активный (прототип tShowOf). */
export function kbShowOf(shows: readonly KbShowDef[], stepId: string): KbShowDef | null {
  return shows.find((s) => s.step === stepId && s.active !== false) ?? null;
}

const SCREEN = /^[a-z][a-z0-9-]{0,30}(\.[a-z][a-z0-9-]{0,30})?$/;

/** Экран «модуль» или «модуль.вкладка» для «Обзора экрана». */
export function kbScreenOk(screen: string): boolean {
  return SCREEN.test(screen);
}
