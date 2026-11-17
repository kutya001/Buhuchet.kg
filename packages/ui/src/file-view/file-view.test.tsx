import {
  parseFileView,
  type DocView,
  type FileViewModel,
  type SheetView,
  type SlidesView,
} from '@buhuchet/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  DocumentView,
  SheetBookView,
  SheetTable,
  SlidesView as SlidesViewBox,
  TextFileView,
  XmlFileView,
  type FileViewLabels,
} from './file-view';
import {
  chunkOfLongWord,
  docCellShares,
  docColShares,
  hitsByRow,
  LAZY_MAX_LINES,
  MERGE_SKIP_MAX,
  mergeMap,
  rotateNext,
  scrollsToward,
  searchKey,
  SHEET_CELL_SHOW,
  sheetCellFit,
  sheetCellText,
  SHEET_RENDER_STEP,
  SHEET_ROW_CHARS,
  SHEET_ROW_LAZY,
  sheetRowPlan,
  SHEET_STEP_CHARS,
  SHEET_STEP_PLACES,
  sheetWrapMinPx,
  sheetWrapPx,
  segmentStarts,
  shareLineChars,
  shareMinLineChars,
  shareSegment,
  sheetHits,
  SHEET_WRAP_MAX_PX,
  sheetStepEnd,
  swipeDirection,
  TEXT_CHUNK,
  textChunks,
  textLines,
  textMinLines,
  TEXT_SEGMENT,
  xmlBranches,
  xmlClosed,
  xmlDepth,
  xmlHits,
  XML_OPEN_DEPTH,
  zoomNext,
  ZOOM_MAX,
  ZOOM_MIN,
} from './file-view-model';

const labels: FileViewLabels = {
  zoomIn: 'Увеличить',
  zoomOut: 'Уменьшить',
  rotate: 'Повернуть',
  fit: 'Вписать',
  sheetSearch: 'Найти на листе',
  xmlSearch: 'Найти в XML',
  found: (n) => `Найдено: ${n}`,
  notFound: 'Ничего не найдено',
  moreRows: (shown, total) => `Показаны первые ${shown} строк из ${total}`,
  moreAll: 'Показана первая часть файла',
  prevSlide: 'Предыдущий слайд',
  nextSlide: 'Следующий слайд',
  slideOf: (n, total) => `Слайд ${n} из ${total}`,
  encoding: (enc) => `Кодировка: ${enc}`,
  collapseAll: 'Свернуть всё',
  expandAll: 'Развернуть всё',
  collapse: (name) => `Свернуть ${name}`,
  expand: (name) => `Развернуть ${name}`,
  doctype: 'В файле есть объявление DOCTYPE — внешнее не загружалось',
  emptySheet: 'В книге нет листов',
  openTab: 'Открыть в новой вкладке',
};

const enc = (s: string) => new TextEncoder().encode(s);

/** Лист для правил: 3 строки, объединение A1:B1, скрытая строка 2. */
const sheet: SheetView = {
  name: 'Лист1',
  cols: [80, 80, 0, 80],
  rows: [
    [{ v: 'Ёлка и ель', b: true }, null, null, { v: '1 250,50', num: true }],
    [{ v: 'скрытая' }],
    [{ v: 'ЕЛЬ' }, { v: 'Итого' }],
  ],
  heights: {},
  hiddenRows: [1],
  merges: [
    [0, 0, 0, 1],
    [2, 2, 2, 2],
  ],
  totalRows: 3,
  colsCut: false,
};

async function model<K extends FileViewModel['kind']>(name: string, bytes: Uint8Array, kind: K) {
  const m = await parseFileView(name, bytes);
  expect(m.kind).toBe(kind);
  return m as Extract<FileViewModel, { kind: K }>;
}

