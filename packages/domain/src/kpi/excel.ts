import { EXPORT_ROWS_LIMIT, searchText } from '../common/list';
import type { YearMonth } from '../common/months';
import { activeIndicators, type KpiBook, type KpiContractor, type KpiIndicator } from './fill';
import { parseIndicatorValue, type IndicatorType, type IndicatorValue } from './indicators';
import { cellState, type KpiValueOf } from './views';

/*
 * «Ввод из Excel» (задача 2.28; ТЗ «Показатели контрагентов» → «Ввод из Excel»; прототип v80
 * modules/kpi-excel.js: kxTpl, kxBlob, kxMon, kxParse). Шаблон — в виде вкладки «Ввод по месяцам»:
 * строка — контрагент и показатель (ИНН, «Контрагент», «Показатель»), дальше столбцы месяцев «янв 2026».
 * Загрузка: контрагент — по ИНН, показатель — по названию в строке, месяц — по заголовку столбца; прежний
 * шаблон («Показатель · ММ.ГГГГ» в столбцах) тоже принимается. Пустая ячейка ничего не стирает; строка с
 * ошибкой не записывается целиком.
 * ОТКЛОНЕНИЕ: docs/deviations.md#О-61
 */

/** Не больше контрагентов и месяцев в одном шаблоне (прототип `KX_MAX_CP`, `KX_MAX_M`). */
export const KPI_IMPORT_MAX_CONTRACTORS = 1000;
export const KPI_IMPORT_MAX_MONTHS = 24;

/**
 * Ячеек показателей в одном шаблоне (строки «контрагент × показатель» × месяцы) — не больше: шаблон больше
 * не загрузится обратно (пределы загруженного листа — `packages/api/src/lists/xlsx-read.ts`). 1 000
 * контрагентов за 24 месяца — это до 20 показателей (прототип `KX_MAX_CELLS`, docs/deviations.md п. В-8).
 */
export const KPI_IMPORT_MAX_CELLS = 480_000;

/**
 * Строк «контрагент × показатель» в одном шаблоне — не больше: в каждой строке повторяются ИНН, название
 * контрагента и показателя, и лист длиннее не загрузится обратно (в прототипе предела нет). 1 000
 * контрагентов — это до 20 показателей.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#О-61
export const KPI_IMPORT_MAX_LINES = 20_000;

/** Почему шаблон не собирается: больше месяцев, контрагентов, строк или ячеек показателей. */
export type ImportTooMany = 'months' | 'contractors' | 'lines' | 'cells';

/**
 * Шаблон больше пределов: `months` — месяцев, `contractors` — разных контрагентов, `lines` — строк
 * «контрагент × показатель», `cells` — ячеек показателей (строки × месяцы).
 */
export function importTooMany(
  months: number,
  contractors: number,
  lines: number,
): ImportTooMany | null {
  const cells = lines * months;
  if (months > KPI_IMPORT_MAX_MONTHS) return 'months';
  if (contractors > KPI_IMPORT_MAX_CONTRACTORS) return 'contractors';
  if (lines > KPI_IMPORT_MAX_LINES) return 'lines';
  // ОТКЛОНЕНИЕ: docs/deviations.md#В-8
  if (cells > KPI_IMPORT_MAX_CELLS) return 'cells';
  return null;
}

/**
 * Файл загрузки — не больше 4 МБ: он идёт телом запроса, а площадка (Vercel) принимает тело до 4,5 МБ.
 * Шаблон на 1 000 контрагентов и 24 месяца по нескольким показателям в него помещается.
 */
export const KPI_IMPORT_MAX_BYTES = 4 * 1024 * 1024;

/**
 * Разборов загруженного файла (предпросмотр и «Применить») от одного пользователя — не больше за час;
 * одновременно — один (docs/decisions.md, п. В-3).
 */
export const KPI_IMPORT_HOURLY_LIMIT = 60;

/** Имя файла в «Истории загрузок» — не длиннее (длиннее обрезается). */
export const KPI_IMPORT_FILE_MAX_LENGTH = 255;

/** Заголовок столбца прежнего шаблона: «Выручка · 09.2026» (прототип `kxHead`). */
export function importHead(name: string, month: YearMonth): string {
  return `${name} · ${month.slice(5, 7)}.${month.slice(0, 4)}`;
}

