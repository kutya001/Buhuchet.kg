/// <reference path="./documents-modules.d.ts" />
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

/*
 * Чтение PDF на сервере платформы (ТЗ «Создание контрагента из свидетельства и выписки» → «Как
 * распознаётся в системе»): сначала текстовый слой PDF (pdf.js, как прототип core/regdocs.js pdfRead),
 * при его отсутствии — распознавание скана (OCR, tesseract.js) на русском и кыргызском языке. Файлы во
 * внешние сервисы не отправляются, на диск ничего не пишется: библиотеки и языковые данные — из
 * node_modules, кэш языков выключен. Библиотеки загружаются при первом чтении: worker и остальное API
 * их не тянут.
 */

/** Кусок текста на странице: левый нижний угол в пунктах PDF (ось y — вверх), ширина и высота. */
export interface DocumentTextItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Текст документа по страницам; `created` — дата создания PDF (ГГГГ-ММ-ДД или пусто); `ocr` — скан. */
export interface DocumentText {
  pages: { items: DocumentTextItem[] }[];
  created: string;
  ocr: boolean;
}

/**
 * Почему документ не прочитан: не PDF или повреждён, защищён паролем, не уложился во время, в скане
 * не нашлось текста.
 */
export type DocumentReadError = 'broken' | 'password' | 'timeout' | 'no_text';

export type DocumentReadResult =
  | { ok: true; doc: DocumentText }
  | { ok: false; error: DocumentReadError };

export interface DocumentReader {
  read(bytes: Uint8Array): Promise<DocumentReadResult>;
}

export interface DocumentReaderOptions {
  /** Сколько страниц читать (по умолчанию 10, как прототип). */
  maxPages?: number;
  /** Сколько страниц скана распознавать (по умолчанию 4: свидетельство и выписка — 1–2 страницы). */
  ocrPages?: number;
  /** Меньше стольких знаков текста — PDF считается сканом (по умолчанию 40, как прототип). */
  minChars?: number;
  /** Предел на один документ, мс (ТЗ: не больше 60 секунд). */
  timeoutMs?: number;
}

const DEFAULTS = { maxPages: 10, ocrPages: 4, minChars: 40, timeoutMs: 60_000 };

/** Картинка страницы меньше этого (по меньшей стороне, точек) — не скан, а герб или подпись. */
const MIN_SCAN_SIDE = 400;

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
type PdfTask = ReturnType<PdfJs['getDocument']>;
type PdfDocument = Awaited<PdfTask['promise']>;
type PdfPage = Awaited<ReturnType<PdfDocument['getPage']>>;

let pdfjsLoad: Promise<PdfJs> | null = null;

/** pdf.js без отдельного потока: обработчик подключается сам (globalThis.pdfjsWorker), без сети. */
function loadPdfJs(): Promise<PdfJs> {
  pdfjsLoad ??= (async () => {
    const worker = (await import('pdfjs-dist/legacy/build/pdf.worker.mjs')) as unknown;
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
    return import('pdfjs-dist/legacy/build/pdf.mjs');
  })().catch((e: unknown) => {
    pdfjsLoad = null;
    throw e;
  });
  return pdfjsLoad;
}

/**
 * Папка точных языковых данных («4.0.0_best_int») рядом с той, что пакет языка называет сам. Путь
 * берётся у загруженного пакета, а не собирается из имени файла: сборка сайта не должна тянуть
 * языковые файлы в свой код (они попадают в образ отдельно — next.config.ts).
 */
type LangPackage = { langPath: string };
const langDir = (m: LangPackage | { default: LangPackage }) =>
  path.join(path.dirname('default' in m ? m.default.langPath : m.langPath), '4.0.0_best_int');
let langData: Promise<{ rusDir: string; kir: Buffer }> | null = null;
const loadLangs = () => {
  langData ??= (async () => {
    const [rus, kir] = await Promise.all([
      import('@tesseract.js-data/rus'),
      import('@tesseract.js-data/kir'),
    ]);
    const kirDir = langDir(kir);
    return { rusDir: langDir(rus), kir: await readFile(path.join(kirDir, 'kir.traineddata.gz')) };
  })().catch((e: unknown) => {
    langData = null;
    throw e;
  });
  return langData;
};

/** Распознавание идёт по одному документу за раз: оно занимает процессор, сайт должен отвечать. */
let ocrQueue: Promise<unknown> = Promise.resolve();

/** Картинка pdf.js: размер, вид (1 — ч/б 1 бит, 2 — RGB, 3 — RGBA) и точки. */
interface PdfImage {
  width: number;
  height: number;
  kind: number;
  data?: Uint8Array | Uint8ClampedArray;
}

