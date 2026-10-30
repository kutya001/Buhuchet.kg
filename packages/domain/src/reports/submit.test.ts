import { describe, expect, it } from 'vitest';
import type { SingleTaxRateText } from '../dicts/value-guide';
import { formatText, UI_TEXTS, type Translate } from '../l10n/texts';
import type { RateAddition, ReportAct } from '../platform-dicts/catalog';
import fixture from './__fixtures__/tax-lines.json';
import type { ReportStatus } from './rules';
import {
  lineTax,
  reportBack,
  reportConfirmRefusal,
  reportFileRequired,
  reportLinesOf,
  reportMarkOf,
  reportNotRequiredAllowed,
  reportPaymentLines,
  reportRateLines,
  reportReceiptRequired,
  reportSubmittable,
  reportWaiting,
  type LineAssignment,
  type ReportLine,
} from './submit';

// Эталон — прототип (scripts/oracle-tax-lines.mjs): taxLines и lineTax на видах, ставках ЕН и строках НСП.
const t: Translate = (key, params) => formatText(UI_TEXTS[key].ru, params);
const types = fixture.types as unknown as Record<string, { rateAdditions: RateAddition[] }>;
const rates = fixture.rates as SingleTaxRateText[];
const som = (v: number) => Math.round(v * 100);

type StoredCase = {
  key: string;
  label: string;
  pct: string;
  cash: boolean | null;
  rev: number | null;
  tax: number | null;
};
const storedLines = (stored: readonly StoredCase[]): ReportLine[] =>
  stored
    .filter((l) => l.rev !== null || l.tax !== null)
    .map((l) => ({
      kind: 'rate',
      key: l.key,
      label: l.label,
      pct: l.pct,
      cash: l.cash,
      revenue: l.rev === null ? null : som(l.rev),
      tax: som(l.tax ?? 0),
    }));

describe('Строки суммы по ставкам', () => {
  it.each(fixture.cases.map((c, i) => ({ ...c, i })))(
    '#$i $typeCode ($act) на $date — как в прототипе',
    ({ typeCode, act, date, assignment, stored, expected }) => {
      const defs = reportRateLines(
        {
          typeCode,
          act: act as ReportAct,
          assignment: assignment as LineAssignment | null,
          typeAdditions: types[typeCode]?.rateAdditions ?? [],
          rates,
          date,
          stored: storedLines(stored as StoredCase[]),
        },
        t,
      );
      expect(
        defs.map(({ key, label, pct, cash, old }) => ({ key, label, pct, cash, old })),
      ).toEqual(expected);
    },
  );

  it.each(fixture.taxes)(
    'налог строки: $rev сом × $pct = $expected сом',
    ({ rev, pct, expected }) => {
      expect(lineTax(som(rev), pct)).toBe(som(expected));
    },
  );
});