describe('правила окна просмотра', () => {
  it('масштаб 25–400 % шагом 25 %, поворот по кругу', () => {
    expect(zoomNext(1, 1)).toBe(1.25);
    expect(zoomNext(ZOOM_MIN, -1)).toBe(ZOOM_MIN);
    expect(zoomNext(ZOOM_MAX, 1)).toBe(ZOOM_MAX);
    expect(rotateNext(270)).toBe(0);
    expect(rotateNext(0)).toBe(90);
  });

  it('жест вбок: не короче 70 px и не наискосок; влево — следующий', () => {
    expect(swipeDirection(-80, 10)).toBe(1);
    expect(swipeDirection(90, -20)).toBe(-1);
    expect(swipeDirection(-60, 0)).toBe(0);
    expect(swipeDirection(-100, 70)).toBe(0);
  });

  it('широкая таблица сама прокручивается в сторону жеста — это не листание', () => {
    const el = { scrollWidth: 1000, clientWidth: 400, scrollLeft: 0 };
    expect(scrollsToward(el, 1)).toBe(true);
    expect(scrollsToward(el, -1)).toBe(false);
    expect(scrollsToward({ ...el, scrollLeft: 600 }, 1)).toBe(false);
    expect(scrollsToward({ scrollWidth: 400, clientWidth: 400, scrollLeft: 0 }, 1)).toBe(false);
  });

  it('поиск без учёта регистра и «ё/е», по порядку строк', () => {
    expect(searchKey('  Ёлка ')).toBe('елка');
    expect(sheetHits(sheet, 'ель')).toEqual([
      [0, 0],
      [2, 0],
    ]);
    expect(sheetHits(sheet, '   ')).toEqual([]);
    // Скрытые строки и столбцы не ищутся: перейти к ним нельзя.
    expect(sheetHits(sheet, 'скрытая')).toEqual([]);
    expect(
      sheetHits(
        { ...sheet, rows: [[{ v: 'а' }, null, { v: 'а' }, { v: 'а' }]], hiddenRows: [] },
        'а',
      ),
    ).toEqual([
      [0, 0],
      [0, 3],
    ]);
    // Пробел в числе — неразрывный, как в Excel; ищется обычным.
    expect(sheetHits({ ...sheet, rows: [[{ v: '1 250', num: true }]] }, '1 250')).toEqual([[0, 0]]);
  });

  it('объединённые ячейки: span у первой, закрытые — skip; скрытые строки и столбцы не считаются', () => {
    const m = mergeMap(sheet);
    expect(m.span.get('0:0')).toEqual({ rows: 1, cols: 2 });
    expect(m.skip.has('0:1')).toBe(true);
    // Одна ячейка «объединена сама с собой» — ничего не меняет.
    expect(m.span.has('2:2')).toBe(false);
    const hid = mergeMap({ ...sheet, merges: [[0, 1, 1, 2]] });
    expect(hid.span.get('0:1')).toEqual({ rows: 1, cols: 1 });
  });

  it('объединения — только по нарисованным строкам и в общем пределе отмеченных ячеек (защита, п. И-12)', () => {
    const tall = {
      ...sheet,
      rows: Array.from({ length: 5000 }, () => []),
      hiddenRows: [],
      cols: [64, 64, 64],
      merges: [[0, 0, 4999, 1]] as SheetView['merges'],
    };
    const m = mergeMap(tall, 100);
    expect(m.span.get('0:0')).toEqual({ rows: 100, cols: 2 });
    expect(m.skip.size).toBe(100 * 2 - 1);
    expect(m.skip.has('100:0')).toBe(false);
    // Ниже нарисованного объединения не просматриваются.
    expect(mergeMap({ ...tall, merges: [[200, 0, 300, 1]] }, 100).span.size).toBe(0);
    // Чужая модель с огромными пересекающимися объединениями: отмечено не больше предела.
    const huge = mergeMap({
      ...tall,
      merges: Array.from(
        { length: 50 },
        () => [0, 0, 4999, 255] as [number, number, number, number],
      ),
    });
    expect(huge.skip.size).toBeLessThanOrEqual(MERGE_SKIP_MAX);
    // Объединение больше предела пропущено одно: следующее — на месте.
    const next = mergeMap({
      ...tall,
      cols: Array.from({ length: 256 }, () => 64),
      merges: [
        [0, 0, 4999, 200],
        [0, 201, 1, 202],
      ],
    });
    expect(next.span.has('0:0')).toBe(false);
    expect(next.span.get('0:201')).toEqual({ rows: 2, cols: 2 });
    // Ниже данных листа — тоже нет: строк в листе 3, объединение на 5 000.
    expect(mergeMap({ ...tall, rows: [[], [], []] }).span.get('0:0')).toEqual({ rows: 3, cols: 2 });
  });

  it('шаг отрисовки листа — по строкам, местам и знакам; хоть одна строка, скрытые не считаются (п. И-12)', () => {
    const none = new Set<number>();
    const empty = (n: number): SheetView => ({
      ...sheet,
      rows: Array.from({ length: n }, () => []),
    });
    // Узкий лист — до 300 строк за шаг.
    expect(sheetStepEnd(empty(5000), 0, 3, none)).toBe(SHEET_RENDER_STEP);
    expect(sheetStepEnd(empty(5000), 4900, 3, none)).toBe(5000);
    // Широкий лист из пустых строк — по местам «строки × столбцы».
    expect(sheetStepEnd(empty(5000), 0, 256, none)).toBe(Math.floor(SHEET_STEP_PLACES / 256));
    // Скрытые строки шаг не тратят.
    const hidden = new Set(Array.from({ length: 1000 }, (_, i) => i));
    expect(sheetStepEnd(empty(5000), 0, 3, hidden)).toBe(1000 + SHEET_RENDER_STEP);
    expect(sheetStepEnd(empty(1000), 0, 3, hidden)).toBe(1000);
    // Длинный текст — по знакам: в ячейке на экране до 1 024.
    const long: SheetView = {
      ...sheet,
      rows: Array.from({ length: 500 }, () => [{ v: 'я'.repeat(30_000) }]),
    };
    expect(sheetStepEnd(long, 0, 1, none)).toBe(Math.floor(SHEET_STEP_CHARS / SHEET_CELL_SHOW));
    // Строка больше шага — всё равно рисуется: окно не встаёт.
    expect(sheetStepEnd(empty(10), 3, SHEET_STEP_PLACES * 2, none)).toBe(4);
    expect(sheetCellText('я'.repeat(5000))).toHaveLength(SHEET_CELL_SHOW);
    expect(sheetCellText('я'.repeat(5000), 30)).toHaveLength(30);
    expect(sheetCellText('коротко')).toBe('коротко');
    // Строка, где текста больше предела строки, шаг тратит как предел строки, а не как весь текст.
    const wideRow: SheetView = {
      ...sheet,
      rows: Array.from({ length: 50 }, () =>
        Array.from({ length: 256 }, () => ({ v: 'я'.repeat(1000) })),
      ),
    };
    expect(sheetStepEnd(wideRow, 0, 256, none)).toBe(
      Math.floor(SHEET_STEP_CHARS / SHEET_ROW_CHARS),
    );
  });

  it('ячейка листа показывает, сколько может быть видно; длинная строка — поровну и у экрана (п. И-12)', () => {
    // Без переноса — одна строка до края ячейки (знак не уже 3 px), с переносом — 35 строк.
    expect(sheetCellFit(64, false)).toBe(23);
    expect(sheetCellFit(64, true)).toBe(23 * 35);
    expect(sheetCellFit(0, false)).toBe(2);
    expect(sheetCellFit(-5, true)).toBe(70);
    expect(sheetCellFit(100_000, false)).toBe(SHEET_CELL_SHOW);
    const text = 'я'.repeat(5000);
    // Обычная строка: каждая ячейка — по своей ширине, раскладывается сразу.
    const plain = sheetRowPlan(
      [{ v: 'Итого' }, null, { v: text }, { v: text, wrap: true }],
      () => 64,
    );
    expect(plain).toEqual({ show: [5, 0, 23, 805], lazy: false });
    // Текста больше 2 048 знаков — ячейки строки раскладываются у экрана.
    const heavy = sheetRowPlan(
      Array.from({ length: 4 }, () => ({ v: text, wrap: true as const })),
      () => 64,
    );
    expect(heavy.show).toEqual([805, 805, 805, 805]);
    expect(805 * 4).toBeGreaterThan(SHEET_ROW_LAZY);
    expect(heavy.lazy).toBe(true);
    // Больше предела строки — ячейки показывают поровну: вся строка — не больше 16 384 знаков.
    const full = sheetRowPlan(
      Array.from({ length: 256 }, () => ({ v: text, wrap: true as const })),
      () => 1790,
    );
    expect(full.show.every((n) => n === SHEET_ROW_CHARS / 256)).toBe(true);
    expect(full.lazy).toBe(true);
    // Место под ячейку с переносом — по тексту и ширине, не выше строки Excel.
    expect(sheetWrapPx(100, 84)).toBe(160);
    expect(sheetWrapPx(1024, 64)).toBe(545);
    expect(sheetWrapPx(1, 0)).toBe(16);
  });

  it('длинный текст — кусками до 128 знаков по пробелу, пара UTF-16 не режется (п. И-12)', () => {
    expect(textChunks('коротко')).toBe('коротко');
    const words = 'я '.repeat(1000);
    const parts = textChunks(words) as string[];
    expect(parts.join('')).toBe(words);
    expect(parts.every((x) => x.length <= TEXT_CHUNK && x.endsWith(' '))).toBe(true);
    // Без пробелов — ровно по пределу; эмодзи (пара UTF-16) остаётся целым.
    expect(textChunks('а'.repeat(300))).toEqual(['а'.repeat(128), 'а'.repeat(128), 'а'.repeat(44)]);
    const emoji = textChunks(`a${'😀'.repeat(200)}`) as string[];
    expect(emoji.join('')).toBe(`a${'😀'.repeat(200)}`);
    for (const x of emoji) {
      expect(x.length).toBeLessThanOrEqual(TEXT_CHUNK);
      const end = x.charCodeAt(x.length - 1);
      expect(end >= 0xd800 && end <= 0xdbff).toBe(false);
    }
  });

  it('текст без пробелов режется за один проход: 4 млн знаков — не секунды (п. И-12)', () => {
    // Поиск пробела назад по всей строке — квадрат: 2 млн знаков шли 5 с на каждую перерисовку.
    expect(textChunks('я'.repeat(300), 0)).toBe('я'.repeat(300));
    // Запас по времени большой: за один проход 4 млн знаков — десятки мс, за квадрат — 20 с.
    for (const sign of ['я', 'A', '😀']) {
      const text = sign.repeat(4_000_000 / sign.length);
      const started = performance.now();
      const parts = textChunks(text) as string[];
      expect(performance.now() - started).toBeLessThan(5000);
      expect(parts.length).toBeGreaterThanOrEqual(text.length / TEXT_CHUNK);
      expect(parts.reduce((n, x) => n + x.length, 0)).toBe(text.length);
    }
    // Пробел только в начале: дальше одно длинное «слово».
    const tail = textChunks(`а б ${'в'.repeat(1000)}`) as string[];
    expect(tail[0]).toBe('а б ');
    expect(tail.slice(1, -1).every((x) => x.length === TEXT_CHUNK)).toBe(true);
  });

  it('кусок длинного слова без пробелов переносится по любому знаку (п. И-12)', async () => {
    const word = textChunks('я'.repeat(300)) as string[];
    // Хвост длинного слова — тоже его часть.
    expect(word.map((_, i) => chunkOfLongWord(word, i))).toEqual([true, true, true]);
    // После длинного слова кусок кончается на его первом пробеле: обычный текст дальше — как был.
    const mixed = textChunks(`${'я'.repeat(200)} обычный текст\tпосле слова`) as string[];
    expect(mixed).toEqual(['я'.repeat(128), `${'я'.repeat(72)} `, 'обычный текст\tпосле слова']);
    expect(mixed.map((_, i) => chunkOfLongWord(mixed, i))).toEqual([true, true, false]);
    // Табуляция — такое же место переноса, как пробел.
    const tabs = textChunks('имя\t'.repeat(100)) as string[];
    expect(tabs.some((_, i) => chunkOfLongWord(tabs, i))).toBe(false);
    const prose = textChunks('слово '.repeat(100)) as string[];
    expect(prose.some((_, i) => chunkOfLongWord(prose, i))).toBe(false);
    const text = await model('w.txt', enc(`${'я'.repeat(300)}\n${'слово '.repeat(100)}`), 'text');
    const html = renderToStaticMarkup(<TextFileView model={text} labels={labels} />);
    expect(html.split('<span class="break-all">')).toHaveLength(4);
    expect(html).toContain(`<span class="break-all">${'я'.repeat(TEXT_CHUNK)}</span>`);
    const xml = await model(
      'w.xml',
      enc(`<r k="${'A'.repeat(300)}">${'я'.repeat(300)}</r>`),
      'xml',
    );
    const tree = renderToStaticMarkup(<XmlFileView model={xml} labels={labels} />);
    expect(tree.split('<span class="break-all">')).toHaveLength(7);
    // Имя узла и атрибута — такой же текст файла: длинное режется так же.
    const name = 'я'.repeat(300);
    const named = await model('n.xml', enc(`<${name} ${name}="1">т</${name}>`), 'xml');
    const names = renderToStaticMarkup(<XmlFileView model={named} labels={labels} />);
    expect(names.split('<span class="break-all">')).toHaveLength(10);
  });

  it('длинный текст — блоками до 8 192 знаков, блок раскладывается у экрана (п. И-12)', async () => {
    expect(segmentStarts([])).toEqual([0]);
    expect(segmentStarts([100, 200, 300])).toEqual([0]);
    // Блок закрывается, когда следующий кусок в него не входит; кусок длиннее блока — один.
    expect(segmentStarts([5000, 3000, 200, 9000, 1, 8191, 1])).toEqual([0, 2, 3, 4, 6]);
    // Место под блок — по длине текста: 100 знаков в строке, строка — 20 px.
    expect([0, 1, 100, 101, 8192].map((n) => textLines(n))).toEqual([1, 1, 1, 2, 82]);
    expect(textLines(100, 0)).toBe(100);
    // Наименьшая высота блока — строка на каждую тысячу знаков; тексту в одну строку она не нужна.
    expect([0, 1000, 1001, 8192, 2_000_000].map((n) => textMinLines(n))).toEqual([
      0, 0, 2, 9, 2000,
    ]);
    const lazy = (lines: number, min = 0) =>
      `style="content-visibility:auto;contain-intrinsic-size:none auto ${lines * 20}px` +
      `${min ? `;min-height:${min * 20}px` : ''}"`;
    // Блоки разметки: [строк места, строк наименьшей высоты].
    const blocks = (html: string) =>
      [
        ...html.matchAll(
          /<span class="block[^"]*" style="[^"]*none auto (\d+)px(?:;min-height:(\d+)px)?">/g,
        ),
      ].map((m) => [Number(m[1]) / 20, Number(m[2] ?? 0) / 20]);
    // Строка текста в 20 000 знаков — три блока (куски по 126 знаков: 65 кусков в блоке); между
    // кусками — место переноса. Место под строку и под каждый блок — по их длине.
    const line = 'слово '.repeat(20_000 / 6);
    const text = await model('l.txt', enc(`коротко\n${line}`), 'text');
    const html = renderToStaticMarkup(<TextFileView model={text} labels={labels} />);
    expect(blocks(html)).toEqual([
      [1, 0],
      [200, 20],
      [82, 9],
      [82, 9],
      [37, 4],
    ]);
    expect(html.split('<wbr/>').length).toBeGreaterThan(line.length / TEXT_CHUNK);
    expect(html.replace(/<[^>]+>/g, '')).toContain(line);
    // Абзац Word из 300 кусков по 100 знаков — тоже блоками (по 81 куску), абзац бумаги — у экрана.
    const runs = Array.from({ length: 300 }, () => ({ t: 'я'.repeat(99) + ' ' }));
    const doc: DocView = { kind: 'doc', blocks: [{ k: 'p', runs }], images: {}, cut: false };
    const paper = renderToStaticMarkup(<DocumentView model={doc} labels={labels} />);
    expect(blocks(paper)).toEqual([
      [81, 9],
      [81, 9],
      [81, 9],
      [57, 6],
    ]);
    expect(paper).toMatch(new RegExp(`<p class="[^"]*" ${lazy(300, 30)}>`));
    // XML: имя и атрибуты длиннее блока — каждый атрибут своей строкой, блоки — по строкам
    // атрибутов (по две строки на атрибут в 106–107 знаков); сам узел — у экрана.
    const attrs = Array.from({ length: 100 }, (_, i) => `a${i}="${'я'.repeat(100)}"`).join(' ');
    const xml = await model('a.xml', enc(`<r ${attrs}><b k="1"/></r>`), 'xml');
    const tree = renderToStaticMarkup(<XmlFileView model={xml} labels={labels} />);
    expect(tree.split('<span class="block pl-4">')).toHaveLength(101);
    expect(blocks(tree)).toEqual([
      [76 * 2, 9],
      [24 * 2, 3],
    ]);
    expect(tree).toContain(`data-xn="0" ${lazy(1)}`);
  });

  it('текст из знаков без ширины держит высоту по числу знаков (п. И-12)', async () => {
    // После раскладки такой текст — одна строка: без наименьшей высоты при возврате к этому месту
    // в кадр попадала сотня блоков. Высота — строка (20 px) на каждую тысячу знаков.
    const lazy = (lines: number, min: number) =>
      `style="content-visibility:auto;contain-intrinsic-size:none auto ${lines * 20}px` +
      `;min-height:${min * 20}px"`;
    const zero = '\u200e\u200f'.repeat(3950);
    const text = await model('z.txt', enc(`${zero}\nкоротко\n${'я'.repeat(1000)}`), 'text');
    const html = renderToStaticMarkup(<TextFileView model={text} labels={labels} />);
    expect(html).toContain(`<span class="block" ${lazy(79, 8)}>`);
    // Строке до тысячи знаков наименьшая высота не нужна: её высота — как была.
    expect(html.split('min-height')).toHaveLength(2);
    // Абзац Word и узел XML — так же; у свёрнутого узла текста на экране нет — и высоты под него.
    const doc: DocView = {
      kind: 'doc',
      blocks: [
        { k: 'p', runs: [{ t: zero }] },
        { k: 'p', runs: [{ t: 'коротко' }] },
      ],
      images: {},
      cut: false,
    };
    const paper = renderToStaticMarkup(<DocumentView model={doc} labels={labels} />);
    expect(paper).toMatch(new RegExp(`<p class="[^"]*" ${lazy(79, 8)}>`));
    expect(paper.split('min-height')).toHaveLength(2);
    const xml = await model('z.xml', enc(`<r><a>${zero}</a><b>${zero}<c/></b></r>`), 'xml');
    const tree = renderToStaticMarkup(<XmlFileView model={xml} labels={labels} />);
    expect(tree).toContain(`data-xn="0-0" ${lazy(80, 8)}`);
    expect(tree).toContain(`data-xn="0-1" ${lazy(80, 8)}`);
    // Имя узла в строке дважды (и в закрывающем теге) — в счёт тоже дважды.
    const pair = await model(
      'p.xml',
      enc(`<r><${'a'.repeat(600)}>${'б'.repeat(600)}</${'a'.repeat(600)}></r>`),
      'xml',
    );
    const pairTree = renderToStaticMarkup(<XmlFileView model={pair} labels={labels} />);
    expect(pairTree).toContain(`data-xn="0-0" ${lazy(18, 2)}`);
    // Строка длиннее блока раскладки (имя из знаков без ширины, текст, снова имя — почти 16 000
    // знаков) — текст и закрывающий тег своими блоками: в строке — не больше одного блока.
    const name = '\u200e\u200f'.repeat(3999);
    const leaf = await model('n.xml', enc(`<r><${name}>т</${name}></r>`), 'xml');
    const leafTree = renderToStaticMarkup(<XmlFileView model={leaf} labels={labels} />);
    expect(leafTree).toContain(`data-xn="0-0" ${lazy(80, 8)}`);
    expect(leafTree).toContain(`<span class="block text-info" ${lazy(80, 8)}>`);
    // У узла с вложенными — так же: текст длиннее блока своей строкой.
    const head = await model('h.xml', enc(`<r>${'я'.repeat(9000)}<c/></r>`), 'xml');
    const headTree = renderToStaticMarkup(<XmlFileView model={head} labels={labels} />);
    expect(headTree).toContain(
      `data-xn="0" style="content-visibility:auto;contain-intrinsic-size:none auto 20px"`,
    );
    expect(headTree).toContain(`<span class="block" ${lazy(90, 9)}>`);
    // В ячейке таблицы документа — по её доле ширины, но не меньше 4 знаков в строке.
    expect([1, 0.25, 1 / 63, 0, 5].map(shareMinLineChars)).toEqual([1000, 250, 15, 4, 1000]);
    // Место под блок — не больше 50 000 строк: высоту в десятки миллионов px браузер не прокручивает.
    const cell = { blocks: [{ k: 'p' as const, runs: [{ t: '\u200e'.repeat(240_000) }] }] };
    const narrow = renderToStaticMarkup(
      <DocumentView
        model={{
          kind: 'doc',
          blocks: [{ k: 't', cols: Array.from({ length: 63 }, () => 1), rows: [[cell]] }],
          images: {},
          cut: false,
        }}
        labels={labels}
      />,
    );
    // 240 000 знаков по 4 в строке — 60 000 строк места, остаётся 50 000; высота — по 15 знаков.
    expect(narrow).toMatch(new RegExp(`<p class="[^"]*" ${lazy(LAZY_MAX_LINES, 16_000)}>`));
    // Места блоков абзаца вместе — по 4 знака в строке, не по одному: 240 000 знаков — 1,2 млн px,
    // а не 4,8 млн (2 млн знаков по одному — 40 млн px, больше предела прокрутки браузера).
    const sum = [...narrow.matchAll(/<span class="block" style="[^"]*none auto (\d+)px/g)].reduce(
      (a, m) => a + Number(m[1]),
      0,
    );
    expect(sum).toBe((240_000 / 4) * 20);
    // Лист: ячейка с переносом из «тяжёлой» строки — не ниже строки на каждые столько знаков,
    // сколько самых узких помещается в её ширину (80 px — 28 знаков), и не выше предела Excel.
    expect(sheetWrapMinPx(28, 80)).toBe(0);
    expect(sheetWrapMinPx(29, 80)).toBe(32);
    expect(sheetWrapMinPx(980, 80)).toBe(SHEET_WRAP_MAX_PX);
    expect(sheetWrapMinPx(10, 0)).toBe(80);
    expect(sheetWrapMinPx(0, 80)).toBe(0);
  });

  it('таблица Word: ширины столбцов заданы, текст ячейки — блоками по её доле ширины (п. И-12)', () => {
    // В узком месте блок и строка короче во столько же раз, но блок — не короче куска текста.
    expect([1, 0.25, 1 / 63, 0, 5].map(shareSegment)).toEqual([
      TEXT_SEGMENT,
      2048,
      130,
      TEXT_CHUNK,
      TEXT_SEGMENT,
    ]);
    // В строке места — не меньше 4 знаков: места всех блоков документа вместе — до 10 млн px.
    expect([1, 0.25, 1 / 63, 0, 5].map(shareLineChars)).toEqual([100, 25, 4, 4, 100]);
    // Доли столбцов — по ширинам из файла, но столбец — не уже половины равной доли.
    expect(docColShares([1500, 4500])).toEqual([0.25, 0.75]);
    expect(docColShares([1, 1, 1, 1])).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(docColShares([1, 31_680]).map((x) => Math.round(x * 100))).toEqual([20, 80]);
    expect(docColShares([0, -5, Number.NaN])).toHaveLength(3);
    expect(docColShares([0, 0])).toEqual([0.5, 0.5]);
    // Ширина не числом — как незаданная.
    expect(docColShares([1, Number.POSITIVE_INFINITY])).toEqual([0.8, 0.2]);
    expect(docColShares([])).toEqual([]);
    // Доля ячейки — по столбцам, которые она занимает (с объединениями по вертикали сверху).
    expect(
      docCellShares(
        [0.125, 0.375, 0.5],
        [[{ rowSpan: 2 }, { span: 2 }], [{}, {}], [{ span: 3 }], [{}, {}, {}, { span: 5 }]],
      ),
    ).toEqual([[0.125, 0.875], [0.375, 0.5], [1], [0.125, 0.375, 0.5, 0]]);
    expect(docCellShares([], [[{}]])).toEqual([[0]]);
    const long = 'слово '.repeat(1000);
    const cell = (t: string) => ({ blocks: [{ k: 'p' as const, runs: [{ t }] }] });
    const doc: DocView = {
      kind: 'doc',
      blocks: [{ k: 't', cols: [1500, 4500], rows: [[cell(long), cell(long)], [cell('Итого')]] }],
      images: {},
      cut: false,
    };
    const html = renderToStaticMarkup(<DocumentView model={doc} labels={labels} />);
    expect(html).toContain('table-fixed');
    // Столбец — не уже 56 px: таблица шире бумаги прокручивается вбок в своём блоке.
    expect(html).toMatch(/<div class="overflow-x-auto"[^>]*><table[^>]*style="min-width:112px"/);
    expect(html).toContain('<colgroup><col style="width:25%"/><col style="width:75%"/></colgroup>');
    // [место, наименьшая высота], px.
    const px = (tag: string) =>
      [
        ...html.matchAll(
          new RegExp(`<${tag}[^>]*none auto (\\d+)px(?:;min-height:(\\d+)px)?"`, 'g'),
        ),
      ].map((m) => [Number(m[1]), Number(m[2] ?? 0)]);
    // Место под таблицу — по её тексту (12 005 знаков — 121 строка), под абзацы ячеек — по ширине
    // ячейки: 25 и 75 знаков в строке.
    // Наименьшая высота абзаца — по 250 и 750 знаков в строке; у таблицы её нет.
    expect(px('div')).toEqual([[121 * 20, 0]]);
    expect(px('p')).toEqual([
      [240 * 20, 24 * 20],
      [80 * 20, 8 * 20],
      [20, 0],
    ]);
    // Блоки текста: в ячейке на четверть ширины — до 2 048 знаков (16 кусков по 126 знаков), на три
    // четверти — до 6 144: там весь текст — один блок.
    expect(px('span class="block"')).toEqual([
      [81 * 20, 9 * 20],
      [81 * 20, 9 * 20],
      [79 * 20, 8 * 20],
    ]);
  });

  it('найденные ячейки — по строкам', () => {
    const m = hitsByRow([
      [2, 0],
      [2, 3],
      [7, 1],
    ]);
    expect([...(m.get(2) ?? [])]).toEqual([0, 3]);
    expect(m.has(3)).toBe(false);
  });

  it('XML: ветки глубже 32 уровней свёрнуты, пока их не развернули или там не найдено (п. И-12)', async () => {
    const none = new Set<string>();
    const deep = Array.from({ length: XML_OPEN_DEPTH + 1 }, () => '0').join('-');
    expect(xmlDepth('0')).toBe(0);
    expect(xmlDepth(deep)).toBe(XML_OPEN_DEPTH);
    expect(xmlClosed('0-1', none, none)).toBe(false);
    expect(xmlClosed(deep, none, none)).toBe(true);
    expect(xmlClosed(deep, new Set([deep]), none)).toBe(false);
    expect(xmlClosed('0-1', new Set(['0-1']), none)).toBe(true);
    expect(xmlClosed('0-1', new Set(['0-1']), new Set(['0-1']))).toBe(false);
    const xml = await model(
      'deep.xml',
      enc(`${'<a>'.repeat(40)}<b>в глубине</b>${'</a>'.repeat(40)}`),
      'xml',
    );
    const html = renderToStaticMarkup(<XmlFileView model={xml} labels={labels} />);
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('в глубине');
  });

  it('XML: найденное и ветки-предки раскрываются, «Свернуть всё» не трогает корень', async () => {
    const xml = await model(
      'r.xml',
      enc('<r><a k="ИНН"><b>01234</b></a><c><d>текст</d></c></r>'),
      'xml',
    );
    const root = xml.root;
    if (!root) throw new Error('нет корня');
    const { hits, open } = xmlHits(root, 'инн');
    expect([...hits]).toEqual(['0-0']);
    expect([...open]).toEqual(['0']);
    expect([...xmlHits(root, 'ТЕКСТ').open]).toEqual(['0', '0-1']);
    expect(xmlBranches(root)).toEqual(['0-0', '0-1']);
  });
});

