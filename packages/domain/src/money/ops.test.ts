import { describe, expect, it } from 'vitest';
import {
  blockingPayments,
  closesWithMonth,
  correctionMinusLimit,
  deleteBlock,
  employeeAccount,
  inClosedMonth,
  monthToClose,
  needsReason,
  opAmountLimit,
  opLock,
  opRight,
  orgHeld,
  receiptMinimum,
  serviceStatus,
  type HeldOp,
  type OpLockFacts,
} from './ops';
import { TAX_WHATSAPP_TEMPLATE, taxPayBy, taxWhatsAppBase, withRequisites } from './reminder';
import { MONEY_MESSAGES } from './tax';

// Эталон — прототип modules/fin-op.js (`opLock`, `opMax`, `inBlock`, `opDelDlg`), modules/finance.js
// (`orgHeld`, `empBal`, `corrDlg`, `inMin`), modules/staff.js (вкладки «Счёт», «Списания в бонус»),
// modules/services.js (`svcStatus`).

const facts = (over: Partial<OpLockFacts> = {}): OpLockFacts => ({
  kind: 'pay',
  deleted: false,
  canKind: true,
  canArchiveRest: false,
  canMoney: true,
  archived: false,
  monthClosed: false,
  receiptPart: false,
  ...over,
});

describe('право на изменение операции (opPerm)', () => {
  it('списание — «Списывать в бонус», обслуживание — «Менять журнал тарифов», услуги — «Вести проекты», остальное — «Учёт денег»', () => {
    expect(opRight('bonus')).toBe('bonus');
    expect(opRight('fee')).toBe('tariff');
    expect(opRight('sp')).toBe('projects');
    expect(opRight('svc')).toBe('projects');
    for (const k of ['in', 'pay', 'refund', 'back', 'corr', 'xfer'] as const)
      expect(opRight(k)).toBe('money');
  });
});

describe('почему «Изменить» и «Удалить» нельзя (opLock)', () => {
  it('удалённая операция и оплата удалённой услуги', () => {
    expect(opLock(facts({ deleted: true }), 'edit')).toBe('op_deleted');
    expect(opLock(facts({ kind: 'sp', ownerDeleted: true }), 'del')).toBe('service_deleted');
  });
  it('возврат по уточнённому расчёту создала система', () => {
    expect(opLock(facts({ kind: 'back' }), 'edit')).toBe('op_system');
    expect(opLock(facts({ kind: 'back' }), 'del')).toBe('op_system');
  });
  it('без права — только просмотр; у архивного списание и возврат — с правом на остаток', () => {
    expect(opLock(facts({ canKind: false }), 'edit')).toBe('op_view_only');
    expect(
      opLock(facts({ kind: 'bonus', canKind: false, archived: true, canArchiveRest: true }), 'del'),
    ).toBeNull();
    expect(
      opLock(facts({ kind: 'pay', canKind: false, archived: true, canArchiveRest: true }), 'del'),
    ).toBe('op_view_only');
  });
  it('у архивного контрагента остальные операции — только просмотр', () => {
    expect(opLock(facts({ kind: 'in', archived: true }), 'edit')).toBe('op_archived');
    expect(opLock(facts({ kind: 'refund', archived: true }), 'edit')).toBeNull();
  });
  it('оплата, списание и возврат в закрытом месяце — корректирующей записью', () => {
    for (const kind of ['pay', 'bonus', 'refund'] as const)
      expect(opLock(facts({ kind, monthClosed: true }), 'del')).toBe('month_closed');
    expect(opLock(facts({ kind: 'in', monthClosed: true }), 'del')).toBeNull();
    expect(closesWithMonth('xfer')).toBe(false);
  });
  it('часть общего поступления удаляют и меняют в самом поступлении', () => {
    const part = facts({ kind: 'fee', receiptPart: true });
    expect(opLock(part, 'del')).toBe('fee_part_delete');
    expect(opLock(part, 'edit')).toBeNull();
    expect(opLock({ ...part, canMoney: false }, 'edit')).toBe('fee_part_money');
  });
  it('у каждого кода — текст', () => {
    for (const code of [
      'op_deleted',
      'service_deleted',
      'op_system',
      'op_view_only',
      'op_archived',
      'month_closed',
      'fee_part_delete',
      'fee_part_money',
    ] as const)
      expect(MONEY_MESSAGES[code]).toBeTruthy();
  });
});

