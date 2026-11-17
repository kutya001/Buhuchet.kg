import { describe, expect, it } from 'vitest';
import {
  parseDocx,
  numberText,
  DOC_MAX_BLOCKS,
  DOC_MAX_CELLS,
  DOC_MAX_GRID,
  DOC_MAX_LABEL,
  DOC_MAX_LIST_START,
  DOC_MAX_RUNS,
} from './docx';
import type { DocBlock } from './docx';
import { docxBytes, docxImage, zipBytes } from './fixtures';
import { VIEW_MAX_IMAGE_REFS } from './ooxml';
import { ViewError } from './xml';
import { openZip } from './zip';

const p = (inner: string, ppr = '') => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${inner}</w:p>`;
const r = (t: string, rpr = '') =>
  `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${t}</w:t></w:r>`;

describe('Word DOCX в окне просмотра', () => {
  it('заголовки по стилям (и по наследованию), выравнивание, жирный, курсив, размер, цвет', async () => {
    const doc = await parseDocx(
      openZip(
        await docxBytes(
          [
            p(r('Договор'), '<w:pStyle w:val="Title"/><w:jc w:val="center"/>'),
            p(r('1. Предмет'), '<w:pStyle w:val="Heading1"/>'),
            p(r('Подраздел'), '<w:pStyle w:val="MyHead"/>'),
            p(r('Уровень по outline'), '<w:outlineLvl w:val="2"/><w:jc w:val="right"/>'),
            p(
              r('жирный', '<w:b/>') +
                r(' обычный', '<w:b w:val="0"/>') +
                r(
                  ' курсив',
                  '<w:i/><w:u w:val="single"/><w:strike/><w:sz w:val="28"/><w:color w:val="FF0000"/>',
                ) +
                r('скрытый', '<w:vanish/>'),
              '<w:jc w:val="both"/>',
            ),
            p(r('весь абзац жирный'), '<w:pStyle w:val="Strong"/>'),
            p('<w:r><w:t>a</w:t><w:tab/><w:t>b</w:t><w:br/><w:t>c</w:t><w:noBreakHyphen/></w:r>'),
          ].join(''),
        ),
      ),
    );
    const [title, h1, h2, h3, mix, strong, tabs] = doc.blocks as Extract<
      (typeof doc.blocks)[number],
      { k: 'p' }
    >[];
    expect(title).toEqual({ k: 'p', h: 0, al: 'c', runs: [{ t: 'Договор' }] });
    expect(h1!.h).toBe(1);
    expect(h2!.h).toBe(2);
    expect(h3).toMatchObject({ h: 3, al: 'r' });
    expect(mix!.al).toBe('j');
    expect(mix!.runs).toEqual([
      { t: 'жирный', b: true },
      { t: ' обычный' },
      { t: ' курсив', i: true, u: true, s: true, sz: 14, color: '#FF0000' },
    ]);
    expect(strong!.runs).toEqual([{ t: 'весь абзац жирный', b: true }]);
    expect(tabs!.runs).toEqual([{ t: 'a\tb\nc-' }]);
  });

  it('списки: номера по уровням и маркеры', async () => {
    const li = (t: string, lvl: number, num = 1) =>
      p(r(t), `<w:numPr><w:ilvl w:val="${lvl}"/><w:numId w:val="${num}"/></w:numPr>`);
    const doc = await parseDocx(
      openZip(
        await docxBytes(
          [
            li('один', 0),
            li('подпункт', 1),
            li('ещё', 1),
            li('два', 0),
            li('маркер', 0, 2),
            p(r('по стилю'), '<w:pStyle w:val="ListPara"/>'),
            li('без списка', 0, 0),
          ].join(''),
        ),
      ),
    );
    expect(doc.blocks.map((b) => (b.k === 'p' ? b.li : null))).toEqual([
      { lvl: 0, label: '1.' },
      { lvl: 1, label: '1.a)' },
      { lvl: 1, label: '1.b)' },
      { lvl: 0, label: '2.' },
      { lvl: 0, label: '•' },
      { lvl: 0, label: '•' },
      undefined,
    ]);
    expect(
      [
        'lowerRoman',
        'upperRoman',
        'upperLetter',
        'russianLower',
        'russianUpper',
        'decimalZero',
        'none',
        'decimal',
      ].map((f) => numberText(29, f)),
    ).toEqual(['xxix', 'XXIX', 'AC', 'аа', 'АА', '29', '', '29']);
    expect(numberText(1994, 'lowerRoman')).toBe('mcmxciv');
  });

  it('таблицы: объединения по горизонтали и вертикали, вложенные абзацы', async () => {
    const tc = (inner: string, pr = '') =>
      `<w:tc>${pr ? `<w:tcPr>${pr}</w:tcPr>` : ''}${p(r(inner))}</w:tc>`;
    const tbl = `<w:tbl><w:tr>${tc('Шапка', '<w:gridSpan w:val="2"/>')}${tc('В', '<w:vMerge w:val="restart"/>')}</w:tr><w:tr>${tc('1')}${tc('2')}${tc('', '<w:vMerge/>')}</w:tr><w:tr>${tc('3')}${tc('4')}${tc('5')}</w:tr></w:tbl>`;
    const doc = await parseDocx(openZip(await docxBytes(tbl)));
    const t = doc.blocks[0]!;
    expect(t.k).toBe('t');
    if (t.k !== 't') return;
    expect(t.rows.map((row) => row.map((c) => [c.span ?? 1, c.rowSpan ?? 1]))).toEqual([
      [
        [2, 1],
        [1, 2],
      ],
      [
        [1, 1],
        [1, 1],
      ],
      [
        [1, 1],
        [1, 1],
        [1, 1],
      ],
    ]);
    expect(t.rows[0]![0]!.blocks).toEqual([{ k: 'p', runs: [{ t: 'Шапка' }] }]);
  });

  it('одна картинка в 1 500 местах — показана в первых 1 000 (защита, п. И-12)', async () => {
    const doc = await parseDocx(openZip(await docxBytes(p(docxImage('rIdImg')).repeat(1500))));
    const shown = doc.blocks.flatMap((b) => (b.k === 'p' ? b.runs : [])).filter((x) => x.img);
    expect(shown).toHaveLength(VIEW_MAX_IMAGE_REFS);
    expect(Object.keys(doc.images)).toHaveLength(1);
  });

  it('картинки из файла показываются, внешние и неподдерживаемые — нет; ссылка — только текст', async () => {
    const body = [
      p(docxImage('rIdImg')),
      p(docxImage('rIdExt')),
      p(docxImage('rIdEmf')),
      p(docxImage('rIdНет')),
      p(`<w:hyperlink r:id="rIdLink">${r('сайт')}</w:hyperlink>`),
      p(`<w:ins>${r('вставлено')}</w:ins><w:del><w:r><w:delText>удалено</w:delText></w:r></w:del>`),
      `<w:sdt><w:sdtContent>${p(`<w:sdt><w:sdtContent>${r('поле')}</w:sdtContent></w:sdt>`)}</w:sdtContent></w:sdt>`,
    ].join('');
    const doc = await parseDocx(openZip(await docxBytes(body)));
    expect(Object.keys(doc.images)).toEqual(['word/media/image1.png']);
    expect(doc.images['word/media/image1.png']!.type).toBe('image/png');
    const runs = doc.blocks.map((b) => (b.k === 'p' ? b.runs : []));
    expect(runs[0]).toEqual([{ t: '', img: 'word/media/image1.png', w: 100, h: 50 }]);
    expect(runs[1]).toEqual([]);
    expect(runs[2]).toEqual([]);
    expect(runs[3]).toEqual([]);
    expect(runs[4]).toEqual([{ t: 'сайт', u: true }]);
    expect(JSON.stringify(doc)).not.toContain('evil.example');
    expect(runs[5]).toEqual([{ t: 'вставлено' }]);
    expect(runs[6]).toEqual([{ t: 'поле' }]);
  });

  it('номер начала списка из файла — в пределах; кусков текста — до предела (защита, п. И-12)', async () => {
    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const numbering = `<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1000000000000"/><w:numFmt w:val="upperRoman"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
    const big = await parseDocx(
      openZip(
        await docxBytes(
          p(r('пункт'), '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'),
          {
            numbering,
          },
        ),
      ),
    );
    const first = big.blocks[0];
    expect(first?.k === 'p' ? first.li?.label : null).toBe(
      `${numberText(DOC_MAX_LIST_START, 'upperRoman')}.`.slice(0, DOC_MAX_LABEL),
    );

    // Шаблон номера длиннее 255 знаков не берётся; номер и маркер — не длиннее 64 знаков.
    const tpl = (text: string, fmt = 'upperRoman') =>
      `<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1000000000000"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
    const labelOf = async (numbering: string) => {
      const d = await parseDocx(
        openZip(
          await docxBytes(
            p(r('пункт'), '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'),
            {
              numbering,
            },
          ),
        ),
      );
      const b0 = d.blocks[0];
      return b0?.k === 'p' ? b0.li?.label : undefined;
    };
    expect(await labelOf(tpl('%1'.repeat(300)))).toBeFalsy();
    expect(await labelOf(tpl('%1'.repeat(100)))).toHaveLength(DOC_MAX_LABEL);
    expect(await labelOf(tpl('o'.repeat(200), 'bullet'))).toBe('o'.repeat(DOC_MAX_LABEL));

    // Один абзац из множества кусков: в модели — не больше предела, документ помечен «не целиком».
    const runs = await parseDocx(openZip(await docxBytes(p(r('x').repeat(DOC_MAX_RUNS + 5)))));
    const b = runs.blocks[0];
    expect(b?.k === 'p' ? b.runs.length : 0).toBe(DOC_MAX_RUNS);
    expect(runs.cut).toBe(true);
  });

  it('пустые ячейки таблиц считаются: строки и ячейки всех таблиц — до предела (защита, п. И-12)', async () => {
    // Таблица 1 000 × 60 пустых `<w:tc/>`: ни абзаца, ни знака, но окно рисует каждую ячейку.
    const tr = `<w:tr>${'<w:tc/>'.repeat(60)}</w:tr>`;
    const doc = await parseDocx(openZip(await docxBytes(`<w:tbl>${tr.repeat(1_000)}</w:tbl>`)));
    const t = doc.blocks[0];
    const rows = t?.k === 't' ? t.rows : [];
    const units = rows.length + rows.reduce((n, r) => n + r.length, 0);
    expect(units).toBeLessThanOrEqual(DOC_MAX_CELLS);
    expect(units).toBeGreaterThan(DOC_MAX_CELLS - 200);
    expect(doc.cut).toBe(true);

    // Строка таблицы — не шире сетки Word: ячейка шире остатка сужается, лишние ячейки не берутся.
    const span = (v: string) => `<w:tc><w:tcPr><w:gridSpan w:val="${v}"/></w:tcPr></w:tc>`;
    const spans = async (row: string) => {
      const d = await parseDocx(openZip(await docxBytes(`<w:tbl><w:tr>${row}</w:tr></w:tbl>`)));
      const t = d.blocks[0];
      return { spans: t?.k === 't' ? t.rows[0]!.map((c) => c.span ?? 1) : [], cut: d.cut };
    };
    // Неверное число — одна ячейка; 100 000 — до конца сетки.
    expect(await spans(`${span('abc')}${span('100000')}`)).toEqual({
      spans: [1, DOC_MAX_GRID - 1],
      cut: false,
    });
    // Тысяча ячеек по 63 столбца: в строке — одна, документ показан не целиком.
    expect(await spans(span('63').repeat(1_000))).toEqual({ spans: [DOC_MAX_GRID], cut: true });
    const plain = await spans('<w:tc/>'.repeat(1_000));
    expect(plain.spans).toHaveLength(DOC_MAX_GRID);
    expect(plain.cut).toBe(true);
  });

  it('«лестница» объединений по вертикали не раздвигает таблицу шире сетки Word (защита, п. И-12)', async () => {
    // Ширина таблицы так, как её раскладывает окно (правило HTML: ячейка — в первый столбец, не
    // занятый объединением сверху).
    const layoutWidth = (rows: { span?: number; rowSpan?: number }[][]) => {
      const busy: number[] = [];
      let width = 0;
      rows.forEach((row, ri) => {
        let col = 0;
        for (const cell of row) {
          while ((busy[col] ?? 0) > ri) col++;
          for (let c = col; c < col + (cell.span ?? 1); c++)
            busy[c] = Math.max(busy[c] ?? 0, ri + (cell.rowSpan ?? 1));
          col += cell.span ?? 1;
          width = Math.max(width, col);
        }
      });
      return width;
    };
    const cont = '<w:tc><w:tcPr><w:vMerge/></w:tcPr></w:tc>';
    const start = (span: number) =>
      `<w:tc><w:tcPr><w:gridSpan w:val="${span}"/><w:vMerge w:val="restart"/></w:tcPr></w:tc>`;
    // По сетке файла каждая строка — 63 столбца, а начальные ячейки сдвигают строки ниже вправо.
    let stair = '';
    for (let k = 0; k < DOC_MAX_GRID; k++)
      stair += `<w:tr>${cont.repeat(k)}${start(DOC_MAX_GRID - k)}</w:tr>`;
    const tall = `<w:tr>${cont.repeat(DOC_MAX_GRID)}</w:tr>`.repeat(200);
    const doc = await parseDocx(openZip(await docxBytes(`<w:tbl>${stair}${tall}</w:tbl>`)));
    const t = doc.blocks[0];
    expect(t?.k).toBe('t');
    if (t?.k !== 't') return;
    expect(layoutWidth(t.rows)).toBeLessThanOrEqual(DOC_MAX_GRID);
    expect(t.rows[0]![0]!.span).toBe(DOC_MAX_GRID);
    expect(doc.cut).toBe(true);

    // Обычная таблица с объединениями показывается целиком.
    const ok = await parseDocx(
      openZip(
        await docxBytes(
          `<w:tbl><w:tr>${start(2)}<w:tc/></w:tr><w:tr>${cont.replace('<w:vMerge/>', '<w:gridSpan w:val="2"/><w:vMerge/>')}<w:tc/></w:tr></w:tbl>`,
        ),
      ),
    );
    const o = ok.blocks[0];
    expect(o?.k === 't' ? o.rows.map((r) => r.length) : null).toEqual([2, 1]);
    expect(o?.k === 't' ? o.rows[0]![0]!.rowSpan : null).toBe(2);
    expect(ok.cut).toBe(false);
  });

  it('вложенные таблицы и объединения по вертикали — в том же пределе ячеек (защита, п. И-12)', async () => {
    // Таблица в ячейке таблицы в ячейке…: ячейки всех уровней считаются вместе.
    let body = `<w:tbl>${`<w:tr>${'<w:tc/>'.repeat(50)}</w:tr>`.repeat(400)}</w:tbl>`;
    for (let k = 0; k < 4; k++)
      body = `<w:tbl><w:tr><w:tc>${body}</w:tc></w:tr>${`<w:tr>${'<w:tc/>'.repeat(50)}</w:tr>`.repeat(400)}</w:tbl>`;
    const nested = await parseDocx(openZip(await docxBytes(body)));
    const units = (blocks: DocBlock[]): number =>
      blocks.reduce(
        (n, b) =>
          n +
          (b.k === 't'
            ? b.rows.reduce((m, r) => m + 1 + r.reduce((q, c) => q + 1 + units(c.blocks), 0), 0)
            : 0),
        0,
      );
    expect(units(nested.blocks)).toBeLessThanOrEqual(DOC_MAX_CELLS);
    expect(nested.cut).toBe(true);

    // Объединение по вертикали на много строк: строки — в пределе, у первой ячейки — их число.
    const vm = (v?: string) =>
      `<w:tc><w:tcPr><w:vMerge${v ? ` w:val="${v}"` : ''}/></w:tcPr></w:tc>`;
    const tall = await parseDocx(
      openZip(
        await docxBytes(
          `<w:tbl><w:tr>${vm('restart')}</w:tr>${`<w:tr>${vm()}</w:tr>`.repeat(DOC_MAX_CELLS + 10)}</w:tbl>`,
        ),
      ),
    );
    const t = tall.blocks[0];
    const rows = t?.k === 't' ? t.rows : [];
    expect(rows.length).toBeLessThanOrEqual(DOC_MAX_CELLS);
    expect(rows[0]![0]!.rowSpan).toBe(rows.length);
    expect(tall.cut).toBe(true);
  });

  it('предел абзацев и документ без тела', async () => {
    const many = await parseDocx(openZip(await docxBytes(p(r('x')).repeat(DOC_MAX_BLOCKS + 5))));
    expect(many.blocks).toHaveLength(DOC_MAX_BLOCKS);
    expect(many.cut).toBe(true);
    const noBody = await zipBytes([
      { name: 'word/document.xml', data: '<w:document xmlns:w="w"/>' },
    ]);
    expect(await parseDocx(openZip(noBody))).toEqual({
      kind: 'doc',
      blocks: [],
      images: {},
      cut: false,
    });
    await expect(
      parseDocx(openZip(await zipBytes([{ name: 'a', data: 'b' }]))),
    ).rejects.toThrowError(new ViewError('file_bad'));
  });
});
