import { defaultUiTexts } from '@buhuchet/domain';
import type { ActionEntry } from '@buhuchet/ui';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { feeMenuEntries, type FeeMenuContractor } from './fee-menu';

// Пункты меню «…» контрагента о плате за обслуживание (прототип modules/contractors.js, cpActions,
// feeAccOk; ТЗ п. 64: «Принять оплату за обслуживание» в меню строки контрагента с долгом).

const t = makeTranslate(defaultUiTexts());
const run = { accept: () => undefined, remind: () => undefined };
const base: FeeMenuContractor = {
  archived: false,
  oneoff: false,
  feeDebt: 6_000_000,
  charged: true,
};
const ids = (items: ActionEntry[]) => items.map((x) => x.id);

describe('пункты меню о плате за обслуживание', () => {
  it('долг 60 000 — «Принять оплату» с «Долг 60 000 сом» и «Напомнить о долге в WhatsApp»', () => {
    const items = feeMenuEntries({ c: base, rights: { fee: true, tariff: true }, t, run });
    expect(ids(items)).toEqual(['fee-accept', 'fee-remind']);
    expect(items[0]).toMatchObject({ label: 'Принять оплату за обслуживание' });
    const first = items[0];
    expect(first && 'sub' in first ? first.sub?.replace(/\u00a0/g, ' ') : null).toBe(
      'Долг 60 000 сом',
    );
    expect(items[1]).toMatchObject({ label: 'Напомнить о долге в WhatsApp' });
  });

  it('без долга — только «Принять оплату» без пояснения; без начислений — ничего', () => {
    const noDebt = feeMenuEntries({
      c: { ...base, feeDebt: 0 },
      rights: { fee: true, tariff: true },
      t,
      run,
    });
    expect(ids(noDebt)).toEqual(['fee-accept']);
    expect(noDebt[0]).not.toHaveProperty('sub');
    expect(
      feeMenuEntries({
        c: { ...base, feeDebt: 0, charged: false },
        rights: { fee: true, tariff: true },
        t,
        run,
      }),
    ).toEqual([]);
  });

  it('без права «Менять журнал тарифов» — только напоминание; без «Видеть плату», архив — ничего', () => {
    expect(ids(feeMenuEntries({ c: base, rights: { fee: true, tariff: false }, t, run }))).toEqual([
      'fee-remind',
    ]);
    expect(feeMenuEntries({ c: base, rights: { fee: false, tariff: true }, t, run })).toEqual([]);
    expect(
      feeMenuEntries({
        c: { ...base, archived: true },
        rights: { fee: true, tariff: true },
        t,
        run,
      }),
    ).toEqual([]);
  });

  it('разовый — без «Принять оплату»', () => {
    expect(
      ids(
        feeMenuEntries({
          c: { ...base, oneoff: true },
          rights: { fee: true, tariff: true },
          t,
          run,
        }),
      ),
    ).toEqual(['fee-remind']);
  });
});
