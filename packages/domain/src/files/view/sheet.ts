/**
 * Модель листа для окна просмотра (XLSX, XLS, CSV): значения уже строками «как в файле», ширины
 * столбцов, объединённые ячейки, жирный шрифт. Модель — простые данные: её передают из отдельного
 * потока браузера (Worker), где файл разбирался, в окно.
 */

/** Строк листа в окне — не больше (ТЗ: больше 5 000 — первые 5 000 и «Скачайте, чтобы увидеть всё»). */
export const SHEET_MAX_ROWS = 5_000;
/** Столбцов листа в окне — не больше (A…IV). */
export const SHEET_MAX_COLS = 256;
/** Листов книги — не больше. */
export const SHEET_MAX_SHEETS = 100;
/** Объединений ячеек на лист — не больше. */
export const SHEET_MAX_MERGES = 5_000;
/** Ячеек, которые проверка объединений листа просматривает, — не больше (файл не вешает разбор). */
export const SHEET_MERGE_CELLS_BUDGET = 4_000_000;
/** Знаков в ячейке — не больше (как в Excel). */
export const SHEET_MAX_CELL_CHARS = 32_767;
/** Знаков во всех ячейках книги — не больше: модель копируется из потока разбора в окно. */
export const SHEET_MAX_BOOK_CHARS = 16_000_000;

/**
 * Объединения листа в пределах окна (docs/deviations.md п. И-12): углы — в пределах
 * `SHEET_MAX_ROWS` × `SHEET_MAX_COLS`, пересекающиеся с уже принятыми отбрасываются (Excel их не
 * допускает), не больше `SHEET_MAX_MERGES` и `SHEET_MERGE_CELLS_BUDGET` просмотренных ячеек. Так окно
 * рисует объединения за время, пропорциональное самому листу, а не числам из файла.
 */
export function sheetMergeCollector() {
  const list: SheetView['merges'] = [];
  let taken: Uint8Array | null = null;
  let budget = SHEET_MERGE_CELLS_BUDGET;
  return {
    list,
    add(r1: number, c1: number, r2: number, c2: number) {
      if (list.length >= SHEET_MAX_MERGES || budget <= 0) return;
      if (![r1, c1, r2, c2].every(Number.isInteger) || r1 < 0 || c1 < 0) return;
      if (r1 >= SHEET_MAX_ROWS || c1 >= SHEET_MAX_COLS) return;
      const rb = Math.min(r2, SHEET_MAX_ROWS - 1);
      const cb = Math.min(c2, SHEET_MAX_COLS - 1);
      if (rb < r1 || cb < c1) return;
      const area = (rb - r1 + 1) * (cb - c1 + 1);
      // Просмотр и отметка — по разу на ячейку.
      budget -= 2 * area;
      if (budget < 0) return;
      taken ??= new Uint8Array(SHEET_MAX_ROWS * SHEET_MAX_COLS);
      for (let r = r1; r <= rb; r++)
        for (let c = c1; c <= cb; c++) if (taken[r * SHEET_MAX_COLS + c]) return;
      for (let r = r1; r <= rb; r++)
        taken.fill(1, r * SHEET_MAX_COLS + c1, r * SHEET_MAX_COLS + cb + 1);
      list.push([r1, c1, rb, cb]);
    },
  };
}

export interface SheetCell {
  /** Текст ячейки, как его показывает Excel. */
  v: string;
  b?: true;
  i?: true;
  u?: true;
  /** Выравнивание по горизонтали; без него — число вправо, текст влево. */
  al?: 'l' | 'c' | 'r';
  /** Значение — число (выравнивание вправо по умолчанию). */
  num?: true;
  wrap?: true;
  /** Цвет текста и заливки из файла `#RRGGBB` (чёрный текст и белая заливка — по теме окна). */
  color?: string;
  bg?: string;
}

export interface SheetView {
  name: string;
  /** Ширина столбца в px по номеру столбца (0 — скрыт). */
  cols: number[];
  /** Строки по порядку с первой; пустая строка — пустой массив. */
  rows: (SheetCell | null)[][];
  /** Высоты строк в px, где они заданы. */
  heights: Record<number, number>;
  /** Скрытые строки (номер с 0). */
  hiddenRows: number[];
  /** Объединённые ячейки: [строка1, столбец1, строка2, столбец2] с 0. */
  merges: [number, number, number, number][];
  /** Сколько строк в листе всего (может быть больше показанных). */
  totalRows: number;
  /** Столбцы обрезаны пределом. */
  colsCut: boolean;
}

export interface BookView {
  kind: 'sheet';
  sheets: SheetView[];
}

/**
 * Предел текста книги для окна: ячейка — до `SHEET_MAX_CELL_CHARS` знаков, вся книга — до
 * `SHEET_MAX_BOOK_CHARS`; дальше строки не показываются («Показаны первые …», как у предела строк).
 * Одна общая строка XLSX на тысячах ячеек при передаче из потока разбора копируется в каждую.
 */
export function capBookText(book: BookView): BookView {
  let left = SHEET_MAX_BOOK_CHARS;
  for (const sheet of book.sheets) {
    for (let r = 0; r < sheet.rows.length; r++) {
      const row = sheet.rows[r]!;
      let size = 0;
      for (const cell of row) {
        if (!cell) continue;
        if (cell.v.length > SHEET_MAX_CELL_CHARS) cell.v = cell.v.slice(0, SHEET_MAX_CELL_CHARS);
        size += cell.v.length;
      }
      left -= size;
      if (left < 0) {
        sheet.rows.length = r;
        left = 0;
        break;
      }
    }
  }
  return book;
}

/** «AB» → 27 (с 0). */
export function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** 27 → «AB». */
export function colLetters(i: number): string {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** «B3» → [2, 1] (строка, столбец с 0); не ссылка — `null`. */
export function cellRef(ref: string): [number, number] | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(ref.trim());
  return m ? [Number(m[2]) - 1, colIndex(m[1]!)] : null;
}

/** Ширина столбца Excel (в знаках) в px. */
export const colWidthPx = (chars: number) => Math.max(0, Math.round(chars * 7 + 5));

export const DEFAULT_COL_PX = 64;

/** Число в тексте CSV — выравнивается вправо. */
export const looksNumeric = (s: string) => /^[-+]?\d[\d\s\u00a0]*([.,]\d+)?%?$/.test(s.trim());

/** Лист из строк CSV. */
export function csvSheet(name: string, rows: string[][], total: number): SheetView {
  let width = 0;
  for (const r of rows) width = Math.max(width, r.length);
  const colsCut = width > SHEET_MAX_COLS;
  width = Math.min(width, SHEET_MAX_COLS);
  return {
    name,
    cols: Array.from({ length: width }, () => DEFAULT_COL_PX * 1.5),
    rows: rows
      .slice(0, SHEET_MAX_ROWS)
      .map((r) =>
        r
          .slice(0, SHEET_MAX_COLS)
          .map((v) => (v === '' ? null : looksNumeric(v) ? { v, num: true as const } : { v })),
      ),
    heights: {},
    hiddenRows: [],
    merges: [],
    totalRows: total,
    colsCut,
  };
}
