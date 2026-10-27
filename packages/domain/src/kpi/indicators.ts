import { formatSom } from '../common/money';
import type { YearMonth } from '../common/months';

/*
 * Показатели контрагентов (ТЗ «Показатели контрагентов» → «Настройка показателей» и «Значение
 * показателя»; прототип modules/kpi.js: KTYPES, KAGG, KUNITS, indDlg, kParse, kNum, kFmt, kAgg).
 *
 * Значение хранится целым числом сотых (`IndicatorValue`): у «Суммы в сом» это тыйыны, у процента и
 * «Числа с копейками» — сотые, у «Целого числа» — кратно 100. Пустое значение (`null`) и 0 — разные
 * вещи: пусто — «не заполнено», 0 — «внесено, равно нулю».
 */

/** Тип значения: целое число, число с копейками, сумма в сом, процент. */
export const INDICATOR_TYPES = ['int', 'dec', 'som', 'pct'] as const;
export type IndicatorType = (typeof INDICATOR_TYPES)[number];

/** Основной итог — какой итог показывать первым. */
export const INDICATOR_TOTALS = ['sum', 'avg', 'max', 'min', 'last'] as const;
export type IndicatorTotal = (typeof INDICATOR_TOTALS)[number];

/** Единицы на выбор; иначе — своя подпись. */
export const INDICATOR_UNITS = ['сом', 'чел.', 'шт.', '%'] as const;

/** Кому вести: всем контрагентам или выбранным. */
export const INDICATOR_SCOPES = ['all', 'selected'] as const;
export type IndicatorScope = (typeof INDICATOR_SCOPES)[number];

/** Срок заполнения — число следующего месяца: от 1 до 28, по умолчанию 10-е. */
export const DUE_DAY_MIN = 1;
export const DUE_DAY_MAX = 28;
export const DUE_DAY_DEFAULT = 10;

export const INDICATOR_NAME_MAX_LENGTH = 100;
export const INDICATOR_UNIT_MAX_LENGTH = 20;
export const INDICATOR_DESCRIPTION_MAX_LENGTH = 1000;
/** Комментарий к значению (например, «по выписке банка»). */
export const INDICATOR_NOTE_MAX_LENGTH = 500;

/** Значение показателя — целое число сотых. */
export type IndicatorValue = number;

/** Поля показателя в окне «Новый показатель» / «Показатель «…»». */
export interface IndicatorInput {
  name: string;
  unit: string;
  type: IndicatorType;
  total: IndicatorTotal;
  description: string;
  required: boolean;
  dueDay: number;
  /** «Вести с» — месяц, с которого показатель обязателен. */
  start: YearMonth;
  scope: IndicatorScope;
  /** «Включать новых контрагентов автоматически»; при «Всем контрагентам» всегда включено. */
  autoNew: boolean;
}

/**
 * Два показателя-примера новой организации (ТЗ: «Выручка» — сом, итог сумма; «Количество
 * сотрудников» — чел., итог среднее); описания и обязательность — как у демо-показателей прототипа.
 */
export const DEFAULT_INDICATORS: readonly Omit<IndicatorInput, 'start'>[] = [
  {
    name: 'Выручка',
    unit: 'сом',
    type: 'som',
    total: 'sum',
    description:
      'Выручка за месяц без НДС по данным учёта (оборот из декларации или книги продаж).',
    required: true,
    dueDay: DUE_DAY_DEFAULT,
    scope: 'all',
    autoNew: true,
  },
  {
    name: 'Количество сотрудников',
    unit: 'чел.',
    type: 'int',
    total: 'avg',
    description:
      'Численность на последний день месяца по штатному расписанию или отчёту в Соцфонд.',
    required: true,
    dueDay: DUE_DAY_DEFAULT,
    scope: 'all',
    autoNew: true,
  },
];

export const INDICATOR_PROBLEMS = [
  'name_required',
  'name_too_long',
  'name_taken',
  'unit_required',
  'unit_too_long',
  'description_too_long',
  'due_day_invalid',
  'start_in_future',
  'type_locked',
  'unit_locked',
  'targets_required',
] as const;
export type IndicatorProblem = (typeof INDICATOR_PROBLEMS)[number];
export type IndicatorField =
  'name' | 'unit' | 'type' | 'description' | 'dueDay' | 'start' | 'scope';

/** Тексты ошибок — как в окне показателя прототипа (indDlg). */
export const INDICATOR_MESSAGES: Record<IndicatorProblem, string> = {
  name_required: 'Введите название',
  name_too_long: `Название — не длиннее ${INDICATOR_NAME_MAX_LENGTH} символов`,
  name_taken: 'Такой показатель уже есть',
  unit_required: 'Введите подпись единицы',
  unit_too_long: `Единица — не длиннее ${INDICATOR_UNIT_MAX_LENGTH} символов`,
  description_too_long: `Описание — не длиннее ${INDICATOR_DESCRIPTION_MAX_LENGTH} символов`,
  due_day_invalid: `От ${DUE_DAY_MIN} до ${DUE_DAY_MAX}`,
  start_in_future: 'Не позже текущего месяца',
  type_locked: 'Нельзя менять: по показателю уже есть значения',
  unit_locked: 'Нельзя менять: по показателю уже есть значения',
  targets_required: 'Выберите хотя бы одного контрагента',
};

export interface IndicatorCheck {
  /** Названия остальных показателей организации (в архиве тоже). */
  otherNames: readonly string[];
  /** Текущий месяц по Бишкеку: «Вести с» не позже него. */
  currentMonth: YearMonth;
  /** Показатель до правки и есть ли по нему значения: тип и единицу тогда менять нельзя. */
  before?: { type: IndicatorType; unit: string; hasValues: boolean };
  /** «Выбранным»: сколько контрагентов отмечено. */
  selected?: number;
}

