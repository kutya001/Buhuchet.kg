import { describe, expect, it } from 'vitest';
import {
  DISPLAY_NAME_MAX_LENGTH,
  displayName,
  displayNameManual,
  displayNameProblem,
  shortName,
} from './names';

describe('Отображаемое имя сотрудника (решение заказчика 06.11.2026, прототип v74)', () => {
  it('автоматическое — имя и первая буква фамилии: «Кадырова Мээрим Асановна» → «Мээрим К.»', () => {
    expect(shortName('Кадырова Мээрим Асановна')).toBe('Мээрим К.');
    expect(shortName('  Токтогулов   Алишер ')).toBe('Алишер Т.');
    expect(shortName('Асанов')).toBe('Асанов');
  });

  it('из поля: пробелы по краям убраны, внутри по одному; пустое поле — автоматическое', () => {
    expect(displayName('  Мээрим   Кадырова ', 'Кадырова Мээрим')).toBe('Мээрим Кадырова');
    expect(displayName('', 'Кадырова Мээрим')).toBe('Мээрим К.');
    expect(displayName('   ', 'Кадырова Мээрим')).toBe('Мээрим К.');
    expect(displayName(undefined, 'Кадырова Мээрим')).toBe('Мээрим К.');
  });

  it('сверх прототипа: невидимые и управляющие символы убраны, буквы в одной записи (NFC) — повтор не спрятать', () => {
    expect(displayName('Мээрим К.\u200b', 'Кадырова Мээрим')).toBe('Мээрим К.');
    expect(displayName('\u202eМээрим\u2066', 'Кадырова Мээрим')).toBe('Мээрим');
    expect(displayName('Мээ\u0000рим\tК.', 'Кадырова Мээрим')).toBe('Мээрим К.');
    // «й» из «и» и знака краткости — та же буква, что «й» одним знаком.
    expect(displayName('Айгу\u0438\u0306', 'Асанова Айгуль')).toBe('Айгуй');
    expect(displayName('\u200b\u200d', 'Кадырова Мээрим')).toBe('Мээрим К.');
  });

  it('2–40 знаков', () => {
    expect(displayNameProblem('М')).toBe('display_name_length');
    expect(displayNameProblem('Мэ')).toBeNull();
    expect(displayNameProblem('я'.repeat(DISPLAY_NAME_MAX_LENGTH))).toBeNull();
    expect(displayNameProblem('я'.repeat(DISPLAY_NAME_MAX_LENGTH + 1))).toBe('display_name_length');
  });

  it('задано вручную — если не совпадает с автоматическим по ФИО', () => {
    expect(displayNameManual('Мээрим К.', 'Кадырова Мээрим')).toBe(false);
    expect(displayNameManual('Мээрим', 'Кадырова Мээрим')).toBe(true);
    expect(displayNameManual('Мээрим К.', 'Кадырова-Ли Мээрим')).toBe(false);
  });
});
