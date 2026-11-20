import { defaultUiTexts, subscriptionCalc } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import {
  calcHint,
  gbText,
  kindLabel,
  lineText,
  payBlocked,
  payCalc,
  payChoice,
  payDefaults,
  payPlans,
  payProblem,
  requisitesText,
  termText,
  whoText,
  type PayState,
  type SubPay,
  type SubView,
} from './sub-model';

// Экран «Подписка» и окно оплаты без React (прототип v154 `modules/org-sub.js`, `core/subs.js`):
// значения окна, отказы как у прототипа (`errs`), расчёт — тот же, что у сервера.

const t = makeTranslate(defaultUiTexts());
const MB = 1024 * 1024;

const pay = (o: Partial<SubPay> = {}): SubPay => ({
  id: '00000000-0000-4000-8000-0000000000a1',
  at: '2026-11-18T04:05:00.000Z',
  kind: 'renew',
  startMode: 'now',
  planId: 'm3',
  planName: '3 месяца',
  months: 3,
  seats: 20,
  extraGb: 1,
  amount: 600_000,
  lines: [],
  receipt: { name: 'чек.pdf', type: 'application/pdf', bytes: 1000 },
  status: 'confirmed',
  opensAccess: true,
  reason: null,
  decidedAt: null,
  paidUntil: null,
  by: 'Садыков Э.',
  again: false,
  version: 1,
  ...o,
});

const view = (o: Partial<SubView> = {}): SubView => ({
  today: '2026-11-20',
  org: { name: 'ОсОО «Бухгалтер»', inn: '01234567890123' },
  status: 'active',
  closed: false,
  sub: {
    planId: 'm3',
    planName: '3 месяца',
    seats: 20,
    extraGb: 1,
    paidUntil: '2027-01-31',
    free: false,
    firstPaid: true,
    extraDiscountPct: 10,
    next: null,
  },
  usage: { seatsUsed: 14, seats: 20, extraGb: 1, bytesUsed: 1500 * MB, bytesLimit: 7000 * MB },
  prices: {
    seatPrice: 10_000,
    gbPrice: 10_000,
    seatStep: 10,
    baseMb: 2000,
    seatMb: 200,
    firstMonthPct: 50,
    extraDiscountOver: 150,
    remindDays: 7,
    checkDays: 3,
  },
  requisites: {
    recipient: 'ОсОО «Бухучет»',
    recipientInn: '02345678901234',
    bank: 'Банк',
    bik: '123001',
    account: '1234567890123456',
    purpose: 'Подписка ОсОО «Бухгалтер», ИНН 01234567890123',
  },
  plans: [
    { id: 'm1', name: '1 месяц', months: 1, discountPct: 0, perks: [], active: true },
    { id: 'm3', name: '3 месяца', months: 3, discountPct: 5, perks: [], active: true },
    { id: 'old', name: 'Старый', months: 6, discountPct: 10, perks: [], active: false },
  ],
  monthsLeft: 3,
  renewTotal: 600_000,
  lastRejected: false,
  payments: [],
  ...o,
});

const st = (o: Partial<PayState> = {}): PayState => ({
  planId: 'm3',
  seats: 20,
  extraGb: 1,
  startMode: 'now',
  ...o,
});

