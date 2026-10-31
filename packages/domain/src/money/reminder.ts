import { addDays, formatDateRu, type IsoDate } from '../common/dates';
import { formatSomWithUnit, type Tyiyn } from '../common/money';

/*
 * «Напомнить в WhatsApp» о переводе денег на налог по отчёту (задача 2.20; ТЗ «Напоминания контрагенту
 * в WhatsApp»; прототип ui/status-scale.js `waDlg({r})`, шаблон waTax справочника платформы).
 */

/** Шаблон напоминания о налоге, пока в справочнике платформы его нет (refDB.json, waTax). */
export const TAX_WHATSAPP_TEMPLATE =
  'Уважаемые {контрагент}! У вас есть отчёт, который нужно сдать: {отчёт} за {период}, срок — {срок}. Мы сдадим его и оплатим налог за вас. Сумма налога — {сумма}. Просим перечислить её до {дата} на: {реквизиты}, чтобы мы могли оплатить в срок.';

/**
 * «Просим перечислить до» (прототип waDlg): срок оплаты уже прошёл — завтра; до него меньше двух дней —
 * сам срок; иначе — за два дня до срока, чтобы успеть оплатить.
 */
export function taxPayBy(payDue: IsoDate, today: IsoDate): IsoDate {
  if (payDue < today) return addDays(today, 1);
  const early = addDays(payDue, -2);
  return early < today ? payDue : early;
}

/**
 * Текст напоминания о налоге без реквизитов (прототип waDlg, `build`): {контрагент}, {отчёт} — полное
 * название вида, {период} — период полностью, {срок} — срок сдачи, {сумма} — сколько осталось оплатить,
 * {дата} — «перечислить до» (`taxPayBy`). {реквизиты} остаётся: его подставляет окно по отмеченным
 * реквизитам (`withRequisites`).
 */
export function taxWhatsAppBase(
  template: string,
  v: {
    contractor: string;
    report: string;
    period: string;
    due: IsoDate;
    left: Tyiyn;
    payDue: IsoDate;
    today: IsoDate;
  },
): string {
  return template
    .replaceAll('{контрагент}', v.contractor)
    .replaceAll('{отчёт}', v.report)
    .replaceAll('{период}', v.period)
    .replaceAll('{срок}', formatDateRu(v.due))
    .replaceAll('{сумма}', formatSomWithUnit(v.left))
    .replaceAll('{дата}', formatDateRu(taxPayBy(v.payDue, v.today)));
}

/** Реквизиты в текст: отмеченные через «; », без реквизитов — «—» (прототип waDlg). */
export function withRequisites(base: string, requisites: readonly string[]): string {
  return base.replaceAll('{реквизиты}', requisites.join('; ') || '—');
}
