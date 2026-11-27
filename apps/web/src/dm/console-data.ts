import {
  DmConsoleCheck,
  DmConsoleHistory,
  DmConsolePlan,
  DmConsoleQuery,
  DmConsoleQueryList,
  DmConsoleResult,
  DmConsoleStopped,
  DmSchemaMap,
  type DmConsoleInput,
  type DmConsoleProblem,
} from '@buhuchet/shared';
import { queryOptions } from '@tanstack/react-query';
import { api, apiFailure, callApi } from '../api-client';
import { schemaIndex } from './console-assist';

/*
 * Консоль запросов «Витрины данных» Админки (доработки 27.11.2026: консоль запросов, блоки 1–5; этап 1,
 * П4–П6): запросы экрана к методам `/api/admin/dm/console/*` (этап 0 и этап 1; только администратор
 * платформы). Ответы проверяются общими схемами `@buhuchet/shared`.
 */
const con = () => api.api.admin.dm.console;

/** Карта базы для подсказок: одна на сеанс страницы (меняется только с выпуском). */
export const consoleSchemaQuery = queryOptions({
  queryKey: ['dm', 'console', 'schema'],
  queryFn: async () => {
    const res = await con().schema.$get();
    if (!res.ok) throw await apiFailure(res);
    return schemaIndex(DmSchemaMap.parse(await res.json()));
  },
  staleTime: Infinity,
});

export const consoleQueriesQuery = queryOptions({
  queryKey: ['dm', 'console', 'queries'],
  queryFn: async () => {
    const res = await con().queries.$get();
    if (!res.ok) throw await apiFailure(res);
    return DmConsoleQueryList.parse(await res.json()).items;
  },
});

export const consoleHistoryQuery = queryOptions({
  queryKey: ['dm', 'console', 'history'],
  queryFn: async () => {
    const res = await con().history.$get();
    if (!res.ok) throw await apiFailure(res);
    return DmConsoleHistory.parse(await res.json()).items;
  },
});

export const runConsole = (body: DmConsoleInput) => callApi(() => con().run.$post({ json: body }));
export const consoleResultOf = (data: unknown) => DmConsoleResult.safeParse(data);

export const explainConsole = (body: DmConsoleInput) =>
  callApi(() => con().explain.$post({ json: body }));
export const consolePlanOf = (data: unknown) => DmConsolePlan.safeParse(data);

export const stopConsole = async () => {
  const res = await callApi(() => con().stop.$post());
  return res.ok ? (DmConsoleStopped.safeParse(res.data).data?.stopped ?? 0) : 0;
};

/** «В Excel»: тот же запрос и параметры, файл — общим путём выгрузки списков. */
export const exportConsole = (body: DmConsoleInput) => con().export.$post({ json: body });

export const createConsoleQuery = (body: {
  name: string;
  query: string;
  params: Record<string, string | null>;
}) => callApi(() => con().queries.$post({ json: body }));

export const updateConsoleQuery = (
  id: string,
  body: { name: string; query: string; params: Record<string, string | null>; version: number },
) => callApi(() => con().queries[':id'].$put({ param: { id }, json: body }));

export const deleteConsoleQuery = (id: string, version: number) =>
  callApi(() =>
    con().queries[':id'].$delete({ param: { id }, query: { version: String(version) } }),
  );

export const consoleQueryOf = (data: unknown) => DmConsoleQuery.safeParse(data);

/** Проверка по ходу набора: ошибки разборщика с местом; сбой — без подчёркиваний. */
export async function checkConsole(query: string): Promise<DmConsoleProblem[]> {
  const res = await callApi(() => con().check.$post({ json: { query } }));
  if (!res.ok) return [];
  return DmConsoleCheck.safeParse(res.data).data?.problems ?? [];
}
