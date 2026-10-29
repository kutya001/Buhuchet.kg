'use client';

import {
  AdminNewsList,
  AdminNewsRecord,
  ListValues,
  NewsAdminHistory,
  NewsFeed,
  NewsReadResult,
  NewsUnread,
  WhatsNew,
  type AdminNews,
  type NewsItem,
} from '@buhuchet/shared';
import type { ShellCount } from '@buhuchet/ui';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { api, apiFailure } from '../api-client';
import type { FetchListPage } from '../lists/use-list-page';

/**
 * Данные «Новостей» через TanStack Query (задача 2.32, docs/decisions.md п. Г-3): лента вкладки
 * «Новости», число непрочитанных (у модуля «База знаний», у вкладки и точка у «Меню»), окно «Что
 * нового» и правка новостей в Админке. Отметки «прочитана» отвечают числом непрочитанных — его кладут в
 * `newsUnreadQuery`, а в ленте новости отмечаются сразу.
 */

type JsonResponse = { ok: boolean; status: number; json(): Promise<unknown> };

const json = async <T>(res: JsonResponse, parse: (v: unknown) => T) => {
  if (!res.ok) throw await apiFailure(res);
  return parse(await res.json());
};

const FEED_KEY = ['news', 'feed'] as const;
const UNREAD_KEY = ['news', 'unread'] as const;

/** Лента: опубликованные новости с наступившей датой, от новых к старым. */
export const newsFeedQuery = queryOptions({
  queryKey: FEED_KEY,
  queryFn: async () => json(await api.api.news.$get(), (v) => NewsFeed.parse(v).items),
});

/** Сколько новостей не прочитано. */
export const newsUnreadQuery = queryOptions({
  queryKey: UNREAD_KEY,
  queryFn: async () => json(await api.api.news.unread.$get(), (v) => NewsUnread.parse(v).unread),
});

/** Окно «Что нового»: непрочитанные новости «Показывать при входе». */
export async function fetchWhatsNew(): Promise<WhatsNew> {
  return json(await api.api.news['whats-new'].$get(), (v) => WhatsNew.parse(v));
}

/** Новости прочитаны: в ленте — без «Новое», число непрочитанных — из ответа. */
function markedRead(client: QueryClient, ids: readonly string[] | 'all', unread: number) {
  client.setQueryData(UNREAD_KEY, unread);
  client.setQueryData<NewsItem[]>(FEED_KEY, (items) =>
    items?.map((n) => (ids === 'all' || ids.includes(n.id) ? { ...n, read: true } : n)),
  );
}

/** Открыта новость или показаны новости в «Что нового». */
export async function markNewsRead(client: QueryClient, ids: readonly string[]): Promise<void> {
  if (!ids.length) return;
  const result = await json(await api.api.news.read.$post({ json: { ids: [...ids] } }), (v) =>
    NewsReadResult.parse(v),
  );
  markedRead(client, ids, result.unread);
}

/** «Отметить все прочитанными». */
export async function markAllNewsRead(client: QueryClient): Promise<void> {
  const result = await json(await api.api.news['read-all'].$post(), (v) => NewsReadResult.parse(v));
  markedRead(client, 'all', result.unread);
}

/** Лента и число непрочитанных изменились (новость опубликована, исправлена, снята). */
export function refreshNews(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: ['news'] });
}

/* Админка → «База знаний (содержимое)» → «Новости» */

export const ADMIN_NEWS_GRID = 'kbadm.news';

/** Новость целиком — для окна «Новость» и «Предпросмотра». */
export const adminNewsQuery = (id: string) =>
  queryOptions({
    queryKey: ['admin-news', id],
    queryFn: async () =>
      json(await api.api.admin.news[':id'].$get({ param: { id } }), (v) =>
        AdminNewsRecord.parse(v),
      ),
    staleTime: 0,
  });

export const fetchAdminNews: FetchListPage<AdminNews> = async (params) =>
  json(await api.api.admin.news.$get({ query: params }), (v) => AdminNewsList.parse(v));

/** Значения столбца для фильтра-галочек; `q` — «Найти значение». */
export const fetchAdminNewsValues = async (col: string, q?: string) =>
  json(await api.api.admin.news.values.$get({ query: q ? { col, q } : { col } }), (v) =>
    ListValues.parse(v),
  );

/** Черновики новостей — число у вкладки «Новости» в Админке (прототип kbAdmTabs); нет — без числа. */
export const newsDraftsCountQuery = queryOptions({
  queryKey: ['list', ADMIN_NEWS_GRID, 'drafts'],
  queryFn: async (): Promise<Partial<Record<string, ShellCount>>> => {
    const values = await fetchAdminNewsValues('status');
    const drafts = values.items.find((v) => v.value === 'draft')?.count ?? 0;
    return drafts ? { news: { value: drafts } } : {};
  },
});

/** «История изменений · N» под списком; ключ — внутри списка, поэтому обновляется вместе с ним. */
export const newsHistoryQuery = queryOptions({
  queryKey: ['list', ADMIN_NEWS_GRID, 'history'],
  queryFn: async () =>
    json(await api.api.admin.news.history.$get(), (v) => NewsAdminHistory.parse(v)),
});
