/*
 * Админка → «Справочники платформы» (задача 2.36; ТЗ «Админка» → «Модуль Справочники платформы» →
 * «Общие правила для всех справочников»; прототип admin/platform-dicts*.js): администратор платформы
 * добавляет значение, переименовывает его, меняет порядок кнопками «Выше» и «Ниже», отключает и
 * удаляет неиспользуемое; отвечает на запросы организаций «Попросить добавить». Правила — здесь,
 * запись — функции администратора в базе (`adminDictInsert` и соседние из @buhuchet/db).
 */

/**
 * Справочники, которые правятся общим механизмом (части 1 и 2 задачи 2.36), в порядке вкладок модуля.
 * Новый справочник добавляет сюда строку, перечень полей ниже и строку перечня
 * `app.platform_dict_specs` в базе.
 */
export const ADMIN_VALUE_DICTS = [
  'bases',
  'regimes',
  'forms',
  'phones',
  'organs',
  'ugns',
  'banks',
  'cats',
  'reasons',
] as const;
export type AdminValueDict = (typeof ADMIN_VALUE_DICTS)[number];

export function isAdminValueDict(value: string): value is AdminValueDict {
  return (ADMIN_VALUE_DICTS as readonly string[]).includes(value);
}

import type { ListSort } from '../common/list';
import { applyPhoneMask } from '../staff/rules';
import { BANK_KINDS, REGIME_KINDS, type BankKind, type ReportKind } from './catalog';

/**
 * Как получается код нового значения: префикс и номер (ФС-25, ПРЧ-006), префикс по типу провайдера
 * (банк — БНК-33, электронный кошелёк — КШЛ-06; ТЗ «код (БНК, КШЛ)») или постоянный ключ УГНС.
 */
type CodeRule =
  | { prefix: string; digits: number }
  | { byKind: Readonly<Record<BankKind, string>>; digits: number }
  | { key: string };

/** Страна телефона по умолчанию: Кыргызстан, отключить нельзя (ТЗ «Коды стран телефонов»). */
export const DEFAULT_PHONE_COUNTRY = 'KG';
/** Телефонный код страны без «+»: от 1 до 4 цифр (прототип phoneCodeDlg «1–4 цифры»). */
export const PHONE_DIAL_CODE_PATTERN = /^\d{1,4}$/;
/** Маска номера: «X» — цифра, и пробелы; хотя бы одна цифра (прототип «Только X и пробелы»). */
export const PHONE_MASK_PATTERN = /^(?=.*X)[X ]+$/;

/** «Пример» номера в списке кодов стран (прототип): «+996 555 123 456». */
export function phoneCodeExample(dialCode: string, mask: string): string {
  return `+${dialCode} ${applyPhoneMask(mask, '5551234567890')}`;
}

export interface AdminDictMeta {
  code: CodeRule;
  /**
   * Столбец «№» и кнопки «Выше» и «Ниже», список по умолчанию — в порядке справочника: только у
   * коротких справочников; длинные идут по своему ключу (решение заказчика 27.10.2026).
   */
  // ОТКЛОНЕНИЕ: docs/deviations.md#Д-2
  ordered: boolean;
  /**
   * Поля значения, которые правит администратор: столбцы перечня `app.platform_dict_specs` и поля-связи
   * (`links`).
   */
  fields: readonly string[];
  /**
   * Обязательные поля сверх названия: у УГНС — краткое название, у режима — полное, у кода страны —
   * телефонный код и маска.
   */
  required?: readonly ('shortName' | 'fullName' | 'dialCode' | 'mask')[];
  /**
   * Поля-связи: коды значений другого справочника в отдельной таблице связей, а не в столбце значения
   * (виды отчётов основания — «по полю «Основание» вида», ТЗ). Пишет `app.admin_dict_set_links`.
   */
  links?: readonly string[];
  /**
   * Таблица ссылок контрагентов на значение: по ней столбец «Контрагентов» и причина «Указан у N
   * контрагентов»; остальные ссылки — просто «Используется».
   */
  contractorTable?: string;
  /** Удалять нельзя — только отключить (коды стран: ТЗ «Изменить» и «Отключить» / «Включить»). */
  undeletable?: boolean;
  /** Значение, которое нельзя отключить (Кыргызстан — код по умолчанию). */
  fixed?: string;
  /**
   * «Тип» значения (поле `kind`): допустимые значения, тип нового значения и ключ словаря подписи
   * (`<text>.<тип>`).
   */
  kind?: {
    values: readonly string[];
    default: string;
    text: 'pdicts.bank.kind' | 'dicts.value.regime_kind';
  };
}

