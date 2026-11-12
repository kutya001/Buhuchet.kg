import {
  AdminApiMethodCard,
  AdminApiMethodList,
  AdminApiSchemaFields,
  AdminTechDocsMeta,
  ListValues,
  type AdminApiMethod,
} from '@buhuchet/shared';
import { queryOptions } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { api, apiFailure } from '../api-client';
import type { FetchListPage } from '../lists/use-list-page';
import { schemaHash } from './techdocs-model';

/*
 * Данные «Технической документации» (прототип admin/techdocs.js): описание собрано при сборке сайта и
 * до следующей выкладки не меняется, поэтому ответы живут в кэше страницы без перечитывания.
 */
const KEY = ['admin', 'tech-docs'] as const;
const FOREVER = { staleTime: Infinity, retry: false } as const;

/** По какой версии продукта собрано описание и таблицы для фильтра «Таблица». */
export const techDocsMetaQuery = queryOptions({
  queryKey: [...KEY, 'meta'],
  queryFn: async () => {
    const res = await api.api.admin['tech-docs'].$get();
    if (!res.ok) throw await apiFailure(res);
    return AdminTechDocsMeta.parse(await res.json());
  },
  ...FOREVER,
});

export const apiMethodCardQuery = (id: string) =>
  queryOptions({
    queryKey: [...KEY, 'method', id],
    queryFn: async () => {
      const res = await api.api.admin['tech-docs'].method.$get({ query: { id } });
      if (!res.ok) throw await apiFailure(res);
      return AdminApiMethodCard.parse(await res.json());
    },
    ...FOREVER,
  });

export const apiSchemaFieldsQuery = (name: string) =>
  queryOptions({
    queryKey: [...KEY, 'zod', name],
    queryFn: async () => {
      const res = await api.api.admin['tech-docs'].zod.$get({ query: { name } });
      if (!res.ok) throw await apiFailure(res);
      return AdminApiSchemaFields.parse(await res.json());
    },
    ...FOREVER,
  });

export const fetchApiMethods: FetchListPage<AdminApiMethod> = async (params) => {
  const res = await api.api.admin['tech-docs'].methods.$get({ query: params });
  if (!res.ok) throw await apiFailure(res);
  return AdminApiMethodList.parse(await res.json());
};

/** Значения столбца для фильтра-галочек — среди методов выбранной таблицы. */
export const fetchApiMethodValues = (table: string) => async (col: string, q?: string) => {
  const res = await api.api.admin['tech-docs'].methods.values.$get({
    query: { col, ...(q ? { q } : {}), ...(table ? { table } : {}) },
  });
  if (!res.ok) throw await apiFailure(res);
  return ListValues.parse(await res.json());
};

/** Адрес страницы схемы для рамки: тема программы и место, на котором страницу оставили. */
export const schemaPageSrc = (theme: string, hash: string) =>
  `/api/admin/tech-docs/schema-page?theme=${encodeURIComponent(theme)}${hash}`;

/*
 * Общее у двух вкладок (прототип TDOC): место страницы схемы — вкладка «Схема базы» открывается там,
 * где её оставили, и переходы из «API» («Показать на схеме», таблица, функция базы) ведут туда же;
 * выбранная таблица фильтра «API». Живёт, пока открыта страница.
 */
interface TechDocsState {
  hash: string;
  table: string;
}
let state: TechDocsState = { hash: schemaHash.start, table: '' };
const listeners = new Set<() => void>();
/** Рамка схемы на экране: ей можно сразу отправить переход. */
let frameGo: ((hash: string) => void) | null = null;

function update(next: Partial<TechDocsState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export const techDocsStore = {
  get: () => state,
  /** Страница схемы сообщила свой адрес. */
  setHash: (hash: string) => {
    if (hash !== state.hash) update({ hash });
  },
  setTable: (table: string) => update({ table }),
  /** Перейти на странице схемы: рамка на экране — сразу, иначе — при её открытии. */
  go: (hash: string) => {
    update({ hash });
    frameGo?.(hash);
  },
  /** Рамка появилась на экране; ответ — снять её (если её не сменила другая). */
  bindFrame: (go: (hash: string) => void) => {
    frameGo = go;
    return () => {
      if (frameGo === go) frameGo = null;
    };
  },
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export function useTechDocsState(): TechDocsState {
  return useSyncExternalStore(subscribe, techDocsStore.get, techDocsStore.get);
}
