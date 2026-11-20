import { defaultUiTexts } from '@buhuchet/domain';
import type { AdminSubscriptionCard, AdminSubscriptionPayment } from '@buhuchet/shared';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import {
  localGridPage,
  subBar,
  subConfigText,
  subDaysText,
  subFieldError,
  subGb,
  subGbLimit,
  subHistoryText,
  subLineText,
  subPaidToText,
  subPayTerm,
  subPayWhat,
  subPlanPrice,
  subPlateColors,
} from './subs-model';

// Тексты вкладки «Подписки» Админки (доработки 20.11.2026, блок 6; прототип admin/subs-admin.js и
// core/subs.js): ГБ, дни, что оплачено, строки расчёта, «Оплачено до», полосы, плашки, «История
// изменений» подписки и видов с ценами, страница списка «Виды подписок».

const t = makeTranslate(defaultUiTexts());
/** Разряды и «сом» — через неразрывный пробел: в ожиданиях — обычный. */
const sp = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');
const MB = 1024 * 1024;

type Payment = AdminSubscriptionPayment;
type Entry = AdminSubscriptionCard['history'][number];

const pay = (over: Partial<Payment>): Payment =>
  ({
    kind: 'renew',
    planName: 'Квартал',
    paidUntil: null,
    seats: 20,
    extraGb: 0,
    startMode: 'now',
    months: 3,
    ...over,
  }) as Payment;

const entry = (over: Partial<Entry>): Entry => ({
  id: 'h1',
  at: '2026-11-20T04:30:00.000Z',
  actor: null,
  actorAdmin: true,
  action: 'update',
  changes: [],
  reason: null,
  ...over,
});

const ctx = {
  planName: (id: string) => ({ m1: 'Месяц', q3: 'Квартал' })[id] ?? id,
  paidUntil: null,
};

describe('подписки: ГБ и дни', () => {
  it('ГБ одним знаком после запятой, 1 ГБ = 1 000 МБ (прототип subGb)', () => {
    expect(subGb(0)).toBe('0');
    expect(subGb(9_400 * MB)).toBe('9,4');
    expect(subGb(14_000 * MB)).toBe('14');
    expect(subGbLimit(null)).toBe('∞');
    expect(subGbLimit(2_000 * MB)).toBe('2');
  });

  it('дни в нужной форме', () => {
    expect(subDaysText(t, 1)).toBe('1 день');
    expect(subDaysText(t, 3)).toBe('3 дня');
    expect(subDaysText(t, 11)).toBe('11 дней');
  });
});

describe('подписки: что оплачено и расчёт', () => {
  it('что оплачено по виду заявки (прототип subPayWhat)', () => {
    expect(subPayWhat(t, pay({}))).toBe('Продление: Квартал');
    expect(subPayWhat(t, pay({ kind: 'free', paidUntil: '2026-12-20' }))).toBe(
      'Бесплатный период до 20.12.2026',
    );
    expect(subPayWhat(t, pay({ kind: 'grow', seats: 30 }))).toBe('Расширение пакета до 30');
    expect(subPayWhat(t, pay({ kind: 'mem', extraGb: 5, startMode: 'next' }))).toBe(
      'Память сверх: 5 ГБ со следующего месяца',
    );
    expect(subPayWhat(t, pay({ kind: 'admin' }))).toBe('Изменено администратором');
  });

  it('срок: месяцы, «до …» у бесплатного, «—» без месяцев', () => {
    expect(subPayTerm(t, pay({}))).toBe('3 мес.');
    expect(subPayTerm(t, pay({ kind: 'free', paidUntil: '2026-12-20' }))).toBe('до 20.12.2026');
    expect(subPayTerm(t, pay({ kind: 'grow', months: 0 }))).toBe('—');
  });

  it('строки расчёта (прототип subCalc → lines)', () => {
    expect(subLineText(t, { k: 'seats', n: 60, price: 9_500, months: 3, sum: 0 })).toBe(
      'Контрагенты: 60 × 95,00 × 3 мес.',
    );
    expect(subLineText(t, { k: 'grow', n: 10, price: 10_000, months: 2, sum: 0 })).toBe(
      'Расширение пакета: +10 × 100,00 × 2 мес.',
    );
    expect(subLineText(t, { k: 'extra', pct: 5, sum: 0 })).toBe('Дополнительная скидка 5 %');
    expect(subLineText(t, { k: 'first', pct: 50, sum: 0 })).toBe('Скидка первого месяца 50 %');
  });

  it('цена вида за контрагента в месяц со скидкой, тыйыны', () => {
    expect(subPlanPrice(10_000, 0)).toBe(10_000);
    expect(subPlanPrice(10_000, 5)).toBe(9_500);
    expect(subPlanPrice(9_999, 15)).toBe(8_499);
  });
});

