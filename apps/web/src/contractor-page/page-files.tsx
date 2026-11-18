'use client';

import {
  fileExtension,
  PAGE_FILE_CATEGORIES,
  pageDateWords,
  pluralForm,
  searchText,
  type PageFileCategory,
} from '@buhuchet/domain';
import type { PageFile, PageFilesItem, PageSent } from '@buhuchet/shared';
import { Icon, inputClass, type IconName } from '@buhuchet/ui';
import { useState, type ReactNode } from 'react';
import { FileViewer } from '../files/file-viewer';
import { PageSentList } from '../files/page-sent';
import { useT } from '../l10n/provider';
import { usePageHint } from './page-help-context';
import { PageList } from './page-parts';

/*
 * Раздел «Файлы» открытой страницы контрагента (решение заказчика 06.11.2026; прототип v135
 * modules/cp-page.js — `pubFiles`, `pubFq`, `pubFileOpen`, стили css/pages.css `.pub-chip`, `.pub-frow`):
 * вкладки «От бухгалтера» и «От вас», чипы-категории с числом файлов (только непустые), поиск по
 * названию — когда файлов больше 10, строки от новых к старым с датой словами. Любой файл открывается в
 * окне просмотра со «Скачать» и «‹ ›» по найденным файлам (доработки 16.11.2026, блок 5). Файл отдаёт
 * сервер по ссылке страницы — только в браузере, где страница открыта по коду.
 */

/** Значок по типу файла (прототип `pubFIc`). */
export function fileIcon(name: string): IconName {
  const ext = (fileExtension(name) ?? '').toUpperCase();
  if (/^(JPE?G|PNG|WEBP|GIF|HEIC|BMP)$/.test(ext)) return 'image';
  if (/^(XLSX?|CSV)$/.test(ext)) return 'table';
  if (/^(ZIP|RAR|7Z)$/.test(ext)) return 'folder';
  return 'file';
}

/** Чип-фильтр категории (прототип v135 `.pub-chip`): подпись и число. */
function CategoryChip({
  id,
  label,
  value,
  on,
  onClick,
}: {
  id: string;
  label: string;
  value: number;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-pub-ff={id}
      aria-pressed={on}
      onClick={onClick}
      className={`inline-flex min-h-8 cursor-pointer items-center gap-[5px] rounded-full border px-3 py-1 font-[inherit] text-[13px] text-ink transition-colors max-md:min-h-10 ${on ? 'border-accent bg-sel' : 'border-line bg-raised hover:border-line-strong'}`}
    >
      {label} <b className="font-[650] text-muted">{value}</b>
    </button>
  );
}

/** Файл, который страница открывает: из раздела «Файлы» или у периода «Отчётов». */
type ViewFile = Pick<PageFile, 'id' | 'name' | 'size'>;

/**
 * Открыть файл страницы в окне просмотра: `list` — файлы того же списка в порядке экрана («‹ ›» листают
 * по ним), `index` — открытый, `sub` — подзаголовок окна для файла списка.
 */
export type OpenPageFile = <F extends ViewFile>(
  list: readonly F[],
  index: number,
  sub: (file: F) => string,
) => void;

/**
 * Окно просмотра файлов страницы — одно на страницу: его открывают и раздел «Файлы», и файлы периодов
 * «Отчётов» (прототип v126 `pubFileOpen` → `fileView`). Любой файл открывается в окне (доработки
 * 16.11.2026, блок 5): окно читает его по ссылке страницы с `view=1` (вложением, отказ — 404, а не
 * переход на страницу), «Скачать» — та же ссылка с `download=1`.
 */
export function usePageFileViewer(fileHref: (id: string) => string): {
  openFile: OpenPageFile;
  viewer: ReactNode;
} {
  const [state, setState] = useState<{
    files: readonly ViewFile[];
    index: number;
    sub: (file: ViewFile) => string;
    n: number;
    /** `false` — окно закрывается с анимацией (слот окна, `src/dialog-slot.ts`). */
    open: boolean;
  } | null>(null);
  const openFile: OpenPageFile = (list, index, sub) =>
    setState((v) => ({
      files: list,
      index,
      sub: sub as (file: ViewFile) => string,
      n: (v?.n ?? 0) + 1,
      open: true,
    }));
  return {
    openFile,
    viewer: state ? (
      <FileViewer
        key={`pub-file-${state.n}`}
        files={state.files}
        index={state.index}
        src={(id) => `${fileHref(id)}?view=1`}
        download={(id) => `${fileHref(id)}?download=1`}
        sub={(f) => state.sub(state.files.find((x) => x.id === f.id) ?? f)}
        open={state.open}
        onClose={() => setState((v) => v && { ...v, open: false })}
      />
    ) : null,
  };
}

/** Вкладка «Файлов»: от бухгалтера или от вас. */
export type FilesTab = 'acc' | 'you';

/**
 * Раздел «Файлы» (прототип v135 `pubBody`, `has('files')`): итог для заголовка («24 файла» — вместе с
 * отправленными), вкладки «От бухгалтера» и «От вас» (когда клиент что-то отправлял или может
 * отправить), у файлов бухгалтера — чипы категорий (когда их больше одной) и поиск (когда файлов больше
 * 10). Без раздела (`files` = null) — null; хук вызывается всегда в одном порядке.
 */
