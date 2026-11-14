import { addDays, formatDateRu, type IsoDate } from '../common/dates';
import { formatSom, type Tyiyn } from '../common/money';
import type { YearMonth } from '../common/months';
import type { PaysTo } from '../money/requisites';
import type { MonthPay, MonthPayLine } from '../reports/month-pay';
import type { MonthPlanReport } from '../reports/month-plan';
import type { BotButton, BotMessage } from '../telegram/bot-message';
import type { TransferBlock } from './telegram-requisite';

/*
 * «К оплате» клиенту в Telegram (доработки 13.11.2026, задача К4; прототип v94 modules/cp-telegram.js:
 * `pgPayMsg`, `rmPaySendWhy`, `PG_PAY_DAYS`). Сообщение собирается из того же расчёта, что блок
 * «К оплате клиенту» в карточке контрагента (`monthToPay`): своего правила сумм здесь нет.
 */

/** За сколько дней до ближайшего срока оплаты месяца сообщение уходит само (прототип PG_PAY_DAYS). */
export const CP_PAY_DAYS = 5;

/**
 * Виды сообщений клиенту, под которыми бот принимает нажатия и ответы; `fee` — «Оплата за обслуживание
 * до …» (доработки 14.11.2026, блок 3 и блок 4, пункт 5): само и ручное, одно на чат в день.
 */
export const CP_TG_MESSAGE_KINDS = ['pay', 'ask', 'debt', 'fee'] as const;
export type CpTgMessageKind = (typeof CP_TG_MESSAGE_KINDS)[number];

/** Коды действий кнопок клиента (латиница, до 16 знаков — `botPressData`). */
export const CP_TG_PAID_ACTION = 'cpPaid';
export const CP_TG_ASK_ACTION = 'cpAsk';
/** «Не напоминать» под напоминанием о долге (задача К5, `telegram-debt.ts`). */
export const CP_TG_NODEBT_ACTION = 'cpNoDebt';
/**
 * «Показать реквизиты для перевода» под напоминанием о долге (доработки 14.11.2026, блок 4, пункт 3;
 * прототип v110 `cp-req`; `telegram-requisite.ts`).
 */
export const CP_TG_REQ_ACTION = 'cpReq';
export const CP_TG_CLIENT_ACTIONS = [
  CP_TG_PAID_ACTION,
  CP_TG_ASK_ACTION,
  CP_TG_NODEBT_ACTION,
  CP_TG_REQ_ACTION,
] as const;

/**
 * Ответ сотрудника на вопрос клиента (прототип v94 `pgTgAnswer`): сообщение сотруднику «Вопрос
 * контрагента» — просьба бота без дня с этим действием, ответ на него уходит клиенту. Это действие
 * сотрудника (реестр `BOT_ACTIONS`, права и область), а не клиента — в `CP_TG_CLIENT_ACTIONS` его нет.
 */
export const CP_TG_ANSWER_ACTION = 'cptgAns';

/** Вопрос клиента бухгалтеру — не длиннее 500 знаков (прототип: поле вопроса `maxlength="500"`). */
export const CP_TG_QUESTION_MAX = 500;
/** В историю контрагента попадает начало вопроса (прототип pgTgAsk: `q.slice(0,200)`). */
export const CP_TG_QUESTION_HISTORY_MAX = 200;
/** «Отправить в Telegram» одному контрагенту — не чаще стольких раз в час: клиента не завалить. */
export const CP_TG_PAY_SENDS_PER_HOUR = 10;
/** Вопросов бухгалтеру из одного чата — не больше стольких в час: историю и чат сотрудника не завалить. */
export const CP_TG_QUESTIONS_PER_HOUR = 10;
/**
 * «Показать реквизиты для перевода» с одного подключения Telegram к контрагенту — не больше стольких в
 * час: каждое нажатие присылает новые сообщения (docs/deviations.md п. К-9).
 */
export const CP_TG_REQ_PER_HOUR = 10;

/**
 * Что мешает «Отправить в Telegram» (прототип rmPaySendWhy): код — ключ словаря `err.<код>`. Без
 * реквизитов для перевода «К оплате» не уходит (доработки 14.11.2026, блок 4, пункт 1; прототип v110
 * `pgNoReqWhy`): у счёта организации и у реквизита сотрудника — своя подсказка, где их добавить;
 * раздел «Как оплатить» скрыт на странице контрагента — реквизиты в Telegram не уходят (п. К-9).
 */
export const MONTH_PAY_SEND_REFUSALS = [
  'month_pay_send_right',
  'month_pay_send_archived',
  'month_pay_send_not_linked',
  'month_pay_send_no_req_org',
  'month_pay_send_no_req_emp',
  'month_pay_send_req_hidden',
] as const;
export type MonthPaySendRefusal = (typeof MONTH_PAY_SEND_REFUSALS)[number];

export const MONTH_PAY_SEND_MESSAGES = {
  month_pay_send_right: 'Нужно право «Управлять страницей контрагента»',
  month_pay_send_archived: 'Контрагент в архиве',
  month_pay_send_not_linked:
    'Контрагент не подключил Telegram: кнопка «Подключить Telegram» — на его странице, в разделе «Telegram»',
  month_pay_send_no_req_org:
    'Не отправлено «К оплате»: у {contractor} нет реквизитов для перевода. Добавьте основной счёт для налогов: «Моя организация» → «Реквизиты».',
  month_pay_send_no_req_emp:
    'Не отправлено «К оплате»: у {contractor} нет реквизитов для перевода. Реквизиты добавляет {employee} в «Мой профиль».',
  month_pay_send_req_hidden:
    'Не отправлено «К оплате»: у {contractor} на странице скрыт раздел «Как оплатить», а без реквизитов для перевода сообщение не уходит. Покажите раздел в блоке «Страница контрагента».',
  month_pay_send_off:
    'Отправка в Telegram выключена: нужны «Напоминания в Telegram» и «Страница контрагента по ссылке»',
  month_pay_send_limit: 'Слишком много сообщений этому контрагенту. Попробуйте через час',
  month_pay_send_failed: 'Не удалось отправить сообщение в Telegram. Попробуйте позже',
} as const;

