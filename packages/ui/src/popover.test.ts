import { describe, expect, it } from 'vitest';
import { edgeShift } from './popover';

describe('Popover: окошко не уходит за край экрана (openPop прототипа)', () => {
  it('влезает — на месте', () => {
    expect(edgeShift(20, 300, 412)).toBe(0);
  });

  it('вылезло влево — сдвиг вправо до отступа 8 px', () => {
    expect(edgeShift(-60, 300, 412)).toBe(68);
  });

  it('вылезло вправо — сдвиг влево; шире экрана — прижато к левому краю', () => {
    expect(edgeShift(200, 450, 412)).toBe(-46);
    expect(edgeShift(10, 500, 412)).toBe(-2);
  });
});
