import type { Translate } from '../l10n/translate';

/** Что меняется в окне «Изменить …» — для текста «Укажите причину: меняется …». */
export type ChangedPart = 'amount' | 'date' | 'alloc' | 'holder' | 'months' | 'to';

/**
 * «Укажите причину: меняется сумма, дата» (прототип modules/fin-op.js `opEditDlg`) и «…: меняются …»
 * (modules/contractors.js `inDlg`, modules/contractor-card.js — оплата за обслуживание).
 */
export function reasonNeeded(t: Translate, parts: readonly ChangedPart[], many: boolean): string {
  const what = parts.map((p) => t(`fin.edit.part.${p}`)).join(', ');
  return t(many ? 'fin.edit.need_many' : 'fin.edit.need_one', { what });
}
