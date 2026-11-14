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
