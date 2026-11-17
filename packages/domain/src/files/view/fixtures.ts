/**
 * Только для тестов окна просмотра: маленькие настоящие файлы XLSX, DOCX, PPTX, XLS и ZIP,
 * собранные в памяти (без сторонних библиотек), — и файлы для проверки защиты (макрос, zip-бомба).
 */

const enc = new TextEncoder();

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export async function deflateRaw(b: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate-raw');
  const w = cs.writable.getWriter();
  void w.write(b).then(() => w.close());
  const chunks: Uint8Array[] = [];
  const r = cs.readable.getReader();
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    chunks.push(value);
  }
  return concat(chunks);
}

export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

class Bytes {
  private parts: number[] = [];
  u8(v: number) {
    this.parts.push(v & 0xff);
    return this;
  }
  u16(v: number) {
    return this.u8(v).u8(v >>> 8);
  }
  u32(v: number) {
    return this.u16(v & 0xffff).u16(v >>> 16);
  }
  f64(v: number) {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, v, true);
    return this.raw(b);
  }
  raw(b: Uint8Array | number[]) {
    for (const x of b) this.parts.push(x);
    return this;
  }
  get length() {
    return this.parts.length;
  }
  done() {
    return new Uint8Array(this.parts);
  }
}

export interface ZipFileSpec {
  name: string;
  data: string | Uint8Array;
  /** Без сжатия. */
  store?: boolean;
  /** Записать в каталог ложный распакованный размер (архив, который врёт). */
  declaredSize?: number;
  /** Пометить запись зашифрованной. */
  encrypted?: boolean;
}

/** Архив ZIP из записей. */
export async function zipBytes(files: ZipFileSpec[]): Promise<Uint8Array> {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const comp = f.store ? data : await deflateRaw(data);
    const name = enc.encode(f.name);
    const crc = crc32(data);
    const usize = f.declaredSize ?? data.length;
    const flags = 0x0800 | (f.encrypted ? 1 : 0);
    const method = f.store ? 0 : 8;
    const lh = new Bytes()
      .u32(0x04034b50)
      .u16(20)
      .u16(flags)
      .u16(method)
      .u16(0)
      .u16(0x21)
      .u32(crc)
      .u32(comp.length)
      .u32(usize)
      .u16(name.length)
      .u16(0)
      .raw(name)
      .done();
    local.push(lh, comp);
    central.push(
      new Bytes()
        .u32(0x02014b50)
        .u16(20)
        .u16(20)
        .u16(flags)
        .u16(method)
        .u16(0)
        .u16(0x21)
        .u32(crc)
        .u32(comp.length)
        .u32(usize)
        .u16(name.length)
        .u16(0)
        .u16(0)
        .u16(0)
        .u16(0)
        .u32(0)
        .u32(offset)
        .raw(name)
        .done(),
    );
    offset += lh.length + comp.length;
  }
  const cd = concat(central);
  const end = new Bytes()
    .u32(0x06054b50)
    .u16(0)
    .u16(0)
    .u16(files.length)
    .u16(files.length)
    .u32(cd.length)
    .u32(offset)
    .u16(0)
    .done();
  return concat([...local, cd, end]);
}

const xmlEsc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const HDR = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = (id: string, type: string, target: string, external = false) =>
  `<Relationship Id="${id}" Type="${NS_R}/${type}" Target="${xmlEsc(target)}"${external ? ' TargetMode="External"' : ''}/>`;
const RELS = (items: string[]) =>
  `${HDR}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.join('')}</Relationships>`;

/** Ячейка теста: строка, число, или `{ v, s, f }` (s — номер стиля, f — формула с сохранённым значением). */
export type XCell =
  string | number | boolean | null | { v: string | number; s?: number; f?: string };

export interface XSheetSpec {
  name: string;
  rows?: XCell[][];
  /** Строк без содержимого перед хвостом — для большого листа строится строкой сразу. */
  bigRows?: number;
  hidden?: boolean;
  merges?: string[];
  cols?: { min: number; max: number; width?: number; hidden?: boolean }[];
}