describe('предел суммы при изменении (opMax)', () => {
  const m = { available: 300_000, free: 100_000, orgHeld: 50_000 };
  it('оплата налога — не больше денег на счетах, «Оплатил сам» без предела', () => {
    const pay = opAmountLimit('pay', 200_000, m);
    expect(pay).toMatchObject({ max: 500_000, code: 'op_pay_over' });
    expect(pay?.params.left).toMatch(/^3\s000\sсом$/);
    expect(pay?.params.max).toMatch(/^5\s000\sсом$/);
    expect(opAmountLimit('pay', 200_000, { ...m, self: true })).toBeNull();
  });
  it('списание и возврат — не больше свободного остатка', () => {
    expect(opAmountLimit('bonus', 20_000, m)?.max).toBe(120_000);
    expect(opAmountLimit('refund', 20_000, m)?.code).toBe('op_free_over');
  });
  it('перевод — не больше денег на счёте организации, оплата услуги — не больше стоимости', () => {
    expect(opAmountLimit('xfer', 10_000, m)?.max).toBe(60_000);
    expect(
      opAmountLimit('sp', 40_000, { ...m, service: { amount: 100_000, paid: 70_000 } })?.max,
    ).toBe(70_000);
    expect(opAmountLimit('in', 10_000, m)).toBeNull();
  });
});

const op = (
  kind: HeldOp['kind'],
  amount: number,
  holder: string | null = null,
  self = false,
): HeldOp & { contractorId: string } => ({
  kind,
  amount,
  holderKind: self ? 'client' : holder ? 'employee' : 'org',
  holderEmployeeId: holder,
  self,
  contractorId: 'c1',
});

describe('деньги на счёте организации (orgHeld)', () => {
  it('поступления на счёт организации минус оплаты и переводы, не меньше 0', () => {
    expect(
      orgHeld([
        op('in', 100_000),
        op('pay', 30_000),
        op('xfer', 20_000, 'e1'),
        op('in', 5_000, 'e1'),
      ]),
    ).toBe(50_000);
    expect(orgHeld([op('in', 10_000), op('xfer', 20_000, 'e1')])).toBe(0);
    expect(orgHeld([op('in', 10_000), op('pay', 5_000, null, true)])).toBe(10_000);
  });
});

describe('счёт сотрудника (вкладка «Счёт», empBal)', () => {
  it('приход — поступления, возвраты по уточнённому, обратные записи и переводы; расход — оплаты, бонусы, возвраты', () => {
    const acc = employeeAccount(
      [
        op('in', 100_000, 'e1'),
        op('xfer', 20_000, 'e1'),
        op('corr', -5_000, 'e1'),
        op('pay', 60_000, 'e1'),
        op('bonus', 10_000, 'e1'),
        op('refund', 3_000, 'e1'),
        op('in', 999_000, 'e2'),
        op('in', 7_000),
        { ...op('in', 40_000, 'e1'), contractorId: 'c2' },
      ],
      'e1',
    );
    expect(acc).toEqual({
      balance: 82_000,
      received: 155_000,
      paid: 60_000,
      bonus: 10_000,
      rows: [
        {
          contractorId: 'c1',
          received: 115_000,
          paid: 60_000,
          bonus: 10_000,
          out: 3_000,
          rest: 42_000,
        },
        { contractorId: 'c2', received: 40_000, paid: 0, bonus: 0, out: 0, rest: 40_000 },
      ],
    });
  });
});

