import { formatDateRu, type IsoDate } from '../common/dates';
import { formatSomWithUnit, type Tyiyn } from '../common/money';
import { monthLabel, type YearMonth } from '../common/months';

/** Шаблон напоминания о долге за обслуживание, пока в справочнике платформы его нет (refDB.json, waFee). */
export const FEE_WHATSAPP_TEMPLATE =
  'Уважаемые {контрагент}! Напоминаем об оплате за обслуживание за {месяц}: {сумма}. Просим оплатить до {дата}.';

/**
 * Сообщение в WhatsApp о долге за обслуживание (шаблон waFee справочника платформы; прототип waDlg с
 * `fee`): {контрагент}, {месяц} — месяцы долга через запятую, {сумма} — долг, {дата} — «оплатить до»,
 * {реквизиты} — основной счёт для обслуживания или «—». Если в шаблоне нет {реквизиты}, а счёт есть —
 * в конце «Реквизиты для оплаты: …» (`requisitesLine`).
 */
export function feeWhatsAppText(
  template: string,
  values: {
    contractor: string;
    months: readonly YearMonth[];
    amount: Tyiyn;
    payBy: IsoDate;
    requisite: string | null;
  },
  requisitesLine: (req: string) => string,
): string {
  const text = template
    .replaceAll('{контрагент}', values.contractor)
    .replaceAll('{месяц}', values.months.map(monthLabel).join(', '))
    .replaceAll('{сумма}', formatSomWithUnit(values.amount))
    .replaceAll('{дата}', formatDateRu(values.payBy))
    .replaceAll('{реквизиты}', values.requisite || '—');
  return values.requisite && !template.includes('{реквизиты}')
    ? `${text} ${requisitesLine(values.requisite)}`
    : text;
}
