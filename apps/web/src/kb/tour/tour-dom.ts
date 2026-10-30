import {
  KB_SHOW_GO_TARGET,
  type KbShowAction,
  type KbShowAuto,
  type KbShowEntry,
  type KbShowPoint,
} from '@buhuchet/domain';
import type { KbShowUi } from '@buhuchet/shared';
import type { Translate } from '../../l10n/translate';
import {
  fieldForm,
  fieldText,
  formTitle,
  productRoot,
  productTarget,
  productUp,
  type TourRoot,
} from './kb-show-targets';

/*
 * Показ по живому экрану (прототип ui/tour.js — tExpand, tExp*, tAct, tPrep, tBase): какие облачки
 * будут на открытом экране и как привести экран к облачку (открыть карточку, меню, вкладку окна).
 * Элементы ищутся по меткам `data-*` общих компонентов и по `KB_SHOW_TARGETS`; невидимый элемент
 * (нет права, выключена функция, пустой список) в показ не попадает.
 */

/** Где элемент облачка и как его найти. */
export interface TourLoc {
  /** `doc` — весь экран (верхняя панель, вкладки, «+ Добавить»). */
  root: TourRoot | 'doc';
  /** Селектор продукта (`||` — «или»); на телефоне — `phone`, если задан. */
  sel?: string;
  phone?: string;
  /** Номер среди видимых таких же (блок, поле, пункт меню, найденные при раскрытии). */
  n?: number;
  /** Найти по тексту; `up` — подняться от текста до этого элемента. */
  txt?: string;
  up?: string;
}

/** Облачко, готовое к показу. */
export interface TourPoint extends KbShowPoint {
  loc?: TourLoc | null;
  ctx?: string | undefined;
  pre?: readonly KbShowAction[] | undefined;
  sub?: readonly KbShowAction[] | undefined;
  auto?: KbShowAuto | undefined;
  /** Пункты меню «…» строки: раскрываются, когда меню открыто. */
  gen?: 'menu';
  noBody?: boolean | undefined;
  in?: string | undefined;
}

/** Способ «+ Добавить» модуля; `separate` — своей кнопкой на ПК (на телефоне — в меню «+»). */
export interface TourAddItem {
  label: string;
  sub?: string | undefined;
  separate?: boolean | undefined;
}

/** Что показ берёт у оболочки и Базы знаний. */
export interface TourEnv {
  ui: KbShowUi;
  t: Translate;
  phone: () => boolean;
  /** Открытый экран «модуль.вкладка». */
  screen: () => string | null;
  /** Открытый модуль: название, описание, вкладки, способы «+ Добавить». */
  module: () => {
    id: string;
    title: string;
    desc: string;
    tabs: readonly { id: string; label: string; href: string }[];
    add: readonly TourAddItem[];
  } | null;
  /** Перейти на экран «модуль.вкладка». */
  navigate: (screen: string) => void;
  /** «Перейти» шага. */
  stepGo: (stepId: string) => void;
  /** Место шага из «Перейти» (облачко `@go` шага без своего сценария). */
  goTarget: (stepId: string) => { sel: string; phone?: string } | null;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

export const tourVisible = (el: Element | null | undefined): el is HTMLElement =>
  el instanceof HTMLElement &&
  el.isConnected &&
  el.getClientRects().length > 0 &&
  getComputedStyle(el).visibility !== 'hidden';

/** Видимые элементы корня по селектору; у корня не меню — без элементов открытых в нём меню. */
function visibleIn(root: ParentNode, sel: string, popover: boolean): HTMLElement[] {
  for (const one of sel.split(/\s*\|\|\s*/)) {
    let list: Element[];
    try {
      list = [...root.querySelectorAll(one)];
    } catch {
      continue;
    }
    const seen = list.filter(
      (el): el is HTMLElement =>
        tourVisible(el) && (popover || !el.parentElement?.closest('[data-popover]')),
    );
    if (seen.length) return seen;
  }
  return [];
}

const last = (sel: string) =>
  [...document.querySelectorAll(sel)].filter(tourVisible).at(-1) ?? null;
/** Верхнее открытое окно. */
export const topWindow = () => last('[data-window]');
const topPopover = () => last('[data-popover]');
const windowCount = () =>
  [...document.querySelectorAll('[data-window]')].filter(tourVisible).length;

function rootOf(root: TourLoc['root']): ParentNode | null {
  if (root === 'window') return topWindow();
  if (root === 'popover') return topPopover();
  if (root === 'main') return document.querySelector('main');
  return document;
}

/** Элемент облачка на экране; null — нет (облачко посередине, без подсветки). */
export function tourLocate(loc: TourLoc, phone: boolean): HTMLElement | null {
  const root = rootOf(loc.root);
  if (!root) return null;
  if (loc.txt) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!node.nodeValue?.includes(loc.txt) || !tourVisible(parent)) continue;
      const el = loc.up ? parent.closest(loc.up) : parent;
      if (tourVisible(el)) return el;
    }
    return null;
  }
  const sel = phone && loc.phone ? loc.phone : loc.sel;
  if (!sel) return null;
  const list = visibleIn(root, sel, loc.root === 'popover');
  return list[loc.n ?? 0] ?? list[0] ?? null;
}