/** Месяцы в заголовках столбцов шаблона (прототип `MON_S`). */
export const IMPORT_MONTHS_SHORT = [
  'янв',
  'фев',
  'мар',
  'апр',
  'май',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
] as const;

/** Заголовок столбца месяца шаблона и вкладки «Ввод по месяцам»: «янв 2026» (прототип `kxMonHead`). */
export function importMonthHead(month: YearMonth): string {
  return `${IMPORT_MONTHS_SHORT[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

/** Начала названий месяцев: «май» и «мая» — май (прототип `KX_MON`). */
const MONTH_PREFIXES: readonly (readonly string[])[] = IMPORT_MONTHS_SHORT.map((m) =>
  m === 'май' ? ['май', 'мая'] : [m],
);

/** Заголовок месяца — не длиннее: «сентябрь 2026 года» короче. */
const MONTH_HEAD_MAX_LENGTH = 40;

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Месяц из заголовка столбца (прототип `kxMon`): «янв 2026», «январь 2026», «янв. 26», «январь 2026 г.»,
 * «01.2026», «01.01.2026», «2026-01», «2026-01-31» или дата Excel (число дней); не месяц — null.
 */
export function parseImportMonth(head: ImportCellValue | undefined): YearMonth | null {
  if (typeof head === 'number') {
    if (!(head >= 20000 && head <= 80000)) return null;
    const d = new Date(Math.round((head - 25569) * 864e5));
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}` as YearMonth;
  }
  const t = String(head ?? '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е');
  if (t.length > MONTH_HEAD_MAX_LENGTH) return null;
  let x = /^([а-я]+)\.?[\s.-]*(\d{4}|\d{2})(?:\s*г(?:ода?)?\.?)?$/.exec(t);
  if (x) {
    const k = MONTH_PREFIXES.findIndex((ps) => ps.some((q) => x![1]!.startsWith(q)));
    if (k < 0) return null;
    return `${x[2]!.length === 2 ? `20${x[2]}` : x[2]}-${pad2(k + 1)}` as YearMonth;
  }
  x = /^(?:\d{1,2}\.)?(\d{1,2})\.(\d{4})$/.exec(t);
  if (x) {
    const m = Number(x[1]);
    return m >= 1 && m <= 12 ? (`${x[2]}-${pad2(m)}` as YearMonth) : null;
  }
  x = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(t);
  if (x) {
    const m = Number(x[2]);
    return m >= 1 && m <= 12 ? (`${x[1]}-${pad2(m)}` as YearMonth) : null;
  }
  return null;
}

/**
 * Заголовок столбца шаблона — не длиннее: название показателя (до 100), месяц и единица в скобках
 * короче. Длиннее — не заголовок шаблона (и разбор выражением не тратит время на длинный текст).
 */
const IMPORT_HEAD_MAX_LENGTH = 300;

/** Значение ячейки в ошибке загрузки — не длиннее (длиннее обрезается, в конце «…»). */
export const IMPORT_ERROR_VALUE_MAX_LENGTH = 200;

/** Ошибок в разборе файла хранится не больше — столько строк и в файле ошибок (выгрузка в Excel). */
export const IMPORT_ERRORS_KEPT = EXPORT_ROWS_LIMIT;

/**
 * Заголовок столбца загруженного файла: «Выручка · 09.2026 (сом, сумма в сом)» → название показателя и
 * месяц (единица в скобках не нужна); не такой заголовок — null.
 */
export function parseImportHead(text: string): { name: string; month: YearMonth } | null {
  if (text.length > IMPORT_HEAD_MAX_LENGTH) return null;
  const m = /^(.+?) · (\d{2})\.(\d{4})(?:\s*\(.*\))?$/.exec(text.trim());
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { name: m[1]!.trim(), month: `${m[3]}-${m[2]}` as YearMonth };
}

