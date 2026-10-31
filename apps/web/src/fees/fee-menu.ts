import { formatSomWithUnit } from '@buhuchet/domain';
import type { ActionEntry } from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';

/** Контрагент глазами пунктов платы за обслуживание. */
export interface FeeMenuContractor {
  archived: boolean;
  oneoff: boolean;
  /** Долг за обслуживание; null — плата не видна. */
  feeDebt: number | null;
  /** Есть начисления: действует ставка больше нуля или есть долг. */
  charged: boolean;
}

/** Плата за обслуживание включена и права «Видеть плату» и «Менять журнал тарифов». */
export interface FeeRights {
  fee: boolean;
  tariff: boolean;
}

/**
 * Пункты меню «…» контрагента о плате за обслуживание (прототип modules/contractors.js, `cpActions`):
 * «Принять оплату за обслуживание» с «Долг N» под названием (`feeAccOk`: обе права, постоянный, не в
 * архиве, есть начисления) и «Напомнить о долге в WhatsApp» (право «Видеть плату», есть долг).
 */
export function feeMenuEntries({
  c,
  rights,
  t,
  run,
}: {
  c: FeeMenuContractor;
  rights: FeeRights;
  t: Translate;
  run: { accept: () => void; remind: () => void };
}): ActionEntry[] {
  if (c.archived || !rights.fee) return [];
  const debt = c.feeDebt ?? 0;
  const items: ActionEntry[] = [];
  if (rights.tariff && !c.oneoff && c.charged) {
    items.push({
      id: 'fee-accept',
      label: t('cp.menu.fee_accept'),
      icon: 'coins',
      ...(debt > 0 ? { sub: t('cp.menu.fee_debt', { amount: formatSomWithUnit(debt) }) } : {}),
      run: run.accept,
    });
  }
  if (debt > 0) {
    items.push({ id: 'fee-remind', label: t('cp.menu.fee_remind'), icon: 'chat', run: run.remind });
  }
  return items;
}
