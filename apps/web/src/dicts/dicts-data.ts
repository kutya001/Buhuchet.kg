'use client';

import type { TaxPickCatalog } from '@buhuchet/domain';
import {
  Authorities,
  OrgReportTypeSettings,
  ReportBases,
  ReportTypes,
  TaxBenefits,
  Taxes,
  TaxRegimes,
  type ReportType,
  type TaxBenefit,
} from '@buhuchet/shared';
import { queryOptions, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api, apiFailure } from '../api-client';

/**
 * Данные модуля «Справочники» через TanStack Query: каталог видов отчётов платформы с органами,
 * режимами, основаниями и льготами (для формы просмотра вида и окна «Выбор налогов»), «Налоги и ставки»
 * и настройки организации по видам. После сохранения — `useDictsRefresh`.
 */

type JsonResponse = { ok: boolean; status: number; json(): Promise<unknown> };

const json = async <T>(res: JsonResponse, parse: (v: unknown) => T) => {
  if (!res.ok) throw await apiFailure(res);
  return parse(await res.json());
};

/** Каталог видов отчётов и справочники, которыми он описан; названия — по кодам. */
export interface Catalog {
  /** Действующие виды отчётов в порядке каталога. */
  types: readonly ReportType[];
  type: (code: string) => ReportType | undefined;
  /** Орган — название по коду. */
  authority: (code: string) => string;
  /** Режим — краткое название по коду. */
  regime: (code: string) => string;
  /** Основание — название по коду. */
  base: (code: string) => string;
  benefits: readonly TaxBenefit[];
  /** Для «Выбора налогов»: режимы и орган — названиями. */
  pick: TaxPickCatalog;
}

const nameBy = (items: readonly { code: string; name: string }[]) => {
  const map = new Map(items.map((x) => [x.code, x.name]));
  return (code: string) => map.get(code) ?? code;
};

/**
 * Каталог видов отчётов платформы — справочники меняет только администратор платформы, поэтому за
 * сеанс страницы он читается один раз (после правки в Админке — при следующем открытии).
 */
export const catalogQuery = queryOptions({
  queryKey: ['dicts', 'catalog'],
  queryFn: async (): Promise<Catalog> => {
    const [types, authorities, regimes, bases, benefits] = await Promise.all([
      api.api['report-types'].$get({ query: {} }).then((r) => json(r, (v) => ReportTypes.parse(v))),
      api.api.authorities.$get({ query: {} }).then((r) => json(r, (v) => Authorities.parse(v))),
      api.api['tax-regimes'].$get({ query: {} }).then((r) => json(r, (v) => TaxRegimes.parse(v))),
      api.api['report-bases'].$get({ query: {} }).then((r) => json(r, (v) => ReportBases.parse(v))),
      api.api['tax-benefits'].$get({ query: {} }).then((r) => json(r, (v) => TaxBenefits.parse(v))),
    ]);
    const byCode = new Map(types.items.map((x) => [x.code, x]));
    const authority = nameBy(authorities.items);
    const regime = nameBy(regimes.items);
    const fullNames = new Map(regimes.items.map((r) => [r.name, r.fullName]));
    return {
      types: types.items,
      type: (code) => byCode.get(code),
      authority,
      regime,
      base: nameBy(bases.items),
      benefits: benefits.items,
      pick: {
        types: types.items.map((x) => ({
          code: x.code,
          kind: x.kind,
          pickGroup: x.pickGroup,
          regimes: x.regimes.map(regime),
          bases: x.bases,
          authority: authority(x.authorityCode),
          preselect: x.preselect,
        })),
        bases: bases.items.map((b) => ({ code: b.code, name: b.name })),
        benefitAdds: new Set(benefits.items.flatMap((b) => b.adds)),
        regimeFullName: (name) => fullNames.get(name),
      },
    };
  },
  staleTime: Infinity,
});

/** «Налоги и ставки» — блоки «Налог» в форме просмотра вида отчёта. */
export const taxesQuery = queryOptions({
  queryKey: ['dicts', 'taxes'],
  queryFn: async () => json(await api.api.taxes.$get({ query: {} }), (v) => Taxes.parse(v)),
  staleTime: Infinity,
});

/** Настройки организации по всем видам (подключённые и отключённые) и дни по умолчанию из учётной политики. */
export const typeSettingsQuery = queryOptions({
  queryKey: ['dicts', 'settings'],
  queryFn: async () =>
    json(await api.api['org-report-types'].settings.$get(), (v) => OrgReportTypeSettings.parse(v)),
});

/** После подключения или правки вида: перечитать список «Виды отчётов» и настройки организации. */
export function useDictsRefresh() {
  const client = useQueryClient();
  return useCallback(() => {
    void client.invalidateQueries({ queryKey: ['list', 'dicts.types'] });
    void client.invalidateQueries({ queryKey: typeSettingsQuery.queryKey });
  }, [client]);
}