/** Имя столбца Excel: 0 → A, 25 → Z, 26 → AA (прототип `xlCol`). */
export function excelColumn(index: number): string {
  let n = index + 1;
  let name = '';
  while (n > 0) {
    const rest = (n - 1) % 26;
    name = String.fromCharCode(65 + rest) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/** Ячейка шаблона: `off` — показатель не ведётся (серая, защищена), `checked` — значение проверено. */
export type ImportTemplateCell =
  { kind: 'off' } | { kind: 'input' | 'checked'; value: IndicatorValue | null };

/** Строка шаблона и вкладки «Ввод по месяцам»: контрагент и показатель, ячейки — по месяцам. */
export interface ImportTemplateRow {
  contractor: KpiContractor;
  indicatorId: string;
  cells: ImportTemplateCell[];
}

export interface ImportTemplate {
  /** Строки «контрагент × показатель», где показатель ведётся хотя бы в одном месяце периода. */
  rows: ImportTemplateRow[];
  /** Разных контрагентов в строках. */
  contractors: number;
}

export interface ImportTemplateOptions {
  /** Идущий месяц: ячейки будущих месяцев — серые (прототип `kxCell`). */
  current: YearMonth;
  /**
   * Строки и с внесёнными значениями, хотя показатель за период уже не ведётся (выгрузка «Ввода по
   * месяцам», прототип `kGridRows`); шаблон — без них (`kxTpl`).
   */
  withValues?: boolean;
}

/**
 * Состав шаблона (прототип `kxTpl`, `kxCell`) и выгрузки «Ввода по месяцам» (`kGridRows`): `contractors` —
 * уже отобранные фильтром и областью сотрудника, по порядку строк; у каждого — действующие показатели
 * из `indicatorIds` по их порядку; внесённые значения подставлены, проверенные (`checked` — статус месяца
 * «Проверено») помечены.
 */
export function importTemplate(
  book: KpiBook,
  contractors: readonly KpiContractor[],
  indicatorIds: ReadonlySet<string>,
  months: readonly YearMonth[],
  valueOf: KpiValueOf,
  checked: (contractorId: string, month: YearMonth) => boolean,
  options: ImportTemplateOptions,
): ImportTemplate {
  const indicators = activeIndicators(book).filter((i) => indicatorIds.has(i.id));
  const can = (i: KpiIndicator, c: KpiContractor, m: YearMonth) =>
    cellState(book, i, c, m) !== 'off';
  const keep = (i: KpiIndicator, c: KpiContractor) =>
    months.some(
      (m) => can(i, c, m) || (options.withValues === true && valueOf(c.id, i.id, m) !== null),
    );
  const rows = contractors
    .filter((c) => !c.oneOff)
    .flatMap((c) =>
      indicators
        .filter((i) => keep(i, c))
        .map((i): ImportTemplateRow => ({
          contractor: c,
          indicatorId: i.id,
          cells: months.map((m): ImportTemplateCell => {
            if (!can(i, c, m) || m > options.current) return { kind: 'off' };
            const value = valueOf(c.id, i.id, m);
            return { kind: value !== null && checked(c.id, m) ? 'checked' : 'input', value };
          }),
        })),
    );
  return { rows, contractors: new Set(rows.map((r) => r.contractor.id)).size };
}

/** Значение ячейки прочитанного файла: число, текст или пусто. */
export type ImportCellValue = string | number | null;

/** Причины ошибок загрузки (ТЗ «Ввод из Excel» → «Предпросмотр»); тексты — в словаре. */
export const IMPORT_PROBLEMS = [
  'no_inn',
  'unknown_indicator',
  'unknown_contractor',
  'no_access',
  'indicator_archived',
  'indicator_off',
  'month_in_future',
  'not_number',
  'not_month',
] as const;
export type ImportProblem = (typeof IMPORT_PROBLEMS)[number];

export interface ImportError {
  /** Строка и столбец Excel: строка с 1 (первая — заголовки), столбец с 0. */
  row: number;
  col: number;
  /** Ячейка: «C5». */
  ref: string;
  /** Контрагент строки, если он найден и доступен; иначе null. */
  contractorId: string | null;
  /** Значение ячейки как в файле. */
  value: string;
  problem: ImportProblem;
}

export interface ImportItem {
  contractorId: string;
  indicatorId: string;
  month: YearMonth;
  value: IndicatorValue;
  /** Было; null — пусто. */
  old: IndicatorValue | null;
  /** Месяц контрагента в статусе «Проверено»: такое изменение применяется только с согласия. */
  checked: boolean;
  ref: string;
  row: number;
}

export interface ImportPlan {
  /** «Новые» — было пусто. */
  added: ImportItem[];
  /** «Изменённые» — было → стало. */
  changed: ImportItem[];
  /** «Без изменений». */
  same: number;
  /**
   * Ошибки по порядку — первые `IMPORT_ERRORS_KEPT` (больше не покажет ни предпросмотр, ни файл
   * ошибок); всего ошибок — `errorCount`.
   */
  errors: ImportError[];
  errorCount: number;
  /** Значений в строках с ошибками: такие строки не записываются. */
  skipped: number;
  /** Месяцы прочитанных значений — период загрузки в «Истории загрузок». */
  months: YearMonth[];
}

/** Показатель для разбора заголовков: и в архиве (тогда ошибка «показатель в архиве»). */
export interface ImportIndicator extends KpiIndicator {
  name: string;
  type: IndicatorType;
}

export interface ImportLookup {
  book: KpiBook;
  indicators: readonly ImportIndicator[];
  /**
   * Контрагент организации по ИНН (14 цифр); `editable` — сотрудник вносит его значения (право и
   * область). Нет такого — `undefined`.
   */
  contractorByInn(inn: string): { contractor: KpiContractor; editable: boolean } | undefined;
  valueOf: KpiValueOf;
  checked(contractorId: string, month: YearMonth): boolean;
  /** Идущий месяц: значения за будущие месяцы не вносятся. */
  currentMonth: YearMonth;
}

const isBlank = (v: ImportCellValue | undefined) => v == null || String(v).trim() === '';

/**
 * ИНН из ячейки: без пробелов; 13 цифр — Excel убрал ведущий ноль у числа, он возвращается (прототип).
 */
export function importInn(value: ImportCellValue | undefined): string {
  const inn = String(value ?? '')
    .trim()
    .replace(/\s/g, '');
  return /^\d{13}$/.test(inn) ? `0${inn}` : inn;
}

/** Заголовок столбца для сравнения: «ИНН», «Показатель», «Итог» — без регистра и пробелов по краям. */
const headKey = (h: ImportCellValue | undefined) => searchText(String(h ?? '')).trim();

/** Столбец «Показатель» в первой строке: шаблон «строка — контрагент и показатель»; нет — прежний. */
const indicatorColumn = (keys: readonly string[]) => keys.indexOf('показатель');

/** Месяцы из заголовков загруженного файла (того или другого вида) — по порядку, без повторов. */
export function importFileMonths(head: readonly (ImportCellValue | undefined)[]): YearMonth[] {
  const byRow = indicatorColumn(head.map(headKey)) >= 0;
  const months = new Set<YearMonth>();
  for (const h of head) {
    const m = byRow ? parseImportMonth(h) : h == null ? null : parseImportHead(String(h))?.month;
    if (m) months.add(m);
  }
  return [...months].sort();
}

/** Столбец значений: месяц и показатель (в прежнем шаблоне — из заголовка, в новом — из строки). */
interface ImportColumn {
  indicator: ImportIndicator | null;
  month: YearMonth;
}

/**
 * Разбор заполненного шаблона (прототип `kxParse`): первая строка — заголовки, в ней столбец «ИНН» (нет —
 * файл не принимается целиком); «Контрагент» и «Название» пропускаются. Есть столбец «Показатель» —
 * строка «контрагент и показатель», остальные столбцы — месяцы («Итог» пропускается, не месяц — ошибка
 * заголовка); нет — прежний шаблон «Показатель · ММ.ГГГГ». Повтор той же ячейки (контрагент, показатель,
 * месяц) — берётся первая. Строка с ошибкой не записывается целиком: её значения считаются в `skipped`.
 */
export function planImport(
  rows: readonly (readonly ImportCellValue[] | undefined)[],
  lookup: ImportLookup,
): ImportPlan {
  const plan: ImportPlan = {
    added: [],
    changed: [],
    same: 0,
    errors: [],
    errorCount: 0,
    skipped: 0,
    months: [],
  };
  // Строки Excel с ошибками: такие не записываются.
  const bad = new Set<number>();
  const err = (
    r: number,
    c: number,
    problem: ImportProblem,
    contractorId: string | null,
    value: ImportCellValue | undefined,
  ) => {
    bad.add(r + 1);
    if (++plan.errorCount > IMPORT_ERRORS_KEPT) return;
    const text = value == null ? '' : String(value);
    plan.errors.push({
      row: r + 1,
      col: c,
      ref: `${excelColumn(c)}${r + 1}`,
      contractorId,
      value:
        text.length > IMPORT_ERROR_VALUE_MAX_LENGTH
          ? `${text.slice(0, IMPORT_ERROR_VALUE_MAX_LENGTH)}…`
          : text,
      problem,
    });
  };
  const head = rows[0] ?? [];
  const keys = head.map(headKey);
  const innCol = keys.indexOf('инн');
  if (innCol < 0) {
    err(0, 0, 'no_inn', null, null);
    return plan;
  }
  const indCol = indicatorColumn(keys);
  const byName = new Map<string, ImportIndicator>();
  for (const i of lookup.indicators) byName.set(searchText(i.name).trim(), i);
  const columns = head.map((h, j): ImportColumn | null => {
    if (j === innCol || isBlank(h)) return null;
    if (keys[j] === 'контрагент' || keys[j] === 'название') return null;
    if (indCol >= 0) {
      if (j === indCol || keys[j] === 'итог') return null;
      const month = parseImportMonth(h);
      if (!month) {
        err(0, j, 'not_month', null, h);
        return null;
      }
      return { indicator: null, month };
    }
    const text = String(h).trim();
    const parsed = parseImportHead(text);
    const indicator = parsed && byName.get(searchText(parsed.name).trim());
    if (!indicator) {
      err(0, j, 'unknown_indicator', null, text);
      return null;
    }
    return { indicator, month: parsed.month };
  });

  const seen = new Set<string>();
  const months = new Set<YearMonth>();
  const items: ImportItem[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every(isBlank)) continue;
    const inn = importInn(row[innCol]);
    const found = lookup.contractorByInn(inn);
    if (!found) {
      err(r, innCol, 'unknown_contractor', null, inn);
      continue;
    }
    // Контрагент вне области: в ошибке нет его названия — только что доступа нет.
    if (!found.editable) {
      err(r, innCol, 'no_access', null, inn);
      continue;
    }
    const c = found.contractor;
    // Новый шаблон: показатель — по названию в строке.
    let rowIndicator: ImportIndicator | null = null;
    if (indCol >= 0) {
      const name = String(row[indCol] ?? '').trim();
      rowIndicator = byName.get(searchText(name).trim()) ?? null;
      if (!rowIndicator) {
        err(r, indCol, 'unknown_indicator', c.id, name);
        continue;
      }
    }
    // По ячейкам строки, а не по всем столбцам заголовка: короткая строка под широким заголовком не
    // тратит время на пустые столбцы.
    const width = Math.min(row.length, columns.length);
    for (let j = 0; j < width; j++) {
      const x = columns[j];
      if (!x) continue;
      const raw = row[j];
      if (isBlank(raw)) continue;
      const indicator = x.indicator ?? rowIndicator!;
      if (indicator.archived) {
        err(r, j, 'indicator_archived', c.id, raw);
        continue;
      }
      if (x.month > lookup.currentMonth) {
        err(r, j, 'month_in_future', c.id, raw);
        continue;
      }
      if (cellState(lookup.book, indicator, c, x.month) === 'off') {
        err(r, j, 'indicator_off', c.id, raw);
        continue;
      }
      const parsed = parseIndicatorValue(indicator.type, String(raw));
      if (!parsed.ok || parsed.value === null) {
        err(r, j, 'not_number', c.id, raw);
        continue;
      }
      const key = `${c.id}|${indicator.id}|${x.month}`;
      if (seen.has(key)) continue;
      seen.add(key);
      months.add(x.month);
      const old = lookup.valueOf(c.id, indicator.id, x.month);
      const item: ImportItem = {
        contractorId: c.id,
        indicatorId: indicator.id,
        month: x.month,
        value: parsed.value,
        old,
        checked: old !== null && lookup.checked(c.id, x.month),
        ref: `${excelColumn(j)}${r + 1}`,
        row: r + 1,
      };
      if (old === null) items.push(item);
      else if (old === parsed.value) plan.same++;
      else items.push(item);
    }
  }
  for (const item of items) {
    if (bad.has(item.row)) plan.skipped++;
    else if (item.old === null) plan.added.push(item);
    else plan.changed.push(item);
  }
  plan.months = [...months].sort();
  return plan;
}

/**
 * Что записать при «Применить» (прототип `kxApply`): новые и изменённые; изменения проверенных — только
 * с согласия («Изменить N проверенных значений?»), иначе они пропускаются.
 */
export function importWrites(plan: ImportPlan, withChecked: boolean): ImportItem[] {
  return [...plan.added, ...plan.changed.filter((x) => withChecked || !x.checked)];
}
