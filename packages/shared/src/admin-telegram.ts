import {
  BROADCAST_TEXT_MAX,
  CAST_TITLE_MAX,
  OUTBOX_KINDS,
  OUTBOX_STATUSES,
} from '@buhuchet/domain';
import { z } from 'zod';
import { Uuid } from './common';
import { listPageSchema } from './list';

/*
 * Админка → «Телеграм» (ТЗ «Админка» → «Модуль Телеграмм»; прототип admin/telegram.js; задача 2.41).
 */

/**
 * Строка журнала отправок: время, получатель («Иванов А. @ivanov»), организация (null — администратор
 * платформы, «Платформа»), вид сообщения, статус, попыток, ошибка Telegram или код итога
 * (`recipient_unlinked` — подпись по словарю). Текста сообщения и номера чата в ответе нет.
 */
export const AdminTelegramLogRow = z.object({
  id: Uuid,
  at: z.iso.datetime(),
  sentAt: z.iso.datetime().nullable(),
  recipient: z.string(),
  orgId: Uuid.nullable(),
  orgName: z.string().nullable(),
  kind: z.enum(OUTBOX_KINDS),
  status: z.enum(OUTBOX_STATUSES),
  tries: z.number().int().nonnegative(),
  error: z.string().nullable(),
});
export type AdminTelegramLogRow = z.infer<typeof AdminTelegramLogRow>;

/** Страница журнала: сортировка, страницы и фильтры — на сервере. */
export const AdminTelegramLogList = listPageSchema(AdminTelegramLogRow);
export type AdminTelegramLogList = z.infer<typeof AdminTelegramLogList>;

/** Плашки над журналом: «В очереди», «Ошибки отправки», «Отправлено сегодня». */
export const AdminTelegramSummary = z.object({
  pending: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  sentToday: z.number().int().nonnegative(),
});
export type AdminTelegramSummary = z.infer<typeof AdminTelegramSummary>;

/** «Повторить отправку» (одна строка) и «Повторить ошибки» (отмеченные): до 500 строк за раз. */
export const AdminTelegramRetryRequest = z.strictObject({
  ids: z.array(Uuid).min(1).max(500),
});
export type AdminTelegramRetryRequest = z.infer<typeof AdminTelegramRetryRequest>;

/** Сколько строк снова в очереди и сколько из отмеченных — коды восстановления (их не повторяют). */
export const AdminTelegramRetryResult = z.object({
  queued: z.number().int().nonnegative(),
  codes: z.number().int().nonnegative(),
});
export type AdminTelegramRetryResult = z.infer<typeof AdminTelegramRetryResult>;

/**
 * «Бот платформы»: адрес вебхука сайта, состояние по ответу Telegram (getWebhookInfo) и когда
 * проверено. `problem` — почему не работает; `lastError` — текст последней ошибки Telegram, `actualUrl`
 * — адрес, на который Telegram шлёт обновления, если он не наш.
 */
export const AdminTelegramBot = z.object({
  url: z.string(),
  ok: z.boolean(),
  problem: z.enum(['no_bot', 'unreachable', 'not_set', 'other_url', 'delivery']).nullable(),
  lastError: z.string().nullable(),
  actualUrl: z.string().nullable(),
  checkedAt: z.iso.datetime(),
  /** «Сообщения с таблицами»: выключено — все получают простой текст (кнопки остаются). */
  rich: z.boolean(),
});
export type AdminTelegramBot = z.infer<typeof AdminTelegramBot>;

/** «Вид сообщений и кнопки» → «Сообщения с таблицами» (поток Т, задача Т1). */
export const AdminTelegramBotView = z.strictObject({ rich: z.boolean() });
export type AdminTelegramBotView = z.infer<typeof AdminTelegramBotView>;

/** Действующие организации для «Кому». */
export const AdminTelegramOrgs = z.object({
  items: z.array(z.object({ id: Uuid, name: z.string() })),
});
export type AdminTelegramOrgs = z.infer<typeof AdminTelegramOrgs>;

/** Запись сайта для «Подробнее» (поток Т, задача Т6): новость или статья Базы знаний. */
export const AdminTelegramCastMore = z.strictObject({
  kind: z.enum(['news', 'article']),
  id: z.string().min(1).max(64),
});
export type AdminTelegramCastMore = z.infer<typeof AdminTelegramCastMore>;

/**
 * «Поставить в очередь»: кому (null — всем пользователям платформы) и сообщение. Оформленная рассылка
 * (поток Т, задача Т6; прототип v103 admin/tg-cast.js): заголовок до 80 знаков, текст до 900, картинка —
 * номер загруженного файла, «Подробнее» — новость или статья, «Смотреть видео» — видео платформы. Адресов
 * кнопок клиент не присылает: их собирает сервер из записей сайта.
 */
export const AdminTelegramBroadcastRequest = z.strictObject({
  org: Uuid.nullable(),
  title: z.string().trim().max(CAST_TITLE_MAX).default(''),
  text: z.string().trim().min(1).max(BROADCAST_TEXT_MAX),
  image: Uuid.nullable().default(null),
  more: AdminTelegramCastMore.nullable().default(null),
  video: z.string().min(1).max(64).nullable().default(null),
});
export type AdminTelegramBroadcastRequest = z.input<typeof AdminTelegramBroadcastRequest>;

/** Число получателей рассылки — для окна подтверждения; `org` нет — всем пользователям платформы. */
export const AdminTelegramCastCountQuery = z.object({ org: Uuid.optional() });
export const AdminTelegramCastCount = z.object({ count: z.number().int().nonnegative() });
export type AdminTelegramCastCount = z.infer<typeof AdminTelegramCastCount>;

/** Что можно поставить в кнопки рассылки и в «Заполнить из новости». */
export const AdminTelegramCastOptions = z.object({
  /** Опубликованные новости «для всех», новые сверху, не больше 20; `video` — видео из ссылки новости. */
  news: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      short: z.string(),
      video: z.string().nullable(),
    }),
  ),
  /** Статьи Базы знаний, кроме отключённых и «только для Админки». */
  articles: z.array(z.object({ id: z.string(), title: z.string() })),
  /** Опубликованные видео, кроме «только для Админки». */
  videos: z.array(z.object({ id: z.string(), title: z.string() })),
});
export type AdminTelegramCastOptions = z.infer<typeof AdminTelegramCastOptions>;

/** Загруженная картинка рассылки — номер файла для `image`. */
export const AdminTelegramCastImage = z.object({ id: Uuid });
export type AdminTelegramCastImage = z.infer<typeof AdminTelegramCastImage>;

/** Сколько сообщений поставлено в очередь. */
export const AdminTelegramBroadcastResult = z.object({
  queued: z.number().int().nonnegative(),
});
export type AdminTelegramBroadcastResult = z.infer<typeof AdminTelegramBroadcastResult>;
