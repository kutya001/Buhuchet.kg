/*
 * Подсказки и обучение на странице контрагента (доработки 15.11.2026, пункты 1–7; прототип v120
 * modules/cp-help.js, admin/cp-help-admin.js): клиенты — не бухгалтеры, поэтому окно «Добро
 * пожаловать», обзор страницы по живому экрану, панель «Помощь» с частыми вопросами, «Словарик» и
 * подсказки в окнах действий. Тексты — один набор для всех организаций (раздел справочника `cpHelp`,
 * в прототипе `kbUi.cpHelp`); ведёт администратор платформы. Здесь — что показать при каком виде
 * страницы, разбор «Словарика» и проверки окон Админки.
 */

/** Тексты окна «Добро пожаловать» (прототип CPH_WEL) — в порядке строк Админки. */
export const CP_HELP_WELCOME_KEYS = [
  't',
  'lead',
  'repT',
  'repX',
  'payT',
  'payX',
  'filesT',
  'filesX',
  'filesXView',
  'go',
  'skip',
] as const;
export type CpHelpWelcomeKey = (typeof CP_HELP_WELCOME_KEYS)[number];

/** Подсказки в окнах и подписи «Помощи» (прототип CPH_HINT) — в порядке строк Админки. */
export const CP_HELP_HINT_KEYS = [
  'helpBtn',
  'helpTitle',
  'helpTour',
  'faqHead',
  'askAcc',
  'notFound',
  'glossHead',
  'actGoPay',
  'actPaid',
  'actUp',
  'actGoFiles',
  'actGoMoney',
  'actGoFee',
  'actGoReports',
  'actTg',
  'actCode',
  'paidSteps',
  'paidPick',
  'paidFile',
  'paidDone',
  'sendSum',
  'upHint',
  'upDone',
  'codeWhat',
  'codeWhatX',
  'emptyFiles',
  'emptyFilesView',
  'emptyReports',
  'emptyKpi',
  'emptyMoney',
] as const;
export type CpHelpHintKey = (typeof CP_HELP_HINT_KEYS)[number];

/**
 * Подстановки текста подсказки (прототип `cphFill`): у «Перечислить» — {месяц}, у «Отправить файл» —
 * {мб} и {файлов}, у пустых «Отчётов» — {год}. Администратор их не меняет.
 */
export const CP_HELP_HINT_VARS: Readonly<Partial<Record<CpHelpHintKey, readonly string[]>>> = {
  sendSum: ['месяц'],
  upHint: ['мб', 'файлов'],
  emptyReports: ['год'],
};

/** Что подсвечивает облачко обзора (прототип CPH_SECL): разделы страницы, кнопка «Помощь», конец. */
export const CP_TOUR_SECS = [
  'state',
  'main',
  'pay',
  'acc',
  'reports',
  'files',
  'money',
  'fee',
  'kpi',
  'contacts',
  'tg',
  'help',
  'end',
] as const;
export type CpTourSec = (typeof CP_TOUR_SECS)[number];

/** Облачка, у которых есть «Текст, если действие недоступно» (нет «Я оплатил» или «Отправить файл»). */
export const CP_TOUR_ALT_SECS: readonly CpTourSec[] = ['pay', 'files'];

/** К какому разделу относится частый вопрос (прототип CPH_QSEC): '' — вся страница. */
export const CP_FAQ_SECS = [
  '',
  'pay',
  'payTax',
  'payFee',
  'reports',
  'files',
  'money',
  'fee',
  'tg',
] as const;
export type CpFaqSec = (typeof CP_FAQ_SECS)[number];

/** Кнопка под ответом (прототип CPH_ACTS): '' — без кнопки, `colors` — метки отчётов вместо шагов. */
export const CP_FAQ_ACTS = [
  '',
  'goPay',
  'paid',
  'up',
  'goFiles',
  'goMoney',
  'goFee',
  'goReports',
  'tg',
  'code',
  'colors',
] as const;
export type CpFaqAct = (typeof CP_FAQ_ACTS)[number];

/** «Перейти к …»: в какой раздел (прототип CPH_GO). */
export const CP_FAQ_GO = {
  goPay: 'pay',
  goFiles: 'files',
  goMoney: 'money',
  goFee: 'fee',
  goReports: 'reports',
} as const satisfies Partial<Record<CpFaqAct, string>>;

