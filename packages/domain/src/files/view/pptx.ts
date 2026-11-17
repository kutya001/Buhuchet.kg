/**
 * Презентация (PPTX) в окне просмотра (доработки 16.11.2026, блок 5, пункт 2): слайды по одному —
 * текст, картинки и таблицы на своих местах. Место заполнителя без своих координат берётся из
 * макета или образца слайдов. Видео, звук, внешние ссылки и макросы не загружаются.
 */
import { ImageBag, readRels, type Rel, type ViewImage } from './ooxml';
import {
  attrOf,
  childEl,
  childEls,
  findAll,
  findEl,
  localName,
  parseXmlTree,
  prefixedAttr,
  textOf,
  ViewError,
  type XEl,
} from './xml';
import type { Zip } from './zip';

/** Слайдов в окне — не больше. */
export const SLIDES_MAX = 300;
/** Фигур, абзацев, кусков текста и ячеек таблиц на одном слайде — не больше: окно рисует слайд целиком. */
export const SLIDE_MAX_PARTS = 5_000;
/**
 * Того же во всей презентации — не больше: модель копируется из потока разбора в окно, а одну часть
 * слайда файл может назвать хоть 300 раз.
 */
export const SLIDES_MAX_PARTS = 200_000;
/** Знаков текста во всей презентации — не больше (как у текстового файла). */
export const SLIDES_MAX_CHARS = 2_000_000;
/**
 * Знаков текста на одном слайде — не больше: окно раскладывает слайд целиком и за один кадр, а на
 * тексте, где шрифт меняется на каждом знаке, это 0,07 мс на знак.
 */
export const SLIDE_MAX_CHARS = 16_000;
/** Сторона слайда, EMU: от 1 до 56 дюймов, как у PowerPoint. */
const SLIDE_SIDE_MIN = 914_400;
const SLIDE_SIDE_MAX = 51_206_400;
const slideSide = (v: string | undefined, def: number) => {
  const n = Number(v ?? def);
  return Number.isFinite(n) && n > 0 ? Math.min(SLIDE_SIDE_MAX, Math.max(SLIDE_SIDE_MIN, n)) : def;
};
/** Размер шрифта из файла — не больше, пт (предел PowerPoint — 4 000). */
export const SLIDE_MAX_FONT_PT = 400;
/** Уровень абзаца — 0…8, как у PowerPoint. */
const slideLevel = (v: string | undefined) => {
  const n = Number(v ?? 0);
  return Number.isInteger(n) ? Math.min(8, Math.max(0, n)) : 0;
};
/** Размер шрифта из файла (сотые пункта) в пт, в пределе; нет или неверный — 0. */
const fontPt = (v: string | undefined) => {
  const n = Number(v);
  return n > 0 ? Math.min(SLIDE_MAX_FONT_PT, n / 100) : 0;
};

/** Сколько ещё можно взять в модель; считается во время разбора. */
interface SlideBudget {
  slide: number;
  /** Знаков ещё можно взять на этом слайде. */
  slideChars: number;
  deck: number;
  chars: number;
  cut: boolean;
}

/** Ещё одна фигура, абзац, кусок текста или ячейка: места нет — false, презентация показана не целиком. */
function takePart(b: SlideBudget, chars = 0): boolean {
  if (b.deck <= 0 || b.chars < chars) {
    // Предел презентации: следующие слайды уже не разбираются.
    b.deck = 0;
    b.chars = 0;
    b.cut = true;
    return false;
  }
  if (b.slide <= 0 || b.slideChars < chars) {
    // Предел слайда: остаток этого слайда не показан, следующие — целы.
    b.slideChars = 0;
    b.cut = true;
    return false;
  }
  b.slide--;
  b.slideChars -= chars;
  b.deck--;
  b.chars -= chars;
  return true;
}

/** Положение на слайде: доли ширины и высоты слайда (0…1). */
export interface SlideBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SlideRun {
  t: string;
  b?: true;
  i?: true;
  u?: true;
  /** Размер шрифта, пт. */
  sz?: number;
  color?: string;
}

export interface SlidePara {
  al?: 'c' | 'r' | 'j';
  lvl?: number;
  bullet?: boolean;
  runs: SlideRun[];
}

export type SlideItem =
  | (SlideBox & {
      k: 'text';
      paras: SlidePara[];
      fill?: string;
      anchor?: 't' | 'c' | 'b';
      title?: true;
    })
  | (SlideBox & { k: 'pic'; img: string })
  | (SlideBox & { k: 'table'; rows: string[][] });

export interface SlideModel {
  bg?: string;
  items: SlideItem[];
}

export interface SlidesView {
  kind: 'slides';
  /** Размер слайда, EMU. */
  w: number;
  h: number;
  slides: SlideModel[];
  images: Record<string, ViewImage>;
  /** Показаны не все слайды. */
  cut: boolean;
}

