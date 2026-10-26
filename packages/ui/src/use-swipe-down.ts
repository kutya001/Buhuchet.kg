'use client';

import { useEffect, useEffectEvent, type RefObject } from 'react';
import {
  afterTransition,
  createTracker,
  dismissFires,
  finishMs,
  horizontalScroller,
  reducedMotion,
  SWIPE_BACK_MS,
  SWIPE_EASE,
  SWIPE_SLOP,
} from './gestures';

export interface SwipeDownOptions {
  /** Слушать жест (окно открыто). */
  enabled: boolean;
  onClose: () => void;
  /**
   * Можно ли закрыть сейчас; false — окно возвращается на место (форма с несохранёнными изменениями
   * сама спрашивает «Закрыть без сохранения?»).
   */
  canClose?: () => boolean;
  /** Фон под окном: светлеет, пока окно тянут. */
  cover?: RefObject<HTMLElement | null>;
  /** Прокручиваемое содержимое окна; по умолчанию само окно. */
  scroller?: RefObject<HTMLElement | null>;
  /** Тянуть только за ручку и шапку (`data-swipe-handle`). */
  handleOnly?: boolean;
}

/**
 * Протяжка вниз закрывает окно, выдвижную панель или всплывающее окошко (ТЗ «Управление свайпами»,
 * прототип ui/swipes.js swipeDown): за ручку и шапку (`data-swipe-handle`) — в любой момент, за
 * содержимое — когда оно прокручено к самому верху; порог — четверть высоты (не больше 160 px) или
 * рывок вниз. Пока окно тянут, фон под ним светлеет; недотянутое окно возвращается на место.
 * Работает только на касание: на ПК всё делается кнопками.
 */
export function useSwipeDown(
  ref: RefObject<HTMLElement | null>,
  { enabled, onClose, canClose, cover, scroller, handleOnly = false }: SwipeDownOptions,
) {
  const close = useEffectEvent(() => onClose());
  const allowed = useEffectEvent(() => canClose?.() ?? true);

  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const tracker = createTracker();
    let st: { x0: number; y0: number; dy: number; locked: boolean } | null = null;
    const coverEl = () => cover?.current ?? null;

    const start = (e: TouchEvent) => {
      st = null;
      const touch = e.touches[0];
      if (e.touches.length > 1 || !touch) return;
      const target = e.target as HTMLElement;
      const onHandle = !!target.closest('[data-swipe-handle]');
      const scrolled = (scroller?.current ?? el).scrollTop > 0;
      if (
        !onHandle &&
        (handleOnly ||
          scrolled ||
          target.closest('input,textarea,select') ||
          horizontalScroller(target, el) !== null)
      ) {
        return;
      }
      st = { x0: touch.clientX, y0: touch.clientY, dy: 0, locked: false };
      tracker.reset();
      tracker.add(touch.clientX, touch.clientY, e.timeStamp);
    };

    const move = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!st || !touch) return;
      tracker.add(touch.clientX, touch.clientY, e.timeStamp);
      const dx = touch.clientX - st.x0;
      const dy = touch.clientY - st.y0;
      if (!st.locked) {
        if (Math.abs(dx) < SWIPE_SLOP && Math.abs(dy) < SWIPE_SLOP) return;
        // Вбок или вверх — не наш жест (вбок листаются вкладки окна, вверх — прокрутка).
        if (!(dy > 0 && Math.abs(dy) > Math.abs(dx))) {
          st = null;
          return;
        }
        st.locked = true;
        st.y0 = touch.clientY;
        el.style.transition = 'none';
        el.style.animation = 'none';
        const c = coverEl();
        if (c) c.style.transition = 'none';
      }
      e.preventDefault();
      st.dy = Math.max(0, touch.clientY - st.y0);
      if (reducedMotion()) return;
      el.style.transform = `translateY(${st.dy}px)`;
      const c = coverEl();
      if (c) c.style.opacity = String(1 - Math.min(1, st.dy / Math.max(200, el.offsetHeight)));
    };

    const end = (e: TouchEvent, cancelled = false) => {
      const s = st;
      st = null;
      if (!s?.locked) return;
      const dy = cancelled ? 0 : s.dy;
      const vy = tracker.velocity(e.timeStamp).y;
      const c = coverEl();
      if (dismissFires({ dy, vy, height: el.offsetHeight }) && allowed()) {
        if (reducedMotion()) {
          close();
          return;
        }
        // Окно уезжает за нижний край экрана с той же скоростью, с какой его отпустили.
        const rest = Math.max(0, window.innerHeight - el.getBoundingClientRect().top);
        const ms = finishMs(rest, vy);
        el.style.transition = `transform ${ms}ms ${SWIPE_EASE}`;
        el.style.transform = `translateY(${dy + rest}px)`;
        if (c) {
          c.style.transition = `opacity ${ms}ms`;
          c.style.opacity = '0';
        }
        afterTransition(el, ms, () => {
          close();
          // Окно, которое остаётся в разметке закрытым, — без следов жеста.
          setTimeout(() => {
            el.style.transition = '';
            el.style.transform = '';
            el.style.animation = '';
            if (c) {
              c.style.transition = '';
              c.style.opacity = '';
            }
          }, 30);
        });
        return;
      }
      el.style.transition = `transform ${SWIPE_BACK_MS}ms ${SWIPE_EASE}`;
      el.style.transform = '';
      if (c) {
        c.style.transition = `opacity ${SWIPE_BACK_MS}ms`;
        c.style.opacity = '';
      }
      // Вернулось на место — дальше открытие и закрытие анимируют свои классы. Анимация появления
      // остаётся снятой: иначе окно появилось бы заново.
      afterTransition(el, SWIPE_BACK_MS, () => {
        el.style.transition = '';
        if (c) c.style.transition = '';
      });
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
  }, [ref, enabled, cover, scroller, handleOnly]);
}
