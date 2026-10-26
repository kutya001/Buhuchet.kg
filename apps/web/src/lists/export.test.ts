import { describe, expect, it } from 'vitest';
import { exportFileName } from './export';

describe('«В Excel»: имя скачанного файла', () => {
  it('русское имя из filename*=UTF-8 — как прислал сервер', () => {
    const name = 'Сотрудники 26.10.2026.xlsx';
    expect(
      exportFileName(
        `attachment; filename="export.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
      ),
    ).toBe(name);
  });

  it('нет заголовка или имя испорчено — export.xlsx', () => {
    expect(exportFileName(null)).toBe('export.xlsx');
    expect(exportFileName('attachment; filename="export.xlsx"')).toBe('export.xlsx');
    expect(exportFileName("attachment; filename*=UTF-8''%E0%A4%A")).toBe('export.xlsx');
  });
});
