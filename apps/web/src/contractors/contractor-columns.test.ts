import { defaultUiTexts } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import {
  CONTRACTOR_DEFAULT_SORT,
  CONTRACTOR_DEFAULT_VISIBLE,
  contractorColumns,
  DEBTORS_DEFAULT_SORT,
  DEBTORS_DEFAULT_VISIBLE,
} from './contractor-columns';

// Вкладка «Должники» (прототип v139 modules/contractors.js, `SHOW['cps-debtors']` и `sort` в `renderCps`).

const t = makeTranslate(defaultUiTexts());

describe('столбцы вкладки «Должники» (прототип v139)', () => {
  const keys = contractorColumns(t, { fee: true, kpi: true }).map((c) => c.key);

  it('по умолчанию — название, долг, ответственный, просрочка и обслуживание; ИНН и режима нет', () => {
    expect(DEBTORS_DEFAULT_VISIBLE).toEqual(['name', 'debt', 'responsible', 'overdue', 'service']);
    // Каждый столбец есть в списке — иначе вкладка открылась бы без него.
    for (const key of DEBTORS_DEFAULT_VISIBLE) expect(keys).toContain(key);
    expect(DEBTORS_DEFAULT_VISIBLE).not.toContain('inn');
    expect(DEBTORS_DEFAULT_VISIBLE).not.toContain('regime');
  });

  it('сверху — самый большой долг; у остальных вкладок порядок прежний', () => {
    expect(DEBTORS_DEFAULT_SORT).toEqual({ key: 'debt', dir: 'desc' });
    expect(keys).toContain(DEBTORS_DEFAULT_SORT.key);
    expect(CONTRACTOR_DEFAULT_SORT).toEqual({ key: 'createdAt', dir: 'desc' });
    expect(CONTRACTOR_DEFAULT_VISIBLE).not.toContain('debt');
  });

  it('столбец долга есть только с правом видеть плату за обслуживание', () => {
    expect(contractorColumns(t, { fee: false, kpi: true }).map((c) => c.key)).not.toContain('debt');
  });
});
