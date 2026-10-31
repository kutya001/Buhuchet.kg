import { defaultUiTexts } from '@buhuchet/domain';
import type { ContractorHistory, OperationWindow, ReportHistoryEntry } from '@buhuchet/shared';
import { describe, expect, it } from 'vitest';
import { contractorHistoryText } from '../contractors/contractor-history';
import { makeTranslate } from '../l10n/translate';
import { reportHistoryText } from '../reports/report-history';
import { operationHistoryText } from './operation-window';

// Строки истории операций с остатком (задача 2.20; прототип modules/contractors.js — `log('cp', …)` у
// списания и возврата, modules/finance.js — у перевода и обратной записи, modules/fin-op.js — `opLog`,
// ui/status-scale.js — `revBack` и `waDlg`).

const t = makeTranslate(defaultUiTexts());
/** Неразрывные пробелы в суммах — обычными, чтобы сравнивать с текстом прототипа. */
const plain = (s: string) => s.replace(/\u00a0/g, ' ');

type Entry = ContractorHistory['items'][number];
const cp = (over: Partial<Entry>): Entry => ({
  id: 1,
  at: '2026-10-18T04:30:00.000Z',
  actor: 'Эркин О.',
  entity: 'money_operation',
  action: 'create',
  reason: null,
  changes: [],
  subject: null,
  ...over,
});

const report = (over: Partial<ReportHistoryEntry>): ReportHistoryEntry => ({
  at: '2026-10-18T04:30:00.000Z',
  actor: 'Эркин О.',
  action: 'update',
  reason: null,
  changes: [],
  ...over,
});

const created = (changes: Entry['changes'], reason: string | null = null) =>
  plain(contractorHistoryText(t, cp({ changes, reason }), {}));

describe('история контрагента: операции с остатком', () => {
  it('списание в бонус, возврат, перевод и обратная запись — как в прототипе, без причины', () => {
    const base = (kind: string) => [
      { field: 'kind', to: kind },
      { field: 'amount', to: 30_000 },
      { field: 'opDate', to: '2026-10-18' },
      { field: 'note', to: 'по договорённости' },
    ];
    expect(created(base('bonus'))).toBe('Списано в бонус 300 сом');
    expect(created(base('refund'))).toBe('Возврат контрагенту 300 сом');
    expect(created([...base('xfer'), { field: 'holder', to: 'Иванова А.' }])).toBe(
      'Перевод 300 сом со счёта организации на счёт Иванова А.',
    );
    expect(
      created(
        [
          { field: 'kind', to: 'corr' },
          { field: 'amount', to: -10_000 },
          { field: 'opDate', to: '2026-10-18' },
          { field: 'receipt', to: '2026-10-17' },
        ],
        'ошибка в платёжке',
      ),
    ).toBe('Обратная запись к поступлению от 17.10.2026: −100 сом');
  });

  it('удаление: «Списание отменено: … Причина: …», у прочих — «Операция удалена»', () => {
    const deleted = (kind: string) =>
      plain(
        contractorHistoryText(
          t,
          cp({
            action: 'delete',
            reason: 'внесли по ошибке',
            changes: [
              { field: 'kind', from: kind },
              { field: 'amount', from: 30_000 },
              { field: 'opDate', from: '2026-10-18' },
            ],
          }),
          {},
        ),
      );
    expect(deleted('bonus')).toBe(
      'Списание отменено: списание в бонус на 300 сом от 18.10.2026. Причина: внесли по ошибке',
    );
    expect(deleted('refund')).toBe(
      'Возврат отменён: возврат контрагенту на 300 сом от 18.10.2026. Причина: внесли по ошибке',
    );
    expect(deleted('in')).toBe(
      'Операция удалена: поступление на 300 сом от 18.10.2026. Причина: внесли по ошибке',
    );
  });
});

describe('история отчёта и окна операции', () => {
  it('возврат по уточнённому расчёту и «Напомнить в WhatsApp»', () => {
    expect(
      plain(
        reportHistoryText(
          t,
          report({
            changes: [
              { field: 'revisionRefund', to: { amount: 30_000, revision: 1 } },
              { field: 'paid', from: 50_000, to: 20_000 },
            ],
          }),
          1,
        ),
      ),
    ).toBe('Возврат по уточнённому расчёту (версия 1): 300 сом в остаток контрагента');
    expect(
      reportHistoryText(t, report({ action: 'remind', changes: [{ field: 'taxReminder' }] }), 0),
    ).toBe('Напоминание в WhatsApp отправлено контрагенту');
  });

  it('окно операции: удаление и обратная запись к поступлению', () => {
    const op = { kind: 'bonus', amount: 30_000, date: '2026-10-18' } as OperationWindow;
    const h = (over: Partial<OperationWindow['history'][number]>) =>
      ({
        at: '2026-10-18T04:30:00.000Z',
        actor: 'Эркин О.',
        action: 'update',
        reason: null,
        changes: [],
        ...over,
      }) as OperationWindow['history'][number];
    expect(plain(operationHistoryText(t, op, h({ action: 'delete', reason: 'ошибка' })))).toBe(
      'Списание отменено: списание в бонус на 300 сом от 18.10.2026. Причина: ошибка',
    );
    expect(
      plain(
        operationHistoryText(
          t,
          { ...op, kind: 'in' },
          h({ changes: [{ field: 'correction', to: 10_000 }], reason: 'не учли' }),
        ),
      ),
    ).toBe('Обратная запись +100 сом: не учли');
  });
});
