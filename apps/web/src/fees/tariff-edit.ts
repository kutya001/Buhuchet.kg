import { formatSomWithUnit } from '@buhuchet/domain';
import type { TariffEdited } from '@buhuchet/shared';
import type { useT } from '../l10n/provider';

/**
 * Сообщение после «Сохранить» окна «Изменить ставку обслуживания» (прототип v86 `tariffEditDlg`):
 * долг вырос, уменьшился или не изменился; правок нет — «Изменений нет».
 */
export function tariffSavedText(t: ReturnType<typeof useT>, saved: TariffEdited | null): string {
  if (saved && !saved.changed) return t('fee.tedit.none');
  const delta = saved?.debtDelta ?? 0;
  if (!delta) return t('fee.tedit.saved');
  return t(delta > 0 ? 'fee.tedit.saved_up' : 'fee.tedit.saved_down', {
    amount: formatSomWithUnit(Math.abs(delta)),
  });
}

/** Отказ, после которого окно закрывается, а журнал перечитывается: ставку изменили или удалили. */
export const tariffGone = (code: string): boolean =>
  code === 'record_changed' || code === 'tariff_not_found';
