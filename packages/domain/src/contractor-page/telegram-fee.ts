import { addDays, type IsoDate } from '../common/dates';
import { addMonths, monthDay, type YearMonth } from '../common/months';
import type { ContractorFees } from '../fees/charges';
import type { Tyiyn } from '../common/money';
import type { BotButton, BotMessage } from '../telegram/bot-message';
import type { TransferBlock } from './telegram-requisite';
import { CP_TG_PAID_ACTION } from './telegram-pay';

/*
 * «Напомнить в Telegram» об оплате за обслуживание (доработки 14.11.2026, блок 4, пункт 5; прототип v110
 * modules/cp-telegram.js: `pgFeeTo`, `pgFeeTgShow`, `pgFeeTgWhy`, `pgFeeDue`, `pgFeeMsg`, `pgFeeTgDlg`,
 * `pgFeeSend`, `tgAct('cp-feepaid')`). Кнопка — на вкладке «Обслуживание» карточки контрагента рядом с
 * «Напомнить в WhatsApp»; права — те же, что у WhatsApp. Получатели — подключённые Telegram, кроме
 * выключивших напоминания кнопкой «Не напоминать»; не чаще раза в сутки на контрагента. Под сообщением —
 * реквизиты для обслуживания и «Оплатил».
 */

/** Текст сообщения — не длиннее стольких знаков (прототип `maxlength="1000"`). */
export const CP_TG_FEE_TEXT_MAX = 1000;

/** Сколько минут недоставленная отправка ещё считается «идёт сейчас» (две вкладки не отправят дважды). */
export const CP_TG_FEE_SENDING_MINUTES = 5;

/** Отказы «Напомнить в Telegram»: код — он же ключ словаря `err.<код>`. */
export const CP_TG_FEE_MESSAGES = {
  cp_tg_fee_archived: 'Контрагент в архиве',
  cp_tg_fee_today: 'Сегодня уже напоминали в {time}',
  cp_tg_fee_no_req:
    'Не отправлено «К оплате»: у {contractor} нет реквизитов для перевода. Добавьте основной счёт для обслуживания: «Моя организация» → «Реквизиты».',
  cp_tg_fee_req_hidden:
    'Не отправлено: у {contractor} на странице скрыт раздел «{section}», а без реквизитов для перевода напоминание не уходит. Покажите раздел в блоке «Страница контрагента».',
  cp_tg_fee_tg_off:
    'Раздел «Telegram» страницы контрагента выключен или скрыт: сообщения клиенту в Telegram не уходят',
  cp_tg_fee_all_off: 'Все подключённые Telegram выключили напоминания кнопкой «Не напоминать»',
  cp_tg_fee_off:
    'Напомнить в Telegram нельзя: нужны «Напоминания в Telegram», «Страница контрагента по ссылке», долг за обслуживание и подключённый Telegram',
  cp_tg_fee_failed: 'Не удалось отправить сообщение в Telegram. Попробуйте позже',
} as const;

export type CpTgFeeMessageKey = keyof typeof CP_TG_FEE_MESSAGES;

/** Что мешает «Напомнить в Telegram», когда кнопка видна (кнопка заперта, по нажатию — причина). */
export const CP_TG_FEE_REFUSALS = [
  'cp_tg_fee_archived',
  'cp_tg_fee_today',
  'cp_tg_fee_no_req',
  'cp_tg_fee_req_hidden',
  'cp_tg_fee_tg_off',
  'cp_tg_fee_all_off',
] as const;

export type CpTgFeeRefusal = (typeof CP_TG_FEE_REFUSALS)[number];

/**
 * Кнопка «Напомнить в Telegram» видна (прототип `pgFeeTgShow`): включены «Напоминания в Telegram»,
 * «Страница контрагента по ссылке» и «Плата за обслуживание», у контрагента долг за обслуживание и хотя
 * бы один подключённый Telegram. У разового контрагента платы за обслуживание нет — и кнопки нет.
 */
export function feeTelegramShown(o: {
  telegram: boolean;
  cppage: boolean;
  fee: boolean;
  oneOff: boolean;
  debt: Tyiyn;
  /** Подключённых Telegram (статус «Подключён»). */
  linked: number;
}): boolean {
  return o.telegram && o.cppage && o.fee && !o.oneOff && o.debt > 0 && o.linked > 0;
}

/** Реквизиты для обслуживания: есть, нет или раздел страницы, без которого они клиенту не уходят, скрыт. */
export type FeeRequisiteState = 'ok' | 'none' | 'hidden';

/**
 * Что мешает отправке (прототип `pgFeeTgWhy`): архив, уже напоминали сегодня, нет реквизитов для
 * обслуживания, все подключённые выключили напоминания. Сверх прототипа — реквизит скрыт вместе с
 * разделом страницы (бот не отдаёт того, чего не отдаёт страница, docs/deviations.md п. К-9) и раздел
 * «Telegram» страницы не действует (сообщения клиенту не уходят, п. К-4).
 */
export function feeTelegramRefusal(o: {
  archived: boolean;
  /** Во сколько сегодня уже напоминали («ЧЧ:ММ»), не напоминали — null. */
  sentAt: string | null;
  requisite: FeeRequisiteState;
  /** Подключённые Telegram, которым клиенту сейчас можно писать. */
  reachable: number;
  /** Из них — не выключившие напоминания. */
  recipients: number;
}): CpTgFeeRefusal | null {
  if (o.archived) return 'cp_tg_fee_archived';
  if (o.sentAt) return 'cp_tg_fee_today';
  if (o.requisite === 'hidden') return 'cp_tg_fee_req_hidden';
  if (o.requisite === 'none') return 'cp_tg_fee_no_req';
  if (o.reachable < 1) return 'cp_tg_fee_tg_off';
  if (o.recipients < 1) return 'cp_tg_fee_all_off';
  return null;
}

/**
 * Месяцы долга и срок (прототип `pgFeeDue`, как в «Напомнить в WhatsApp»): месяцы с наступившим сроком
 * и недоплатой; срок — день оплаты месяца после последнего из них, не раньше завтрашнего дня.
 */
export function feeTelegramDue(
  fees: Pick<ContractorFees, 'months'>,
  feeDay: number,
  today: IsoDate,
): { months: YearMonth[]; payBy: IsoDate } {
  const months = fees.months.filter((m) => m.due <= today && m.charge > m.got).map((m) => m.month);
  const last = months.at(-1);
  const due = last ? monthDay(addMonths(last, 1), feeDay) : today;
  return { months, payBy: due <= today ? addDays(today, 1) : due };
}

/**
 * Сообщение клиенту (прототип `pgFeeMsg`): заголовок «Оплата за обслуживание до …», контрагент, текст
 * сотрудника и блок реквизитов для обслуживания; под ним — кнопка копирования по виду реквизита и
 * «Оплатил» (сумму бот берёт из своей записи сообщения, а не из кнопки).
 */
export function feeBotMessage(o: {
  heading: string;
  contractor: string;
  text: string;
  requisite: TransferBlock;
  paid: string;
}): BotMessage {
  const buttons: BotButton[][] = [
    ...(o.requisite.copy ? [[o.requisite.copy]] : []),
    [{ text: o.paid, action: CP_TG_PAID_ACTION, arg: 'fee' }],
  ];
  return {
    heading: o.heading,
    sub: o.contractor,
    text: `${o.text}\n\n${o.requisite.text}`,
    buttons,
  };
}
