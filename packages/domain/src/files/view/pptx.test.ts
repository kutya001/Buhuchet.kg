import { describe, expect, it } from 'vitest';
import { pptxBytes, zipBytes } from './fixtures';
import {
  parsePptx,
  SLIDE_MAX_CHARS,
  SLIDE_MAX_FONT_PT,
  SLIDE_MAX_PARTS,
  SLIDES_MAX,
  SLIDES_MAX_PARTS,
} from './pptx';
import { ViewError } from './xml';
import { openZip } from './zip';

const ph = (type: string, text: string, idx?: number) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="3" name="t"/><p:cNvSpPr/><p:nvPr><p:ph type="${type}"${idx !== undefined ? ` idx="${idx}"` : ''}/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="ru-RU"/><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
const box = (x: number, y: number, w: number, h: number, inner: string, fill = '') =>
  `<p:sp><p:nvSpPr><p:cNvPr id="4" name="b"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>${fill}</p:spPr><p:txBody><a:bodyPr anchor="b"/>${inner}</p:txBody></p:sp>`;
const pic = (x: number, y: number, rid: string) =>
  `<p:pic><p:nvPicPr><p:cNvPr id="5" name="p"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/></p:blipFill><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="1219200" cy="685800"/></a:xfrm></p:spPr></p:pic>`;

