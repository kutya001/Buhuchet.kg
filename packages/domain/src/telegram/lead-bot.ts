import type { LeadStatus } from '../admin/leads';
import { botClip, type BotButton, type BotMessage } from './bot-message';

/*
 * Заявка с сайта в Telegram — с кнопками (поток Т, задача Т6; пакет заказчика 13.11.2026, идея 14;
 * прототип v103 admin/tg-leads.js). Сообщение администратору платформы — заголовок, таблица «Фирма /
 * Контрагентов / Контакт» и кнопки «Взять в работу», «Отклонить», «Открыть в Админке». Статус из чата
 * меняется так же, как в «Заявках»; снять «Отказ», «Подключена» и «Создать организацию» — только на
 * сайте. Простой текст — прежние шаблоны «новая заявка с сайта» и «повторная заявка с сайта».
 */

/** Коды действий кнопок заявки: «Взять в работу», «Отклонить» и ответ с причиной отказа. */
export const LEAD_BOT_ACTIONS = { work: 'leadWork', no: 'leadNo', why: 'leadNoWhy' } as const;

/** Причина отказа из чата — не длиннее (прототип `LEAD_WHY_MAX`). */
export const LEAD_BOT_REASON_MAX = 300;
/** Название фирмы в ответах бота — не длиннее (прототип `LEAD_FIRM_MAX`). */
export const LEAD_BOT_FIRM_MAX = 60;
/** Ячейка таблицы сообщения о заявке — не длиннее: поля формы бывают до 160 знаков. */
export const LEAD_BOT_CELL_MAX = 200;

/** Название фирмы для ответа бота и просьбы о причине. */
export const leadBotFirm = (firm: string) => botClip(firm, LEAD_BOT_FIRM_MAX);

/**
 * Причина отказа из текста ответа: одной строкой, без скобок (в истории заявки причина сама стоит в
 * скобках) и управляющих знаков, не длиннее 300 знаков; пустая строка — причины нет, заявка не меняется.
 */
export function leadBotReason(text: string): string {
  return [
    ...text
      .replace(/[()]/g, '')
      .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  ]
    .slice(0, LEAD_BOT_REASON_MAX)
    .join('')
    .trim();
}

/** «Взять в работу» — только у новой заявки (как «В работу» на сайте). */
export const leadBotCanWork = (status: LeadStatus) => status === 'new';

/** «Отклонить» — пока заявка не «Подключена» и не «Отказ» (как «Отказ» на сайте). */
export const leadBotCanRefuse = (status: LeadStatus) =>
  status === 'new' || status === 'in_progress';

/** Пометка заявки с тестового стенда перед заголовком (прототип `leadMsg`). */
export const LEAD_BOT_STAND_MARK = '🧪 Тестовый стенд · ';

export interface LeadBotInput {
  /** Заявка: её идентификатор уходит в данные кнопок. */
  id: string;
  firm: string;
  name: string;
  /** Телефон в виде для человека («+996 555 123 456»). */
  phone: string;
  size: string;
  status: LeadStatus;
  /** Название статуса — строка «Статус» в сообщении о повторной заявке. */
  statusName: string;
  /** Повторная заявка с того же телефона за сутки. */
  repeat: boolean;
  /** Заявка с тестового стенда. */
  stand: boolean;
  /** Адрес вкладки «Заявки»; кнопка «Открыть в Админке» — только у сайта по https. */
  link: string | null;
  /** Простой текст — прежнее сообщение одной строкой со ссылкой. */
  plain: string;
  texts: {
    head: string;
    work: string;
    no: string;
    open: string;
    firm: string;
    size: string;
    contact: string;
    status: string;
  };
}

/**
 * Сообщение о заявке. Кнопки — по статусу заявки на момент отправки: у повторной заявки, которую уже
 * взяли в работу, «Взять в работу» нет; у «Подключена» и «Отказа» остаётся только ссылка.
 */
export function leadBotMessage(o: LeadBotInput): BotMessage {
  const cell = (text: string) => botClip(text, LEAD_BOT_CELL_MAX);
  const actions: BotButton[] = [
    ...(leadBotCanWork(o.status)
      ? [{ text: o.texts.work, action: LEAD_BOT_ACTIONS.work, arg: o.id }]
      : []),
    ...(leadBotCanRefuse(o.status)
      ? [{ text: o.texts.no, action: LEAD_BOT_ACTIONS.no, arg: o.id }]
      : []),
  ];
  const open: BotButton[] =
    o.link && /^https:\/\//.test(o.link) ? [{ text: o.texts.open, url: o.link }] : [];
  const buttons = [actions, open].filter((row) => row.length);
  return {
    heading: (o.stand ? LEAD_BOT_STAND_MARK : '') + o.texts.head,
    plain: o.plain,
    tables: [
      {
        rows: [
          [o.texts.firm, cell(o.firm)],
          [o.texts.size, cell(o.size) || '—'],
          [o.texts.contact, cell(`${o.name}, ${o.phone}`)],
          ...(o.repeat ? [[o.texts.status, o.statusName]] : []),
        ],
      },
    ],
    ...(buttons.length ? { buttons } : {}),
  };
}
