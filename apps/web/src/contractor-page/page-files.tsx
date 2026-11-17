'use client';

import {
  fileExtension,
  formatDateRu,
  PAGE_FILE_CATEGORIES,
  pluralForm,
  searchText,
  type PageFileCategory,
} from '@buhuchet/domain';
import type { PageFile, PageFilesItem } from '@buhuchet/shared';
import { Icon, inputClass, type IconName } from '@buhuchet/ui';
import { useState, type ReactNode } from 'react';
import { FileViewer } from '../files/file-viewer';
import { fileSizeText } from '../files/files-data';
import { useT } from '../l10n/provider';
import { usePageHint } from './page-help-context';
import { PageList } from './page-parts';

/*
 * Раздел «Файлы» открытой страницы контрагента (решение заказчика 06.11.2026; прототип v74
 * modules/cp-page.js — `pubFiles`, `pubFq`, `pubFileOpen`, стили css/pages.css `.pub-fpl`, `.pub-frow`,
 * `.pub-fv`): плашки-категории с числом файлов (только непустые), поиск по названию, строки от новых к
 * старым. Любой файл открывается в окне просмотра со «Скачать» и «‹ ›» по найденным файлам (доработки
 * 16.11.2026, блок 5). Файл отдаёт сервер по ссылке страницы — только в браузере, где страница открыта
 * по коду.
 */

/** Значок по типу файла (прототип `pubFIc`). */
export function fileIcon(name: string): IconName {
  const ext = (fileExtension(name) ?? '').toUpperCase();
  if (/^(JPE?G|PNG|WEBP|GIF|HEIC|BMP)$/.test(ext)) return 'image';
  if (/^(XLSX?|CSV)$/.test(ext)) return 'table';
  if (/^(ZIP|RAR|7Z)$/.test(ext)) return 'folder';
  return 'file';
}

/** Плашка-фильтр категории (прототип `.plates.pub-fpl .plate`): подпись и число, без значка. */
function CategoryPlate({
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
      className={`flex min-w-[96px] flex-[0_1_auto] cursor-pointer flex-col gap-1 rounded-xl border border-line bg-raised px-3.5 pt-2.5 pb-[11px] text-left font-[inherit] text-ink transition-[transform,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue max-md:px-3 max-md:py-2 ${on ? 'shadow-btn-active' : 'hover:-translate-y-px hover:shadow-pane'}`}
    >
      <span className="text-[12.5px] font-semibold text-muted max-md:text-[11.5px]">{label}</span>
      <span className="text-[20px] leading-[1.05] font-[720] tabular-nums max-md:text-[18px]">
        {value}
      </span>
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
  } | null>(null);
  const openFile: OpenPageFile = (list, index, sub) =>
    setState((v) => ({
      files: list,
      index,
      sub: sub as (file: ViewFile) => string,
      n: (v?.n ?? 0) + 1,
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
        onClose={() => setState(null)}
      />
    ) : null,
  };
}

/**
 * Раздел «Файлы»: итог для заголовка свёрнутого раздела («24 файла») и содержимое. Без раздела
 * (`files` = null) — null; хук вызывается всегда в одном порядке.
 */
export function usePageFilesSection(
  files: readonly PageFilesItem[] | null,
  openFile: OpenPageFile,
  /** Бухгалтер принимает файлы со страницы: пустой раздел говорит и об отправленных. */
  upload = false,
): { sum: string; body: ReactNode } | null {
  const t = useT();
  const hint = usePageHint();
  const [filter, setFilter] = useState<PageFileCategory | ''>('');
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);
  if (!files) return null;
  const n = files.length;
  if (!n) {
    // Пустой раздел объясняет, что здесь появится (доработки 15.11.2026, пункт 5.5).
    const none = hint(upload ? 'emptyFiles' : 'emptyFilesView', t('pub.files.none'));
    return { sum: '', body: <span className="text-faint">{none}</span> };
  }

  const cats = PAGE_FILE_CATEGORIES.filter((k) => files.some((f) => f.category === k));
  const ff = cats.includes(filter as PageFileCategory) ? filter : '';
  const shown = files.filter((f) => !ff || f.category === ff);
  const q = searchText(query.trim());
  const found = q ? shown.filter((f) => searchText(f.name).includes(q)) : shown;
  const subOf = (f: PageFilesItem) =>
    `${t(`pub.files.cat.${f.category}`)}${f.rel ? ` · ${f.rel}` : ''}`;

  return {
    sum: t(`pub.files.count.${pluralForm(n)}`, { n }),
    body: (
      <>
        <div data-plates="" className="flex flex-wrap gap-2.5 max-md:gap-2">
          <CategoryPlate
            id=""
            label={t('pub.files.all')}
            value={n}
            on={ff === ''}
            onClick={() => setFilter('')}
          />
          {cats.map((k) => (
            <CategoryPlate
              key={k}
              id={k}
              label={t(`pub.files.cat.${k}`)}
              value={files.filter((f) => f.category === k).length}
              on={ff === k}
              onClick={() => setFilter(ff === k ? '' : k)}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
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
        </div>
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
                title={t('pub.files.view')}
                onClick={() => openFile(found, i, subOf)}
                className="flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-lg border border-line bg-raised px-3 py-[9px] text-left font-[inherit] text-inherit hover:border-info max-md:gap-2 max-md:px-2.5 max-md:py-2"
              >
                <Icon name={fileIcon(f.name)} className="flex-none text-muted" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <b className="font-semibold [overflow-wrap:anywhere]">{f.name}</b>
                  <span className="text-[12px] text-faint">{subOf(f)}</span>
                </span>
                <span className="flex flex-none flex-col items-end text-right text-[12px] whitespace-nowrap text-faint">
                  <span>{formatDateRu(f.date)}</span>
                  <span>{fileSizeText(t, f.size)}</span>
                </span>
              </button>
            ))}
          </PageList>
        ) : (
          <span className="text-faint">{t('pub.files.none_q')}</span>
        )}
      </>
    ),
  };
}
