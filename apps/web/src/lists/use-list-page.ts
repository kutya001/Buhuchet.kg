'use client';

import type { GridKey, GridViewSettings, ListSort } from '@buhuchet/domain';
import { listQueryParams, type ListQuery } from '@buhuchet/shared';
import { effectiveSort, pageSizeOf, type GridPage } from '@buhuchet/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

/** Страница списка с сервера по параметрам запроса (`sort`, `page`, `size`, `filters`). */
export type FetchListPage<Row> = (params: Record<string, string>) => Promise<GridPage<Row>>;

/**
 * Страница списка с сервера (ТЗ «Страницы»: сортировка, страницы и фильтры — на сервере, в браузер
 * приходит только текущая страница). Сортировка и записей на странице — из настроек вида; номер
 * страницы живёт на экране и не сохраняется. Пока грузится следующая страница, видна прежняя. Сервер
 * вернул другую страницу (за концом списка — последняя) — номер на экране тот же, что у сервера.
 */
export function useListPage<Row>({
  gridKey,
  keys,
  settings,
  defaultSort,
  enabled,
  fetchPage,
}: {
  gridKey: GridKey;
  /** Ключи столбцов: сортировка по столбцу, которого больше нет, — по умолчанию. */
  keys: readonly string[];
  settings: GridViewSettings;
  defaultSort: ListSort | null;
  /** Ждать настроек вида: первый запрос сразу с сохранённой сортировкой и размером страницы. */
  enabled: boolean;
  fetchPage: FetchListPage<Row>;
}) {
  const [page, setPage] = useState(1);
  const query: ListQuery = {
    sort: effectiveSort(settings, defaultSort, keys),
    page,
    size: pageSizeOf(settings),
    filters: {},
  };
  const params = listQueryParams(query);
  const result = useQuery({
    queryKey: ['list', gridKey, params],
    queryFn: () => fetchPage(params),
    placeholderData: keepPreviousData,
    enabled,
  });

  // Сервер вернул другую страницу (за концом списка — последняя): номер на экране — как у сервера.
  const served = result.isPlaceholderData ? undefined : result.data?.page;
  if (served !== undefined && served !== page) setPage(served);

  return {
    data: result.data,
    error: result.isError,
    retry: () => void result.refetch(),
    setPage,
  };
}