describe('PowerPoint PPTX в окне просмотра', () => {
  it('слайды по порядку, скрытый слайд пропущен, размер слайда', async () => {
    const v = await parsePptx(
      openZip(
        await pptxBytes([ph('ctrTitle', 'Первый'), ph('title', 'Скрытый'), ph('title', 'Третий')], {
          hidden: [1],
        }),
      ),
    );
    expect(v.w).toBe(12192000);
    expect(v.h).toBe(6858000);
    expect(v.slides).toHaveLength(2);
    expect(v.cut).toBe(false);
    expect(
      v.slides.map((s) => s.items[0]!.k === 'text' && s.items[0]!.paras[0]!.runs[0]!.t),
    ).toEqual(['Первый', 'Третий']);
  });

  it('заполнитель без координат берёт место из макета, размер шрифта — из образца; фон из образца', async () => {
    const v = await parsePptx(
      openZip(
        await pptxBytes([ph('title', 'Заголовок') + ph('body', 'Пункт', 1) + ph('dt', 'дата', 10)]),
      ),
    );
    const [title, body, dt] = v.slides[0]!.items;
    expect(title).toMatchObject({ k: 'text', title: true, anchor: 'c' });
    expect(title!.x).toBeCloseTo(838200 / 12192000);
    expect(title!.y).toBeCloseTo(365125 / 6858000);
    expect(title!.k === 'text' && title!.paras[0]!.runs[0]!.sz).toBe(40);
    expect(body!.y).toBeCloseTo(1825625 / 6858000);
    expect(body!.k === 'text' && body!.paras[0]!.runs[0]!.sz).toBe(26);
    expect(dt!.y).toBeCloseTo(6000000 / 6858000);
    expect(v.slides[0]!.bg).toBe('#F4F4F4');
  });

  it('текст своих фигур: выравнивание, уровни, маркеры, размер, цвет, заливка; картинки из файла, внешние — нет', async () => {
    const paras =
      '<a:p><a:pPr algn="ctr" lvl="1"><a:buChar char="•"/></a:pPr><a:r><a:rPr sz="2000" b="1" i="1" u="sng"><a:solidFill><a:srgbClr val="1F2A44"/></a:solidFill></a:rPr><a:t>Выручка</a:t></a:r><a:br/><a:fld type="slidenum"><a:t>3</a:t></a:fld></a:p><a:p><a:pPr algn="r"/><a:endParaRPr sz="1200"/></a:p><a:p><a:pPr algn="just"/><a:r><a:t>без размера</a:t></a:r></a:p>';
    const slide =
      box(0, 0, 6096000, 3429000, paras, '<a:solidFill><a:srgbClr val="FFEEDD"/></a:solidFill>') +
      pic(100, 200, 'rId2') +
      pic(0, 0, 'rId3');
    const v = await parsePptx(openZip(await pptxBytes([slide])));
    const [text, image, ...rest] = v.slides[0]!.items;
    expect(rest).toEqual([]);
    expect(text).toMatchObject({
      k: 'text',
      x: 0,
      y: 0,
      w: 0.5,
      h: 0.5,
      fill: '#FFEEDD',
      anchor: 'b',
    });
    if (text?.k !== 'text') return;
    expect(text.paras).toEqual([
      {
        al: 'c',
        lvl: 1,
        bullet: true,
        runs: [
          { t: 'Выручка', b: true, i: true, u: true, sz: 20, color: '#1F2A44' },
          { t: '\n' },
          { t: '3', sz: 16 },
        ],
      },
      { al: 'r', runs: [{ t: '', sz: 12 }] },
      { al: 'j', runs: [{ t: 'без размера', sz: 16 }] },
    ]);
    expect(image).toMatchObject({ k: 'pic', img: 'ppt/media/image1.png' });
    expect(Object.keys(v.images)).toEqual(['ppt/media/image1.png']);
    expect(JSON.stringify(v)).not.toContain('evil.example');
  });

  it('знаков на одном слайде — до 100 000: остаток слайда не показан, следующий слайд цел (защита, п. И-12)', async () => {
    const word = 'я '.repeat(30_000);
    const many = Array.from({ length: 5 }, () => `<a:p><a:r><a:t>${word}</a:t></a:r></a:p>`).join(
      '',
    );
    const v = await parsePptx(
      openZip(
        await pptxBytes([
          box(0, 0, 1, 1000, many),
          box(0, 0, 1000, 1000, '<a:p><a:r><a:t>второй</a:t></a:r></a:p>'),
        ]),
      ),
    );
    const chars = (i: number) =>
      v.slides[i]!.items.reduce(
        (n, it) =>
          n +
          (it.k === 'text'
            ? it.paras.reduce((m, p) => m + p.runs.reduce((q, r) => q + r.t.length, 0), 0)
            : 0),
        0,
      );
    expect(v.cut).toBe(true);
    expect(chars(0)).toBeLessThanOrEqual(SLIDE_MAX_CHARS);
    expect(chars(0)).toBe(60_000);
    expect(chars(1)).toBe('второй'.length);
  });

  it('размер слайда из файла — от 1 до 56 дюймов, как у PowerPoint', async () => {
    const tiny = await parsePptx(openZip(await pptxBytes([''], { width: 1, height: 1 })));
    expect([tiny.w, tiny.h]).toEqual([914_400, 914_400]);
    const huge = await parsePptx(openZip(await pptxBytes([''], { width: 1e15, height: 1e15 })));
    expect([huge.w, huge.h]).toEqual([51_206_400, 51_206_400]);
  });

  it('группа фигур пересчитывает координаты, таблица — текстом', async () => {
    const grp = `<p:grpSp><p:nvGrpSpPr/><p:grpSpPr><a:xfrm><a:off x="100000" y="100000"/><a:ext cx="200000" cy="200000"/><a:chOff x="0" y="0"/><a:chExt cx="1000" cy="1000"/></a:xfrm></p:grpSpPr>${box(500, 500, 500, 500, '<a:p><a:r><a:t>в группе</a:t></a:r></a:p>')}</p:grpSp>`;
    const tbl = `<p:graphicFrame><p:nvGraphicFramePr/><p:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="685800"/></p:xfrm><a:graphic><a:graphicData><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Налог</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>Сумма</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
    const v = await parsePptx(
      openZip(await pptxBytes([grp + tbl], { width: 1_000_000, height: 1_000_000 })),
    );
    const [g, t] = v.slides[0]!.items;
    expect(g).toMatchObject({ k: 'text', x: 0.2, y: 0.2, w: 0.1, h: 0.1 });
    expect(t).toMatchObject({ k: 'table', rows: [['Налог', 'Сумма']] });
  });

  it('фигуры, абзацы и ячейки таблиц — в пределах слайда и всей презентации (защита, п. И-12)', async () => {
    const shape = (k: number) =>
      `<p:sp><p:nvSpPr><p:cNvPr id="${k + 10}" name="t"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>x</a:t></a:r></a:p></p:txBody></p:sp>`;
    // Слайд из множества фигур: каждая — фигура, абзац и кусок текста.
    const crowded = Array.from({ length: SLIDE_MAX_PARTS }, (_, k) => shape(k)).join('');
    const one = await parsePptx(openZip(await pptxBytes([crowded])));
    const parts = (items: (typeof one.slides)[number]['items']) =>
      items.reduce(
        (n, it) =>
          n +
          1 +
          (it.k === 'text' ? it.paras.reduce((m, p) => m + 1 + p.runs.length, 0) : 0) +
          (it.k === 'table' ? it.rows.reduce((m, r) => m + 1 + r.length, 0) : 0),
        0,
      );
    expect(parts(one.slides[0]!.items)).toBeLessThanOrEqual(SLIDE_MAX_PARTS);
    expect(one.cut).toBe(true);

    // Таблица 200 × 100 пустых ячеек на слайде — тоже в пределе слайда.
    const tbl = `<p:graphicFrame><p:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></p:xfrm><a:graphic><a:graphicData><a:tbl>${`<a:tr>${'<a:tc/>'.repeat(100)}</a:tr>`.repeat(200)}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
    const table = await parsePptx(openZip(await pptxBytes([tbl])));
    expect(parts(table.slides[0]!.items)).toBeLessThanOrEqual(SLIDE_MAX_PARTS);
    expect(table.cut).toBe(true);

    // Группы фигур, вложенные друг в друга, — в том же пределе слайда.
    let group = Array.from({ length: 1_000 }, (_, k) => shape(k)).join('');
    for (let k = 0; k < 20; k++)
      group = `<p:grpSp><p:nvGrpSpPr/><p:grpSpPr/>${group}${Array.from({ length: 1_000 }, (_, j) => shape(j)).join('')}</p:grpSp>`;
    const grouped = await parsePptx(openZip(await pptxBytes([group])));
    expect(parts(grouped.slides[0]!.items)).toBeLessThanOrEqual(SLIDE_MAX_PARTS);
    expect(grouped.cut).toBe(true);

    // Много тяжёлых слайдов: вся презентация — до предела, дальше слайды не берутся.
    const heavy = Array.from({ length: 1_400 }, (_, k) => shape(k)).join('');
    const deck = await parsePptx(openZip(await pptxBytes(Array.from({ length: 60 }, () => heavy))));
    const total = deck.slides.reduce((n, s) => n + parts(s.items), 0);
    expect(total).toBeLessThanOrEqual(SLIDES_MAX_PARTS);
    expect(deck.slides.length).toBeLessThan(60);
    expect(deck.cut).toBe(true);
  });

  it('размер шрифта и уровень абзаца из файла — в пределах (защита, п. И-12)', async () => {
    const sp = `<p:sp><p:nvSpPr><p:cNvPr id="9" name="t"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:p><a:pPr lvl="1000000"/><a:r><a:rPr sz="100000000"/><a:t>x</a:t></a:r></a:p><a:p><a:pPr lvl="1.5"/><a:endParaRPr sz="99999999"/></a:p></p:txBody></p:sp>`;
    const v = await parsePptx(openZip(await pptxBytes([sp])));
    const it0 = v.slides[0]!.items[0];
    expect(it0?.k).toBe('text');
    if (it0?.k !== 'text') return;
    expect(it0.paras[0]!.lvl).toBe(8);
    expect(it0.paras[0]!.runs[0]!.sz).toBe(SLIDE_MAX_FONT_PT);
    expect(it0.paras[1]!.lvl).toBeUndefined();
    expect(it0.paras[1]!.runs[0]!.sz).toBe(SLIDE_MAX_FONT_PT);
  });

  it('предел слайдов и битая презентация', async () => {
    const many = await parsePptx(
      openZip(await pptxBytes(Array.from({ length: SLIDES_MAX + 2 }, () => ''))),
    );
    expect(many.slides).toHaveLength(SLIDES_MAX);
    expect(many.cut).toBe(true);
    await expect(
      parsePptx(openZip(await zipBytes([{ name: 'a', data: 'b' }]))),
    ).rejects.toThrowError(new ViewError('file_bad'));
    const bare = await zipBytes([
      { name: 'ppt/presentation.xml', data: '<p:presentation xmlns:p="p"/>' },
    ]);
    expect(await parsePptx(openZip(bare))).toEqual({
      kind: 'slides',
      w: 12192000,
      h: 6858000,
      slides: [],
      images: {},
      cut: false,
    });
  });
});
