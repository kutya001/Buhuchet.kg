'use client';

import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
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
} from '../gestures';

export interface TabPagerProps {
  /** Вкладки модуля по порядку (id). */
  tabs: readonly string[];
  activeTab: string | null;
  /** Модуль: положение прокрутки запоминается для каждой его вкладки. */
  scope: string;
  /** Экран соседней вкладки — он въезжает, пока палец тянет страницу. */
  renderTab: (tabId: string) => ReactNode;
  /** Вкладка переключена жестом: сменить адрес (как нажатие на вкладку). */
  onSwipe: (tabId: string) => void;
  children: ReactNode;
}

const STACK = 'flex min-w-0 flex-col gap-3.5 max-md:gap-3';
/** Подсветка, которая едет по ряду вкладок за пальцем (прототип `.tab-ghost`). */
const GHOST =
  'pointer-events-none absolute top-0 bottom-0 z-[2] rounded-full border-2 border-brand-blue';

interface Gesture {
  x0: number;
  y0: number;
  dx: number;
  locked: boolean;
  /** Индекс текущей вкладки. */
  index: number;
  tabs: readonly string[];
  /** Таблица под пальцем, которая прокручивается вбок: сначала прокручивается она. */
  scroller: HTMLElement | null;
  /** Куда листаем: 1 — к следующей вкладке, -1 — к предыдущей. */
  dir: 1 | -1;
  /** Соседняя вкладка; нет — первая или последняя вкладка, страница тянется с сопротивлением. */
  to: string | null;
  from: HTMLElement | null;
  target: HTMLElement | null;
}

/**
 * Свайп влево или вправо по рабочей области листает вкладки модуля (ТЗ «Управление свайпами»,
 * прототип ui/swipes.js pager): текущая вкладка уезжает за пальцем, соседняя въезжает с другой
 * стороны, подсветка в ряду вкладок едет вместе с ними; порог — треть ширины или рывок, недотянутая
 * страница возвращается; на первой и последней вкладке — сопротивление, по кругу не переходит.
 * Не начинается на ряду вкладок, нижней панели, у самого левого края экрана и пока открыто окно,
 * панель или всплывающее окошко (`data-overlay`);
 * широкая таблица сначала прокручивается сама. Положение прокрутки каждой вкладки запоминается.
 * Только на касание: на ПК вкладки переключаются нажатием.
 */
