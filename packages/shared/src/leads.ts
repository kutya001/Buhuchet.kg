import {
  LEAD_ADMIN_NOTE_MAX,
  LEAD_EVENT_KINDS,
  LEAD_FIRM_MAX,
  LEAD_NAME_MAX,
  LEAD_NOTE_MAX,
  LEAD_REASON_MAX,
  LEAD_SIZE_MAX,
  LEAD_STATUSES,
  LEAD_TELEGRAM_MAX,
  type UiTextKey,
} from '@buhuchet/domain';
import { z } from 'zod';
import { RecordAudit, RecordVersion, Uuid } from './common';
import { listPageSchema } from './list';
import { StatusHistoryEntry } from './status';

const message = (key: UiTextKey) => ({ message: key });

/** NUL PostgreSQL не примет — это 400, а не 500. */
const noNul = (s: string) => !s.includes('\u0000');
// eslint-disable-next-line no-control-regex -- однострочные поля: переводы строк и прочие управляющие
const CONTROL = /[\u0000-\u001f\u007f]/;
/** Однострочное поле: без переводов строк — сообщение администратору в Telegram не подделать. */
const oneLine = (s: string) => !CONTROL.test(s);

/*
 * Форма «Оставить заявку» лендинга (ТЗ «Лендинг» → «Форма «Оставить заявку»»; прототип
 * modules/landing.js, landFormBind). Сообщения — ключи словаря группы «Лендинг» (`land.e.*`): те же
 * тексты под полями, что в прототипе. Телефон — «+», код страны и цифры номера («+996555100200»);
 * сколько цифр после кода, сверяет сервер по справочнику «Коды стран телефонов».
 */
export const LeadForm = z.object({
  name: z
    .string()
    .trim()
    .min(1, message('land.e.name'))
    .max(LEAD_NAME_MAX, message('land.e.name'))
    .refine(oneLine, message('land.e.name')),
  firm: z
    .string()
    .trim()
    .min(1, message('land.e.firm'))
    .max(LEAD_FIRM_MAX, message('land.e.firm'))
    .refine(oneLine, message('land.e.firm')),
  phone: z.string().regex(/^\+\d{4,15}$/, message('land.e.phone')),
  /** Вариант из словаря (`land.f.size.opts`): что он из списка, сверяет сервер по действующему словарю. */
  size: z
    .string()
    .trim()
    .min(1, message('land.e.size'))
    .max(LEAD_SIZE_MAX, message('land.e.size'))
    .refine(oneLine, message('land.e.size')),
  telegram: z.string().trim().max(LEAD_TELEGRAM_MAX).refine(oneLine),
  note: z
    .string()
    .trim()
    .max(LEAD_NOTE_MAX, message('land.e.note'))
    .refine(noNul, message('land.e.note')),
  consent: z.literal(true, message('land.e.consent')),
  /**
   * Скрытое поле-ловушка («Сайт»): человек его не видит и не заполняет, бот — заполняет. Заявку с ним
   * сервер не сохраняет, но отвечает как обычно.
   */
  website: z.string().max(200).refine(noNul),
});
export type LeadForm = z.infer<typeof LeadForm>;

/** Ответ на заявку: всегда «Спасибо!», и для повторной с того же телефона, и для ловушки. */
export const LeadSubmitted = z.object({ ok: z.literal(true) });
export type LeadSubmitted = z.infer<typeof LeadSubmitted>;

export const LeadStatusCode = z.enum(LEAD_STATUSES);

/**
 * Заявка в Админке → «Организации» → «Заявки» (прототип admin/leads.js, renderLeads): дата, имя,
 * фирма, телефон, сколько клиентов, Telegram, комментарий, статус, организация, созданная по заявке.
 * «Создал» — посетитель сайта, «Изменил» — он же или администратор платформы.
 */
export const AdminLead = z.object({
  id: Uuid,
  at: z.iso.datetime(),
  name: z.string(),
  firm: z.string(),
  phone: z.string(),
  size: z.string(),
  telegram: z.string().nullable(),
  note: z.string().nullable(),
  status: LeadStatusCode,
  /** Статус до «Отказа»: «Снять «Отказ»» возвращает в него. */
  statusBefore: LeadStatusCode.nullable(),
  org: z.object({ id: Uuid, name: z.string() }).nullable(),
  /** Заявка с тестового стенда. */
  fromStand: z.boolean(),
  /** Когда статус ставили в последний раз и кто — под компактной шкалой списка. */
  lastStatus: z.object({ at: z.iso.datetime(), by: z.string() }).nullable(),
  audit: RecordAudit,
  version: RecordVersion,
});
export type AdminLead = z.infer<typeof AdminLead>;

/** Страница вкладки «Заявки»: сортировка, страницы и фильтры — на сервере. */
export const AdminLeadList = listPageSchema(AdminLead);
export type AdminLeadList = z.infer<typeof AdminLeadList>;

/** Запись истории заявки: что, когда, кто (посетитель сайта или администратор платформы). */
export const AdminLeadEvent = z.object({
  at: z.iso.datetime(),
  actor: z.string(),
  kind: z.enum(LEAD_EVENT_KINDS),
  from: LeadStatusCode.nullable(),
  to: LeadStatusCode.nullable(),
  /** Причина отказа и отката, название созданной организации, комментарий повторной заявки. */
  text: z.string().nullable(),
});
export type AdminLeadEvent = z.infer<typeof AdminLeadEvent>;

/** Окно заявки (прототип openLead): заявка, «Заметка администратора», «История статусов», «История». */
export const AdminLeadCard = AdminLead.extend({
  adminNote: z.string(),
  statusHistory: z.array(StatusHistoryEntry),
  history: z.array(AdminLeadEvent),
});
export type AdminLeadCard = z.infer<typeof AdminLeadCard>;

/** Плитка «Заявки с сайта» и счётчик вкладки: заявок «Новая». */
export const AdminLeadSummary = z.object({
  fresh: z.number().int().nonnegative(),
  /** Администраторов платформы, кому уйдёт сообщение о заявке; 0 — «О новых заявках некому сообщить…». */
  recipients: z.number().int().nonnegative(),
});
export type AdminLeadSummary = z.infer<typeof AdminLeadSummary>;

/** Причина отказа и отката: не пустая, без NUL. */
const LeadReason = z
  .string()
  .trim()
  .min(1)
  .max(LEAD_REASON_MAX)
  .refine((s) => /[^\s\p{Cf}]/u.test(s))
  .refine(noNul);

/**
 * Смена статуса заявки (меню, шкала, окно отката): куда, версия, которую видел администратор, причина —
 * у «Отказа» и отката обязательна. Шаг это, «Отказ» или откат — решает сервер (`leadStatusChange`).
 */
export const LeadStatusRequest = z.strictObject({
  to: LeadStatusCode,
  version: RecordVersion,
  reason: LeadReason.optional(),
});
export type LeadStatusRequest = z.input<typeof LeadStatusRequest>;

/** «Сохранить заметку»: пустая — заметки нет. */
export const LeadNoteRequest = z.strictObject({
  // Обрезается здесь, а не только в базе (там `btrim` — одни пробелы): заметка с переводом строки в
  // конце при повторном «Сохранить заметку» не пишет в историю запись без изменений.
  note: z.string().trim().max(LEAD_ADMIN_NOTE_MAX).refine(noNul),
  version: RecordVersion,
});
export type LeadNoteRequest = z.input<typeof LeadNoteRequest>;
