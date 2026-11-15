/*
 * Файлы от контрагентов (доработки 14.11.2026, блок 2): контрагент присылает файл со своей страницы
 * или в Telegram, сотрудник принимает или отклоняет. Принятый становится обычным файлом контрагента
 * с источником «От контрагента»; непринятые удаляются через 30 дней после отправки вместе с файлом в
 * хранилище.
 */

/** Откуда прислан: со страницы контрагента или боту в Telegram. */
export const SENT_FILE_SOURCES = ['page', 'telegram'] as const;
export type SentFileSource = (typeof SENT_FILE_SOURCES)[number];

/** Загрузка: начата (браузер кладёт файл по подписанной ссылке) или файл в хранилище и проверен. */
export const SENT_FILE_STATES = ['pending', 'ready'] as const;
export type SentFileState = (typeof SENT_FILE_STATES)[number];

/** «Новый» → «Принят» или «Отклонён» (с обязательной причиной). */
export const SENT_FILE_STATUSES = ['new', 'accepted', 'rejected'] as const;
export type SentFileStatus = (typeof SENT_FILE_STATUSES)[number];

/** Непринятые файлы удаляются через 30 дней после отправки. */
export const SENT_FILE_KEEP_DAYS = 30;
/** Не больше 20 файлов в сутки от одного контрагента, до 10 за одну отправку со страницы. */
export const SENT_FILES_PER_DAY = 20;
export const SENT_FILES_PER_SEND = 10;
/** «Комментарий» — до 300 знаков; имя в Telegram того, кто прислал, — до 64. */
export const SENT_FILE_COMMENT_MAX = 300;
export const SENT_FILE_SENDER_MAX = 64;
/** Причина «Отклонить». */
export const SENT_FILE_REASON_MAX = 300;

/**
 * Куда браузер кладёт файл со страницы по подписанной ссылке: отдельный ключ рядом с файлом
 * (`<ключ файла>.up`). Ссылку можно использовать ещё 2 минуты и после «закончить», поэтому на ключ самого
 * файла ссылка не выдаётся никогда: туда попадает только проверенная сервером копия.
 */
export const sentUploadKey = (storageKey: string): string => `${storageKey}.up`;

/**
 * Незаконченная загрузка со страницы (не дошла, не прошла проверку, брошена) удаляется задачей по
 * расписанию через 30 минут — до тех пор она занимает место в пределе «20 в сутки». Ссылка на загрузку
 * действует 2 минуты: позже положить файл уже нельзя.
 */
export const SENT_PENDING_TTL_MS = 30 * 60_000;

/**
 * Закончить отправку со страницы можно в течение 20 минут после начала — заметно раньше, чем задача
 * удаляет незаконченные (`SENT_PENDING_TTL_MS`): «закончить» и удаление не встречаются на одной строке.
 */
export const SENT_COMPLETE_MINUTES = 20;
