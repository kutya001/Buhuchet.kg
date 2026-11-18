import {
  BROADCAST_TEXT_MAX,
  CAST_TITLE_MAX,
  JOURNAL_CHAT_KINDS,
  JOURNAL_DIRS,
  JOURNAL_HIDES,
  JOURNAL_KINDS,
  JOURNAL_PERIODS,
  JOURNAL_SOURCES,
  JOURNAL_STATUSES,
} from '@buhuchet/domain';
import { z } from 'zod';
import { Uuid } from './common';
import { ListExportParams, ListQueryParams, ListValuesQuery, listPageSchema } from './list';

/*
 * Админка → «Телеграм» (ТЗ «Админка» → «Модуль Телеграмм»; прототип admin/telegram.js и admin/tg-log.js;
 * задача 2.41; журнал переписки в обе стороны — docs/decisions.md п. Т-16).
 */

/** Период журнала: 1 (сегодня по Бишкеку), 7, 30 или 90 дней; по умолчанию — 7. */
const JournalDays = z.enum(JOURNAL_PERIODS.map(String) as [string, ...string[]]);

/**
 * Что показывает журнал сверх поиска и фильтров: направление («Все · Отправленные · Полученные»),
 * период и «Вся переписка» — `chat` — номер строки журнала, чей чат показать (номера чата в запросах и
 * ответах нет).
 */
const journalScope = {
  dir: z.enum(JOURNAL_DIRS).optional(),
  days: JournalDays.optional(),
  chat: Uuid.optional(),
};
export const AdminTelegramLogQuery = ListQueryParams.extend(journalScope);
export const AdminTelegramLogValuesQuery = ListValuesQuery.extend(journalScope);
export const AdminTelegramLogExportQuery = ListExportParams.extend(journalScope);

/**
 * Строка журнала переписки бота (решение заказчика 17.11.2026; прототип v132 admin/tg-log.js): время,
 * направление, собеседник («Иванов А. @ivanov», контрагент и имя клиента, общий чат), организация (null —
 * «Платформа»), вид сообщения, текст одной строкой, статус, попыток, ошибка Telegram или код итога
 * (`recipient_unlinked` — подпись по словарю). У кода и одноразовой ссылки текста нет (`hide`). Номера
 * чата в ответе нет.
 */
export const AdminTelegramLogRow = z.object({
  id: Uuid,
  /** Откуда строка: журнал отправок, сообщения клиентам контрагентов, полученное. Повтор — только `outbox`. */
  src: z.enum(JOURNAL_SOURCES),
  dir: z.enum(JOURNAL_DIRS),
  at: z.iso.datetime(),
  sentAt: z.iso.datetime().nullable(),
  recipient: z.string(),
  orgId: Uuid.nullable(),
  orgName: z.string().nullable(),
  chatKind: z.enum(JOURNAL_CHAT_KINDS),
  kind: z.enum(JOURNAL_KINDS),
  status: z.enum(JOURNAL_STATUSES),
  tries: z.number().int().nonnegative(),
  error: z.string().nullable(),
  /** Текст одной строкой, как в столбце «Текст»; null — текст скрыт или его нет. */
  text: z.string().nullable(),
  hide: z.enum(JOURNAL_HIDES).nullable(),
});
export type AdminTelegramLogRow = z.infer<typeof AdminTelegramLogRow>;

/** Страница журнала: сортировка, страницы и фильтры — на сервере. */
export const AdminTelegramLogList = listPageSchema(AdminTelegramLogRow);
export type AdminTelegramLogList = z.infer<typeof AdminTelegramLogList>;

/** Плашки над журналом: «В очереди», «Ошибки отправки», «Отправлено сегодня», «Получено сегодня». */
export const AdminTelegramSummary = z.object({
  pending: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  sentToday: z.number().int().nonnegative(),
  receivedToday: z.number().int().nonnegative(),
});
export type AdminTelegramSummary = z.infer<typeof AdminTelegramSummary>;