describe('просмотр Excel', () => {
  it('буквы столбцов и номера строк, жирный, число вправо, скрытые строки и столбцы не рисуются', () => {
    const html = renderToStaticMarkup(
      <SheetTable sheet={sheet} hits={[[2, 0]]} current={[2, 0]} />,
    );
    expect(html).toContain('>A<');
    expect(html).toContain('>B<');
    expect(html).toContain('>D<');
    // Столбец C скрыт (ширина 0).
    expect(html).not.toContain('>C<');
    expect(html).not.toContain('скрытая');
    expect(html).toContain('colSpan="2"');
    expect(html).toMatch(/data-cell="0:3"[^>]*class="[^"]*text-right/);
    expect(html).toMatch(/data-cell="0:0"[^>]*class="[^"]*font-bold/);
    expect(html).toMatch(/data-cell="2:0"[^>]*class="[^"]*bg-caution-bg/);
  });

  it('ячейка: на экране — сколько может быть видно, с переносом — не выше строки Excel, весь текст в подсказке (п. И-12)', () => {
    const long = 'а'.repeat(5000);
    const one = (cell: SheetView['rows'][number][number]): SheetView => ({
      ...sheet,
      rows: [[cell]],
      hiddenRows: [],
      merges: [],
    });
    const shown = (html: string) =>
      html
        .match(/>(а+)</g)
        ?.join('')
        .replace(/[><]/g, '');
    const html = renderToStaticMarkup(
      <SheetTable sheet={one({ v: long, wrap: true })} hits={[]} current={null} />,
    );
    expect(html).toContain('max-height:545px');
    // Ширина таблицы — числом из ширин столбцов (46 + 80 + 80 + 80): текст её не раздвигает.
    expect(html).toMatch(/<table[^>]*style="width:286px;/);
    // С переносом в столбце 80 px — 35 строк по 28 знаков, кусками по 128: восемь кусков слова.
    const fit = sheetCellFit(80, true);
    expect(fit).toBe(980);
    expect(html.split('<span class="break-all">')).toHaveLength(Math.ceil(fit / TEXT_CHUNK) + 1);
    expect(shown(html)).toBe('а'.repeat(fit));
    expect(html).toContain('font-family:system-ui');
    expect(html).toContain(`title="${long}"`);
    expect(html).not.toContain('content-visibility');
    // Без переноса — одна строка до края ячейки и без мест переноса: `<wbr>` перенёс бы строку.
    const flat = renderToStaticMarkup(
      <SheetTable sheet={one({ v: long })} hits={[]} current={null} />,
    );
    expect(shown(flat)).toBe('а'.repeat(28));
    expect(flat).not.toContain('<wbr/>');
    expect(flat).toContain(`title="${long}"`);
    // Строка с текстом длиннее 2 048 знаков: ячейки раскладываются у экрана — с переносом место по
    // тексту, без переноса — 1 px (высоту строки не задаёт).
    const heavy = renderToStaticMarkup(
      <SheetTable
        sheet={{
          ...sheet,
          cols: [400, 400, 400],
          rows: [[{ v: long, wrap: true }, { v: long, wrap: true }, { v: long }]],
          hiddenRows: [],
          merges: [],
        }}
        hits={[]}
        current={null}
      />,
    );
    const lazy = 'content-visibility:auto;contain-intrinsic-size:none auto';
    // Наименьшая высота ячейки с переносом — по числу знаков (8 строк по 135 самых узких знаков):
    // и текст без ширины её не сожмёт.
    expect(heavy.split(`max-height:545px;${lazy} 304px;min-height:128px`)).toHaveLength(3);
    expect(
      heavy.split(`<div class="overflow-hidden text-ellipsis" style="${lazy} 1px">`),
    ).toHaveLength(2);
    expect(shown(heavy)).toHaveLength(1024 + 1024 + 135);
  });

  it('широкий лист из пустых строк рисуется шагом по местам, дальше — отметка «ещё» (п. И-12)', () => {
    const wide: SheetView = {
      ...sheet,
      cols: Array.from({ length: 256 }, () => 64),
      rows: Array.from({ length: 1000 }, () => []),
      hiddenRows: [],
      merges: [],
    };
    const html = renderToStaticMarkup(<SheetTable sheet={wide} hits={[]} current={null} />);
    const n = Math.floor(SHEET_STEP_PLACES / 256);
    expect(html).toContain(`data-cell="${n - 1}:255"`);
    expect(html).not.toContain(`data-cell="${n}:0"`);
    expect(html).toContain('data-fv-more-rows');
  });

  it('CSV: один лист — без вкладок; 50 000 строк — первые 5 000 и «скачайте»', async () => {
    const rows = [
      'Название;Сумма',
      ...Array.from({ length: 49_999 }, (_, i) => `Строка ${i};${i},5`),
    ];
    const book = await model('big.csv', enc(rows.join('\n')), 'sheet');
    const html = renderToStaticMarkup(<SheetBookView model={book} labels={labels} />);
    expect(html).not.toContain('data-fsh');
    expect(html).toMatch(/data-cell="1:1"[^>]*>0,5</);
    expect(html).toContain('data-fv-more');
    expect(html).toContain('Показаны первые 5000 строк из 50000');
    // Рисуется только первая порция строк — большой лист открывается сразу.
    expect(html).toContain('Строка 0');
    expect(html).not.toContain(`Строка ${SHEET_RENDER_STEP + 10}`);
  });

  it('книга из двух листов — вкладки внизу, выбран первый', () => {
    const html = renderToStaticMarkup(
      <SheetBookView
        model={{ kind: 'sheet', sheets: [sheet, { ...sheet, name: 'Журнал' }] }}
        labels={labels}
      />,
    );
    expect(html).toMatch(/aria-selected="true"[^>]*data-fsh="0"[^>]*>Лист1</);
    expect(html).toMatch(/aria-selected="false"[^>]*data-fsh="1"[^>]*>Журнал</);
  });

  it('пустая книга — «нет листов»', () => {
    expect(
      renderToStaticMarkup(<SheetBookView model={{ kind: 'sheet', sheets: [] }} labels={labels} />),
    ).toContain('В книге нет листов');
  });
});

