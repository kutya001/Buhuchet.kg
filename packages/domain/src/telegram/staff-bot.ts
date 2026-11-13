import { diffDays, formatDateRu, type IsoDate } from '../common/dates';
import type { BotButton, BotMessage } from './bot-message';

/*
 * Действия сотрудника из чата бота (поток Т, задача Т2; пакет заказчика 13.11.2026, идеи 1, 3 и 7;
 * прототип v97 modules/tg-staff.js). Кнопки стоят под сообщением об одной записи: одно сообщение — один
 * отчёт или одна задача, так нажатие всегда относится к одной записи. Напоминание за день по-прежнему
 * приходит одним сообщением, следом — сообщения с кнопками для первых 10 отчётов, сначала самые срочные.
 * Здесь — только вид сообщений; правила действий — те же, что у сайта, в обработчиках нажатий.
 */

/** Сколько записей одного напоминания получают свои сообщения с кнопками (прототип `TG_BTN_MAX`). */
export const STAFF_BOT_BUTTONS_MAX = 10;

/** Коды действий сотрудника в чате бота (данные кнопок). */
export const STAFF_BOT_ACTIONS = {
  reportWork: 'repWork',
  reportDone: 'repDone',
  reportFile: 'repFile',
  taskWork: 'taskWork',
  taskDone: 'taskDone',
  taskFile: 'taskFile',
  confirmOk: 'confOk',
  confirmBack: 'confBack',
  confirmWhy: 'confWhy',
} as const;

/** Причина возврата «На исправление» из чата — не длиннее (прототип `confWhy`). */
export const BOT_RETURN_REASON_MAX = 500;

/**
 * Причина возврата из текста ответа: одной строкой, без скобок (в истории она сама стоит в скобках), не
 * длиннее 500 знаков; пустая строка — причины нет.
 */
export function botReturnReason(text: string): string {
  return [
    ...text
      .replace(/[()]/g, '')
      .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  ]
    .slice(0, BOT_RETURN_REASON_MAX)
    .join('')
    .trim();
}

/** «13.11» — день и месяц срока в строке под названием отчёта (прототип `tgDM`). */
export const botDayMonth = (date: IsoDate) => formatDateRu(date).slice(0, 5);

/** Тексты строки срока — из словаря (`telegram.item.*`); `{date}`, `{n}` подставляет вызывающий. */
export interface StaffBotDueTexts {
  due(date: string): string;
  over(days: number): string;
  today: string;
  ahead(days: number): string;
}

/** «срок 13.11 · сегодня последний день» (прототип `tgDueTxt`). */
export function botDueText(due: IsoDate, today: IsoDate, t: StaffBotDueTexts): string {
  const d = diffDays(due, today);
  return `${t.due(botDayMonth(due))} · ${d < 0 ? t.over(-d) : d === 0 ? t.today : t.ahead(d)}`;
}

/** Отчёт в сообщении с кнопками. */
export interface StaffBotReport {
  id: string;
  /** «НДС за октябрь 2026». */
  name: string;
  contractor: string;
  /** Отчёт в «К сдаче»: только у него есть «В работе». */
  todo: boolean;
}

/** Кнопка-ссылка «Открыть»; адреса нет (сайт не по https) — кнопки нет. */
const openButton = (label: string, url: string | null): BotButton[] =>
  url ? [{ text: label, url }] : [];

/**
 * Сообщение об одном отчёте с кнопками (прототип `tgRepMsg`): «В работе» — только у «К сдаче», «Сдан»,
 * «Открыть». `sub` — строка срока.
 */
export function reportBotMessage(
  r: StaffBotReport,
  sub: string,
  labels: { work: string; done: string; open: string },
  url: string | null,
): BotMessage {
  return {
    heading: r.name,
    sub: `${r.contractor} · ${sub}`,
    buttons: [
      [
        ...(r.todo ? [{ text: labels.work, action: STAFF_BOT_ACTIONS.reportWork, arg: r.id }] : []),
        { text: labels.done, action: STAFF_BOT_ACTIONS.reportDone, arg: r.id },
        ...openButton(labels.open, url),
      ],
    ],
  };
}

/**
 * Сдача ждёт подтверждения (прототип `tgConfMsg`): «Подтвердить», «Вернуть», «Открыть». `sub` — «сдан
 * 13.11, Иванов И.».
 */
export function confirmBotMessage(
  r: Pick<StaffBotReport, 'id' | 'name' | 'contractor'>,
  sub: string,
  labels: { ok: string; back: string; open: string },
  url: string | null,
): BotMessage {
  return {
    heading: r.name,
    sub: `${r.contractor} · ${sub}`,
    buttons: [
      [
        { text: labels.ok, action: STAFF_BOT_ACTIONS.confirmOk, arg: r.id },
        { text: labels.back, action: STAFF_BOT_ACTIONS.confirmBack, arg: r.id },
        ...openButton(labels.open, url),
      ],
    ],
  };
}

/**
 * Возврат «На исправление» ответственному (прототип `tgFixMsg`): прежний текст шаблона и кнопки отчёта —
 * исправил и сразу отметил «Сдан».
 */
export function fixBotMessage(
  reportId: string,
  text: string,
  labels: { done: string; open: string },
  url: string | null,
): BotMessage {
  return {
    text,
    buttons: [
      [
        { text: labels.done, action: STAFF_BOT_ACTIONS.reportDone, arg: reportId },
        ...openButton(labels.open, url),
      ],
    ],
  };
}

/**
 * Новая задача исполнителю (прототип `tgTaskMsg`): название — заголовком, «Новая задача от … · срок …»
 * — под ним; «Взять в работу» — только у «К выполнению», «Выполнена», ниже — «Открыть задачу».
 */
export function taskBotMessage(
  task: { id: string; title: string; todo: boolean },
  sub: string,
  labels: { work: string; done: string; open: string },
  url: string | null,
): BotMessage {
  return {
    heading: task.title,
    sub,
    buttons: [
      [
        ...(task.todo
          ? [{ text: labels.work, action: STAFF_BOT_ACTIONS.taskWork, arg: task.id }]
          : []),
        { text: labels.done, action: STAFF_BOT_ACTIONS.taskDone, arg: task.id },
      ],
      ...(url ? [openButton(labels.open, url)] : []),
    ],
  };
}

/** «Кнопки — у первых 10 записей. Ещё 3 — на сайте» с кнопкой-ссылкой на список (прототип `tgStaffList`). */
export function moreOnSiteMessage(text: string, label: string, url: string | null): BotMessage {
  return url ? { text, buttons: [openButton(label, url)] } : { text };
}
