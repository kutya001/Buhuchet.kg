import { queryOptions } from '@tanstack/react-query';
import type { DmOutTemplate, DmParamValues, DmRunAnswer } from './out-model';
import type { DmSide } from './tokens-data';

/*
 * «Витрина данных» → «Вывод» и «Шаблоны»: запросы каталога и запуска шаблона (доработки 20.11.2026:
 * Витрина данных, блоки 3–4). Методы каталога и запуска (право «Смотреть витрину данных», область
 * «Свои контрагенты», «глазами организации» с записью в её историю) делает тред сборки (этап 2,
 * П3–П4); до их контракта каталог пуст и запуск не зовётся — экран показывает «Шаблонов пока нет».
 */

/** Каталог стороны: шаблоны, которые видит вошедший, и что ему можно в каталоге. */
export interface DmOutCatalog {
  templates: DmOutTemplate[];
  /** «Выпустить токен» в каталоге: право «Управлять API-токенами» и не демо-организация. */
  tokens: boolean;
  /** Админка: организации для «Глазами организации» (первой — демо). */
  orgs: { id: string; name: string }[];
}

/** Что запустить: шаблон, заданные параметры и у Админки — организация для шаблона организаций. */
export interface DmRunRequest {
  templateId: string;
  params: DmParamValues;
  orgId: string | null;
}

const EMPTY: DmOutCatalog = { templates: [], tokens: false, orgs: [] };

export const outCatalogQuery = (side: DmSide) =>
  queryOptions({
    queryKey: ['dm', side, 'catalog'],
    queryFn: (): Promise<DmOutCatalog> => Promise.resolve(EMPTY),
  });

/** Запуск шаблона: ответ исполнителя целиком (до 50 000 строк). */
export const runOutQuery = (side: DmSide, run: DmRunRequest & { n: number }) =>
  queryOptions({
    queryKey: ['dm', side, 'run', run],
    queryFn: (): Promise<DmRunAnswer> => Promise.reject(new Error('dm: run is not connected yet')),
    staleTime: Infinity,
    gcTime: 60_000,
    retry: false,
  });
