'use client';

/**
 * Содержимое окна просмотра файлов (доработки 16.11.2026, блок 5; прототип v126 `ui/file-view.js`,
 * `css/file-view.css`): лист Excel, документ Word, слайды, текст, XML, картинка и PDF. Компоненты
 * только рисуют готовую модель (её разобрал отдельный поток браузера): HTML из файла не вставляется,
 * ссылки — только текстом, картинки — из байтов файла по проверенному типу (без SVG).
 */
import {
  colLetters,
  type DocBlock,
  type DocRun,
  type FileViewModel,
  type SheetCell,
  type SheetView,
  type SlideItem,
  type SlidesView,
  type TextView,
  type ViewImage,
  type XmlView,
  type XmlViewNode,
} from '@buhuchet/domain';
import {
  Fragment,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { buttonClass, iconButtonClass } from '../button';
import { Icon } from '../icon';
import type { IconName } from '../icons';
import {
  cellKey,
  chunkOfLongWord,
  FILE_FONT,
  hitsByRow,
  mergeMap,
  rotateNext,
  segmentStarts,
  sheetCellText,
  sheetHits,
  sheetStepEnd,
  SHEET_WRAP_MAX_PX,
  textChunks,
  TEXT_CHUNK,
  TEXT_SEGMENT,
  xmlBranches,
  xmlClosed,
  xmlDepth,
  xmlHits,
  XML_OPEN_DEPTH,
  zoomNext,
  type MergeMap,
  type XmlPath,
} from './file-view-model';

export interface FileViewLabels {
  zoomIn: string;
  zoomOut: string;
  rotate: string;
  fit: string;
  sheetSearch: string;
  xmlSearch: string;
  found: (n: number) => string;
  notFound: string;
  /** «Показаны первые 5 000 строк из 50 000 — скачайте файл, чтобы увидеть всё». */
  moreRows: (shown: number, total: number) => string;
  /** Документ, слайды или XML показаны не целиком. */
  moreAll: string;
  prevSlide: string;
  nextSlide: string;
  slideOf: (n: number, total: number) => string;
  encoding: (name: string) => string;
  collapseAll: string;
  expandAll: string;
  collapse: (name: string) => string;
  expand: (name: string) => string;
  /** В XML было объявление DOCTYPE: оно пропущено, внешнее не загружалось. */
  doctype: string;
  emptySheet: string;
  openTab: string;
}

const BAR =
  'flex flex-none flex-wrap items-center gap-1.5 border-b border-line bg-pane px-2.5 py-2';
const SCROLL =
  'min-h-[340px] flex-[1_1_0] overflow-auto max-md:min-h-0 [-webkit-overflow-scrolling:touch]';
const HINT = 'text-[12.5px] text-muted';
const ZV = 'min-w-[46px] text-center text-[12.5px] text-muted tabular-nums';
const SEARCH =
  'min-h-[31px] max-w-[260px] rounded-lg border border-line bg-field px-2.5 py-[5px] text-[13px] text-ink outline-none focus:border-accent max-md:max-w-none max-md:flex-[1_1_160px]';

/** Рамка просмотра (`.fv`): тип файла — в `data-fv`. */
export function FileViewFrame({ kind, children }: { kind: string; children: ReactNode }) {
  return (
    <div
      data-fv={kind}
      className="flex flex-[1_0_auto] flex-col overflow-hidden rounded-xl border border-line bg-pane-alt"
    >
      {children}
    </div>
  );
}

/** Состояние без содержимого: «Предпросмотр недоступен», «Не удалось открыть файл», загрузка. */
export function FileViewState({
  icon = 'file',
  title,
  text,
  action,
  state,
}: {
  icon?: IconName;
  title: string;
  text?: string;
  action?: ReactNode;
  state: string;
}) {
  return (
    <div
      data-fv-state={state}
      className="m-4 flex min-h-[260px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong px-4 py-8 text-center text-muted"
    >
      <Icon name={icon} size="lg" className="text-faint" />
      <b className="max-w-[520px] text-[15px] text-balance text-ink">{title}</b>
      {text ? <span className="max-w-[420px]">{text}</span> : null}
      {action}
    </div>
  );
}

/**
 * Адреса картинок модели — `blob:` из байтов, по одному на картинку: тип уже проверен по содержимому
 * и только PNG, JPEG, GIF или WebP (не SVG), поэтому картинка ничего не выполняет и никуда не ходит.
 * Одну картинку файл может показать в сотнях мест — короткий адрес не копирует её байты в каждое.
 * Адреса освобождаются, когда модель сменилась или окно закрыто.
 */
export function useImageUrls(
  images: Record<string, ViewImage> | undefined,
): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    // Адреса — внешний ресурс: создаются после показа (отдельной микрозадачей, как ответ загрузки)
    // и освобождаются при уходе; отменённый запуск (повтор эффекта в режиме разработки) их не создаёт.
    let live = true;
    let made: Record<string, string> = {};
    queueMicrotask(() => {
      if (!live) return;
      for (const [k, img] of Object.entries(images ?? {}))
        made[k] = URL.createObjectURL(new Blob([img.bytes as BlobPart], { type: img.type }));
      setUrls(made);
    });
    return () => {
      live = false;
      for (const u of Object.values(made)) URL.revokeObjectURL(u);
      made = {};
    };
  }, [images]);
  return urls;
}

