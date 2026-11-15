import { describe, expect, it } from 'vitest';
import { FILE_MAX_BYTES } from '../files/files';
import { SENT_FILE_COMMENT_MAX } from '../files/sent-files';
import {
  isPageCodeCommand,
  PAGE_PAID_MAX,
  pageMonthPay,
  pageOpenMonths,
  pagePaidMonth,
  pagePaidProblems,
  pagePaidSentNote,
  type PageMonthPayReport,
} from './page-pay';
import { PAGE_REMEMBER_DAYS } from './page';

const rep = (o: Partial<PageMonthPayReport> & { id: string }): PageMonthPayReport => ({
  act: 'both',
  amount: 100_00,
  paid: 0,
  received: 0,
  payDue: '2026-11-20',
  ...o,
});

describe('оплата месяца на странице контрагента (прототип v116 pgMonthPay)', () => {
  it('к оплате, оплачено (больше из уплаченного и полученного, не больше суммы), осталось', () => {
    const p = pageMonthPay(
      '2026-10',
      [
        rep({ id: 'a', amount: 1000_00, received: 400_00 }),
        rep({ id: 'b', amount: 500_00, paid: 500_00, received: 0 }),
        rep({ id: 'c', amount: 200_00, paid: 50_00, received: 900_00 }),
      ],
      false,
    );
    expect(p).toMatchObject({ sum: 1700_00, got: 1100_00, left: 600_00, status: 'partial' });
    expect(p.rows).toEqual([{ id: 'a', left: 600_00, payDue: '2026-11-20' }]);
  });

  it('пометка: оплачено, ожидает подтверждения, частично, не оплачено; нечего платить — без пометки', () => {
    const one = (o: Partial<PageMonthPayReport>, waiting = false) =>
      pageMonthPay('2026-10', [rep({ id: 'x', ...o })], waiting).status;
    expect(one({ paid: 100_00 })).toBe('paid');
    // Оплачено полностью — «Оплачено», даже если клиент ещё и сообщил об оплате.
    expect(one({ received: 100_00 }, true)).toBe('paid');
    expect(one({ received: 30_00 }, true)).toBe('wait');
    expect(one({}, true)).toBe('wait');
    expect(one({ received: 30_00 })).toBe('partial');
    expect(one({})).toBe('unpaid');
    expect(one({ amount: null })).toBeNull();
    expect(one({ amount: 0 })).toBeNull();
    expect(one({ act: 'sub' })).toBeNull();
  });

  it('строки «Перечислить» — от раннего срока оплаты, без срока — первыми', () => {
    const p = pageMonthPay(
      '2026-10',
      [
        rep({ id: 'late', payDue: '2026-12-01' }),
        rep({ id: 'none', payDue: null }),
        rep({ id: 'soon', payDue: '2026-11-05' }),
      ],
      false,
    );
    expect(p.rows.map((r) => r.id)).toEqual(['none', 'soon', 'late']);
  });

  it('месяцы с остатком — от старых к новым', () => {
    const months = ['2026-11', '2026-09', '2026-10'].map((m, i) =>
      pageMonthPay(m, [rep({ id: m, paid: i === 1 ? 100_00 : 0 })], false),
    );
    expect(pageOpenMonths(months).map((m) => m.month)).toEqual(['2026-10', '2026-11']);
  });
});

describe('«Я оплатил» (прототип v116 pubPaidDlg)', () => {
  const ok = { amount: 5000_00, month: '2026-10', months: ['2026-10'], file: null };
  const file = { name: 'чек.jpg', size: 1000 };

  it('сумма больше нуля и не больше миллиарда, чек обязателен — фото или PDF до 20 МБ', () => {
    expect(pagePaidProblems({ ...ok, file })).toEqual([]);
    expect(pagePaidProblems({ ...ok, file: { name: 'чек.PDF', size: FILE_MAX_BYTES } })).toEqual(
      [],
    );
    expect(pagePaidProblems({ ...ok, amount: 0 })).toEqual([
      { field: 'sum', code: 'sum' },
      { field: 'file', code: 'file' },
    ]);
    expect(pagePaidProblems({ ...ok, amount: 1.5, file })).toEqual([{ field: 'sum', code: 'sum' }]);
    expect(pagePaidProblems({ ...ok, amount: PAGE_PAID_MAX + 1, file })).toEqual([
      { field: 'sum', code: 'sum_big' },
    ]);
    expect(pagePaidProblems({ ...ok, file: { name: 'чек.docx', size: 10 } })).toEqual([
      { field: 'file', code: 'file_type' },
    ]);
    expect(
      pagePaidProblems({ ...ok, file: { name: 'чек.png', size: FILE_MAX_BYTES + 1 } }),
    ).toEqual([{ field: 'file', code: 'file_big' }]);
  });

  it('месяц — из тех, за которые можно сообщить об оплате, или без месяца', () => {
    expect(pagePaidProblems({ ...ok, month: null, file })).toEqual([]);
    expect(pagePaidProblems({ ...ok, month: '2026-09', file })).toEqual([
      { field: 'month', code: 'month' },
    ]);
    expect(pagePaidProblems({ ...ok, month: '2026-13', months: ['2026-13'], file })).toEqual([
      { field: 'month', code: 'month' },
    ]);
  });

  it('месяц по умолчанию — самый старый с остатком или долгом', () => {
    const o = { taxOpen: ['2026-10', '2026-08'], feeOpen: ['2026-11'] };
    expect(pagePaidMonth('tax', o)).toBe('2026-08');
    expect(pagePaidMonth('fee', o)).toBe('2026-11');
    expect(pagePaidMonth('fee', { taxOpen: [], feeOpen: [] })).toBeNull();
  });

  it('комментарий чека: «Чек: …» и комментарий клиента, не длиннее комментария файла', () => {
    expect(pagePaidSentNote('Чек: налоги, 5 000 сом', null)).toBe('Чек: налоги, 5 000 сом');
    expect(pagePaidSentNote('Чек: налоги, 5 000 сом', 'за НДС')).toBe(
      'Чек: налоги, 5 000 сом. за НДС',
    );
    expect(pagePaidSentNote('Чек', 'я'.repeat(400))).toHaveLength(SENT_FILE_COMMENT_MAX);
  });
});

describe('код страницы', () => {
  it('запоминается в браузере на 1 день (решение заказчика 14.11.2026; было 30)', () => {
    expect(PAGE_REMEMBER_DAYS).toBe(1);
  });

  it('команда бота «Код от страницы»: /code, /code@бот или подпись кнопки меню', () => {
    const label = 'Код от страницы';
    expect(isPageCodeCommand('/code', label)).toBe(true);
    expect(isPageCodeCommand(' /CODE@buhuchet_bot ', label)).toBe(true);
    expect(isPageCodeCommand('код от СТРАНИЦЫ', label)).toBe(true);
    expect(isPageCodeCommand('/today', label)).toBe(false);
    expect(isPageCodeCommand('/code 123', label)).toBe(false);
    expect(isPageCodeCommand('Код', label)).toBe(false);
    expect(isPageCodeCommand('', '')).toBe(false);
  });
});
