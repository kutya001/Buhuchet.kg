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
import { buttonClass, Icon, inputClass, Modal, Note, type IconName } from '@buhuchet/ui';
import { useState, type ReactNode } from 'react';
import { fileSizeText } from '../files/files-data';
import { useT } from '../l10n/provider';
import { PageList } from './page-parts';

/*
 * Раздел «Файлы» открытой страницы контрагента (решение заказчика 06.11.2026; прототип v74
 * modules/cp-page.js — `pubFiles`, `pubFq`, `pubFileOpen`, стили css/pages.css `.pub-fpl`, `.pub-frow`,
 * `.pub-fv`): плашки-категории с числом файлов (только непустые), поиск по названию, строки от новых к
 * старым. Картинка и PDF открываются в окне просмотра со «Скачать», остальное сразу скачивается. Файл
 * отдаёт сервер по ссылке страницы — только в браузере, где страница открыта по коду.
 */

/** Значок по типу файла (прототип `pubFIc`). */
function fileIcon(name: string): IconName {
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
type ViewFile = Pick<PageFile, 'id' | 'name' | 'preview'>;

/** Окно просмотра (прототип `pubFileOpen`): картинка или страницы PDF, «Закрыть» и «Скачать». */
function FileViewer({
  file,
  sub,
  href,
  open,
  onClose,
}: {
  file: ViewFile;
  sub: string;
  href: string;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const [failed, setFailed] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={file.name}
      sub={sub}
      size="mid"
      kind="card"
      footer={
        <>
          <button type="button" className={buttonClass('default')} onClick={onClose}>
            {t('pub.files.close')}
          </button>
          <div className="flex-1" />
          <a
            data-pub-fdl=""
            href={`${href}?download=1`}
            className={buttonClass('cta')}
            rel="noopener noreferrer"
          >
            <Icon name="download" size="sm" />
            {t('pub.files.download')}
          </a>
        </>
      }
    >
      <div data-pub-fv={file.preview ?? ''} aria-label={t('pub.files.viewer')} role="region">
        {failed ? (
          <Note tone="bad">{t('pub.files.view_error')}</Note>
        ) : file.preview === 'image' ? (
          <div className="grid place-items-center">
            {/* Картинка — по ссылке страницы: сервер переводит на подписанную ссылку на 5 минут. */}
            <img
              src={href}
              alt={file.name}
              referrerPolicy="no-referrer"
              onError={() => setFailed(true)}
              className="max-h-[60vh] max-w-full rounded-[10px] object-contain"
            />
          </div>
        ) : (
          <div className="flex flex-col items-end gap-1.5">
            <iframe
              src={href}
              title={file.name}
              referrerPolicy="no-referrer"
              className="h-[60vh] w-full rounded-[10px] border border-line bg-raised"
            />
            {/* Браузер телефона PDF во фрейме часто не показывает — открыть его отдельно. */}
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[13px] break-words text-link"
            >
              {t('files.window.open_tab')}
            </a>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Открыть файл страницы: картинку и PDF — в окне просмотра (подзаголовок `sub`), остальное — скачать. */
export type OpenPageFile = (file: ViewFile, sub: string) => void;

/**
 * Окно просмотра файлов страницы — одно на страницу: его открывают и раздел «Файлы», и файлы периодов
 * «Отчётов» (прототип v74 `pubFileOpen`, `[data-pub-file]`). Остальные файлы сервер отдаёт вложением.
 */
export function usePageFileViewer(fileHref: (id: string) => string): {
  openFile: OpenPageFile;
  viewer: ReactNode;
} {
  const [state, setState] = useState<{
    file: ViewFile;
    sub: string;
    n: number;
    open: boolean;
  } | null>(null);
  const openFile: OpenPageFile = (file, sub) => {
    if (file.preview) setState((v) => ({ file, sub, n: (v?.n ?? 0) + 1, open: true }));
    else globalThis.location.assign(fileHref(file.id));
  };
  return {
    openFile,
    viewer: state ? (
      <FileViewer
        key={`pub-file-${state.n}`}
        file={state.file}
        sub={state.sub}
        href={fileHref(state.file.id)}
        open={state.open}
        onClose={() => setState((v) => (v ? { ...v, open: false } : v))}
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
): { sum: string; body: ReactNode } | null {
  const t = useT();
  const [filter, setFilter] = useState<PageFileCategory | ''>('');
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);
  if (!files) return null;
  const n = files.length;
  if (!n) return { sum: '', body: <span className="text-faint">{t('pub.files.none')}</span> };

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
            {found.map((f) => (
              <button
                key={f.id}
                type="button"
                data-pub-fo={f.id}
                title={f.preview ? t('pub.files.view') : t('pub.files.download')}
                onClick={() => openFile(f, subOf(f))}
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
