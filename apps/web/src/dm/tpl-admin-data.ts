import {
  DmAdminTemplateCard,
  DmAdminTemplateList,
  DmTemplateCheckResult,
  DmTemplateEditorForm,
  ListValues,
  type DmAdminTemplateRow,
  type DmTemplateCheckInput,
  type DmTemplateCreate,
  type DmTemplateSave,
  type DmTemplateStateInput,
} from '@buhuchet/shared';
import { queryOptions } from '@tanstack/react-query';
import { api, apiFailure, callApi } from '../api-client';
import type { FetchListPage } from '../lists/use-list-page';

/**
 * Админка → «Витрина данных» → «Шаблоны» (доработки 20.11.2026: Витрина данных, блок 2, пункты 2–7;
 * блок 3, пункт 1; общий план 20.11, этап 2, П3 и П7): запросы списка, окна шаблона, «Проверить»,
 * сохранения, «Копировать», «Отключить» и «Включить». Методы — `/api/admin/dm/templates…` (тред
 * сборки, только администратор платформы).
 */
const tpl = () => api.api.admin.dm.templates;

/** Ключ списка (`GRID_KEYS`, прототип grid `dm-tpl`). */
export const DM_TPL_GRID = 'dm.tpl';

export const fetchTemplates: FetchListPage<DmAdminTemplateRow> = async (params) => {
  const res = await tpl().$get({ query: params });
  if (!res.ok) throw await apiFailure(res);
  return DmAdminTemplateList.parse(await res.json());
};

export const fetchTemplateValues = async (col: string, q?: string) => {
  const res = await tpl().values.$get({ query: q ? { col, q } : { col } });
  if (!res.ok) throw await apiFailure(res);
  return ListValues.parse(await res.json());
};

export const exportTemplates = (query: Record<string, string> & { cols: string }) =>
  tpl().export.$get({ query });

/** Организации окна (доступ «Выбранные» и «Проверить на организации»): демо — первой. */
export const templateFormQuery = queryOptions({
  queryKey: ['dm', 'admin', 'tpl-form'],
  queryFn: async () => {
    const res = await tpl().form.$get();
    if (!res.ok) throw await apiFailure(res);
    return DmTemplateEditorForm.parse(await res.json());
  },
});

/** Окно шаблона: всё, включая текст запроса и историю (свежее при каждом открытии). */
export const templateCardQuery = (id: string) =>
  queryOptions({
    queryKey: ['dm', 'admin', 'tpl-card', id],
    queryFn: async () => {
      const res = await tpl()[':id'].$get({ param: { id } });
      if (!res.ok) throw await apiFailure(res);
      return DmAdminTemplateCard.parse(await res.json());
    },
    staleTime: 0,
  });

export const checkTemplate = (body: DmTemplateCheckInput) =>
  callApi(() => tpl().check.$post({ json: body }));

/** Ответ «Проверить» (схема — общая с сервером). */
export const checkResultOf = (data: unknown) => DmTemplateCheckResult.safeParse(data);

export const createTemplate = (body: DmTemplateCreate) =>
  callApi(() => tpl().$post({ json: body }));

export const saveTemplate = (id: string, body: DmTemplateSave) =>
  callApi(() => tpl()[':id'].$put({ param: { id }, json: body }));

export const copyTemplate = (id: string) =>
  callApi(() => tpl()[':id'].copy.$post({ param: { id } }));

export const setTemplateState = (id: string, body: DmTemplateStateInput) =>
  callApi(() => tpl()[':id'].state.$post({ param: { id }, json: body }));

/** Ответ сохранения, копии и смены состояния — окно шаблона. */
export const templateCardOf = (data: unknown) => DmAdminTemplateCard.safeParse(data);

/**
 * Готовые шаблоны платформы для «Заготовок» консоли (этап 2, П8; прототип `DM_TPL.filter(src ===
 * 'system')`): весь список шаблонов одной страницей, по названию; на экране — только готовые.
 */
export const systemTemplatesQuery = queryOptions({
  queryKey: ['dm', 'admin', 'tpl-system'],
  queryFn: async () => {
    const res = await tpl().$get({ query: { size: 'all', sort: 'name.asc' } });
    if (!res.ok) throw await apiFailure(res);
    return DmAdminTemplateList.parse(await res.json()).items.filter((x) => x.builtin);
  },
});
