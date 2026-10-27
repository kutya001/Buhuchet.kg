/*
 * Админка → «Справочники платформы» (задача 2.36; ТЗ «Админка» → «Модуль Справочники платформы» →
 * «Общие правила для всех справочников»; прототип admin/platform-dicts*.js): администратор платформы
 * добавляет значение, переименовывает его, меняет порядок кнопками «Выше» и «Ниже», отключает и
 * удаляет неиспользуемое; отвечает на запросы организаций «Попросить добавить». Правила — здесь,
 * запись — функции администратора в базе (`adminDictInsert` и соседние из @buhuchet/db).
 */

/**
 * Справочники, которые правятся общим механизмом (часть 1 задачи 2.36), в порядке вкладок модуля.
 * Новый справочник добавляет сюда строку, перечень полей ниже и строку перечня
 * `app.platform_dict_specs` в базе.
 */
export const ADMIN_VALUE_DICTS = ['forms', 'organs', 'ugns', 'reasons'] as const;
export type AdminValueDict = (typeof ADMIN_VALUE_DICTS)[number];

export function isAdminValueDict(value: string): value is AdminValueDict {
  return (ADMIN_VALUE_DICTS as readonly string[]).includes(value);
}

import type { ListSort } from '../common/list';

/** Как получается код нового значения: префикс и номер (ФС-25, ПРЧ-006) или постоянный ключ УГНС. */
type CodeRule = { prefix: string; digits: number } | { key: string };

export interface AdminDictMeta {
  code: CodeRule;
  /**
   * Столбец «№» и кнопки «Выше» и «Ниже», список по умолчанию — в порядке справочника: только у
   * коротких справочников; длинные идут по своему ключу (решение заказчика 27.10.2026).
   */
  // ОТКЛОНЕНИЕ: docs/deviations.md#Д-2
  ordered: boolean;
  /** Поля значения, которые правит администратор (столбцы перечня `app.platform_dict_specs`). */
  fields: readonly string[];
}

export const ADMIN_DICT_META: Readonly<Record<AdminValueDict, AdminDictMeta>> = {
  forms: {
    code: { prefix: 'ФС', digits: 2 },
    ordered: true,
    fields: ['name', 'fullName', 'shortName', 'declarationFor', 'note'],
  },
  // Контакты органа — по ТЗ (телефоны с подписью, график, сайт, «Сверить»; решение заказчика 27.10.2026).
  // ОТКЛОНЕНИЕ: docs/deviations.md#Д-3
  organs: {
    code: { prefix: 'ОРГ', digits: 2 },
    ordered: true,
    fields: ['name', 'description', 'contacts', 'hours', 'site', 'contactsNote'],
  },
  ugns: {
    code: { key: 'ugns' },
    ordered: false,
    fields: ['name', 'shortName', 'gnsCode', 'region'],
  },
  reasons: { code: { prefix: 'ПРЧ', digits: 3 }, ordered: true, fields: ['name', 'note'] },
};

/**
 * Код нового значения (прототип `nextCode`: префикс и номер с нулями): следующий после самого большого
 * номера справочника, а не «число значений + 1» — после удаления номер не повторится. У УГНС —
 * постоянный ключ `ugns-<случайное>` (прототип ugnsDlg): код ГНС у нового управления может быть пуст.
 */
export function nextDictCode(
  dict: AdminValueDict,
  codes: readonly string[],
  random: () => string,
): string {
  const rule = ADMIN_DICT_META[dict].code;
  if ('key' in rule) return `${rule.key}-${random()}`;
  const head = `${rule.prefix}-`;
  const max = codes.reduce((m, code) => {
    if (!code.startsWith(head)) return m;
    const n = Number(code.slice(head.length));
    return Number.isInteger(n) && n > m ? n : m;
  }, 0);
  return `${head}${String(max + 1).padStart(rule.digits, '0')}`;
}

/** Код ГНС управления: ровно три цифры, как в кабинете налогоплательщика; пусто — не сверен. */
export const UGNS_CODE_PATTERN = /^\d{3}$/;

/** Самое длинное название и пояснение значения справочника. */
export const DICT_NAME_MAX = 200;
export const DICT_NOTE_MAX = 2000;
/** Не больше телефонов у органа. */
export const ORGAN_CONTACTS_MAX = 20;

/** Значение, с которым сверяется новое: код, название и код ГНС (у УГНС). */
export interface DictValueKey {
  code: string;
  name: string;
  gnsCode?: string | null;
}

export type DictValueProblem = { field: 'name' | 'gnsCode'; code: 'taken' };

/**
 * Повтор среди других значений справочника (прототип valueDlg «Такое значение уже есть», ugnsDlg
 * «Такой код уже есть»): то же название — у любого значения, в том числе отключённого; тот же код ГНС —
 * у другого управления. Пустое название и формат кода проверяет схема формы.
 */