/** Картинка в формате PNM (его понимает tesseract без кодеков): серое P5 или цветное P6. */
function toPnm(img: PdfImage): Buffer | null {
  const { width: w, height: h, kind, data: d } = img;
  if (!d) return null;
  if (kind === 2 && d.length >= w * h * 3)
    return Buffer.concat([
      Buffer.from(`P6\n${w} ${h}\n255\n`),
      Buffer.from(d.buffer, d.byteOffset, w * h * 3),
    ]);
  if (kind === 3 && d.length >= w * h * 4) {
    const out = Buffer.alloc(w * h * 3);
    for (let i = 0, j = 0; j < out.length; i += 4, j += 3) {
      out[j] = d[i]!;
      out[j + 1] = d[i + 1]!;
      out[j + 2] = d[i + 2]!;
    }
    return Buffer.concat([Buffer.from(`P6\n${w} ${h}\n255\n`), out]);
  }
  if (kind === 1) {
    const row = (w + 7) >> 3;
    if (d.length < row * h) return null;
    const out = Buffer.alloc(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        out[y * w + x] = (d[y * row + (x >> 3)]! >> (7 - (x & 7))) & 1 ? 255 : 0;
    return Buffer.concat([Buffer.from(`P5\n${w} ${h}\n255\n`), out]);
  }
  return null;
}

/** Самая большая картинка страницы — скан; меньше `MIN_SCAN_SIDE` — не скан. */
async function pageScan(pdfjs: PdfJs, page: PdfPage): Promise<PdfImage | null> {
  const ops = await page.getOperatorList();
  let best: PdfImage | null = null;
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i] as unknown[];
    let img: PdfImage | null = null;
    if (fn === pdfjs.OPS.paintImageXObject) {
      const name = args[0] as string;
      // общие для документа картинки (g_…) лежат в commonObjs
      const objs = name.startsWith('g_') ? page.commonObjs : page.objs;
      img = await new Promise<PdfImage | null>((resolve) => {
        try {
          objs.get(name, (x: unknown) => resolve(x as PdfImage));
        } catch {
          resolve(null);
        }
      });
    } else if (fn === pdfjs.OPS.paintInlineImageXObject) img = args[0] as PdfImage;
    if (img && Math.min(img.width, img.height) >= MIN_SCAN_SIDE)
      if (!best || img.width * img.height > best.width * best.height) best = img;
  }
  return best;
}

/**
 * Распознать сканы страниц: tesseract.js с языками rus и kir из node_modules. Слова переводятся в куски
 * текста в пунктах страницы; у слов одной строки — общая высота строки (как у текстового слоя).
 */
async function ocrPages(
  scans: { img: PdfImage; width: number; height: number }[],
  signal: Signal,
): Promise<DocumentText['pages']> {
  const { createWorker, OEM } = await import('tesseract.js');
  const data = await loadLangs();
  // Языки — из своих пакетов в разных папках: русский загружается по `langPath`, кыргызский
  // кладётся в файловую систему распознавателя. tesseract.js держит переданный массив как «уже
  // загруженные языки» — после добавления в него «kir» `reinitialize` не ищет файл заново.
  const langs: string[] = ['rus'];
  const worker = await createWorker(langs, OEM.LSTM_ONLY, {
    langPath: data.rusDir,
    gzip: true,
    cacheMethod: 'none',
    // Без своего обработчика tesseract.js бросает ошибку потока вне обещаний — она роняла бы весь
    // процесс сайта; ошибка и так приходит отказом createWorker или recognize.
    errorHandler: () => undefined,
  });
  // Время вышло — распознавание останавливается сразу, не дожидаясь конца страницы.
  signal.stop = () => void worker.terminate().catch(() => undefined);
  if (signal.cancelled) signal.stop();
  try {
    await worker.FS('writeFile', ['kir.traineddata', gunzipSync(data.kir)]);
    langs.push('kir');
    await worker.reinitialize('rus+kir', OEM.LSTM_ONLY);
    const pages: DocumentText['pages'] = [];
    for (const scan of scans) {
      if (signal.cancelled) break;
      const pnm = toPnm(scan.img);
      if (!pnm) {
        pages.push({ items: [] });
        continue;
      }
      const { data: page } = await worker.recognize(pnm, {}, { text: false, blocks: true });
      const sx = scan.width / scan.img.width;
      const sy = scan.height / scan.img.height;
      const items: DocumentTextItem[] = [];
      for (const b of page.blocks ?? [])
        for (const p of b.paragraphs)
          for (const l of p.lines) {
            const y = (scan.img.height - l.bbox.y1) * sy;
            const h = Math.max(1, (l.bbox.y1 - l.bbox.y0) * sy);
            for (const w of l.words) {
              const str = w.text.trim();
              if (str) items.push({ str, x: w.bbox.x0 * sx, y, w: (w.bbox.x1 - w.bbox.x0) * sx, h });
            }
          }
      pages.push({ items });
    }
    return pages;
  } finally {
    await worker.terminate().catch(() => undefined);
  }
}

