import { FILE_MESSAGES, type FileProblem } from '../files/files';
import type { UiTextDefault } from './texts';

const S = 'Файлы';

/**
 * Тексты блока «Файлы» карточки записи (прототип modules/services.js `filesBox`, `bindFiles`, окно
 * удаления; modules/files.js `fmtSize`, `fext`, `uploadDlg`) и отказы API файлов.
 */
export const FILES_TEXTS = {
  'files.title': { ru: 'Файлы', section: S },
  'files.attach': { ru: 'Прикрепить', section: S },
  'files.uploading': { ru: 'Загрузка…', section: S },
  'files.empty': { ru: 'Файлов пока нет', section: S },
  'files.download': { ru: 'Скачать {name}', section: S },
  'files.remove': { ru: 'Удалить {name}', section: S },
  'files.remove_title': { ru: 'Удалить файл', section: S },
  'files.meta': { ru: '{ext} · {size}', section: S },
  'files.no_ext': { ru: 'ФАЙЛ', section: S },
  'files.size.kb': { ru: '{n} КБ', section: S },
  'files.size.mb': { ru: '{n} МБ', section: S },
  'files.attached': { ru: 'Файлы прикреплены', section: S },
  'files.too_large': { ru: 'Файл больше 20 МБ: {names}', section: S },
  'files.upload_failed': { ru: '{name}: {error}', section: S },
  'files.delete_title': { ru: 'Удалить файл «{name}»?', section: S },
  'files.delete_text': {
    ru: 'Файл пропадёт из записи и из файлового менеджера. Удаление записывается в историю.',
    section: S,
  },
  'files.delete_ok': { ru: 'Удалить', section: S },
  'files.deleted': { ru: 'Файл удалён', section: S },
  'files.load_error': { ru: 'Не удалось загрузить список файлов', section: S },
  'samples.files_title': { ru: 'Блок «Файлы» записи', section: 'Образцы' },
  'samples.files_hint': {
    ru: 'Общие файлы организации. Файлы сохраняются по-настоящему: их видят все, у кого есть право «Просматривать файлы».',
    section: 'Образцы',
  },
  ...(Object.fromEntries(
    Object.entries(FILE_MESSAGES).map(([code, ru]) => [`err.${code}`, { ru, section: 'Ошибки' }]),
  ) as Record<`err.${FileProblem}`, UiTextDefault>),
} as const satisfies Record<string, UiTextDefault>;
