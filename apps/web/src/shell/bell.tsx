'use client';

import { BELL_PANEL_TABS, BELL_POLL_MS, scopeOf, type BellPanelTab } from '@buhuchet/domain';
import { BellCount, BellDone, BellPage, type BellItem } from '@buhuchet/shared';
import { Bell, useToast } from '@buhuchet/ui';
import {
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useEffectEvent, useState } from 'react';
import { api, ApiFailure, apiFailure } from '../api-client';
import { openContractorCard } from '../contractors/card-store';
import { useErrorText, useT } from '../l10n/provider';
import { refreshNews } from '../news/news-data';
import { bellGoOf, bellRowView } from './bell-model';
import { useShell } from './context';

/*
 * Колокольчик в верхней панели (доработки 16.11.2026, блок 3; поток И; прототип v123
 * `ui/bell-panel.js`): число непросмотренных — при открытии страницы, раз в минуту и при возврате на
 * вкладку браузера; панель — строки вошедшего с сервера (поток Т, `/api/bell`) по 30, открыл панель —
 * все просмотрены (число гаснет и на других устройствах), нажал строку — прочитана и открыта запись.
 */

type JsonResponse = { ok: boolean; status: number; json(): Promise<unknown> };
const json = async <T,>(res: JsonResponse, parse: (v: unknown) => T) => {
  if (!res.ok) throw await apiFailure(res);
  return parse(await res.json());
};

const COUNT_KEY = ['bell', 'count'] as const;
const PAGES_KEY = ['bell', 'page'] as const;

export const bellCountQuery = queryOptions({
  queryKey: COUNT_KEY,
  queryFn: async () => json(await api.api.bell.count.$get(), (v) => BellCount.parse(v)),
  refetchInterval: BELL_POLL_MS,
  refetchOnWindowFocus: true,
  staleTime: 0,
});

const bellPageQuery = (tab: BellPanelTab) =>
  infiniteQueryOptions({
    queryKey: [...PAGES_KEY, tab],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) =>
      json(
        await api.api.bell.$get({ query: pageParam ? { tab, before: pageParam } : { tab } }),
        (v) => BellPage.parse(v),
      ),
    getNextPageParam: (last) => (last.more ? (last.items.at(-1)?.id ?? null) : null),
    staleTime: 0,
  });

type Pages = InfiniteData<BellPage, string | null>;

/** Отметить строки прочитанными во всех загруженных страницах панели. */
function markReadInCache(client: QueryClient, ids: readonly string[] | 'all') {
  client.setQueriesData<Pages>({ queryKey: PAGES_KEY }, (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((p) => ({
            ...p,
            items: p.items.map((x) =>
              ids === 'all' || ids.includes(x.id) ? { ...x, read: true } : x,
            ),
          })),
        }
      : data,
  );
}

/** «Отправленные файлы» в открытой карточке контрагента: прокрутить к блоку, когда он появится. */
function scrollToSent(tries = 30) {
  const box = [...document.querySelectorAll<HTMLElement>('[data-window] [data-cp-sent]')].at(-1);
  if (box) box.scrollIntoView({ block: 'start', behavior: 'smooth' });
  else if (tries > 0) setTimeout(() => scrollToSent(tries - 1), 100);
}