export const colName = (i: number) => {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

/**
 * Книга XLSX. Стили: 0 — обычный, 1 — жирный, 2 — дата (14), 3 — «#,##0.00», 4 — свой «0.0%»,
 * 5 — по центру. `macro` добавляет `xl/vbaProject.bin` (XLSM с макросом).
 */
export async function xlsxBytes(
  sheets: XSheetSpec[],
  opts: { macro?: boolean; date1904?: boolean } = {},
): Promise<Uint8Array> {
  const sst: string[] = [];
  const sstIdx = new Map<string, number>();
  const si = (s: string) => {
    if (!sstIdx.has(s)) {
      sstIdx.set(s, sst.length);
      sst.push(s);
    }
    return sstIdx.get(s)!;
  };
  const files: ZipFileSpec[] = [];
  sheets.forEach((sh, k) => {
    const rowsXml: string[] = [];
    (sh.rows ?? []).forEach((row, r) => {
      const cells = row
        .map((c, ci) => {
          if (c === null) return '';
          const ref = `${colName(ci)}${r + 1}`;
          if (typeof c === 'string') return `<c r="${ref}" t="s"><v>${si(c)}</v></c>`;
          if (typeof c === 'number') return `<c r="${ref}"><v>${c}</v></c>`;
          if (typeof c === 'boolean') return `<c r="${ref}" t="b"><v>${c ? 1 : 0}</v></c>`;
          const s = c.s !== undefined ? ` s="${c.s}"` : '';
          const f = c.f ? `<f>${xmlEsc(c.f)}</f>` : '';
          if (typeof c.v === 'string')
            return c.f
              ? `<c r="${ref}"${s} t="str">${f}<v>${xmlEsc(c.v)}</v></c>`
              : `<c r="${ref}"${s} t="s"><v>${si(c.v)}</v></c>`;
          return `<c r="${ref}"${s}>${f}<v>${c.v}</v></c>`;
        })
        .join('');
      rowsXml.push(`<row r="${r + 1}">${cells}</row>`);
    });
    let big = '';
    if (sh.bigRows) {
      const from = (sh.rows?.length ?? 0) + 1;
      const parts: string[] = [];
      for (let r = from; r < from + sh.bigRows; r++)
        parts.push(
          `<row r="${r}"><c r="A${r}"><v>${r}</v></c><c r="B${r}" t="inlineStr"><is><t>Строка ${r}</t></is></c></row>`,
        );
      big = parts.join('');
    }
    const cols = sh.cols?.length
      ? `<cols>${sh.cols.map((c) => `<col min="${c.min}" max="${c.max}"${c.width ? ` width="${c.width}" customWidth="1"` : ''}${c.hidden ? ' hidden="1"' : ''}/>`).join('')}</cols>`
      : '';
    const merges = sh.merges?.length
      ? `<mergeCells count="${sh.merges.length}">${sh.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`
      : '';
    files.push({
      name: `xl/worksheets/sheet${k + 1}.xml`,
      data: `${HDR}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${NS_R}"><dimension ref="A1"/>${cols}<sheetData>${rowsXml.join('')}${big}</sheetData>${merges}</worksheet>`,
    });
  });
  const ct = `${HDR}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.${opts.macro ? 'ms-excel.sheet.macroEnabled.main+xml' : 'openxmlformats-officedocument.spreadsheetml.sheet.main+xml'}"/></Types>`;
  const wbRels = [
    ...sheets.map((_, k) => REL(`rId${k + 1}`, 'worksheet', `worksheets/sheet${k + 1}.xml`)),
    REL('rIdS', 'sharedStrings', 'sharedStrings.xml'),
    REL('rIdT', 'styles', 'styles.xml'),
    ...(opts.macro
      ? [
          '<Relationship Id="rIdV" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/>',
        ]
      : []),
    REL('rIdX', 'externalLink', 'http://evil.example/data.xlsx', true),
  ];
  const wb = `${HDR}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${NS_R}"><workbookPr${opts.date1904 ? ' date1904="1"' : ''}/><sheets>${sheets
    .map(
      (s, k) =>
        `<sheet name="${xmlEsc(s.name)}" sheetId="${k + 1}"${s.hidden ? ' state="hidden"' : ''} r:id="rId${k + 1}"/>`,
    )
    .join('')}</sheets></workbook>`;
  const styles = `${HDR}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.0%"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFC00000"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/></patternFill></fill></fills><borders count="1"><border/></borders><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0"/><xf numFmtId="0" fontId="1" fillId="2" applyFont="1"/><xf numFmtId="14" fontId="0" fillId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="0" fillId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="0"><alignment horizontal="center" wrapText="1"/></xf></cellXfs></styleSheet>`;
  const sstXml = `${HDR}<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sst.length}" uniqueCount="${sst.length}">${sst.map((s) => `<si><t xml:space="preserve">${xmlEsc(s)}</t></si>`).join('')}</sst>`;
  return zipBytes([
    { name: '[Content_Types].xml', data: ct },
    { name: '_rels/.rels', data: RELS([REL('rId1', 'officeDocument', 'xl/workbook.xml')]) },
    { name: 'xl/workbook.xml', data: wb },
    { name: 'xl/_rels/workbook.xml.rels', data: RELS(wbRels) },
    { name: 'xl/styles.xml', data: styles },
    { name: 'xl/sharedStrings.xml', data: sstXml },
    ...files,
    ...(opts.macro
      ? [
          {
            name: 'xl/vbaProject.bin',
            data: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 1, 2, 3, 4]),
          },
        ]
      : []),
  ]);
}

