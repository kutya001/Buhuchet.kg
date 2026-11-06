'use client';

import { useEffect, useEffectEvent, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import {
  afterTransition,
  canScrollX,
  createTracker,
  finishMs,
  horizontalScroller,
  pagerFires,
  pagerOffset,
  reducedMotion,
  SWIPE_BACK_MS,
  SWIPE_EASE,
  SWIPE_EDGE,
  swipeAxis,
} from './gestures';

export interface CardPagerOptions {
  enabled: boolean;
  /** Вкладки карточки по порядку и текущая. */
  tabs: readonly string[];
  active: string;
  onSelect: (id: string) => void;
}

interface Gesture {
  x0: number;
  y0: number;
  dx: number;
  dir: 1 | -1;
  locked: boolean;
  hs: HTMLElement | null;
  tabs: readonly string[];
  i: number;
  /** Элемент под пальцем: касания слушаем на нём самом (см. `useCardPager`). */
  target: EventTarget;
  /** Неподвижная копия прежней вкладки, которая едет рядом с новой; нет — листать некуда. */
  snap: HTMLElement | null;
  /** Копия ряда вкладок с прежней вкладкой и настоящий ряд, скрытый до конца жеста. */
  oldRow: HTMLElement | null;
  row: HTMLElement | null;
  /** Прокрутка содержимого до жеста: отмена возвращает её. */
  scroll: number;
  width: number;
  /** Жест закончен, идёт анимация. */
  busy: boolean;
  /** Довести анимацию до конца сразу (один раз): новый свайп начинается с уже открытой вкладки. */
  fin: (() => void) | null;
}

/** Неподвижная копия для анимации: без id и имён полей, недоступна диктору, фокусу и касаниям. */
function still(node: HTMLElement): HTMLElement {
  const copy = node.cloneNode(true) as HTMLElement;
  copy.removeAttribute('id');
  copy.setAttribute('aria-hidden', 'true');
  copy.inert = true;
  for (const n of copy.querySelectorAll('[id],[name]')) {
    n.removeAttribute('id');
    n.removeAttribute('name');
  }
  return copy;
}

/**
 * Свайп влево и вправо по содержимому окна листает вкладки карточки по порядку (ТЗ «Управление
 * свайпами», прототип v73 ui/swipes.js formPager): соседняя вкладка въезжает рядом с текущей и едет
 * вместе с пальцем, переход — одной анимацией, без пустого экрана между вкладками; порог — треть
 * ширины или рывок, недотянутая протяжка возвращает всё на место; новый свайп, пока прошлый ещё
 * доезжает, сразу доводит прошлый до конца и листает дальше (прототип v74). На первой и последней
 * вкладке — сопротивление, по кругу не переходит. Не начинается в полях ввода, на ручке и шапке окна (там
 * тянут вниз) и у левого края экрана; широкая таблица сначала прокручивается сама. Направление
 * выбирается по первым 10 px, поэтому свайп вбок не закрывает окно.
 *
 * Как устроено: когда направление выбрано, вкладка переключается сразу, а на месте прежней остаётся
 * её неподвижная копия; ряд вкладок до конца жеста показывает прежнюю вкладку (тоже копией). Отмена —
 * копия возвращается на место, затем снова прежняя вкладка с прежней прокруткой. Касания слушаются
 * на элементе под пальцем: прежнее содержимое при переключении уходит со страницы, а касания,
 * начатые на элементе вне страницы, до окна уже не доходят.
 */
export function useCardPager(
  scroller: RefObject<HTMLElement | null>,
  page: RefObject<HTMLElement | null>,
  { enabled, tabs, active, onSelect }: CardPagerOptions,
) {
  const current = useEffectEvent(() => ({ tabs, i: tabs.indexOf(active) }));
  const select = useEffectEvent((id: string) => onSelect(id));
  const many = tabs.length > 1;

  useEffect(() => {
    const el = scroller.current;
    if (!enabled || !many || !el) return;
    const tracker = createTracker();
    let st: Gesture | null = null;

    const slide = (x: number, ms: number) => {
      const p = page.current;
      if (!p) return;
      p.style.transition = ms ? `transform ${ms}ms ${SWIPE_EASE}` : 'none';
      p.style.transform = x ? `translateX(${x}px)` : '';
    };

    /** Сдвиг `d`: копия прежней вкладки — на `d`, новая вкладка — рядом с ней. */
    const paint = (s: Gesture, d: number, ms: number) => {
      if (!s.snap) return slide(d, ms);
      s.snap.style.transition = ms ? `transform ${ms}ms ${SWIPE_EASE}` : 'none';
      s.snap.style.transform = d ? `translateX(${d}px)` : '';
      slide(d + s.dir * s.width, ms);
    };

    /** Убрать копии и вернуть ряд вкладок. */
    const unpin = (s: Gesture) => {
      s.snap?.remove();
      s.oldRow?.remove();
      if (s.row) s.row.hidden = false;
      el.style.position = '';
      s.snap = null;
    };

    /** Направление выбрано: вкладка переключается, прежняя остаётся рядом копией. */
    const begin = (s: Gesture): boolean => {
      const j = s.i + s.dir;
      const p = page.current;
      if (reducedMotion() || j < 0 || j >= s.tabs.length || !p) return true;
      const row = el.querySelector<HTMLElement>(':scope > [role="tablist"]');
      const box = el.getBoundingClientRect();
      const from = p.getBoundingClientRect();
      const snap = still(p);
      const oldRow = row ? still(row) : null;
      s.scroll = el.scrollTop;
      flushSync(() => select(s.tabs[j]!));
      // Вкладку не переключили (сначала спрашивают «Уйти без сохранения?») — жест не продолжается.
      // ОТКЛОНЕНИЕ: docs/deviations.md#О-4
      if (current().i !== j) return false;
      el.style.position = 'relative';
      Object.assign(snap.style, {
        position: 'absolute',
        left: `${from.left - box.left - el.clientLeft + el.scrollLeft}px`,
        top: `${from.top - box.top - el.clientTop + el.scrollTop}px`,
        width: `${from.width}px`,
        margin: '0',
        pointerEvents: 'none',
        willChange: 'transform',
      });
      el.append(snap);
      if (row && oldRow) {
        oldRow.style.pointerEvents = 'none';
        row.before(oldRow);
        row.hidden = true;
      }
      s.snap = snap;
      s.oldRow = oldRow;
      s.row = row;
      s.width = el.clientWidth;
      return true;
    };

    const detach = (s: Gesture) => {
      s.target.removeEventListener('touchmove', move as EventListener);
      s.target.removeEventListener('touchend', touchEnd as EventListener);
      s.target.removeEventListener('touchcancel', touchCancel as EventListener);
    };

    const start = (e: TouchEvent) => {
      const prev = st;
      st = null;
      // Новый свайп во время анимации прошлого: прошлый сразу доводится до конца (прототип v74).
      if (prev?.busy) prev.fin?.();
      else if (prev) {
        // Прошлый жест не закончился (касание потерялось): убираем его следы.
        detach(prev);
        unpin(prev);
        slide(0, 0);
      }
      const touch = e.touches[0];
      if (e.touches.length > 1 || !touch || touch.clientX < SWIPE_EDGE || !e.target) return;
      const target = e.target as HTMLElement;
      if (target.closest('input,textarea,select,[data-swipe-handle]')) return;
      const hs = horizontalScroller(target, el);
      if (hs === 'block') return;
      const now = current();
      if (now.i < 0) return;
      st = {
        x0: touch.clientX,
        y0: touch.clientY,
        dx: 0,
        dir: 1,
        locked: false,
        hs,
        ...now,
        target,
        snap: null,
        oldRow: null,
        row: null,
        scroll: 0,
        width: 0,
        busy: false,
        fin: null,
      };
      target.addEventListener('touchmove', move, { passive: false });
      target.addEventListener('touchend', touchEnd);
      target.addEventListener('touchcancel', touchCancel);
      tracker.reset();
      tracker.add(touch.clientX, touch.clientY, e.timeStamp);
    };

    function move(e: TouchEvent) {
      const touch = e.touches[0];
      const s = st;
      if (!s || s.busy || !touch) return;
      tracker.add(touch.clientX, touch.clientY, e.timeStamp);
      const dx = touch.clientX - s.x0;
      if (!s.locked) {
        const axis = swipeAxis(dx, touch.clientY - s.y0);
        if (!axis) return;
        // Вверх-вниз — прокрутка или протяжка окна вниз; таблица, которая ещё прокручивается вбок, —
        // сначала прокручивается она.
        if (axis === 'y' || (s.hs && canScrollX(s.hs, dx))) {
          detach(s);
          st = null;
          return;
        }
        s.locked = true;
        s.x0 = touch.clientX;
        s.dir = dx < 0 ? 1 : -1;
        if (!begin(s)) {
          detach(s);
          st = null;
          return;
        }
      }
      e.preventDefault();
      const next = s.i + s.dir;
      s.dx = pagerOffset(touch.clientX - s.x0, s.dir, next >= 0 && next < s.tabs.length);
      if (!reducedMotion()) paint(s, s.dx, 0);
    }

    function end(e: TouchEvent, cancelled: boolean) {
      const s = st;
      if (!s || s.busy) return;
      detach(s);
      if (!s.locked) {
        st = null;
        return;
      }
      const width = el!.clientWidth;
      const vx = tracker.velocity(e.timeStamp).x;
      const j = s.i + s.dir;
      const hasNext = j >= 0 && j < s.tabs.length;
      const fire = !cancelled && pagerFires({ dx: s.dx, vx, dir: s.dir, width, hasNext });
      if (!s.snap) {
        // Листать некуда (первая или последняя вкладка) или анимации выключены.
        st = null;
        if (fire) {
          flushSync(() => select(s.tabs[j]!));
          return slide(0, 0);
        }
        return slide(0, reducedMotion() ? 0 : SWIPE_BACK_MS);
      }
      s.busy = true;
      const snap = s.snap;
      const ms = reducedMotion() ? 0 : fire ? finishMs(width - Math.abs(s.dx), vx) : SWIPE_BACK_MS;
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        if (st === s) st = null;
        unpin(s);
        if (!fire) {
          // Отмена: снова прежняя вкладка, прокрутка как была.
          flushSync(() => select(s.tabs[s.i]!));
          el!.scrollTop = s.scroll;
        }
        slide(0, 0);
        const p = page.current;
        if (p) p.style.transition = '';
      };
      s.fin = done;
      paint(s, fire ? -s.dir * s.width : 0, ms);
      if (!ms) return done();
      afterTransition(snap, ms, done);
    }
    function touchEnd(e: TouchEvent) {
      end(e, false);
    }
    function touchCancel(e: TouchEvent) {
      end(e, true);
    }

    el.addEventListener('touchstart', start, { passive: true });
    return () => {
      el.removeEventListener('touchstart', start);
      if (st) {
        detach(st);
        unpin(st);
        st = null;
      }
    };
  }, [scroller, page, enabled, many]);
}
