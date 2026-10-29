import {
  fileExtension,
  fileSizeParts,
  fileUploadProblem,
  type FileProblem,
} from '@buhuchet/domain';
import {
  FileFormContractors,
  FileItem,
  FileList,
  FileManagerSummary,
  FileUploadTicket,
  FileUsage,
  type FileSource,
} from '@buhuchet/shared';
import { queryOptions, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api, apiFailure, callApi } from '../api-client';
import type { ApiErrorLike, Translate } from '../l10n/translate';

/**
 * Данные блока «Файлы» записи: список файлов записи (TanStack Query), загрузка файла мимо API
 * (начать → положить в хранилище по подписанной ссылке → закончить), строка «PDF · 1,2 МБ».
 */

/** Файлы записи и можно ли прикреплять новые; ключ — вид и номер записи. */
export function filesQuery(source: FileSource) {
  return queryOptions({
    queryKey: ['files', source.kind, source.id ?? ''],
    queryFn: async () => {
      const res = await api.api.files.$get({
        query: source.id ? { kind: source.kind, id: source.id } : { kind: source.kind },
      });
      if (!res.ok) throw await apiFailure(res);
      return FileList.parse(await res.json());
    },
  });
}

/** «PDF · 1,2 МБ» (прототип: `fext(f) · fmtSize(size)`); без расширения — «ФАЙЛ». */
export function fileMeta(t: Translate, name: string, size: number): string {
  const ext = fileExtension(name)?.toUpperCase() ?? t('files.no_ext');
  return t('files.meta', { ext, size: fileSizeText(t, size) });
}

/**
 * Что не так с выбранными файлами до загрузки: больше 20 МБ — все такие одним списком (прототип
 * uploadDlg: «Файл больше 20 МБ: …»), иначе — первый файл с неверным именем или запрещённым типом.
 * Если что-то не так, не загружается ни один файл из выбранных.
 */
export function pickedFilesProblem(
  files: readonly { name: string; size: number }[],
): { code: 'file_too_large'; names: string } | { code: FileProblem; name: string } | null {
  const big = files.filter((f) => fileUploadProblem(f) === 'file_too_large');
  if (big.length) return { code: 'file_too_large', names: big.map((f) => f.name).join(', ') };
  for (const f of files) {
    const code = fileUploadProblem(f);
    if (code) return { code, name: f.name };
  }
  return null;
}

/** Плашки Файлового менеджера и можно ли загружать вручную. */
export const managerSummaryQuery = queryOptions({
  queryKey: ['files', 'manager', 'summary'],
  queryFn: async () => {
    const res = await api.api.files.manager.summary.$get();
    if (!res.ok) throw await apiFailure(res);
    return FileManagerSummary.parse(await res.json());
  },
});

/** Контрагенты окна «Загрузить файл». */
export const formContractorsQuery = queryOptions({
  queryKey: ['files', 'manager', 'contractors'],
  queryFn: async () => {
    const res = await api.api.files.manager.contractors.$get();
    if (!res.ok) throw await apiFailure(res);
    return FileFormContractors.parse(await res.json()).items;
  },
});

/** «Хранилище файлов» в «Моя организация» → «Настройки». */
export const fileUsageQuery = queryOptions({
  queryKey: ['files', 'usage'],
  queryFn: async () => {
    const res = await api.api.files.usage.$get();
    if (!res.ok) throw await apiFailure(res);
    return FileUsage.parse(await res.json());
  },
});

/** После загрузки и удаления: список, плашки, занятый объём и блоки «Файлы» записей. */
export function useFilesRefresh() {
  const client = useQueryClient();
  return useCallback(
    () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ['files'] }),
        client.invalidateQueries({ queryKey: ['list', 'files.list'] }),
      ]),
    [client],
  );
}

/** «1,2 МБ», «37 КБ» (прототип `fmtSize`). */
export function fileSizeText(t: Translate, size: number): string {
  const { value, unit } = fileSizeParts(size);
  return t(`files.size.${unit}`, { n: value });
}

/**
 * Загрузить один файл к записи: API начинает загрузку и подписывает ссылку, браузер кладёт файл в
 * хранилище (`PUT`), API проверяет размер и показывает файл в записи.
 */
export async function uploadFile(
  source: FileSource,
  file: File,
  manual?: { contractorId: string | null; note: string },
): Promise<{ ok: true; item: FileItem } | { ok: false; error: ApiErrorLike }> {
  const started = await callApi(() =>
    api.api.files.uploads.$post({
      json: { source, name: file.name, size: file.size, ...manual },
    }),
  );
  if (!started.ok) return started;
  const ticket = FileUploadTicket.parse(started.data);
  let put: Response;
  try {
    put = await fetch(ticket.upload.url, {
      method: ticket.upload.method,
      headers: ticket.upload.headers,
      body: file,
    });
  } catch {
    return { ok: false, error: { code: 'network', message: '' } };
  }
  if (!put.ok) return { ok: false, error: { code: 'file_not_uploaded', message: '' } };
  const done = await callApi(() =>
    api.api.files[':id'].complete.$post({ param: { id: ticket.id } }),
  );
  if (!done.ok) return done;
  return { ok: true, item: FileItem.parse(done.data) };
}
