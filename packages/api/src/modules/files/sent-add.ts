import { randomUUID } from 'node:crypto';
import { orgFileKey } from '@buhuchet/adapters';
import {
  contextOrgName,
  dropPendingSentFiles,
  insertPendingSentFiles,
  lockSentFilesOf,
  markSentFilesReady,
  notifyTarget,
  pageClosedNotice,
  sentFilesLastDay,
  sentUploadState,
  telegramChat,
  withOrgContext,
  writeHistory,
  type Tx,
} from '@buhuchet/db';
import {
  FILE_SNIFF_BYTES,
  fileContentProblem,
  fileContentType,
  formatText,
  sentFileNote,
  sentFilesSendRefusal,
  sentUploadOn,
  SENT_FILE_SENDER_MAX,
  withOrganization,
  type SentFileRefusal,
  type SentFileSource,
} from '@buhuchet/domain';
import type { ApiDeps } from '../../deps';
import { serverTexts } from '../l10n/texts';
import { flushEvents, queueEvents } from '../telegram/outbox';

/*
 * «Добавить отправленный файл» (доработки 14.11.2026, блок 2; прототип v112 `modules/cp-sent.js`): общий
 * вход для файлов от контрагента — со страницы по ссылке (`sent-page.ts`) и из Telegram (потоки К и Т
 * вызывают `addSentFiles`). Правила одни: контрагенту можно отправлять файлы (страница включена и не
 * закрыта, раздел «Файлы» показан, галочки учётной политики и контрагента), не больше 10 за раз и 20 в
 * сутки, до 20 МБ каждый, тип — по содержимому, а не по расширению. Файл лежит в хранилище под ключом
 * `org/<организация>/sent/<номер>`; строка «Новый», запись в истории контрагента и сообщение
 * ответственному в Telegram.
 */

/** Раздел ключа хранилища: `org/<org_id>/sent/<id>` (ограничение contractor_sent_files_key_check). */
export const SENT_SECTION = 'sent';

export const sentFileKey = (orgId: string, id: string) => orgFileKey(orgId, SENT_SECTION, id);

/** Куда ведёт ссылка в сообщении: вкладка «Файлы от контрагентов». */
const SENT_PATH = '/app/files/sent';

/** Отказ отправки с текстом словаря (`err.<код>`) — для ответа странице и сообщения в чате. */
export class SentFilesRefused extends Error {
  constructor(readonly refusal: SentFileRefusal) {
    super(refusal.code);
    this.name = 'SentFilesRefused';
  }
}

/**
 * Можно ли отправлять и сколько ещё за сутки — в транзакции организации контрагента (страница и бот
 * работают без пользователя), под блокировкой отправок контрагента до конца транзакции: вставку строк
 * делать в ней же. Отправлять нельзя — `sent_off`.
 */
export async function sentLimitCheck(
  tx: Tx,
  contractorId: string,
  files: readonly { name: string; size: number }[],
): Promise<void> {
  await lockSentFilesOf(tx, contractorId);
  const state = await sentUploadState(tx, contractorId);
  if (!state || !sentUploadOn(state)) throw new SentFilesRefused({ code: 'sent_off' });
  const refusal = sentFilesSendRefusal(files, await sentFilesLastDay(tx, contractorId));
  if (refusal) throw new SentFilesRefused(refusal);
}

/**
 * Загрузка закончена: строки «Новый», запись в истории контрагента (без автора — контрагент) — в той
 * же транзакции. Имена и комментарий — для истории и сообщения.
 */
export async function finishSentFiles(
  tx: Tx,
  o: {
    contractorId: string;
    ids: readonly string[];
    names: readonly string[];
    source: SentFileSource;
    comment: string | null;
    /** Из Telegram: имя чата и чек ли это (прототип v115 `pgFileIn`) — для строки истории. */
    sender?: string | null;
    receipt?: boolean;
  },
): Promise<void> {
  await markSentFilesReady(tx, o.ids);
  await writeHistory(tx, {
    entity: 'sent_file',
    entityId: o.ids[0]!,
    action: 'sent_file_send',
    contractorId: o.contractorId,
    changes: [
      { field: 'files', to: [...o.names] },
      { field: 'source', to: o.source },
      ...(o.sender ? [{ field: 'sender', to: o.sender }] : []),
      ...(o.receipt ? [{ field: 'receipt', to: true }] : []),
      ...(o.comment ? [{ field: 'comment', to: o.comment }] : []),
    ],
  });
}

