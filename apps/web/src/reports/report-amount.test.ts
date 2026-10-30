import { defaultUiTexts } from '@buhuchet/domain';
import type { ReportCard, ReportHistoryEntry } from '@buhuchet/shared';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { amountFormOf, readAmount, withRevenue, withTax } from './report-amount';
import { reportHistoryText } from './report-history';

// Поля суммы окон «Отметить сданным» и «Сумма к уплате» и «История изменений» карточки (задача 2.14;
// прототип ui/status-scale.js — linesFld, bindLines, readLines, partsFld; report-card.js).

const t = makeTranslate(defaultUiTexts());
const NBSP = ' ';
const som = (v: number) => Math.round(v * 100);

type Def = ReportCard['lineDefs'][number];
const en: Def[] = [
  {
    kind: 'rate',
    key: 'ЕНС-04:cl',
    label: 'Безналичная выручка, 4 %',
    pct: '4 %',
    cash: false,
    old: false,
  },
  {
    kind: 'rate',
    key: 'ЕНС-04:ca',
    label: 'Наличная выручка, 6 %',
    pct: '6 %',
    cash: true,
    old: false,
  },
];
const card = (o: Partial<Pick<ReportCard, 'amount' | 'lines' | 'lineDefs'>> = {}) => ({
  amount: null,
  lines: [],
  lineDefs: en,
  ...o,
});

describe('строки по ставкам', () => {
  it('п. 61: ЕНС-04, безнал 300 000 и нал 200 000 → налог 12 000 + 12 000, итог 24 000', () => {
    let form = amountFormOf(card());
    form = withRevenue(en, form, 0, '300 000');
    form = withRevenue(en, form, 1, '200000');
    expect(form.lines.map((l) => l.tax)).toEqual([`12${NBSP}000`, `12${NBSP}000`]);
    expect(form.amount).toBe(`24${NBSP}000`);
    expect(readAmount(en, form, false)).toEqual({
      ok: true,
      amount: som(24_000),
      lines: [
        { key: 'ЕНС-04:cl', revenue: som(300_000), tax: som(12_000) },
        { key: 'ЕНС-04:ca', revenue: som(200_000), tax: som(12_000) },
      ],
    });
  });

  it('налог, исправленный руками, выручка больше не перезаписывает; пустой — снова считается', () => {
    let form = withTax(en, amountFormOf(card()), 0, '11 900');
    form = withRevenue(en, form, 0, '300 000');
    expect(form.lines[0]!.tax).toBe('11 900');
    form = withTax(en, form, 0, '');
    form = withRevenue(en, form, 0, '100 000');
    expect(form.lines[0]!.tax).toBe(`4${NBSP}000`);
  });

  it('сохранённые строки при открытии; все строки пустые — итог прежний', () => {
    const form = amountFormOf(
      card({
        amount: som(500),
        lines: [
          {
            kind: 'rate',
            key: 'ЕНС-04:cl',
            label: '',
            pct: '4 %',
            cash: false,
            revenue: null,
            tax: som(500),
          },
        ],
      }),
    );
    expect(form.lines[0]).toEqual({ revenue: '', tax: '500', manual: true });
    expect(withTax(en, form, 0, '').amount).toBe('500');
  });

  it('выручка не числом — ошибка у строк; итог не введён — сумма не меняется, в «Сумме к уплате» — обязательна', () => {
    const bad = withRevenue(en, amountFormOf(card()), 1, '-5');
    expect(readAmount(en, bad, false)).toEqual({
      ok: false,
      field: 'lines',
      label: 'Наличная выручка, 6 %',
    });
    expect(readAmount(en, amountFormOf(card()), false)).toEqual({
      ok: true,
      amount: null,
      lines: null,
    });
    expect(readAmount([], { ...amountFormOf(card({ lineDefs: [] })), amount: '' }, true)).toEqual({
      ok: false,
      field: 'amount',
    });
  });

  it('без строк — одно поле суммы; 0 — нулевой отчёт', () => {
    const form = { ...amountFormOf(card({ lineDefs: [] })), amount: '0' };
    expect(readAmount([], form, true)).toEqual({ ok: true, amount: 0, lines: null });
    expect(readAmount([], { ...form, amount: '1 250,50' }, true)).toMatchObject({
      amount: 125_050,
    });
    expect(readAmount([], { ...form, amount: 'abc' }, false)).toEqual({
      ok: false,
      field: 'amount',
    });
  });

  it('строки платежей: итог — сумма платежей, выручки нет', () => {
    const pay: Def[] = [
      { kind: 'payment', key: 'pay:0', label: 'Подоходный налог', pct: '', cash: null, old: false },
      { kind: 'payment', key: 'pay:1', label: 'Страховые взносы', pct: '', cash: null, old: false },
    ];
    let form = amountFormOf(card({ lineDefs: pay }));
    form = withTax(pay, form, 0, '2 500');
    form = withTax(pay, form, 1, '3 000');
    expect(form.amount).toBe(`5${NBSP}500`);
    expect(readAmount(pay, form, true)).toMatchObject({
      amount: som(5_500),
      lines: [
        { key: 'pay:0', revenue: null, tax: som(2_500) },
        { key: 'pay:1', revenue: null, tax: som(3_000) },
      ],
    });
  });
});

