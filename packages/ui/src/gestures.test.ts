import { describe, expect, it } from 'vitest';
import {
  createTracker,
  dismissFires,
  finishMs,
  pagerFires,
  pagerOffset,
  SWIPE_RESIST,
  swipeAxis,
  throwFires,
  throwOpacity,
} from './gestures';

describe('жесты: общие правила (ТЗ «Управление свайпами»)', () => {
  it('направление — по первым 10 px: что больше, сдвиг вбок или вверх-вниз', () => {
    expect(swipeAxis(6, 4)).toBeNull();
    expect(swipeAxis(-9, 9)).toBeNull();
    expect(swipeAxis(12, 3)).toBe('x');
    expect(swipeAxis(-12, 11)).toBe('x');
    expect(swipeAxis(4, 11)).toBe('y');
    // Поровну — это прокрутка, а не листание: список не переключает вкладки случайно.
    expect(swipeAxis(10, -10)).toBe('y');
  });

  it('скорость пальца — по последним 90 мс; палец остановился перед отпусканием — рывка нет', () => {
    const t = createTracker();
    t.add(0, 0, 0);
    t.add(-30, 2, 10);
    t.add(-60, 4, 20);
    expect(t.velocity(20).x).toBeCloseTo(-3);
    expect(t.velocity(20).y).toBeCloseTo(0.2);
    expect(t.velocity(200)).toEqual({ x: 0, y: 0 });
    // Старые точки уходят из окна: считается только последнее движение.
    t.add(-60, 4, 300);
    t.add(-64, 4, 316);
    expect(t.velocity(316).x).toBeCloseTo(-0.25);
    t.reset();
    expect(t.velocity()).toEqual({ x: 0, y: 0 });
  });

  it('вкладка переключается протяжкой дальше трети ширины или рывком к соседней вкладке', () => {
    const base = { dir: 1 as const, width: 390, hasNext: true };
    expect(pagerFires({ ...base, dx: -140, vx: -0.2 })).toBe(true);
    expect(pagerFires({ ...base, dx: -120, vx: -0.2 })).toBe(false);
    // Дотянули, но в конце повели палец обратно — не переключается.
    expect(pagerFires({ ...base, dx: -140, vx: 0.3 })).toBe(false);
    // Короткий быстрый рывок.
    expect(pagerFires({ ...base, dx: -40, vx: -0.8 })).toBe(true);
    expect(pagerFires({ ...base, dx: -40, vx: -0.4 })).toBe(false);
    expect(pagerFires({ ...base, dx: -8, vx: -2 })).toBe(false);
    // К предыдущей вкладке — палец идёт вправо.
    expect(pagerFires({ ...base, dir: -1, dx: 150, vx: 0 })).toBe(true);
    expect(pagerFires({ ...base, dir: -1, dx: 30, vx: 1.2 })).toBe(true);
  });

  it('на первой и последней вкладке страница тянется с сопротивлением и по кругу не переходит', () => {
    expect(pagerOffset(-100, 1, true)).toBe(-100);
    expect(pagerOffset(-100, 1, false)).toBe(-100 * SWIPE_RESIST);
    expect(pagerOffset(80, -1, false)).toBe(80 * SWIPE_RESIST);
    // Палец пошёл в обратную сторону от выбранного направления — тоже с сопротивлением.
    expect(pagerOffset(20, 1, true)).toBe(20 * SWIPE_RESIST);
    expect(pagerFires({ dx: -300, vx: -2, dir: 1, width: 390, hasNext: false })).toBe(false);
  });

  it('окно закрывается протяжкой вниз на четверть высоты (не больше 160 px) или рывком вниз', () => {
    expect(dismissFires({ dy: 110, vy: 0.1, height: 400 })).toBe(true);
    expect(dismissFires({ dy: 90, vy: 0.1, height: 400 })).toBe(false);
    // Высокая форма: порог — 160 px, а не четверть.
    expect(dismissFires({ dy: 170, vy: 0, height: 800 })).toBe(true);
    expect(dismissFires({ dy: 150, vy: 0, height: 800 })).toBe(false);
    // Дотянули и повели обратно вверх — остаётся.
    expect(dismissFires({ dy: 170, vy: -0.4, height: 800 })).toBe(false);
    expect(dismissFires({ dy: 30, vy: 0.9, height: 800 })).toBe(true);
    expect(dismissFires({ dy: 5, vy: 3, height: 800 })).toBe(false);
  });

  it('завершение продолжает движение со скоростью пальца: 120–320 мс', () => {
    expect(finishMs(300, 3)).toBe(300);
    expect(finishMs(300, -10)).toBe(120);
    expect(finishMs(300, 0.5)).toBe(320);
    expect(finishMs(300, 0)).toBe(260);
  });

  it('уведомление смахивается вбок на треть ширины или рывком, иначе возвращается', () => {
    // Уведомление шириной 300 px: порог — 100 px в любую сторону.
    expect(throwFires({ dx: 110, vx: 0, width: 300 })).toBe(true);
    expect(throwFires({ dx: -110, vx: 0, width: 300 })).toBe(true);
    expect(throwFires({ dx: 90, vx: 0, width: 300 })).toBe(false);
    // Дотянули и повели обратно — остаётся.
    expect(throwFires({ dx: 110, vx: -0.4, width: 300 })).toBe(false);
    // Рывок — только в ту сторону, куда тянут.
    expect(throwFires({ dx: 30, vx: 0.9, width: 300 })).toBe(true);
    expect(throwFires({ dx: 30, vx: -0.9, width: 300 })).toBe(false);
    expect(throwFires({ dx: 5, vx: 3, width: 300 })).toBe(false);
  });

  it('пока уведомление тянут, оно бледнеет, но не исчезает', () => {
    expect(throwOpacity(0, 300)).toBe(1);
    expect(throwOpacity(-180, 300)).toBeCloseTo(0.5);
    expect(throwOpacity(1000, 300)).toBe(0.2);
  });
});
