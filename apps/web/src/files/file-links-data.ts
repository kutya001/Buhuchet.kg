import { FileLinkable, FileLinkAdded, type FileSource } from '@buhuchet/shared';
import { queryOptions } from '@tanstack/react-query';
import { api, apiFailure, callApi } from '../api-client';

/**
 * Данные ссылок файлов контрагента (доработки 16.11.2026, блок 2; прототип v124 `fPickDlg`, `fLinkAdd`,
 * `fUnlink`): окно «Из файлов контрагента», «Прикрепить: N» и «Открепить».
 */

/**
 * Куда прикрепляют: запись (`kind`, `id`) или контрагент формы новой записи (`kind: 'contractor'` и его
 * номер) — тогда окно показывает все его файлы, а прикрепит их форма после сохранения записи.
 */
export type FileLinkTargetRef = { kind: FileSource['kind']; id: string };

/** Файлы контрагента для окна «Из файлов контрагента»; читаются заново при каждом открытии. */
export function linkableQuery(target: FileLinkTargetRef) {
  return queryOptions({
    queryKey: ['files', 'linkable', target.kind, target.id],
    staleTime: 0,
    queryFn: async () => {
      const res = await api.api.files.linkable.$get({
        query: { kind: target.kind, id: target.id },
      });
      if (!res.ok) throw await apiFailure(res);
      return FileLinkable.parse(await res.json());
    },
  });
}

/** «Прикрепить» файлы контрагента ссылкой к записи (уже прикреплённые сервер пропускает). */
export async function linkFiles(target: FileLinkTargetRef, fileIds: readonly string[]) {
  const res = await callApi(() =>
    api.api.files.links.$post({
      json: { kind: target.kind, id: target.id, fileIds: [...fileIds] },
    }),
  );
  return res.ok ? { ...res, data: FileLinkAdded.parse(res.data) } : res;
}

/** «Открепить» файл от записи: файл остаётся у контрагента. */
export function unlinkFile(fileId: string, source: FileLinkTargetRef) {
  return callApi(() =>
    api.api.files[':id'].links.$delete({
      param: { id: fileId },
      query: { kind: source.kind, sourceId: source.id },
    }),
  );
}
