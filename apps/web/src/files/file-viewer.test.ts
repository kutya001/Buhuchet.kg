import { defaultUiTexts } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { failedTitle, windowFiles } from './file-viewer';

const t = makeTranslate(defaultUiTexts());

describe('окно просмотра: «‹ ›» — файлы того же списка (доработки 16.11.2026, блок 5)', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('открытый файл есть в списке — весь список, окно на его месте', () => {
    expect(windowFiles(rows, rows[1]!)).toEqual({ files: rows, index: 1 });
  });

  it('файла уже нет в списке (перечитался, другая страница) — окно только с ним, без «‹ ›»', () => {
    const gone = { id: 'z' };
    expect(windowFiles(rows, gone)).toEqual({ files: [gone], index: 0 });
    expect(windowFiles([], gone)).toEqual({ files: [gone], index: 0 });
  });
});

describe('окно просмотра: текст, когда файл не открылся (docs/deviations.md п. И-12)', () => {
  it('файл с паролем — «Файл защищён паролем»', () => {
    expect(failedTitle(t, 'file_encrypted')).toBe('Файл защищён паролем — просмотр недоступен');
  });

  it('пределы: больше 21 МБ, дольше 30 с, zip-бомба, огромный XML — «Файл слишком сложный»', () => {
    for (const code of [
      'too_big',
      'timeout',
      'zip_too_big',
      'zip_bomb',
      'zip_entries',
      'xml_too_big',
      'xml_too_deep',
    ]) {
      expect(failedTitle(t, code), code).toBe('Файл слишком сложный для просмотра');
    }
  });

  it('битый файл, неизвестное сжатие, сбой сети или потока — «Не удалось открыть файл»', () => {
    for (const code of [
      'file_bad',
      'zip_bad',
      'zip_method',
      'xls_bad',
      'xml_bad',
      'worker',
      'http_403',
    ]) {
      expect(failedTitle(t, code), code).toBe('Не удалось открыть файл');
    }
  });
});
