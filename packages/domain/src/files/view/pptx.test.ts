import { describe, expect, it } from 'vitest';
import { pptxBytes, zipBytes } from './fixtures';
import { parsePptx, SLIDES_MAX } from './pptx';
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

  it('группа фигур пересчитывает координаты, таблица — текстом', async () => {
    const grp = `<p:grpSp><p:nvGrpSpPr/><p:grpSpPr><a:xfrm><a:off x="1000" y="1000"/><a:ext cx="2000" cy="2000"/><a:chOff x="0" y="0"/><a:chExt cx="1000" cy="1000"/></a:xfrm></p:grpSpPr>${box(500, 500, 500, 500, '<a:p><a:r><a:t>в группе</a:t></a:r></a:p>')}</p:grpSp>`;
    const tbl = `<p:graphicFrame><p:nvGraphicFramePr/><p:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="685800"/></p:xfrm><a:graphic><a:graphicData><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Налог</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>Сумма</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
    const v = await parsePptx(
      openZip(await pptxBytes([grp + tbl], { width: 10000, height: 10000 })),
    );
    const [g, t] = v.slides[0]!.items;
    expect(g).toMatchObject({ k: 'text', x: 0.2, y: 0.2, w: 0.1, h: 0.1 });
    expect(t).toMatchObject({ k: 'table', rows: [['Налог', 'Сумма']] });
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