/**
 * Сообщение бота, как его видит человек в чате: заголовок, текст, таблицы и кнопки. От кнопки — только
 * подпись, вид, погашена ли и нажата ли: адреса ссылок, тексты копирования и данные нажатия в ответ не
 * идут.
 */
export const AdminTelegramView = z.object({
  heading: z.string().optional(),
  sub: z.string().optional(),
  text: z.string().optional(),
  tables: z
    .array(
      z.object({
        title: z.string().optional(),
        open: z.boolean().optional(),
        head: z.array(z.string()).optional(),
        rows: z.array(z.array(z.string())),
        foot: z.array(z.string()).optional(),
        numeric: z.array(z.number().int().nonnegative()).optional(),
        n: z.number().int().nonnegative().optional(),
      }),
    )
    .optional(),
  buttons: z
    .array(
      z.array(
        z.object({
          text: z.string(),
          kind: z.enum(['action', 'copy', 'url']),
          off: z.boolean(),
          pressed: z.boolean(),
        }),
      ),
    )
    .optional(),
  /** У сообщения была картинка (рассылка); сама картинка в журнале не показывается. */
  image: z.boolean(),
});
export type AdminTelegramView = z.infer<typeof AdminTelegramView>;

/** Сообщение в окне «Сообщение»: строка журнала и то, что показать в виде чата. */
export const AdminTelegramMessageBody = AdminTelegramLogRow.extend({
  /** Учётная запись собеседника — для перехода в карточку; null — клиент, группа или чат без привязки. */
  userId: Uuid.nullable(),
  /** Отправленное: сообщение бота, как в чате; null — скрыто или описания нет (тогда — `fullText`). */
  view: AdminTelegramView.nullable(),
  /** Текст с переносами строк: полученный текст, подпись к файлу или текст отправленного без описания. */
  fullText: z.string().nullable(),
  /** Подпись нажатой кнопки (полученное нажатие). */
  button: z.string().nullable(),
  file: z
    .object({ name: z.string().nullable(), size: z.number().nonnegative().nullable() })
    .nullable(),
});
export type AdminTelegramMessageBody = z.infer<typeof AdminTelegramMessageBody>;

/**
 * Окно «Сообщение»: само сообщение; сообщение бота, к которому относится полученное; что пришло в
 * ответ на отправленное (нажатия и ответы, не больше 20); соседние сообщения того же чата.
 */
export const AdminTelegramMessage = z.object({
  message: AdminTelegramMessageBody,
  bot: AdminTelegramMessageBody.nullable(),
  replies: z.array(AdminTelegramMessageBody),
  prevId: Uuid.nullable(),
  nextId: Uuid.nullable(),
});
export type AdminTelegramMessage = z.infer<typeof AdminTelegramMessage>;

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

/** Номер новости, статьи или видео платформы: латиница, цифры, «-» и «_». */
const CastRecordId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

/** Запись сайта для «Подробнее» (поток Т, задача Т6): новость или статья Базы знаний. */
export const AdminTelegramCastMore = z.strictObject({
  kind: z.enum(['news', 'article']),
  id: CastRecordId,
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
  video: CastRecordId.nullable().default(null),
});
export type AdminTelegramBroadcastRequest = z.input<typeof AdminTelegramBroadcastRequest>;

/** Число получателей рассылки — для окна подтверждения; `org` нет — всем пользователям платформы. */
export const AdminTelegramCastCountQuery = z.object({ org: Uuid.optional() });
export const AdminTelegramCastCount = z.object({ count: z.number().int().nonnegative() });
export type AdminTelegramCastCount = z.infer<typeof AdminTelegramCastCount>;

/**
 * `news` — новость, из меню которой открыли «Рассылку» («Отправить в Telegram»): она приходит в списке,
 * даже если не входит в 20 последних.
 */
export const AdminTelegramCastOptionsQuery = z.object({ news: CastRecordId.optional() });

/** Что можно поставить в кнопки рассылки и в «Заполнить из новости». */
export const AdminTelegramCastOptions = z.object({
  /**
   * Опубликованные новости «для всех», новые сверху, не больше 20 (и запрошенная `news`, если она вышла и
   * для всех); `video` — видео из ссылки новости.
   */
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
