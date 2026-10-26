/**
 * Компоновка форм на телефоне: короткие поля по два в строку (ТЗ «Общий интерфейс» → «Компоновка форм
 * на телефоне», прототип ui/mobile-pack.js). Здесь — правила без DOM: какое поле короткое и как поля
 * встают в строки. Замеры (ширина подписи, самого длинного значения списка) делает `useFormPack`.
 */

/** Компоновка действует до 600 px ширины экрана; на ПК раскладка не меняется (ТЗ, «по умолчанию»). */
export const PACK_QUERY = '(max-width: 600px)';

/** Промежуток между колонками формы и карточки просмотра, px (`.form` и `.kv` прототипа). */
export const FORM_GAP = 14;
export const KV_GAP = 18;

/** Поле ввода внутри поля формы — что о нём нужно знать, чтобы решить, короткое ли оно. */
export type ControlInfo =
  /** Дата, месяц, время, число, сумма (inputmode decimal/numeric): всегда короткое. */
  | { kind: 'fixed' }
  /** Свободный текст, пароль, телефон, почта: всегда длинное. */
  | { kind: 'text' }
  /** Галочка или переключатель; labelWidth — ширина подписи рядом (null — без подписи). */
  | { kind: 'check'; labelWidth: number | null }
  /** Выпадающий список: ширина самого длинного значения. */
  | { kind: 'select'; multiple: boolean; widestOption: number }
  /** Переключатель из кнопок (`.seg`): ширины подписей кнопок. */
  | { kind: 'segments'; widths: readonly number[] };

export interface FieldInfo {
  /** Поле на всю ширину и на ПК. */
  full: boolean;
  /** Ширина подписи поля в одну строку; null — подписи нет. */
  labelWidth: number | null;
  /** Внутри многострочный текст, файл, таблица, набор меток: поле всегда длинное. */
  block: boolean;
  controls: readonly ControlInfo[];
}

/** Ширина одной из двух колонок: (ширина формы − промежуток) / 2. */
export function columnWidth(width: number, gap: number): number {
  return (width - gap) / 2;
}

function controlFits(control: ControlInfo, column: number): boolean {
  switch (control.kind) {
    case 'fixed':
      return true;
    case 'text':
      return false;
    case 'check':
      return control.labelWidth === null || control.labelWidth + 48 <= column;
    case 'select':
      return !control.multiple && control.widestOption + 40 <= column;
    case 'segments':
      return control.widths.reduce((sum, w) => sum + w + 24, 8) <= column;
  }
}

/**
 * Короткое поле помещается в половину строки: дата, месяц, время, число, сумма, галочка с короткой
 * подписью, список, у которого самое длинное значение помещается в половину. Подпись поля, которая
 * не помещается в половину строки в одну строку, делает поле длинным.
 */
export function isShortField(field: FieldInfo, column: number): boolean {
  if (field.full || field.block || field.controls.length === 0) return false;
  if (field.labelWidth !== null && field.labelWidth > column) return false;
  return field.controls.every((control) => controlFits(control, column));
}

/** Ребёнок формы: поле, пустая ячейка (выравнивание на ПК) или что-то другое на всю ширину. */
export type FormCell = { field: FieldInfo } | 'spacer' | 'wide';

/** Где стоит ребёнок формы на телефоне: в половине строки, на всю ширину или не показывается. */
export type PackPlace = 'half' | 'full' | 'hidden';

/**
 * Форма изменения: строки собираются, как на ПК (по две ячейки; поле «на всю ширину» и не-поле
 * занимают строку). Пара остаётся в строке, только если оба поля короткие; иначе оба на всю ширину;
 * поле, оставшееся в строке одно, — на всю ширину. Пустая ячейка выравнивания на телефоне не нужна.
 * Порядок полей не меняется.
 */
export function packFormCells(cells: readonly FormCell[], column: number): PackPlace[] {
  const places: PackPlace[] = cells.map((cell) => (cell === 'spacer' ? 'hidden' : 'full'));
  let row: number[] = [];
  const closeRow = () => {
    const fields = row.filter((i) => cells[i] !== 'spacer');
    const two =
      fields.length === 2 &&
      fields.every((i) => {
        const cell = cells[i]!;
        return typeof cell === 'object' && isShortField(cell.field, column);
      });
    if (two) for (const i of fields) places[i] = 'half';
    row = [];
  };
  cells.forEach((cell, i) => {
    if (cell === 'wide' || (typeof cell === 'object' && cell.field.full)) {
      closeRow();
      return;
    }
    row.push(i);
    if (row.length === 2) closeRow();
  });
  closeRow();
  return places;
}

/** Значение карточки просмотра: ширины его строк; block — внутри таблица, список или набор меток. */
export interface KvInfo {
  block: boolean;
  lineWidths: readonly number[];
}

/**
 * Карточка просмотра: значения идут по порядку, два подряд коротких (каждая строка помещается в
 * половину) встают в одну строку, длинное — на всю ширину.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#29 — как kvShort прототипа: телефон меряется по ширине значения.
export function packKvItems(items: readonly KvInfo[], column: number): PackPlace[] {
  const short = (item: KvInfo) => !item.block && item.lineWidths.every((w) => w <= column);
  const places: PackPlace[] = items.map(() => 'full');
  for (let i = 0; i < items.length; i++) {
    const next = items[i + 1];
    if (next && short(items[i]!) && short(next)) {
      places[i] = 'half';
      places[i + 1] = 'half';
      i++;
    }
  }
  return places;
}
