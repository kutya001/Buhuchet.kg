'use client';

import { pluralForm } from '@buhuchet/domain';
import type { KbArticleItem } from '@buhuchet/shared';
import { Box, Icon, inputClass, linkButtonClass, Note, pillClass, Tag } from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { Fragment, useState, type ReactNode } from 'react';
import { useT } from '../l10n/provider';
import { isModuleId, MODULES } from '../shell/modules';
import { kbArticlesQuery } from './kb-data';
import { useKb } from './kb-provider';

/** Отрывок без поиска — первые 150 знаков. */
const SNIPPET = 150;

/**
 * Отрывок статьи под названием (прототип renderKB → arts, `snip`): без поиска — начало текста, с
 * поиском — найденное слово с соседним текстом, слово выделено.
 */
export function snippet(text: string, q: string): ReactNode {
  if (!q) return text.length > SNIPPET ? `${text.slice(0, SNIPPET)}…` : text;
  const k = text.toLowerCase().indexOf(q);
  if (k < 0) return text.slice(0, SNIPPET);
  const start = Math.max(0, k - 60);
  return (
    <>
      {start ? '…' : ''}
      {text.slice(start, k)}
      <mark className="rounded-[3px] bg-warn-bg text-inherit">{text.slice(k, k + q.length)}</mark>
      {text.slice(k + q.length, k + q.length + 90)}…
    </>
  );
}

/**
 * «База знаний» → «Статьи» (прототип modules/kb.js, renderKB → arts): статьи, видные пользователю, по
 * разделам; поиск по названию и тексту; прочитанные — с отметкой «Прочитано»; статья открывается в
 * окне.
 */
export function KbArticlesTab() {
  const t = useT();
  const kb = useKb();
  const query = useQuery(kbArticlesQuery);
  const [search, setSearch] = useState('');
  if (query.isError) return <Note tone="bad">{t('kb.load_error')}</Note>;
  if (!query.data) return null;
  const q = search.trim().toLowerCase();
  const found = q
    ? query.data.filter((a) => `${a.title} ${a.text}`.toLowerCase().includes(q))
    : query.data;
  const sections = [...new Set(found.map((a) => a.section))];
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
              placeholder={t('kb.arts.search')}
              aria-label={t('kb.arts.search')}
              className={`${inputClass({ full: false })} min-w-0 flex-1`}
            />
          </span>
          <span className="text-muted">
            {t(`kb.arts.count.${pluralForm(found.length)}`, { n: found.length })}
          </span>
        </div>
      </Box>
      {sections.length ? (
        sections.map((section) => (
          <Box key={section} title={section}>
            <div className="flex flex-col gap-1.5">
              {found
                .filter((a) => a.section === section)
                .map((a) => (
                  <ArticleRow
                    key={a.id}
                    article={a}
                    q={q}
                    onOpen={() => kb.openArticle({ id: a.id })}
                  />
                ))}
            </div>
          </Box>
        ))
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line-strong bg-pane-alt px-4 py-[42px] text-center text-muted">
          <Icon name="search" size="lg" className="text-faint" />
          <b className="text-[15px] text-ink">{t('kb.arts.nothing')}</b>
          <span>{t('kb.arts.nothing_text')}</span>
          <button type="button" className={linkButtonClass()} onClick={() => setSearch('')}>
            {t('kb.arts.reset')}
          </button>
        </div>
      )}
    </div>
  );
}

function ArticleRow({
  article: a,
  q,
  onOpen,
}: {
  article: KbArticleItem;
  q: string;
  onOpen: () => void;
}) {
  const t = useT();
  const module = a.module && isModuleId(a.module) ? t(MODULES[a.module].title) : null;
  return (
    <button
      type="button"
      data-kb-art={a.id}
      onClick={onOpen}
      className="flex cursor-pointer flex-col items-start gap-[3px] rounded-lg border border-line bg-pane px-3 py-2.5 text-left text-ink hover:bg-row-hover focus-visible:outline-2 focus-visible:outline-brand-blue"
    >
      <b>
        {a.title}
        {a.read ? (
          <Fragment>
            {' '}
            <span className={`${pillClass('sm')} bg-ok-bg text-ok`}>
              <Icon name="ok" size="sm" />
              {t('kb.arts.read_pill')}
            </span>
          </Fragment>
        ) : null}
      </b>
      <span className="text-[11.5px] leading-[1.4] text-faint">{snippet(a.text, q)}</span>
      {module ? <Tag>{module}</Tag> : null}
    </button>
  );
}