export const ADMIN_DICT_META: Readonly<Record<AdminValueDict, AdminDictMeta>> = {
  // Новое основание — с постоянным ключом, как у наполнения (employees, property…). Без «№» и
  // «Выше»/«Ниже» (docs/deviations.md п. Д-2): список — в порядке справочника.
  bases: {
    code: { key: 'base' },
    ordered: false,
    fields: ['name', 'description', 'types', 'note'],
    links: ['types'],
    contractorTable: 'contractor_bases',
  },
  // Новый режим — специальный (прототип regimeDlg): общий режим один.
  regimes: {
    code: { prefix: 'РЕЖ', digits: 2 },
    ordered: true,
    fields: [
      'name',
      'fullName',
      'kind',
      'frees',
      'who',
      'how',
      'combines',
      'accountantNote',
      'article',
    ],
    required: ['fullName'],
    kind: { values: REGIME_KINDS, default: 'special', text: 'dicts.value.regime_kind' },
  },
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
  // Код значения — страна (KG, KZ…); у страны, добавленной администратором, — X-01 (прототип phoneCodeDlg).
  phones: {
    code: { prefix: 'X', digits: 2 },
    ordered: false,
    fields: ['name', 'flag', 'dialCode', 'mask'],
    required: ['dialCode', 'mask'],
    undeletable: true,
    fixed: DEFAULT_PHONE_COUNTRY,
  },
  ugns: {
    code: { key: 'ugns' },
    ordered: false,
    fields: ['name', 'shortName', 'gnsCode', 'region'],
    required: ['shortName'],
    contractorTable: 'contractors',
  },
  banks: {
    code: { byKind: { bank: 'БНК', wallet: 'КШЛ' }, digits: 2 },
    ordered: true,
    fields: ['name', 'kind', 'byPhone', 'note'],
    kind: { values: BANK_KINDS, default: 'bank', text: 'pdicts.bank.kind' },
  },
  // «Категории задач» (задача 2.23): код КАТ-001 и т. д., как у значений из наполнения.
  cats: { code: { prefix: 'КАТ', digits: 3 }, ordered: true, fields: ['name', 'note'] },
  reasons: { code: { prefix: 'ПРЧ', digits: 3 }, ordered: true, fields: ['name', 'note'] },
};

/**
 * Код нового значения (прототип `nextCode`: префикс и номер с нулями): следующий после самого большого
 * номера справочника, а не «число значений + 1» — после удаления номер не повторится. У УГНС —
 * постоянный ключ `ugns-<случайное>` (прототип ugnsDlg): код ГНС у нового управления может быть пуст;
 * у основания — `base-<случайное>` (прототип baseDlg).
 * У банковских провайдеров префикс — по типу (`kind`), как у значений из наполнения.
 */
export function nextDictCode(
  dict: AdminValueDict,
  codes: readonly string[],
  random: () => string,
  kind: BankKind = 'bank',
): string {
  const rule = ADMIN_DICT_META[dict].code;
  if ('key' in rule) return `${rule.key}-${random()}`;
  const head = `${'byKind' in rule ? rule.byKind[kind] : rule.prefix}-`;
  const max = codes.reduce((m, code) => {
    if (!code.startsWith(head)) return m;
    const n = Number(code.slice(head.length));
    return Number.isInteger(n) && n > m ? n : m;
  }, 0);
  return `${head}${String(max + 1).padStart(rule.digits, '0')}`;
}

/** Вид отчёта для выбора в окне основания: код, тип и действует ли. */
export interface BaseTypeOption {
  code: string;
  kind: ReportKind;
  active: boolean;
}

/**
 * Виды отчётов, которых не может быть у основания (прототип baseDlg): основание включает только
 * сквозные действующие виды; уже привязанный остаётся, даже если его отключили или сменили тип.
 */
export function badBaseTypes(
  codes: readonly string[],
  catalog: readonly BaseTypeOption[],
  before: readonly string[],
): string[] {
  const byCode = new Map(catalog.map((t) => [t.code, t]));
  return codes.filter((code) => {
    const t = byCode.get(code);
    if (!t) return true;
    return !before.includes(code) && (t.kind !== 'cross' || !t.active);
  });
}

/** Код ГНС управления: ровно три цифры, как в кабинете налогоплательщика; пусто — не сверен. */
export const UGNS_CODE_PATTERN = /^\d{3}$/;

/** Самое длинное название и пояснение значения справочника. */
export const DICT_NAME_MAX = 200;
export const DICT_NOTE_MAX = 2000;
/** Не больше телефонов у органа. */
export const ORGAN_CONTACTS_MAX = 20;

/**
 * Сайт органа — адрес с `https://`: у организации он открывается ссылкой в новой вкладке (ТЗ), а
 * ссылкой окно органа делает только адрес с протоколом. «sti.gov.kg» → «https://sti.gov.kg».
 */
export function organSiteUrl(site: string): string {
  // ОТКЛОНЕНИЕ: docs/deviations.md#Д-4
  const s = site.trim();
  return s && !/^https?:\/\//i.test(s) ? `https://${s}` : s;
}

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

