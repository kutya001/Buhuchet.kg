import { searchText } from '../common/list';
import type { YearMonth } from '../common/months';
import { activeIndicators, type KpiBook, type KpiContractor, type KpiIndicator } from './fill';
import { parseIndicatorValue, type IndicatorType, type IndicatorValue } from './indicators';
import { cellState, type KpiValueOf } from './views';

/*
 * «Ввод из Excel» (задача 2.28; ТЗ «Показатели контрагентов» → «Ввод из Excel»; прототип
 * modules/kpi-excel.js: kxHead, kxTpl, kxParse). Шаблон: строки — контрагенты, первые столбцы — ИНН и
 * название, дальше «Показатель · ММ.ГГГГ» — сначала по показателю, внутри по месяцу. Загрузка:
 * контрагент — по ИНН, показатель и месяц — по заголовку столбца; пустая ячейка ничего не стирает;
 * строка с ошибкой не записывается целиком.
 */

/** Не больше контрагентов и месяцев в одном шаблоне (прототип `KX_MAX_CP`, `KX_MAX_M`). */
export const KPI_IMPORT_MAX_CONTRACTORS = 1000;
export const KPI_IMPORT_MAX_MONTHS = 24;

/**
 * Файл загрузки — не больше 4 МБ: он идёт телом запроса, а площадка (Vercel) принимает тело до 4,5 МБ.
 * Шаблон на 1 000 контрагентов и 24 месяца по нескольким показателям в него помещается.
 */
export const KPI_IMPORT_MAX_BYTES = 4 * 1024 * 1024;

/** Имя файла в «Истории загрузок» — не длиннее (длиннее обрезается). */
export const KPI_IMPORT_FILE_MAX_LENGTH = 255;

/** Заголовок столбца шаблона: «Выручка · 09.2026» (прототип `kxHead`). */
export function importHead(name: string, month: YearMonth): string {
  return `${name} · ${month.slice(5, 7)}.${month.slice(0, 4)}`;
}

/**
 * Заголовок столбца шаблона — не длиннее: название показателя (до 100), месяц и единица в скобках
 * короче. Длиннее — не заголовок шаблона (и разбор выражением не тратит время на длинный текст).
 */
const IMPORT_HEAD_MAX_LENGTH = 300;

/** Значение ячейки в ошибке загрузки — не длиннее (длиннее обрезается, в конце «…»). */
export const IMPORT_ERROR_VALUE_MAX_LENGTH = 200;

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

export interface ImportTemplate {
  /** Строки — контрагенты, у которых ведётся хотя бы один выбранный показатель за период. */
  contractors: KpiContractor[];
  /** Столбцы — где показатель ведётся хотя бы у одного контрагента шаблона. */
  columns: { indicatorId: string; month: YearMonth }[];
  cells: ImportTemplateCell[][];
}

/**
 * Состав шаблона (прототип `kxTpl`). `contractors` — уже отобранные фильтром и областью сотрудника, по
 * порядку строк; показатели — действующие из `indicatorIds` по их порядку; внесённые значения
 * подставлены, проверенные (`checked` — статус месяца «Проверено») помечены.
 */
export function importTemplate(
  book: KpiBook,
  contractors: readonly KpiContractor[],
  indicatorIds: ReadonlySet<string>,
  months: readonly YearMonth[],
  valueOf: KpiValueOf,
  checked: (contractorId: string, month: YearMonth) => boolean,
): ImportTemplate {
  const indicators = activeIndicators(book).filter((i) => indicatorIds.has(i.id));
  const can = (i: KpiIndicator, c: KpiContractor, m: YearMonth) =>
    cellState(book, i, c, m) !== 'off';
  const rows = contractors.filter(
    (c) => !c.oneOff && indicators.some((i) => months.some((m) => can(i, c, m))),
  );
  const columns: { indicator: KpiIndicator; month: YearMonth }[] = [];
  for (const indicator of indicators) {
    for (const month of months) {
      if (rows.some((c) => can(indicator, c, month))) columns.push({ indicator, month });
    }
  }
  const cells = rows.map((c) =>
    columns.map(({ indicator, month }): ImportTemplateCell => {
      if (!can(indicator, c, month)) return { kind: 'off' };
      const value = valueOf(c.id, indicator.id, month);
      return { kind: value !== null && checked(c.id, month) ? 'checked' : 'input', value };
    }),
  );
  return {
    contractors: rows,
    columns: columns.map((x) => ({ indicatorId: x.indicator.id, month: x.month })),
    cells,
  };
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
  errors: ImportError[];
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

/**
 * Разбор заполненного шаблона (прототип `kxParse`): первая строка — заголовки, в ней столбец «ИНН»
 * (нет — файл не принимается целиком); «Контрагент» и «Название» пропускаются. Повтор той же ячейки
 * (контрагент, показатель, месяц) — берётся первая. Строка с ошибкой не записывается целиком: её значения
 * считаются в `skipped`.
 */
export function planImport(
  rows: readonly (readonly ImportCellValue[] | undefined)[],
  lookup: ImportLookup,
): ImportPlan {
  const plan: ImportPlan = { added: [], changed: [], same: 0, errors: [], skipped: 0, months: [] };
  const err = (
    r: number,
    c: number,
    problem: ImportProblem,
    contractorId: string | null,
    value: ImportCellValue | undefined,
  ) => {
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
  const innCol = head.findIndex((h) => searchText(String(h ?? '')).trim() === 'инн');
  if (innCol < 0) {
    err(0, 0, 'no_inn', null, null);
    return plan;
  }
  const byName = new Map<string, ImportIndicator>();
  for (const i of lookup.indicators) byName.set(searchText(i.name).trim(), i);
  const columns = head.map((h, j) => {
    if (j === innCol || isBlank(h)) return null;
    const text = String(h).trim();
    const key = searchText(text);
    if (key === 'контрагент' || key === 'название') return null;
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
    columns.forEach((x, j) => {
      if (!x) return;
      const raw = row[j];
      if (isBlank(raw)) return;
      if (x.indicator.archived) return err(r, j, 'indicator_archived', c.id, raw);
      if (x.month > lookup.currentMonth) return err(r, j, 'month_in_future', c.id, raw);
      if (cellState(lookup.book, x.indicator, c, x.month) === 'off') {
        return err(r, j, 'indicator_off', c.id, raw);
      }
      const parsed = parseIndicatorValue(x.indicator.type, String(raw));
      if (!parsed.ok || parsed.value === null) return err(r, j, 'not_number', c.id, raw);
      const key = `${c.id}|${x.indicator.id}|${x.month}`;
      if (seen.has(key)) return;
      seen.add(key);
      months.add(x.month);
      const old = lookup.valueOf(c.id, x.indicator.id, x.month);
      const item: ImportItem = {
        contractorId: c.id,
        indicatorId: x.indicator.id,
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
    });
  }
  const bad = new Set(plan.errors.map((e) => e.row));
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
