/*
 * Отказы платы за обслуживание (задача 2.21): коды ответа API и тексты словаря `err.<код>`
 * (`l10n/fees-texts.ts`). Тексты окон «Новая ставка» и «Принять оплату за обслуживание» — как в
 * прототипе (modules/contractor-card.js `tariffDlg`, `feePayDlg`).
 */
export const FEE_MESSAGES = {
  fee_off: 'Плата за обслуживание выключена в учётной политике',
  fee_not_accepted: 'У контрагента нет начислений за обслуживание: принять оплату нельзя',
  fee_to_invalid: 'Выберите, куда поступили деньги',
  fee_month_invalid: 'Месяц — не неоплаченное начисление этого контрагента',
  fee_amount_required: 'Введите сумму больше нуля',
  fee_row_over_debt: 'В строке месяца сумма больше долга за этот месяц',
  fee_allocated_over_amount: 'Распределено больше суммы на {amount}',
  fee_date_required: 'Укажите дату',
  fee_date_future: 'Дата не может быть позже сегодняшней',
  fee_no_debt: 'Долга за обслуживание нет — напоминать не о чем',
  fee_no_phone:
    'У контрагента нет номера телефона — сообщение отправить нельзя. Добавьте номер в карточке.',
  tariff_amount_required: 'Введите сумму',
  tariff_month_required: 'Укажите месяц',
  tariff_month_taken: 'На этот месяц ставка уже есть: ставка меняется не чаще раза в месяц',
  tariff_month_past: 'Прошлые месяцы не меняются',
  tariff_month_current: 'Ставка меняется со следующего месяца: текущий месяц уже начислен',
} as const;

export type FeeMessageKey = keyof typeof FEE_MESSAGES;