export function ShellBell() {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const router = useRouter();
  const { access, editor, employeeId } = useShell();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<BellPanelTab>('all');
  const count = useQuery(bellCountQuery);
  const all = useInfiniteQuery({ ...bellPageQuery('all'), enabled: open });
  const page = useInfiniteQuery({ ...bellPageQuery(tab), enabled: open });
  // Под кнопкой «Новости» — новости версий: во «Все» их нет (прототип v138).
  const newsPage = useInfiniteQuery({ ...bellPageQuery('news'), enabled: open && tab === 'all' });
  const unseen = count.data?.unseen ?? 0;
  const newsUnseen = count.data?.news ?? 0;

  // Открыл панель — строки просмотрены; пока она открыта, пришедшие строки — тоже (прототип bellPaint).
  const seen = useEffectEvent(() => {
    client.setQueryData<BellCount>(COUNT_KEY, { unseen: 0, news: 0 });
    void api.api.bell.seen.$post().then(
      (res) => json(res, (v) => BellDone.parse(v)),
      () => {},
    );
  });
  useEffect(() => {
    if (open && page.isSuccess) seen();
  }, [open, page.isSuccess, page.dataUpdatedAt]);
  const fresh = useEffectEvent(() => void client.invalidateQueries({ queryKey: PAGES_KEY }));
  useEffect(() => {
    if (open && unseen + newsUnseen > 0) fresh();
  }, [open, unseen, newsUnseen]);

  const onOpenChange = (next: boolean) => {
    if (next) {
      setTab('all');
      // Каждое открытие — с первой страницы и свежими строками.
      client.removeQueries({ queryKey: PAGES_KEY });
    }
    setOpen(next);
  };

  const fail = (e: unknown) =>
    toast(errorText(e instanceof ApiFailure ? e.error : { code: 'network', message: '' }), {
      bad: true,
    });

  const readAll = () => {
    markReadInCache(client, 'all');
    void api.api.bell['read-all']
      .$post()
      .then((res) => json(res, (v) => BellDone.parse(v)))
      .then(() => {
        refreshNews(client);
        toast(t('bell.read_all_done'), { icon: 'check' });
      }, fail);
  };

  const go = (item: BellItem) => {
    setOpen(false);
    markReadInCache(client, [item.id]);
    void api.api.bell[':id'].read
      .$post({ param: { id: item.id } })
      .then((res) => json(res, (v) => BellDone.parse(v)))
      .then(() => {
        if (item.open?.kind === 'news') refreshNews(client);
      })
      .catch(() => {});
    const to = bellGoOf(item.open, {
      employeeId,
      reportsAll: editor ? scopeOf(editor.subject, 'reports') === 'all' : false,
      tasks: access.feature('tasks'),
      contractors: access.can('cpView'),
    });
    if (!to) return;
    if (to.kind === 'gone') {
      toast(t('bell.gone'), { icon: 'alert' });
      return;
    }
    if (to.kind === 'href') {
      router.push(to.href);
      return;
    }
    openContractorCard({ id: to.id }, to.tab);
    if (to.sent) setTimeout(() => scrollToSent(), 60);
  };

  const items = page.data?.pages.flatMap((p) => p.items) ?? null;
  const allItems = all.data?.pages.flatMap((p) => p.items) ?? [];
  // Время строк — от момента, когда строки пришли (страница перечитывается при каждом открытии).
  const now = new Date(page.dataUpdatedAt);
  return (
    <Bell
      unseen={unseen}
      news={newsUnseen > 0}
      open={open}
      onOpenChange={onOpenChange}
      labels={{
        title: t('bell.title'),
        unseen: t('bell.unseen', { n: unseen }),
        newsDot: t('bell.news_dot'),
        showNews: t('bell.tab.news'),
        readAll: t('bell.read_all'),
        close: t('btn.close'),
        tabs: t('bell.tabs'),
        empty: t('bell.empty'),
        showAll: t('bell.show_all'),
        more: t('bell.more'),
        unread: t('bell.unread'),
        error: t('bell.load_error'),
        retry: t('grid.retry'),
      }}
      tabs={BELL_PANEL_TABS.map((x) => ({ value: x, label: t(`bell.tab.${x}`) }))}
      tab={tab}
      onTab={(x) => {
        // Как в прототипе: каждая кнопка-фильтр — снова первые 30 строк.
        client.setQueryData<Pages>([...PAGES_KEY, x], (d) =>
          d ? { pages: d.pages.slice(0, 1), pageParams: d.pageParams.slice(0, 1) } : d,
        );
        setTab(x as BellPanelTab);
      }}
      rows={items ? items.map((x) => bellRowView(t, x, now)) : page.isError ? [] : null}
      error={page.isError}
      onRetry={() => void page.refetch()}
      more={page.hasNextPage}
      loadingMore={page.isFetchingNextPage}
      onMore={() => void page.fetchNextPage()}
      // Непрочитанные могут быть и дальше загруженных 30 строк: тогда кнопка тоже доступна.
      canReadAll={
        allItems.some((x) => !x.read) ||
        (newsPage.data?.pages[0]?.items ?? []).some((x) => !x.read) ||
        (items ?? []).some((x) => !x.read) ||
        all.hasNextPage ||
        page.hasNextPage
      }
      onReadAll={readAll}
      canShowAll={tab !== 'all' && allItems.length > 0}
      canShowNews={tab === 'all' && (newsPage.data?.pages[0]?.items.length ?? 0) > 0}
      onRow={(id) => {
        const item = items?.find((x) => x.id === id);
        if (item) go(item);
      }}
    />
  );
}
