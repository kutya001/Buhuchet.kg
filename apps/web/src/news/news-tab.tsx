'use client';

import {
  formatDateRu,
  NEWS_TYPES,
  newsGroups,
  newsMatches,
  newsShortText,
  newsVersions,
  pluralForm,
} from '@buhuchet/domain';
import type { NewsItem } from '@buhuchet/shared';
import {
  Box,
  EmptyState,
  Icon,
  inputClass,
  linkButtonClass,
  Note,
  Tag,
  useToast,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ApiFailure } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import { markAllNewsRead, newsFeedQuery, newsUnreadQuery } from './news-data';
import { NewsFreshPill, newsMeta, NewsTypePill } from './news-parts';
import { useNews } from './news-provider';

/** В строке ленты — первые 170 знаков краткого описания (прототип renderNews). */
const SHORT = 170;

/**
 * «База знаний» → «Новости» (ТЗ; прототип modules/kb-news.js, renderNews): лента от новых к старым,
 * закреплённые — над лентой, остальные по версиям («Версия 1.4 — 20.10.2026», без версии —
 * «Объявления»); поиск по тексту, фильтры «Тип» и «Версия»; непрочитанные — с отметкой «Новое» и
 * синей чертой; «Отметить все прочитанными». Новость открывается в окне и становится прочитанной.
 */
export function KbNewsTab() {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const news = useNews();
  const client = useQueryClient();
  const feed = useQuery(newsFeedQuery);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [version, setVersion] = useState('');

  // Число непрочитанных у модуля и вкладки — по свежей ленте.
  useEffect(() => {
    if (feed.data) {
      client.setQueryData(newsUnreadQuery.queryKey, feed.data.filter((n) => !n.read).length);
    }
  }, [feed.data, client]);

  if (feed.isError) return <Note tone="bad">{t('news.load_error')}</Note>;
  if (!feed.data) return null;
  const all = feed.data;
  const unread = all.filter((n) => !n.read).length;
  const list = all.filter(
    (n) =>
      (!type || n.type === type) && (!version || n.release === version) && newsMatches(n, search),
  );
  const versions = newsVersions(all.map((n) => ({ version: n.release })));
  const { pinned, groups } = newsGroups(list.map((n) => ({ ...n, version: n.release })));
  const reset = () => {
    setSearch('');
    setType('');
    setVersion('');
  };
  const readAll = () =>
    void markAllNewsRead(client).catch((e: unknown) =>
      toast(errorText(e instanceof ApiFailure ? e.error : { code: 'network', message: '' }), {
        bad: true,
      }),
    );
  const row = (n: NewsItem) => <NewsRow key={n.id} item={n} onOpen={() => news.open(n)} />;

  return (
    <div className="flex flex-col gap-3.5">
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
      {groups.map((g) => (
        <Box
          key={g.version ?? ''}
          title={
            g.version
              ? t('news.group.version', { v: g.version, date: formatDateRu(g.date) })
              : t('news.group.announce')
          }
        >
          <div className="flex flex-col gap-1.5">{g.items.map(row)}</div>
        </Box>
      ))}
    </div>
  );
}

function NewsRow({ item: n, onOpen }: { item: NewsItem; onOpen: () => void }) {
  const t = useT();
  const short = newsShortText(n);
  return (
    <button
      type="button"
      data-news={n.id}
      data-unread={n.read ? undefined : ''}
      onClick={onOpen}
      className={`flex cursor-pointer flex-col items-start gap-[3px] rounded-lg border bg-pane px-3 py-2.5 text-left text-ink hover:bg-row-hover focus-visible:outline-2 focus-visible:outline-brand-blue ${n.read ? 'border-line' : 'border-brand-blue shadow-[inset_3px_0_0_var(--bu-blue)]'}`}
    >
      <span className="flex flex-wrap items-center gap-2">
        <NewsTypePill type={n.type} t={t} />
        <span className="text-muted">{newsMeta(t, { ...n, editedAt: null })}</span>
        {n.read ? null : <NewsFreshPill t={t} />}
        {n.pinned ? <Tag icon="star">{t('news.pinned')}</Tag> : null}
      </span>
      <b>{n.title}</b>
      <span className="text-[11.5px] leading-[1.4] text-faint">
        {short.length > SHORT ? `${short.slice(0, SHORT)}…` : short}
      </span>
    </button>
  );
}
