import { formatSom } from '@buhuchet/domain';
import type { ActionEntry, IconName } from '@buhuchet/ui';

/*
 * Таблица ввода чисел «как в Excel» (прототип ui/extable.js, exTable; стили css/extable.css): все
 * таблицы ввода «Показателей» и вкладка «Показатели» карточки контрагента.
 *
 * Выделение: щелчок, протягивание мышью, Shift+щелчок, Shift+стрелки, щелчок по заголовку столбца или
 * строки, Ctrl+A. Ввод: начните печатать — значение ячейки заменится; F2 или двойной щелчок — правка
 * текущего значения; Enter — сохранить и вниз (Shift+Enter — вверх), Tab — вправо, Esc — отменить
 * правку; стрелки — переход между ячейками (при вводе с клавиатуры тоже сохраняют). Delete или
 * Backspace — стереть выделенное; Ctrl+C, Ctrl+X, Ctrl+V — блоком через буфер обмена (в Excel и из
 * Excel); одно значение, вставленное в выделенный диапазон, заполняет его весь; Ctrl+Enter — введённое
 * значение во все выделенные ячейки; Ctrl+D — заполнить вниз первой строкой выделения; Ctrl+Z —
 * отменить. Правая кнопка мыши — меню тех же действий. На телефоне нажатие на ячейку сразу открывает
 * ввод, «Далее» на клавиатуре сохраняет и переходит ниже.
 *
 * Ячейки данных рисует экран: `<td data-sr="строка" data-sc="столбец">`; заголовки столбцов —
 * `data-exc`, строк — `data-exr`. Таблица сама ищет ячейки после каждой перерисовки (React меняет
 * содержимое, выделение остаётся). Поле правки — поверх ячейки, а не внутри: содержимое ячейки
 * остаётся за React.
 *
 * ОТКЛОНЕНИЕ: docs/deviations.md#О-60 — в прототипе таблица создаётся заново при каждой отрисовке
 * экрана, здесь — живёт на экране всё время, а строки под теми же номерами могут смениться (другой
 * месяц, сортировка, перечитанный список). Поэтому выделение, поле правки и «Отменить» помнят ячейку
 * по ключу (`key`: контрагент, показатель, месяц) и после перерисовки идут за ней; ячейки, которой
 * больше нет на экране, — выделение и правка сбрасываются, отмена её пропускает.
 */

/** Ячейка: текст для правки и копирования, число в сотых (строка состояния), можно ли править и почему нет. */
export interface ExCell {
  t: string;
  n: number | null;
  ed: boolean;
  why: string;
}

/** Запись ячейки: текст (пустой — стереть). */
export interface ExWrite {
  r: number;
  c: number;
  t: string;
}

/** Как получена запись — от этого зависит текст уведомления. */
export type ExHow = 'enter' | 'paste' | 'clear' | 'fill' | 'undo';

/**
 * Итог записи: тексты, которые не числа, и ячейки, значение которых изменилось (для «Отменить»);
 * `failed` — сервер не записал (уведомление уже показано).
 */
export interface ExPutResult {
  bad: string[];
  changed: { r: number; c: number }[];
  failed?: boolean;
}

/** Подсказка строки состояния без выделения: текст и клавиши (`{ k }`) по порядку. */
export type ExHintItem = readonly (string | { k: string })[];

/** Тексты таблицы (из словаря). */
export interface ExTexts {
  keyboard: string;
  cell: string;
  value: string;
  locked: string;
  notNumber: (text: string) => string;
  summary: (how: ExHow, n: number, bad: readonly string[], skipped: number) => string;
  copied: string;
  fillNeedsRows: string;
  nothingToUndo: string;
  clipboardDenied: string;
  pressCtrlV: string;
  stat: {
    selected: string;
    filled: string;
    sum: string;
    avg: string;
    min: string;
    max: string;
    empty: string;
  };
  menu: {
    copy: string;
    cut: string;
    paste: string;
    fillDown: string;
    fillDownSub: string;
    clear: string;
    undo: string;
    undoReason: string;
  };
}

