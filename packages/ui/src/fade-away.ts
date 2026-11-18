'use client';

import { useLayoutEffect, type RefObject } from 'react';
import { reducedMotion } from './gestures';

/** Сколько живёт уходящая копия: уход — 140 мс (`--bu-t-exit`), запас — как у `fadeAway` прототипа. */
export const EXIT_MS = 150;

/** Чем заменить классы анимации у уходящей копии: `data-leave="animate-fade-out"`. */
const LEAVE_ATTR = 'data-leave';
/** Признаки открытого окна: у уходящей копии их нет — Esc, «Назад» и свайпы её не видят. */
const LIVE_ATTRS = [
  'data-overlay',
  'data-popover',
  'data-window',
  'data-open',
  'role',
  'aria-modal',
  'aria-label',
  'aria-labelledby',
  'tabindex',
];
/**
 * Что снимается и с вложенных элементов копии: признаки, по которым страница ищет открытое окно (у
 * `Modal` они стоят на самом окне внутри рамки), `id` и связь подписи с полем — на странице не должно
 * быть двух элементов с одним `id`, пока то же окно открывают заново.
 */
const INNER_DROPS = ['data-overlay', 'data-popover', 'data-window', 'aria-modal', 'for'];
/** Роли, по которым окно и меню находят на странице. */
const WINDOW_ROLES = new Set(['dialog', 'alertdialog', 'menu']);

/** Признаки открытого окна у вложенного элемента копии: какие атрибуты снять. */
export function innerDrops(el: {
  getAttribute(name: string): string | null;
  closest(selector: string): unknown;
}): string[] {
  const drops = INNER_DROPS.filter((a) => el.getAttribute(a) !== null);
  if (WINDOW_ROLES.has(el.getAttribute('role') ?? '')) drops.push('role');
  // Внутри рисунка `id` нужен его же частям (заливка `url(#…)`).
  if (el.getAttribute('id') !== null && !el.closest('svg')) drops.push('id');
  return drops;
}

/** Поле с паролем или одноразовым кодом: его значение в уходящую копию не переносится. */
export function secretField(type: string, autocomplete: string): boolean {
  return (
    type === 'password' ||
    /(^|\s)(one-time-code|new-password|current-password)(\s|$)/.test(autocomplete)
  );
}

/** Встроенное содержимое, которое в копии начало бы грузиться или играть заново. */
const HEAVY = 'iframe,video,audio,object,embed';

/**
 * Движения нет: в системе «уменьшить движение» или браузером управляют тесты (`navigator.webdriver`:
 * сквозные тесты сразу после закрытия окна ищут текст на странице — копия окна им бы мешала; так же
 * отключена заставка, apps/web/src/shell/brand-intro.tsx).
 */
export function motionOff(): boolean {
  return typeof window === 'undefined' || reducedMotion() || navigator.webdriver === true;
}

/**
 * Классы уходящей копии: анимации появления (и с условием: `max-md:animate-sheet-in`) сняты, вместо
 * них — классы ухода из `data-leave`. Остальные классы — как были.
 */
export function leaveClass(classes: string, leave: string): string {
  const kept = classes.split(/\s+/).filter((c) => c && !/(^|:)animate-/.test(c));
  return [...kept, ...leave.split(/\s+/).filter(Boolean)].join(' ');
}

/** Путь от `root` до `node` номерами детей. */
function pathOf(root: Element, node: Element): number[] | null {
  const path: number[] = [];
  let at: Element | null = node;
  while (at && at !== root) {
    const parent: Element | null = at.parentElement;
    if (!parent) return null;
    path.unshift(Array.prototype.indexOf.call(parent.children, at));
    at = parent;
  }
  return at === root ? path : null;
}

function follow(root: Element, path: readonly number[]): Element | null {
  let at: Element | null = root;
  for (const i of path) at = at?.children[i] ?? null;
  return at;
}

/**
 * Копия элемента для ухода (без поведения): классы анимации заменены на `data-leave`, признаки открытого
 * окна сняты, копия не нажимается и скрыта от экранного диктора. `scroll` — прокрутка частей оригинала.
 */