export function dictValueProblems(
  value: DictValueKey,
  others: readonly DictValueKey[],
): DictValueProblem[] {
  const rest = others.filter((x) => x.code !== value.code);
  const problems: DictValueProblem[] = [];
  const name = value.name.trim();
  if (rest.some((x) => x.name.trim() === name)) problems.push({ field: 'name', code: 'taken' });
  const gns = value.gnsCode?.trim();
  if (gns && rest.some((x) => x.gnsCode === gns))
    problems.push({ field: 'gnsCode', code: 'taken' });
  return problems;
}

/**
 * Таблица ссылок на управление у контрагентов: по ней столбец УГНС «Контрагентов» и причина «Указан у
 * N контрагентов» (прототип renderPDicts0); остальные ссылки — просто «Используется».
 */
export const UGNS_CONTRACTOR_TABLE = 'contractors';

/** Сколько раз значение используется: всего и у контрагентов (только для УГНС). */
export interface DictUsage {
  total: number;
  contractors: number;
}

/** Ответ администратора на запрос организации: «Добавлено» или «Отклонено» (прототип v59 reqAnswerDlg). */
export const DICT_REQUEST_ANSWERS = ['added', 'rejected'] as const;
export type DictRequestAnswer = (typeof DICT_REQUEST_ANSWERS)[number];

/** Самый длинный ответ организации. */
export const DICT_REQUEST_ANSWER_MAX = 2000;

/**
 * Ответ обязателен при отказе — «Напишите, почему запрос отклонён» (прототип v59 reqAnswerDlg); при
 * «Добавлено» — по желанию. Организация видит ответ в «Мои запросы» (docs/deviations.md, п. 46).
 */
export function dictRequestAnswerProblem(
  status: DictRequestAnswer,
  answer: string,
): 'answer_required' | null {
  return status === 'rejected' && !answer.trim() ? 'answer_required' : null;
}

/**
 * Предел «Попросить добавить»: не больше запросов за час от одного пользователя — чтобы запросами не
 * завалили «Запросы» администратора (docs/decisions.md, п. Д-2).
 */
export const DICT_REQUEST_HOURLY_LIMIT = 20;

/** Сколько последних записей истории справочника показывает блок «История изменений» (прототип pdHistHtml). */
export const DICT_HISTORY_SHOWN = 12;

/** Столбец списка справочника в Админке: ключ, тип, подпись (ключ словаря) и скрыт ли по умолчанию. */
export interface AdminDictColumn {
  key: string;
  type: 'text' | 'enum' | 'int';
  label: string;
  hidden?: boolean;
}

const c = (key: string, type: AdminDictColumn['type'], label: string, hidden = false) =>
  hidden ? { key, type, label, hidden } : { key, type, label };

const N = c('n', 'int', 'pdicts.col.n');
const CODE = c('code', 'text', 'pdicts.col.code');
const VALUE = c('name', 'text', 'pdicts.col.value');
const USED = c('used', 'int', 'pdicts.col.used');
const STATUS = c('active', 'enum', 'pdicts.col.status');

/**
 * Столбцы справочников, как в прототипе (renderPDicts0): «№», «Код», «Значение», поля справочника,
 * «Используется», «Статус». Пояснения — отдельным столбцом (ТЗ «в таблицах они — отдельным
 * столбцом»), контакты органа — скрытыми столбцами (ТЗ: «остальные скрыты»). У УГНС — «Код» ГНС,
 * «Полное название», «Кратко», «Регион», «Контрагентов». Служебные столбцы добавляет список.
 */
export const ADMIN_DICT_COLUMNS: Readonly<Record<AdminValueDict, readonly AdminDictColumn[]>> = {
  forms: [
    N,
    CODE,
    VALUE,
    c('shortName', 'text', 'pdicts.col.short'),
    c('declarationFor', 'enum', 'pdicts.col.end'),
    c('fullName', 'text', 'pdicts.col.full', true),
    c('note', 'text', 'pdicts.col.forms_note'),
    USED,
    STATUS,
  ],
  organs: [
    N,
    CODE,
    VALUE,
    c('description', 'text', 'pdicts.col.organs_note'),
    c('contacts', 'text', 'pdicts.col.contacts', true),
    c('hours', 'text', 'pdicts.col.hours', true),
    c('site', 'text', 'pdicts.col.site', true),
    c('contactsNote', 'text', 'pdicts.col.contacts_note', true),
    USED,
    STATUS,
  ],
  ugns: [
    c('gnsCode', 'text', 'pdicts.col.code'),
    c('name', 'text', 'pdicts.col.ugns_name'),
    c('shortName', 'text', 'pdicts.col.short'),
    c('region', 'enum', 'pdicts.col.region'),
    c('contractors', 'int', 'pdicts.col.contractors'),
    c('used', 'int', 'pdicts.col.used', true),
    STATUS,
  ],
  reasons: [N, CODE, VALUE, c('note', 'text', 'pdicts.col.note', true), USED, STATUS],
};

/**
 * Сортировка списка по умолчанию (как в прототипе, docs/deviations.md п. 48): короткий справочник — в
 * своём порядке («№»), УГНС — по региону.
 */
export function adminDictDefaultSort(dict: AdminValueDict): ListSort {
  return ADMIN_DICT_META[dict].ordered ? { key: 'n', dir: 'asc' } : { key: 'region', dir: 'asc' };
}
