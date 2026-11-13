import { describe, expect, it } from 'vitest';
import {
  chaseStep,
  drawnLength,
  pathAnchors,
  pathPolyline,
  spiral,
  spiralKnot,
} from './landing-fx';

/** Точки пути «M x y C x y x y x y …»: начало (если есть) и концы всех кривых. */
function ends(d: string): [number, number][] {
  const nums = d.replace(/[MC]/g, ' ').trim().split(/\s+/).map(Number);
  const out: [number, number][] = [];
  let i = 0;
  if (d.startsWith('M')) {
    out.push([nums[0]!, nums[1]!]);
    i = 2;
  }
  for (; i + 5 < nums.length; i += 6) out.push([nums[i + 4]!, nums[i + 5]!]);
  return out;
}

const dist = ([x, y]: readonly [number, number], cx: number, cy: number) =>
  Math.hypot(x - cx, y - cy);

describe('сквозная линия Бернулли лендинга (прототип v78 и v91)', () => {
  it('спираль Бернулли герба: от центра наружу, радиус только растёт, внешний конец справа', () => {
    const pts = ends(spiral(146, 235, 30));
    const r = pts.map((p) => dist(p, 146, 235));
    // Начало — у центра: за 2,6 витка радиус падает в e^(0,2·2,6·2π) ≈ 26 раз.
    expect(r[0]!).toBeLessThan(2);
    for (let i = 1; i < r.length; i += 1) expect(r[i]!).toBeGreaterThan(r[i - 1]!);
    // Росчерк на конце — чуть дальше R, справа от центра.
    const last = pts[pts.length - 1]!;
    expect(r[r.length - 1]!).toBeCloseTo(30 * Math.exp(0.2 * 0.55), 0);
    expect(last[0]).toBeGreaterThan(146 + 25);
    // Логарифмическая спираль: от точки к точке (равный шаг угла) радиус растёт в одно и то же число раз.
    const fine = ends(spiral(146, 235, 30, 2.6, 0.2, 4)).map((p) => dist(p, 146, 235));
    const grow = Math.exp((0.2 * 2.6 * 2 * Math.PI) / (fine.length - 1));
    for (let i = 1; i < fine.length; i += 1) expect(fine[i]! / fine[i - 1]!).toBeCloseTo(grow, 2);
  });

  it('двойная спираль в линии: вход сверху, через центр, выход снизу — зеркально входу', () => {
    for (const side of [1, -1] as const) {
      const k = spiralKnot(500, 800, 40, side);
      const arm = [k.in, ...ends(k.d1)];
      const out = ends(k.d2);
      // Вход — на расстоянии R от центра, по ту сторону, что задана; выход — точно напротив.
      expect(dist(k.in, 500, 800)).toBeCloseTo(40, 0);
      expect(Math.sign(k.in[0] - 500)).toBe(side);
      expect(k.out[0]).toBeCloseTo(1000 - k.in[0], 1);
      expect(k.out[1]).toBeCloseTo(1600 - k.in[1], 1);
      expect(k.in[1]).toBeLessThan(800);
      expect(k.out[1]).toBeGreaterThan(800);
      // К центру радиус только убывает, линия проходит точно через центр и так же раскручивается.
      const r = arm.map((p) => dist(p, 500, 800));
      for (let i = 1; i < r.length; i += 1) expect(r[i]!).toBeLessThan(r[i - 1]!);
      expect(arm[arm.length - 1]).toEqual([500, 800]);
      const ro = out.map((p) => dist(p, 500, 800));
      for (let i = 1; i < ro.length; i += 1) expect(ro[i]!).toBeGreaterThan(ro[i - 1]!);
      expect(out[out.length - 1]![0]).toBeCloseTo(k.out[0], 1);
      expect(out[out.length - 1]![1]).toBeCloseTo(k.out[1], 1);
      // Полтора витка: рука спирали пересекает вертикаль центра три раза.
      let turns = 0;
      for (let i = 1; i < arm.length - 1; i += 1)
        if (Math.sign(arm[i]![0] - 500) !== Math.sign(arm[i - 1]![0] - 500)) turns += 1;
      expect(turns).toBe(3);
    }
  });

  it('ломаная по линии: длина прямых и кривых, точки через равный шаг — без вопросов к браузеру', () => {
    // Прямые: 30 вниз и 40 вправо.
    const line = pathPolyline();
    line.add('M10.0 20.0L10.0 50.0');
    expect(line.length()).toBeCloseTo(30, 6);
    line.add('L50.0 50.0');
    expect(line.length()).toBeCloseTo(70, 6);
    const pts = line.sample(10, 8);
    expect([pts.xs[0], pts.ys[0]]).toEqual([10, 20]);
    expect([pts.xs[3], pts.ys[3]]).toEqual([10, 50]);
    expect([pts.xs[5], pts.ys[5]]).toEqual([30, 50]);
    expect([pts.xs[7], pts.ys[7]]).toEqual([50, 50]);
    // Длина браузера на 10 % больше: тот же шаг приходится на более раннее место ломаной.
    const scaled = line.sample(11, 8, 1.1);
    expect(scaled.ys[3]).toBeCloseTo(50, 4);
    expect(scaled.xs[7]).toBeCloseTo(50, 4);

    // Четверть окружности радиуса 100 кубической кривой: длина π·100/2.
    const k = 55.2285;
    const arc = pathPolyline();
    arc.add(`M100 0C100 ${k} ${k} 100 0 100`);
    expect(arc.length()).toBeCloseTo((Math.PI * 100) / 2, 0);
    const mid = arc.sample(arc.length() / 2, 3);
    expect(Math.hypot(mid.xs[1]!, mid.ys[1]!)).toBeCloseTo(100, 0);
    expect(mid.xs[1]).toBeCloseTo(mid.ys[1]!, 0);
    expect([Math.round(mid.xs[2]!), Math.round(mid.ys[2]!)]).toEqual([0, 100]);

    // Кривая второго порядка — та же длина, что у равной ей кубической.
    const quad = pathPolyline();
    quad.add('M0 0Q30 0 30 30');
    const cubic = pathPolyline();
    cubic.add('M0 0C20 0 30 10 30 30');
    expect(quad.length()).toBeCloseTo(cubic.length(), 6);

    // Двойная спираль линии: до центра и от центра — поровну, кончик проходит точно через центр.
    const knot = spiralKnot(200, 300, 44, 1);
    const sp = pathPolyline();
    sp.add(`M${knot.in[0].toFixed(1)} ${knot.in[1].toFixed(1)}${knot.d1}`);
    const half = sp.length();
    sp.add(knot.d2);
    expect(sp.length()).toBeCloseTo(half * 2, 0);
    const centre = sp.sample(half, 2);
    expect(centre.xs[1]).toBeCloseTo(200, 0);
    expect(centre.ys[1]).toBeCloseTo(300, 0);
  });

  it('кончик линии догоняет прокрутку плавно: 16 % остатка за кадр, вплотную — сразу цель', () => {
    expect(chaseStep(0, 100)).toBeCloseTo(16);
    expect(chaseStep(100, 0)).toBeCloseTo(84);
    expect(chaseStep(99.5, 100)).toBe(100);
    expect(chaseStep(100, 100)).toBe(100);
    // За секунду (60 кадров) кончик приходит к цели.
    let v = 0;
    for (let i = 0; i < 60; i += 1) v = chaseStep(v, 1000);
    expect(v).toBe(1000);
  });

  it('по прокрутке: до первой точки линии нет, между спиралями — равномерно, после последней — вся', () => {
    const anchors = [
      { y: 600, l: 0 },
      { y: 1000, l: 400 },
      { y: 2000, l: 1400 },
    ];
    expect(drawnLength(anchors, 1500, 500)).toBe(0);
    expect(drawnLength(anchors, 1500, 600)).toBe(0);
    expect(drawnLength(anchors, 1500, 800)).toBe(200);
    expect(drawnLength(anchors, 1500, 1500)).toBe(900);
    expect(drawnLength(anchors, 1500, 2500)).toBe(1500);
    expect(drawnLength([], 1500, 2500)).toBe(0);
  });

  it('опорные точки: линия начинается с первой прокрутки, конец успевает дорисоваться у подвала', () => {
    const a = pathAnchors(
      300,
      [
        { y: 900, l: 500 },
        { y: 1800, l: 1300 },
      ],
      { y: 5000, l: 4000 },
      4000,
      800,
    );
    // Начало — ниже 62 % первого экрана (в самом верху линии ещё нет).
    expect(a[0]).toEqual({ y: 800 * 0.62 + 1, l: 0 });
    expect(a[1]).toEqual({ y: 900, l: 500 });
    // Конец — не ниже, чем позволяет прокрутка страницы.
    expect(a[3]).toEqual({ y: 4000 - 800 * 0.38 - 2, l: 4000 });
    // Высоты только растут.
    for (let i = 1; i < a.length; i += 1) expect(a[i]!.y).toBeGreaterThan(a[i - 1]!.y);
  });
});