describe('просмотр текста и XML', () => {
  it('TXT в Windows-1251 читается по-русски, разметка из файла — текстом', async () => {
    // «Привет, <b>мир</b>» в Windows-1251.
    const bytes = new Uint8Array([
      0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0x2c, 0x20, 0x3c, 0x62, 0x3e, 0xec, 0xe8, 0xf0, 0x3c,
      0x2f, 0x62, 0x3e,
    ]);
    const text = await model('a.txt', bytes, 'text');
    const html = renderToStaticMarkup(<TextFileView model={text} labels={labels} />);
    expect(html).toContain('Привет, &lt;b&gt;мир&lt;/b&gt;');
    expect(html).toContain('data-fv-enc');
    expect(html).toContain('data-fv-enc="windows-1251"');
    expect(html).toContain('Кодировка: Windows-1251');
  });

  it('XML с внешней сущностью: DOCTYPE пропущен с пометкой, сущность не раскрыта', async () => {
    const xml = await model(
      'gns.xml',
      enc(
        '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "http://evil.example/secret">]><r a="1">&x;<b>ИНН</b></r>',
      ),
      'xml',
    );
    const html = renderToStaticMarkup(<XmlFileView model={xml} labels={labels} />);
    expect(html).toContain('data-fv-doctype');
    expect(html).not.toContain('evil.example');
    expect(html).toContain('ИНН');
  });
});