/** Маленькая картинка PNG 1×1. */
export const PNG_1PX = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1,
  0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89, 0, 0, 0, 13, 0x49, 0x44, 0x41, 0x54, 0x78,
  0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0, 0x1f, 0, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99, 0x3d, 0x1d, 0, 0,
  0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

/** Документ DOCX из готового тела `<w:body>` (с картинкой rIdImg и внешней картинкой rIdExt). */
export async function docxBytes(
  body: string,
  opts: { styles?: string; numbering?: string } = {},
): Promise<Uint8Array> {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const styles =
    opts.styles ??
    `${HDR}<w:styles ${W}><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Heading1"/></w:style><w:style w:type="paragraph" w:styleId="MyHead"><w:name w:val="Мой заголовок"/><w:basedOn w:val="Heading2"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style><w:style w:type="paragraph" w:styleId="ListPara"><w:name w:val="List Paragraph"/><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Strong"><w:name w:val="Strong para"/><w:rPr><w:b/></w:rPr></w:style></w:styles>`;
  const numbering =
    opts.numbering ??
    `${HDR}<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%1.%2)"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val=""/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;
  return zipBytes([
    {
      name: '[Content_Types].xml',
      data: `${HDR}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
    },
    { name: '_rels/.rels', data: RELS([REL('rId1', 'officeDocument', 'word/document.xml')]) },
    {
      name: 'word/document.xml',
      data: `${HDR}<w:document ${W} xmlns:r="${NS_R}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body}<w:sectPr/></w:body></w:document>`,
    },
    {
      name: 'word/_rels/document.xml.rels',
      data: RELS([
        REL('rIdSt', 'styles', 'styles.xml'),
        REL('rIdNum', 'numbering', 'numbering.xml'),
        REL('rIdImg', 'image', 'media/image1.png'),
        REL('rIdExt', 'image', 'http://evil.example/track.png', true),
        REL('rIdLink', 'hyperlink', 'http://evil.example/', true),
        REL('rIdEmf', 'image', 'media/image2.emf'),
      ]),
    },
    { name: 'word/styles.xml', data: styles },
    { name: 'word/numbering.xml', data: numbering },
    { name: 'word/media/image1.png', data: PNG_1PX, store: true },
    {
      name: 'word/media/image2.emf',
      data: new Uint8Array([1, 0, 0, 0, 0x6c, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      store: true,
    },
  ]);
}