/** Текст кнопки или вкладки: подпись, иначе `aria-label` и `title`. */
const labelOf = (el: Element) =>
  clean(el.textContent) || el.getAttribute('aria-label') || el.getAttribute('title') || '';

/** Ключ справочника по точному названию или по самому длинному началу («Выручка за» — «Выручка за 2026»). */
export function tourDictText(dict: Readonly<Record<string, string>> | undefined, label: string) {
  if (!dict) return '';
  if (dict[label] != null) return dict[label];
  const key = Object.keys(dict)
    .filter((k) => label.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return key ? dict[key]! : '';
}

/** Название без счётчиков: «Сотрудники 12» → «Сотрудники», «Основное 1 из 5» → «Основное». */
const stripCount = (s: string) => s.replace(/\s*\d+ из \d+.*$/, '').replace(/\s*\d+$/, '');
/** Название вкладки окна: `data-tab-label`, если в подписи есть номер или отметка, иначе подпись. */
const tabLabel = (el: Element) => el.getAttribute('data-tab-label') || stripCount(labelOf(el));
/** Заголовок блока без «· N»: «Файлы · 3» → «Файлы». */
const stripDot = (s: string) => s.replace(/\s*·\s*\d+.*$/, '').trim();

const isCta = (b: HTMLElement) =>
  (b instanceof HTMLButtonElement && b.type === 'submit') || b.classList.contains('bg-accent');

/** Действия, которые открывают меню: облачко внутри меню не закрывает его. */
const POP_ACTIONS = new Set(['menu', 'add', 'cols', 'grp', 'opts', 'filter']);
const GRID_BUTTONS: Record<string, string> = {
  cols: 'main [data-grid-columns-button]',
  grp: 'main [data-grid-group-button]',
  opts: 'main [data-grid-options-button]',
};
/** Строка списка: таблица на ПК и карточка на телефоне; бледные — только если других нет. */
const ROWS = 'main [data-grid] [data-id]';
const PLAIN_ROWS = 'main [data-grid] [data-id]:not([data-tone="muted"])';

/** Состояние показа, которое нужно движку: экран показа, контекст, окна, открытые до показа. */
export interface TourScene {
  sid: string | null;
  scr: string | null;
  ctx: string | null;
  /** Окна ниже этого числа остаются (форма, открытая «Сделать сейчас»). */
  mbase: number;
  /** Чем открыто текущее меню (`add`, `menu`, `cols`…): то же действие его не закрывает. */
  pop: string | null;
  on: boolean;
}

/**
 * Движок показа на экране продукта. Создаётся на каждый показ; `scene.on` false — показ закончен,
 * долгие шаги прерываются.
 */
export class TourDom {
  readonly scene: TourScene;

  constructor(
    private readonly env: TourEnv,
    scene: Partial<TourScene> = {},
  ) {
    this.scene = { sid: null, scr: null, ctx: null, mbase: 0, pop: null, on: true, ...scene };
  }

  private q(key: string): string {
    return this.env.ui.ui?.[key] ?? '';
  }

  private get phone() {
    return this.env.phone();
  }

  /** Экран готов: нет заготовок загрузки списка и окна (прототип tSettle). */
  async settle(min = 180) {
    await wait(min);
    for (let k = 0; k < 25; k++) {
      const busy = document.querySelector(
        'main [aria-busy="true"]:not(button), [data-window] [aria-busy="true"]:not(button)',
      );
      if (!busy) return;
      await wait(80);
    }
  }

  private click(sel: string, root: ParentNode = document): boolean {
    const el = visibleIn(root, sel, true)[0];
    if (!el) return false;
    el.click();
    return true;
  }

  /** Закрыть открытое меню: нажатие вне его (так закрывают меню и окошки общих компонентов). */
  async closePopovers() {
    this.scene.pop = null;
    if (!topPopover()) return;
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await wait(30);
  }

  /** Закрыть окна выше `keep` кнопкой «Закрыть» каждого. */
  async closeWindows(keep = this.scene.mbase) {
    for (let guard = 0; guard < 10 && windowCount() > keep; guard++) {
      const before = windowCount();
      const w = topWindow();
      w?.querySelector<HTMLElement>('[data-window-close]')?.click();
      for (let k = 0; k < 12 && windowCount() >= before; k++) await wait(50);
      if (windowCount() >= before) return;
    }
  }

  /** Перейти на экран и дождаться его. */
  async goScreen(scr: string) {
    if (this.env.screen() === scr) return;
    this.env.navigate(scr);
    for (let k = 0; k < 60 && this.env.screen() !== scr; k++) await wait(50);
    await this.settle(260);
  }

  /** Назад к экрану показа: без меню и окон, открытых показом (прототип tBase). */
  async base(scr: string | null) {
    await this.closePopovers();
    await this.closeWindows();
    if (scr) await this.goScreen(scr);
  }

  /** Привести экран к облачку: при смене контекста — к экрану и заново `pre`, внутри — только `sub`. */
  async prep(p: TourPoint) {
    const scr = p.scr || this.scene.scr;
    if (p.ctx !== this.scene.ctx || (scr && scr !== this.env.screen())) {
      await this.base(scr);
      for (const a of p.pre ?? []) await this.act(a);
      this.scene.ctx = p.ctx ?? null;
    }
    const opens = (p.sub ?? []).some((a) =>
      typeof a === 'string' ? POP_ACTIONS.has(a) : !!(a.pop || a.menuWith),
    );
    if (!opens) await this.closePopovers();
    for (const a of p.sub ?? []) await this.act(a);
  }

  /** Открыть меню действием `key` (повторно — не закрывать уже открытое). */
  private async openPop(key: string, sel: string, root?: ParentNode) {
    if (this.scene.pop === key && topPopover()) return;
    await this.closePopovers();
    if (this.click(sel, root)) this.scene.pop = key;
    await wait(120);
  }

  private menuLabels(): string[] {
    const pop = topPopover();
    return pop ? [...pop.querySelectorAll('[role=menuitem]')].map((x) => clean(x.textContent)) : [];
  }

  /** Действие перед облачком (прототип tAct). */
  async act(a: KbShowAction): Promise<void> {
    if (!this.scene.on) return;
    if (a === 'row') {
      if (!this.click(PLAIN_ROWS)) this.click(ROWS);
      await this.settle(320);
      return;
    }
    if (a === 'menu') return this.openPop('menu', 'main [data-row-menu]');
    if (a === 'add') {
      return this.openPop(
        'add',
        this.phone ? '[data-add-button="fab"]' : '[data-add-button="button"]',
      );
    }
    if (typeof a === 'string' && GRID_BUTTONS[a]) return this.openPop(a, GRID_BUTTONS[a]);
    if (a === 'filter') return this.openPop('filter', 'main [data-filter-button]');
    if (a === 'stepgo') {
      if (this.scene.sid) this.env.stepGo(this.scene.sid);
      await this.settle(520);
      return;
    }
    if (a === 'pop') return this.closePopovers();
    if (typeof a === 'string') return;
    if (typeof a.row === 'string') {
      const text = a.row;
      const row = visibleIn(document, ROWS, false).find((r) => r.textContent?.includes(text));
      if (!row) return this.act('row');
      row.click();
      await this.settle(320);
      return;
    }
    const withLabel = a.menuWith ?? a.rowWith;
    if (typeof withLabel === 'string') {
      // Меню «…» первой строки, где есть это действие (оно есть не у всех записей); `rowWith` —
      // карточка этой строки. Такой строки нет — как `menu` и `row`.
      const has = () => this.menuLabels().some((l) => l.includes(withLabel));
      if (a.menuWith && this.scene.pop === 'menu' && has()) return;
      for (const row of visibleIn(document, ROWS, false)) {
        const btn = row.querySelector<HTMLElement>('[data-row-menu]');
        if (!btn) continue;
        await this.closePopovers();
        btn.click();
        await wait(60);
        const ok = has();
        if (ok && a.menuWith) {
          this.scene.pop = 'menu';
          await wait(60);
          return;
        }
        await this.closePopovers();
        if (ok) {
          row.click();
          await this.settle(320);
          return;
        }
      }
      return this.act(a.menuWith ? 'menu' : 'row');
    }
    if (typeof a.click === 'string') {
      const sel = productTarget(a.click);
      const where = typeof a.in === 'string' ? productRoot(a.in) : undefined;
      const root = where === undefined ? document : where && rootOf(where);
      if (!sel || !root) return;
      if (a.pop) return this.openPop(`click:${a.click}`, sel, root);
      this.click(sel, root);
      await this.settle(260);
      return;
    }
    if (typeof a.tab === 'string') return this.cardTab(a.tab);
    if (typeof a.nav === 'string') {
      await this.goScreen(a.nav);
      return;
    }
  }

  /** Вкладка верхнего окна; на телефоне видна только текущая — остальные в её списке. */
  private async cardTab(label: string) {
    const find = () => {
      const w = topWindow();
      return w
        ? [...w.querySelectorAll<HTMLElement>('[role=tab]')].find((x) => tabLabel(x) === label)
        : undefined;
    };
    let tab = find();
    if (tab?.getAttribute('aria-selected') === 'true') return;
    if (!tab || !tourVisible(tab)) {
      topWindow()?.querySelector<HTMLElement>('[role=tab][aria-expanded]')?.click();
      await wait(80);
      tab = find();
    }
    if (!tab) return;
    tab.click();
    await this.settle(220);
  }

  /* ───────────── Раскрытие частей экрана ───────────── */

  private mod() {
    return this.env.module();
  }

  private title(): TourPoint[] {
    const m = this.mod();
    if (!m) return [];
    return [
      {
        loc: { root: 'doc', sel: '[data-page-title]' },
        t: m.title,
        x: this.env.ui.mods?.[m.id] || m.desc,
      },
    ];
  }

  private tabs(): TourPoint[] {
    const m = this.mod();
    if (!m) return [];
    const links = [...document.querySelectorAll<HTMLAnchorElement>('[data-tabrow] [role=tab]')];
    return links.flatMap((a) => {
      const href = a.getAttribute('href') ?? '';
      const tab = m.tabs.find((x) => x.href === href);
      if (!tab) return [];
      return [
        {
          loc: { root: 'doc', sel: `[data-tabrow] [role=tab][href="${CSS.escape(href)}"]` },
          t: this.env.t('kb.show.p.tab', { name: tab.label }),
          x: this.env.ui.tabs?.[`${m.id}.${tab.id}`] || this.q('tab').replace('{t}', tab.label),
        },
      ];
    });
  }

  /** Особые элементы экрана из `kbUi.els` (`at`: `top`, `body`, `end`). */
  private els(at: string): TourPoint[] {
    const scr = this.env.screen() ?? '';
    const mod = scr.split('.')[0];
    return (this.env.ui.els ?? []).flatMap((e) => {
      if ((e.at || 'body') !== at || !(e.scr === scr || e.scr === mod || e.scr === '*')) return [];
      const loc = this.locOf(e);
      if (!loc || !tourLocate(loc, this.phone)) return [];
      return [{ loc, t: e.t, x: e.x ?? '', ...(e.scr === '*' ? { g: `el:${e.id}` } : {}) }];
    });
  }

  /** Обозначение прототипа → элемент продукта; null — элемента в продукте нет. */
  locOf(p: {
    s?: string | null | undefined;
    m?: string | null | undefined;
    in?: string | undefined;
    txt?: string | undefined;
    up?: string | undefined;
  }): TourLoc | null {
    const where = productRoot(p.in);
    if (where === null) return null;
    const root = where ?? 'doc';
    if (p.txt) {
      if (!p.up) return { root, txt: p.txt };
      const up = productUp(p.up);
      return up ? { root, txt: p.txt, up } : null;
    }
    if (p.s === KB_SHOW_GO_TARGET) {
      const go = this.scene.sid ? this.env.goTarget(this.scene.sid) : null;
      return go ? { root, sel: go.sel, ...(go.phone ? { phone: go.phone } : {}) } : null;
    }
    const sel = productTarget(p.s);
    if (!sel) return null;
    const phone = p.m ? productTarget(p.m) : null;
    return { root, sel, ...(phone ? { phone } : {}) };
  }

  private add(): TourPoint[] {
    const m = this.mod();
    if (!m) return [];
    const { t, ui } = this.env;
    const out: TourPoint[] = [];
    for (const b of visibleIn(document, '[data-add-action]', false)) {
      const l = b.getAttribute('title') || labelOf(b);
      out.push({
        loc: { root: 'doc', sel: `[data-add-action="${CSS.escape(b.dataset.addAction ?? '')}"]` },
        t: t('kb.show.p.button', { name: l }),
        x: tourDictText(ui.buttons, l) || ui.addItems?.[l] || this.q('btn'),
      });
    }
    const items = m.add.filter((a) => this.phone || !a.separate);
    if (!items.length) return out;
    out.push({
      loc: { root: 'doc', sel: '[data-add-button="button"]', phone: '[data-add-button="fab"]' },
      t: this.phone ? t('kb.show.p.fab') : t('kb.show.p.add'),
      x:
        (ui.add?.[m.id] || this.q('add')) +
        (items.length > 1 ? ` ${this.q('addMenu').replace('{n}', String(items.length))}` : ''),
    });
    if (items.length > 1) {
      items.forEach((a, k) =>
        out.push({
          ctx: 'add',
          sub: ['add'],
          loc: { root: 'popover', sel: '[role=menuitem]', n: k },
          t: t('kb.show.p.item', { name: a.label }),
          x:
            ui.addItems?.[a.label] ||
            tourDictText(ui.buttons, a.label) ||
            a.sub ||
            this.q('addItem'),
        }),
      );
    }
    return out;
  }

  private plateText(label: string, now: string) {
    const scr = this.env.screen() ?? '';
    const own = tourDictText(this.env.ui.plates, label);
    const value = now.replace(/[.\s]+$/, '');
    const head = value ? `${this.env.t('kb.show.p.plate_now', { value })} ` : '';
    const pm = this.env.ui.plateMode ?? {};
    const mode = pm[scr] || pm[scr.split('.')[0]!] || 'filter';
    const key = { go: 'plateGo', tab: 'plateTab', info: 'plateInfo' }[mode] ?? 'plateFilter';
    return head + (own || this.q(key));
  }

  private plates(): TourPoint[] {
    return visibleIn(document, 'main [data-plate]', false).map((b) => {
      const l = clean(b.querySelector('[data-plate-label]')?.textContent);
      const now = [b.querySelector('[data-plate-value]'), b.querySelector('[data-plate-sub]')]
        .map((x) => clean(x?.textContent))
        .filter(Boolean)
        .join(' — ');
      return {
        loc: { root: 'doc', sel: `main [data-plate="${CSS.escape(b.dataset.plate ?? '')}"]` },
        t: this.env.t('kb.show.p.plate', { name: l }),
        x: this.plateText(l, now),
      };
    });
  }

  /** Блоки с заголовком (кроме блока со списком — список разбирается отдельно). */
  boxes(where: TourRoot = 'main'): TourPoint[] {
    const root = rootOf(where);
    if (!root) return [];
    const all = visibleIn(root, '[data-box]', where === 'popover');
    return all.flatMap((b, n) => {
      const h = b.querySelector(':scope > h3');
      if (!h || b.querySelector('[data-grid]') || b.closest('[data-grid]')) return [];
      const name = stripDot(clean((h.querySelector('.grow') ?? h).textContent));
      if (!name) return [];
      return [
        {
          loc: { root: where, sel: '[data-box]', n },
          t: this.env.t('kb.show.p.box', { name }),
          x: tourDictText(this.env.ui.boxes, name) || this.q('box'),
        },
      ];
    });
  }

  private grid(): TourPoint[] {
    const g = document.querySelector('main [data-grid]');
    if (!tourVisible(g)) return [];
    const { t, ui } = this.env;
    const P: TourPoint[] = [];
    const doc = (sel: string, phone?: string): TourLoc => ({
      root: 'doc',
      sel,
      ...(phone ? { phone } : {}),
    });
    const has = (sel: string) => visibleIn(document, sel, false).length > 0;
    const empty = g.querySelector('[data-empty-state]');
    if (tourVisible(empty)) {
      const what = clean((empty.querySelector('b') ?? empty).textContent);
      P.push({
        loc: doc('main [data-grid] [data-empty-state]'),
        t: t('kb.show.p.empty'),
        x: `${what}. ${this.q('empty')}`,
      });
      return P;
    }
    P.push({
      loc: doc('main [data-grid-count]'),
      t: t('kb.show.p.count'),
      x: this.q('gcount'),
      g: 'gcount',
    });
    if (has('main [data-grid-view]')) {
      P.push({
        loc: doc('main [data-grid-view]'),
        t: t('kb.show.p.view'),
        x: this.q('view'),
        g: 'view',
      });
    }
    P.push({ loc: doc(GRID_BUTTONS.grp!), t: t('kb.show.p.grp'), x: this.q('grp'), g: 'grp' });
    P.push({ loc: doc(GRID_BUTTONS.cols!), t: t('kb.show.p.cols'), x: this.q('cols'), g: 'cols' });
    P.push({
      ctx: 'cols',
      sub: ['cols'],
      loc: doc('[data-popover]'),
      t: t('kb.show.p.cols_menu'),
      x: this.q('colsMenu'),
      g: 'colsMenu',
    });
    P.push({ loc: doc(GRID_BUTTONS.opts!), t: t('kb.show.p.opts'), x: this.q('opts'), g: 'opts' });
    if (has('main [data-grid-export]')) {
      P.push({
        loc: doc('main [data-grid-export]'),
        t: t('kb.show.p.xls'),
        x: this.q('xls'),
        g: 'xls',
      });
    }
    const th = visibleIn(document, 'main [data-grid-scroll] thead th[data-column]', false).map(
      (x) => `«${clean((x.querySelector('.truncate') ?? x).textContent)}»`,
    );
    if (th.length) {
      const first = th.slice(0, 8).join(', ');
      const cols =
        th.length > 8 ? t('kb.show.p.thead_more', { cols: first, n: th.length - 8 }) : first;
      P.push({
        loc: doc('main [data-grid-scroll] thead tr'),
        t: t('kb.show.p.thead'),
        x: this.q('thead').replace('{cols}', cols),
      });
      if (has('main [data-grid-scroll] thead [data-filter-button]')) {
        P.push({
          loc: doc('main [data-grid-scroll] thead [data-filter-button]'),
          t: t('kb.show.p.filter_btn'),
          x: this.q('filterBtn'),
          g: 'filterBtn',
        });
        P.push({
          ctx: 'filter',
          sub: ['filter'],
          loc: doc('[data-popover]'),
          t: t('kb.show.p.filter'),
          x: this.q('filter'),
          g: 'filter',
        });
      }
    }
    const pick = 'main [data-grid-scroll] thead th:has(input[type=checkbox])';
    const pickCard = 'main [data-grid-cards] [data-id] input[type=checkbox]';
    if (has(`${pick}, ${pickCard}`)) {
      P.push({
        loc: doc(pick, pickCard),
        t: t('kb.show.p.select'),
        x: this.q('selall'),
        g: 'selall',
      });
    }
    const scr = this.env.screen() ?? '';
    P.push({
      loc: doc(`${PLAIN_ROWS} || ${ROWS}`),
      t: t('kb.show.p.row'),
      x: ui.rows?.[scr] || ui.rows?.[scr.split('.')[0]!] || this.q('row'),
    });
    if (has('main [data-row-menu]')) {
      P.push({
        loc: doc('main [data-row-menu]'),
        t: t('kb.show.p.row_menu'),
        x: this.q('rowMenu'),
        g: 'rowMenu',
      });
      P.push({ ctx: 'menu', sub: ['menu'], gen: 'menu' });
    }
    if (has('main [data-grid-footer]')) {
      P.push({
        loc: doc('main [data-grid-footer]'),
        t: t('kb.show.p.foot'),
        x: this.q('foot'),
        g: 'foot',
      });
    }
    return P;
  }

  /** Пункты открытого меню: по одному на действие. */
  menu(): TourPoint[] {
    const pop = topPopover();
    if (!pop) return [];
    return visibleIn(pop, '[role=menuitem]', true).map((b, n) => {
      const span = b.querySelector(':scope > span');
      const l = clean(span?.childNodes[0]?.textContent ?? labelOf(b));
      const sub = clean(span?.querySelector('span')?.textContent);
      return {
        ctx: 'menu',
        sub: ['menu'],
        loc: { root: 'popover', sel: '[role=menuitem]', n },
        t: this.env.t('kb.show.p.item', { name: l }),
        x: tourDictText(this.env.ui.acts, l) || sub || this.q('act'),
      };
    });
  }

  /**
   * Верхнее окно (прототип tExpModal): шапка, «На весь экран», вкладки, шкалы, поля формы или блоки
   * карточки, кнопки внизу. Знакомые элементы окна — по окну: у формы — по её заголовку, у карточки —
   * по модулю (название записи в заголовке у каждой своё).
   */
  windowParts(
    o: {
      form?: boolean;
      ctx?: string | undefined;
      pre?: readonly KbShowAction[] | undefined;
      noBody?: boolean | undefined;
    } = {},
  ): TourPoint[] {
    const w = topWindow();
    if (!w) return [];
    const { t, ui } = this.env;
    const form = !!o.form && w.dataset.windowKind !== 'card';
    const mod = (this.env.screen() ?? '').split('.')[0] ?? '';
    const kt = clean(w.querySelector('[data-window-head] h2')?.textContent);
    // Название записи в кавычках («Показатель «Выручка»») в ключ знакомого элемента не попадает: формы
    // разных записей — одно окно, а названия записей не хранятся у пользователя.
    const c = { ctx: o.ctx, pre: o.pre, mt: form ? formTitle(kt) : `card:${mod}` };
    const at = (sel: string, n?: number): TourLoc => ({
      root: 'window',
      sel,
      ...(n === undefined ? {} : { n }),
    });
    const P: TourPoint[] = [];
    P.push({
      ...c,
      loc: at('[data-window-head]'),
      t: form ? t('kb.show.p.form', { name: kt }) : t('kb.show.p.card', { name: kt }),
      ...(form ? {} : { ck: 'card' }),
      x:
        tourDictText(ui.forms, kt) ||
        (form ? '' : ui.cards?.[mod]) ||
        this.q(form ? 'form' : 'card'),
    });
    if (visibleIn(w, '[data-window-max]', false).length) {
      P.push({
        ...c,
        loc: at('[data-window-max]'),
        t: t('kb.show.p.max'),
        x: this.q('max'),
        g: 'max',
      });
    }
    visibleIn(w, '[data-window-body] [role=tablist] [role=tab]', false).forEach((tab, n) => {
      const l = tabLabel(tab);
      P.push({
        ...c,
        loc: at('[data-window-body] [role=tablist] [role=tab]', n),
        t: t('kb.show.p.tab', { name: l }),
        x: tourDictText(ui.ctabs, l) || this.q('ctab'),
      });
    });
    if (!o.noBody) {
      visibleIn(w, '[data-window-body] [data-status-scale]', false).forEach((s, n) => {
        const name = s.getAttribute('aria-label') || t('kb.show.p.scale_name');
        P.push({
          ...c,
          loc: at('[data-window-body] [data-status-scale]', n),
          t: t('kb.show.p.scale', { name }),
          x: this.q('scale'),
        });
      });
      if (form) P.push(...this.fields('window', c));
      else {
        P.push(
          ...this.boxes('window').map((b) => ({
            ...c,
            ...b,
            loc: b.loc ? { ...b.loc, sel: '[data-box]' } : null,
          })),
        );
      }
    }
    visibleIn(w, '[data-window-foot] button', false).forEach((b, n) => {
      const l = labelOf(b);
      const cta = isCta(b);
      if (!l || (form && !cta)) return;
      P.push({
        ...c,
        loc: at('[data-window-foot] button', n),
        t: t('kb.show.p.button', { name: l }),
        x:
          tourDictText(ui.buttons, l) ||
          (!form && ui.acts?.[l]) ||
          (cta ? this.q(form ? 'save' : 'cta') : this.q('btn')),
        ...(form && cta ? { kind: 'save' as const } : {}),
        ...(form ? { g: `formBtn:${l}` } : {}),
      });
    });
    return P;
  }

  /** Поля и переключатели формы: название, «обязательно», пояснение из справочника или подсказка. */
  fields(where: TourRoot, c: Partial<TourPoint> = {}): TourPoint[] {
    const root = rootOf(where);
    if (!root) return [];
    const { t, ui } = this.env;
    const P: TourPoint[] = [];
    // Форма полей: окно — по заголовку без названия записи, форма на странице — по экрану.
    const form = fieldForm(
      where === 'window'
        ? { title: clean(topWindow()?.querySelector('[data-window-head] h2')?.textContent) }
        : { screen: this.env.screen() },
      t,
    );
    visibleIn(root, '[data-field]', false).forEach((f, n) => {
      const label = f.querySelector(':scope > label');
      const l = clean(label?.childNodes[0]?.textContent);
      if (!l) return;
      const req = !!label?.querySelector('[aria-hidden="true"]');
      const hint = clean(f.querySelector(':scope > [data-hint]')?.textContent);
      const own = fieldText(ui.fields, l, form);
      P.push({
        ...c,
        loc: { root: where, sel: '[data-field]', n },
        t: req ? t('kb.show.p.required', { name: l }) : l,
        x: own || hint || this.q(req ? 'fieldReq' : 'fieldOpt'),
      });
    });
    visibleIn(root, '[data-check-row]', false).forEach((row, n) => {
      const text = row.querySelector(':scope > span');
      const b = text?.querySelector(':scope > b');
      const l = clean((b ?? text?.childNodes[0])?.textContent);
      if (!l) return;
      const hint = clean(
        [...(text?.children ?? [])]
          .filter((x) => x !== b)
          .map((x) => x.textContent)
          .join(' '),
      );
      P.push({
        ...c,
        loc: { root: where, sel: '[data-check-row]', n },
        t: t('kb.show.p.switch', { name: l }),
        x:
          fieldText(ui.fields, l, form) ||
          tourDictText(this.switchTexts(), l) ||
          hint ||
          this.q('check'),
      });
    });
    return P;
  }

  /** Пояснения переключателей по названию или его началу («Основной счёт — …»). */
  private switchTexts(): Record<string, string> {
    return Object.fromEntries(
      Object.entries(this.env.ui.fields ?? {}).flatMap(([k, v]) => (v.x ? [[k, v.x]] : [])),
    );
  }

  /** Полный обзор открытого экрана (прототип tExpScreen). */
  screen(): TourPoint[] {
    const { t } = this.env;
    const stats = visibleIn(document, '[data-stats-toggle]', false).length
      ? [
          {
            loc: { root: 'doc', sel: '[data-stats-toggle]' } as TourLoc,
            t: t('kb.show.p.stats'),
            x: this.q('stats'),
            g: 'stats',
          },
        ]
      : [];
    return [
      ...this.title(),
      ...this.tabs(),
      ...this.els('top'),
      ...this.add(),
      {
        loc: { root: 'doc', sel: '[role=search]', phone: '[data-search-open]' },
        t: t('kb.show.p.search'),
        x: this.q('search'),
        g: 'search',
      },
      ...stats,
      ...this.plates(),
      ...this.els('body'),
      ...this.boxes('main'),
      ...this.grid(),
      ...this.els('end'),
    ];
  }

  /**
   * Раскрыть автоматические части и проверить, что элементы видны (прототип tExpand): невидимые
   * пропускаются, облачка без элемента остаются.
   */
  async expand(items: readonly KbShowEntry[], scr: string | null): Promise<TourPoint[]> {
    const out: TourPoint[] = [];
    for (const it of items) {
      if (!this.scene.on) return out;
      const p: TourPoint = { ...it, scr: scr ?? undefined } as TourPoint;
      const auto = it.auto;
      if (auto) {
        const ctx = it.ctx || `auto:${auto}`;
        await this.prep({ ...p, ctx });
        const c = { ctx, pre: it.pre, sub: it.sub };
        let got: TourPoint[] = [];
        const where = it.in ? productRoot(it.in) : undefined;
        if (auto === 'screen') got = this.screen();
        else if (auto === 'add') got = this.add();
        else if (auto === 'grid') got = this.grid();
        else if (auto === 'boxes') got = where === null ? [] : this.boxes(where ?? 'main');
        else if (auto === 'plates') got = this.plates();
        else if (auto === 'tabs') got = this.tabs();
        else if (auto === 'fields') got = where === null ? [] : this.fields(where ?? 'main', c);
        else if (auto === 'card') got = this.windowParts({ ctx, pre: it.pre, noBody: it.noBody });
        else if (auto === 'form') {
          got = this.windowParts({ ctx, pre: it.pre, form: true }).map(({ kind: _, ...x }) => x);
        } else if (auto === 'menu')
          got = this.menu().map((x) => ({ ...x, ...c, sub: [...(c.sub ?? [])] }));
        const own = auto !== 'screen' && auto !== 'add' && auto !== 'grid';
        for (const g of got) {
          const q: TourPoint = { scr: p.scr, ...g };
          if (!g.ctx && own) {
            q.ctx = c.ctx;
            q.pre = c.pre;
            q.sub = q.sub ?? c.sub;
          }
          if (q.gen === 'menu') {
            await this.prep(q);
            out.push(...this.menu().map((x) => ({ ...x, scr: p.scr })));
            continue;
          }
          out.push(q);
        }
        continue;
      }
      if (!it.s && !it.txt) {
        out.push(p);
        continue;
      }
      const loc = this.locOf(it);
      if (!loc) continue;
      p.loc = loc;
      await this.prep(p);
      if (tourLocate(loc, this.phone)) out.push(p);
    }
    await this.base(scr);
    this.scene.ctx = null;
    return out;
  }

  /** Сколько открыто окон. */
  windows(): number {
    return windowCount();
  }
}