export interface ExOptions {
  rows: number;
  cols: number;
  get: (r: number, c: number) => ExCell;
  /** Что за ячейка (одна и та же при любой перерисовке); `null` — ячейки без значения. */
  key: (r: number, c: number) => string | null;
  put: (list: readonly ExWrite[], how: ExHow) => Promise<ExPutResult>;
  label?: (r: number, c: number) => string;
  /** Дополнительные пункты меню правой кнопки для ячейки. */
  menu?: (r: number, c: number) => ActionEntry[];
  /** Строка состояния (как внизу Excel): количество, сумма, среднее выделенного. */
  stat?: HTMLElement | null;
  hint?: readonly ExHintItem[];
  toast: (text: string, options?: { bad?: boolean; icon?: IconName }) => void;
  openMenu: (place: { x: number; y: number }, items: ActionEntry[]) => void;
  texts: ExTexts;
}

export interface Point {
  r: number;
  c: number;
}

interface Editing extends Point {
  mode: 'enter' | 'edit';
  t0: string;
}

/** Запись для «Отменить»: ячейка по ключу (и где была) и её прежний текст. */
export interface Undo extends Point {
  k: string | null;
  t: string;
}

/** Невидимый символ в поле клавиатуры: копирование работает только при выделенном тексте. */
const Z = '​';

const coarse = () =>
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

const statNumber = (n: number) => formatSom(Math.round(n), 'auto');

/** Ячейки таблицы по координатам из `data-sr`, `data-sc`. */
export function cellMap(root: ParentNode): HTMLElement[][] {
  const out: HTMLElement[][] = [];
  root.querySelectorAll<HTMLElement>('td[data-sr]').forEach((t) => {
    const r = Number(t.dataset.sr);
    const c = Number(t.dataset.sc);
    (out[r] ??= [])[c] = t;
  });
  return out;
}

/**
 * Вставка блока (прототип `paste`): одно значение в диапазон — во все ячейки; блок, который
 * укладывается в диапазон целое число раз, — повторяется; иначе — от левого верхнего угла.
 * Возвращает записи и новое выделение (для блока от угла).
 */
export function pasteWrites(
  text: string,
  sel: { r0: number; r1: number; c0: number; c1: number },
  size: { rows: number; cols: number },
): { writes: ExWrite[]; select?: { a: Point; e: Point } } {
  const block = String(text)
    .replace(/\r/g, '')
    .replace(/\n+$/, '')
    .split('\n')
    .map((l) => l.split('\t'));
  const bh = block.length;
  const bw = Math.max(...block.map((l) => l.length));
  const h = sel.r1 - sel.r0 + 1;
  const w = sel.c1 - sel.c0 + 1;
  const writes: ExWrite[] = [];
  const each = (f: (r: number, c: number) => void) => {
    for (let r = sel.r0; r <= sel.r1; r++) for (let c = sel.c0; c <= sel.c1; c++) f(r, c);
  };
  if (bh === 1 && bw === 1 && (h > 1 || w > 1)) {
    each((r, c) => writes.push({ r, c, t: block[0]![0]! }));
    return { writes };
  }
  if (h % bh === 0 && w % bw === 0 && (h > bh || w > bw)) {
    each((r, c) => writes.push({ r, c, t: block[(r - sel.r0) % bh]![(c - sel.c0) % bw] ?? '' }));
    return { writes };
  }
  block.forEach((line, dr) =>
    line.forEach((t, dc) => {
      const r = sel.r0 + dr;
      const c = sel.c0 + dc;
      if (r < size.rows && c < size.cols) writes.push({ r, c, t });
    }),
  );
  return {
    writes,
    select: {
      a: { r: sel.r0, c: sel.c0 },
      e: {
        r: Math.min(size.rows - 1, sel.r0 + bh - 1),
        c: Math.min(size.cols - 1, sel.c0 + bw - 1),
      },
    },
  };
}

/** Текст выделения для буфера обмена: строки через перевод строки, ячейки — через табуляцию. */
export function selectionTsv(
  sel: { r0: number; r1: number; c0: number; c1: number },
  get: (r: number, c: number) => ExCell,
): string {
  const out: string[] = [];
  for (let r = sel.r0; r <= sel.r1; r++) {
    const line: string[] = [];
    for (let c = sel.c0; c <= sel.c1; c++) line.push(get(r, c).t);
    out.push(line.join('\t'));
  }
  return out.join('\n');
}

