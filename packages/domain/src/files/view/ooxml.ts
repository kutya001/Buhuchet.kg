/** Общее для XLSX, DOCX и PPTX: связи частей (rels) и картинки из архива. */
import { parseXmlTree, attrOf, childEls } from './xml';
import { relsPathOf, resolvePart, type Zip } from './zip';

export interface Rel {
  id: string;
  /** Последняя часть типа связи: `worksheet`, `image`, `hyperlink`, `slide`… */
  type: string;
  /** Путь части в архиве; у внешней связи — пусто (её не открываем и не загружаем). */
  part: string;
  external: boolean;
}

export async function readRels(zip: Zip, part: string): Promise<Map<string, Rel>> {
  const map = new Map<string, Rel>();
  const src = await zip.text(relsPathOf(part));
  if (!src) return map;
  const { root } = parseXmlTree(src, 100_000);
  for (const r of childEls(root ?? undefined, 'Relationship')) {
    const id = attrOf(r, 'Id');
    const target = attrOf(r, 'Target') ?? '';
    if (!id) continue;
    const external = attrOf(r, 'TargetMode') === 'External';
    const type = (attrOf(r, 'Type') ?? '').split('/').pop() ?? '';
    map.set(id, { id, type, external, part: external ? '' : resolvePart(part, target) });
  }
  return map;
}

/** Картинки, которые окно показывает: только растровые форматы, которые браузер рисует сам (без SVG). */
export type ViewImageType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export interface ViewImage {
  type: ViewImageType;
  bytes: Uint8Array;
}

/** Тип картинки по первым байтам (не по расширению); прочее — `null`. */
export function viewImageType(b: Uint8Array): ViewImageType | null {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  )
    return 'image/webp';
  return null;
}

/** Картинок одного файла — не больше. */
export const VIEW_MAX_IMAGES = 200;

/** Собирает картинки по связям: внешние и неподдерживаемые пропускаются. */
export class ImageBag {
  readonly images: Record<string, ViewImage> = {};
  private count = 0;
  constructor(private readonly zip: Zip) {}
  /** Ключ картинки для модели или `null`, если её не показать. */
  async add(rel: Rel | undefined): Promise<string | null> {
    if (!rel || rel.external || !rel.part) return null;
    if (rel.part in this.images) return rel.part;
    if (this.count >= VIEW_MAX_IMAGES) return null;
    const bytes = await this.zip.read(rel.part);
    if (!bytes) return null;
    const type = viewImageType(bytes);
    if (!type) return null;
    this.count++;
    // Своя копия байтов: модель уходит из потока разбора копией, и вместе с частью архива
    // скопировался бы весь файл.
    this.images[rel.part] = { type, bytes: bytes.slice() };
    return rel.part;
  }
}

/** EMU (единицы Office) в пиксели экрана при 96 dpi. */
export const emuToPx = (emu: number) => Math.round(emu / 9525);