describe('подписи экрана', () => {
  it('ГБ одним знаком после запятой, как subGb прототипа', () => {
    expect(gbText(2000)).toBe('2');
    expect(gbText(1450)).toBe('1,5');
    expect(gbText(0)).toBe('0');
  });

  it('вид подписки, срок строки и кто отправил', () => {
    expect(kindLabel(t, null)).toBe('Нет подписки');
    expect(kindLabel(t, { ...view().sub!, free: true, paidUntil: '2026-12-05' })).toBe(
      'Бесплатный период до 05.12.2026',
    );
    expect(kindLabel(t, view().sub)).toBe('3 месяца');
    expect(termText(t, pay({ kind: 'free', months: 0, paidUntil: '2026-12-05' }))).toBe(
      'до 05.12.2026',
    );
    expect(termText(t, pay())).toBe('3 мес.');
    expect(termText(t, pay({ kind: 'admin', months: 0 }))).toBe('—');
    expect(whoText(t, pay())).toBe('Садыков Э.');
    expect(whoText(t, pay({ by: null, kind: 'free' }))).toBe('Система');
    expect(whoText(t, pay({ by: null, kind: 'admin' }))).toBe('Администратор платформы');
  });

  it('строки расчёта словами', () => {
    expect(lineText(t, { k: 'seats', n: 20, price: 9500, months: 3, sum: 570_000 })).toBe(
      'Контрагенты: 20 × 95,00 × 3 мес.',
    );
    expect(lineText(t, { k: 'first', pct: 50, sum: -10_000 })).toBe('Скидка первого месяца 50 %');
  });

  it('виды окна — действующие и нынешний', () => {
    expect(payPlans(view()).map((p) => p.id)).toEqual(['m1', 'm3']);
    const old = view({ sub: { ...view().sub!, planId: 'old' } });
    expect(payPlans(old).map((p) => p.id)).toEqual(['m1', 'm3', 'old']);
  });
});

describe('значения окна оплаты (прототип subPayDlg → st)', () => {
  it('продление — нынешний вид и пакет, не меньше активных', () => {
    expect(payDefaults(view(), 'renew')).toEqual(st());
    const many = view({ usage: { ...view().usage, seatsUsed: 27 } });
    expect(payDefaults(many, 'renew').seats).toBe(30);
  });

  it('нынешний вид отключён — первый действующий; подписки нет — пакет по активным', () => {
    const old = view({ sub: { ...view().sub!, planId: 'old' } });
    expect(payDefaults(old, 'renew').planId).toBe('m1');
    const none = view({ sub: null, usage: { ...view().usage, seats: 0, extraGb: 0 } });
    expect(payDefaults(none, 'renew')).toMatchObject({ planId: 'm1', seats: 20, extraGb: 0 });
  });

  it('расширение — на шаг больше, память — на 1 ГБ больше', () => {
    expect(payDefaults(view(), 'grow')).toMatchObject({ seats: 30, startMode: 'now' });
    expect(payDefaults(view(), 'mem')).toMatchObject({ extraGb: 2 });
  });

  it('«Прикрепить другой чек» — значения отклонённой оплаты; «со следующего» — только если месяцев больше одного', () => {
    const pre = pay({ kind: 'grow', seats: 40, extraGb: 3, startMode: 'next', status: 'rejected' });
    expect(payDefaults(view(), 'grow', pre)).toEqual(
      st({ seats: 40, extraGb: 3, startMode: 'next' }),
    );
    expect(payDefaults(view({ monthsLeft: 1 }), 'grow', pre).startMode).toBe('now');
  });

  it('на сервер: память не меняет пакет, расширение — память, продление — сразу', () => {
    expect(payChoice(view(), 'mem', st({ seats: 90, extraGb: 4, startMode: 'next' }))).toEqual({
      kind: 'mem',
      planId: null,
      seats: 20,
      extraGb: 4,
      startMode: 'next',
    });
    expect(payChoice(view(), 'grow', st({ seats: 30, extraGb: 9 }))).toMatchObject({
      planId: null,
      seats: 30,
      extraGb: 1,
    });
    expect(payChoice(view(), 'renew', st({ startMode: 'next' }))).toMatchObject({
      planId: 'm3',
      startMode: 'now',
    });
  });
});

