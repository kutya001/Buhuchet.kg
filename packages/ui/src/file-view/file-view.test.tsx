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
  hitsByRow,
  MERGE_SKIP_MAX,
  mergeMap,
  rotateNext,
  scrollsToward,
  searchKey,
  SHEET_CELL_SHOW,
  sheetCellText,
  SHEET_RENDER_STEP,
  SHEET_STEP_CHARS,
  SHEET_STEP_PLACES,
  sheetHits,
  sheetStepEnd,
  swipeDirection,
  TEXT_CHUNK,
  textChunks,
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
    expect(sheetCellText('коротко')).toBe('коротко');
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

  it('ячейка: на экране до 1 024 знаков, с переносом — не выше строки Excel, весь текст в подсказке (п. И-12)', () => {
    const long = 'а'.repeat(5000);
    const html = renderToStaticMarkup(
      <SheetTable
        sheet={{ ...sheet, rows: [[{ v: long, wrap: true }]], hiddenRows: [], merges: [] }}
        hits={[]}
        current={null}
      />,
    );
    expect(html).toContain('max-height:545px');
    // Ширина таблицы — числом из ширин столбцов (46 + 80 + 80 + 80): текст её не раздвигает.
    expect(html).toMatch(/<table[^>]*style="width:286px;/);
    expect(html).toContain(`>${'а'.repeat(SHEET_CELL_SHOW)}<`);
    expect(html).toContain('font-family:system-ui');
    expect(html).toContain(`title="${long}"`);
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
