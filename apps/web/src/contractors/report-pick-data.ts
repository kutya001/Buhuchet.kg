'use client';

import type { PickDict, PickSubject } from '@buhuchet/domain';
import { ReportPickContext, type ReportPickRequest } from '@buhuchet/shared';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { api, apiFailure } from '../api-client';
import type { Catalog } from '../dicts/dicts-data';

/*
 * Данные окон «Подбор отчётов» и «Льготы и особые статусы» (задача 2.07): контрагент или черновик
 * формы с сервера, справочники для подбора — из каталога «Справочников» и ответа сервера. Наборы окно
 * считает тем же `reportPick` из `@buhuchet/domain`, что и сервер при «Применить».
 */

/**
 * Контрагент или черновик формы для окна. Пока перечитывается (сменили основание в шапке или поле
 * формы), окно показывает прежний ответ.
 */
export const reportPickQuery = (req: ReportPickRequest) =>
  queryOptions({
    queryKey: ['contractors', 'report-pick', req],
    queryFn: async () => {
      const res = await api.api.contractors['report-pick'].$post({ json: req });
      if (!res.ok) throw await apiFailure(res);
      return ReportPickContext.parse(await res.json());
    },
    placeholderData: keepPreviousData,
  });

/** Справочники для подбора: весь каталог видов, льготы и основания каталога, ставки ЕН и ГКЭД сервера. */
export function pickDictOf(catalog: Catalog, ctx: ReportPickContext): PickDict {
  return {
    types: catalog.all,
    benefits: catalog.benefits,
    bases: catalog.bases,
    rates: ctx.rates,
    index: new Map(ctx.gkedIndex.map((n) => [n.code, n])),
  };
}

/** Контрагент для подбора с основаниями окна (их меняют в шапке, не дожидаясь ответа сервера). */
export const pickSubjectOf = (
  ctx: ReportPickContext,
  bases: readonly string[],
  benefits: readonly string[] = ctx.subject.benefits,
): PickSubject => ({ ...ctx.subject, benefits, bases, connected: ctx.connected });
