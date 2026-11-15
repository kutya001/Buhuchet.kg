import {
  LEAD_ADDRESS_MAX,
  LEAD_ADMIN_NOTE_MAX,
  LEAD_APPROVE_REFUSALS,
  LEAD_DOC_KINDS,
  LEAD_DOC_MAX_BYTES,
  LEAD_DOCS_FOUND,
  LEAD_HEAD_MAX,
  LEAD_EVENT_KINDS,
  LEAD_FIRM_MAX,
  LEAD_NAME_MAX,
  LEAD_NOTE_MAX,
  LEAD_REASON_MAX,
  LEAD_SIZE_MAX,
  LEAD_STATUSES,
  LEAD_TELEGRAM_MAX,
  ORG_LEGAL_FORMS,
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
  /**
   * Форма организации и данные из документов (доработки 14.11.2026, блок 1; прототип v114 ldCheck):
   * ИНН — 14 цифр, ОКПО — 8 цифр или пусто (пробелы убирает форма до отправки), адрес и руководитель —
   * как проверил и поправил заявитель. Документы формы — в черновике `draft` (загружены и проверены).
   */
  form: z.enum(ORG_LEGAL_FORMS, message('land.e.form')),
  inn: z.string().regex(/^[0-9]{14}$/, message('land.e.inn')),
  okpo: z.string().regex(/^([0-9]{8})?$/, message('land.e.okpo')),
  address: z.string().trim().max(LEAD_ADDRESS_MAX).refine(oneLine),
  head: z.string().trim().max(LEAD_HEAD_MAX).refine(oneLine),
  draft: Uuid,
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

/**
 * Ответ на заявку: одинаковый для новой, повторной с того же телефона и для ловушки. `tg` — ссылка
 * «Подключить Telegram» на сутки (прототип v114 ldOkHtml, поток Т): ловушке — такая же, но ненастоящая;
 * `linked` — заявитель уже подключил бота (повтор из того же браузера); null — бота нет.
 */
export const LeadSubmitted = z.object({
  ok: z.literal(true),
  tg: z
    .union([
      z.object({ url: z.string(), expiresAt: z.iso.datetime() }),
      z.object({ linked: z.literal(true) }),
    ])
    .nullable(),
});
export type LeadSubmitted = z.infer<typeof LeadSubmitted>;

export const LeadStatusCode = z.enum(LEAD_STATUSES);

export const LeadDocKindCode = z.enum(LEAD_DOC_KINDS);

/**
 * Документ формы с лендинга (прототип v114 ldDocsBind): вид, имя и размер — PDF до 20 МБ. `draft` —
 * черновик документов этой формы (null — первый документ): номер знает только браузер заявителя.
 */
export const LeadUploadStart = z.strictObject({
  draft: Uuid.nullable(),
  kind: LeadDocKindCode,
  name: z.string().trim().min(1).max(255).refine(oneLine),
  size: z.number().int().min(1).max(LEAD_DOC_MAX_BYTES, message('land.e.big')),
});
export type LeadUploadStart = z.infer<typeof LeadUploadStart>;

/** Куда положить документ (подписанная ссылка на 2 минуты) и черновик, к которому он относится. */
export const LeadUploadTicket = z.object({
  id: Uuid,
  draft: Uuid,
  upload: z.object({
    url: z.string(),
    method: z.literal('PUT'),
    headers: z.record(z.string(), z.string()),
    expiresAt: z.iso.datetime(),
  }),
});
export type LeadUploadTicket = z.infer<typeof LeadUploadTicket>;

export const LeadUploadParams = z.object({ id: Uuid });
export const LeadUploadRead = z.strictObject({ draft: Uuid });

/**
 * Документы формы прочитаны (прототип v114 ldParse): что нашёл разбор по всем документам черновика —
 * данные для полей, ничего (скан без текста) или документы разных организаций.
 */
export const LeadDocsRead = z.object({
  found: z.enum(LEAD_DOCS_FOUND),
  values: z.object({
    firm: z.string(),
    inn: z.string(),
    okpo: z.string(),
    head: z.string(),
    address: z.string(),
  }),
  docs: z.array(z.object({ id: Uuid, kind: LeadDocKindCode, name: z.string() })),
});
export type LeadDocsRead = z.infer<typeof LeadDocsRead>;

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
  /**
   * Заявка с документами (доработки 14.11.2026, блок 1): форма и данные из документов; null — заявка
   * без документов (до 15.11.2026). `docs` — сколько документов (0 — удалены по сроку).
   */
  legalForm: z.enum(ORG_LEGAL_FORMS).nullable(),
  inn: z.string().nullable(),
  okpo: z.string().nullable(),
  address: z.string().nullable(),
  head: z.string().nullable(),
  docs: z.number().int().nonnegative().nullable(),
  /** Заявитель подключил бота по ссылке из формы («Telegram подключён»). */
  tgLinked: z.boolean(),
  /** Имя подключившего в Telegram («@имя» или имя из профиля); null — не подключён. */
  tgName: z.string().nullable(),
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
  /** Откуда сделано: `telegram` — кнопкой или ответом в чате бота («через Telegram»); пусто — на сайте. */
  via: z.enum(['telegram']).nullable(),
});
export type AdminLeadEvent = z.infer<typeof AdminLeadEvent>;

