'use client';

import type { KbAdminList, KbHistorySection } from '@buhuchet/domain';
import {
  AdminKbArticle,
  AdminKbHistory,
  AdminKbLevels,
  AdminKbMeta,
  AdminKbRowList,
  AdminKbStep,
  ListValues,
  type AdminKbRow,
} from '@buhuchet/shared';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { api, apiFailure } from '../api-client';
import type { FetchListPage } from '../lists/use-list-page';

/*
 * Данные Админки → «База знаний (содержимое)» (задача 2.39, docs/decisions.md п. Д-11): списки «Шагов
 * уроков» и «Статей», окна шага и статьи, «Уровни», «История изменений». Всё под ключом `kbadm`:
 * после записи обновляется вкладка целиком, а программа обучения самого администратора — `kb`.
 */

export const kb = api.api.admin.kb;

type JsonResponse = { ok: boolean; status: number; json(): Promise<unknown> };

const json = async <T>(res: JsonResponse, parse: (v: unknown) => T) => {
  if (!res.ok) throw await apiFailure(res);
  return parse(await res.json());
};

export const KBADM_GRID = { steps: 'kbadm.steps', arts: 'kbadm.arts' } as const;

export const fetchKbAdminRows =
  (list: KbAdminList): FetchListPage<AdminKbRow> =>
  async (params) =>
    json(await kb.list[':list'].$get({ param: { list }, query: params }), (v) =>
      AdminKbRowList.parse(v),
    );

export const fetchKbAdminValues = (list: KbAdminList) => async (col: string, q?: string) =>
  json(
    await kb.list[':list'].values.$get({ param: { list }, query: q ? { col, q } : { col } }),
    (v) => ListValues.parse(v),
  );

/** Модули программы, статьи, права, сценарии показов — для окон. */
export const kbAdminMetaQuery = queryOptions({
  queryKey: ['kbadm', 'meta'],
  queryFn: async () => json(await kb.meta.$get(), (v) => AdminKbMeta.parse(v)),
});

export const kbAdminStepQuery = (id: string) =>
  queryOptions({
    queryKey: ['kbadm', 'step', id],
    queryFn: async () =>
      json(await kb.steps[':id'].$get({ param: { id } }), (v) => AdminKbStep.parse(v)),
    staleTime: 0,
  });

export const kbAdminArticleQuery = (id: string) =>
  queryOptions({
    queryKey: ['kbadm', 'art', id],
    queryFn: async () =>
      json(await kb.arts[':id'].$get({ param: { id } }), (v) => AdminKbArticle.parse(v)),
    staleTime: 0,
  });

export const kbAdminLevelsQuery = queryOptions({
  queryKey: ['kbadm', 'levels'],
  queryFn: async () => json(await kb.levels.$get(), (v) => AdminKbLevels.parse(v)),
});

export const kbAdminHistoryQuery = (section: KbHistorySection) =>
  queryOptions({
    queryKey: ['kbadm', 'history', section],
    queryFn: async () =>
      json(await kb.history[':section'].$get({ param: { section } }), (v) =>
        AdminKbHistory.parse(v),
      ),
  });

/** После записи: списки, окна, история вкладок и своя программа обучения (шаги, уровни). */
export function refreshKbAdmin(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: ['kbadm'] });
  void client.invalidateQueries({ queryKey: ['list', KBADM_GRID.steps] });
  void client.invalidateQueries({ queryKey: ['list', KBADM_GRID.arts] });
  void client.invalidateQueries({ queryKey: ['kb'] });
}