/** «D:20261018153323Z» → «2026-10-18». */
const pdfDate = (s: unknown) => {
  const m = /D:(\d{4})(\d{2})(\d{2})/.exec(typeof s === 'string' ? s : '');
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
};

/** Остановка чтения по времени: признак, задача pdf.js и распознаватель, если он уже запущен. */
interface Signal {
  cancelled: boolean;
  task?: PdfTask;
  stop?: () => void;
}

async function readPdf(
  bytes: Uint8Array,
  o: typeof DEFAULTS,
  signal: Signal,
): Promise<DocumentReadResult> {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    disableFontFace: true,
    stopAtErrors: false,
    verbosity: 0,
  });
  signal.task = task;
  let doc: PdfDocument;
  try {
    doc = await task.promise;
  } catch (e) {
    await task.destroy().catch(() => undefined);
    const name = (e as { name?: string } | null)?.name ?? '';
    return { ok: false, error: /password/i.test(name) ? 'password' : 'broken' };
  }
  try {
    const n = Math.min(doc.numPages, o.maxPages);
    const pages: DocumentText['pages'] = [];
    const sizes: { width: number; height: number }[] = [];
    for (let p = 1; p <= n && !signal.cancelled; p++) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      sizes.push({ width: vp.width, height: vp.height });
      const tc = await page.getTextContent();
      const items: DocumentTextItem[] = [];
      for (const i of tc.items) {
        if (!('str' in i) || !i.str || !i.str.trim()) continue;
        items.push({
          str: i.str,
          x: i.transform[4] as number,
          y: i.transform[5] as number,
          w: i.width,
          h: Math.abs(i.transform[3] as number) || 10,
        });
      }
      pages.push({ items });
    }
    let created = '';
    try {
      created = pdfDate(((await doc.getMetadata()).info as { CreationDate?: unknown }).CreationDate);
    } catch {
      created = '';
    }
    const chars = pages.reduce((a, pg) => a + pg.items.reduce((b, i) => b + i.str.trim().length, 0), 0);
    if (chars >= o.minChars) return { ok: true, doc: { pages, created, ocr: false } };
    // Текста нет — скан или фото: распознаём картинки первых страниц
    const scans: { img: PdfImage; width: number; height: number }[] = [];
    for (let p = 1; p <= Math.min(n, o.ocrPages) && !signal.cancelled; p++) {
      const img = await pageScan(pdfjs, await doc.getPage(p));
      if (img) scans.push({ img, ...sizes[p - 1]! });
    }
    if (!scans.length) return { ok: false, error: 'no_text' };
    const run = ocrQueue.then(() => (signal.cancelled ? [] : ocrPages(scans, signal)));
    ocrQueue = run.catch(() => undefined);
    const ocr = await run;
    const found = ocr.reduce((a, pg) => a + pg.items.reduce((b, i) => b + i.str.length, 0), 0);
    if (found < o.minChars) return { ok: false, error: 'no_text' };
    return { ok: true, doc: { pages: ocr, created, ocr: true } };
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

/** Настоящее чтение PDF: текстовый слой, иначе распознавание скана; не дольше `timeoutMs`. */
export function createDocumentReader(options: DocumentReaderOptions = {}): DocumentReader {
  const o = { ...DEFAULTS, ...options };
  return {
    async read(bytes) {
      if (!isPdf(bytes)) return { ok: false, error: 'broken' };
      const signal: Signal = { cancelled: false };
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<DocumentReadResult>((resolve) => {
        timer = setTimeout(() => {
          signal.cancelled = true;
          void signal.task?.destroy().catch(() => undefined);
          signal.stop?.();
          resolve({ ok: false, error: 'timeout' });
        }, o.timeoutMs);
      });
      try {
        return await Promise.race([
          readPdf(bytes, o, signal).catch((): DocumentReadResult => ({ ok: false, error: 'broken' })),
          timeout,
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** PDF начинается с «%PDF-» (в первых 1024 байтах, как принимают просмотрщики). */
export function isPdf(bytes: Uint8Array): boolean {
  const head = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.length, 1024)).toString(
    'latin1',
  );
  return head.includes('%PDF-');
}

/**
 * Поддельное чтение для тестов: ответ по содержимому файла (строка в UTF-8) — текст документа или
 * ошибка; неизвестный файл — «broken».
 */
export function createFakeDocumentReader(
  answers: Readonly<Record<string, DocumentReadResult>>,
): DocumentReader & { calls: number } {
  const fake = {
    calls: 0,
    read(bytes: Uint8Array) {
      fake.calls += 1;
      const key = Buffer.from(bytes).toString('utf8');
      return Promise.resolve(answers[key] ?? { ok: false as const, error: 'broken' as const });
    },
  };
  return fake;
}
