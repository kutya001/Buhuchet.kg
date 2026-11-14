import { addDays, weekdayMondayFirst, type IsoDate } from '../common/dates';
import { formatSom, type Tyiyn } from '../common/money';
import { BOT_COPY_MAX, type BotButton, type BotMessage } from '../telegram/bot-message';
import { CP_TG_NODEBT_ACTION } from './telegram-pay';

/*
 * Напоминание клиенту о долге в Telegram (доработки 13.11.2026, задача К5; прототип v94
 * modules/cp-telegram.js: `pgDebt`, `pgDebtTo`, `pgDebtMsg`, `pgDebtWhy`, `tgAct('cp-nodebt')`). Раз в
 * неделю, в понедельник в 10:00, подключившим Telegram: недостача денег на налоги этого месяца и долг
 * за обслуживание. Включает организация («Напоминать контрагентам о долге»), у отдельного контрагента
 * выключает сотрудник в карточке, у себя — сам клиент кнопкой «Не напоминать».
 */

/** Долг контрагента для напоминания (прототип pgDebt). */
export interface CpDebt {
  /** Долг за обслуживание. */
  fee: Tyiyn;
  /** Не хватает на налоги этого месяца. */
  short: Tyiyn;
  sum: Tyiyn;
}

/**
 * Долг для напоминания (прототип pgDebt): долг за обслуживание — при функции «Плата за обслуживание»,
 * недостача на налоги месяца — при «Учёте оплаты налогов»; вызывающий передаёт `null`, если функция
 * выключена (или раздел страницы клиенту не показан).
 */
export function cpDebt(o: { fee: Tyiyn | null; short: Tyiyn | null }): CpDebt {
  const fee = o.fee !== null && o.fee > 0 ? o.fee : 0;
  const short = o.short !== null && o.short > 0 ? o.short : 0;
  return { fee, short, sum: fee + short };
}

/** Понедельник недели, в которую попадает день: одно напоминание на неделю и чат. */
export function debtWeek(today: IsoDate): IsoDate {
  return addDays(today, -weekdayMondayFirst(today));
}

/** Что мешает переключить «Напоминать о долге в Telegram» в карточке контрагента (прототип pgDebtWhy). */
export const DEBT_TOGGLE_REFUSALS = ['page_debt_right', 'page_debt_org_off'] as const;
export type DebtToggleRefusal = (typeof DEBT_TOGGLE_REFUSALS)[number];

export const DEBT_TOGGLE_MESSAGES: Record<DebtToggleRefusal, string> = {
  page_debt_right: 'Нужно право «Управлять страницей контрагента»',
  page_debt_org_off:
    'Напоминания о долге выключены для всей организации: «Моя организация» → «Настройки» → «Telegram контрагентов»',
};

export function debtToggleRefusal(o: {
  canManagePage: boolean;
  orgOn: boolean;
}): DebtToggleRefusal | null {
  if (!o.canManagePage) return 'page_debt_right';
  if (!o.orgOn) return 'page_debt_org_off';
  return null;
}

/**
 * Кому уйдёт напоминание (прототип pgDebtTo): организация включила напоминания, у контрагента они не
 * выключены, он не в архиве, долг есть — подключённым Telegram, которые не нажали «Не напоминать».
 */
export function debtReminderDue(o: {
  orgOn: boolean;
  contractorOff: boolean;
  archived: boolean;
  debt: CpDebt;
}): boolean {
  return o.orgOn && !o.contractorOff && !o.archived && o.debt.sum > 0;
}

/**
 * Команда клиента «Напоминать» в боте: снова включает напоминания о долге после «Не напоминать»
 * (шаблон `tgCpNoDebtOk`: «Чтобы включить снова, отправьте боту «Напоминать»»).
 */
export function cpTgDebtOnCommand(text: string): boolean {
  return /^\/?«?напоминать»?\.?$/iu.test(text.trim());
}

/**
 * Напоминание о долге (прототип pgDebtMsg): заголовок, контрагент, текст шаблона `tgCpDebt`, таблица
 * «Что оплатить / Сумма, сом», кнопки «Реквизиты для налогов» и «Реквизиты для обслуживания» (если
 * реквизит есть и помещается в кнопку копирования) и «Не напоминать».
 */
export function debtBotMessage(o: {
  contractor: string;
  debt: CpDebt;
  /** Реквизит для налогов — только при недостаче; для обслуживания — только при долге. */
  taxRequisite: string | null;
  feeRequisite: string | null;
  /** Заполненный шаблон `tgCpDebt`. */
  text: string;
  labels: {
    heading: string;
    what: string;
    amount: string;
    short: string;
    fee: string;
    copyTax: string;
    copyFee: string;
    noDebt: string;
  };
}): BotMessage {
  const rows: string[][] = [];
  if (o.debt.short) rows.push([o.labels.short, formatSom(o.debt.short)]);
  if (o.debt.fee) rows.push([o.labels.fee, formatSom(o.debt.fee)]);
  const tax = o.debt.short ? o.taxRequisite : null;
  const fee = o.debt.fee ? o.feeRequisite : null;
  const fits = (x: string | null): x is string => !!x && x.length <= BOT_COPY_MAX;
  const buttons: BotButton[][] = [
    ...(fits(tax) ? [[{ text: o.labels.copyTax, copy: tax }]] : []),
    ...(fits(fee) ? [[{ text: o.labels.copyFee, copy: fee }]] : []),
    [{ text: o.labels.noDebt, action: CP_TG_NODEBT_ACTION }],
  ];
  // Реквизит длиннее предела кнопки копирования — в тексте сообщения, чтобы клиент его не потерял.
  const long = [
    tax && !fits(tax) ? `${o.labels.copyTax}: ${tax}` : null,
    fee && !fits(fee) ? `${o.labels.copyFee}: ${fee}` : null,
  ].filter((x): x is string => !!x);
  return {
    heading: o.labels.heading,
    sub: o.contractor,
    text: [o.text, ...long].join('\n'),
    tables: [{ head: [o.labels.what, o.labels.amount], rows, numeric: [1] }],
    buttons,
  };
}