describe('поступление и обратная запись', () => {
  it('на налоги должно остаться не меньше потраченного (inMin)', () => {
    expect(receiptMinimum(1_500_000, 500_000)).toBe(1_000_000);
    expect(receiptMinimum(1_500_000, 2_000_000)).toBe(0);
  });
  it('«Уменьшить» — не больше денег на счетах и поступления с его обратными записями', () => {
    expect(correctionMinusLimit(300_000, 1_000_000, -200_000)).toBe(300_000);
    expect(correctionMinusLimit(900_000, 500_000, -200_000)).toBe(300_000);
    expect(correctionMinusLimit(-5, 500_000, 0)).toBe(0);
  });
  it('удалить нельзя потраченное поступление и потраченную обратную запись «+»', () => {
    expect(deleteBlock('in', 1_500_000, 500_000)).toBe('receipt_spent');
    expect(deleteBlock('in', 1_500_000, 1_500_000)).toBeNull();
    expect(deleteBlock('corr', 50_000, 10_000)).toBe('correction_spent');
    expect(deleteBlock('corr', -50_000, 0)).toBeNull();
    expect(deleteBlock('pay', 50_000, 0)).toBeNull();
  });
  it('мешающие оплаты: сначала по отчётам детализации, потом от новых к старым, не больше 8', () => {
    const pays = Array.from({ length: 10 }, (_, i) => ({
      id: `p${i}`,
      reportId: i === 2 ? 'r1' : `x${i}`,
      date: `2026-10-${String(10 + i).padStart(2, '0')}`,
      amount: 100,
      createdAt: i,
    }));
    const out = blockingPayments(pays, new Set(['r1']));
    expect(out.map((p) => p.id)).toEqual(['p2', 'p9', 'p8', 'p7', 'p6', 'p5', 'p4', 'p3']);
  });
});

describe('закрытие месяца и разовые услуги', () => {
  it('закрывается прошлый месяц; операция в закрытом месяце', () => {
    expect(monthToClose('2026-01-15')).toBe('2025-12');
    expect(inClosedMonth('2026-10-31', new Set(['2026-10']))).toBe(true);
    expect(inClosedMonth('2026-11-01', new Set(['2026-10']))).toBe(false);
  });
  it('статус оплаты услуги (svcStatus)', () => {
    expect(serviceStatus(100, 0)).toBe('unpaid');
    expect(serviceStatus(100, 40)).toBe('partial');
    expect(serviceStatus(100, 100)).toBe('paid');
  });
  it('причина нужна, когда меняются сумма, дата, счёт или детализация', () => {
    expect(needsReason(['note'])).toBe(false);
    expect(needsReason(['note', 'amount'])).toBe(true);
    expect(needsReason(['holder'])).toBe(true);
    expect(needsReason([])).toBe(false);
  });
});

describe('напоминание о налоге в WhatsApp (waDlg)', () => {
  it('«перечислить до»: прошедший срок — завтра, до срока меньше двух дней — срок, иначе за два дня', () => {
    expect(taxPayBy('2026-10-20', '2026-10-28')).toBe('2026-10-29');
    expect(taxPayBy('2026-10-29', '2026-10-28')).toBe('2026-10-29');
    expect(taxPayBy('2026-10-30', '2026-10-28')).toBe('2026-10-28');
    expect(taxPayBy('2026-11-25', '2026-10-28')).toBe('2026-11-23');
  });
  it('шаблон waTax: подстановки и отмеченные реквизиты через «; », без реквизитов — «—»', () => {
    const base = taxWhatsAppBase(TAX_WHATSAPP_TEMPLATE, {
      contractor: 'ОсОО «Ала-Тоо»',
      report: 'Налог на добавленную стоимость',
      period: 'Сентябрь 2026',
      due: '2026-10-20',
      left: 300_000,
      payDue: '2026-10-25',
      today: '2026-10-28',
    });
    expect(base).toContain('Уважаемые ОсОО «Ала-Тоо»!');
    expect(base).toContain('за Сентябрь 2026, срок — 20.10.2026');
    expect(base).toMatch(/Сумма налога — 3\s000\sсом\. Просим перечислить её до 29\.10\.2026/);
    expect(withRequisites(base, ['Мбанк 0555', 'Оптима 1234'])).toContain(
      'на: Мбанк 0555; Оптима 1234,',
    );
    expect(withRequisites(base, [])).toContain('на: —,');
  });
});