describe('Сумма из строк', () => {
  const assignment: LineAssignment = {
    rate: null,
    enRates: [{ code: 'ЕНС-04', variant: null }],
    rateAdditions: [],
  };
  const defs = reportRateLines(
    { typeCode: 'enq', act: 'both', assignment, typeAdditions: [], rates, date: '2026-07-01' },
    t,
  );

  it('п. 61: ЕНС-04, безнал 300 000 и нал 200 000 → 12 000 + 12 000, итог 24 000', () => {
    expect(defs.map((d) => [d.key, d.pct, d.cash])).toEqual([
      ['ЕНС-04:cl', '4 %', false],
      ['ЕНС-04:ca', '6 %', true],
    ]);
    const res = reportLinesOf(defs, [
      { key: 'ЕНС-04:cl', revenue: som(300_000), tax: null },
      { key: 'ЕНС-04:ca', revenue: som(200_000), tax: null },
    ]);
    expect(res).toMatchObject({ ok: true, total: som(24_000) });
    expect(res.ok && res.lines.map((l) => l.tax)).toEqual([som(12_000), som(12_000)]);
  });

  it('налог без выручки — как введён; пустые строки не сохраняются; все пустые — итога нет', () => {
    const res = reportLinesOf(defs, [
      { key: 'ЕНС-04:cl', revenue: null, tax: som(500) },
      { key: 'ЕНС-04:ca', revenue: null, tax: null },
    ]);
    expect(res).toMatchObject({ ok: true, total: som(500) });
    expect(res.ok && res.lines).toHaveLength(1);
    expect(reportLinesOf(defs, [{ key: 'ЕНС-04:cl', revenue: null, tax: null }])).toEqual({
      ok: true,
      lines: [],
      total: null,
    });
  });

  it('чужой ключ, повтор строки и отрицательное значение — отказ по строке', () => {
    expect(reportLinesOf(defs, [{ key: 'ЕНС-99:r', revenue: 1, tax: null }])).toEqual({
      ok: false,
      key: 'ЕНС-99:r',
    });
    expect(reportLinesOf(defs, [{ key: 'ЕНС-04:cl', revenue: -100, tax: null }])).toMatchObject({
      ok: false,
    });
    expect(
      reportLinesOf(defs, [
        { key: 'ЕНС-04:cl', revenue: 100, tax: null },
        { key: 'ЕНС-04:cl', revenue: 200, tax: null },
      ]),
    ).toMatchObject({ ok: false });
  });

  it('строки платежей: у вида с двумя платежами — по каждому, итог — их сумма; у «Сдача» — нет', () => {
    const payments = [
      { name: 'Подоходный налог', authority: 'ГНС', kbk: '11110000' },
      { name: 'Страховые взносы', authority: 'СФ', kbk: '12110000' },
    ];
    const lines = reportPaymentLines(payments, 'both');
    expect(lines.map((l) => [l.key, l.label, l.kbk])).toEqual([
      ['pay:0', 'Подоходный налог', '11110000'],
      ['pay:1', 'Страховые взносы', '12110000'],
    ]);
    expect(reportPaymentLines(payments, 'sub')).toEqual([]);
    expect(reportPaymentLines(payments.slice(0, 1), 'both')).toEqual([]);
    const res = reportLinesOf(lines, [
      { key: 'pay:0', revenue: som(1_000), tax: som(2_500) },
      { key: 'pay:1', revenue: null, tax: som(3_000) },
    ]);
    expect(res).toMatchObject({ ok: true, total: som(5_500) });
    // У строки платежа выручки нет.
    expect(res.ok && res.lines[0]!.revenue).toBeNull();
  });

  it('у вида «Сдача» строк по ставкам нет', () => {
    expect(
      reportRateLines(
        { typeCode: 'enq', act: 'sub', assignment, typeAdditions: [], rates, date: '2026-07-01' },
        t,
      ),
    ).toEqual([]);
  });
});

