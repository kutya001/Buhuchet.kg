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

/**
 * Свайп влево и вправо по содержимому окна листает вкладки карточки по порядку (ТЗ «Управление
 * свайпами», прототип ui/swipes.js formPager): содержимое вкладки едет за пальцем, порог — треть
 * ширины или рывок; текущая вкладка уезжает, соседняя въезжает с другой стороны. На первой и
 * последней вкладке — сопротивление, по кругу не переходит. Не начинается на ряду вкладок, ручке и
 * шапке окна (там тянут вниз), в полях ввода и у левого края экрана; широкая таблица сначала
 * прокручивается сама. Направление выбирается по первым 10 px, поэтому свайп вбок не закрывает окно.
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
    let st: {
      x0: number;
      y0: number;
      dx: number;
      dir: 1 | -1;
      locked: boolean;
      hs: HTMLElement | null;
      tabs: readonly string[];
      i: number;
    } | null = null;

    const slide = (x: number, ms: number) => {
      const p = page.current;
      if (!p) return;
      p.style.transition = ms ? `transform ${ms}ms ${SWIPE_EASE}` : 'none';
      p.style.transform = x ? `translateX(${x}px)` : '';
    };

    const start = (e: TouchEvent) => {
      st = null;
      const touch = e.touches[0];
      if (e.touches.length > 1 || !touch || touch.clientX < SWIPE_EDGE) return;
      const target = e.target as HTMLElement;
      if (target.closest('input,textarea,select,[data-swipe-handle]')) return;
      const hs = horizontalScroller(target, el);
      if (hs === 'block') return;
      const now = current();
      if (now.i < 0) return;
      st = { x0: touch.clientX, y0: touch.clientY, dx: 0, dir: 1, locked: false, hs, ...now };
      tracker.reset();
      tracker.add(touch.clientX, touch.clientY, e.timeStamp);
    };

    const move = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!st || !touch) return;
      tracker.add(touch.clientX, touch.clientY, e.timeStamp);
      const dx = touch.clientX - st.x0;
      if (!st.locked) {
        const axis = swipeAxis(dx, touch.clientY - st.y0);
        if (!axis) return;
        // Вверх-вниз — прокрутка или протяжка окна вниз; таблица, которая ещё прокручивается вбок, —
        // сначала прокручивается она.
        if (axis === 'y' || (st.hs && canScrollX(st.hs, dx))) {
          st = null;
          return;
        }
        st.locked = true;
        st.x0 = touch.clientX;
        st.dir = dx < 0 ? 1 : -1;
      }
      e.preventDefault();
      const next = st.i + st.dir;
      st.dx = pagerOffset(touch.clientX - st.x0, st.dir, next >= 0 && next < st.tabs.length);
      if (!reducedMotion()) slide(st.dx, 0);
    };

    const end = (e: TouchEvent, cancelled = false) => {
      const s = st;
      st = null;
      if (!s?.locked) return;
      const width = el.clientWidth;
      const vx = tracker.velocity(e.timeStamp).x;
      const j = s.i + s.dir;
      const hasNext = j >= 0 && j < s.tabs.length;
      if (cancelled || !pagerFires({ dx: s.dx, vx, dir: s.dir, width, hasNext })) {
        slide(0, reducedMotion() ? 0 : SWIPE_BACK_MS);
        return;
      }
      const ms = reducedMotion() ? 0 : finishMs(width - Math.abs(s.dx), vx);
      // Новая вкладка въезжает с той стороны, куда шёл палец.
      const go = () => {
        flushSync(() => select(s.tabs[j]!));
        const p = page.current;
        if (!ms || !p) return slide(0, 0);
        slide(s.dir * width, 0);
        void p.offsetWidth;
        slide(0, ms);
        afterTransition(p, ms, () => {
          p.style.transition = '';
        });
      };
      if (!ms) return go();
      slide(-s.dir * width, ms);
      afterTransition(page.current ?? el, ms, go);
    };
    const touchEnd = (e: TouchEvent) => end(e);
    const touchCancel = (e: TouchEvent) => end(e, true);

    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', touchEnd);
    el.addEventListener('touchcancel', touchCancel);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', touchEnd);
      el.removeEventListener('touchcancel', touchCancel);
    };
  }, [scroller, page, enabled, many]);
}