export function TabPager({ tabs, activeTab, scope, renderTab, onSwipe, children }: TabPagerProps) {
  const root = useRef<HTMLDivElement>(null);
  const current = useRef<HTMLDivElement>(null);
  const neighbour = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLSpanElement | null>(null);
  const scrolls = useRef(new Map<string, number>());
  // Вкладка переключена жестом, адрес ещё меняется: до смены видна въехавшая соседняя страница.
  const pending = useRef<{ tab: string; saved: number; timer: ReturnType<typeof setTimeout> }>(
    null,
  );
  const [next, setNext] = useState<{ tab: string; dir: 1 | -1 } | null>(null);

  const snapshot = useEffectEvent(() => ({ tabs, activeTab, scope }));
  const navigate = useEffectEvent((tab: string) => onSwipe(tab));

  /** Убрать следы жеста: сдвиг страницы, подсветку, соседнюю страницу. */
  const reset = useEffectEvent((scrollTo?: number) => {
    const pane = root.current?.closest('main');
    const cur = current.current;
    if (cur) {
      cur.style.transition = '';
      cur.style.transform = '';
    }
    if (pane) {
      delete pane.dataset.paging;
      if (scrollTo !== undefined) pane.scrollTop = scrollTo;
    }
    const g = ghost.current;
    if (g) {
      delete g.parentElement?.dataset.swiping;
      g.remove();
      ghost.current = null;
    }
    setNext(null);
  });

  useEffect(() => {
    const el = root.current;
    const pane = el?.closest('main');
    if (!el || !pane) return;
    const tracker = createTracker();
    let st: Gesture | null = null;

    const tabEls = () => [...pane.querySelectorAll<HTMLElement>('[data-tabrow] [role="tab"]')];

    const paint = (s: Gesture, dx: number, ms = 0) => {
      const width = pane.clientWidth;
      const transition = ms ? `transform ${ms}ms ${SWIPE_EASE}` : 'none';
      const cur = current.current;
      if (cur) {
        cur.style.transition = transition;
        cur.style.transform = dx ? `translateX(${dx}px)` : '';
      }
      const nb = neighbour.current;
      if (nb && s.to) {
        nb.style.transition = transition;
        nb.style.transform = `translateX(${dx + s.dir * width}px)`;
      }
      const g = ghost.current;
      if (g && s.from) {
        const to = s.target ?? s.from;
        const p = s.to ? Math.min(1, Math.max(0, (-dx * s.dir) / width)) : 0;
        g.style.transition = ms ? `left ${ms}ms ${SWIPE_EASE},width ${ms}ms ${SWIPE_EASE}` : 'none';
        g.style.left = `${s.from.offsetLeft + (to.offsetLeft - s.from.offsetLeft) * p}px`;
        g.style.width = `${s.from.offsetWidth + (to.offsetWidth - s.from.offsetWidth) * p}px`;
      }
    };

    const begin = (s: Gesture, dir: 1 | -1) => {
      s.dir = dir;
      pane.dataset.paging = 'true';
      const els = tabEls();
      s.from = els[s.index] ?? null;
      const tablist = s.from?.parentElement;
      if (tablist) {
        tablist.dataset.swiping = 'true';
        const g = document.createElement('span');
        g.className = GHOST;
        tablist.append(g);
        ghost.current = g;
      }
      const j = s.index + dir;
      if (j >= 0 && j < s.tabs.length) {
        s.to = s.tabs[j]!;
        s.target = els[j] ?? null;
        // Соседняя страница нужна уже на следующем движении пальца.
        flushSync(() => setNext({ tab: s.to!, dir }));
      }
    };

    const start = (e: TouchEvent) => {
      st = null;
      const touch = e.touches[0];
      if (e.touches.length > 1 || !touch || pending.current) return;
      if (touch.clientX < SWIPE_EDGE) return;
      // Открыто окно, панель или всплывающее окошко — листать нечего (прототип: MODALS, POP, sheet).
      if (document.querySelector('[data-overlay]')) return;
      const scroller = horizontalScroller(e.target, pane);
      if (scroller === 'block') return;
      const now = snapshot();
      const index = now.activeTab ? now.tabs.indexOf(now.activeTab) : -1;
      if (index < 0 || now.tabs.length < 2) return;
      st = {
        x0: touch.clientX,
        y0: touch.clientY,
        dx: 0,
        locked: false,
        index,
        tabs: now.tabs,
        scroller,
        dir: 1,
        to: null,
        from: null,
        target: null,
      };
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
        // Вверх-вниз — прокрутка; таблица, которая ещё прокручивается вбок, — сначала она.
        if (axis === 'y' || (st.scroller && canScrollX(st.scroller, dx))) {
          st = null;
          return;
        }
        st.locked = true;
        st.x0 = touch.clientX;
        begin(st, dx < 0 ? 1 : -1);
      }
      e.preventDefault();
      st.dx = pagerOffset(touch.clientX - st.x0, st.dir, st.to !== null);
      if (!reducedMotion()) paint(st, st.dx);
    };

    const end = (e: TouchEvent, cancelled: boolean) => {
      const s = st;
      st = null;
      if (!s?.locked) return;
      const width = pane.clientWidth;
      const vx = tracker.velocity(e.timeStamp).x;
      const fire =
        !cancelled && pagerFires({ dx: s.dx, vx, dir: s.dir, width, hasNext: s.to !== null });
      const target = fire ? -s.dir * width : 0;
      const ms = reducedMotion() ? 0 : fire ? finishMs(width - Math.abs(s.dx), vx) : SWIPE_BACK_MS;
      const finish = () => {
        if (!fire || !s.to) {
          reset();
          return;
        }
        const now = snapshot();
        if (now.activeTab) scrolls.current.set(`${now.scope}.${now.activeTab}`, pane.scrollTop);
        pending.current = {
          tab: s.to,
          saved: Number(neighbour.current?.dataset.saved ?? 0),
          // Адрес так и не сменился (ошибка сети) — вернуть всё как было.
          timer: setTimeout(() => {
            pending.current = null;
            reset();
          }, 5000),
        };
        navigate(s.to);
      };
      paint(s, target, ms);
      if (ms && current.current) afterTransition(current.current, ms, finish);
      else finish();
    };
    const touchEnd = (e: TouchEvent) => end(e, false);
    const touchCancel = (e: TouchEvent) => end(e, true);

    pane.addEventListener('touchstart', start, { passive: true });
    pane.addEventListener('touchmove', move, { passive: false });
    pane.addEventListener('touchend', touchEnd);
    pane.addEventListener('touchcancel', touchCancel);
    return () => {
      pane.removeEventListener('touchstart', start);
      pane.removeEventListener('touchmove', move);
      pane.removeEventListener('touchend', touchEnd);
      pane.removeEventListener('touchcancel', touchCancel);
    };
  }, []);

  // Соседняя страница показывается там, где её оставили: прокрутка вкладки запоминается.
  useLayoutEffect(() => {
    const nb = neighbour.current;
    const el = root.current;
    const pane = el?.closest('main');
    if (!next || !nb || !el || !pane) return;
    const top = el.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop;
    const padBottom = el.parentElement
      ? parseFloat(getComputedStyle(el.parentElement).paddingBottom)
      : 0;
    const max = Math.max(0, top + nb.offsetHeight + (padBottom || 0) - pane.clientHeight);
    const saved = Math.min(scrolls.current.get(`${scope}.${next.tab}`) ?? 0, max);
    nb.dataset.saved = String(saved);
    nb.style.top = `${pane.scrollTop - saved}px`;
    nb.style.transform = `translateX(${next.dir * pane.clientWidth}px)`;
  }, [next, scope]);

  // Адрес сменился — экран новой вкладки уже на месте соседней: убираем её без «прыжка».
  useLayoutEffect(() => {
    const p = pending.current;
    if (!p) return;
    clearTimeout(p.timer);
    pending.current = null;
    reset(p.tab === activeTab ? p.saved : undefined);
  }, [activeTab, scope]);

  return (
    <div ref={root} className={`relative ${STACK}`}>
      <div ref={current} className={STACK}>
        {children}
      </div>
      {next && (
        <div
          ref={neighbour}
          aria-hidden="true"
          inert
          className={`pointer-events-none absolute inset-x-0 ${STACK}`}
        >
          {renderTab(next.tab)}
        </div>
      )}
    </div>
  );
}