/** Все ошибки показателя по полям (одни и те же в окне и на сервере). */
export function indicatorProblems(
  input: IndicatorInput,
  check: IndicatorCheck,
): { field: IndicatorField; problem: IndicatorProblem }[] {
  const out: { field: IndicatorField; problem: IndicatorProblem }[] = [];
  const add = (field: IndicatorField, problem: IndicatorProblem) => out.push({ field, problem });
  const name = input.name.trim();
  if (!name) add('name', 'name_required');
  else if (name.length > INDICATOR_NAME_MAX_LENGTH) add('name', 'name_too_long');
  else if (check.otherNames.some((n) => n.trim().toLowerCase() === name.toLowerCase())) {
    add('name', 'name_taken');
  }
  const unit = input.unit.trim();
  if (!unit) add('unit', 'unit_required');
  else if (unit.length > INDICATOR_UNIT_MAX_LENGTH) add('unit', 'unit_too_long');
  else if (check.before?.hasValues && unit !== check.before.unit) add('unit', 'unit_locked');
  if (check.before?.hasValues && input.type !== check.before.type) add('type', 'type_locked');
  if (input.description.length > INDICATOR_DESCRIPTION_MAX_LENGTH) {
    add('description', 'description_too_long');
  }
  if (!Number.isInteger(input.dueDay) || input.dueDay < DUE_DAY_MIN || input.dueDay > DUE_DAY_MAX) {
    add('dueDay', 'due_day_invalid');
  }
  if (input.start > check.currentMonth) add('start', 'start_in_future');
  if (input.scope === 'selected' && (check.selected ?? 0) === 0) add('scope', 'targets_required');
  return out;
}

/** Разбор введённого значения (прототип `kParse`). */
export type ParsedIndicatorValue = { ok: true; value: IndicatorValue | null } | { ok: false };

/**
 * «1 250 000», «1250000,50», «12,5 %», «−300» → сотые; пусто — `null` («не заполнено»). Целое число
 * округляется до целого, остальные — до сотых, как в прототипе. Только цифры: «1e3» и «0x10», которые
 * прототип принимает, — ошибка; минус «−» (так его показывает `formatSom`) принимается.
 */
export function parseIndicatorValue(type: IndicatorType, text: string): ParsedIndicatorValue {
  if (text.trim() === '') return { ok: true, value: null };
  const t = text.trim().replace('%', '').replace(/\s/g, '').replace('−', '-').replace(',', '.');
  if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(t)) return { ok: false };
  const n = Number(t);
  const value = type === 'int' ? Math.round(n) * 100 : Math.round(n * 100);
  if (!Number.isSafeInteger(value)) return { ok: false };
  return { ok: true, value: value === 0 ? 0 : value };
}

/**
 * Число значения на экране (прототип `kNum`): целое — без копеек, «Число с копейками» — всегда два
 * знака, сумма и процент — копейки только если есть. Принимает и дробные сотые (среднее из
 * `indicatorTotals`): округляет половину от нуля, как `toFixed` прототипа.
 */
export function indicatorNumberText(type: IndicatorType, value: number): string {
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  if (type === 'int') return formatSom(sign * Math.round(abs / 100) * 100, 'auto');
  return formatSom(sign * Math.round(abs), type === 'dec' ? 'always' : 'auto');
}

/** Значение с единицей: «1 250 000 сом», «37 чел.»; пусто — пустая строка (прототип `kFmt`). */
export function indicatorValueText(
  indicator: { type: IndicatorType; unit: string },
  value: number | null,
): string {
  if (value === null) return '';
  const number = indicatorNumberText(indicator.type, value);
  return indicator.unit ? `${number} ${indicator.unit}` : number;
}

/** Итоги по заполненным месяцам (прототип `kAgg`); `count` — сколько месяцев заполнено. */
export type IndicatorTotals =
  | { count: 0 }
  | {
      count: number;
      sum: IndicatorValue;
      /** Среднее в сотых без округления: округляет показ (`indicatorNumberText`), как в прототипе. */
      avg: number;
      max: IndicatorValue;
      min: IndicatorValue;
      /** Последнее заполненное по порядку месяцев. */
      last: IndicatorValue;
    };

/** Итоги считаются только по заполненным месяцам: пустой месяц — не ноль. */
export function indicatorTotals(values: readonly (IndicatorValue | null)[]): IndicatorTotals {
  const filled = values.filter((v): v is IndicatorValue => v !== null);
  if (filled.length === 0) return { count: 0 };
  const sum = filled.reduce((a, b) => a + b, 0);
  return {
    count: filled.length,
    sum,
    avg: sum / filled.length,
    max: Math.max(...filled),
    min: Math.min(...filled),
    last: filled[filled.length - 1]!,
  };
}

/** Отказы методов модуля (код — ключ словаря `err.<код>`). */
export const KPI_MESSAGES = {
  indicators_off: 'Показатели контрагентов выключены в учётной политике',
  indicator_has_values: 'По показателю уже есть значения — отправьте его в архив',
  indicator_archived: 'Показатель в архиве: новых значений по нему нет',
  indicator_order: 'Порядок устарел — обновите страницу',
  value_invalid: 'Введите число',
  cell_off: 'Показатель у этого контрагента не ведётся или не нужен в этом месяце',
  month_in_future: 'Месяц ещё не наступил',
  target_off: 'Показатель у этого контрагента не ведётся',
  from_in_future: 'Не позже текущего месяца',
  check_not_filled: 'Проверить можно только заполненный месяц',
  period_too_long: 'Период — не длиннее 72 месяцев',
} as const;
export type KpiRefusal = keyof typeof KPI_MESSAGES;