// ── Картинка и PDF ──

export function PictureView({
  url,
  name,
  labels,
  onFail,
}: {
  url: string;
  name: string;
  labels: FileViewLabels;
  /** Браузер не смог показать картинку (HEIC вне Safari). */
  onFail: () => void;
}) {
  const [z, setZ] = useState(1);
  const [r, setR] = useState(0);
  return (
    <FileViewFrame kind="image">
      <div className={BAR}>
        <button
          type="button"
          className={iconButtonClass('sm')}
          aria-label={labels.zoomOut}
          data-fz="-1"
          onClick={() => setZ((v) => zoomNext(v, -1))}
        >
          −
        </button>
        <span className={ZV} data-fv-zoom="">
          {Math.round(z * 100)} %
        </span>
        <button
          type="button"
          className={iconButtonClass('sm')}
          aria-label={labels.zoomIn}
          data-fz="1"
          onClick={() => setZ((v) => zoomNext(v, 1))}
        >
          +
        </button>
        <button
          type="button"
          className={buttonClass('ghost', 'sm')}
          data-frot=""
          onClick={() => setR(rotateNext)}
        >
          <Icon name="refresh" size="sm" />
          {labels.rotate}
        </button>
        <button
          type="button"
          className={buttonClass('ghost', 'sm')}
          data-ffit=""
          onClick={() => {
            setZ(1);
            setR(0);
          }}
        >
          {labels.fit}
        </button>
      </div>
      <div className={`${SCROLL} grid place-items-center p-4`}>
        <div
          className="transition-transform duration-200"
          style={{ transform: `scale(${z}) rotate(${r}deg)` }}
        >
          <img
            src={url}
            alt={name}
            data-fv-img=""
            onError={onFail}
            className="block max-h-[62vh] max-w-full rounded-md object-contain shadow-pane"
          />
        </div>
      </div>
    </FileViewFrame>
  );
}

/** PDF — встроенным просмотрщиком браузера, как раньше; на телефоне — ещё «Открыть в новой вкладке». */
export function PdfView({
  url,
  name,
  labels,
}: {
  url: string;
  name: string;
  labels: FileViewLabels;
}) {
  return (
    <FileViewFrame kind="pdf">
      <iframe
        data-file-preview="pdf"
        src={url}
        title={name}
        className="h-[66vh] w-full border-0 bg-raised max-md:h-[calc(100dvh-230px)]"
      />
      <div className="flex flex-none justify-end border-t border-line bg-pane px-2.5 py-1.5 md:hidden">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          data-file-open-tab=""
          className="text-[13px] text-link"
        >
          {labels.openTab}
        </a>
      </div>
    </FileViewFrame>
  );
}

// ── Excel ──

function cellStyle(cell: SheetCell): CSSProperties | undefined {
  if (!cell.color && !cell.bg) return undefined;
  return {
    ...(cell.bg ? { background: cell.bg, color: cell.color ?? '#1f1f1f' } : {}),
    ...(cell.color ? { color: cell.color } : {}),
  };
}

