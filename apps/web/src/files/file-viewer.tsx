'use client';

/**
 * Окно просмотра файлов (доработки 16.11.2026, блок 5; прототип v126 `ui/file-view.js` `fileView`):
 * одно окно для «Файлового менеджера», блока «Файлы» записи, вкладки «Файлы» контрагента,
 * «Отправленных файлов» и страницы контрагента. «‹ ›» — соседние файлы того же списка (на ПК ещё
 * стрелки клавиатуры, на телефоне — жест вбок, окно во весь экран), «Скачать» — ссылкой.
 *
 * Файл скачивается по `src` (ссылка на байты: свой адрес сайта или подписанная ссылка хранилища) с
 * пределом размера; картинка и PDF показываются из байтов по типу, проверенному по содержимому; Excel,
 * Word, PowerPoint, текст и XML разбирает отдельный поток браузера (`view-worker.ts`) без сети, а окно
 * рисует готовую модель. Просмотр ничего не меняет и в историю не пишется.
 */
import {
  FILE_MAX_BYTES,
  fileExt,
  fileViewKind,
  isPdf,
  viewPictureType,
  type FileViewModel,
} from '@buhuchet/domain';
import {
  buttonClass,
  DocumentView,
  FileViewState,
  Icon,
  iconButtonClass,
  Modal,
  PdfView,
  PictureView,
  scrollsToward,
  SheetBookView,
  SlidesView,
  swipeDirection,
  TextFileView,
  XmlFileView,
  type FileViewLabels,
} from '@buhuchet/ui';
import { useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from 'react';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { fileTypeText } from './file-columns';
import { fileSizeText } from './files-data';
import type { ViewRequest, ViewResponse } from './view-protocol';

export interface ViewerFile {
  id: string;
  name: string;
  size: number;
  contentType?: string;
}

export interface FileViewerProps<F extends ViewerFile = ViewerFile> {
  files: readonly F[];
  /** С какого файла открыть. */
  index: number;
  /** Ссылка на байты файла (свой адрес сайта или подписанная ссылка хранилища). */
  src: (id: string) => string | Promise<string>;
  /** Ссылка «Скачать». */
  download: (id: string) => string;
  onClose: () => void;
  /** Окно открыто (слот окна: закрывается с анимацией); по умолчанию — да. */
  open?: boolean;
  /** Строка под названием; по умолчанию — «XLSX · 1,2 МБ». */
  sub?: (file: F) => ReactNode;
  /** Сведения под просмотром (окно файла «Файлового менеджера»). */
  info?: (file: F) => ReactNode;
  /** Свои кнопки после «Скачать»; по умолчанию — «Закрыть». */
  footer?: (file: F) => ReactNode;
}

/**
 * Файлы окна для «‹ ›»: строки списка на экране в том же порядке, если открытый файл среди них
 * (прототип v126 `fvGridRows`), иначе — он один.
 */
export function windowFiles<F extends { id: string }>(
  rows: readonly F[],
  opened: F,
): { files: readonly F[]; index: number } {
  const index = rows.findIndex((r) => r.id === opened.id);
  return index >= 0 ? { files: rows, index } : { files: [opened], index: 0 };
}

/** Что показать: загрузка, нет просмотра, ошибка, картинка или PDF по ссылке из байтов, модель. */
type Content =
  | { s: 'loading' }
  | { s: 'none' }
  | { s: 'failed'; code: string }
  | { s: 'picture'; url: string }
  | { s: 'pdf'; url: string }
  | { s: 'model'; model: FileViewModel };

/** Байтов файла для просмотра — не больше предела загрузки (20 МБ) с запасом. */
export const VIEW_FETCH_MAX = FILE_MAX_BYTES + 1024 * 1024;
/** Разбор дольше — поток закрывается, «Файл слишком сложный для просмотра». */
export const VIEW_PARSE_MS = 30_000;

class ViewLoadError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

async function fetchBytes(url: string, signal: AbortSignal): Promise<Uint8Array> {
  const res = await fetch(url, { credentials: 'same-origin', signal, cache: 'no-store' });
  if (!res.ok || !res.body) throw new ViewLoadError(`http_${res.status}`);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > VIEW_FETCH_MAX) {
      await reader.cancel().catch(() => undefined);
      throw new ViewLoadError('too_big');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

function parseInWorker(
  name: string,
  bytes: Uint8Array,
  signal: AbortSignal,
): Promise<FileViewModel> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./view-worker.ts', import.meta.url), {
      type: 'module',
      name: 'file-view',
    });
    const stop = (err?: unknown, model?: FileViewModel) => {
      clearTimeout(timer);
      worker.terminate();
      signal.removeEventListener('abort', onAbort);
      if (model) resolve(model);
      else reject(err instanceof Error ? err : new ViewLoadError(String(err)));
    };
    const onAbort = () => stop(new ViewLoadError('aborted'));
    const timer = setTimeout(() => stop(new ViewLoadError('timeout')), VIEW_PARSE_MS);
    signal.addEventListener('abort', onAbort);
    worker.onmessage = (e: MessageEvent<ViewResponse>) =>
      e.data.ok ? stop(undefined, e.data.model) : stop(new ViewLoadError(e.data.code));
    worker.onerror = () => stop(new ViewLoadError('worker'));
    // Модель не прочиталась на этой стороне (не скопировалась) — так же, как «слишком большой».
    worker.onmessageerror = () => stop(new ViewLoadError('too_big'));
    const buf = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const req: ViewRequest = { name, bytes: buf };
    worker.postMessage(req, [buf]);
  });
}

