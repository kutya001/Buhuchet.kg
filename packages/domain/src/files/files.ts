/**
 * Файлы записей (ТЗ «Файловый менеджер»; прототип modules/services.js — блок «Файлы» записи `filesBox`,
 * modules/files.js — правила): файл до 20 МБ, свой файл удаляется без права в течение суток, чужой — с
 * правом «Удалять файлы». Сам файл лежит в хранилище S3, в базе — его описание и запись, к которой он
 * прикреплён (источник).
 */

/** Файл — не больше 20 МБ (прототип modules/files.js, uploadDlg: `x.size > 20*1048576`). */
export const FILE_MAX_BYTES = 20 * 1048576;

/** Имя файла — не длиннее 255 символов, как в файловых системах. */
export const FILE_NAME_MAX_LENGTH = 255;

/** Ссылка на скачивание и на загрузку живёт 15 минут, как ссылка на логотип. */
export const FILE_LINK_SECONDS = 15 * 60;

const DAY_MS = 86_400_000;

/** Свой файл можно удалить без права «Удалять файлы» в течение суток после загрузки (ТЗ). */
export const FILE_OWN_DELETE_MS = DAY_MS;

/** Незаконченная загрузка (файл так и не дошёл до хранилища) убирается через сутки. */
export const FILE_PENDING_TTL_MS = DAY_MS;

/**
 * Источник файла — к какой записи он прикреплён (столбец «Источник» Файлового менеджера). Модуль, у
 * записей которого есть блок «Файлы», добавляет сюда свой вид (одна строка на модуль, по порядку
 * модулей ТЗ) и подключает его в API (`FILE_SOURCES` в packages/api). «manual» — «Загружен вручную»:
 * файл без записи, общий файл организации.
 */
export const FILE_SOURCE_KINDS = ['manual'] as const;
export type FileSourceKind = (typeof FILE_SOURCE_KINDS)[number];

export function isFileSourceKind(value: string): value is FileSourceKind {
  return (FILE_SOURCE_KINDS as readonly string[]).includes(value);
}

/** Тексты отказов (прототип: «Файл больше 20 МБ», подсказка у «Удалить»). */
export const FILE_MESSAGES = {
  file_too_large: 'Файл больше 20 МБ',
  file_type_forbidden: 'Такие файлы не загружаются: программы, сценарии и веб-страницы',
  file_name_invalid: 'Неверное имя файла',
  file_delete_forbidden:
    'Нужно право «Удалять файлы»: свой файл можно удалить без права в течение суток',
  file_not_uploaded: 'Файл не загрузился. Попробуйте ещё раз',
  files_off: 'Файлы в карточках выключены в учётной политике',
} as const;
export type FileProblem = keyof typeof FILE_MESSAGES;

/** Расширение файла без точки, строчными; null — расширения нет (как `fext` прототипа). */
export function fileExtension(name: string): string | null {
  const i = name.lastIndexOf('.');
  if (i <= 0 || i === name.length - 1) return null;
  return name.slice(i + 1).toLowerCase();
}

/**
 * Что не загружается: программы и сценарии, веб-страницы и картинки SVG — такой файл выполнит код,
 * если его открыть. Остальное — любое: договоры, выписки, отчёты, таблицы, картинки, архивы.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#47
export const FILE_BLOCKED_EXTENSIONS: ReadonlySet<string> = new Set([
  'exe', 'msi', 'msp', 'com', 'scr', 'pif', 'cpl', 'dll', 'sys', 'lnk', 'reg', 'inf',
  'bat', 'cmd', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'mjs', 'cjs', 'wsf', 'wsh', 'hta',
  'jar', 'sh', 'bash', 'app', 'dmg', 'pkg', 'apk', 'deb', 'rpm',
  'html', 'htm', 'xhtml', 'shtml', 'mht', 'mhtml', 'svg', 'svgz',
  'php', 'phtml', 'asp', 'aspx', 'jsp',
]); // prettier-ignore

/** Тип содержимого по расширению: под ним файл лежит в хранилище и отдаётся при скачивании. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  rtf: 'application/rtf',
  txt: 'text/plain',
  csv: 'text/csv',
  xml: 'application/xml',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
};

/**
 * Тип содержимого файла — по расширению, а не по заголовку браузера (браузер может не знать тип или
 * назвать его как угодно); неизвестное — `application/octet-stream`.
 */
export function fileContentType(name: string): string {
  return CONTENT_TYPES[fileExtension(name) ?? ''] ?? 'application/octet-stream';
}

/** Управляющие символы и разделители пути — в имени файла их не бывает. */
// eslint-disable-next-line no-control-regex
const BAD_NAME = /[\u0000-\u001f\u007f/\\]/;

/** Что не так с загружаемым файлом: имя, тип, затем размер. */
export function fileUploadProblem(file: { name: string; size: number }): FileProblem | null {
  const name = file.name.trim();
  if (!name || name.length > FILE_NAME_MAX_LENGTH || BAD_NAME.test(name)) {
    return 'file_name_invalid';
  }
  if (FILE_BLOCKED_EXTENSIONS.has(fileExtension(name) ?? '')) return 'file_type_forbidden';
  return file.size > FILE_MAX_BYTES ? 'file_too_large' : null;
}

/**
 * Размер для показа (прототип `fmtSize`): до 1 МБ — целые КБ, дальше — МБ с одним знаком после
 * запятой. Подпись единицы — из словаря (`files.size.kb`, `files.size.mb`).
 */
export function fileSizeParts(bytes: number): { value: string; unit: 'kb' | 'mb' } {
  if (bytes < 1048576) return { value: String(Math.round(bytes / 1024)), unit: 'kb' };
  return { value: (bytes / 1048576).toFixed(1).replace('.', ','), unit: 'mb' };
}

/** Можно ли удалить файл: свой — в течение суток после загрузки, чужой и старый — только с правом. */
export function fileDeleteRefusal(
  file: { uploadedBy: string | null; uploadedAt: Date },
  actor: { userId: string; canDeleteAny: boolean; now: Date },
): 'file_delete_forbidden' | null {
  if (actor.canDeleteAny) return null;
  const own = file.uploadedBy !== null && file.uploadedBy === actor.userId;
  const fresh = actor.now.getTime() - file.uploadedAt.getTime() < FILE_OWN_DELETE_MS;
  return own && fresh ? null : 'file_delete_forbidden';
}
