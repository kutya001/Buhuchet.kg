import { defaultUiTexts } from '@buhuchet/domain';
import type { ContractorHistory, OperationWindow, ReportHistoryEntry } from '@buhuchet/shared';
import { describe, expect, it } from 'vitest';
import { contractorHistoryText } from '../contractors/contractor-history';
import { makeTranslate } from '../l10n/translate';
import { noFreeReason } from '../money/contractor-money';
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

  it('окно поступления: «Поступление … записано» и удаление — на всю сумму с частью за обслуживание', () => {
    const op = { kind: 'in', amount: 50_000, date: '2026-10-18' } as OperationWindow;
    const h = (over: Partial<OperationWindow['history'][number]>) =>
      ({
        at: '2026-10-18T04:30:00.000Z',
        actor: 'Эркин О.',
        action: 'create',
        reason: null,
        changes: [],
        ...over,
      }) as OperationWindow['history'][number];
    const fee = { field: 'feeTotal', to: 20_000 };
    expect(
      plain(operationHistoryText(t, op, h({ changes: [{ field: 'total', to: 50_000 }, fee] }))),
    ).toBe('Поступление 700 сом записано');
    // Без права «Видеть плату» сервер части за обслуживание не отдаёт — только налоги.
    expect(
      plain(operationHistoryText(t, op, h({ changes: [{ field: 'total', to: 50_000 }] }))),
    ).toBe('Поступление 500 сом записано');
    expect(
      plain(
        operationHistoryText(
          t,
          op,
          h({
            action: 'delete',
            reason: 'ошибка',
            changes: [
              { field: 'kind', from: 'in' },
              { field: 'amount', from: 50_000 },
              { field: 'opDate', from: '2026-10-18' },
              { field: 'feeTotal', from: 20_000 },
            ],
          }),
        ),
      ),
    ).toBe('Операция удалена: поступление на 700 сом от 18.10.2026. Причина: ошибка');
  });
});

describe('бледные «Списать в бонус» и «Вернуть остаток»', () => {
  it('причина — как в прототипе: деньги нужны на налоги или денег нет', () => {
    const m = (free: number, available: number) => ({ free, balance: { available } });
    expect(noFreeReason(t, m(30_000, 100_000))).toBeNull();
    expect(plain(noFreeReason(t, m(0, 1_200_000))!)).toBe(
      'Свободного остатка нет: 12 000 сом нужны на неоплаченные налоги',
    );
    // Недостача: свободный остаток ниже нуля — нужны все деньги на счёте.
    expect(plain(noFreeReason(t, m(-50_000, 300_000))!)).toBe(
      'Свободного остатка нет: 3 000 сом нужны на неоплаченные налоги',
    );
    expect(noFreeReason(t, m(0, 0))).toBe('Свободного остатка нет: денег контрагента на счёте нет');
  });
});

// Изменение и удаление (задача 2.22; прототип modules/fin-op.js `opEditDlg` → opLog, modules/
// contractors.js inDlg с `edit`, modules/contractor-card.js — изменение оплаты за обслуживание).
describe('история изменения операций (было → стало)', () => {
  it('операция: сумма, дата, счёт и примечание — с причиной', () => {
    const text = contractorHistoryText(
      t,
      cp({
        action: 'update',
        reason: 'ошибка в сумме',
        changes: [
          { field: 'kind', from: 'bonus', to: 'bonus' },
          { field: 'amount', from: 30000, to: 25000 },
          { field: 'opDate', from: '2026-10-18', to: '2026-10-17' },
          {
            field: 'holder',
            from: { kind: 'org', name: null },
            to: { kind: 'employee', name: 'Асель К.' },
          },
          { field: 'note', from: '', to: 'остаток' },
        ],
      }),
      {},
    );
    expect(plain(text)).toBe(
      'Изменено: сумма 300,00 → 250,00 сом; дата 18.10.2026 → 17.10.2026; счёт: счёт организации → счёт Асель К.; примечание «—» → «остаток». Причина: ошибка в сумме',
    );
  });

  it('обратная запись — суммы со знаком', () => {
    const text = contractorHistoryText(
      t,
      cp({
        action: 'update',
        reason: 'знак',
        changes: [
          { field: 'kind', from: 'corr', to: 'corr' },
          { field: 'amount', from: -10000, to: 10000 },
        ],
      }),
      {},
    );
    expect(plain(text)).toBe('Изменено: сумма −100,00 → +100,00 сом. Причина: знак');
  });

  it('поступление: общая сумма с платой и детализация с авансом', () => {
    const text = contractorHistoryText(
      t,
      cp({
        action: 'update',
        reason: 'уточнили',
        changes: [
          { field: 'kind', from: 'in', to: 'in' },
          { field: 'total', from: 1500000, to: 1200000 },
          {
            field: 'allocations',
            from: [{ report: 'НДС 09.2026', amount: 1000000 }],
            to: [{ report: 'НДС 09.2026', amount: 1000000 }],
          },
          { field: 'feeTotal', from: 0, to: 0 },
        ],
      }),
      {},
    );
    expect(plain(text)).toBe(
      'Изменено: общая сумма 15 000,00 → 12 000,00 сом; детализация «НДС 09.2026 — 10 000; аванс — 5 000» → «НДС 09.2026 — 10 000; аванс — 2 000». Причина: уточнили',
    );
  });

  it('оплата за обслуживание: месяцы, куда, примечание словом; удаление', () => {
    const edited = contractorHistoryText(
      t,
      cp({
        entity: 'fee_payment',
        action: 'update',
        reason: 'не тот месяц',
        changes: [
          { field: 'amount', from: 1400000, to: 1600000 },
          {
            field: 'allocation',
            from: [{ month: '2026-09', amount: 1400000 }],
            to: [{ month: '2026-10', amount: 1400000 }],
          },
          { field: 'to', from: 'счёт организации', to: 'владельцу организации' },
          { field: 'note', from: '', to: 'x' },
        ],
      }),
      {},
    );
    expect(plain(edited)).toBe(
      'Изменено: сумма 14 000,00 → 16 000,00 сом; месяцы «сентябрь 2026 — 14 000» → «октябрь 2026 — 14 000»; куда: счёт организации → владельцу организации; примечание. Причина: не тот месяц',
    );
    const deleted = contractorHistoryText(
      t,
      cp({
        entity: 'fee_payment',
        action: 'delete',
        reason: 'дубль',
        changes: [
          { field: 'amount', from: 1400000 },
          { field: 'paidOn', from: '2026-10-05' },
        ],
      }),
      {},
    );
    expect(plain(deleted)).toBe(
      'Операция удалена: оплата за обслуживание на 14 000 сом от 05.10.2026. Причина: дубль',
    );
  });

  it('сохранено без изменений: поступление и оплата за обслуживание — как в прототипе', () => {
    const receipt = cp({ action: 'update', changes: [{ field: 'kind', from: 'in', to: 'in' }] });
    expect(contractorHistoryText(t, receipt, {})).toBe('Сохранено без изменений');
    const op = { kind: 'in', amount: 30_000, date: '2026-10-18' } as OperationWindow;
    expect(
      operationHistoryText(t, op, {
        at: receipt.at,
        actor: receipt.actor,
        action: 'update',
        reason: null,
        changes: receipt.changes,
      } as OperationWindow['history'][number]),
    ).toBe('Сохранено без изменений');
    const fee = cp({ entity: 'fee_payment', action: 'update', changes: [] });
    expect(contractorHistoryText(t, fee, {})).toBe('Изменено: без изменений');
  });
});
