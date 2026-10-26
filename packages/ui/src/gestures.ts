/**
 * Общие правила жестов на телефоне (ТЗ «Управление свайпами», прототип ui/swipes.js): содержимое
 * двигается за пальцем один к одному; направление выбирается по первым 10 px; жест срабатывает,
 * если протянули дальше порога или сделали быстрый рывок (не меньше 0,5 px/мс), иначе содержимое
 * плавно возвращается на место; завершение продолжает движение со скоростью пальца.
 */

/** Сдвиг, после которого понятно направление жеста, px. */
export const SWIPE_SLOP = 10;
/** Скорость быстрого рывка, px/мс. */
export const SWIPE_FLICK = 0.5;
/** Возврат на место недотянутого жеста, мс. */
export const SWIPE_BACK_MS = 230;
export const SWIPE_EASE = 'cubic-bezier(.2,.6,.35,1)';
/** На первой и последней вкладке страница тянется с сопротивлением (ТЗ: 20–30 % протяжки). */
export const SWIPE_RESIST = 0.25;
/** У самого левого края экрана — системный жест «Назад», свайп вкладок там не начинается, px. */
export const SWIPE_EDGE = 20;
/** Порог закрытия протяжкой вниз — четверть высоты, но не больше 160 px. */
export const DISMISS_MAX = 160;

/** Направление жеста по первым сдвигам; пока сдвиг меньше 10 px — ещё не понятно (null). */
export function swipeAxis(dx: number, dy: number): 'x' | 'y' | null {
  if (Math.abs(dx) < SWIPE_SLOP && Math.abs(dy) < SWIPE_SLOP) return null;
  return Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
}

interface Sample {
  x: number;
  y: number;
  t: number;
}

/** Скорость пальца по последним ~90 мс движения. */
export interface SwipeTracker {
  add(x: number, y: number, t: number): void;
  /** Скорость в момент `at` (px/мс); палец стоял дольше окна — скорость 0. */
  velocity(at?: number): { x: number; y: number };
  reset(): void;
}

export function createTracker(windowMs = 90): SwipeTracker {
  const samples: Sample[] = [];
  return {
    add(x, y, t) {
      samples.push({ x, y, t });
      while (samples.length > 2 && t - samples[0]!.t > windowMs) samples.shift();
    },
    velocity(at) {
      const first = samples[0];
      const last = samples[samples.length - 1];
      if (!first || !last || first === last) return { x: 0, y: 0 };
      // Палец остановился и только потом отпустил — это не рывок.
      if (at !== undefined && at - last.t > windowMs) return { x: 0, y: 0 };
      const dt = Math.max(8, last.t - first.t);
      return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
    },
    reset() {
      samples.length = 0;
    },
  };
}

/**
 * Сдвиг страницы вкладок за пальцем: к соседней вкладке — один к одному, на первой и последней
 * вкладке (соседней нет) и в обратную сторону — с сопротивлением. `dir` — куда листаем: 1 —
 * к следующей вкладке (палец идёт влево), -1 — к предыдущей.
 */
export function pagerOffset(dx: number, dir: 1 | -1, hasNext: boolean): number {
  return !hasNext || Math.sign(dx) === dir ? dx * SWIPE_RESIST : dx;
}

/** Переключить вкладку: протянули дальше трети ширины или рывком в сторону соседней вкладки. */
export function pagerFires({
  dx,
  vx,
  dir,
  width,
  hasNext,
}: {
  dx: number;
  vx: number;
  dir: 1 | -1;
  width: number;
  hasNext: boolean;
}): boolean {
  if (!hasNext) return false;
  const along = -dx * dir;
  const speed = -vx * dir;
  return (along > width / 3 && speed > -0.1) || (speed > SWIPE_FLICK && along > SWIPE_SLOP);
}

/**
 * Смахнуть уведомление вбок: протянули дальше трети его ширины или рывком в ту же сторону (те же
 * пороги, что у вкладок; прототип ui/swipes.js swipeAway).
 */
export function throwFires({ dx, vx, width }: { dx: number; vx: number; width: number }): boolean {
  const dir = Math.sign(dx);
  return (
    (Math.abs(dx) > width / 3 && vx * dir > -0.1) ||
    (Math.abs(vx) > SWIPE_FLICK && Math.sign(vx) === dir && Math.abs(dx) > SWIPE_SLOP)
  );
}

/** Уведомление бледнеет, пока его тянут вбок, но не исчезает совсем (не прозрачнее 0,2). */
export function throwOpacity(dx: number, width: number): number {
  return Math.max(0.2, 1 - Math.abs(dx) / (width * 1.2));
}

/** Закрыть протяжкой вниз: дальше четверти высоты (не больше 160 px) или рывком вниз. */
export function dismissFires({ dy, vy, height }: { dy: number; vy: number; height: number }) {
  const threshold = Math.min(height / 4, DISMISS_MAX);
  return (dy > threshold && vy > -0.1) || (vy > SWIPE_FLICK && dy > SWIPE_SLOP);
}

/**
 * Длительность завершения жеста: кривая замедления стартует примерно втрое быстрее средней
 * скорости, поэтому путь / скорость × 3 продолжает движение со скоростью пальца; 120–320 мс.
 */
export function finishMs(distance: number, velocity: number): number {
  const ms = Math.abs(velocity) > 0.05 ? (Math.abs(distance) / Math.abs(velocity)) * 3 : 260;
  return Math.round(Math.max(120, Math.min(320, ms)));
}

/** В системе включено «уменьшить движение»: жесты работают, но без анимации сдвига. */
export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Что под пальцем мешает листать вбок: ряд вкладок, нижняя панель и всё с `data-no-swipe` (шкала
 * статусов) — жест не начинается (`'block'`); таблица, которая прокручивается вбок, — сначала
 * прокручивается она (возвращается сама таблица).
 */
export function horizontalScroller(
  target: EventTarget | null,
  stop: Element,
): HTMLElement | 'block' | null {
  for (
    let n = target as HTMLElement | null;
    n && n !== stop && n.nodeType === 1;
    n = n.parentElement
  ) {
    if (n.matches('[role="tablist"],input[type="range"],[data-no-swipe]')) return 'block';
    const overflow = getComputedStyle(n).overflowX;
    if ((overflow === 'auto' || overflow === 'scroll') && n.scrollWidth > n.clientWidth + 2)
      return n;
  }
  return null;
}

/** Можно ли ещё прокрутить элемент вбок в сторону движения пальца. */
export function canScrollX(el: HTMLElement, dx: number): boolean {
  return dx < 0 ? el.scrollLeft < el.scrollWidth - el.clientWidth - 1 : el.scrollLeft > 1;
}

/** Выполнить `done` по окончании перехода (или через `ms` + 60 мс, если событие не пришло). */
export function afterTransition(el: HTMLElement, ms: number, done: () => void) {
  let finished = false;
  const finish = (e?: TransitionEvent) => {
    // transitionend всплывает и от вложенных элементов — ждём только свой.
    if (finished || (e && e.target !== el)) return;
    finished = true;
    el.removeEventListener('transitionend', finish);
    done();
  };
  el.addEventListener('transitionend', finish);
  setTimeout(finish, ms + 60);
}
