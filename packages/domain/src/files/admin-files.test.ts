import { describe, expect, it } from 'vitest';
import {
  adminFileSrcOf,
  ageHours,
  BYTES_IN_MB,
  fileTrashRestorable,
  lastTwelveMonths,
  memoryGb,
  memoryLevel,
  memoryMb,
  memoryPct,
} from './admin-files';

// Админка → «Файлы» (доработки 20.11.2026, пакет 2, блоки 3–5; прототип v154 admin/admin-files.js).

describe('«Загружено по месяцам»: последние 12 месяцев', () => {
  it('до месяца «сегодня» включительно, по порядку', () => {
    const months = lastTwelveMonths('2026-11-20');
    expect(months).toHaveLength(12);
    expect(months[0]).toBe('2025-12');
    expect(months[11]).toBe('2026-11');
  });

  it('через Новый год: январь — последний, февраль прошлого года — первый', () => {
    expect(lastTwelveMonths('2027-01-01')).toEqual([
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
    ]);
    expect(lastTwelveMonths('2026-12-31').at(-1)).toBe('2026-12');
    expect(lastTwelveMonths('2026-12-31')[0]).toBe('2026-01');
  });
});

describe('память организации', () => {
  it('процент с одним знаком; без предела — нет', () => {
    expect(memoryPct(0, 1000)).toBe(0);
    expect(memoryPct(333, 1000)).toBe(33.3);
    expect(memoryPct(1500, 1000)).toBe(150);
    expect(memoryPct(5, null)).toBeNull();
    expect(memoryPct(5, 0)).toBeNull();
  });

  it('цвет полосы: от 80 % — жёлтый, от 100 % — красный', () => {
    expect(memoryLevel(null)).toBeNull();
    expect(memoryLevel(79.9)).toBeNull();
    expect(memoryLevel(80)).toBe('yellow');
    expect(memoryLevel(99.9)).toBe('yellow');
    expect(memoryLevel(100)).toBe('red');
  });

  it('ГБ и МБ с одним знаком: 1 ГБ = 1 000 МБ', () => {
    expect(memoryMb(BYTES_IN_MB * 2.5)).toBe(2.5);
    expect(memoryGb(BYTES_IN_MB * 1000)).toBe(1);
    expect(memoryGb(BYTES_IN_MB * 9400)).toBe(9.4);
  });
});

describe('«Ждут удаления» и «Источник»', () => {
  it('«Вернуть» — только удалённый сотрудником и лишний файл', () => {
    expect(fileTrashRestorable('del')).toBe(true);
    expect(fileTrashRestorable('extra')).toBe(true);
    expect(fileTrashRestorable('rep')).toBe(false);
    expect(fileTrashRestorable('auto')).toBe(false);
  });

  it('код «Источника»: карточка контрагента, от контрагента, остальные — вид записи', () => {
    expect(adminFileSrcOf('contractor')).toBe('card');
    expect(adminFileSrcOf('sent_file')).toBe('sent');
    expect(adminFileSrcOf('report')).toBe('report');
  });

  it('возраст лишнего файла — целые часы, не меньше нуля', () => {
    const now = new Date('2026-11-20T12:00:00Z');
    expect(ageHours(new Date('2026-11-19T11:30:00Z'), now)).toBe(24);
    expect(ageHours(new Date('2026-11-20T13:00:00Z'), now)).toBe(0);
  });
});
