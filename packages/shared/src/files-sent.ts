import {
  PAY_CLAIM_PURPOSES,
  SENT_FILE_COMMENT_MAX,
  SENT_FILE_REASON_MAX,
  SENT_FILE_SOURCES,
  SENT_FILE_STATUSES,
  SENT_FILES_PER_SEND,
} from '@buhuchet/domain';
import { z } from 'zod';
import { IsoDate, RecordVersion, Tyiyn, Uuid } from './common';
import { listPageSchema } from './list';

/*
 * Файлы от контрагентов (доработки 14.11.2026, блок 2; прототип v112 `modules/cp-sent.js`): раздел
 * «Отправленные файлы» карточки контрагента, вкладка «Файлы от контрагентов» Файлового менеджера,
 * «Принять» и «Отклонить» с причиной, отправка со страницы контрагента по ссылке.
 */

export const SentFileSourceSchema = z.enum(SENT_FILE_SOURCES);
export const SentFileStatusSchema = z.enum(SENT_FILE_STATUSES);

/**
 * Отправленный файл глазами сотрудника: откуда и кто прислал, когда, комментарий, статус, причина
 * отказа, кто решил и когда, сколько дней до удаления (у принятого — null), принятый файл контрагента;
 * `canDecide` — можно ли этому сотруднику принять или отклонить (прототип `sntCan`).
 */
export const SentFileItem = z.object({
  id: Uuid,
  contractor: z.object({ id: Uuid, name: z.string() }),
  name: z.string(),
  contentType: z.string(),
  size: z.number().int().nonnegative(),
  source: SentFileSourceSchema,
  senderName: z.string().nullable(),
  comment: z.string().nullable(),
  status: SentFileStatusSchema,
  rejectReason: z.string().nullable(),
  decidedBy: z.string().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  sentAt: z.iso.datetime(),
  sentDate: IsoDate,
  daysLeft: z.number().int().nonnegative().nullable(),
  fileId: Uuid.nullable(),
  canDecide: z.boolean(),
  version: RecordVersion,
});
export type SentFileItem = z.infer<typeof SentFileItem>;

/**
 * Чек к оплате (доработки 14.11.2026, блок 4, пункт 4; прототип v115 `pgRcptMoney`): что оплачено, за
 * какой месяц и сколько — из сообщения, под которым клиент нажал «Оплатил» или «Прислать чек». Приходит
 * только в ответе «Принять» и только тому, кто может сразу принять эти деньги.
 */
export const SentFilePay = z.object({
  purpose: z.enum(PAY_CLAIM_PURPOSES),
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .nullable(),
  amount: Tyiyn.nullable(),
});
export type SentFilePay = z.infer<typeof SentFilePay>;

/** Ответ «Принять»: принятый файл и — у чека — что оплачено. */
export const SentFileAccepted = SentFileItem.extend({ pay: SentFilePay.nullable() });
export type SentFileAccepted = z.infer<typeof SentFileAccepted>;

/** Раздел «Отправленные файлы» карточки контрагента: от новых к старым и сколько новых. */
export const SentFileList = z.object({
  items: z.array(SentFileItem),
  newCount: z.number().int().nonnegative(),
});
export type SentFileList = z.infer<typeof SentFileList>;

/** Строка вкладки «Файлы от контрагентов»: тот же файл и ответственный за контрагента. */
export const SentFileRow = SentFileItem.extend({ responsible: z.string().nullable() });
export type SentFileRow = z.infer<typeof SentFileRow>;
export const SentFileListPage = listPageSchema(SentFileRow);
export type SentFileListPage = z.infer<typeof SentFileListPage>;

/** Счётчик новых файлов у «Файлового менеджера» в меню и на вкладке; null — вкладки нет. */
export const SentFileCount = z.object({ count: z.number().int().nonnegative().nullable() });
export type SentFileCount = z.infer<typeof SentFileCount>;

export const SentFileIdParam = z.object({ id: Uuid });
export const SentContractorParam = z.object({ id: Uuid });

/** «Принять»: с версией, которую видел сотрудник. */
export const SentFileAccept = z.strictObject({ version: RecordVersion });
/** «Отклонить»: причина обязательна (пустую и длинную проверяет правило `sentFileReason`). */
export const SentFileReject = z.strictObject({
  version: RecordVersion,
  reason: z.string().max(SENT_FILE_REASON_MAX * 4),
});

/** Ссылка на файл: `download=1` — скачать, иначе картинка и PDF открываются в браузере. */
export const SentFileLinkQuery = z.strictObject({ download: z.enum(['1']).optional() });

/** Галочка «Контрагент может отправлять файлы» в блоке «Страница контрагента» карточки. */
export const SentUploadSwitch = z.strictObject({ on: z.boolean(), version: RecordVersion });

/**
 * Строка «Файлы от контрагента» блока «Страница контрагента» (прототип v112 `pgBox`): `shown` — страница
 * включена и раздел «Файлы» есть у организации; `on` — галочка контрагента; `orgOn` — галочка учётной
 * политики (выключена — строка неактивна); `manage` — почему менять нельзя (`err.<код>`); `version` —
 * версия страницы для правки.
 */
export const SentUploadState = z.object({
  shown: z.boolean(),
  on: z.boolean(),
  orgOn: z.boolean(),
  manage: z.enum(['page_manage_right', 'page_archived']).nullable(),
  version: RecordVersion.nullable(),
});
export type SentUploadState = z.infer<typeof SentUploadState>;

/* ── Страница контрагента по ссылке (без входа) ── */

/** Файл, отправленный со страницы: имя и размер (тип по содержимому проверит сервер). */
export const PageSentStartFile = z.strictObject({
  name: z.string().min(1).max(1000),
  size: z.number().int().nonnegative(),
});

/** «Отправить файл»: до 10 файлов за раз и необязательный комментарий. */
export const PageSentStart = z.strictObject({
  files: z.array(PageSentStartFile).max(SENT_FILES_PER_SEND * 2),
  comment: z
    .string()
    .max(SENT_FILE_COMMENT_MAX * 4)
    .optional(),
});

/** Куда положить каждый файл: подписанная ссылка `PUT` на 2 минуты. */
export const PageSentTicket = z.object({
  items: z.array(
    z.object({
      id: Uuid,
      upload: z.object({
        url: z.string(),
        method: z.literal('PUT'),
        headers: z.record(z.string(), z.string()),
        expiresAt: z.iso.datetime(),
      }),
    }),
  ),
});
export type PageSentTicket = z.infer<typeof PageSentTicket>;

/** Закончить отправку: номера из `PageSentTicket`. */
export const PageSentComplete = z.strictObject({
  ids: z.array(Uuid).min(1).max(SENT_FILES_PER_SEND),
});

/** Отправка закончена: сколько файлов получил бухгалтер. */
export const PageSentDone = z.object({ sent: z.number().int().positive() });

/** Отправленный контрагентом файл на его странице (прототип `pubSentHtml`). */
export const PageSentFile = z.object({
  id: Uuid,
  name: z.string(),
  sentAt: z.iso.datetime(),
  comment: z.string().nullable(),
  status: SentFileStatusSchema,
  reason: z.string().nullable(),
  daysLeft: z.number().int().nonnegative().nullable(),
});
export type PageSentFile = z.infer<typeof PageSentFile>;

/** «Отправить файл» и «Отправленные вами» раздела «Файлы» страницы. */
export const PageSent = z.object({ upload: z.boolean(), items: z.array(PageSentFile) });
export type PageSent = z.infer<typeof PageSent>;