/** Ключи ячеек перерисовки (`keys[r][c]`) и где ячейка с ключом (`pos`). */
export function keyIndex(
  size: { rows: number; cols: number },
  key: (r: number, c: number) => string | null,
): { keys: (string | null)[][]; pos: Map<string, Point> } {
  const keys: (string | null)[][] = [];
  const pos = new Map<string, Point>();
  for (let r = 0; r < size.rows; r++) {
    const line: (string | null)[] = [];
    for (let c = 0; c < size.cols; c++) {
      const k = key(r, c);
      line.push(k);
      if (k !== null) pos.set(k, { r, c });
    }
    keys.push(line);
  }
  return { keys, pos };
}

/**
 * Где теперь ячейка, что стояла в `p` при прошлой перерисовке (`prev`); `null` — её больше нет на
 * экране. Ячейка без ключа остаётся на своём месте.
 */
export function follow(
  prev: readonly (readonly (string | null)[])[],
  pos: ReadonlyMap<string, Point>,
  p: Point,
  size: { rows: number; cols: number },
): Point | null {
  const k = prev[p.r]?.[p.c];
  const q = k == null ? p : (pos.get(k) ?? null);
  return q && q.r < size.rows && q.c < size.cols ? { r: q.r, c: q.c } : null;
}

/** Записи «Отменить» — туда, где ячейки сейчас; ячеек, которых нет на экране, — нет. */
export function undoWrites(list: readonly Undo[], pos: ReadonlyMap<string, Point>): ExWrite[] {
  return list.flatMap((x) => {
    const p = x.k === null ? x : pos.get(x.k);
    return p ? [{ r: p.r, c: p.c, t: x.t }] : [];
  });
}

/**
 * Таблица как в Excel над готовой разметкой: `wrap` — элемент с ячейками (обёртка таблицы или
 * списка), `layer` — пустой элемент с position: absolute в левом верхнем углу для поля клавиатуры и
 * поля правки (внутри прокрутки — поле едет вместе с таблицей, снаружи — переставляется при прокрутке).
 * `sync()` — после перерисовки ячеек; `destroy()` — при уходе с экрана.
 */
export class ExTable {
  private o: ExOptions;
  private C: HTMLElement[][] = [];
  private a: Point | null = null;
  private e: Point | null = null;
  private ed: Editing | null = null;
  private drag = false;
  private undoStack: Undo[][] = [];
  /** Ключи ячеек при последней перерисовке и где сейчас ячейка с ключом. */
  private keys: (string | null)[][] = [];
  private pos = new Map<string, Point>();
  private lit: HTMLElement[] = [];
  private readonly kb: HTMLTextAreaElement;
  private readonly inp: HTMLInputElement;
  private readonly off: (() => void)[] = [];

  constructor(
    private readonly wrap: HTMLElement,
    private readonly layer: HTMLElement,
    options: ExOptions,
  ) {
    this.o = options;
    const kb = document.createElement('textarea');
    kb.setAttribute('autocomplete', 'off');
    kb.spellcheck = false;
    kb.dataset.exKb = '';
    kb.className =
      'pointer-events-none fixed top-0 left-0 m-0 h-px w-px resize-none overflow-hidden border-0 p-0 opacity-0';
    this.kb = kb;
    const inp = document.createElement('input');
    inp.setAttribute('inputmode', 'decimal');
    inp.setAttribute('enterkeyhint', 'next');
    inp.autocomplete = 'off';
    inp.dataset.exIn = '';
    inp.hidden = true;
    inp.className =
      'absolute z-[1] m-0 box-border min-w-0 rounded-none border-0 bg-pane px-2.5 text-right text-ink tabular-nums shadow-[inset_0_0_0_2px_var(--bu-b-blue)] outline-none';
    this.inp = inp;
    layer.append(kb, inp);
    this.bind();
    this.sync();
  }

  /** Новые настройки (размер, данные) после перерисовки экрана. */
  update(options: ExOptions) {
    this.o = options;
    this.sync();
  }

