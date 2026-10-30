import type { UiTextDefault } from './texts';

const S = 'Админка';

/**
 * Тексты пересчёта сроков несданных отчётов после правки каталога (задача 2.37; ТЗ «система
 * показывает, сколько несданных отчётов в скольких организациях изменится, и пересчитывает только
 * их»; прототип spreadTxt, importDictDlg): причины в истории отчёта и предупреждения окон.
 */
export const PLATFORM_DICTS_DUES_TEXTS = {
  // Причины в истории отчёта («было → стало»); у статуса — «Срок по статусу «…»», как у контрагента.
  'pdicts.dues.reason.type': { ru: 'Изменено правило срока вида отчёта', section: S },
  'pdicts.dues.reason.calendar': { ru: 'Изменён производственный календарь', section: S },
  // Пояснение вкладки «Календарь» (прототип renderPDicts): пример переноса срока.
  'pdicts.cal.rule_example': { ru: 'Пример: {type} за {period} — {from} → {to}.', section: S },
  // Окна календаря: «Нерабочий день», «Удалить», «Календарь на следующий год копированием».
  'pdicts.cal.dues': {
    ru: 'Сроки пересчитаются у {spread}. Сданные не меняются.',
    section: S,
  },
  'pdicts.cal.dues_wait': { ru: 'Считаем, у скольких отчётов изменятся сроки…', section: S },
  // Окно статуса: «Меняет сроки» изменён.
  'pdicts.benefit.dues': {
    ru: 'Сроки по статусу пересчитаются у {spread}. Сданные не меняются.',
    section: S,
  },
  // Сравнение загрузки (прототип df.dues, df.actR).
  'pdicts.io.import.dues': {
    ru: 'Изменятся сроки у {spread}. Сданные отчёты не меняются.',
    section: S,
  },
  'pdicts.io.import.act': {
    ru: '«Что нужно сделать» меняется у {types}: {reports}, они не изменятся. Новое значение действует для новых периодов.',
    section: S,
  },
  'pdicts.io.import.act_types.one': { ru: '{n} вида', section: S },
  'pdicts.io.import.act_types.few': { ru: '{n} видов', section: S },
  'pdicts.io.import.act_types.many': { ru: '{n} видов', section: S },
  'pdicts.io.import.act_one.one': { ru: 'по нему уже создан {n} отчёт', section: S },
  'pdicts.io.import.act_one.few': { ru: 'по нему уже создано {n} отчёта', section: S },
  'pdicts.io.import.act_one.many': { ru: 'по нему уже создано {n} отчётов', section: S },
  'pdicts.io.import.act_many.one': { ru: 'по ним уже создан {n} отчёт', section: S },
  'pdicts.io.import.act_many.few': { ru: 'по ним уже создано {n} отчёта', section: S },
  'pdicts.io.import.act_many.many': { ru: 'по ним уже создано {n} отчётов', section: S },
} as const satisfies Record<string, UiTextDefault>;