/** Содержимое файла для окна: скачивает, проверяет тип по байтам, разбирает в отдельном потоке. */
function useFileContent(
  file: ViewerFile | undefined,
  src: FileViewerProps['src'],
): [Content, () => void] {
  // Ответ — вместе с номером файла: пока он от другого файла, окно показывает «Открываем файл…».
  const [got, setGot] = useState<{ id: string; content: Content } | null>(null);
  const id = file?.id;
  const name = file?.name ?? '';
  const kind = fileViewKind(name);
  const viewable = kind !== 'none' && kind !== 'download';
  useEffect(() => {
    if (!id || !viewable) return;
    const ctl = new AbortController();
    const set = (content: Content) => {
      if (!ctl.signal.aborted) setGot({ id, content });
    };
    let url: string | null = null;
    void (async () => {
      try {
        const bytes = await fetchBytes(await src(id), ctl.signal);
        if (kind === 'image') {
          const type = viewPictureType(bytes);
          if (!type) return set({ s: 'none' });
          url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
          return set({ s: 'picture', url });
        }
        if (kind === 'pdf') {
          if (!isPdf(bytes)) return set({ s: 'none' });
          url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
          return set({ s: 'pdf', url });
        }
        set({ s: 'model', model: await parseInWorker(name, bytes, ctl.signal) });
      } catch (err) {
        set({ s: 'failed', code: err instanceof ViewLoadError ? err.code : 'file_bad' });
      }
    })();
    return () => {
      ctl.abort();
      if (url) URL.revokeObjectURL(url);
    };
    // src — новая функция при каждой отрисовке экрана; файл тот же — заново не скачиваем.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, name]);
  const content: Content = !viewable
    ? { s: 'none' }
    : got && got.id === id
      ? got.content
      : { s: 'loading' };
  const fail = () => {
    if (id) setGot({ id, content: { s: 'none' } });
  };
  return [content, fail];
}

function viewLabels(t: Translate): FileViewLabels {
  const num = (n: number) => n.toLocaleString('ru-RU');
  return {
    zoomIn: t('files.view.zoom_in'),
    zoomOut: t('files.view.zoom_out'),
    rotate: t('files.view.rotate'),
    fit: t('files.view.fit'),
    sheetSearch: t('files.view.sheet_search'),
    xmlSearch: t('files.view.xml_search'),
    found: (n) => t('files.view.found', { n }),
    notFound: t('files.view.not_found'),
    moreRows: (shown, total) => t('files.view.more_rows', { shown: num(shown), total: num(total) }),
    moreAll: t('files.view.more_all'),
    prevSlide: t('files.view.prev_slide'),
    nextSlide: t('files.view.next_slide'),
    slideOf: (n, total) => t('files.view.slide_of', { n, total }),
    encoding: (enc) => t('files.view.encoding', { enc }),
    collapseAll: t('files.view.collapse_all'),
    expandAll: t('files.view.expand_all'),
    collapse: (name) => t('files.view.collapse', { name }),
    expand: (name) => t('files.view.expand', { name }),
    doctype: t('files.view.doctype'),
    emptySheet: t('files.view.empty_sheet'),
    openTab: t('files.window.open_tab'),
  };
}

/** Коды пределов разбора (docs/deviations.md п. И-12): «Файл слишком сложный для просмотра». */
const TOO_COMPLEX = new Set([
  'too_big',
  'timeout',
  'zip_too_big',
  'zip_bomb',
  'zip_entries',
  'xml_too_big',
  'xml_too_deep',
]);

/** Текст ошибки разбора: пароль, слишком большой или сложный файл, остальное (битый) — «Не удалось открыть». */
export function failedTitle(t: Translate, code: string): string {
  if (code === 'file_encrypted') return t('files.view.encrypted');
  if (TOO_COMPLEX.has(code)) return t('files.view.too_big');
  return t('files.view.failed');
}

export function FileViewer<F extends ViewerFile>({
  files,
  index,
  src,
  download,
  onClose,
  open = true,
  sub,
  info,
  footer,
}: FileViewerProps<F>) {
  const t = useT();
  const labels = useMemo(() => viewLabels(t), [t]);
  const n = files.length;
  // Показанный файл — по номеру: список на экране перечитывается (после «Изменить файл» строка может
  // переехать при сортировке по названию), а окно остаётся на том же файле.
  const [shownId, setShownId] = useState(() => files[Math.max(0, Math.min(index, n - 1))]?.id);
  const found = files.findIndex((f) => f.id === shownId);
  const k = found >= 0 ? found : Math.max(0, Math.min(index, n - 1));
  const [slide, setSlide] = useState(0);
  const file = files[k];
  const [content, fail] = useFileContent(file, src);
  const body = useRef<HTMLDivElement | null>(null);
  const go = (d: 1 | -1) => {
    const next = files[k + d];
    if (!next) return;
    setShownId(next.id);
    setSlide(0);
  };
  const goKey = useEffectEvent((d: 1 | -1) => go(d));
  // ← и → на ПК — соседний файл, пока это окно сверху и курсор не в поле (прототип `key`).
  useEffect(() => {
    if (!open || n < 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('input,textarea,select,[contenteditable="true"]')) return;
      const wins = document.querySelectorAll('[data-window]');
      const top = wins[wins.length - 1];
      if (!top || !body.current || !top.contains(body.current)) return;
      goKey(e.key === 'ArrowLeft' ? -1 : 1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, n]);
  // Жест вбок по просмотру на телефоне: соседний слайд, потом соседний файл (прототип `touchend`).
  const touch = useRef<{ x: number; y: number; el: EventTarget | null } | null>(null);
  const slides =
    content.s === 'model' && content.model.kind === 'slides' ? content.model.slides.length : 0;
  if (!file) return null;
  const dl = download(file.id);
  const ext = fileExt(file.name).toUpperCase();
  const kind = fileViewKind(file.name);
  const dlButton = (
    <a href={dl} data-fdl="" className={buttonClass('cta')} rel="noopener noreferrer">
      <Icon name="download" size="sm" />
      {t('files.act.download')}
    </a>
  );
  const view = (): ReactNode => {
    if (kind === 'download') {
      return (
        <FileViewState
          state="old"
          title={t('files.view.old', { ext })}
          text={t('files.view.old_hint', {
            app: t(ext === 'DOC' ? 'files.view.app.doc' : 'files.view.app.ppt'),
          })}
          action={dlButton}
        />
      );
    }
    switch (content.s) {
      case 'loading':
        return <FileViewState state="loading" icon="hourglass" title={t('files.view.loading')} />;
      case 'none':
        return (
          <FileViewState
            state="none"
            title={t('files.view.none')}
            text={t('files.view.none_hint')}
            action={dlButton}
          />
        );
      case 'failed':
        return (
          <FileViewState
            state="failed"
            icon="alert"
            title={failedTitle(t, content.code)}
            text={t('files.view.none_hint')}
            action={dlButton}
          />
        );
      case 'picture':
        return <PictureView url={content.url} name={file.name} labels={labels} onFail={fail} />;
      case 'pdf':
        return <PdfView url={content.url} name={file.name} labels={labels} />;
      case 'model': {
        const m = content.model;
        if (m.kind === 'sheet') return <SheetBookView model={m} labels={labels} />;
        if (m.kind === 'doc') return <DocumentView model={m} labels={labels} />;
        if (m.kind === 'slides')
          return <SlidesView model={m} labels={labels} slide={slide} onSlide={setSlide} />;
        if (m.kind === 'text') return <TextFileView model={m} labels={labels} />;
        if (m.kind === 'xml') return <XmlFileView model={m} labels={labels} />;
        return (
          <FileViewState
            state="none"
            title={t('files.view.none')}
            text={t('files.view.none_hint')}
            action={dlButton}
          />
        );
      }
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={file.name}
      sub={
        sub
          ? sub(file)
          : t('files.window.meta', {
              ext: fileTypeText(t, file.name),
              size: fileSizeText(t, file.size),
            })
      }
      size="wide"
      kind="card"
      phoneFull
      swipeHead
      head={
        n > 1 ? (
          <div
            className="mx-1.5 flex flex-none items-center gap-1 max-md:mx-0.5 max-md:gap-0"
            data-fv-nav=""
          >
            <button
              type="button"
              data-fv-prev=""
              className={iconButtonClass()}
              aria-label={t('files.view.prev')}
              title={t('files.view.prev')}
              disabled={k <= 0}
              onClick={() => go(-1)}
            >
              <Icon name="left" />
            </button>
            <span
              className="min-w-[52px] text-center text-[12.5px] text-muted tabular-nums max-md:min-w-[40px]"
              data-fv-n=""
            >
              {t('files.view.counter', { n: k + 1, total: n })}
            </span>
            <button
              type="button"
              data-fv-next=""
              className={iconButtonClass()}
              aria-label={t('files.view.next')}
              title={t('files.view.next')}
              disabled={k >= n - 1}
              onClick={() => go(1)}
            >
              <Icon name="right" />
            </button>
          </div>
        ) : undefined
      }
      footer={
        <>
          <a
            href={dl}
            data-fv-download=""
            className={buttonClass('default')}
            rel="noopener noreferrer"
          >
            <Icon name="download" size="sm" />
            {t('files.act.download')}
          </a>
          {footer ? (
            footer(file)
          ) : (
            <>
              <div className="flex-1" />
              <button type="button" className={buttonClass('cta')} onClick={onClose}>
                {t('files.view.close')}
              </button>
            </>
          )}
        </>
      }
    >
      <div
        ref={body}
        key={file.id}
        data-file-viewer={file.id}
        className="flex min-h-full flex-col gap-3"
        onTouchStart={(e) => {
          const p = e.touches[0];
          touch.current =
            e.touches.length === 1 && p ? { x: p.clientX, y: p.clientY, el: e.target } : null;
        }}
        onTouchEnd={(e) => {
          const start = touch.current;
          touch.current = null;
          const p = e.changedTouches[0];
          if (!start || !p) return;
          const d = swipeDirection(p.clientX - start.x, p.clientY - start.y);
          if (!d) return;
          // Таблица или текст сами прокручиваются в ту сторону — это прокрутка, а не листание.
          for (
            let el = start.el as HTMLElement | null;
            el && el !== body.current;
            el = el.parentElement
          ) {
            if (el.closest('[data-no-swipe]') || scrollsToward(el, d)) return;
          }
          if (slides && slide + d >= 0 && slide + d < slides) return setSlide(slide + d);
          go(d);
        }}
      >
        {view()}
        {info ? info(file) : null}
      </div>
    </Modal>
  );
}