type Xfrm = { x: number; y: number; w: number; h: number };

function xfrmOf(sp: XEl): Xfrm | null {
  const x =
    childEl(childEl(sp, 'spPr'), 'xfrm') ??
    childEl(childEl(sp, 'grpSpPr'), 'xfrm') ??
    childEl(sp, 'xfrm');
  const off = childEl(x, 'off');
  const ext = childEl(x, 'ext');
  if (!off || !ext) return null;
  return {
    x: Number(attrOf(off, 'x') ?? 0),
    y: Number(attrOf(off, 'y') ?? 0),
    w: Number(attrOf(ext, 'cx') ?? 0),
    h: Number(attrOf(ext, 'cy') ?? 0),
  };
}

const srgb = (el: XEl | undefined): string | undefined => {
  const c = attrOf(findEl(childEl(el, 'solidFill') ?? undefined, 'srgbClr'), 'val');
  return c && /^[0-9A-Fa-f]{6}$/.test(c) ? `#${c.toUpperCase()}` : undefined;
};

interface PhRef {
  type: string;
  idx: string | undefined;
}

function phOf(sp: XEl): PhRef | null {
  const nv = childEl(sp, 'nvSpPr') ?? childEl(sp, 'nvPicPr') ?? childEl(sp, 'nvGraphicFramePr');
  const ph = findEl(childEl(nv, 'nvPr'), 'ph');
  if (!ph) return null;
  return { type: attrOf(ph, 'type') ?? 'body', idx: attrOf(ph, 'idx') };
}

/** Заполнители макета или образца: координаты и размер шрифта по типу и номеру. */
interface PhLayer {
  byIdx: Map<string, Xfrm>;
  byType: Map<string, Xfrm>;
  bg?: string;
}

function phLayer(root: XEl | null): PhLayer {
  const layer: PhLayer = { byIdx: new Map(), byType: new Map() };
  const cSld = childEl(root ?? undefined, 'cSld');
  const bg = srgb(childEl(childEl(cSld, 'bg'), 'bgPr'));
  if (bg) layer.bg = bg;
  for (const sp of findAll(childEl(cSld, 'spTree'), 'sp')) {
    const ph = phOf(sp);
    const xf = xfrmOf(sp);
    if (!ph || !xf) continue;
    if (ph.idx !== undefined && !layer.byIdx.has(ph.idx)) layer.byIdx.set(ph.idx, xf);
    if (!layer.byType.has(ph.type)) layer.byType.set(ph.type, xf);
  }
  return layer;
}

const titleType = (t: string) => t === 'title' || t === 'ctrTitle';

function phXfrm(ph: PhRef, layers: PhLayer[]): Xfrm | null {
  for (const l of layers) {
    const byIdx = ph.idx !== undefined ? l.byIdx.get(ph.idx) : undefined;
    if (byIdx) return byIdx;
    const byType =
      l.byType.get(ph.type) ??
      (titleType(ph.type) ? (l.byType.get('title') ?? l.byType.get('ctrTitle')) : undefined);
    if (byType) return byType;
  }
  return null;
}

/** Размеры шрифта образца: заголовок, текст по уровням и прочий текст, пт. */
interface MasterSizes {
  title: number;
  body: number[];
  other: number;
}

function masterSizes(root: XEl | null): MasterSizes {
  const tx = childEl(root ?? undefined, 'txStyles');
  const sz = (el: XEl | undefined, lvl: number) => {
    return fontPt(attrOf(childEl(childEl(el, `lvl${lvl}pPr`), 'defRPr'), 'sz'));
  };
  const body = [1, 2, 3, 4, 5].map(
    (l) => sz(childEl(tx, 'bodyStyle'), l) || [32, 28, 24, 20, 20][l - 1]!,
  );
  return {
    title: sz(childEl(tx, 'titleStyle'), 1) || 44,
    body,
    other: sz(childEl(tx, 'otherStyle'), 1) || 18,
  };
}

