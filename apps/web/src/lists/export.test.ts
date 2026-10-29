import { formatText, UI_TEXTS } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import { makeErrorText, makeTranslate } from '../l10n/translate';
import { exportDoneText, exportFailureText, exportFileName } from './export';

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
  const text = (body: unknown) => exportFailureText(body, makeTranslate(texts), errorText, failed);

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

  it('другая ошибка или ответ не в общем формате — «Не удалось выгрузить список»', () => {
    expect(text({ error: { code: 'internal_error', message: 'Внутренняя ошибка' } })).toBe(failed);
    expect(text(null)).toBe(failed);
    expect(text('<html>')).toBe(failed);
  });
});

describe('«В Excel»: уведомление после выгрузки', () => {
  const texts = Object.fromEntries(Object.entries(UI_TEXTS).map(([k, v]) => [k, v.ru]));
  const t = makeTranslate(texts);
  const done = (headers: Record<string, string>) => exportDoneText(new Headers(headers), t);

  it('вошли все — «Скачан файл Excel: N строк»', () => {
    expect(done({ 'x-export-rows': '120', 'x-export-more': '0' })).toBe(
      'Скачан файл Excel: 120 строк',
    );
    expect(done({ 'x-export-rows': '1', 'x-export-more': '0' })).toBe(
      'Скачан файл Excel: 1 строка',
    );
  });

  it('больше 50 000 — «Выгружено 50 000 строк из 62 300 — сузьте фильтр…» (ТЗ «Списки»)', () => {
    expect(
      done({ 'x-export-rows': '50000', 'x-export-more': '1', 'x-export-total': '62300' }),
    ).toBe('Выгружено 50\u00a0000 строк из 62\u00a0300 — сузьте фильтр, чтобы выгрузить остальные');
  });
});