function cellClass(cell: SheetCell | null | undefined, hit: boolean, current: boolean): string {
  const al = cell?.al ?? (cell?.num ? 'r' : 'l');
  return [
    'h-6 overflow-hidden border-r border-b border-line px-[7px] py-1 text-ellipsis',
    cell?.wrap ? 'whitespace-pre-wrap' : 'whitespace-nowrap',
    al === 'r' ? 'text-right tabular-nums' : al === 'c' ? 'text-center' : 'text-left',
    cell?.b ? 'font-bold' : '',
    cell?.i ? 'italic' : '',
    cell?.u ? 'underline' : '',
    hit ? 'bg-caution-bg' : '',
    current ? 'shadow-[inset_0_0_0_2px_var(--color-caution)]' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Блок содержимого файла (строка текста, абзац, узел XML, блок длинного текста): браузер
 * раскладывает его, только когда он у экрана (`content-visibility: auto`), а до того держит под
 * него место высотой `px` (потом — настоящей). Так время открытия зависит от того, что видно, а не
 * от размера файла: китайский текст на 2 млн знаков без этого раскладывался 6 с при любом делении.
 */
function lazyBlock(px: number): CSSProperties {
  return { contentVisibility: 'auto', containIntrinsicSize: `auto ${px}px` };
}

/** Место под блок до `TEXT_SEGMENT` знаков, пока он не у экрана, px. */
const LAZY_SEGMENT = lazyBlock(1200);
/** Место под строку текста, абзац и узел XML. */
const LAZY_LINE = lazyBlock(21);
/** Место под таблицу документа. */
const LAZY_TABLE = lazyBlock(120);

/** Куски подряд — блоками (`segmentStarts`): каждый блок браузер раскладывает отдельно. */
function inBlocks(nodes: readonly ReactNode[], lengths: readonly number[]): ReactNode {
  const starts = segmentStarts(lengths);
  if (starts.length === 1) return nodes;
  return starts.map((from, i) => (
    <span key={from} className="block" style={LAZY_SEGMENT}>
      {nodes.slice(from, starts[i + 1])}
    </span>
  ));
}

/**
 * Длинный текст — кусками `textChunks` с местом переноса `<wbr>` между ними: без него браузер
 * раскладывает длинную строку за квадрат от длины и дольше. Кусок длинного «слова» без пробелов
 * переносится между любыми буквами (`chunkOfLongWord`). Текст длиннее `TEXT_SEGMENT` — блоками.
 */
function chunkNodes(text: string): ReactNode {
  const parts = textChunks(text);
  if (typeof parts === 'string') return parts;
  const nodes = parts.map((part, i) => (
    <Fragment key={i}>
      {chunkOfLongWord(parts, i) ? <span className="break-all">{part}</span> : part}
      {i < parts.length - 1 ? <wbr /> : null}
    </Fragment>
  ));
  return inBlocks(
    nodes,
    parts.map((part) => part.length),
  );
}

/** Куски длинного текста считаются один раз на значение, а не при каждой перерисовке окна. */
const Chunks = memo(function Chunks({ text }: { text: string }) {
  return chunkNodes(text);
});

/** Текст файла на экране: короткий — как есть, длинный — кусками. */
function chunked(text: string): ReactNode {
  return text.length > TEXT_CHUNK ? <Chunks text={text} /> : text;
}

/** Ширина столбца номеров строк, px. */
const SHEET_HEAD_PX = 46;

interface SheetCol {
  w: number;
  c: number;
}

/** Строка листа: перерисовывается, только когда у неё сменилось найденное. */
const SheetRow = memo(function SheetRow({
  row,
  r,
  cols,
  merges,
  height,
  hitCols,
  currentCol,
}: {
  row: (SheetCell | null)[];
  r: number;
  cols: SheetCol[];
  merges: MergeMap;
  height: number | undefined;
  hitCols: Set<number> | undefined;
  currentCol: number;
}) {
  return (
    <tr style={height ? { height } : undefined}>
      <th className="sticky left-0 z-[1] border-r border-b border-line bg-pane-alt px-1 text-center font-medium text-muted tabular-nums">
        {r + 1}
      </th>
      {cols.map(({ c }) => {
        const k = cellKey(r, c);
        if (merges.skip.has(k)) return null;
        const cell = row[c];
        const span = merges.span.get(k);
        // В ячейке — до 1 024 знаков, с переносом — не выше строки Excel; весь текст — в подсказке.
        const text = cell ? chunkNodes(sheetCellText(cell.v)) : undefined;
        return (
          <td
            key={c}
            data-cell={k}
            rowSpan={span && span.rows > 1 ? span.rows : undefined}
            colSpan={span && span.cols > 1 ? span.cols : undefined}
            className={cellClass(cell, hitCols?.has(c) ?? false, currentCol === c)}
            style={cell ? cellStyle(cell) : undefined}
            title={cell && cell.v.length > 24 ? cell.v : undefined}
          >
            {cell?.wrap ? (
              <div className="overflow-hidden" style={{ maxHeight: SHEET_WRAP_MAX_PX }}>
                {text}
              </div>
            ) : (
              text
            )}
          </td>
        );
      })}
    </tr>
  );
});

/**
 * Лист: буквы столбцов и номера строк закреплены, объединения, скрытые строки и столбцы не рисуются.
 * Строки рисуются шагами (`sheetStepEnd`): дальше — по прокрутке, к найденной ячейке — шаг за шагом
 * отдельными задачами, потом прокрутка к ней.
 */
export function SheetTable({
  sheet,
  hits,
  current,
}: {
  sheet: SheetView;
  /** Найденные ячейки: [строка, столбец]. */
  hits: readonly [number, number][];
  /** Текущая найденная ячейка. */
  current: readonly [number, number] | null;
}) {
  const hidden = useMemo(() => new Set(sheet.hiddenRows), [sheet]);
  const cols = useMemo<SheetCol[]>(
    () => sheet.cols.map((w, c) => ({ w, c })).filter((x) => x.w > 0),
    [sheet],
  );
  const tableWidth = useMemo(() => SHEET_HEAD_PX + cols.reduce((a, x) => a + x.w, 0), [cols]);
  // Объединения — один раз на лист.
  const merges = useMemo(() => mergeMap(sheet), [sheet]);
  const byRow = useMemo(() => hitsByRow(hits), [hits]);
  const [drawn, setDrawn] = useState(() => sheetStepEnd(sheet, 0, cols.length, hidden));
  const more = useRef<HTMLDivElement | null>(null);
  const table = useRef<HTMLTableElement | null>(null);
  const scrolled = useRef<string | null>(null);
  const cr = current ? current[0] : -1;
  const cc = current ? current[1] : -1;
  useEffect(() => {
    if (cr < 0) {
      scrolled.current = null;
      return;
    }
    const k = cellKey(cr, cc);
    if (scrolled.current === k) return;
    if (cr >= drawn) {
      // Найденная строка ниже нарисованного: следующий шаг — отдельной задачей, окно не замирает.
      // после кадра прошлого шага — иначе браузер склеивает несколько шагов в один кадр.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const frame = requestAnimationFrame(() => {
        timer = setTimeout(() => setDrawn((d) => sheetStepEnd(sheet, d, cols.length, hidden)), 0);
      });
      return () => {
        cancelAnimationFrame(frame);
        clearTimeout(timer);
      };
    }
    // Найденная ячейка — в середину видимой части (после того как строка нарисована).
    const id = setTimeout(() => {
      scrolled.current = k;
      table.current
        ?.querySelector(`[data-cell="${k}"]`)
        ?.scrollIntoView({ block: 'center', inline: 'center' });
    }, 30);
    return () => clearTimeout(id);
  }, [cr, cc, drawn, sheet, cols, hidden]);
  useEffect(() => {
    const el = more.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((e) => {
      if (e.some((x) => x.isIntersecting))
        setDrawn((d) => sheetStepEnd(sheet, d, cols.length, hidden));
    });
    io.observe(el);
    return () => io.disconnect();
  }, [drawn, sheet, cols, hidden]);
  const rows: ReactNode[] = [];
  const last = Math.min(drawn, sheet.rows.length);
  for (let r = 0; r < last; r++) {
    if (hidden.has(r)) continue;
    rows.push(
      <SheetRow
        key={r}
        row={sheet.rows[r]!}
        r={r}
        cols={cols}
        merges={merges}
        height={sheet.heights[r]}
        hitCols={byRow.get(r)}
        currentCol={cr === r ? cc : -1}
      />,
    );
  }
  return (
    <>
      <table
        ref={table}
        className="table-fixed border-separate border-spacing-0 text-[12.5px]"
        // Ширина таблицы — числом из ширин столбцов: при `max-content` браузер раскладывает таблицу
        // по тексту, и строка нового шага заново раскладывала бы все нарисованные.
        style={{ width: tableWidth, fontFamily: FILE_FONT }}
        data-fv-sheet={sheet.name}
      >
        <colgroup>
          <col style={{ width: SHEET_HEAD_PX }} />
          {cols.map(({ w, c }) => (
            <col key={c} style={{ width: w }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className="sticky top-0 left-0 z-[3] border-r border-b border-line bg-pane-alt" />
            {cols.map(({ c }) => (
              <th
                key={c}
                className="sticky top-0 z-[2] border-r border-b border-line bg-pane-alt px-[7px] py-1 text-center font-medium text-muted"
              >
                {colLetters(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
      {/* Отметка «нарисовать ещё» — под таблицей: объединение ниже нарисованного её не задевает. */}
      {sheet.rows.length > drawn ? <div ref={more} data-fv-more-rows="" className="h-6" /> : null}
    </>
  );
}

export function SheetBookView({
  model,
  labels,
}: {
  model: Extract<FileViewModel, { kind: 'sheet' }>;
  labels: FileViewLabels;
}) {
  const [tab, setTab] = useState(0);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);
  const sheet = model.sheets[tab];
  const found = useMemo(() => (sheet ? sheetHits(sheet, query) : []), [sheet, query]);
  const current = found[at] ?? null;
  if (!sheet) return <FileViewState state="empty" title={labels.emptySheet} />;
  return (
    <FileViewFrame kind="sheet">
      <div className={BAR}>
        <input
          type="search"
          data-fv-q=""
          className={SEARCH}
          placeholder={labels.sheetSearch}
          aria-label={labels.sheetSearch}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            if (!e.target.value) setQuery('');
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            // Enter — искать; ещё Enter по той же строке — к следующей найденной ячейке.
            if (q.trim() === query.trim() && found.length) setAt((v) => (v + 1) % found.length);
            else {
              setQuery(q);
              setAt(0);
            }
          }}
        />
        {query.trim() ? (
          <span className={HINT} data-fv-found="">
            {found.length ? labels.found(found.length) : labels.notFound}
          </span>
        ) : null}
      </div>
      <div className={`${SCROLL} bg-pane`}>
        <SheetTable key={tab} sheet={sheet} hits={found} current={current} />
      </div>
      {sheet.totalRows > sheet.rows.length ? (
        <div
          data-fv-more=""
          className="flex flex-none items-center gap-1.5 border-t border-line bg-pane px-2.5 py-[7px] text-[12.5px] text-muted"
        >
          <Icon name="info" size="sm" />
          {labels.moreRows(sheet.rows.length, sheet.totalRows)}
        </div>
      ) : null}
      {model.sheets.length > 1 ? (
        <div
          role="tablist"
          className="flex flex-none gap-0.5 overflow-x-auto border-t border-line bg-pane-alt px-2"
          data-no-swipe=""
        >
          {model.sheets.map((s, i) => (
            <button
              key={`${i}-${s.name}`}
              type="button"
              role="tab"
              aria-selected={i === tab}
              data-fsh={i}
              onClick={() => {
                setTab(i);
                setAt(0);
              }}
              className={`cursor-pointer border-0 border-t-2 px-3.5 py-2 text-[12.5px] whitespace-nowrap ${
                i === tab
                  ? 'border-t-accent bg-pane font-semibold text-ink'
                  : 'border-t-transparent bg-transparent text-muted'
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      ) : null}
    </FileViewFrame>
  );
}

// ── Word ──

function runStyle(r: DocRun): CSSProperties | undefined {
  if (!r.sz && !r.color) return undefined;
  return {
    ...(r.sz ? { fontSize: `${Math.max(8, Math.min(40, r.sz)) * (4 / 3)}px` } : {}),
    ...(r.color ? { color: r.color } : {}),
  };
}

function Runs({ runs, urls }: { runs: readonly DocRun[]; urls: Record<string, string> }) {
  const nodes = runs.map((r, i) => {
    if (r.img) {
      const src = urls[r.img];
      return src ? (
        <img
          key={i}
          src={src}
          alt=""
          data-fv-docimg=""
          className="inline-block max-w-full align-middle"
          style={{ width: r.w ? Math.min(r.w, 680) : undefined, height: 'auto' }}
        />
      ) : null;
    }
    const cls = [
      r.b ? 'font-bold' : '',
      r.i ? 'italic' : '',
      r.u ? 'underline' : '',
      r.s ? 'line-through' : '',
    ]
      .filter(Boolean)
      .join(' ');
    return (
      <span key={i} className={cls || undefined} style={runStyle(r)}>
        {chunked(r.t)}
      </span>
    );
  });
  // Абзац из многих кусков — блоками до `TEXT_SEGMENT` знаков, как и один длинный кусок.
  return (
    <>
      {inBlocks(
        nodes,
        runs.map((r) => (r.img ? 1 : r.t.length)),
      )}
    </>
  );
}

const ALIGN: Record<string, string> = { c: 'text-center', r: 'text-right', j: 'text-justify' };
const HEADING = [
  'text-[19px] text-center font-bold mb-1.5',
  'text-[17px] font-bold mt-4 mb-1.5',
  'text-[15px] font-bold mt-4 mb-1.5',
  'text-[14px] font-bold mt-3 mb-1',
  'text-[13.5px] font-bold mt-3 mb-1',
  'text-[13px] font-bold mt-2 mb-1',
  'text-[13px] font-semibold mt-2 mb-1',
];

function DocBlocks({
  blocks,
  urls,
  lazy,
}: {
  blocks: readonly DocBlock[];
  urls: Record<string, string>;
  /** Блоки самой бумаги (не ячеек таблицы) раскладываются, когда они у экрана. */
  lazy?: boolean;
}) {
  return (
    <>
      {blocks.map((b, i) => {
        if (b.k === 't') {
          const table = (
            <table key={i} className="my-2 w-full border-collapse text-[13px]">
              <tbody>
                {b.rows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        colSpan={cell.span}
                        rowSpan={cell.rowSpan}
                        className="border border-[#bbb] px-2 py-[5px] align-top"
                      >
                        <DocBlocks blocks={cell.blocks} urls={urls} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          );
          // У самой таблицы `content-visibility` не действует — у блока вокруг неё.
          return lazy ? (
            <div key={i} style={LAZY_TABLE}>
              {table}
            </div>
          ) : (
            table
          );
        }
        const cls = [
          b.h !== undefined ? HEADING[b.h] : 'my-1.5 min-h-[1em] leading-[1.55]',
          b.al ? ALIGN[b.al] : '',
          'whitespace-pre-wrap',
        ].join(' ');
        const body = (
          <>
            {b.li ? (
              <span className="mr-2 inline-block min-w-[1.2em] text-right" aria-hidden="true">
                {b.li.label}
              </span>
            ) : null}
            <Runs runs={b.runs} urls={urls} />
          </>
        );
        const style = {
          ...(lazy ? LAZY_LINE : undefined),
          ...(b.li ? { paddingLeft: `${b.li.lvl * 24}px` } : undefined),
        };
        if (b.h === undefined)
          return (
            <p key={i} className={cls} style={style}>
              {body}
            </p>
          );
        const H = `h${Math.min(6, Math.max(1, b.h || 1))}` as 'h1';
        return (
          <H key={i} className={cls} style={style}>
            {body}
          </H>
        );
      })}
    </>
  );
}

export function DocumentView({
  model,
  labels,
}: {
  model: Extract<FileViewModel, { kind: 'doc' }>;
  labels: FileViewLabels;
}) {
  const urls = useImageUrls(model.images);
  return (
    <FileViewFrame kind="doc">
      <div className={`${SCROLL} p-4 max-md:p-2`}>
        <div
          className="mx-auto max-w-[760px] rounded-md bg-white px-10 py-8 text-[13.5px] break-words text-[#222] shadow-pane max-md:px-4 max-md:py-5"
          data-fv-paper=""
          style={{ fontFamily: FILE_FONT }}
        >
          <DocBlocks blocks={model.blocks} urls={urls} lazy />
        </div>
      </div>
      {model.cut ? <MoreAll text={labels.moreAll} /> : null}
    </FileViewFrame>
  );
}

function MoreAll({ text }: { text: string }) {
  return (
    <div
      data-fv-more=""
      className="flex flex-none items-center gap-1.5 border-t border-line bg-pane px-2.5 py-[7px] text-[12.5px] text-muted"
    >
      <Icon name="info" size="sm" />
      {text}
    </div>
  );
}

// ── Презентация ──

function SlideItemView({
  item,
  widthPt,
  urls,
}: {
  item: SlideItem;
  widthPt: number;
  urls: Record<string, string>;
}) {
  const box: CSSProperties = {
    position: 'absolute',
    left: `${item.x * 100}%`,
    top: `${item.y * 100}%`,
    width: `${item.w * 100}%`,
    height: `${item.h * 100}%`,
  };
  const fs = (pt: number) => `${(pt / widthPt) * 100}cqw`;
  if (item.k === 'pic') {
    const src = urls[item.img];
    return src ? <img src={src} alt="" style={{ ...box, objectFit: 'contain' }} /> : null;
  }
  if (item.k === 'table') {
    return (
      <table style={{ ...box, fontSize: fs(12) }} className="border-collapse">
        <tbody>
          {item.rows.map((row, i) => (
            <tr key={i}>
              {row.map((c, j) => (
                <td
                  key={j}
                  className="border border-[#aab] px-[0.6cqw] py-[0.3cqw] align-top whitespace-pre-wrap"
                >
                  {chunked(c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return (
    <div
      style={{ ...box, background: item.fill, padding: '0.8cqw 1cqw' }}
      className={`flex flex-col overflow-hidden ${item.anchor === 'c' ? 'justify-center' : item.anchor === 'b' ? 'justify-end' : 'justify-start'}`}
    >
      {item.paras.map((p, i) => (
        <div
          key={i}
          className={`leading-[1.2] whitespace-pre-wrap ${p.al ? ALIGN[p.al] : ''}`}
          style={{
            paddingLeft: p.lvl ? `${p.lvl * 2.5}cqw` : undefined,
            fontSize: fs(p.runs[0]?.sz ?? 18),
          }}
        >
          {p.bullet ? '• ' : ''}
          {inBlocks(
            p.runs.map((r, j) => (
              <span
                key={j}
                className={
                  [
                    r.b || item.title ? 'font-bold' : '',
                    r.i ? 'italic' : '',
                    r.u ? 'underline' : '',
                  ]
                    .filter(Boolean)
                    .join(' ') || undefined
                }
                style={{ fontSize: r.sz ? fs(r.sz) : undefined, color: r.color }}
              >
                {chunked(r.t)}
              </span>
            )),
            p.runs.map((r) => r.t.length),
          )}
        </div>
      ))}
    </div>
  );
}

export function SlidesView({
  model,
  labels,
  slide,
  onSlide,
}: {
  model: SlidesView;
  labels: FileViewLabels;
  slide: number;
  onSlide: (n: number) => void;
}) {
  const urls = useImageUrls(model.images);
  const n = model.slides.length;
  const s = model.slides[Math.min(slide, n - 1)];
  const widthPt = model.w / 12700;
  return (
    <FileViewFrame kind="slides">
      <div className={BAR}>
        <button
          type="button"
          className={iconButtonClass('sm')}
          aria-label={labels.prevSlide}
          data-fsl="-1"
          disabled={slide <= 0}
          onClick={() => onSlide(slide - 1)}
        >
          <Icon name="left" size="sm" />
        </button>
        <span className={ZV} data-fv-slide="">
          {labels.slideOf(Math.min(slide, n - 1) + 1, n)}
        </span>
        <button
          type="button"
          className={iconButtonClass('sm')}
          aria-label={labels.nextSlide}
          data-fsl="1"
          disabled={slide >= n - 1}
          onClick={() => onSlide(slide + 1)}
        >
          <Icon name="right" size="sm" />
        </button>
      </div>
      <div className={`${SCROLL} grid place-items-center p-4 max-md:p-2`}>
        {s ? (
          <div
            data-fv-slide-box=""
            className="relative w-[min(760px,100%)] overflow-hidden rounded-md break-words text-[#1f2a44] shadow-pane [container-type:inline-size]"
            style={{
              aspectRatio: `${model.w} / ${model.h}`,
              background: s.bg ?? '#fff',
              fontFamily: FILE_FONT,
            }}
          >
            {s.items.map((it, i) => (
              <SlideItemView key={i} item={it} widthPt={widthPt} urls={urls} />
            ))}
          </div>
        ) : null}
      </div>
      {model.cut ? <MoreAll text={labels.moreAll} /> : null}
    </FileViewFrame>
  );
}

// ── Текст ──

export function TextFileView({ model, labels }: { model: TextView; labels: FileViewLabels }) {
  const enc = model.encoding === 'windows-1251' ? 'Windows-1251' : model.encoding.toUpperCase();
  return (
    <FileViewFrame kind="text">
      <div className={BAR}>
        <span className={HINT} data-fv-enc={model.encoding}>
          {labels.encoding(enc)}
        </span>
      </div>
      <div className={`${SCROLL} bg-pane`}>
        <pre className="m-0 px-3 py-2.5 font-mono text-[12.5px] leading-[1.6] break-words whitespace-pre-wrap">
          {model.lines.map((l, i) => (
            <span key={i} className="block" style={LAZY_LINE}>
              <span className="mr-2.5 inline-block w-[34px] text-right text-faint select-none">
                {i + 1}
              </span>
              {chunked(l)}
            </span>
          ))}
        </pre>
      </div>
      {model.totalLines > model.lines.length ? (
        <MoreAll text={labels.moreRows(model.lines.length, model.totalLines)} />
      ) : null}
    </FileViewFrame>
  );
}

// ── XML ──

function XmlNodeView({
  node,
  path,
  toggled,
  open,
  hits,
  onToggle,
  labels,
}: {
  node: XmlViewNode;
  path: XmlPath;
  /** Ветки, которые пользователь свернул или развернул (против положения по умолчанию). */
  toggled: Set<XmlPath>;
  /** Ветки-предки найденного — развёрнуты. */
  open: Set<XmlPath>;
  hits: Set<XmlPath>;
  onToggle: (p: XmlPath) => void;
  labels: FileViewLabels;
}) {
  // Имя и атрибуты длиннее блока раскладки — каждый атрибут своей строкой.
  const head = node.a.reduce((n, [k, v]) => n + k.length + v.length, node.n.length);
  const attrs = node.a.map(([k, v]) => (
    <span key={k} className={head > TEXT_SEGMENT ? 'block pl-4' : undefined}>
      {head > TEXT_SEGMENT ? null : ' '}
      <span className="text-violet">{chunked(k)}</span>=
      <span className="text-ok">&quot;{chunked(v)}&quot;</span>
    </span>
  ));
  const hit = hits.has(path) ? 'rounded-[3px] bg-caution-bg' : '';
  const kids = node.c.filter((x): x is XmlViewNode => typeof x !== 'string');
  const text = node.c.filter((x): x is string => typeof x === 'string').join(' ');
  if (!kids.length) {
    return (
      <div className={hit} data-xn={path} style={LAZY_LINE}>
        <span className="text-info">&lt;{chunked(node.n)}</span>
        {attrs}
        {text ? (
          <>
            <span className="text-info">&gt;</span>
            {chunked(text)}
            <span className="text-info">&lt;/{chunked(node.n)}&gt;</span>
          </>
        ) : (
          <span className="text-info">/&gt;</span>
        )}
      </div>
    );
  }
  const off = xmlClosed(path, toggled, open);
  let k = 0;
  return (
    // Отступ и обратное поле: кнопка-стрелка слева остаётся внутри блока и не обрезается.
    <div className="-ml-4 pl-4" data-xn={path} style={LAZY_LINE}>
      <span className={hit}>
        <button
          type="button"
          aria-expanded={!off}
          aria-label={off ? labels.expand(node.n) : labels.collapse(node.n)}
          onClick={() => onToggle(path)}
          className={`-ml-4 w-4 cursor-pointer border-0 bg-transparent p-0 text-[11px] text-muted transition-transform ${off ? '-rotate-90' : ''}`}
        >
          ▾
        </button>
        <span className="text-info">&lt;{chunked(node.n)}</span>
        {attrs}
        <span className="text-info">&gt;</span>
        {off ? <span className="text-faint">…</span> : null}
        {text && !off ? <span>{chunked(text)}</span> : null}
      </span>
      {off ? null : (
        <div className="ml-[5px] border-l border-dotted border-line-strong pl-[18px]">
          {node.c.map((x, i) => {
            if (typeof x === 'string') return null;
            k++;
            return (
              <XmlNodeView
                key={`${i}-${k}`}
                node={x}
                path={`${path}-${i}`}
                toggled={toggled}
                open={open}
                hits={hits}
                onToggle={onToggle}
                labels={labels}
              />
            );
          })}
        </div>
      )}
      <span className="text-info">&lt;/{chunked(node.n)}&gt;</span>
    </div>
  );
}

export function XmlFileView({ model, labels }: { model: XmlView; labels: FileViewLabels }) {
  const [q, setQ] = useState('');
  const [toggled, setToggled] = useState<Set<XmlPath>>(() => new Set());
  // Найденное раскрывается: ветки-предки найденных узлов не свёрнуты.
  const found = useMemo(
    () =>
      model.root ? xmlHits(model.root, q) : { hits: new Set<XmlPath>(), open: new Set<XmlPath>() },
    [model, q],
  );
  const branches = useMemo(() => (model.root ? xmlBranches(model.root) : []), [model]);
  const toggle = (p: XmlPath) =>
    setToggled((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });
  return (
    <FileViewFrame kind="xml">
      <div className={BAR}>
        <input
          type="search"
          data-fv-q=""
          className={SEARCH}
          placeholder={labels.xmlSearch}
          aria-label={labels.xmlSearch}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {q.trim() ? (
          <span className={HINT} data-fv-found="">
            {found.hits.size ? labels.found(found.hits.size) : labels.notFound}
          </span>
        ) : null}
        <div className="flex-1" />
        <button
          type="button"
          className={buttonClass('ghost', 'sm')}
          data-fxa="0"
          onClick={() => setToggled(new Set(branches.filter((p) => xmlDepth(p) < XML_OPEN_DEPTH)))}
        >
          {labels.collapseAll}
        </button>
        <button
          type="button"
          className={buttonClass('ghost', 'sm')}
          data-fxa="1"
          onClick={() => setToggled(new Set(branches.filter((p) => xmlDepth(p) >= XML_OPEN_DEPTH)))}
        >
          {labels.expandAll}
        </button>
      </div>
      {model.doctype ? (
        <div
          data-fv-doctype=""
          className="flex flex-none items-center gap-1.5 border-b border-line bg-caution-bg px-2.5 py-[7px] text-[12.5px] text-ink"
        >
          <Icon name="shield" size="sm" />
          {labels.doctype}
        </div>
      ) : null}
      <div
        className={`${SCROLL} bg-pane px-3 py-2.5 font-mono text-[12.5px] leading-[1.7] break-words`}
      >
        {model.decl ? <div className="text-faint">{model.decl}</div> : null}
        {model.root ? (
          <XmlNodeView
            node={model.root}
            path="0"
            toggled={toggled}
            open={found.open}
            hits={found.hits}
            onToggle={toggle}
            labels={labels}
          />
        ) : null}
      </div>
      {model.cut ? <MoreAll text={labels.moreAll} /> : null}
    </FileViewFrame>
  );
}
