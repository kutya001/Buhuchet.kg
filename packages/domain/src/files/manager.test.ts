import { describe, expect, it } from 'vitest';
import { fileManagerPlates, filePreviewKind, fileTypeLabel } from './manager';

describe('Файловый менеджер: плашки, тип и просмотр (прототип modules/files.js)', () => {
  it('плашки — виды с файлами по порядку модулей и всегда «Загружено вручную» последней', () => {
    expect(fileManagerPlates({})).toEqual([{ kind: 'manual', count: 0 }]);
    expect(fileManagerPlates({ manual: 2, indicator_value: 1, task: 0 })).toEqual([
      { kind: 'indicator_value', count: 1 },
      { kind: 'manual', count: 2 },
    ]);
    expect(fileManagerPlates({ indicator_value: 3, task: 5 }).map((p) => p.kind)).toEqual([
      'task',
      'indicator_value',
      'manual',
    ]);
  });

  it('«Тип» — расширение прописными, без расширения — null', () => {
    expect(fileTypeLabel('Устав_Укс.pdf')).toBe('PDF');
    expect(fileTypeLabel('Договор.v2.docx')).toBe('DOCX');
    expect(fileTypeLabel('README')).toBeNull();
    expect(fileTypeLabel('.env')).toBeNull();
  });

  it('в окне показываются картинки и PDF, остальное только скачивается', () => {
    expect(filePreviewKind('application/pdf')).toBe('pdf');
    expect(filePreviewKind('image/png')).toBe('image');
    expect(filePreviewKind('image/jpeg')).toBe('image');
    expect(filePreviewKind('image/heic')).toBeNull();
    expect(filePreviewKind('image/tiff')).toBeNull();
    expect(filePreviewKind('application/vnd.ms-excel')).toBeNull();
  });
});
