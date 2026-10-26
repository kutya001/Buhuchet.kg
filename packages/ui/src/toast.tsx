'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  afterTransition,
  createTracker,
  finishMs,
  reducedMotion,
  SWIPE_BACK_MS,
  SWIPE_EASE,
  swipeAxis,
  throwFires,
  throwOpacity,
} from './gestures';
import { Icon } from './icon';
import type { IconName } from './icons';

/** Уведомление исчезает само через 3,2 с (ТЗ: «примерно через 3 секунды»), затем гаснет за 0,3 с. */
export const TOAST_MS = 3200;
const FADE_MS = 300;

export interface ToastOptions {
  /** Значок слева; по умолчанию — галочка. */
  icon?: IconName;
  /** Ошибка: значок красный. */
  bad?: boolean;
}

/** Показать уведомление внизу экрана: короткий результат действия («Сохранено», «Скопировано»). */
export type ShowToast = (message: string, options?: ToastOptions) => void;

export interface ToastLabels {
  /** «Закрыть уведомление» — для экранного диктора. */
  close: string;
  /** «Закрыть» — подсказка крестика. */
  closeTitle: string;
}

/**
 * Время жизни уведомления: через `ms` оно уходит, но не пока его держит палец — тогда сразу после
 * того, как его отпустят и оно вернётся на место.
 */
export function toastLife(onExpire: () => void, ms = TOAST_MS) {
  let held = false;
  let expired = false;
  let done = false;
  const expire = () => {
    if (done) return;
    done = true;
    onExpire();
  };
  const timer = setTimeout(() => {
    expired = true;
    if (!held) expire();
  }, ms);
  return {
    hold() {
      held = true;
    },
    release() {
      held = false;
      if (expired) expire();
    },
    /** Уведомление убрали раньше (крестиком или свайпом). */
    stop() {
      done = true;
      clearTimeout(timer);
    },
  };
}

const ToastContext = createContext<ShowToast>(() => {});

/** Показать уведомление внизу экрана (внутри `ToastProvider`). */
export function useToast(): ShowToast {
  return useContext(ToastContext);
}

interface ToastItem {
  id: number;
  message: string;
  icon: IconName;
  bad: boolean;
}

/**
 * Уведомления внизу экрана (ТЗ «Принципы оформления» → «Уведомления внизу экрана», прототип
 * ui/popups.js toast, css/kb.css `.toasts`): по центру внизу, на телефоне — над нижней панелью;
 * несколько стоят столбиком. Исчезают сами примерно через 3 секунды; на ПК их можно убрать крестиком
 * «Закрыть», на телефоне — свайпом влево или вправо.
 */