describe('«История изменений» карточки', () => {
  const entry = (o: Partial<ReportHistoryEntry>): ReportHistoryEntry => ({
    at: '2026-10-28T06:00:00.000Z',
    actor: 'Айбек С.',
    action: 'update',
    reason: null,
    changes: [],
    ...o,
  });

  it('п. 10: сдача с суммой и строками — было → стало', () => {
    expect(
      reportHistoryText(
        t,
        entry({
          changes: [
            { field: 'submittedOn', from: null, to: '2026-10-28' },
            { field: 'amount', from: null, to: som(24_000) },
            {
              field: 'lines',
              from: [],
              to: [{ label: 'Безналичная выручка, 4 %', revenue: som(300_000), tax: som(12_000) }],
            },
            { field: 'files', to: ['декларация.pdf'] },
          ],
        }),
        0,
      ),
    ).toBe(
      `Дата сдачи: — → 28.10.2026; Сумма к уплате: не указана → 24${NBSP}000${NBSP}сом; Строки: Безналичная выручка, 4 %: выручка 300${NBSP}000${NBSP}сом, налог 12${NBSP}000${NBSP}сом; Прикреплены файлы: декларация.pdf`,
    );
  });

  it('причина — в скобках; уточнённый, файлы, создание', () => {
    expect(
      reportHistoryText(
        t,
        entry({
          changes: [{ field: 'dueDate', from: '2026-10-25', to: '2026-10-27' }],
          reason: 'Праздник',
        }),
        0,
      ),
    ).toBe('Срок сдачи: 25.10.2026 → 27.10.2026 (Праздник)');
    expect(
      reportHistoryText(t, entry({ changes: [{ field: 'superseded', from: false, to: true }] }), 0),
    ).toBe('Создан уточнённый отчёт, версия 1');
    expect(
      reportHistoryText(t, entry({ action: 'create', changes: [{ field: 'revision', to: 1 }] }), 1),
    ).toBe('Уточнённый отчёт создан на основе первичной версии');
    expect(
      reportHistoryText(
        t,
        entry({ action: 'file_attach', changes: [{ field: 'file', to: 'квитанция.pdf' }] }),
        0,
      ),
    ).toBe('Прикреплён файл: квитанция.pdf');
    expect(reportHistoryText(t, entry({ action: 'create' }), 0)).toBe('Отчёт создан');
    expect(
      reportHistoryText(
        t,
        entry({
          changes: [{ field: 'lines', from: [{ label: 'x', revenue: null, tax: 1 }], to: [] }],
        }),
        0,
      ),
    ).toBe('строки по ставкам очищены');
  });
});