describe('просмотр Word и PowerPoint', () => {
  const doc: DocView = {
    kind: 'doc',
    blocks: [
      { k: 'p', h: 1, runs: [{ t: 'Договор № 5' }] },
      { k: 'p', li: { lvl: 0, label: '1.' }, runs: [{ t: 'Предмет', b: true }] },
      { k: 'p', runs: [{ t: '<img src=x onerror=alert(1)>' }] },
      {
        k: 't',
        cols: [1, 1],
        rows: [
          [
            { blocks: [{ k: 'p', runs: [{ t: 'Сумма' }] }] },
            { blocks: [{ k: 'p', runs: [{ t: '100' }] }] },
          ],
        ],
      },
    ],
    images: {},
    cut: true,
  };

  it('DOCX: заголовки, списки и таблицы; текст файла — текстом, не разметкой', () => {
    const html = renderToStaticMarkup(<DocumentView model={doc} labels={labels} />);
    expect(html).toContain('data-fv-paper');
    expect(html).toMatch(/<h1[^>]*><span>Договор № 5<\/span><\/h1>/);
    expect(html).toContain('1.');
    expect(html).toContain('<table');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('Показана первая часть файла');
  });

  it('PPTX: один слайд, счётчик и листание; первый слайд — без «назад»', () => {
    const slides: SlidesView = {
      kind: 'slides',
      w: 12_192_000,
      h: 6_858_000,
      slides: [
        {
          items: [
            {
              k: 'text',
              x: 0.1,
              y: 0.1,
              w: 0.8,
              h: 0.2,
              title: true,
              paras: [{ runs: [{ t: 'Итоги года' }] }],
            },
          ],
        },
        {
          items: [
            { k: 'text', x: 0.1, y: 0.1, w: 0.8, h: 0.2, paras: [{ runs: [{ t: 'Второй' }] }] },
          ],
        },
      ],
      images: {},
      cut: false,
    };
    const html = renderToStaticMarkup(
      <SlidesViewBox model={slides} labels={labels} slide={0} onSlide={() => undefined} />,
    );
    expect(html).toContain('data-fv-slide');
    expect(html).toContain('Итоги года');
    expect(html).not.toContain('Второй');
    expect(html).toContain('Слайд 1 из 2');
    expect(html).toMatch(/aria-label="Предыдущий слайд"[^>]*disabled/);
  });
});
