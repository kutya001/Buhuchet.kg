import { describe, expect, it } from 'vitest';
import { tourBubblePlace, tourHole, tourPagePlace } from './tour';

const VIEW = { w: 1280, h: 800 };
const PHONE = { w: 390, h: 844 };
const BUBBLE = { w: 380, h: 200 };

describe('показ «Показать как»: подсветка и место облачка (прототип tourPlace)', () => {
  it('рамка подсветки — элемент с отступом 6 px, не заходит за края экрана', () => {
    expect(tourHole({ left: 100, top: 50, width: 200, height: 40 }, VIEW)).toEqual({
      left: 94,
      top: 44,
      width: 212,
      height: 52,
    });
    // Элемент у края и больше экрана: рамка в 4 px от краёв и не шире экрана.
    expect(tourHole({ left: 0, top: 0, width: 2000, height: 1000 }, VIEW)).toEqual({
      left: 4,
      top: 4,
      width: 1272,
      height: 792,
    });
  });

  it('на ПК: без элемента — посередине; под элементом; внизу экрана — над ним; нет места ни под, ни над — сбоку', () => {
    expect(tourBubblePlace(null, BUBBLE, VIEW, { phone: false })).toEqual({ x: 450, y: 300 });
    const top = { left: 100, top: 100, width: 200, height: 40 };
    expect(tourBubblePlace(top, BUBBLE, VIEW, { phone: false })).toEqual({ x: 100, y: 152 });
    const bottom = { left: 100, top: 700, width: 200, height: 40 };
    expect(tourBubblePlace(bottom, BUBBLE, VIEW, { phone: false })).toEqual({ x: 100, y: 488 });
    // Высокий элемент на весь экран: облачко справа от него.
    const tall = { left: 100, top: 20, width: 300, height: 700 };
    expect(tourBubblePlace(tall, BUBBLE, VIEW, { phone: false })).toEqual({ x: 412, y: 20 });
    // Справа места нет — слева.
    const right = { left: 950, top: 20, width: 300, height: 700 };
    expect(tourBubblePlace(right, BUBBLE, VIEW, { phone: false })).toEqual({ x: 558, y: 20 });
  });

  it('на ПК облачко не выходит за правый край экрана', () => {
    const edge = { left: 1200, top: 100, width: 60, height: 30 };
    expect(tourBubblePlace(edge, BUBBLE, VIEW, { phone: false }).x).toBe(1280 - 380 - 12);
  });

  it('пункт меню — облачко сбоку от меню, чтобы не закрывать следующие пункты', () => {
    const item = { left: 900, top: 300, width: 200, height: 36 };
    const menu = { left: 900, top: 280, width: 200, height: 300 };
    expect(tourBubblePlace(item, BUBBLE, VIEW, { phone: false, menu })).toEqual({
      x: 900 - 380 - 12,
      y: 290,
    });
    // Слева от меню места нет — справа.
    const leftMenu = { left: 20, top: 280, width: 200, height: 300 };
    expect(
      tourBubblePlace({ ...item, left: 20 }, BUBBLE, VIEW, { phone: false, menu: leftMenu }),
    ).toEqual({ x: 232, y: 290 });
  });

  it('на телефоне облачко внизу экрана; элемент внизу — над ним; элемент на весь экран — сверху', () => {
    const bubble = { w: 366, h: 220 };
    expect(tourBubblePlace(null, bubble, PHONE, { phone: true })).toEqual({ x: 12, y: 612 });
    const top = { left: 10, top: 100, width: 370, height: 60 };
    expect(tourBubblePlace(top, bubble, PHONE, { phone: true })).toEqual({ x: 12, y: 612 });
    // Нижняя панель модулей — облачко над ней.
    const bar = { left: 0, top: 770, width: 390, height: 74 };
    expect(tourBubblePlace(bar, bubble, PHONE, { phone: true })).toEqual({ x: 12, y: 538 });
    const tall = { left: 4, top: 60, width: 382, height: 760 };
    expect(tourBubblePlace(tall, bubble, PHONE, { phone: true })).toEqual({ x: 12, y: 12 });
  });
});

describe('обзор страницы контрагента: облачко не закрывает подсвеченный раздел (прототип v120 cphTourPlace)', () => {
  it('на телефоне облачко всегда внизу, а подсветка высокого раздела обрезается над облачком', () => {
    const bubble = { w: 366, h: 220 };
    const tall = { left: 4, top: 12, width: 382, height: 900 };
    expect(tourPagePlace(tall, bubble, PHONE, true)).toEqual({
      hole: { left: 4, top: 6, width: 382, height: 594 },
      x: 12,
      y: 612,
    });
    // Раздел целиком над облачком — рамка как обычно.
    const small = { left: 10, top: 100, width: 370, height: 60 };
    expect(tourPagePlace(small, bubble, PHONE, true)).toEqual({
      hole: { left: 4, top: 94, width: 382, height: 72 },
      x: 12,
      y: 612,
    });
    // Раздел ниже облачка — рамка не меньше 8 px, облачко на месте.
    const low = { left: 10, top: 700, width: 370, height: 60 };
    expect(tourPagePlace(low, bubble, PHONE, true).y).toBe(612);
    expect(tourPagePlace(low, bubble, PHONE, true).hole?.height).toBe(8);
  });

  it('на ПК: сбоку от раздела, нет места сбоку — под или над ним, иначе в правом нижнем углу; без раздела — посередине', () => {
    expect(tourPagePlace(null, BUBBLE, VIEW, false)).toEqual({ hole: null, x: 450, y: 300 });
    const narrow = { left: 100, top: 100, width: 400, height: 200 };
    expect(tourPagePlace(narrow, BUBBLE, VIEW, false)).toMatchObject({ x: 522, y: 94 });
    const rightSide = { left: 700, top: 100, width: 500, height: 200 };
    expect(tourPagePlace(rightSide, BUBBLE, VIEW, false)).toMatchObject({ x: 298, y: 94 });
    const wide = { left: 100, top: 100, width: 1080, height: 200 };
    expect(tourPagePlace(wide, BUBBLE, VIEW, false)).toMatchObject({ x: 94, y: 318 });
    const wideLow = { left: 100, top: 500, width: 1080, height: 200 };
    expect(tourPagePlace(wideLow, BUBBLE, VIEW, false)).toMatchObject({ x: 94, y: 282 });
    const huge = { left: 100, top: 100, width: 1080, height: 600 };
    expect(tourPagePlace(huge, BUBBLE, VIEW, false)).toMatchObject({ x: 888, y: 588 });
  });
});