describe('подписки: срок, полосы и плашки', () => {
  it('«Оплачено до» с остатком или просрочкой', () => {
    expect(subPaidToText(t, null, '2026-11-20')).toBe('—');
    expect(subPaidToText(t, '2026-12-20', '2026-11-20')).toBe('20.12.2026 · осталось 30 дней');
    expect(subPaidToText(t, '2026-11-17', '2026-11-20')).toBe('17.11.2026 · просрочено 3 дня');
  });

  it('полоса: до 80 % зелёная, до 100 % жёлтая, дальше красная; без предела — пустая', () => {
    expect(subBar(5, 10)).toEqual({ pct: 50, tone: 'ok' });
    expect(subBar(8, 10)).toEqual({ pct: 80, tone: 'warn' });
    expect(subBar(12, 10)).toEqual({ pct: 100, tone: 'bad' });
    expect(subBar(12, null)).toEqual({ pct: 0, tone: 'ok' });
  });

  it('плашки: есть такие — свой цвет, нет — зелёный', () => {
    expect(subPlateColors({ pending: 2, overdue: 1 })).toEqual({
      pending: 'blue',
      overdue: 'red',
      expiring: 'green',
    });
    expect(subPlateColors({})).toEqual({ pending: 'green', overdue: 'green', expiring: 'green' });
  });
});

describe('подписки: «История изменений»', () => {
  it('оплата подтверждена и чек отклонён (прототип subPayOk, subPayRej)', () => {
    expect(
      sp(
        subHistoryText(
          t,
          entry({
            action: 'sub_paid',
            changes: [
              { field: 'kind', to: 'renew' },
              { field: 'amount', to: 570_000 },
              { field: 'months', to: 3 },
              { field: 'paidUntil', from: '2026-11-20', to: '2027-02-20' },
              { field: 'status', from: 'pending' },
            ],
          }),
          ctx,
        ),
      ),
    ).toBe(
      'Оплата подтверждена: продление, 5 700 сом, 3 мес., оплачено до 20.02.2027 (было: Ждёт подтверждения)',
    );
    expect(
      sp(
        subHistoryText(
          t,
          entry({
            action: 'sub_rejected',
            changes: [
              { field: 'kind', to: 'grow' },
              { field: 'amount', to: 100_000 },
            ],
            reason: 'Сумма не та',
          }),
          ctx,
        ),
      ),
    ).toBe('Чек отклонён: расширение пакета, 1 000 сом. Причина: Сумма не та');
  });

  it('подписка изменена: поля «было → стало» и причина; бесплатный период', () => {
    expect(
      subHistoryText(
        t,
        entry({
          changes: [
            { field: 'planId', from: 'm1', to: 'q3' },
            { field: 'seats', from: 10, to: 20 },
            { field: 'extraGb', from: 0, to: 2 },
          ],
          reason: 'Оплата наличными',
        }),
        ctx,
      ),
    ).toBe(
      'Подписка изменена: Вид: Месяц → Квартал; Пакет: 10 → 20; Память сверх: 0 ГБ → 2 ГБ. Причина: Оплата наличными',
    );
    expect(
      subHistoryText(
        t,
        entry({
          action: 'create',
          changes: [
            { field: 'free', to: true },
            { field: 'paidUntil', to: '2026-12-20' },
          ],
        }),
        ctx,
      ),
    ).toBe('Бесплатный период до 20.12.2026: Оплачено до: — → 20.12.2026');
  });
});

