import { describe, expect, it } from 'vitest';
import { drawnLength, lemniscate, pathAnchors } from './landing-fx';

/** Точки пути «M x y C x y x y x y …»: начало и концы всех кривых. */
function ends(m: string, d: string): [number, number][] {
  const nums = `${m} ${d}`.replace(/[MC]/g, ' ').trim().split(/\s+/).map(Number);
  const out: [number, number][] = [[nums[0]!, nums[1]!]];
  for (let i = 2; i + 5 < nums.length; i += 6) out.push([nums[i + 4]!, nums[i + 5]!]);
  return out;
}

describe('сквозная линия Бернулли лендинга (прототип v78)', () => {
  it('петля ∞ начинается и кончается в центре, проходит через ±a и симметрична', () => {
    const { m, d } = lemniscate(150, 229, 34);
    const pts = ends(m, d);
    expect(pts).toHaveLength(25);
    expect(pts[0]).toEqual([150, 229]);
    expect(pts[24]).toEqual([150, 229]);
    const xs = pts.map(([x]) => x);
    expect(Math.max(...xs)).toBeCloseTo(184, 0);
    expect(Math.min(...xs)).toBeCloseTo(116, 0);
    // Через центр — дважды: в начале и на середине (перекрестье восьмёрки).
    expect(pts[12]![0]).toBeCloseTo(150, 0);
    expect(pts[12]![1]).toBeCloseTo(229, 0);
    // Из центра — вниз-вправо, как идёт сама линия.
    expect(pts[1]![0]).toBeGreaterThan(150);
    expect(pts[1]![1]).toBeGreaterThan(229);
  });

  it('по прокрутке: до первой точки линии нет, между петлями — равномерно, после последней — вся', () => {
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
