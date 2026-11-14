import {
  insertPendingFile,
  markFileReady,
  orgMenuSettings,
  writeHistory,
  type Tx,
} from '@buhuchet/db';
import type { AccessSubject } from '@buhuchet/domain';
import type { ApiDeps } from '../../deps';
import { canUpload, canView, sourceOf } from './files';

/*
 * Прикрепить к записи файл, который сервер уже положил в хранилище (поток Т, задача Т2: файл, присланный
 * боту в Telegram ответом на просьбу). Правила — те же, что у загрузки с сайта (`startUploadHandler` и
 * `completeUploadHandler`), в том же порядке: «Файлы в карточках» включены → запись видна сотруднику
 * (иначе её как будто нет) → он может прикреплять к ней файлы. Отказ — значением, а не исключением:
 * вызывающий отвечает в чате и удаляет положенный объект. Файл на странице контрагента показывается по
 * общему правилу (не скрыт).
 *
 * Вызывающий отвечает за то, что: транзакция — от имени сотрудника в его организации (RLS), субъект —
 * его права, а не данные Telegram; ключ — `orgFileKey(организация, 'files', id)` с номером от сервера;
 * тип — `fileContentType(name)`; имя и размер проверены `fileUploadProblem`, размер — фактический.
 */

export type AttachRefusal = 'files_off' | 'not_found' | 'forbidden';

export interface StoredFile {
  /** Номер файла от сервера (он же — последняя часть ключа хранилища). */
  id: string;
  /** Запись, к которой прикрепляется файл: отчёт или задача. */
  source: { kind: 'report' | 'task'; id: string };
  name: string;
  /** Фактический размер положенного объекта. */
  size: number;
  contentType: string;
  storageKey: string;
  /** Примечание к файлу: одна строка, не длиннее `FILE_NOTE_MAX`; пустое — null. */
  note: string | null;
}

export async function attachStoredFile(
  deps: ApiDeps,
  tx: Tx,
  subject: AccessSubject,
  orgId: string,
  file: StoredFile,
): Promise<{ id: string; name: string } | AttachRefusal> {
  const { features } = await orgMenuSettings(tx, orgId);
  if (!features.files) return 'files_off';
  const source = sourceOf(deps, file.source.kind);
  const record = source ? await source.resolve(tx, subject, file.source.id) : null;
  if (!record || !canView(subject, record)) return 'not_found';
  if (!canUpload(subject, record)) return 'forbidden';
  await insertPendingFile(tx, {
    id: file.id,
    sourceKind: file.source.kind,
    sourceId: file.source.id,
    contractorId: record.contractor?.id ?? null,
    name: file.name,
    contentType: file.contentType,
    sizeBytes: file.size,
    storageKey: file.storageKey,
    note: file.note,
    pageHidden: false,
  });
  await markFileReady(tx, file.id);
  await writeHistory(tx, {
    ...record.history(file.id),
    action: 'file_attach',
    changes: [{ field: 'file', to: file.name }],
  });
  return { id: file.id, name: file.name };
}
