import { AdminOrganizationList, DmCatalog, DmRunResult, type DmRunInput } from '@buhuchet/shared';
import { queryOptions } from '@tanstack/react-query';
import { api, apiFailure } from '../api-client';
import type { DmSide } from './tokens-data';

/*
 * «Витрина данных» → «Вывод» и «Шаблоны»: каталог и «Показать» (доработки 20.11.2026: Витрина данных,
 * блоки 3–4; методы — тред сборки, этап 2, П3–П4). У организации — `/api/dm/output` (право «Смотреть
 * витрину данных», область «Свои» считает сервер), в Админке — `/api/admin/dm/output`: шаблон «Для
 * организаций» — «глазами организации», открытие пишется в её историю.
 */

export const outCatalogQuery = (side: DmSide) =>
  queryOptions({
    queryKey: ['dm', side, 'catalog'],
    queryFn: async () => {
      const res =
        side === 'admin' ? await api.api.admin.dm.output.$get() : await api.api.dm.output.$get();
      if (!res.ok) throw await apiFailure(res);
      return DmCatalog.parse(await res.json());
    },
  });

/** Что запустить: шаблон, параметры, у Админки — организация; `n` — номер нажатия «Показать». */
export interface DmRunRequest extends DmRunInput {
  orgId: string | null;
  n: number;
}

/**
 * «Показать»: результат целиком (до 50 000 строк); повтор того же нажатия берётся из памяти. Ключ — не
 * под `['dm', side]`: его перечитывают окна токенов, а каждый запуск — строка журнала, у Админки по
 * шаблону организации — ещё и запись в её историю.
 */
export const runOutQuery = (side: DmSide, run: DmRunRequest) =>
  queryOptions({
    queryKey: ['dm-run', side, run],
    queryFn: async () => {
      const body = { code: run.code, params: run.params };
      const res =
        side === 'admin'
          ? await api.api.admin.dm.output.run.$post({
              json: run.orgId ? { ...body, orgId: run.orgId } : body,
            })
          : await api.api.dm.output.run.$post({ json: body });
      if (!res.ok) throw await apiFailure(res);
      return DmRunResult.parse(await res.json());
    },
    staleTime: Infinity,
    gcTime: 60_000,
    retry: false,
  });

/** Админка: организации для «Глазами организации» — сначала демо, затем по названию. */
export const outOrgsQuery = () =>
  queryOptions({
    queryKey: ['dm', 'admin', 'orgs'],
    queryFn: async () => {
      const res = await api.api.admin.organizations.$get({
        query: { size: 'all', sort: 'name.asc' },
      });
      if (!res.ok) throw await apiFailure(res);
      const { items } = AdminOrganizationList.parse(await res.json());
      return [...items.filter((o) => o.isDemo), ...items.filter((o) => !o.isDemo)].map((o) => ({
        id: o.id,
        name: o.name,
      }));
    },
  });

/** Что выгрузить «В Excel»: тот же запуск, что на экране (шаблон, параметры, организация). */
export interface DmExportRun {
  side: DmSide;
  code: string;
  params: Record<string, string | null>;
  orgId: string | null;
}

/** «В Excel»: сервер выполняет шаблон заново и отдаёт файл с фильтрами и столбцами таблицы. */
export const exportOut = (
  run: DmExportRun,
  list: Record<string, string> & { cols: string },
) => {
  const body = { code: run.code, params: run.params, list };
  return run.side === 'admin'
    ? api.api.admin.dm.output.export.$post({
        json: run.orgId ? { ...body, orgId: run.orgId } : body,
      })
    : api.api.dm.output.export.$post({ json: body });
};
