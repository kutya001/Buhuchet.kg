import { defaultUiTexts } from '@buhuchet/domain';
import type { ContractorHistory, ReportHistoryEntry } from '@buhuchet/shared';
import { describe, expect, it } from 'vitest';
import { contractorHistoryText } from '../contractors/contractor-history';
import { makeTranslate } from '../l10n/translate';
import { reportHistoryText } from '../reports/report-history';
import { operationBasis } from './contractor-money';

// Деньги по отчётам в истории (задача 2.19; прототип ui/status-scale.js payDlg и rollbackDlg('pay'),
// submitDlg — «(сдача — после оплаты)»; modules/contractors.js inDlg; contractor-card.js `cp-needf`,
// `cp-pays`).

const t = makeTranslate(defaultUiTexts());
/** Неразрывные пробелы в суммах — обычными, чтобы сравнивать с текстом прототипа. */
const plain = (s: string) => s.replace(/\u00a0/g, ' ');

const report = (over: Partial<ReportHistoryEntry>): ReportHistoryEntry => ({
  at: '2026-10-18T04:30:00.000Z',
  actor: 'Эркин О.',
  action: 'update',
  reason: null,
  changes: [],
  ...over,
});

type Entry = ContractorHistory['items'][number];
const cp = (over: Partial<Entry>): Entry => ({
  id: 1,
  at: '2026-10-18T04:30:00.000Z',
  actor: 'Эркин О.',
  entity: 'contractor',
  action: 'update',
  reason: null,
  changes: [],
  subject: null,
  ...over,
});

describe('история отчёта: оплата', () => {
  it('оплата, «оплатил контрагент сам», переплата и отмена с причиной', () => {
    const pay = (to: object) =>
      plain(
        reportHistoryText(
          t,
          report({
            changes: [
              { field: 'payment', to },
              { field: 'paid', from: 0, to: 1 },
            ],
          }),
          0,
        ),
      );
    expect(pay({ amount: 300_000, date: '2026-10-18', self: false, over: 0 })).toBe(
      'Оплата в бюджет 3 000 сом от 18.10.2026',
    );
    expect(pay({ amount: 500_000, date: '2026-10-18', self: true, over: 100_000 })).toBe(
      'Оплата в бюджет 5 000 сом от 18.10.2026 (оплатил контрагент сам) (больше суммы к уплате на 1 000 сом)',
    );
    expect(
      plain(
        reportHistoryText(
          t,
          report({
            changes: [{ field: 'paymentCancel', from: { amount: 300_000, date: '2026-10-18' } }],
            reason: 'ошибка',
          }),
          0,
        ),
      ),
    ).toBe('Отменена оплата в бюджет 3 000 сом от 18.10.2026 (ошибка)');
  });

  it('п. 72: «Сдан» без оплаты — сумма и файлы с пометкой «(сдача — после оплаты)»', () => {
    expect(
      plain(
        reportHistoryText(
          t,
          report({
            changes: [
              { field: 'amount', to: 400_000 },
              { field: 'files', to: ['ен.pdf'] },
            ],
            reason: 'сдача — после оплаты',
          }),
          0,
        ),
      ),
    ).toBe('Сумма к уплате: 4 000 сом; Прикреплены файлы: ен.pdf (сдача — после оплаты)');
  });
});

describe('история контрагента: деньги', () => {
  it('поступление с детализацией и авансом, без детализации', () => {
    const receipt = (allocations: object[], total: number) =>
      plain(
        contractorHistoryText(
          t,
          cp({
            entity: 'money_operation',
            action: 'create',
            changes: [
              { field: 'kind', to: 'in' },
              { field: 'total', to: total },
              { field: 'allocations', to: allocations },
            ],
          }),
          {},
        ),
      );
    expect(receipt([{ report: 'НДС 09.2026', amount: 300_000 }], 400_000)).toBe(
      'Поступление 4 000 сом: НДС 09.2026 — 3 000, аванс — 1 000',
    );
    expect(receipt([], 100_000)).toBe('Поступление 1 000 сом');
  });

  it('«Файл при поступлении» и «Деньги на налоги переводит»', () => {
    expect(
      contractorHistoryText(
        t,
        cp({ changes: [{ field: 'needReceiptFile', from: false, to: true }] }),
        {},
      ),
    ).toBe('Включено: обязательно требовать прикрепления при поступлении от контрагента');
    expect(
      contractorHistoryText(
        t,
        cp({ changes: [{ field: 'needReceiptFile', from: true, to: false }] }),
        {},
      ),
    ).toBe('Выключено требование файла при поступлении');
    expect(
      contractorHistoryText(t, cp({ changes: [{ field: 'paysTo', from: 'emp', to: 'org' }] }), {}),
    ).toBe('Деньги на налоги: на счёт организации');
  });

  it('«Основание» операции: детализация, аванс, оплатил контрагент сам', () => {
    const op = (over: object) =>
      operationBasis(t, {
        id: '00000000-0000-4000-8000-000000000001',
        kind: 'in',
        self: false,
        date: '2026-10-18',
        amount: 100_000,
        total: 100_000,
        reports: [],
        author: null,
        note: '',
        holder: null,
        receiptDate: null,
        revision: null,
        edited: false,
        ...over,
      });
    expect(op({ reports: ['НДС 09.2026', 'ЕН III кв. 2026'] })).toBe(
      'За НДС 09.2026, ЕН III кв. 2026',
    );
    expect(op({})).toBe('Аванс');
    expect(op({ kind: 'pay', self: true, reports: ['НДС 09.2026'] })).toBe(
      'Оплата контрагентом напрямую · НДС 09.2026',
    );
    expect(op({ kind: 'pay', reports: ['НДС 09.2026'] })).toBe('НДС 09.2026');
    // Задача 2.20: списание и возврат — причина или комментарий, перевод — на чей счёт, обратная
    // запись — к какому поступлению, возврат по уточнённому — версия (прототип: `note` операции).
    expect(op({ kind: 'bonus', note: 'Остаток после оплаты налогов' })).toBe(
      'Остаток после оплаты налогов',
    );
    expect(op({ kind: 'refund' })).toBe('—');
    expect(op({ kind: 'xfer', holder: 'Иванова А.', note: 'на налоги' })).toBe(
      'Со счёта организации на счёт Иванова А. на налоги',
    );
    expect(op({ kind: 'corr', receiptDate: '2026-10-17', note: 'ошибка в платёжке' })).toBe(
      'К поступлению от 17.10.2026: ошибка в платёжке',
    );
    expect(op({ kind: 'back', revision: 1, reports: ['НДС 09.2026'] })).toBe(
      'Возврат по уточнённому расчёту (версия 1)',
    );
  });
});
