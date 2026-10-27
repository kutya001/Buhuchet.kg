import { formatText, UI_TEXTS } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import { makeErrorText } from '../l10n/translate';
import { exportFailureText, exportFileName } from './export';

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

describe('«В Excel»: отказ сервера — причина в уведомлении', () => {
  const texts = Object.fromEntries(Object.entries(UI_TEXTS).map(([k, v]) => [k, v.ru]));
  const errorText = makeErrorText(texts);
  const failed = formatText(UI_TEXTS['grid.export_failed'].ru);
  const text = (body: unknown) => exportFailureText(body, errorText, failed);

  it('идёт прежняя выгрузка, предел за час, долгий запрос — тексты словаря', () => {
    expect(text({ error: { code: 'export_busy', message: '…' } })).toBe(
      'Предыдущая выгрузка в Excel ещё готовится. Попробуйте позже.',
    );
    expect(text({ error: { code: 'export_limit', message: '…', details: { n: 20 } } })).toBe(
      'Не больше 20 выгрузок в Excel за час. Попробуйте позже.',
    );
    expect(text({ error: { code: 'query_timeout', message: '…' } })).toBe(
      'Запрос выполнялся слишком долго. Сузьте список поиском или фильтром и попробуйте ещё раз.',
    );
  });

  it('ответ не в общем формате — «Не удалось выгрузить список»', () => {
    expect(text(null)).toBe(failed);
    expect(text('<html>')).toBe(failed);
  });
});
