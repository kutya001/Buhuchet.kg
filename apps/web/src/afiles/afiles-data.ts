import {
  AdminOrgFiles,
  AdminStorageCheck,
  AdminStorageFileList,
  AdminStorageSummary,
  AdminTrashList,
  FileLink,
  ListValues,
  type AdminStorageFile,
} from '@buhuchet/shared';
import { queryOptions, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api, apiFailure } from '../api-client';
import type { FetchListPage } from '../lists/use-list-page';

/*
 * Админка → «Файлы» (доработки 20.11.2026, пакет 2, блоки 3–5; этап 1, П4–П6, поток И): запросы
 * «Хранилища», «Всех файлов», «Ждут удаления», «Проверки хранилища» и вкладки «Файлы» карточки
 * организации. Файл открывается подписанной ссылкой на 15 минут: ключей хранилища в ответах нет.
 */

export const AFILES_KEY = ['admin', 'afiles'] as const;
export const AFILES_GRID_KEY = 'afiles.all';
export const ORG_FILES_GRID_KEY = 'orgs.card.files';

const orgQuery = (org: string | undefined) => (org ? { org } : {});

/** Страница «Всех файлов»; `org` — только файлы организации (вкладка карточки). */
export const fetchStorageFiles =
  (org?: string): FetchListPage<AdminStorageFile> =>
  async (params) => {
    const res = await api.api.admin.files.$get({ query: { ...params, ...orgQuery(org) } });
    if (!res.ok) throw await apiFailure(res);
    return AdminStorageFileList.parse(await res.json());
  };

export const fetchStorageFileValues = (org?: string) => async (col: string, q?: string) => {
  const res = await api.api.admin.files.values.$get({
    query: { col, ...(q ? { q } : {}), ...orgQuery(org) },
  });
  if (!res.ok) throw await apiFailure(res);
  return ListValues.parse(await res.json());
};

export const sendStorageFilesExport = (org: string | undefined, query: Record<string, string>) =>
  api.api.admin.files.export.$get({
    query: { ...(query as { cols: string }), ...orgQuery(org) },
  });

export const storageSummaryQuery = queryOptions({
  queryKey: [...AFILES_KEY, 'summary'],
  queryFn: async () => {
    const res = await api.api.admin.files.summary.$get();
    if (!res.ok) throw await apiFailure(res);
    return AdminStorageSummary.parse(await res.json());
  },
  staleTime: 0,
});

export const storageCheckQuery = queryOptions({
  queryKey: [...AFILES_KEY, 'check'],
  queryFn: async () => {
    const res = await api.api.admin.files.check.$get();
    if (!res.ok) throw await apiFailure(res);
    return AdminStorageCheck.parse(await res.json());
  },
  staleTime: 0,
});

export const trashQuery = (org?: string) =>
  queryOptions({
    queryKey: [...AFILES_KEY, 'trash', org ?? null],
    queryFn: async () => {
      const res = await api.api.admin.files.trash.$get({ query: orgQuery(org) });
      if (!res.ok) throw await apiFailure(res);
      return AdminTrashList.parse(await res.json());
    },
    staleTime: 0,
  });

export const orgFilesQuery = (id: string) =>
  queryOptions({
    queryKey: [...AFILES_KEY, 'org', id],
    queryFn: async () => {
      const res = await api.api.admin.organizations[':id'].files.$get({ param: { id } });
      if (!res.ok) throw await apiFailure(res);
      return AdminOrgFiles.parse(await res.json());
    },
    staleTime: 0,
  });

type FileRef = Pick<AdminStorageFile, 'kind' | 'id'>;

/**
 * Байты файла для окна просмотра — подписанная ссылка вложением (`download=1`): окно разбирает любой
 * файл само, браузер его не открывает.
 */
export async function storageFileViewSrc(f: FileRef): Promise<string> {
  const res = await api.api.admin.files[':kind'][':id'].link.$get({
    param: { kind: f.kind, id: f.id },
    query: { download: '1' },
  });
  if (!res.ok) throw await apiFailure(res);
  return FileLink.parse(await res.json()).url;
}

/** «Скачать»: метод сам переходит на подписанную ссылку-вложение. */
export const storageFileDownloadHref = (f: FileRef) =>
  `/api/admin/files/${encodeURIComponent(f.kind)}/${encodeURIComponent(f.id)}/download`;

export const restoreTrash = (id: string) =>
  api.api.admin.files.trash[':id'].restore.$post({ param: { id } });

export const deleteExtra = (id: number) =>
  api.api.admin.files.check[':id'].delete.$post({ param: { id: String(id) } });

/** После «Вернуть» и «Удалить» лишнего: плашки, списки, «Ждут удаления», сверка, карточка организации. */
export function useStorageRefresh() {
  const client = useQueryClient();
  return useCallback(
    () =>
      Promise.all([
        client.invalidateQueries({ queryKey: AFILES_KEY }),
        client.invalidateQueries({ queryKey: ['list', AFILES_GRID_KEY] }),
        client.invalidateQueries({ queryKey: ['list', ORG_FILES_GRID_KEY] }),
      ]),
    [client],
  );
}
