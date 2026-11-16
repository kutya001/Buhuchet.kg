import type { UiTextDefault } from './texts';

const V = 'Окно просмотра файлов';

/**
 * Окно просмотра файлов (доработки 16.11.2026, блок 5; прототип v126 `ui/file-view.js`): листание,
 * масштаб, поиск, слайды, кодировка текста и что делать, когда просмотра нет.
 */
export const FILES_VIEW_TEXTS = {
  'files.view.prev': { ru: 'Предыдущий файл', section: V },
  'files.view.next': { ru: 'Следующий файл', section: V },
  'files.view.counter': { ru: '{n} из {total}', section: V },
  'files.view.close': { ru: 'Закрыть', section: V },
  'files.view.open': { ru: 'Открыть просмотр', section: V },
  'files.view.loading': { ru: 'Открываем файл…', section: V },
  'files.view.zoom_in': { ru: 'Увеличить', section: V },
  'files.view.zoom_out': { ru: 'Уменьшить', section: V },
  'files.view.rotate': { ru: 'Повернуть', section: V },
  'files.view.fit': { ru: 'Вписать', section: V },
  'files.view.sheet_search': { ru: 'Найти на листе', section: V },
  'files.view.xml_search': { ru: 'Найти в XML', section: V },
  'files.view.found': { ru: 'Найдено: {n}', section: V },
  'files.view.not_found': { ru: 'Ничего не найдено', section: V },
  'files.view.more_rows': {
    ru: 'Показаны первые {shown} строк из {total} — скачайте файл, чтобы увидеть всё',
    section: V,
  },
  'files.view.more_all': {
    ru: 'Показана первая часть файла — скачайте файл, чтобы увидеть всё',
    section: V,
  },
  'files.view.prev_slide': { ru: 'Предыдущий слайд', section: V },
  'files.view.next_slide': { ru: 'Следующий слайд', section: V },
  'files.view.slide_of': { ru: 'Слайд {n} из {total}', section: V },
  'files.view.encoding': { ru: 'Кодировка: {enc} · определена автоматически', section: V },
  'files.view.collapse_all': { ru: 'Свернуть всё', section: V },
  'files.view.expand_all': { ru: 'Развернуть всё', section: V },
  'files.view.collapse': { ru: 'Свернуть {name}', section: V },
  'files.view.expand': { ru: 'Развернуть {name}', section: V },
  'files.view.doctype': {
    ru: 'В файле есть объявление DOCTYPE: оно пропущено, внешние данные из файла не загружаются',
    section: V,
  },
  'files.view.empty_sheet': { ru: 'В книге нет листов для просмотра', section: V },
  'files.view.none': { ru: 'Предпросмотр недоступен', section: V },
  'files.view.none_hint': { ru: 'Скачайте файл, чтобы открыть его', section: V },
  'files.view.old': { ru: 'Старый формат {ext} — просмотр недоступен', section: V },
  'files.view.old_hint': { ru: 'Скачайте файл и откройте его в {app}', section: V },
  'files.view.failed': { ru: 'Не удалось открыть файл', section: V },
  'files.view.encrypted': { ru: 'Файл защищён паролем — просмотр недоступен', section: V },
  'files.view.too_big': { ru: 'Файл слишком сложный для просмотра', section: V },
} as const satisfies Record<string, UiTextDefault>;
