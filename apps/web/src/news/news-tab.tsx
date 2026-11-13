'use client';

import { NEWS_TYPES, newsMatches, newsVersions, pluralForm } from '@buhuchet/domain';
import type { NewsItem } from '@buhuchet/shared';
import { Box, EmptyState, Icon, inputClass, linkButtonClass, Note, useToast } from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ApiFailure } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import { markAllNewsRead, markNewsRead, newsFeedQuery, newsUnreadQuery } from './news-data';
import { NewsRow } from './news-provider';

/**
 * «База знаний» → «Новости» (прототип v98 modules/kb-news.js, renderNews; решение заказчика
 * 13.11.2026): лента строками-заголовками строго по номеру версии, новые сверху (порядок отдаёт
 * сервер); закреплённые — отдельным блоком над лентой. Подробности раскрываются по нажатию на строку,
 * при каждом входе во вкладку сами раскрыты только у самой новой. Раскрытая новость прочитана; у
 * раскрытой самой «Новое» видно до ухода со вкладки. Поиск по тексту, фильтры «Тип» и «Версия»,
 * «Отметить все прочитанными».
 */
export function KbNewsTab() {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const feed = useQuery(newsFeedQuery);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [version, setVersion] = useState('');
  // Что нажато: раскрыто или свёрнуто; не нажатая — раскрыта только самая новая на момент входа.
  const [toggled, setToggled] = useState<Readonly<Record<string, boolean>>>({});
  const [top, setTop] = useState<{ id: string; unread: boolean } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  // Самая новая — по свежей ленте: пока лента из прошлого входа обновляется, ждём ответа.
  const newest = feed.isFetching ? undefined : feed.data?.[0];
  if (newest && !top) setTop({ id: newest.id, unread: !newest.read });

  // Число непрочитанных у модуля и вкладки — по свежей ленте.
  useEffect(() => {
    if (feed.data) {
      client.setQueryData(newsUnreadQuery.queryKey, feed.data.filter((n) => !n.read).length);
    }
  }, [feed.data, client]);

  // Самая новая раскрыта сама — значит, прочитана (как показанная в «Что нового»). Не из соседней
  // вкладки, которую оболочка рисует под пальцем при листании на телефоне (`inert`): пользователь
  // во вкладку ещё не вошёл.
  useEffect(() => {
    if (!top?.unread || !root.current || root.current.closest('[inert]')) return;
    void markNewsRead(client, [top.id]).catch(() => {});
  }, [top, client]);

  if (feed.isError) return <Note tone="bad">{t('news.load_error')}</Note>;
  if (!feed.data) return null;
  const all = feed.data;
  const unread = all.filter((n) => !n.read).length;
  const list = all.filter(
    (n) =>
      (!type || n.type === type) && (!version || n.release === version) && newsMatches(n, search),
  );
  const versions = newsVersions(all.map((n) => ({ version: n.release })));
  const pinned = list.filter((n) => n.pinned);
  const rest = list.filter((n) => !n.pinned);
  const reset = () => {
    setSearch('');
    setType('');
    setVersion('');
  };
  const readAll = () => {
    setTop((was) => was && { ...was, unread: false });
    void markAllNewsRead(client).catch((e: unknown) =>
      toast(errorText(e instanceof ApiFailure ? e.error : { code: 'network', message: '' }), {
        bad: true,
      }),
    );
  };
  const row = (n: NewsItem) => {
    const shown = toggled[n.id] ?? n.id === top?.id;
    return (
      <NewsRow
        key={n.id}
        item={n}
        open={shown}
        fresh={!n.read || (n.id === top?.id && top.unread)}
        onToggle={() => {
          setToggled((was) => ({ ...was, [n.id]: !shown }));
          if (!shown && !n.read) void markNewsRead(client, [n.id]).catch(() => {});
        }}
      />
    );
  };

  return (
    <div ref={root} className="flex flex-col gap-3.5">
      <Box>
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="flex min-w-[220px] flex-1 items-center gap-2">
            <Icon name="search" size="sm" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('news.search')}
              aria-label={t('news.search')}
              className={`${inputClass({ full: false })} min-w-0 flex-1`}
            />
          </span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            aria-label={t('news.filter.type')}
            className={`${inputClass({ full: false })} min-w-[150px] flex-none cursor-pointer`}
          >
            <option value="">{t('news.filter.type_all')}</option>
            {NEWS_TYPES.map((x) => (
              <option key={x} value={x}>
                {t(`news.type.${x}`)}
              </option>
            ))}
          </select>
          <select
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            aria-label={t('news.filter.version')}
            className={`${inputClass({ full: false })} min-w-[150px] flex-none cursor-pointer`}
          >
            <option value="">{t('news.filter.version_all')}</option>
            {versions.map((v) => (
              <option key={v} value={v}>
                {t('news.filter.version_item', { v })}
              </option>
            ))}
          </select>
          <span data-news-count="" className="text-muted">
            {t(`news.count.${pluralForm(list.length)}`, { n: list.length })}
            {all.length ? ` · ${t('news.unread', { n: unread })}` : ''}
          </span>
          {unread ? (
            <button type="button" onClick={readAll} className={linkButtonClass()}>
              {t('news.read_all')}
            </button>
          ) : null}
        </div>
      </Box>
      {!list.length ? (
        <EmptyState
          icon="bell"
          title={t(all.length ? 'news.not_found' : 'news.empty')}
          text={all.length ? undefined : t('news.empty_hint')}
        >
          {all.length ? (
            <button type="button" onClick={reset} className={linkButtonClass()}>
              {t('news.reset')}
            </button>
          ) : null}
        </EmptyState>
      ) : null}
      {pinned.length ? (
        <Box title={t('news.pinned')}>
          <div className="flex flex-col gap-1.5">{pinned.map(row)}</div>
        </Box>
      ) : null}
      {rest.length ? (
        <Box>
          <div data-news-list="" className="flex flex-col gap-1.5">
            {rest.map(row)}
          </div>
        </Box>
      ) : null}
    </div>
  );
}