/**
 * Сообщение о новых файлах (прототип `sntNotify`, `pgTgStaff`): ответственному, а без него (или он
 * заблокирован, без Telegram) — первому владельцу с Telegram. Как `tgSvc` прототипа, не зависит от
 * переключателей напоминаний; ошибка не мешает отправке файлов.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#И-7
export async function notifySentFiles(
  deps: ApiDeps,
  orgId: string,
  contractorId: string,
  names: readonly string[],
): Promise<void> {
  if (!deps.telegram || !names.length) return;
  try {
    const t = await serverTexts(deps);
    const ids = await withOrgContext(deps.db, { orgId, userId: null }, async (tx) => {
      const notice = await pageClosedNotice(tx, contractorId);
      if (!notice) return [];
      for (const employeeId of notice.employeeIds) {
        const target = await notifyTarget(tx, employeeId);
        if (!target?.chatId) continue;
        const chat = await telegramChat(tx, target.userId);
        if (!chat) continue;
        const values = { contractor: notice.contractor, names: names.join(', '), n: names.length };
        const body = formatText(
          t(names.length > 1 ? 'files.sent.tg.many' : 'files.sent.tg.one'),
          values,
        );
        const link = formatText(t('telegram.open'), {
          link: new URL(SENT_PATH, deps.config.APP_BASE_URL).href,
        });
        return queueEvents(
          tx,
          [
            {
              userId: target.userId,
              chatId: chat.chatId,
              kind: 'cp_file',
              text: withOrganization(`${body}\n\n${link}`, await contextOrgName(tx), chat.shared),
            },
          ],
          deps.clock.now(),
        );
      }
      return [];
    });
    await flushEvents(deps, orgId, ids);
  } catch (err) {
    deps.logger.warn({ err, orgId }, 'Telegram: сообщение о файле от контрагента не записано');
  }
}

/** Файл, который сервер уже получил целиком (из Telegram). */
export interface SentFileBody {
  name: string;
  bytes: Uint8Array;
}

/**
 * Добавить отправленные файлы, которые сервер получил сам (Telegram, потоки К и Т): проверить имена,
 * размер и содержимое, лимиты и галочки, положить в хранилище, сделать «Новыми», записать историю и
 * сообщить ответственному. Вызывать вне транзакции: хранилище и Telegram — до и после неё. Отказ —
 * `SentFilesRefused` (текст — `sentFileRefusalText`), положенные объекты при отказе удаляются.
 * Чат и имя отправителя проверяет вызывающий (чат подключён к этому контрагенту этой организации).
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#И-7
export async function addSentFiles(
  deps: ApiDeps,
  o: {
    orgId: string;
    contractorId: string;
    source: SentFileSource;
    senderName?: string | null;
    tgChatId?: number | null;
    comment?: string | null;
    /** Чек к оплате (поток К): в истории — «чек», а не «файл». */
    receipt?: boolean;
    files: readonly SentFileBody[];
  },
): Promise<{ ids: string[] }> {
  const list = o.files.map((f) => ({ name: f.name.trim(), size: f.bytes.byteLength }));
  const first = sentFilesSendRefusal(list, 0);
  if (first) throw new SentFilesRefused(first);
  const bad = o.files.filter(
    (f) => fileContentProblem(f.name.trim(), f.bytes.subarray(0, FILE_SNIFF_BYTES)) !== null,
  );
  if (bad.length) {
    throw new SentFilesRefused({ code: 'sent_forbidden', files: bad.map((f) => f.name.trim()) });
  }
  const comment = sentFileNote(o.comment ?? '') || null;
  const senderName = o.senderName?.trim().slice(0, SENT_FILE_SENDER_MAX) || null;
  const rows = list.map((f) => {
    const id = randomUUID();
    return {
      id,
      contractorId: o.contractorId,
      source: o.source,
      senderName: o.source === 'telegram' ? senderName : null,
      tgChatId: o.source === 'telegram' ? (o.tgChatId ?? null) : null,
      comment,
      name: f.name,
      contentType: fileContentType(f.name),
      sizeBytes: f.size,
      storageKey: sentFileKey(o.orgId, id),
    };
  });
  const ctx = { orgId: o.orgId, userId: null };
  // Строки «pending» — под лимитом: две отправки одновременно не превысят 20 в сутки.
  await withOrgContext(deps.db, ctx, async (tx) => {
    await sentLimitCheck(tx, o.contractorId, list);
    await insertPendingSentFiles(tx, rows);
  });
  const ids = rows.map((r) => r.id);
  try {
    for (const [i, row] of rows.entries()) {
      await deps.storage.put(row.storageKey, o.files[i]!.bytes, { contentType: row.contentType });
    }
    await withOrgContext(deps.db, ctx, (tx) =>
      finishSentFiles(tx, {
        contractorId: o.contractorId,
        ids,
        names: rows.map((r) => r.name),
        source: o.source,
        comment,
        sender: o.source === 'telegram' ? senderName : null,
        receipt: o.receipt ?? false,
      }),
    );
  } catch (err) {
    await withOrgContext(deps.db, ctx, (tx) => dropPendingSentFiles(tx, ids)).catch(
      (e: unknown) => {
        deps.logger.error({ err: e }, 'файлы от контрагентов: загрузка не стёрта после отказа');
      },
    );
    for (const row of rows) {
      await deps.storage.delete(row.storageKey).catch((e: unknown) => {
        deps.logger.error({ err: e }, 'файлы от контрагентов: файл не удалён из хранилища');
      });
    }
    throw err;
  }
  await notifySentFiles(
    deps,
    o.orgId,
    o.contractorId,
    rows.map((r) => r.name),
  );
  return { ids };
}
