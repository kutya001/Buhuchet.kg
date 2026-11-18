import { describe, expect, it } from 'vitest';
import {
  bgSpiralPlace,
  bgSpiralScale,
  bgSpiralStep,
  bgSpiralTurn,
  featureChips,
  spiral,
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

describe('кривая Бернулли герба (прототип v78)', () => {
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
});

describe('спираль логотипа на фоне лендинга (прототип v145–v146)', () => {
  it('место и размер: на ПК — 72 % ширины экрана от 760 до 1180 px, на телефоне — шире экрана и ниже', () => {
    expect(bgSpiralPlace(1440, 900)).toEqual({ width: 1037, left: -145, top: 180 });
    // Узкий экран ПК — не уже 760 px, широкий — не шире 1180 px.
    expect(bgSpiralPlace(800, 600).width).toBe(760);
    expect(bgSpiralPlace(2560, 1300)).toEqual({ width: 1180, left: -165, top: 260 });
    // Телефон (до 768 px): в полтора раза шире экрана, на треть за левым краем.
    expect(bgSpiralPlace(390, 844)).toEqual({ width: 566, left: -181, top: 287 });
    expect(bgSpiralPlace(767, 800).width).toBe(1112);
    expect(bgSpiralPlace(768, 800).width).toBe(760);
  });

  it('поворот по прокрутке: 4,5° на 100 px, дальше 30 000 px не растёт; выше начала страницы — ноль', () => {
    expect(bgSpiralTurn(0)).toBe(0);
    expect(bgSpiralTurn(100)).toBeCloseTo(4.5);
    expect(bgSpiralTurn(30000)).toBeCloseTo(1350);
    expect(bgSpiralTurn(90000)).toBeCloseTo(1350);
    expect(bgSpiralTurn(-80)).toBe(0);
  });

  it('с поворотом спираль сжимается, но не больше чем на пятую часть', () => {
    expect(bgSpiralScale(0)).toBe(1);
    expect(bgSpiralScale(260)).toBeCloseTo(0.9);
    expect(bgSpiralScale(520)).toBeCloseTo(0.8);
    expect(bgSpiralScale(1350)).toBeCloseTo(0.8);
  });

  it('поворот догоняет прокрутку плавно: доля остатка по времени кадра, вплотную — сразу цель', () => {
    // Кадр 16 мс — около 6,4 % остатка.
    expect(bgSpiralStep(0, 100, 16)).toBeCloseTo(100 * (1 - Math.exp(-16 / 240)), 6);
    // Долгий кадр (вкладка была скрыта) считается за 64 мс: спираль не прыгает.
    expect(bgSpiralStep(0, 100, 5000)).toBeCloseTo(100 * (1 - Math.exp(-64 / 240)), 6);
    // Назад — так же плавно.
    expect(bgSpiralStep(100, 0, 16)).toBeCloseTo(100 * Math.exp(-16 / 240), 6);
    expect(bgSpiralStep(99.99, 100, 16)).toBe(100);
    expect(bgSpiralStep(100, 100, 16)).toBe(100);
  });
});

describe('карточки функций «Возможностей» (прототип v144)', () => {
  it('примеры на карточке — текст словаря через «|»: без пустых, не больше трёх', () => {
    expect(featureChips('Сегодня|Неделя|Просрочено')).toEqual(['Сегодня', 'Неделя', 'Просрочено']);
    expect(featureChips(' PDF | Фото чека ||К отчёту и к деньгам|Лишний')).toEqual([
      'PDF',
      'Фото чека',
      'К отчёту и к деньгам',
    ]);
    expect(featureChips('')).toEqual([]);
  });
});