describe('подписки: история видов и цен (прототип subCfgLog)', () => {
  const cfg = (over: Partial<Parameters<typeof subConfigText>[1]>) => ({
    id: 'c1',
    at: '2026-11-20T04:30:00.000Z',
    entity: 'subscription_plan' as const,
    entityId: 'q3',
    action: 'update',
    plan: 'Квартал',
    changes: [],
    ...over,
  });

  it('вид добавлен, изменён, выключен и удалён', () => {
    expect(
      subConfigText(
        t,
        cfg({
          action: 'create',
          changes: [
            { field: 'name', to: 'Квартал' },
            { field: 'months', to: 3 },
            { field: 'discountPct', to: 5 },
          ],
        }),
      ),
    ).toBe('Виды подписок: добавлен «Квартал» — 3 мес., скидка 5 %');
    expect(
      subConfigText(
        t,
        cfg({
          changes: [
            { field: 'discountPct', from: 5, to: 7 },
            { field: 'perks', from: [], to: ['Скидка'] },
            { field: 'active', from: true, to: false },
          ],
        }),
      ),
    ).toBe('Виды подписок: «Квартал» — скидка 5 → 7 %, преимущества, выключен');
    expect(
      subConfigText(
        t,
        cfg({ action: 'delete', plan: null, changes: [{ field: 'name', from: 'Год' }] }),
      ),
    ).toBe('Виды подписок: «Год» удалён');
  });

  it('цены — сомами, реквизиты — в кавычках', () => {
    expect(
      subConfigText(
        t,
        cfg({
          entity: 'subscription_settings',
          plan: null,
          changes: [
            { field: 'seatPrice', from: 10_000, to: 12_050 },
            { field: 'checkDays', from: 3, to: 5 },
            { field: 'bank', from: 'Банк А', to: 'Банк Б' },
          ],
        }),
      ),
    ).toBe(
      'Цены и реквизиты: Цена за контрагента в месяц, сом: 100 → 120,50; Срок проверки чека, дней: 3 → 5; Банк: «Банк А» → «Банк Б»',
    );
  });
});

describe('подписки: страница списка в браузере («Виды подписок»)', () => {
  const rows = [
    { id: 'a', name: 'Год', n: 12 },
    { id: 'b', name: 'Месяц', n: 1 },
    { id: 'c', name: 'Квартал', n: 3 },
  ];
  const cols = [
    { key: 'name', text: (r: (typeof rows)[number]) => r.name },
    {
      key: 'n',
      text: (r: (typeof rows)[number]) => String(r.n),
      sortValue: (r: (typeof rows)[number]) => r.n,
    },
  ];
  const ids = (p: { items: readonly { id: string }[] }) => p.items.map((r) => r.id);

  it('без сортировки — в порядке записей; число — как число, текст — по алфавиту', () => {
    expect(ids(localGridPage(rows, {}, cols))).toEqual(['a', 'b', 'c']);
    expect(ids(localGridPage(rows, { sort: 'n.asc' }, cols))).toEqual(['b', 'c', 'a']);
    expect(ids(localGridPage(rows, { sort: 'n.desc' }, cols))).toEqual(['a', 'c', 'b']);
    expect(ids(localGridPage(rows, { sort: 'name.asc' }, cols))).toEqual(['a', 'c', 'b']);
  });

  it('поиск по видимым столбцам и страницы', () => {
    expect(ids(localGridPage(rows, { q: 'месяц', qcols: 'name' }, cols))).toEqual(['b']);
    expect(ids(localGridPage(rows, { q: '12', qcols: 'name' }, cols))).toEqual([]);
    expect(ids(localGridPage(rows, { q: '12', qcols: 'name,n' }, cols))).toEqual(['a']);
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, name: `Вид ${i}`, n: i }));
    const second = localGridPage(many, { page: '2', size: '25' }, cols);
    expect(second.page).toBe(2);
    expect(second.total).toBe(30);
    expect(ids(second)).toHaveLength(5);
    // За концом списка — последняя страница.
    expect(localGridPage(many, { page: '9' }, cols).page).toBe(2);
  });
});

describe('subFieldError: отказ сервера по полю блока «Подписка»', () => {
  const values = { planId: 'm1', seats: '15', paidUntil: '2026-12-20' };
  it('блок включён и поле в форме — ошибка под этим полем', () => {
    expect(subFieldError(true, values, 'seats', 'Пакет — число мест с шагом 10')).toEqual({
      seats: 'Пакет — число мест с шагом 10',
    });
  });
  it('блок выключен, поля нет или оно не из формы — уведомлением (null)', () => {
    expect(subFieldError(false, values, 'seats', 'x')).toBeNull();
    expect(subFieldError(true, values, null, 'x')).toBeNull();
    expect(subFieldError(true, values, 'inn', 'x')).toBeNull();
  });
});
