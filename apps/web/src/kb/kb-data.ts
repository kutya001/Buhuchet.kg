'use client';

import {
  KbArticle,
  KbArticleList,
  KbArticleReadResult,
  KbMarkResult,
  KbMemberProgress,
  KbState,
} from '@buhuchet/shared';
import { queryOptions } from '@tanstack/react-query';
import { api, apiFailure } from '../api-client';

/**
 * Данные «Базы знаний» через TanStack Query (задача 2.30, docs/decisions.md п. Г-2): своя программа
 * (`kbStateQuery` — вкладки «Мой уровень» и «Уроки», «Мой профиль»), статьи, уровень сотрудника.
 * Отметки шагов — методами ниже: ответ несёт программу после отметки, её кладут в `kbStateQuery`.
 */

type JsonResponse = { ok: boolean; status: number; json(): Promise<unknown> };

const json = async <T>(res: JsonResponse, parse: (v: unknown) => T) => {
  if (!res.ok) throw await apiFailure(res);
  return parse(await res.json());
};

export const KB_STATE_KEY = ['kb', 'me'] as const;

/** Своя программа обучения: уровень, уроки, следующий шаг, статьи, «Можно включить». */
export const kbStateQuery = queryOptions({
  queryKey: KB_STATE_KEY,
  queryFn: async () => json(await api.api.kb.me.$get(), (v) => KbState.parse(v)),
});

/** Статьи, видные пользователю, с текстом без разметки — для поиска и отрывка. */
export const kbArticlesQuery = queryOptions({
  queryKey: ['kb', 'articles'],
  queryFn: async () => json(await api.api.kb.articles.$get(), (v) => KbArticleList.parse(v).items),
});

/** Статья целиком: блоки и описания экранов. */
export const kbArticleQuery = (id: string) =>
  queryOptions({
    queryKey: ['kb', 'article', id],
    queryFn: async () =>
      json(await api.api.kb.articles[':id'].$get({ param: { id } }), (v) => KbArticle.parse(v)),
  });

/** Уровень знаний сотрудника: карточка сотрудника, «Прогресс по модулям». */
export const kbMemberQuery = (id: string) =>
  queryOptions({
    queryKey: ['kb', 'member', id],
    queryFn: async () =>
      json(await api.api.kb.employees[':id'].$get({ param: { id } }), (v) =>
        KbMemberProgress.parse(v),
      ),
  });

/** Сверить «Сделать» с историей своих действий: при входе (`open`) и после сохранения (`saved`). */
export async function kbSync(reason: 'open' | 'saved'): Promise<KbMarkResult> {
  return json(await api.api.kb.sync.$post({ json: { reason } }), (v) => KbMarkResult.parse(v));
}

/** 3 секунды на экране шага «Посмотреть» после «Перейти». */
export async function kbLook(id: string): Promise<KbMarkResult> {
  return json(await api.api.kb.steps[':id'].look.$post({ param: { id } }), (v) =>
    KbMarkResult.parse(v),
  );
}

/** Первое использование функции (поиск, столбцы, группировка, «В Excel», свайп). */
export async function kbHit(hit: string): Promise<KbMarkResult> {
  return json(await api.api.kb.hits[':hit'].$post({ param: { hit } }), (v) =>
    KbMarkResult.parse(v),
  );
}

/** «Пропустить» (`on`) и «Вернуть». */
export async function kbSkip(id: string, on: boolean): Promise<KbState> {
  const send = on ? api.api.kb.steps[':id'].skip.$post : api.api.kb.steps[':id'].skip.$delete;
  return json(await send({ param: { id } }), (v) => KbState.parse(v));
}

/** Статья дочитана; `stepId` — шаг, из которого её открыли. */
export async function kbRead(id: string, stepId?: string): Promise<KbArticleReadResult> {
  return json(
    await api.api.kb.articles[':id'].read.$post({
      param: { id },
      json: stepId ? { stepId } : {},
    }),
    (v) => KbArticleReadResult.parse(v),
  );
}