  /**
   * Найти ячейки заново и перекрасить выделение (React перерисовал таблицу). Выделение и поле правки
   * идут за своей ячейкой по ключу; её нет — сбрасываются.
   */
  sync() {
    this.C = cellMap(this.wrap);
    const { rows, cols } = this.o;
    const prev = this.keys;
    ({ keys: this.keys, pos: this.pos } = keyIndex(this.o, this.o.key));
    const now = (p: Point) => follow(prev, this.pos, p, this.o);
    if (this.a && this.e) {
      const a = now(this.a);
      if (!a) {
        this.a = null;
        this.e = null;
      } else {
        const fit = (p: Point) => ({
          r: Math.max(0, Math.min(rows - 1, p.r)),
          c: Math.max(0, Math.min(cols - 1, p.c)),
        });
        this.e = fit({ r: this.e.r + a.r - this.a.r, c: this.e.c + a.c - this.a.c });
        this.a = a;
      }
    }
    if (this.ed) {
      const p = now(this.ed);
      if (!p) this.cancel();
      else {
        this.ed.r = p.r;
        this.ed.c = p.c;
        this.place();
      }
    }
    this.paint(false);
  }

  destroy() {
    this.off.forEach((f) => f());
    this.kb.remove();
    this.inp.remove();
    this.lit.forEach((t) => this.unmark(t));
  }

  focus() {
    this.kb.focus({ preventScroll: true });
  }

  pick(a: Point, e?: Point) {
    this.a = a;
    this.e = e ?? { ...a };
    this.paint(true);
  }

  get selection() {
    return this.a ? this.rect() : null;
  }

  private rect() {
    const a = this.a!;
    const e = this.e!;
    return {
      r0: Math.min(a.r, e.r),
      r1: Math.max(a.r, e.r),
      c0: Math.min(a.c, e.c),
      c1: Math.max(a.c, e.c),
    };
  }

  private inRange(p: Point) {
    if (!this.a) return false;
    const { r0, r1, c0, c1 } = this.rect();
    return p.r >= r0 && p.r <= r1 && p.c >= c0 && p.c <= c1;
  }