describe('Подтверждение сдачи', () => {
  const sub = (
    o: Partial<{
      status: ReportStatus;
      act: ReportAct;
      confirmed: boolean;
      submittedBy: string | null;
      superseded: boolean;
    }> = {},
  ) => ({
    status: 'submitted' as ReportStatus,
    act: 'both' as ReportAct,
    confirmed: false,
    submittedBy: 'u-acc',
    superseded: false,
    ...o,
  });
  const chief = { canConfirm: true, userId: 'u-chief', isOwner: false };

  it('п. 62: сданный ждёт подтверждения; подтверждённый — «Подтверждено»; выключено — отметок нет', () => {
    expect(reportWaiting(sub(), true)).toBe(true);
    expect(reportMarkOf(sub(), true)).toBe('waiting');
    expect(reportMarkOf(sub({ confirmed: true }), true)).toBe('confirmed');
    expect(reportMarkOf(sub(), false)).toBeNull();
    expect(reportMarkOf(sub({ act: 'pay' }), true)).toBeNull();
    expect(reportMarkOf(sub({ status: 'in_progress' }), true)).toBeNull();
  });

  it('п. 62: подтверждает другой сотрудник с правом; свой — нельзя, кроме владельца', () => {
    expect(reportConfirmRefusal(sub(), chief, true)).toBeNull();
    expect(reportConfirmRefusal(sub(), { ...chief, canConfirm: false }, true)).toBe(
      'report_confirm_right',
    );
    expect(reportConfirmRefusal(sub(), { ...chief, userId: 'u-acc' }, true)).toBe(
      'report_confirm_own',
    );
    expect(
      reportConfirmRefusal(sub(), { ...chief, userId: 'u-acc', isOwner: true }, true),
    ).toBeNull();
    expect(reportConfirmRefusal(sub({ confirmed: true }), chief, true)).toBe('report_not_waiting');
    expect(reportConfirmRefusal(sub(), chief, false)).toBe('report_not_waiting');
  });

  it('откат на шаг: подтверждение снимается, затем «Сдан» → «В работе»; прежняя версия — сначала уточнённая', () => {
    expect(reportBack(sub({ confirmed: true }), true)).toEqual({ to: 'waiting' });
    expect(reportBack(sub({ confirmed: true }), false)).toEqual({ to: 'in_progress' });
    expect(reportBack(sub(), true)).toEqual({ to: 'in_progress' });
    expect(reportBack(sub({ status: 'needs_fix' }), true)).toEqual({ to: 'submitted' });
    expect(reportBack(sub({ status: 'not_required' }), true)).toEqual({ to: 'todo' });
    expect(reportBack(sub({ status: 'todo' }), true)).toBeNull();
    expect(reportBack(sub({ superseded: true }), true)).toEqual({
      refusal: 'report_rollback_superseded',
    });
    expect(reportBack(sub({ status: 'not_required', superseded: true }), true)).toEqual({
      to: 'todo',
    });
  });
});

describe('Файл и квитанция при сдаче', () => {
  const on = { confirmOn: true, filesOn: true };

  it('файл обязателен по настройке вида; квитанция — при сдаче, если подтверждение выключено', () => {
    expect(reportFileRequired({ needFile: true, needReceipt: false }, on)).toBe(true);
    expect(reportFileRequired({ needFile: false, needReceipt: true }, on)).toBe(false);
    expect(
      reportFileRequired({ needFile: false, needReceipt: true }, { ...on, confirmOn: false }),
    ).toBe(true);
    expect(reportReceiptRequired({ needFile: false, needReceipt: true }, on)).toBe(true);
  });

  it('без «Файлов в карточках» требования нет (docs/deviations.md п. Б-6)', () => {
    const off = { confirmOn: false, filesOn: false };
    expect(reportFileRequired({ needFile: true, needReceipt: true }, off)).toBe(false);
    expect(reportReceiptRequired({ needFile: true, needReceipt: true }, off)).toBe(false);
  });
});

describe('Шаги сдачи', () => {
  const r = (
    status: ReportStatus,
    o: Partial<{ act: ReportAct; superseded: boolean; confirmed: boolean }> = {},
  ) => ({
    status,
    act: 'both' as ReportAct,
    superseded: false,
    confirmed: false,
    ...o,
  });

  it('«Отметить сданным» — у несданного со сдачей, не у прежней версии и не у «Уплаты»', () => {
    expect(
      ['todo', 'in_progress', 'needs_fix'].map((s) => reportSubmittable(r(s as ReportStatus))),
    ).toEqual([true, true, true]);
    expect(reportSubmittable(r('submitted'))).toBe(false);
    expect(reportSubmittable(r('todo', { act: 'pay' }))).toBe(false);
    expect(reportSubmittable(r('todo', { superseded: true }))).toBe(false);
  });

  it('«Не требуется» — кроме окончательно сданного; ждущий подтверждения — можно', () => {
    expect(reportNotRequiredAllowed(r('todo'), true)).toBe(true);
    expect(reportNotRequiredAllowed(r('submitted'), true)).toBe(true);
    expect(reportNotRequiredAllowed(r('submitted', { confirmed: true }), true)).toBe(false);
    expect(reportNotRequiredAllowed(r('submitted'), false)).toBe(false);
    expect(reportNotRequiredAllowed(r('not_required'), true)).toBe(false);
  });
});