/** Документ заявки в окне заявки (прототип v114 ldCardBox): вид, имя, размер. */
export const AdminLeadDoc = z.object({
  id: Uuid,
  kind: LeadDocKindCode,
  name: z.string(),
  size: z.number().int().nonnegative(),
  /** Файл ещё переносится в хранилище (не открыть). */
  pending: z.boolean(),
});
export type AdminLeadDoc = z.infer<typeof AdminLeadDoc>;

/**
 * «Одобрить» в окне заявки (прототип v114 ldApproveWhy, ldLoginOf): почему неактивна (код и текст) и
 * логин владельца, который подставит окно.
 */
export const LeadApproveInfo = z.object({
  refusal: z.enum(LEAD_APPROVE_REFUSALS).nullable(),
  message: z.string().nullable(),
  login: z.string(),
});
export type LeadApproveInfo = z.infer<typeof LeadApproveInfo>;

/** Окно заявки (прототип openLead): заявка, «Заметка администратора», «История статусов», «История». */
export const AdminLeadCard = AdminLead.extend({
  adminNote: z.string(),
  statusHistory: z.array(StatusHistoryEntry),
  history: z.array(AdminLeadEvent),
  /** Документы заявки и что с ними (доработки 14.11.2026, блок 1); у заявки без документов — пусто. */
  docFiles: z.array(AdminLeadDoc),
  /** Когда удалятся файлы, если заявку не одобрить; null — не удалятся (одобрена, удалены, нет). */
  docsPurgeAt: z.iso.datetime().nullable(),
  /** Когда файлы удалены по сроку; null — не удалялись. */
  docsGoneAt: z.iso.datetime().nullable(),
  /** «Одобрить» — только у заявки с документами без организации; иначе null. */
  approve: LeadApproveInfo.nullable(),
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

/**
 * «Одобрить» (прототип v114 ldApproveDlg): логин владельца (латиница, цифры, точка, дефис; от 3) и
 * версия заявки, которую видел администратор. Остальное — из заявки.
 */
export const LeadApproveRequest = z.strictObject({
  login: z.string().trim().toLowerCase().min(1).max(64),
  version: RecordVersion,
});
export type LeadApproveRequest = z.input<typeof LeadApproveRequest>;

/** Ответ «Одобрить»: организация, владелец и ушла ли ему ссылка для пароля (поток Т). */
export const LeadApproved = z.object({
  orgId: Uuid,
  ownerUserId: Uuid,
  setup: z.enum(['sent', 'no_telegram', 'failed']),
});
export type LeadApproved = z.infer<typeof LeadApproved>;

/** «Сохранить заметку»: пустая — заметки нет. */
export const LeadNoteRequest = z.strictObject({
  // Обрезается здесь, а не только в базе (там `btrim` — одни пробелы): заметка с переводом строки в
  // конце при повторном «Сохранить заметку» не пишет в историю запись без изменений.
  note: z.string().trim().max(LEAD_ADMIN_NOTE_MAX).refine(noNul),
  version: RecordVersion,
});
export type LeadNoteRequest = z.input<typeof LeadNoteRequest>;
