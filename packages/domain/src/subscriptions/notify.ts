import { diffDays, formatDateRu, type IsoDate } from '../common/dates';
import { formatSomWithUnit } from '../common/money';
import { SUBSCRIPTION_GB_MB, SUBSCRIPTION_MB_BYTES } from './subscriptions';

/*
 * Сообщения о подписке и памяти (доработки 20.11.2026, блок 4, пункт 3; блок 2, пункт 5; блок 5,
 * пункт 6; блок 6, пункт 3; поток Т, этап 1, П12–П13) — прототип v151–v153 `core/subs.js`
 * (`subRemindText`, `subTellOwners`, `subTellAdmins`, `subDaily`). Что и когда сказать — здесь; кому и
 * куда (Telegram, колокольчик) — модуль telegram API.
 */

/** Что сообщается владельцам организации (шаблоны `tgSub*`). */
export const SUB_OWNER_EVENTS = ['soon', 'over', 'paid', 'rejected', 'mem80', 'memfull'] as const;
export type SubOwnerEvent = (typeof SUB_OWNER_EVENTS)[number];

/** Шаблон сообщения бота по событию. */
export const SUB_EVENT_TEMPLATES = {
  soon: 'tgSubSoon',
  over: 'tgSubOver',
  paid: 'tgSubPaid',
  rejected: 'tgSubRejected',
  mem80: 'tgSubMem80',
  memfull: 'tgSubMemFull',
} as const satisfies Record<SubOwnerEvent, string>;

/** Напоминание об оплате на сегодня: «истекает» с днями до конца или «просрочена». */
export type SubReminder = { event: 'soon'; days: number } | { event: 'over' };

/**
 * Напоминать ли сегодня (прототип `subRemindText`; блок 4, пункт 3): за `remindDays` дней до «Оплачено
 * до» включительно — «истекает», после — «просрочена», каждый день до оплаты. Подписки нет (организация
 * ни разу не платила) или есть чек на проверке — молчим: после чека напоминания останавливаются, чек
 * отклонён — идут снова. Демо-организацию отсекает вызывающий (`OrgUsage.demo`).
 */
export function subscriptionReminder(o: {
  paidUntil: IsoDate | null;
  pending: boolean;
  today: IsoDate;
  remindDays: number;
}): SubReminder | null {
  if (!o.paidUntil || o.pending) return null;
  if (o.paidUntil < o.today) return { event: 'over' };
  const days = diffDays(o.paidUntil, o.today);
  return days <= o.remindDays ? { event: 'soon', days } : null;
}

/** Порог памяти: ниже 80 %, 80 % и больше, заполнена (блок 2, пункт 5). */
export const MEMORY_WARN_LEVELS = [0, 80, 100] as const;
export type MemoryWarnLevel = (typeof MEMORY_WARN_LEVELS)[number];

/** Какой порог памяти сейчас: предела нет (демо, нет подписки) — 0. */
export function memoryWarnLevel(usedBytes: number, limitBytes: number | null): MemoryWarnLevel {
  if (limitBytes === null || limitBytes <= 0) return 0;
  if (usedBytes >= limitBytes) return 100;
  return usedBytes * 100 >= limitBytes * 80 ? 80 : 0;
}

/**
 * Что сказать при смене порога (блок 2, пункт 5: «каждое приходит один раз, пока занятое снова не
 * опустится ниже порога»): порог вырос — сообщение нового порога (с 0 сразу до 100 — только «память
 * заполнена»); не вырос — ничего. Новый порог запоминает вызывающий всегда: опустилось ниже — следующий
 * подъём снова сообщит.
 */
export function memoryWarnEvent(
  was: MemoryWarnLevel,
  now: MemoryWarnLevel,
): 'mem80' | 'memfull' | null {
  if (now <= was) return null;
  return now === 100 ? 'memfull' : 'mem80';
}

/** ГБ одним знаком после запятой, как на экране «9,4 из 14 ГБ» (прототип `subGb`; 1 ГБ = 1 000 МБ). */
export function subscriptionGbText(bytes: number): string {
  const mb = bytes / SUBSCRIPTION_MB_BYTES;
  const tenths = Math.round(mb / (SUBSCRIPTION_GB_MB / 10));
  const whole = Math.floor(tenths / 10);
  const rest = tenths % 10;
  return rest ? `${whole},${rest}` : String(whole);
}

/**
 * Сколько дней чек ждёт проверки (прототип `subDaily`, `subPayLate`): день прикрепления — 0. Повтор
 * администраторам — с первого дня, каждый день в 09:00; дольше срока проверки — «Ждёт проверки больше
 * N дней» (блок 4, пункт 6; блок 6, пункт 3).
 */
export function subscriptionCheckWait(
  sentDay: IsoDate,
  today: IsoDate,
  checkDays: number,
): { days: number; repeat: boolean; late: boolean } {
  const days = Math.max(0, diffDays(today, sentDay));
  return { days, repeat: days >= 1, late: days > checkDays };
}

/** Подстановки шаблонов владельцам (`TEMPLATE_VARS` у `tgSub*`). */
export function subOwnerValues(
  e:
    | { event: 'soon'; org: string; paidUntil: IsoDate; days: number; renew: number }
    | { event: 'over'; org: string; paidUntil: IsoDate; renew: number }
    | { event: 'paid'; org: string; paidUntil: IsoDate }
    | { event: 'rejected'; org: string; reason: string }
    | { event: 'mem80' | 'memfull'; org: string; usedBytes: number; limitBytes: number },
): Record<string, string | number> {
  switch (e.event) {
    case 'soon':
      return {
        организация: e.org,
        дата: formatDateRu(e.paidUntil),
        дней: e.days,
        сумма: formatSomWithUnit(e.renew),
      };
    case 'over':
      return {
        организация: e.org,
        дата: formatDateRu(e.paidUntil),
        сумма: formatSomWithUnit(e.renew),
      };
    case 'paid':
      return { организация: e.org, дата: formatDateRu(e.paidUntil) };
    case 'rejected':
      return { организация: e.org, причина: e.reason };
    default:
      return {
        организация: e.org,
        занято: subscriptionGbText(e.usedBytes),
        лимит: subscriptionGbText(e.limitBytes),
      };
  }
}