export function leaveCopy(node: HTMLElement, scroll: ReadonlyMap<Element, [number, number]>) {
  const copy = node.cloneNode(true) as HTMLElement;
  const places = [...scroll].map(([el, at]) => [pathOf(node, el), at] as const);
  const drawn = [...node.querySelectorAll('canvas')].map((c) => [pathOf(node, c), c] as const);
  const all = [copy, ...copy.querySelectorAll<HTMLElement>('*')];
  for (const el of all) {
    const leave = el.getAttribute(LEAVE_ATTR);
    if (leave !== null) {
      // Классы анимации появления (и с условием: `max-md:animate-sheet-in`) — на уход.
      el.setAttribute('class', leaveClass(el.getAttribute('class') ?? '', leave));
    }
    // Одинаковое имя переключателей вне формы сняло бы выбор у живого окна.
    if (el.getAttribute('type') === 'radio') el.removeAttribute('name');
    for (const attr of innerDrops(el)) el.removeAttribute(attr);
    // Введённый пароль и код в копию не попадают.
    if (el instanceof HTMLInputElement && secretField(el.type, el.autocomplete)) {
      el.value = '';
      el.removeAttribute('value');
    }
  }
  for (const attr of LIVE_ATTRS) copy.removeAttribute(attr);
  for (const el of copy.querySelectorAll(HEAVY)) {
    const stub = document.createElement('div');
    stub.setAttribute('class', el.getAttribute('class') ?? '');
    stub.setAttribute('style', el.getAttribute('style') ?? '');
    el.replaceWith(stub);
  }
  copy.setAttribute('aria-hidden', 'true');
  copy.setAttribute('data-leaving', '');
  copy.inert = true;
  copy.style.pointerEvents = 'none';
  return {
    copy,
    /** После вставки в страницу: прокрутка и нарисованное на холстах — как у оригинала. */
    restore() {
      for (const [path, [top, left]] of places) {
        const el = path && follow(copy, path);
        if (el) {
          el.scrollTop = top;
          el.scrollLeft = left;
        }
      }
      for (const [path, canvas] of drawn) {
        const el = path && follow(copy, path);
        if (!(el instanceof HTMLCanvasElement) || !canvas.width || !canvas.height) continue;
        try {
          el.getContext('2d')?.drawImage(canvas, 0, 0);
        } catch {
          // Холст с чужим содержимым не копируется — уйдёт пустым.
        }
      }
    },
  };
}

/**
 * Окно, меню или панель уходит плавно (прототип v131 `fadeAway`: элемент ещё 150 мс остаётся на экране с
 * классом `out`). Когда элемент `ref` исчезает — закрыли (`on` стал false) или убрали сам компонент, —
 * на его месте 150 мс остаётся копия с анимацией ухода из `data-leave`. Копия, а не сам элемент: окно
 * закрывают десятки экранов по-своему, и содержимое к моменту ухода уже может быть пустым.
 * Без движения (`motionOff`) копии нет — элемент исчезает сразу.
 */
export function useFadeAway(ref: RefObject<HTMLElement | null>, on: boolean): void {
  useLayoutEffect(() => {
    const node = ref.current;
    if (!on || !node || motionOff()) return;
    const parent = node.parentNode;
    // Прокрутку частей окна запоминаем заранее: у элемента, убранного со страницы, её уже не спросить.
    const scroll = new Map<Element, [number, number]>();
    const scrolled = (e: Event) => {
      const el = e.target;
      if (el instanceof Element) scroll.set(el, [el.scrollTop, el.scrollLeft]);
    };
    node.addEventListener('scroll', scrolled, { capture: true, passive: true });
    return () => {
      node.removeEventListener('scroll', scrolled, { capture: true });
      // Элемент на месте — это не закрытие (повторный запуск эффектов в режиме разработки).
      queueMicrotask(() => {
        if (node.isConnected || !parent?.isConnected) return;
        const { copy, restore } = leaveCopy(node, scroll);
        parent.appendChild(copy);
        restore();
        setTimeout(() => copy.remove(), EXIT_MS);
      });
    };
  }, [ref, on]);
}
