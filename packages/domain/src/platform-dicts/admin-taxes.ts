import type { ListColumnType, ListSort } from '../common/list';

/*
 * Админка → «Справочники платформы» → «Налоги и ставки» (задача 2.36, часть 2б; ТЗ «Справочники
 * платформы» → «Налоги и ставки»; прототип admin/platform-dicts.js renderPDicts0, вкладка `taxes`):
 * справка по НК КР только для просмотра — налоги и обязательные платежи (строка открывает форму
 * просмотра налога), ставки единого налога, ставки налога на имущество и размер бизнеса. Отчёты
 * строятся по «Видам отчётов», эти таблицы сроков не меняют. «Виды деятельности (ГКЭД)» ставок
 * единого налога правит задача 2.38, выгрузку и загрузку Excel — задача 2.37.
 */

/** Таблицы вкладки «Налоги и ставки»: налоги и платежи, ставки единого налога, ставки на имущество. */
export const ADMIN_TAX_LISTS = ['taxes', 'en_rates', 'property_rates'] as const;
export type AdminTaxList = (typeof ADMIN_TAX_LISTS)[number];

export function isAdminTaxList(value: string): value is AdminTaxList {
  return (ADMIN_TAX_LISTS as readonly string[]).includes(value);
}

/** Столбец таблицы: ключ, тип, подпись (ключ словаря) и скрыт ли по умолчанию. */
export interface AdminTaxColumn {
  key: string;
  type: ListColumnType;
  label: string;
  hidden?: boolean;
}

const c = (key: string, type: ListColumnType, label: string, hidden = false): AdminTaxColumn =>
  hidden ? { key, type, label, hidden } : { key, type, label };

/**
 * Столбцы — как в прототипе (`adm-taxes`, `adm-enrates`, `adm-proprates`). Ставки налога на имущество
 * — сомы за 1 м² в год с копейками: тип `money` (в тыйынах), на экране без «,00» у целых.
 */
export const ADMIN_TAX_COLUMNS: Readonly<Record<AdminTaxList, readonly AdminTaxColumn[]>> = {
  taxes: [
    c('code', 'text', 'pdicts.tax.col.code'),
    c('name', 'text', 'pdicts.tax.col.name'),
    c('group', 'enum', 'pdicts.tax.col.group'),
    c('level', 'enum', 'pdicts.tax.col.level', true),
    c('about', 'text', 'pdicts.tax.col.about'),
    c('payers', 'text', 'pdicts.tax.col.payers', true),
    c('rates', 'text', 'pdicts.tax.col.rates'),
    c('period', 'text', 'pdicts.tax.col.period'),
    c('reportDue', 'text', 'pdicts.tax.col.report_due', true),
    c('payDue', 'text', 'pdicts.tax.col.pay_due', true),
    c('form', 'text', 'pdicts.tax.col.form', true),
    c('organ', 'enum', 'pdicts.tax.col.organ', true),
    c('art', 'text', 'pdicts.tax.col.art'),
    c('types', 'text', 'pdicts.tax.col.types'),
    c('verify', 'enum', 'pdicts.tax.col.verify'),
  ],
  en_rates: [
    c('code', 'text', 'pdicts.tax.col.code'),
    c('activity', 'text', 'pdicts.en.col.activity'),
    c('explain', 'text', 'pdicts.en.col.explain'),
    c('rate', 'text', 'pdicts.en.col.rate'),
    c('cond', 'text', 'pdicts.en.col.cond'),
    c('art', 'text', 'pdicts.tax.col.art'),
    // «Виды деятельности (ГКЭД)» — подбор ставки по основному ГКЭД (задача 2.38, прототип enRateDlg).
    c('gked', 'text', 'pdicts.col.gked'),
  ],
  property_rates: [
    c('place', 'text', 'pdicts.prop.col.place'),
    c('region', 'enum', 'pdicts.prop.col.region'),
    c('homeA', 'money', 'pdicts.prop.col.home_a'),
    c('homeB', 'money', 'pdicts.prop.col.home_b'),
    c('homeLand', 'money', 'pdicts.prop.col.home_land'),
    c('bizA', 'money', 'pdicts.prop.col.biz_a'),
    c('bizB', 'money', 'pdicts.prop.col.biz_b'),
    c('bizLand', 'money', 'pdicts.prop.col.biz_land'),
  ],
};

/** Сортировка по умолчанию (прототип): налоги и ставки ЕН — по коду, ставки на имущество — по области. */
export const ADMIN_TAX_SORT: Readonly<Record<AdminTaxList, ListSort>> = {
  taxes: { key: 'code', dir: 'asc' },
  en_rates: { key: 'code', dir: 'asc' },
  property_rates: { key: 'region', dir: 'asc' },
};

/**
 * Ставка налога на имущество в тыйынах: в справочнике — сомы с копейками (50.5 → 5050). Не число —
 * 0: справка не должна ронять экран.
 */
export function propertyRateTyiyn(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
