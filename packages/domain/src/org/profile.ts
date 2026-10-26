/**
 * «Моя организация» → «Основное» (ТЗ: название, ИНН, адрес, телефон, руководитель, логотип до 2 МБ).
 * Пределы длины — чтобы строкой без предела нельзя было забить базу; в прототипе их нет.
 */
export const ORG_NAME_MAX_LENGTH = 200;
export const ORG_ADDRESS_MAX_LENGTH = 300;
export const ORG_HEAD_MAX_LENGTH = 200;

/** Логотип — картинка до 2 МБ (прототип modules/org.js: `lf.size > 2*1048576`). */
export const LOGO_MAX_BYTES = 2 * 1048576;

/** Тексты под полями «Основное» (прототип modules/org.js, og-save). */
export const ORG_PROFILE_MESSAGES = {
  name_required: 'Введите название',
  inn_invalid: 'ИНН — 14 цифр',
  inn_taken: 'Организация с таким ИНН уже есть',
  logo_too_large: 'Файл больше 2 МБ',
  logo_type: 'Логотип — картинка PNG или JPG',
} as const;

/** Типы картинок логотипа: подсказка прототипа «PNG или JPG до 2 МБ». */
export type LogoImageType = 'image/png' | 'image/jpeg';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

/**
 * Тип картинки по первым байтам файла, а не по имени и заголовку запроса: так под видом логотипа не
 * сохранить HTML или SVG со сценарием. null — не PNG и не JPG.
 */
export function logoImageType(bytes: Uint8Array): LogoImageType | null {
  const starts = (sig: number[]) =>
    bytes.length > sig.length && sig.every((b, i) => bytes[i] === b);
  if (starts(PNG_SIGNATURE)) return 'image/png';
  if (starts(JPEG_SIGNATURE)) return 'image/jpeg';
  return null;
}

/** Что не так с файлом логотипа: размер, затем тип. */
export function logoProblem(bytes: Uint8Array): 'logo_too_large' | 'logo_type' | null {
  if (bytes.length > LOGO_MAX_BYTES) return 'logo_too_large';
  return logoImageType(bytes) ? null : 'logo_type';
}
