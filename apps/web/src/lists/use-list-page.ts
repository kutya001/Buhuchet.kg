'use client';

import type {
  GridKey,
  GridViewSettings,
  ListColumnType,
  ListFilterValue,
  ListSort,
} from '@buhuchet/domain';
import { listQueryParams, type ListQuery } from '@buhuchet/shared';
import {
  activeBoardKey,
  AUDIT_COLUMNS,
  effectiveGroup,
  effectiveSort,
  groupAggs,
  pageSizeOf,
  PHONE_QUERY,
  screenVisibleKeys,
  useMediaQuery,
  type BoardChoice,
  type GridPage,
} from '@buhuchet/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { ApiFailure } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import { limitFailureText } from './limit-text';

/** Страница списка с сервера по параметрам запроса (`sort`, `page`, `size`, `filters`, `q` …). */
export type FetchListPage<Row> = (params: Record<string, string>) => Promise<GridPage<Row>>;

/** Поиск уходит на сервер через столько после последней буквы. */
export const SEARCH_DELAY_MS = 300;

type Filters = Record<string, ListFilterValue>;

/**
 * Страница списка с сервера (ТЗ «Страницы», «Поиск и фильтры», «Группировка»: сортировка, страницы,
 * поиск, фильтры и группы — на сервере, в браузер приходит только текущая страница). Сортировка,
 * записей на странице и группировка — из настроек вида; фильтры и номер страницы живут на экране и не
 * сохраняются (после сохранения записи они не сбрасываются). Поиск — по видимым столбцам, через
 * 300 мс после последней буквы. Новые поиск, фильтры или группировка — снова первая страница. Пока
 * грузится следующая страница, видна прежняя. Сервер вернул другую страницу (за концом списка —
 * последняя) — номер на экране тот же, что у сервера. Вид «Доска» (`kanban`) — тот же запрос, что
 * группировка по столбцу доски: сервер считает столбцы доски, число записей и суммы.
 */
export function useListPage<Row>({
  gridKey,
  columns,
  audit = true,
  defaultVisible,
  settings,
  defaultSort,
  search = '',
  enabled,
  fetchPage,
  extra,
  initialFilters,
  kanban,
  searchAlso,
}: {
  gridKey: GridKey;
  /**
   * Столбцы модуля (ключ, тип, «только для ПК»): сортировка по столбцу, которого больше нет, — по
   * умолчанию; поиск — по столбцам, видимым на этом экране.
   */
  columns: readonly { key: string; type: ListColumnType; desktopOnly?: boolean }[];
  /** У списка есть служебные столбцы «Создал… Изменено» (проп `audit` у `DataGrid`) — их ключи добавятся сами. */
  audit?: boolean;
  defaultVisible: readonly string[];
  settings: GridViewSettings;
  defaultSort: ListSort | null;
  /** Общий поиск из верхней панели. */
  search?: string;
  /** Ждать настроек вида: первый запрос сразу с сохранённой сортировкой и размером страницы. */
  enabled: boolean;
  fetchPage: FetchListPage<Row>;
  /**
   * Свои параметры списка, кроме общих (период «За период» у «Показателей»): уходят в запрос и в
   * выгрузку; их смена — снова первая страница.
   */
  extra?: Readonly<Record<string, string>>;
  /** Фильтры, с которыми список открыт (плашка «Главной», `usePresetFilters`): первый запрос — сразу с ними. */
  initialFilters?: Readonly<Filters>;
  /** Доска списка (тот же проп `kanban` у `DataGrid`): в виде «Доска» записи приходят по её столбцам. */
  kanban?: BoardChoice;
  /**
   * Столбцы, по которым поиск идёт и тогда, когда они скрыты: значение видно на экране иначе —
   * заголовком группы (контрагент во вкладке «По месяцам» отчётов).
   */
  searchAlso?: readonly string[];
}) {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Filters>(() => ({ ...initialFilters }));
  const q = useDebounced(search.trim(), SEARCH_DELAY_MS);
  const phone = useMediaQuery(PHONE_QUERY);
  const all = audit ? [...columns, ...AUDIT_COLUMNS] : columns;
  const keys = all.map((c) => c.key);
  const visible = screenVisibleKeys(all, settings, defaultVisible, phone);
  // Доска — один уровень групп по её столбцу; суммы — у видимых числовых столбцов, без «Не считать».
  const board = activeBoardKey(kanban, keys, settings, phone);
  const group = board !== null ? [board] : effectiveGroup(keys, settings);

  // Поиск, фильтры или группировка сменились — список с первой страницы (прототип `s.page = 0`).
  const scope = JSON.stringify([q, filters, group, extra ?? null]);
  const [shownScope, setShownScope] = useState(scope);
  let current = page;
  if (shownScope !== scope) {
    setShownScope(scope);
    if (page !== 1) setPage(1);
    current = 1;
  }

  const query: ListQuery = {
    sort: effectiveSort(settings, defaultSort, keys),
    page: current,
    size: pageSizeOf(settings),
    filters,
    ...(q
      ? {
          search: {
            q,
            keys: searchAlso ? [...new Set([...visible, ...searchAlso])] : visible,
          },
        }
      : {}),
    ...(group.length
      ? { group, agg: groupAggs(all, visible, board !== null ? {} : settings) }
      : {}),
  };
  const params = { ...listQueryParams(query), ...extra };

  const result = useQuery({
    queryKey: ['list', gridKey, params],
    queryFn: () => fetchPage(params),
    placeholderData: keepPreviousData,
    enabled,
  });
  const t = useT();
  const errorText = useErrorText();
  const failureText = useCallback(
    (error: unknown) =>
      limitFailureText(error instanceof ApiFailure ? error.error : null, t, errorText),
    [t, errorText],
  );

  // Сервер вернул другую страницу (за концом списка — последняя): номер на экране — как у сервера.
  const served = result.isPlaceholderData ? undefined : result.data?.page;
  if (served !== undefined && served !== current) setPage(served);

  return {
    data: result.data,
    error: result.isError,
    /**
     * Причина ошибки — предел сервера («Запрос выполнялся слишком долго…», `limitFailureText`); null —
     * другая ошибка или обрыв связи: экран просит проверить подключение, как прототип.
     */
    errorText: failureText(result.error),
    /** То же правило для значений фильтра-галочек (`errorTextOf` у `DataGrid`). */
    errorTextOf: failureText,
    retry: () => void result.refetch(),
    setPage,
    filters,
    setFilters,
    /** Параметры запроса — для выгрузки в Excel тех же записей (страница выгрузке не нужна). */
    params,
    /** Видимые столбцы по порядку экрана — столбцы файла Excel. */
    visible,
  };
}

/** Значение, которое меняется не чаще, чем через `delay` мс после последней правки. */
export function useDebounced<T>(value: T, delay: number): T {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setShown(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return shown;
}