export function ToastProvider({ labels, children }: { labels: ToastLabels; children: ReactNode }) {
  const [items, setItems] = useState<readonly ToastItem[]>([]);
  const seq = useRef(0);
  const show = useCallback<ShowToast>((message, { icon = 'check', bad = false } = {}) => {
    seq.current += 1;
    const id = seq.current;
    setItems((list) => [...list, { id, message, icon, bad }]);
  }, []);
  const remove = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed bottom-[calc(22px+env(safe-area-inset-bottom,0px))] left-1/2 z-[90] flex w-max max-w-[calc(100vw-32px)] -translate-x-1/2 flex-col items-center gap-2 max-md:bottom-[calc(84px+env(safe-area-inset-bottom,0px))]">
        {items.map((t) => (
          <Toast
            key={t.id}
            message={t.message}
            icon={t.icon}
            bad={t.bad}
            labels={labels}
            onGone={() => remove(t.id)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * Одно уведомление. Свайп вбок (только на касание, ТЗ «Управление свайпами»): уведомление едет за
 * пальцем и бледнеет, уходит при протяжке на треть ширины или рывке, иначе возвращается; свайп вверх-вниз
 * ничего не делает, а вкладки модуля не листаются — уведомление вне рабочей области. При «уменьшить
 * движение» — без сдвига за пальцем и без анимации.
 */
export function Toast({
  message,
  icon,
  bad,
  labels,
  onGone,
}: {
  message: string;
  icon: IconName;
  bad: boolean;
  labels: ToastLabels;
  onGone: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const life = useRef<ReturnType<typeof toastLife> | null>(null);
  const gone = useEffectEvent(() => onGone());

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let fading = false;
    const fade = () => {
      if (fading) return;
      fading = true;
      // Анимация появления держит прозрачность — снимаем её, чтобы уведомление погасло плавно.
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.transition = `opacity ${FADE_MS}ms`;
      el.style.opacity = '0';
      setTimeout(gone, FADE_MS + 20);
    };
    const timer = toastLife(fade);
    life.current = timer;

    const tracker = createTracker();
    let st: { x0: number; y0: number; dx: number; locked: boolean } | null = null;
    const put = (x: number, ms: number) => {
      el.style.animation = 'none';
      el.style.transition = ms
        ? `transform ${ms}ms ${SWIPE_EASE}, opacity ${ms}ms ${SWIPE_EASE}`
        : 'none';
      el.style.transform = x ? `translateX(${x}px)` : '';
      el.style.opacity = x ? String(throwOpacity(x, el.offsetWidth)) : '';
    };
    const start = (e: TouchEvent) => {
      st = null;
      const touch = e.touches[0];
      if (e.touches.length > 1 || !touch || (e.target as HTMLElement).closest('button')) return;
      st = { x0: touch.clientX, y0: touch.clientY, dx: 0, locked: false };
      tracker.reset();
      tracker.add(touch.clientX, touch.clientY, e.timeStamp);
    };
    const move = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!st || !touch) return;
      tracker.add(touch.clientX, touch.clientY, e.timeStamp);
      if (!st.locked) {
        const axis = swipeAxis(touch.clientX - st.x0, touch.clientY - st.y0);
        if (!axis) return;
        if (axis === 'y') {
          st = null;
          return;
        }
        st.locked = true;
        st.x0 = touch.clientX;
        timer.hold();
      }
      e.preventDefault();
      e.stopPropagation();
      st.dx = touch.clientX - st.x0;
      // При «уменьшить движение» уведомление не едет за пальцем: жест срабатывает, когда его отпустят.
      if (!reducedMotion()) put(st.dx, 0);
    };
    const end = (e: TouchEvent, cancelled = false) => {
      const s = st;
      st = null;
      if (!s?.locked) return;
      const width = el.offsetWidth;
      const vx = tracker.velocity(e.timeStamp).x;
      if (cancelled || !throwFires({ dx: s.dx, vx, width })) {
        const ms = reducedMotion() ? 0 : SWIPE_BACK_MS;
        put(0, ms);
        // Время вышло, пока держали, — исчезнет, когда вернётся на место.
        setTimeout(() => timer.release(), ms ? ms + 10 : 0);
        return;
      }
      timer.stop();
      const ms = reducedMotion() ? 0 : finishMs(width + 40 - Math.abs(s.dx), vx);
      if (!ms) return gone();
      put(Math.sign(s.dx) * (width + 40), ms);
      afterTransition(el, ms, gone);
    };
    const touchEnd = (e: TouchEvent) => end(e);
    const touchCancel = (e: TouchEvent) => end(e, true);
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', touchEnd);
    el.addEventListener('touchcancel', touchCancel);
    return () => {
      timer.stop();
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', touchEnd);
      el.removeEventListener('touchcancel', touchCancel);
    };
  }, []);

  return (
    <div
      ref={ref}
      role="status"
      className="pointer-events-auto flex animate-slide-up touch-pan-y items-center gap-[9px] rounded-lg bg-toast-bg px-4 py-2.5 text-[13px] font-[550] text-toast-fg shadow-pop select-none"
    >
      <Icon name={icon} className={bad ? 'text-brand-red' : ''} />
      <span>{message}</span>
      <button
        type="button"
        aria-label={labels.close}
        title={labels.closeTitle}
        onClick={() => {
          life.current?.stop();
          onGone();
        }}
        className="-my-1 -mr-2 ml-0.5 inline-grid h-6 w-6 flex-none cursor-pointer place-items-center rounded-[5px] border-0 bg-transparent text-inherit opacity-70 hover:bg-[rgba(127,127,127,0.22)] hover:opacity-100 focus-visible:bg-[rgba(127,127,127,0.22)] focus-visible:opacity-100 max-md:hidden"
      >
        <Icon name="x" size="sm" />
      </button>
    </div>
  );
}
