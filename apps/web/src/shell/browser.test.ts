import { describe, expect, it } from 'vitest';
import { themeChangeKind, waveSide } from './browser';

describe('смена темы волной (прототип v88, ui/shell.js setTheme)', () => {
  it('«Уменьшить движение» — тема меняется сразу, даже если браузер умеет волну', () => {
    expect(themeChangeKind(true, true)).toBe('instant');
    expect(themeChangeKind(true, false)).toBe('instant');
  });

  it('браузер с View Transitions — волна, без них — плавная смена цветов', () => {
    expect(themeChangeKind(false, true)).toBe('wave');
    expect(themeChangeKind(false, false)).toBe('fade');
  });

  it('волна идёт с той стороны экрана, где нажатая кнопка', () => {
    // Кнопка темы верхней панели и лендинга — справа.
    expect(waveSide({ left: 1300, width: 32 }, 1366)).toBe('r');
    expect(waveSide({ left: 40, width: 32 }, 1366)).toBe('l');
    // Ровно посередине — справа, как без кнопки.
    expect(waveSide({ left: 667, width: 32 }, 1366)).toBe('r');
  });

  it('кнопки нет или она скрыта (нулевая ширина) — волна справа', () => {
    expect(waveSide(null, 390)).toBe('r');
    expect(waveSide({ left: 0, width: 0 }, 390)).toBe('r');
  });
});
