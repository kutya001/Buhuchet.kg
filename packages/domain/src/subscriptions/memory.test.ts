import { describe, expect, it } from 'vitest';
import { SENT_FILE_MESSAGES } from '../files/sent';
import { UI_TEXTS } from '../l10n/texts';
import {
  MEMORY_FULL_CONTRACTOR_MESSAGE,
  MEMORY_FULL_MESSAGE,
  memoryFull,
  memoryFullParams,
  memoryFullText,
} from './memory';

const MB = 1024 * 1024;
const GB = 1000 * MB;

// Память заполнена — новые файлы не загружаются (доработки 20.11.2026, блок 2, пункт 5; прототип
// subMemFullDlg: `!isFinite(m.limit) || m.used < m.limit` — ещё можно).
describe('память организации заполнена', () => {
  it('заполнена, когда занято не меньше предела; без предела — никогда', () => {
    expect(memoryFull({ bytesUsed: 14 * GB, bytesLimit: 14 * GB })).toBe(true);
    expect(memoryFull({ bytesUsed: 15 * GB, bytesLimit: 14 * GB })).toBe(true);
    expect(memoryFull({ bytesUsed: 14 * GB - 1, bytesLimit: 14 * GB })).toBe(false);
    // Демо-организация и организация без подписки — предела нет.
    expect(memoryFull({ bytesUsed: 100 * GB, bytesLimit: null })).toBe(false);
    expect(memoryFull({ bytesUsed: null, bytesLimit: 14 * GB })).toBe(false);
    expect(memoryFull(null)).toBe(false);
  });

  it('текст — ГБ одним знаком после запятой, 1 ГБ = 1 000 МБ, как «занято 14 из 14 ГБ» в ТЗ', () => {
    expect(memoryFullText({ bytesUsed: 14 * GB, bytesLimit: 14 * GB })).toBe(
      'Память организации заполнена: занято 14 из 14 ГБ. Купите память или удалите лишние файлы.',
    );
    expect(memoryFullParams({ bytesUsed: 9400 * MB, bytesLimit: 22 * GB })).toEqual({
      used: '9,4',
      limit: '22',
      usedBytes: 9400 * MB,
      limitBytes: 22 * GB,
    });
    // Округление — до десятой ГБ, как subGb прототипа: 100 МБ — «0,1», 149 МБ — «0,1», 150 МБ — «0,2».
    expect(memoryFullParams({ bytesUsed: 149 * MB, bytesLimit: 150 * MB })).toMatchObject({
      used: '0,1',
      limit: '0,2',
    });
  });

  it('тексты словаря — те же, что у сервера; контрагенту — свой текст', () => {
    expect(UI_TEXTS['err.mem_full'].ru).toBe(MEMORY_FULL_MESSAGE);
    expect(SENT_FILE_MESSAGES.sent_mem_full).toBe(MEMORY_FULL_CONTRACTOR_MESSAGE);
    expect(UI_TEXTS['err.sent_mem_full'].ru).toBe(
      'Сейчас файл отправить нельзя. Сообщите вашему бухгалтеру',
    );
  });
});