/** Сколько раз значение используется: всего и у контрагентов (у УГНС и основания). */
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
  type: 'text' | 'enum' | 'int' | 'date';
  label: string;
  hidden?: boolean;
}

const c = (key: string, type: AdminDictColumn['type'], label: string, hidden = false) =>
  hidden ? { key, type, label, hidden } : { key, type, label };

const N = c('n', 'int', 'pdicts.col.n');
const CONTRACTORS = c('contractors', 'int', 'pdicts.col.contractors');
const CODE = c('code', 'text', 'pdicts.col.code');
const VALUE = c('name', 'text', 'pdicts.col.value');
const USED = c('used', 'int', 'pdicts.col.used');
const STATUS = c('active', 'enum', 'pdicts.col.status');

/**
 * Столбцы справочников, как в прототипе (renderPDicts0): «№», «Код», «Значение», поля справочника,
 * «Используется», «Статус». Пояснения — отдельным столбцом (ТЗ «в таблицах они — отдельным
 * столбцом»), контакты органа — скрытыми столбцами (ТЗ: «остальные скрыты»). У УГНС — «Код» ГНС,
 * «Полное название», «Кратко», «Регион», «Контрагентов»; у банковских провайдеров — «Тип» и
 * «Переводы по номеру телефона». Служебные столбцы добавляет список.
 */
export const ADMIN_DICT_COLUMNS: Readonly<Record<AdminValueDict, readonly AdminDictColumn[]>> = {
  bases: [
    c('code', 'text', 'pdicts.col.code', true),
    c('name', 'text', 'pdicts.col.name'),
    c('description', 'text', 'pdicts.col.description'),
    c('types', 'text', 'pdicts.col.types'),
    c('note', 'text', 'pdicts.col.remark', true),
    CONTRACTORS,
    c('used', 'int', 'pdicts.col.used', true),
    STATUS,
  ],
  regimes: [
    N,
    c('code', 'text', 'pdicts.col.code', true),
    c('name', 'text', 'pdicts.col.regime_short'),
    c('fullName', 'text', 'pdicts.col.regime_full'),
    c('kind', 'enum', 'pdicts.col.kind'),
    c('frees', 'text', 'pdicts.col.frees', true),
    c('who', 'text', 'pdicts.col.who', true),
    c('how', 'text', 'pdicts.col.how', true),
    c('combines', 'text', 'pdicts.col.combines', true),
    c('accountantNote', 'text', 'pdicts.col.acc'),
    c('article', 'text', 'pdicts.col.article'),
    USED,
    STATUS,
  ],
  phones: [
    c('code', 'text', 'pdicts.col.code', true),
    c('name', 'text', 'pdicts.col.country'),
    c('dialCode', 'text', 'pdicts.col.dial_code'),
    c('mask', 'text', 'pdicts.col.mask'),
    c('digits', 'int', 'pdicts.col.digits'),
    c('example', 'text', 'pdicts.col.example'),
    STATUS,
  ],
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
    CONTRACTORS,
    c('used', 'int', 'pdicts.col.used', true),
    STATUS,
  ],
  banks: [
    N,
    CODE,
    VALUE,
    c('kind', 'enum', 'pdicts.col.kind'),
    c('byPhone', 'enum', 'pdicts.col.by_phone'),
    c('note', 'text', 'pdicts.col.note', true),
    USED,
    STATUS,
  ],
  cats: [N, CODE, VALUE, c('note', 'text', 'pdicts.col.note', true), USED, STATUS],
  reasons: [N, CODE, VALUE, c('note', 'text', 'pdicts.col.note', true), USED, STATUS],
};

/**
 * Столбцы вкладки «Календарь» (прототип renderPDicts, `adm-cal`): дни текущего и следующего года, по
 * умолчанию — по дате.
 */
export const ADMIN_CALENDAR_COLUMNS: readonly AdminDictColumn[] = [
  c('date', 'date', 'pdicts.cal.col.date'),
  c('dow', 'enum', 'pdicts.cal.col.dow'),
  c('name', 'text', 'pdicts.cal.col.name'),
  c('kind', 'enum', 'pdicts.cal.col.kind'),
  c('rule', 'enum', 'pdicts.cal.col.rule'),
];
export const ADMIN_CALENDAR_SORT: ListSort = { key: 'date', dir: 'asc' };

/**
 * Сортировка списка по умолчанию (как в прототипе, docs/deviations.md п. 48): короткий справочник — в
 * своём порядке («№»), УГНС — по региону, основания и коды стран — в порядке справочника без «№» (null).
 */
export function adminDictDefaultSort(dict: AdminValueDict): ListSort | null {
  if (ADMIN_DICT_META[dict].ordered) return { key: 'n', dir: 'asc' };
  return dict === 'ugns' ? { key: 'region', dir: 'asc' } : null;
}