/** Подпись кнопки ответа — подсказка `act<Действие>` (прототип `cphActL`). */
export function cpFaqActHint(act: Exclude<CpFaqAct, '' | 'colors'>): CpHelpHintKey {
  return `act${act[0]!.toUpperCase()}${act.slice(1)}` as CpHelpHintKey;
}

export interface CpTourStep {
  id: string;
  sec: CpTourSec;
  /** Заголовок облачка. */
  t: string;
  /** Текст облачка. */
  x: string;
  /** Текст, если действие недоступно (только у `pay` и `files`). */
  x2?: string;
  /** Шаг активен; у последнего облачка (`end`) всегда да. */
  on: boolean;
}

export interface CpFaq {
  id: string;
  q: string;
  /** Ответ: шаги с новой строки; у `colors` — строки «Метка» — объяснение. */
  a: string;
  sec: CpFaqSec;
  act: CpFaqAct;
  ord: number;
  on: boolean;
}

export interface CpGloss {
  /** Слово — как в тексте страницы, с маленькой буквы; сокращения — заглавными. */
  w: string;
  /** Объяснение простыми словами. */
  x: string;
  /** Другие формы на странице — через запятую. */
  also?: string;
}

export interface CpHelp {
  welcome: Partial<Record<CpHelpWelcomeKey, string>>;
  tour: CpTourStep[];
  faq: CpFaq[];
  gloss: CpGloss[];
  hints: Partial<Record<CpHelpHintKey, string>>;
}

export const CP_HELP_EMPTY: CpHelp = { welcome: {}, tour: [], faq: [], gloss: [], hints: {} };

/** Пределы длины полей окон Админки (прототип: `maxlength` полей). */
export const CP_HELP_MAX = {
  text: 600,
  tourTitle: 120,
  tourText: 300,
  question: 200,
  answer: 1000,
  word: 60,
  glossText: 300,
  also: 200,
} as const;

/**
 * Что сейчас видно на странице (прототип `cphVis`): обзор, «Добро пожаловать» и вопросы «Помощи»
 * показывают только это.
 */
export interface CpHelpView {
  /** Показанные разделы страницы (`main`, `pay`, `reports`…). */
  sections: ReadonlySet<string>;
  /** Карточки «Как оплатить»: налоги и обслуживание. */
  payTax: boolean;
  payFee: boolean;
  /** Есть «Я оплатил» (контрагент может отправлять файлы и есть карточка «Как оплатить»). */
  paid: boolean;
  /** Есть «Отправить файл». */
  up: boolean;
  /** Мест для Telegram больше нет («Подключить Telegram» недоступна). */
  tgFull: boolean;
  /** Код можно прислать в Telegram: к странице подключён хотя бы один Telegram. */
  code: boolean;
}

const has = (v: CpHelpView, s: string) => v.sections.has(s);

/** Подстановки `{имя}` (прототип `cphFill`): неизвестная остаётся как есть. */
export function cpHelpFill(text: string, vars: Readonly<Record<string, string | number>>): string {
  return text.replace(/\{([^}]+)\}/g, (m, k: string) => (vars[k] != null ? String(vars[k]) : m));
}

/** Слово с большой буквы (прототип `cphCap`): заголовок облачка «Словарика». */
export function cpHelpCap(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : '';
}

/**
 * Облачка обзора (прототип `cphTourList`): выключенные и облачка разделов, скрытых у контрагента, —
 * пропускаются (последнее «Готово!» — всегда); у «Как оплатить» без «Я оплатил» и у «Файлов» без
 * «Отправить файл» — «Текст, если действие недоступно». Счётчик «N из M» считает только эти облачка.
 */
export function cpTourSteps(help: CpHelp, v: CpHelpView): CpTourStep[] {
  return help.tour
    .filter((s) => s.sec === 'end' || s.on)
    .filter((s) => s.sec === 'end' || s.sec === 'state' || s.sec === 'help' || has(v, s.sec))
    .map((s) => {
      const alt = (s.sec === 'pay' && !v.paid) || (s.sec === 'files' && !v.up);
      return alt && s.x2 ? { ...s, x: s.x2 } : s;
    });
}

/** Виден ли вопрос (прототип `cphQVis`): вопросы о скрытых разделах не показываются. */
export function cpFaqShown(q: CpFaq, v: CpHelpView): boolean {
  if (q.sec === '') return true;
  if (q.sec === 'pay') return v.payTax || v.payFee;
  if (q.sec === 'payTax') return v.payTax;
  if (q.sec === 'payFee') return v.payFee;
  return has(v, q.sec);
}