/**
 * Реквизиты для «К оплате»: есть (`ok`), нет (`none`) или раздел «Как оплатить» клиенту не показан
 * (`hidden`) — тогда реквизиты в Telegram не уходят.
 */
export type PayRequisiteState = 'ok' | 'none' | 'hidden';

/**
 * Отказ отправке (прототип rmPaySendWhy): сначала право, потом архив, потом «не подключил», потом
 * реквизиты — подсказка по полю «Деньги на налоги переводит» (`pgNoReqWhy`).
 */
export function monthPaySendRefusal(o: {
  canManagePage: boolean;
  archived: boolean;
  recipients: number;
  requisite: PayRequisiteState;
  paysTo: PaysTo;
}): MonthPaySendRefusal | null {
  if (!o.canManagePage) return 'month_pay_send_right';
  if (o.archived) return 'month_pay_send_archived';
  if (o.recipients < 1) return 'month_pay_send_not_linked';
  if (o.requisite === 'hidden') return 'month_pay_send_req_hidden';
  if (o.requisite === 'none') {
    return o.paysTo === 'emp' ? 'month_pay_send_no_req_emp' : 'month_pay_send_no_req_org';
  }
  return null;
}

/** Вопрос клиента: одной строкой, без управляющих знаков и не длиннее предела; пусто — `null`. */
export function cpTgQuestion(text: string): string | null {
  const chars = [
    ...text
      .replace(/(?!\u200D)[\p{Cc}\p{Cf}]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  ];
  if (chars.length === 0) return null;
  return chars.length > CP_TG_QUESTION_MAX
    ? `${chars.slice(0, CP_TG_QUESTION_MAX - 1).join('')}…`
    : chars.join('');
}

/** Начало вопроса для истории контрагента. */
export function cpTgQuestionForHistory(question: string): string {
  const chars = [...question];
  return chars.length > CP_TG_QUESTION_HISTORY_MAX
    ? chars.slice(0, CP_TG_QUESTION_HISTORY_MAX).join('')
    : question;
}

/**
 * Пора ли отправить «К оплате» самому (прототип: «приходит за 5 дней до ближайшего срока оплаты
 * месяца, если все суммы месяца указаны»): есть что платить, отчётов без суммы нет, до ближайшего
 * срока осталось не больше 5 дней и он не прошёл. Отправка — один раз на месяц и чат (ключ в базе),
 * поэтому пропущенный день догоняется, пока срок не прошёл.
 */
export function monthPayAutoDue<R extends MonthPlanReport>(
  pay: Pick<MonthPay<R>, 'due' | 'noAmount' | 'total'>,
  today: IsoDate,
): boolean {
  if (!pay.due || pay.noAmount > 0 || pay.total <= 0) return false;
  return today <= pay.due && today >= addDays(pay.due, -CP_PAY_DAYS);
}

/** «25.11» — срок в таблице сообщения (прототип: `fmtD(r.due).slice(0,5)`). */
const shortDate = (date: IsoDate) => formatDateRu(date).slice(0, 5);

/**
 * Сообщение «К оплате» (прототип v110 pgPayMsg): заголовок со сроком, контрагент и бухгалтер, текст
 * шаблона `tgCpPay` и под ним блок «Реквизиты для перевода — …», таблица налогов с итогом, кнопка
 * копирования по виду реквизита, «Оплатил» и «Вопрос бухгалтеру». Без реквизитов «К оплате» не уходит
 * (доработки 14.11.2026, блок 4, пункт 1). `arg` кнопок — месяц: сумму и контрагента бот берёт из своей
 * записи о сообщении, а не из данных кнопки.
 */
export function monthPayBotMessage(o: {
  contractor: string;
  /** Короткое имя ответственного; без ответственного — `null`. */
  accountant: string | null;
  month: YearMonth;
  lines: readonly MonthPayLine[];
  total: Tyiyn;
  due: IsoDate;
  /** Реквизиты для перевода: блок текста и кнопка копирования (`transferBlock`). */
  requisite: TransferBlock;
  /** Заполненный шаблон `tgCpPay`. */
  text: string;
  labels: {
    heading: string;
    accountant: string;
    tax: string;
    amount: string;
    due: string;
    total: string;
    paid: string;
    ask: string;
  };
}): BotMessage {
  const copy = o.requisite.copy;
  const buttons: BotButton[][] = [
    ...(copy ? [[copy]] : []),
    [
      { text: o.labels.paid, action: CP_TG_PAID_ACTION, arg: o.month },
      { text: o.labels.ask, action: CP_TG_ASK_ACTION, arg: o.month },
    ],
  ];
  return {
    heading: `${o.labels.heading} ${formatDateRu(o.due)}`,
    sub: o.accountant ? `${o.contractor} · ${o.labels.accountant} ${o.accountant}` : o.contractor,
    text: `${o.text}\n\n${o.requisite.text}`,
    tables: [
      {
        head: [o.labels.tax, o.labels.amount, o.labels.due],
        rows: o.lines.map((x) => [x.name, formatSom(x.left), shortDate(x.due)]),
        foot: [o.labels.total, formatSom(o.total), ''],
        numeric: [1],
      },
    ],
    buttons,
  };
}