describe('отказы окна (прототип errs)', () => {
  it('пакет — по 10, не меньше активных, при расширении — больше нынешнего', () => {
    expect(payProblem(t, view(), 'renew', st({ seats: 15 }))).toEqual({
      field: 'seats',
      text: 'Пакет — по 10 контрагентов: 10, 20, 30…',
    });
    const many = view({ usage: { ...view().usage, seatsUsed: 21 } });
    expect(payProblem(t, many, 'renew', st({ seats: 20 }))?.text).toBe(
      'Сначала переведите в архив 1 контрагента: активных 21',
    );
    expect(payProblem(t, view(), 'grow', st({ seats: 20 }))?.text).toBe(
      'Новый пакет должен быть больше нынешнего: сейчас 20',
    );
  });

  it('память: целое, больше нынешней у «Купить память», занятое помещается', () => {
    expect(payProblem(t, view(), 'renew', st({ extraGb: 1.5 }))?.field).toBe('extraGb');
    expect(payProblem(t, view(), 'mem', st({ extraGb: 1 }))?.text).toBe(
      'Укажите больше, чем сейчас: 1 ГБ сверх',
    );
    const full = view({ usage: { ...view().usage, bytesUsed: 6500 * MB } });
    expect(payProblem(t, full, 'renew', st({ extraGb: 0 }))?.text).toBe(
      'Сначала удалите лишние файлы: занято 6,5 ГБ, а с такой памятью лимит — 6 ГБ',
    );
  });

  it('продление без действующего вида — «Выберите вид подписки»', () => {
    expect(payProblem(t, view(), 'renew', st({ planId: 'old' }))).toEqual({
      field: 'plan',
      text: 'Выберите вид подписки',
    });
    expect(payProblem(t, view(), 'renew', st())).toBeNull();
  });
});

describe('расчёт окна', () => {
  it('тот же расчёт, что у сервера', () => {
    const v = view();
    const calc = payCalc(v, 'renew', st({ seats: 30 }))!;
    expect(calc).toEqual(
      subscriptionCalc({
        kind: 'renew',
        prices: v.prices,
        plan: v.plans[1]!,
        sub: {
          planId: 'm3',
          seats: 20,
          extraGb: 1,
          paidUntil: '2027-01-31',
          extraDiscountPct: 10,
          firstPaid: true,
        },
        seats: 30,
        extraGb: 1,
        startMode: 'now',
        today: '2026-11-20',
      }),
    );
    expect(calc.total).toBeGreaterThan(0);
    expect(payCalc(v, 'renew', st({ planId: 'нет' }))).toBeNull();
  });

  it('пояснение под расчётом', () => {
    const v = view();
    const renew = calcHint(t, v, 'renew', st(), payCalc(v, 'renew', st())!);
    expect(renew).toBe(
      'После проверки чека: 3 месяца, оплачено до 30.04.2027; пакет 20, память 7 ГБ',
    );
    const grow = st({ seats: 30 });
    expect(calcHint(t, v, 'grow', grow, payCalc(v, 'grow', grow)!)).toBe(
      '10 новых мест — сразу после отправки чека. Доплата за 3 месяца: текущий месяц подписки целиком и оставшиеся месяцы срока',
    );
    const next = st({ seats: 30, startMode: 'next' });
    expect(calcHint(t, v, 'grow', next, payCalc(v, 'grow', next)!)).toBe(
      'Со следующего месяца подписки: пакет 30. За текущий месяц доплаты нет',
    );
  });

  it('«Скопировать всё» — строки с подписями, сумма только посчитанная', () => {
    const text = requisitesText(t, view(), 600_000);
    expect(text.split('\n')).toEqual([
      'Получатель: ОсОО «Бухучет»',
      'ИНН: 02345678901234',
      'Банк: Банк',
      'БИК: 123001',
      'Счёт: 1234567890123456',
      'Назначение платежа: Подписка ОсОО «Бухгалтер», ИНН 01234567890123',
      'Сумма: 6 000 сом',
    ]);
    const empty = view({ requisites: { ...view().requisites, bank: null } });
    expect(requisitesText(t, empty, null)).not.toMatch(/Банк|Сумма/);
  });
});

describe('кнопки оплаты', () => {
  it('чек на проверке — ждать; расширить и память — только у действующей', () => {
    const wait = view({ payments: [pay({ status: 'pending' })] });
    expect(payBlocked(wait, 'renew')).toBe('wait');
    expect(payBlocked(view({ closed: true }), 'mem')).toBe('closed');
    expect(payBlocked(view({ sub: null }), 'grow')).toBe('closed');
    expect(payBlocked(view({ closed: true }), 'renew')).toBeNull();
    expect(payBlocked(view(), 'grow')).toBeNull();
  });
});