/**
 * Можно ли нажать кнопку ответа сейчас (прототип `cphActOn`): нет — вместо кнопки «Спросите вашего
 * бухгалтера».
 */
export function cpFaqActOn(act: CpFaqAct, v: CpHelpView): boolean {
  if (act === 'goPay' || act === 'goFiles' || act === 'goMoney' || act === 'goFee') {
    return has(v, CP_FAQ_GO[act]);
  }
  if (act === 'goReports') return has(v, 'reports');
  if (act === 'paid') return v.paid;
  if (act === 'up') return v.up;
  if (act === 'tg') return has(v, 'tg') && !v.tgFull;
  if (act === 'code') return v.code;
  return false;
}

/** Вопросы «Помощи» (прототип `cphHelp`): включённые, с текстом вопроса, видимые — по «Порядку». */
export function cpFaqList(help: CpHelp, v: CpHelpView): CpFaq[] {
  return help.faq
    .filter((q) => q.on && q.q && cpFaqShown(q, v))
    .slice()
    .sort((a, b) => a.ord - b.ord);
}

/** Строки ответа: шаги — с новой строки, пустые убираются. */
export function cpAnswerLines(a: string): string[] {
  return a
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * «Что значат цвета у отчётов?» (прототип `cphLegend`): строки «Метка» — объяснение; метка — та же, что
 * у отчётов, объяснение — после тире. Строка без метки в кавычках — просто текст.
 */
export function cpLegendRows(a: string): { label: string; text: string }[] {
  return cpAnswerLines(a).map((l) => {
    const m = /^«([^»]+)»\s*[—–-]\s*(.+)$/.exec(l);
    return m ? { label: m[1]!, text: m[2]! } : { label: '', text: l };
  });
}

/** Три шага над полями «Я оплатил» (прототип `cphSteps`): подсказка `paidSteps` через «|». */
export function cpPaidSteps(text: string): string[] {
  return text
    .split('|')
    .map((x) => x.trim())
    .filter(Boolean);
}

/** «Словарик» по алфавиту (прототип: `localeCompare(…, 'ru')`). */
export function cpGlossSorted(gloss: readonly CpGloss[]): CpGloss[] {
  return gloss.filter((g) => g.w && g.x).sort((a, b) => a.w.localeCompare(b.w, 'ru'));
}

/* ───────────── «Словарик»: где подчёркивать ───────────── */

interface GlossAlt {
  /** Номер слова в «Словарике». */
  i: number;
  f: string;
  /** Сокращение (НДС, ГНС): только заглавными. */
  up: boolean;
}

export interface CpGlossIndex {
  alts: readonly GlossAlt[];
  rx: RegExp | null;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Поиск слов «Словарика» в тексте (прототип `cphGlossRx`): у одного слова — по основе (отчёт → отчёты,
 * отчётов; у слова от 5 букв на гласную, «й» или «ь» основа без последней буквы), у сочетаний — как
 * написано; «Другие формы» — ещё варианты через запятую; сокращения — только заглавными; «е» и «ё» не
 * различаются. Длинные варианты — раньше коротких.
 */
export function cpGlossIndex(gloss: readonly CpGloss[]): CpGlossIndex {
  const alts: GlossAlt[] = [];
  gloss.forEach((x, i) => {
    if (!x.w || !x.x) return;
    for (const f of [x.w, ...(x.also ?? '').split(',')].map((s) => s.trim()).filter(Boolean)) {
      alts.push({ i, f, up: f.length > 1 && f === f.toUpperCase() && /[A-ZА-ЯЁ]/.test(f) });
    }
  });
  alts.sort((a, b) => b.f.length - a.f.length);
  const pat = (a: GlossAlt) => {
    let s = a.f.toLowerCase();
    const stem = !/\s/.test(s) && !a.up;
    if (stem && s.length >= 5 && /[аеёиоуыэюяьй]$/.test(s)) s = s.slice(0, -1);
    const body = esc(s)
      .replace(/[её]/g, '[её]')
      .replace(/\s+/g, '\\s+');
    return `(?<![\\p{L}\\p{N}])${body}${stem ? '\\p{L}*' : ''}(?![\\p{L}\\p{N}])`;
  };
  let rx: RegExp | null = null;
  try {
    rx = alts.length ? new RegExp(alts.map((a) => `(${pat(a)})`).join('|'), 'giu') : null;
  } catch {
    rx = null;
  }
  return { alts, rx };
}

/** Кусок текста: строка или слово «Словарика» (`i` — номер слова). */
export type CpGlossPart = string | { i: number; text: string };

/**
 * Текст по кускам со словами «Словарика» (прототип `cphGloss`): каждое слово — один раз, первое
 * появление; слова из `used` (уже подчёркнутые в этом разделе) не подчёркиваются, найденные
 * добавляются в `used`. Сокращение в строчном написании не считается.
 */
export function cpGlossSplit(text: string, index: CpGlossIndex, used: Set<number>): CpGlossPart[] {
  const rx = index.rx;
  if (!rx || !text) return text ? [text] : [];
  const out: CpGlossPart[] = [];
  let last = 0;
  rx.lastIndex = 0;
  for (let m = rx.exec(text); m; m = rx.exec(text)) {
    const k = m.slice(1).findIndex((x) => x !== undefined);
    const a = index.alts[k];
    if (!a || used.has(a.i) || (a.up && m[0] !== m[0].toUpperCase())) {
      rx.lastIndex = m.index + 1;
      continue;
    }
    used.add(a.i);
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push({ i: a.i, text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/* ───────────── Админка: проверки окон ───────────── */

/**
 * Предложение длиннее 15 слов (прототип `cphLong`): подсказка администратору после сохранения — не
 * запрет.
 */
export function cpHelpLong(text: string): boolean {
  return text
    .split(/(?<=[.!?])\s+|\n/)
    .some((x) => x.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length > 15);
}

/** Слова «Словарика» сравниваются без регистра и «ё» (прототип `norm`). */
export function cpGlossKey(w: string): string {
  return w.trim().toLowerCase().replace(/ё/g, 'е');
}

/** Ответ частого вопроса — строки без пустых и без пробелов по краям (прототип `cphFaqDlg`). */
export function cpAnswerClean(a: string): string {
  return cpAnswerLines(a).join('\n');
}

/** «Другие формы» — через запятую с пробелом, без пустых (прототип `cphGlossDlg`). */
export function cpAlsoClean(also: string): string {
  return also
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(', ');
}

export type CpHelpProblem =
  | 'cph_text_required'
  | 'cph_text_long'
  | 'cph_title_required'
  | 'cph_question_required'
  | 'cph_answer_required'
  | 'cph_word_required'
  | 'cph_word_taken'
  | 'cph_gloss_text_required';

/** Новый код частого вопроса (прототип `'q' + Date.now().toString(36)`): из числа, которое даёт вызывающий. */
export function cpFaqNewId(seed: number, taken: ReadonlySet<string>): string {
  let n = Math.max(0, Math.floor(seed));
  for (;;) {
    const id = `q${n.toString(36)}`;
    if (!taken.has(id)) return id;
    n += 1;
  }
}

/** Следующий «Порядок» нового вопроса — после наибольшего (прототип `Math.max(0, …ord) + 1`). */
export function cpFaqNextOrd(faq: readonly CpFaq[]): number {
  return Math.max(0, ...faq.map((q) => q.ord)) + 1;
}

/**
 * Облачко «выше» или «ниже» (прототип: стрелки строки обзора): последнее «Готово!» не двигается и
 * остаётся последним. null — двигать некуда.
 */
export function cpTourMove(tour: readonly CpTourStep[], id: string, dir: -1 | 1): CpTourStep[] | null {
  const k = tour.findIndex((s) => s.id === id);
  const j = k + dir;
  if (k < 0 || j < 0 || j >= tour.length) return null;
  if (tour[k]!.sec === 'end' || tour[j]!.sec === 'end') return null;
  const next = tour.slice();
  [next[k], next[j]] = [next[j]!, next[k]!];
  return next;
}

/**
 * Вопрос «выше» или «ниже» (прототип: обмен «Порядком» с соседом по списку). null — двигать некуда.
 */
export function cpFaqMove(faq: readonly CpFaq[], id: string, dir: -1 | 1): CpFaq[] | null {
  const list = faq.slice().sort((a, b) => a.ord - b.ord);
  const k = list.findIndex((q) => q.id === id);
  const j = k + dir;
  if (k < 0 || j < 0 || j >= list.length) return null;
  const a = list[k]!;
  const b = list[j]!;
  // Одинаковый «Порядок» (после загрузки из Excel): сосед получает соседний номер.
  const [oa, ob] = a.ord === b.ord ? [b.ord + dir, a.ord] : [b.ord, a.ord];
  return faq.map((q) => (q.id === a.id ? { ...q, ord: oa } : q.id === b.id ? { ...q, ord: ob } : q));
}