/** Картинка внутри абзаца DOCX. */
export const docxImage = (rid: string, cx = 952500, cy = 476250) =>
  `<w:r><w:drawing><wp:inline><wp:extent cx="${cx}" cy="${cy}"/><a:graphic><a:graphicData><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:embed="${rid}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;

/** Презентация PPTX: слайды из готовых `<p:spTree>`-детей; макет даёт место заголовка и текста. */
export async function pptxBytes(
  slides: string[],
  opts: { hidden?: number[]; width?: number; height?: number } = {},
): Promise<Uint8Array> {
  const P =
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
  const sp = (type: string, x: number, y: number, w: number, h: number, idx?: number) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="ph"/><p:cNvSpPr/><p:nvPr><p:ph type="${type}"${idx !== undefined ? ` idx="${idx}"` : ''}/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm></p:spPr></p:sp>`;
  const W = opts.width ?? 12192000;
  const H = opts.height ?? 6858000;
  const files: ZipFileSpec[] = [
    {
      name: '[Content_Types].xml',
      data: `${HDR}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
    },
    { name: '_rels/.rels', data: RELS([REL('rId1', 'officeDocument', 'ppt/presentation.xml')]) },
    {
      name: 'ppt/presentation.xml',
      data: `${HDR}<p:presentation ${P} xmlns:r="${NS_R}"><p:sldIdLst>${slides.map((_, k) => `<p:sldId id="${256 + k}" r:id="rId${k + 1}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${W}" cy="${H}"/></p:presentation>`,
    },
    {
      name: 'ppt/_rels/presentation.xml.rels',
      data: RELS(slides.map((_, k) => REL(`rId${k + 1}`, 'slide', `slides/slide${k + 1}.xml`))),
    },
    {
      name: 'ppt/slideLayouts/slideLayout1.xml',
      data: `${HDR}<p:sldLayout ${P}><p:cSld><p:spTree>${sp('title', 838200, 365125, 10515600, 1325563)}${sp('body', 838200, 1825625, 10515600, 4351338, 1)}</p:spTree></p:cSld></p:sldLayout>`,
    },
    {
      name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
      data: RELS([REL('rId1', 'slideMaster', '../slideMasters/slideMaster1.xml')]),
    },
    {
      name: 'ppt/slideMasters/slideMaster1.xml',
      data: `${HDR}<p:sldMaster ${P}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="F4F4F4"/></a:solidFill></p:bgPr></p:bg><p:spTree>${sp('dt', 0, 6000000, 2000000, 300000, 10)}</p:spTree></p:cSld><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4000"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="2600"/></a:lvl1pPr><a:lvl2pPr><a:defRPr sz="2200"/></a:lvl2pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1600"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`,
    },
    { name: 'ppt/media/image1.png', data: PNG_1PX, store: true },
  ];
  slides.forEach((tree, k) => {
    files.push({
      name: `ppt/slides/slide${k + 1}.xml`,
      data: `${HDR}<p:sld ${P} xmlns:r="${NS_R}"${opts.hidden?.includes(k) ? ' show="0"' : ''}><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/>${tree}</p:spTree></p:cSld></p:sld>`,
    });
    files.push({
      name: `ppt/slides/_rels/slide${k + 1}.xml.rels`,
      data: RELS([
        REL('rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'),
        REL('rId2', 'image', '../media/image1.png'),
        REL('rId3', 'image', 'http://evil.example/x.png', true),
      ]),
    });
  });
  return zipBytes(files);
}

// ── XLS (BIFF8 в составном файле) ──

const rec = (type: number, data: Uint8Array) =>
  new Bytes().u16(type).u16(data.length).raw(data).done();
const xlStr = (s: string, short = false) => {
  const high = [...s].some((c) => c.charCodeAt(0) > 0xff);
  const b = new Bytes();
  if (short) b.u8(s.length);
  else b.u16(s.length);
  b.u8(high ? 1 : 0);
  for (const c of s) {
    if (high) b.u16(c.charCodeAt(0));
    else b.u8(c.charCodeAt(0));
  }
  return b.done();
};

export interface XlsCellSpec {
  r: number;
  c: number;
  /** label — строка через SST, number, rk, bool, err, formula (число), fstr (формула со строкой), mulrk — несколько RK. */
  k: 'label' | 'number' | 'rk' | 'bool' | 'err' | 'formula' | 'fstr' | 'mulrk' | 'labelInline';
  v: string | number | boolean | number[];
  xf?: number;
}

export interface XlsSheetSpec {
  name: string;
  hidden?: boolean;
  cells: XlsCellSpec[];
  merges?: [number, number, number, number][];
  colWidths?: { first: number; last: number; width256: number; hidden?: boolean }[];
  /** Высота строки (двадцатые пункта) и скрытая строка. */
  rowsInfo?: { r: number; twips?: number; hidden?: boolean }[];
  dimRows?: number;
}

/**
 * Книга XLS. Шрифты: 0 обычный, 1 жирный. XF: 0 обычный, 1 жирный, 2 дата (14), 3 «#,##0.00»,
 * 4 свой формат 164 «0.00" сом"», 5 по центру. `sst` — строки таблицы (длинная строка режется CONTINUE).
 */
export function xlsWorkbookStream(
  sheets: XlsSheetSpec[],
  opts: { encrypted?: boolean; date1904?: boolean; splitSst?: boolean } = {},
): Uint8Array {
  const sst: string[] = [];
  for (const s of sheets)
    for (const c of s.cells)
      if (c.k === 'label' && !sst.includes(String(c.v))) sst.push(String(c.v));
  const bof = (dt: number) =>
    rec(0x0809, new Bytes().u16(0x0600).u16(dt).u16(0x0dbb).u16(0x07cc).u32(0).u32(0x0206).done());
  const font = (bold: boolean) =>
    rec(
      0x0031,
      new Bytes()
        .u16(220)
        .u16(0)
        .u16(0x7fff)
        .u16(bold ? 700 : 400)
        .u16(0)
        .u8(0)
        .u8(0)
        .u8(0)
        .u8(0)
        .raw(xlStr('Arial', true))
        .done(),
    );
  const xf = (fnt: number, fmt: number, alc = 0) =>
    rec(
      0x00e0,
      new Bytes().u16(fnt).u16(fmt).u16(0x0001).u8(alc).u8(0).u32(0).u32(0).u32(0).u16(0).done(),
    );
  const g: Uint8Array[] = [bof(0x0005)];
  if (opts.encrypted) g.push(rec(0x002f, new Uint8Array(54)));
  g.push(rec(0x0022, new Bytes().u16(opts.date1904 ? 1 : 0).done()));
  g.push(font(false), font(true), font(false), font(false), font(false));
  g.push(rec(0x041e, new Bytes().u16(164).raw(xlStr('0.00" сом"')).done()));
  g.push(xf(0, 0), xf(1, 0), xf(0, 14), xf(0, 4), xf(0, 164), xf(0, 0, 2));
  // SST: при splitSst последняя строка начинается в SST и продолжается в CONTINUE (другой ширины знаков).
  const sstBody = new Bytes().u32(sst.length).u32(sst.length);
  const strs = sst.map((s) => xlStr(s));
  if (opts.splitSst && strs.length) {
    for (const s of strs.slice(0, -1)) sstBody.raw(s);
    const last = sst[sst.length - 1]!;
    const head = last.slice(0, 3);
    const tail = last.slice(3);
    sstBody.u16(last.length).u8(0);
    for (const c of head) sstBody.u8(c.charCodeAt(0));
    g.push(rec(0x00fc, sstBody.done()));
    const cont = new Bytes().u8(1);
    for (const c of tail) cont.u16(c.charCodeAt(0));
    g.push(rec(0x003c, cont.done()));
  } else {
    for (const s of strs) sstBody.raw(s);
    g.push(rec(0x00fc, sstBody.done()));
  }
  const bsIdx: number[] = [];
  for (const s of sheets) {
    bsIdx.push(g.length);
    g.push(
      rec(
        0x0085,
        new Bytes()
          .u32(0)
          .u8(s.hidden ? 1 : 0)
          .u8(0)
          .raw(xlStr(s.name, true))
          .done(),
      ),
    );
  }
  g.push(rec(0x000a, new Uint8Array(0)));
  let pos = g.reduce((n, x) => n + x.length, 0);
  const sheetStreams: Uint8Array[] = [];
  sheets.forEach((s, k) => {
    // Смещение BOF листа — в BOUNDSHEET.
    const bs = g[bsIdx[k]!]!;
    new DataView(bs.buffer, bs.byteOffset).setUint32(4, pos, true);
    const parts: Uint8Array[] = [bof(0x0010)];
    const maxR = Math.max(0, ...s.cells.map((c) => c.r + 1));
    parts.push(
      rec(
        0x0200,
        new Bytes()
          .u32(0)
          .u32(s.dimRows ?? maxR)
          .u16(0)
          .u16(10)
          .u16(0)
          .done(),
      ),
    );
    parts.push(rec(0x0055, new Bytes().u16(10).done()));
    for (const w of s.colWidths ?? [])
      parts.push(
        rec(
          0x007d,
          new Bytes()
            .u16(w.first)
            .u16(w.last)
            .u16(w.width256)
            .u16(0)
            .u16(w.hidden ? 1 : 0)
            .u16(0)
            .done(),
        ),
      );
    for (const ri of s.rowsInfo ?? [])
      parts.push(
        rec(
          0x0208,
          new Bytes()
            .u16(ri.r)
            .u16(0)
            .u16(10)
            .u16(ri.twips ?? 0x80ff)
            .u16(0)
            .u16(0)
            .u16((ri.hidden ? 0x20 : 0) | (ri.twips ? 0x40 : 0))
            .u16(0x0f)
            .done(),
        ),
      );
    for (const c of s.cells) {
      const xfi = c.xf ?? 0;
      const head = () => new Bytes().u16(c.r).u16(c.c).u16(xfi);
      const rk = (v: number) =>
        Number.isInteger(v * 100) && Math.abs(v * 100) < 2 ** 29 && !Number.isInteger(v)
          ? (((v * 100) << 2) | 3) >>> 0
          : ((v << 2) | 2) >>> 0;
      if (c.k === 'label')
        parts.push(
          rec(
            0x00fd,
            head()
              .u32(sst.indexOf(String(c.v)))
              .done(),
          ),
        );
      else if (c.k === 'labelInline')
        parts.push(
          rec(
            0x0204,
            head()
              .raw(xlStr(String(c.v)))
              .done(),
          ),
        );
      else if (c.k === 'number') parts.push(rec(0x0203, head().f64(Number(c.v)).done()));
      else if (c.k === 'rk')
        parts.push(
          rec(
            0x027e,
            head()
              .u32(rk(Number(c.v)))
              .done(),
          ),
        );
      else if (c.k === 'mulrk') {
        const vs = c.v as number[];
        const b = new Bytes().u16(c.r).u16(c.c);
        for (const v of vs) b.u16(xfi).u32(rk(v));
        parts.push(rec(0x00bd, b.u16(c.c + vs.length - 1).done()));
      } else if (c.k === 'bool')
        parts.push(
          rec(
            0x0205,
            head()
              .u8(c.v ? 1 : 0)
              .u8(0)
              .done(),
          ),
        );
      else if (c.k === 'err') parts.push(rec(0x0205, head().u8(Number(c.v)).u8(1).done()));
      else if (c.k === 'formula')
        parts.push(rec(0x0006, head().f64(Number(c.v)).u16(0).u32(0).u16(0).done()));
      else if (c.k === 'fstr') {
        parts.push(
          rec(0x0006, head().raw([0, 0, 0, 0, 0, 0, 0xff, 0xff]).u16(0).u32(0).u16(0).done()),
        );
        parts.push(rec(0x0207, xlStr(String(c.v))));
      }
    }
    if (s.merges?.length) {
      const b = new Bytes().u16(s.merges.length);
      for (const [r1, c1, r2, c2] of s.merges) b.u16(r1).u16(r2).u16(c1).u16(c2);
      parts.push(rec(0x00e5, b.done()));
    }
    parts.push(rec(0x000a, new Uint8Array(0)));
    const st = concat(parts);
    sheetStreams.push(st);
    pos += st.length;
  });
  return concat([...g, ...sheetStreams]);
}

/**
 * Составной файл (CFB, версия 3, сектора по 512 байт) с потоками. Поток меньше 4096 байт кладётся в
 * мини-поток корня, как это делает Excel.
 */
export function cfbBytes(streams: { name: string; data: Uint8Array }[]): Uint8Array {
  const SS = 512;
  const sectors: Uint8Array[] = [];
  const fat: number[] = [];
  const alloc = (data: Uint8Array): number => {
    const n = Math.max(1, Math.ceil(data.length / SS));
    const first = sectors.length;
    for (let i = 0; i < n; i++) {
      const s = new Uint8Array(SS);
      s.set(data.subarray(i * SS, (i + 1) * SS));
      sectors.push(s);
      fat.push(i === n - 1 ? 0xfffffffe : first + i + 1);
    }
    return first;
  };
  // Мини-поток для маленьких потоков.
  const mini: Uint8Array[] = [];
  const minifat: number[] = [];
  const entries: { name: string; type: number; start: number; size: number }[] = [];
  for (const s of streams) {
    if (s.data.length < 4096) {
      const n = Math.max(1, Math.ceil(s.data.length / 64));
      const first = mini.length;
      for (let i = 0; i < n; i++) {
        const m = new Uint8Array(64);
        m.set(s.data.subarray(i * 64, (i + 1) * 64));
        mini.push(m);
        minifat.push(i === n - 1 ? 0xfffffffe : first + i + 1);
      }
      entries.push({ name: s.name, type: 2, start: first, size: s.data.length });
    } else entries.push({ name: s.name, type: 2, start: alloc(s.data), size: s.data.length });
  }
  const miniStream = concat(mini);
  const rootStart = mini.length ? alloc(miniStream) : 0xfffffffe;
  const mfBytes = new Bytes();
  for (const m of minifat) mfBytes.u32(m);
  const miniFatStart = minifat.length ? alloc(mfBytes.done()) : 0xfffffffe;
  const dir = new Bytes();
  const dirEntry = (
    name: string,
    type: number,
    start: number,
    size: number,
    child: number,
    right: number,
  ) => {
    const nb = new Bytes();
    for (const c of name) nb.u16(c.charCodeAt(0));
    nb.u16(0);
    const nameBytes = nb.done();
    const e = new Uint8Array(128);
    e.set(nameBytes);
    const dv = new DataView(e.buffer);
    dv.setUint16(64, nameBytes.length, true);
    e[66] = type;
    e[67] = 1;
    dv.setUint32(68, 0xffffffff, true);
    dv.setUint32(72, right, true);
    dv.setUint32(76, child, true);
    dv.setUint32(116, start, true);
    dv.setUint32(120, size, true);
    dir.raw(e);
  };
  dirEntry(
    'Root Entry',
    5,
    rootStart,
    miniStream.length,
    entries.length ? 1 : 0xffffffff,
    0xffffffff,
  );
  entries.forEach((e, i) =>
    dirEntry(
      e.name,
      e.type,
      e.start,
      e.size,
      0xffffffff,
      i + 2 <= entries.length ? i + 2 : 0xffffffff,
    ),
  );
  const dirStart = alloc(dir.done());
  // Секторы таблицы размещения (до 109 — все номера в заголовке).
  let nFat = 1;
  while ((sectors.length + nFat) * 4 > nFat * SS) nFat++;
  const fatFirst = sectors.length;
  for (let i = 0; i < nFat; i++) {
    fat.push(0xfffffffd);
    sectors.push(new Uint8Array(SS));
  }
  for (let k = 0; k < nFat; k++) {
    const fb = new Bytes();
    for (let i = 0; i < SS / 4; i++) fb.u32(fat[k * (SS / 4) + i] ?? 0xffffffff);
    sectors[fatFirst + k] = fb.done();
  }
  const header = new Bytes()
    .raw([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    .raw(new Uint8Array(16))
    .u16(0x3e)
    .u16(3)
    .u16(0xfffe)
    .u16(9)
    .u16(6)
    .raw(new Uint8Array(6))
    .u32(0)
    .u32(nFat)
    .u32(dirStart)
    .u32(0)
    .u32(4096)
    .u32(miniFatStart)
    .u32(minifat.length ? 1 : 0)
    .u32(0xfffffffe)
    .u32(0);
  for (let i = 0; i < nFat; i++) header.u32(fatFirst + i);
  for (let i = nFat; i < 109; i++) header.u32(0xffffffff);
  return concat([header.done(), ...sectors]);
}
