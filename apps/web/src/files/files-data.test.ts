import { defaultUiTexts, FILE_MAX_BYTES } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { fileMeta, pickedFilesProblem } from './files-data';

const t = makeTranslate(defaultUiTexts());

describe('блок «Файлы»: строка файла', () => {
  it('тип — расширение прописными, размер — как fmtSize прототипа', () => {
    expect(fileMeta(t, 'Акт сверки.pdf', 1500)).toBe('PDF · 1 КБ');
    expect(fileMeta(t, 'отчёт.Xlsx', 1048576 * 1.25)).toBe('XLSX · 1,3 МБ');
    expect(fileMeta(t, 'README', 0)).toBe('ФАЙЛ · 0 КБ');
  });
});

describe('блок «Файлы»: проверка выбранных файлов до загрузки', () => {
  const ok = { name: 'акт.pdf', size: 10 };

  it('всё в порядке — загружаются', () => {
    expect(pickedFilesProblem([ok, { name: 'скан.jpg', size: FILE_MAX_BYTES }])).toBeNull();
  });

  it('больше 20 МБ — все такие файлы одним списком (прототип uploadDlg)', () => {
    expect(
      pickedFilesProblem([
        { name: 'большой.pdf', size: FILE_MAX_BYTES + 1 },
        ok,
        { name: 'видео.mp4', size: FILE_MAX_BYTES * 2 },
        { name: 'setup.exe', size: 1 },
      ]),
    ).toEqual({ code: 'file_too_large', names: 'большой.pdf, видео.mp4' });
    expect(t('files.too_large', { names: 'большой.pdf, видео.mp4' })).toBe(
      'Файл больше 20 МБ: большой.pdf, видео.mp4',
    );
  });

  it('программа или веб-страница — первый такой файл', () => {
    expect(pickedFilesProblem([ok, { name: 'setup.exe', size: 1 }])).toEqual({
      code: 'file_type_forbidden',
      name: 'setup.exe',
    });
  });
});