export function usePageFilesSection(
  files: readonly PageFilesItem[] | null,
  sent: PageSent | null,
  today: string,
  openFile: OpenPageFile,
  tab: FilesTab | null,
  setTab: (tab: FilesTab) => void,
): { sum: string; body: ReactNode } | null {
  const t = useT();
  const hint = usePageHint();
  const [filter, setFilter] = useState<PageFileCategory | ''>('');
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);
  if (!files) return null;
  const n = files.length;
  const sentN = sent?.items.length ?? 0;
  const upload = !!sent?.upload;
  const current: FilesTab = tab === 'you' || (!n && sentN) ? 'you' : 'acc';
  const total = n + sentN;

  const cats = PAGE_FILE_CATEGORIES.filter((k) => files.some((f) => f.category === k));
  const ff = cats.includes(filter as PageFileCategory) ? filter : '';
  const shown = files.filter((f) => !ff || f.category === ff);
  const q = n > 10 ? searchText(query.trim()) : '';
  const found = q ? shown.filter((f) => searchText(f.name).includes(q)) : shown;
  const subOf = (f: PageFilesItem) =>
    `${t(`pub.files.cat.${f.category}`)}${f.rel ? ` · ${f.rel}` : ''}`;

  const tabs =
    sentN || upload ? (
      <div
        role="tablist"
        aria-label={t('pub.files.tabs')}
        className="inline-flex gap-0.5 self-start rounded-lg bg-pane-alt p-0.5"
      >
        {(
          [
            ['acc', t('pub.files.tab.acc'), n],
            ['you', t('pub.files.tab.you'), sentN],
          ] as const
        ).map(([k, label, count]) => (
          <button
            key={k}
            type="button"
            role="tab"
            data-pub-ft={k}
            aria-selected={current === k}
            onClick={() => setTab(k)}
            className={`min-h-8 cursor-pointer rounded-md border-0 px-3 py-1 font-[inherit] text-[13px] font-semibold max-md:min-h-10 ${current === k ? 'bg-raised text-ink shadow-btn' : 'bg-transparent text-muted hover:text-ink'}`}
          >
            {label}
            {count ? ` · ${count}` : ''}
          </button>
        ))}
      </div>
    ) : null;

  const fromAccountant = n ? (
    <>
      {cats.length > 1 ? (
        <div className="flex flex-wrap gap-1.5">
          <CategoryChip
            id=""
            label={t('pub.files.all')}
            value={n}
            on={ff === ''}
            onClick={() => setFilter('')}
          />
          {cats.map((k) => (
            <CategoryChip
              key={k}
              id={k}
              label={t(`pub.files.cat.${k}`)}
              value={files.filter((f) => f.category === k).length}
              on={ff === k}
              onClick={() => setFilter(ff === k ? '' : k)}
            />
          ))}
        </div>
      ) : null}
      {n > 10 ? (
        <input
          type="search"
          data-pub-fq=""
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('pub.files.search')}
          aria-label={t('pub.files.search_label')}
          autoComplete="off"
          className={`${inputClass({ full: false })} w-full max-w-[320px] max-md:max-w-none`}
        />
      ) : null}
      {found.length ? (
        <PageList
          count={found.length}
          // При поиске список показывается целиком (прототип `pubFq`).
          all={all || !!q}
          onAll={() => setAll(true)}
          more={t('pub.more', { n: found.length - 5 })}
        >
          {found.map((f, i) => (
            <button
              key={f.id}
              type="button"
              data-pub-fo={f.id}
              data-no-gloss=""
              title={t('pub.files.view')}
              onClick={() => openFile(found, i, subOf)}
              className="flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-lg border border-line bg-raised px-3 py-[9px] text-left font-[inherit] text-inherit hover:border-line-strong max-md:gap-2 max-md:px-2.5 max-md:py-2"
            >
              <Icon name={fileIcon(f.name)} className="flex-none text-muted" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <b className="font-semibold [overflow-wrap:anywhere]">{f.name}</b>
                <span className="text-[12px] text-faint">{subOf(f)}</span>
              </span>
              <span className="flex-none text-right text-[12px] whitespace-nowrap text-faint">
                {pageDateWords(f.date, today)}
              </span>
            </button>
          ))}
        </PageList>
      ) : (
        <span className="text-faint">{t('pub.files.none_q')}</span>
      )}
    </>
  ) : (
    // Пустой раздел объясняет, что здесь появится (доработки 15.11.2026, пункт 5.5).
    <span data-pub-files-none="" className="text-faint">
      {hint(upload ? 'emptyFiles' : 'emptyFilesView', t('pub.files.none'))}
    </span>
  );

  return {
    sum: total ? t(`pub.files.count.${pluralForm(total)}`, { n: total }) : '',
    body: (
      <>
        {tabs}
        <div key={current} className="flex animate-fade flex-col gap-2.5">
          {current === 'you' ? <PageSentList sent={sent} today={today} /> : fromAccountant}
        </div>
      </>
    ),
  };
}