function parasOf(txBody: XEl, defSize: (lvl: number) => number, budget: SlideBudget): SlidePara[] {
  const out: SlidePara[] = [];
  for (const p of childEls(txBody, 'p')) {
    if (!takePart(budget)) break;
    const ppr = childEl(p, 'pPr');
    const lvl = slideLevel(attrOf(ppr, 'lvl'));
    const para: SlidePara = { runs: [] };
    const algn = attrOf(ppr, 'algn');
    if (algn === 'ctr') para.al = 'c';
    else if (algn === 'r') para.al = 'r';
    else if (algn === 'just') para.al = 'j';
    if (lvl) para.lvl = lvl;
    if (childEl(ppr, 'buChar') || childEl(ppr, 'buAutoNum')) para.bullet = true;
    const endSz = fontPt(attrOf(childEl(p, 'endParaRPr'), 'sz'));
    for (const r of p.kids) {
      if (typeof r === 'string') continue;
      const n = localName(r.name);
      if (n !== 'r' && n !== 'fld' && n !== 'br') continue;
      if (n === 'br') {
        if (!takePart(budget)) break;
        para.runs.push({ t: '\n' });
        continue;
      }
      const rp = childEl(r, 'rPr');
      const run: SlideRun = { t: textOf(childEl(r, 't')) };
      if (!takePart(budget, run.t.length)) break;
      if (attrOf(rp, 'b') === '1') run.b = true;
      if (attrOf(rp, 'i') === '1') run.i = true;
      const u = attrOf(rp, 'u');
      if (u && u !== 'none') run.u = true;
      run.sz = fontPt(attrOf(rp, 'sz')) || defSize(lvl);
      const col = srgb(rp);
      if (col) run.color = col;
      para.runs.push(run);
    }
    if (!para.runs.length && endSz > 0) para.runs.push({ t: '', sz: endSz });
    out.push(para);
  }
  return out;
}

interface SlideCtx {
  W: number;
  H: number;
  layers: PhLayer[];
  sizes: MasterSizes;
  rels: Map<string, Rel>;
  bag: ImageBag;
  budget: SlideBudget;
}

type Tf = (x: Xfrm) => Xfrm;

async function shapesOf(tree: XEl, ctx: SlideCtx, tf: Tf, out: SlideItem[]): Promise<void> {
  const box = (x: Xfrm): SlideBox => {
    const t = tf(x);
    return { x: t.x / ctx.W, y: t.y / ctx.H, w: t.w / ctx.W, h: t.h / ctx.H };
  };
  for (const sp of tree.kids) {
    if (typeof sp === 'string') continue;
    const n = localName(sp.name);
    if ((n === 'sp' || n === 'pic' || n === 'graphicFrame') && !takePart(ctx.budget)) return;
    if (n === 'sp') {
      const ph = phOf(sp);
      const xf = xfrmOf(sp) ?? (ph ? phXfrm(ph, ctx.layers) : null);
      const txBody = childEl(sp, 'txBody');
      const fill = srgb(childEl(sp, 'spPr'));
      if (!xf || (!txBody && !fill)) continue;
      const isTitle = !!ph && titleType(ph.type);
      const def = (lvl: number) =>
        isTitle ? ctx.sizes.title : ph ? (ctx.sizes.body[Math.min(lvl, 4)] ?? 18) : ctx.sizes.other;
      const paras = txBody ? parasOf(txBody, def, ctx.budget) : [];
      const anchor = attrOf(childEl(txBody, 'bodyPr'), 'anchor');
      const item: SlideItem = { k: 'text', ...box(xf), paras };
      if (fill) item.fill = fill;
      if (anchor === 'ctr') item.anchor = 'c';
      else if (anchor === 'b') item.anchor = 'b';
      else if (isTitle && anchor !== 't') item.anchor = 'c';
      if (isTitle) item.title = true;
      out.push(item);
    } else if (n === 'pic') {
      const xf = xfrmOf(sp) ?? (phOf(sp) ? phXfrm(phOf(sp)!, ctx.layers) : null);
      const rid = prefixedAttr(findEl(childEl(sp, 'blipFill'), 'blip'), 'embed');
      const key = rid ? await ctx.bag.add(ctx.rels.get(rid)) : null;
      if (xf && key) out.push({ k: 'pic', ...box(xf), img: key });
    } else if (n === 'graphicFrame') {
      const xf = findEl(sp, 'xfrm');
      const off = childEl(xf, 'off');
      const ext = childEl(xf, 'ext');
      const tbl = findEl(sp, 'tbl');
      if (!off || !ext || !tbl) continue;
      const rows: string[][] = [];
      for (const tr of childEls(tbl, 'tr')) {
        if (!takePart(ctx.budget)) break;
        const row: string[] = [];
        for (const tc of childEls(tr, 'tc')) {
          const text = childEls(childEl(tc, 'txBody'), 'p').map(textOf).join('\n');
          if (!takePart(ctx.budget, text.length)) break;
          row.push(text);
        }
        rows.push(row);
      }
      out.push({
        k: 'table',
        ...box({
          x: Number(attrOf(off, 'x') ?? 0),
          y: Number(attrOf(off, 'y') ?? 0),
          w: Number(attrOf(ext, 'cx') ?? 0),
          h: Number(attrOf(ext, 'cy') ?? 0),
        }),
        rows,
      });
    } else if (n === 'grpSp') {
      const gx = findEl(childEl(sp, 'grpSpPr'), 'xfrm');
      const off = childEl(gx, 'off');
      const ext = childEl(gx, 'ext');
      const chOff = childEl(gx, 'chOff');
      const chExt = childEl(gx, 'chExt');
      let inner = tf;
      if (off && ext && chOff && chExt) {
        const ox = Number(attrOf(off, 'x') ?? 0);
        const oy = Number(attrOf(off, 'y') ?? 0);
        const sx = Number(attrOf(ext, 'cx') ?? 0) / Math.max(1, Number(attrOf(chExt, 'cx') ?? 1));
        const sy = Number(attrOf(ext, 'cy') ?? 0) / Math.max(1, Number(attrOf(chExt, 'cy') ?? 1));
        const cx = Number(attrOf(chOff, 'x') ?? 0);
        const cy = Number(attrOf(chOff, 'y') ?? 0);
        inner = (x) =>
          tf({ x: ox + (x.x - cx) * sx, y: oy + (x.y - cy) * sy, w: x.w * sx, h: x.h * sy });
      }
      await shapesOf(sp, ctx, inner, out);
    }
  }
}

