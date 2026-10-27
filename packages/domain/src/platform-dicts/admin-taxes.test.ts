import { describe, expect, it } from 'vitest';
import { UI_TEXTS } from '../l10n/texts';
import {
  ADMIN_TAX_COLUMNS,
  ADMIN_TAX_LISTS,
  ADMIN_TAX_SORT,
  isAdminTaxList,
  propertyRateTyiyn,
} from './admin-taxes';

describe('«Налоги и ставки» в Админке', () => {
  it('подписи столбцов — из словаря, сортировка по умолчанию — по столбцу таблицы', () => {
    for (const list of ADMIN_TAX_LISTS) {
      for (const c of ADMIN_TAX_COLUMNS[list]) expect(UI_TEXTS, c.label).toHaveProperty(c.label);
      const keys = ADMIN_TAX_COLUMNS[list].map((c) => c.key);
      expect(keys).toContain(ADMIN_TAX_SORT[list].key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('isAdminTaxList знает только три таблицы вкладки', () => {
    expect(ADMIN_TAX_LISTS.every(isAdminTaxList)).toBe(true);
    expect(isAdminTaxList('gked')).toBe(false);
  });

  it('ставка налога на имущество — в тыйынах; не число — 0', () => {
    expect(propertyRateTyiyn(50.5)).toBe(5050);
    expect(propertyRateTyiyn(1.2)).toBe(120);
    expect(propertyRateTyiyn(116)).toBe(11600);
    expect(propertyRateTyiyn('3.2')).toBe(320);
    expect(propertyRateTyiyn(null)).toBe(0);
    expect(propertyRateTyiyn('—')).toBe(0);
  });
});