  private each(f: (r: number, c: number) => void) {
    const { r0, r1, c0, c1 } = this.rect();
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) f(r, c);
  }

  private unmark(t: HTMLElement) {
    delete t.dataset.exS;
    delete t.dataset.exA;
    delete t.dataset.exE;
  }

  private paint(scroll: boolean) {
    this.lit.forEach((t) => this.unmark(t));
    this.lit = [];
    if (this.a && this.e) {
      this.each((r, c) => {
        const t = this.C[r]?.[c];
        if (t) {
          t.dataset.exS = '';
          this.lit.push(t);
        }
      });
      const t = this.C[this.a.r]?.[this.a.c];
      if (t) {
        t.dataset.exA = '';
        this.lit.push(t);
      }
      if (this.ed) {
        const x = this.C[this.ed.r]?.[this.ed.c];
        if (x) {
          x.dataset.exE = '';
          this.lit.push(x);
        }
      }
      if (scroll)
        this.C[this.e.r]?.[this.e.c]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      this.kb.setAttribute(
        'aria-label',
        this.o.label ? this.o.label(this.a.r, this.a.c) : this.o.texts.cell,
      );
    } else {
      this.kb.setAttribute('aria-label', this.o.texts.keyboard);
    }
    this.stat();
  }

  private stat() {
    const box = this.o.stat;
    if (!box) return;
    const span = (label: string, value?: string, faint = false) => {
      const s = document.createElement('span');
      if (faint) s.className = 'text-faint';
      s.append(label);
      if (value !== undefined) {
        const b = document.createElement('b');
        b.textContent = value;
        s.append(' ', b);
      }
      return s;
    };
    const hint = () => {
      box.replaceChildren(
        ...(this.o.hint ?? []).map((h) => {
          const s = document.createElement('span');
          for (const part of h) {
            if (typeof part === 'string') s.append(part);
            else {
              const kbd = document.createElement('kbd');
              kbd.textContent = part.k;
              s.append(kbd);
            }
          }
          return s;
        }),
      );
    };
    if (!this.a) return hint();
    const { r0, r1, c0, c1 } = this.rect();
    const n = (r1 - r0 + 1) * (c1 - c0 + 1);
    if (n < 2) return hint();
    const ns: number[] = [];
    this.each((r, c) => {
      const g = this.o.get(r, c);
      if (g.n !== null) ns.push(g.n);
    });
    const T = this.o.texts.stat;
    const parts = [span(T.selected, String(n))];
    if (ns.length) {
      const sum = ns.reduce((x, y) => x + y, 0);
      parts.push(
        span(T.filled, String(ns.length)),
        span(T.sum, statNumber(sum)),
        span(T.avg, statNumber(sum / ns.length)),
        span(T.min, statNumber(Math.min(...ns))),
        span(T.max, statNumber(Math.max(...ns))),
      );
    } else parts.push(span(T.empty, undefined, true));
    box.replaceChildren(...parts);
  }

  private go(dr: number, dc: number, extend: boolean) {
    const { rows, cols } = this.o;
    if (!rows || !cols) return;
    const lim = (v: number, n: number) => Math.max(0, Math.min(n - 1, v));
    if (!this.a || !this.e) {
      this.a = { r: 0, c: 0 };
      this.e = { r: 0, c: 0 };
    } else if (extend) this.e = { r: lim(this.e.r + dr, rows), c: lim(this.e.c + dc, cols) };
    else {
      const p = { r: lim(this.a.r + dr, rows), c: lim(this.a.c + dc, cols) };
      this.a = p;
      this.e = { ...p };
    }
    this.paint(true);
  }

  /** Запись: только в доступные ячейки; отмена — прежние тексты изменённых ячеек. */
  private async write(list: readonly ExWrite[], how: ExHow) {
    const ok: (ExWrite & { t0: string; k: string | null })[] = [];
    const skip: ExCell[] = [];
    for (const x of list) {
      const g = this.o.get(x.r, x.c);
      if (g.ed) ok.push({ ...x, t0: g.t, k: this.o.key(x.r, x.c) });
      else if (String(x.t).trim() !== '') skip.push(g);
    }
    const res: ExPutResult = ok.length
      ? await this.o.put(
          ok.map(({ r, c, t }) => ({ r, c, t })),
          how,
        )
      : { bad: [], changed: [] };
    if (res.failed) return 0;
    // Пока сервер отвечал, список мог перерисоваться: ячейки для отмены — по ключу на момент записи.
    const before = new Map(ok.map((x) => [`${x.r}|${x.c}`, x]));
    const changed: Undo[] = res.changed.map((p) => {
      const x = before.get(`${p.r}|${p.c}`);
      return { ...p, k: x?.k ?? null, t: x?.t0 ?? '' };
    });
    if (changed.length && how !== 'undo') {
      this.undoStack.push(changed);
      if (this.undoStack.length > 100) this.undoStack.shift();
    }
    const T = this.o.texts;
    if (list.length === 1) {
      if (res.bad.length) this.o.toast(T.notNumber(res.bad[0]!), { bad: true, icon: 'alert' });
      else if (skip.length) this.o.toast(skip[0]!.why || T.locked, { bad: true, icon: 'lock' });
    } else {
      this.o.toast(T.summary(how, changed.length, res.bad, skip.length), {
        bad: res.bad.length > 0,
        icon: res.bad.length ? 'alert' : how === 'clear' ? 'trash' : 'check',
      });
    }
    this.paint(false);
    return changed.length;
  }

  /** Поле правки — поверх ячейки. */
  private place() {
    if (!this.ed) return;
    const t = this.C[this.ed.r]?.[this.ed.c];
    if (!t) return;
    // Слой поля стоит в левом верхнем углу своего блока: место — от него, и внутри прокрутки, и снаружи.
    const base = this.layer.getBoundingClientRect();
    const r = t.getBoundingClientRect();
    const s = this.inp.style;
    s.left = `${r.left - base.left}px`;
    s.top = `${r.top - base.top}px`;
    s.width = `${r.width}px`;
    s.height = `${r.height}px`;
  }

  /** Правка ячейки: `enter` — начали печатать (стрелки сохраняют и переходят), `edit` — F2 или двойной щелчок. */
  private edit(mode: 'enter' | 'edit', init: string | null, quiet = false) {
    if (!this.a) return false;
    const { r, c } = this.a;
    const g = this.o.get(r, c);
    if (!g.ed) {
      if (!quiet) this.o.toast(g.why || this.o.texts.locked, { bad: true, icon: 'lock' });
      return false;
    }
    if (!this.C[r]?.[c]) return false;
    this.ed = { r, c, mode, t0: g.t };
    const inp = this.inp;
    inp.value = init ?? g.t;
    inp.setAttribute('aria-label', this.o.label ? this.o.label(r, c) : this.o.texts.value);
    inp.hidden = false;
    this.place();
    this.paint(false);
    inp.focus({ preventScroll: true });
    const L = inp.value.length;
    try {
      if (mode === 'edit' && coarse()) inp.select();
      else inp.setSelectionRange(L, L);
    } catch {
      // поле без выделения текста
    }
    return true;
  }

  private close() {
    this.ed = null;
    this.inp.hidden = true;
  }

  private done(move: [number, number] | null, all = false) {
    const E = this.ed;
    if (!E) return;
    const v = this.inp.value;
    this.close();
    if (all) {
      const list: ExWrite[] = [];
      this.each((r, c) => list.push({ r, c, t: v }));
      void this.write(list, 'enter');
    } else if (v.trim() !== String(E.t0).trim())
      void this.write([{ r: E.r, c: E.c, t: v }], 'enter');
    else this.paint(false);
    if (move) this.go(move[0], move[1], false);
    if (move && coarse()) this.edit('edit', null, true);
    else if (!coarse()) this.focus();
  }

  private cancel() {
    if (!this.ed) return;
    this.close();
    this.paint(false);
    if (!coarse()) this.focus();
  }

  private paste(text: string) {
    if (!this.a) return;
    const { writes, select } = pasteWrites(text, this.rect(), this.o);
    if (select) {
      this.a = select.a;
      this.e = select.e;
    }
    void this.write(writes, 'paste');
  }

  private clear() {
    if (!this.a) return;
    const list: ExWrite[] = [];
    this.each((r, c) => list.push({ r, c, t: '' }));
    void this.write(list, 'clear');
  }

  private fillDown() {
    if (!this.a) return;
    const { r0, r1, c0, c1 } = this.rect();
    if (r1 === r0) {
      this.o.toast(this.o.texts.fillNeedsRows, { bad: true, icon: 'alert' });
      return;
    }
    const list: ExWrite[] = [];
    for (let c = c0; c <= c1; c++) {
      const t = this.o.get(r0, c).t;
      for (let r = r0 + 1; r <= r1; r++) list.push({ r, c, t });
    }
    void this.write(list, 'fill');
  }

  private undo() {
    // Ячейки отмены — там, где они сейчас; которых больше нет на экране, — не трогаются.
    const last = this.undoStack.pop();
    const u = last && undoWrites(last, this.pos);
    if (!u?.length) {
      this.o.toast(this.o.texts.nothingToUndo, { icon: 'info' });
      return;
    }
    const rs = u.map((x) => x.r);
    const cs = u.map((x) => x.c);
    this.a = { r: Math.min(...rs), c: Math.min(...cs) };
    this.e = { r: Math.max(...rs), c: Math.max(...cs) };
    void this.write(u, 'undo');
  }

  private arm() {
    this.kb.value = Z;
    this.kb.select();
  }

  private copyOut() {
    this.focus();
    this.arm();
    let ok: boolean;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    if (!ok && this.a) void navigator.clipboard?.writeText(selectionTsv(this.rect(), this.o.get));
    this.o.toast(this.o.texts.copied, { icon: 'copy' });
  }

  private cellOf(e: Event): (Point & { t: HTMLElement }) | null {
    const t = (e.target as HTMLElement).closest?.<HTMLElement>('td[data-sr]');
    if (!t || !this.wrap.contains(t)) return null;
    return { r: Number(t.dataset.sr), c: Number(t.dataset.sc), t };
  }

  private on<K extends keyof HTMLElementEventMap>(
    el: HTMLElement | Document,
    type: K,
    f: (e: HTMLElementEventMap[K]) => void,
  ) {
    el.addEventListener(type, f as EventListener);
    this.off.push(() => el.removeEventListener(type, f as EventListener));
  }

  private bind() {
    const { kb, inp, wrap } = this;
    this.on(kb, 'focus', () => {
      this.arm();
      if (!this.a && this.o.rows && this.o.cols) this.pick({ r: 0, c: 0 });
    });
    this.on(kb, 'keydown', (e) => {
      if (this.ed || !this.a || !this.e) return;
      const k = e.key;
      const ctl = e.ctrlKey || e.metaKey;
      const D = (
        { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] } as const
      )[k as 'ArrowUp'] as readonly [number, number] | undefined;
      const stop = () => e.preventDefault();
      if (D) {
        stop();
        return this.go(ctl ? D[0] * 1e6 : D[0], ctl ? D[1] * 1e6 : D[1], e.shiftKey);
      }
      if (k === 'Enter') return (stop(), this.go(e.shiftKey ? -1 : 1, 0, false));
      if (k === 'Tab') return (stop(), this.go(0, e.shiftKey ? -1 : 1, false));
      if (k === 'PageDown' || k === 'PageUp') {
        stop();
        return this.go(k === 'PageDown' ? 10 : -10, 0, e.shiftKey);
      }
      if (k === 'Home') {
        stop();
        return ctl ? this.pick({ r: 0, c: 0 }) : this.go(0, -1e6, e.shiftKey);
      }
      if (k === 'End') {
        stop();
        return ctl
          ? this.pick({ r: this.o.rows - 1, c: this.o.cols - 1 })
          : this.go(0, 1e6, e.shiftKey);
      }
      if (k === 'F2') return (stop(), void this.edit('edit', null));
      if (k === 'Delete' || k === 'Backspace') return (stop(), this.clear());
      if (k === 'Escape' && (this.a.r !== this.e.r || this.a.c !== this.e.c)) {
        stop();
        e.stopPropagation();
        return this.pick(this.a);
      }
      if (ctl && e.code === 'KeyA') {
        stop();
        this.a = { r: 0, c: 0 };
        this.e = { r: this.o.rows - 1, c: this.o.cols - 1 };
        return this.paint(false);
      }
      if (ctl && e.code === 'KeyZ') return (stop(), this.undo());
      if (ctl && e.code === 'KeyD') return (stop(), this.fillDown());
      if (!ctl && !e.altKey && k.length === 1) {
        stop();
        this.edit('enter', k);
      }
    });
    // Ввод через метод ввода (IME) и экранную клавиатуру: первый набранный текст начинает правку.
    this.on(kb, 'input', () => {
      const v = kb.value.replace(Z, '');
      this.arm();
      if (v && !this.ed && this.a) this.edit('enter', v);
    });
    this.on(kb, 'copy', (e) => {
      if (!this.a) return;
      e.preventDefault();
      e.clipboardData?.setData('text/plain', selectionTsv(this.rect(), this.o.get));
    });
    this.on(kb, 'cut', (e) => {
      if (!this.a) return;
      e.preventDefault();
      e.clipboardData?.setData('text/plain', selectionTsv(this.rect(), this.o.get));
      this.clear();
    });
    this.on(kb, 'paste', (e) => {
      if (!this.a) return;
      e.preventDefault();
      this.paste(e.clipboardData?.getData('text') ?? '');
    });

    this.on(inp, 'keydown', (e) => {
      const E = this.ed;
      if (!E) return;
      const k = e.key;
      if (k === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        return e.ctrlKey || e.metaKey
          ? this.done(null, true)
          : this.done(e.shiftKey ? [-1, 0] : [1, 0]);
      }
      if (k === 'Tab') {
        e.preventDefault();
        return this.done(e.shiftKey ? [0, -1] : [0, 1]);
      }
      if (k === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        return this.cancel();
      }
      const D = (
        { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] } as const
      )[k as 'ArrowUp'] as [number, number] | undefined;
      if (D && E.mode === 'enter') {
        e.preventDefault();
        return this.done([D[0], D[1]]);
      }
      e.stopPropagation();
    });
    this.on(inp, 'blur', () => {
      if (this.ed) this.done(null);
    });
    this.on(inp, 'paste', (e) => {
      const tx = e.clipboardData?.getData('text') ?? '';
      if (!/[\t\n]/.test(tx.replace(/[\r\n]+$/, ''))) return;
      e.preventDefault();
      this.cancel();
      this.paste(tx);
    });

    this.on(wrap, 'mousedown', (e) => {
      const target = e.target as HTMLElement;
      if (coarse() || e.button > 2 || target.closest('[data-ex-in],button,a,input,select,label')) {
        return;
      }
      const h = target.closest<HTMLElement>('[data-exc],[data-exr]');
      if (h && e.button === 0 && wrap.contains(h)) {
        e.preventDefault();
        if (this.ed) this.done(null);
        const last = { r: this.o.rows - 1, c: this.o.cols - 1 };
        if (h.dataset.exc != null) {
          const c = Number(h.dataset.exc);
          if (e.shiftKey && this.a) this.e = { r: last.r, c };
          else {
            this.a = { r: 0, c };
            this.e = { r: last.r, c };
          }
        } else {
          const r = Number(h.dataset.exr);
          if (e.shiftKey && this.a) this.e = { r, c: last.c };
          else {
            this.a = { r, c: 0 };
            this.e = { r, c: last.c };
          }
        }
        this.paint(false);
        return this.focus();
      }
      const p = this.cellOf(e);
      if (!p) return;
      if (e.button === 2 && this.inRange(p)) return this.focus();
      e.preventDefault();
      if (this.ed) this.done(null);
      if (e.shiftKey && this.a) this.e = { r: p.r, c: p.c };
      else {
        this.a = { r: p.r, c: p.c };
        this.e = { r: p.r, c: p.c };
      }
      this.drag = e.button === 0;
      this.paint(false);
      this.focus();
    });
    this.on(wrap, 'mouseover', (e) => {
      if (!this.drag || !this.e) return;
      const p = this.cellOf(e);
      if (p && (p.r !== this.e.r || p.c !== this.e.c)) {
        this.e = { r: p.r, c: p.c };
        this.paint(false);
      }
    });
    this.on(document, 'mouseup', () => {
      this.drag = false;
    });
    this.on(wrap, 'dblclick', (e) => {
      if (!coarse() && this.cellOf(e) && !this.ed) this.edit('edit', null);
    });
    this.on(wrap, 'click', (e) => {
      if (!coarse()) return;
      const p = this.cellOf(e);
      if (!p || (e.target as HTMLElement).closest('[data-ex-in]')) return;
      if (this.ed) this.done(null);
      this.a = { r: p.r, c: p.c };
      this.e = { r: p.r, c: p.c };
      this.paint(false);
      this.edit('edit', null);
    });
    // Прокрутка таблицы (и вложенной прокрутки списка): поле правки остаётся над своей ячейкой.
    const scrolled = () => this.place();
    wrap.addEventListener('scroll', scrolled, true);
    this.off.push(() => wrap.removeEventListener('scroll', scrolled, true));
    this.on(wrap, 'contextmenu', (e) => {
      const p = this.cellOf(e);
      if (!p || coarse()) return;
      e.preventDefault();
      if (!this.inRange(p)) {
        this.a = { r: p.r, c: p.c };
        this.e = { r: p.r, c: p.c };
        this.paint(false);
      }
      this.focus();
      const M = this.o.texts.menu;
      const extra = this.o.menu && this.a ? this.o.menu(this.a.r, this.a.c) : [];
      this.o.openMenu({ x: e.clientX, y: e.clientY }, [
        { id: 'copy', label: M.copy, icon: 'copy', sub: 'Ctrl+C', run: () => this.copyOut() },
        {
          id: 'cut',
          label: M.cut,
          icon: 'x',
          sub: 'Ctrl+X',
          run: () => {
            this.copyOut();
            this.clear();
          },
        },
        {
          id: 'paste',
          label: M.paste,
          icon: 'paste',
          sub: 'Ctrl+V',
          run: () => {
            if (!navigator.clipboard?.readText) {
              this.o.toast(this.o.texts.pressCtrlV, { bad: true, icon: 'alert' });
              return;
            }
            navigator.clipboard.readText().then(
              (t) => {
                this.focus();
                this.paste(t);
              },
              () => this.o.toast(this.o.texts.clipboardDenied, { bad: true, icon: 'alert' }),
            );
          },
        },
        { id: 'sep1', separator: true },
        {
          id: 'fill',
          label: M.fillDown,
          icon: 'down',
          sub: M.fillDownSub,
          run: () => this.fillDown(),
        },
        { id: 'clear', label: M.clear, icon: 'trash', sub: 'Delete', run: () => this.clear() },
        { id: 'sep2', separator: true },
        {
          id: 'undo',
          label: M.undo,
          icon: 'refresh',
          sub: 'Ctrl+Z',
          disabled: !this.undoStack.length,
          reason: M.undoReason,
          run: () => this.undo(),
        },
        ...(extra.length ? [{ id: 'sep3', separator: true } as const, ...extra] : []),
      ]);
    });
  }
}