export async function parsePptx(zip: Zip): Promise<SlidesView> {
  const rootRels = await readRels(zip, '');
  const presPart =
    [...rootRels.values()].find((r) => r.type === 'officeDocument' && !r.external)?.part ??
    'ppt/presentation.xml';
  const presSrc = await zip.text(presPart);
  if (!presSrc) throw new ViewError('file_bad');
  const pres = parseXmlTree(presSrc, 200_000).root;
  const sz = childEl(pres ?? undefined, 'sldSz');
  const W = slideSide(attrOf(sz, 'cx'), 12192000);
  const H = slideSide(attrOf(sz, 'cy'), 6858000);
  const rels = await readRels(zip, presPart);
  const bag = new ImageBag(zip);
  const slides: SlideModel[] = [];
  const layoutCache = new Map<string, { layers: PhLayer[]; sizes: MasterSizes }>();
  const ids = childEls(childEl(pres ?? undefined, 'sldIdLst'), 'sldId');
  const budget: SlideBudget = {
    slide: SLIDE_MAX_PARTS,
    slideChars: SLIDE_MAX_CHARS,
    deck: SLIDES_MAX_PARTS,
    chars: SLIDES_MAX_CHARS,
    cut: false,
  };
  for (const sid of ids.slice(0, SLIDES_MAX)) {
    if (budget.deck <= 0 || budget.chars <= 0) {
      budget.cut = true;
      break;
    }
    budget.slide = SLIDE_MAX_PARTS;
    budget.slideChars = SLIDE_MAX_CHARS;
    const rel = rels.get(prefixedAttr(sid, 'id') ?? '');
    if (!rel || rel.external || rel.type !== 'slide') continue;
    const src = await zip.text(rel.part);
    if (!src) continue;
    const root = parseXmlTree(src, 500_000).root;
    if (attrOf(root ?? undefined, 'show') === '0') continue;
    const srels = await readRels(zip, rel.part);
    const layoutRel = [...srels.values()].find((r) => r.type === 'slideLayout' && !r.external);
    let lay = layoutRel ? layoutCache.get(layoutRel.part) : undefined;
    if (!lay) {
      const layers: PhLayer[] = [];
      let sizes = masterSizes(null);
      if (layoutRel) {
        const lsrc = await zip.text(layoutRel.part);
        layers.push(phLayer(lsrc ? parseXmlTree(lsrc, 500_000).root : null));
        const mrel = [...(await readRels(zip, layoutRel.part)).values()].find(
          (r) => r.type === 'slideMaster' && !r.external,
        );
        const msrc = mrel ? await zip.text(mrel.part) : null;
        const mroot = msrc ? parseXmlTree(msrc, 500_000).root : null;
        layers.push(phLayer(mroot));
        sizes = masterSizes(mroot);
      }
      lay = { layers, sizes };
      if (layoutRel) layoutCache.set(layoutRel.part, lay);
    }
    const cSld = childEl(root ?? undefined, 'cSld');
    const model: SlideModel = { items: [] };
    const bg = srgb(childEl(childEl(cSld, 'bg'), 'bgPr')) ?? lay.layers.find((l) => l.bg)?.bg;
    if (bg) model.bg = bg;
    const tree = childEl(cSld, 'spTree');
    if (tree)
      await shapesOf(
        tree,
        { W, H, layers: lay.layers, sizes: lay.sizes, rels: srels, bag, budget },
        (x) => x,
        model.items,
      );
    slides.push(model);
  }
  return {
    kind: 'slides',
    w: W,
    h: H,
    slides,
    images: bag.images,
    cut: ids.length > SLIDES_MAX || budget.cut,
  };
}
