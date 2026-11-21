import {
  DM_MODULES,
  dmCopyText,
  dmListType,
  dmNumText,
  dmOutPage,
  dmOutRows,
  dmOutValues,
  dmParamDefault,
  dmParamValue,
  dmShownColumns,
  dmStatNumber,
  dmText,
  formatSom,
  type DmModule,
  type DmOutColumn,
  type DmOutRow,
  type DmOutTexts,
  type DmParamType,
  type IsoDate,
  type ListQuery,
} from '@buhuchet/domain';
import { ListQueryParams, parseListQuery } from '@buhuchet/shared';
import type { GridColumn, GridPage, GridValues } from '@buhuchet/ui';
import type { ExCell } from '../kpi/ex-table';

/*
 * «Витрина данных» → «Вывод» и «Шаблоны» (доработки 20.11.2026: Витрина данных, блоки 3–4; прототип
 * v155 `modules/vitrina.js`: `dmOutList`, `dmOptHtml`, `dmPar`, `dmParRead`, `dmCol`, `dmEx`,
 * `renderDmTpl`). Чистые правила экрана: шаблоны по группам, параметры по умолчанию и их проверка,
 * результат запуска по столбцам шаблона, столбцы таблицы и страница по всему результату (правила
 * домена `datamart/output.ts`), ячейки таблицы «как в Excel» только для просмотра.
 */

/** Параметр шаблона, как его отдаёт каталог (`dm_templates.params`). */
export interface DmOutParam {
  code: string;
  name: string;
  type: DmParamType;
  required: boolean;
  default: string | null;
}

/** Шаблон «Вывода» и каталога: текста запроса здесь нет (его видит только Админка в окне шаблона). */
export interface DmOutTemplate {
  id: string;
  code: string;
  name: string;
  description: string;
  audience: 'org' | 'admin';
  module: DmModule | null;
  state: 'published' | 'broken';
  /** Текст ошибки сломанного шаблона — только администратору платформы. */
  error: string | null;
  /** Ещё одно право шаблона (прототип `perm`: «Видеть плату за обслуживание»). */
  needPermission: string | null;
  params: DmOutParam[];
  columns: DmOutColumn[];
}

/** Ответ запуска (исполнитель `runDmOrg` / `runDmAdmin`): деньги — тыйыны, строка — массив значений. */
export interface DmRunAnswer {
  columns: string[];
  rows: unknown[][];
  /** Строк больше предела: показаны первые 50 000. */
  more: boolean;
  ms: number;
}

/** Результат на экране: строки по столбцам шаблона. */
export interface DmOutResult {
  rows: DmOutRow[];
  more: boolean;
  ms: number;
}

/**
 * Строки ответа по столбцам шаблона: столбец ответа находится по коду (порядок запроса может быть
 * другим), столбца нет — пустые ячейки.
 */
export function outResult(columns: readonly DmOutColumn[], answer: DmRunAnswer): DmOutResult {
  const at = new Map(answer.columns.map((name, i) => [name, i]));
  const order = columns.map((c) => at.get(c.code) ?? -1);
  const rows = answer.rows.map((row) => order.map((i) => (i < 0 ? null : row[i])));
  return { rows: dmOutRows(columns, rows), more: answer.more, ms: answer.ms };
}

/** Группа выбора шаблона (прототип `dmOptHtml`): у Админки «Для администратора» и «Для организаций · …». */
export interface DmTemplateGroup {
  key: string;
  /** Ключ словаря подписи группы и модуль для подстановки. */
  label: { admin: true } | { module: DmModule | null; prefix: boolean };
  items: DmOutTemplate[];
}

/** Шаблоны по группам в порядке списка (прототип `dmOptHtml`: группа — по первому шаблону). */
export function outTemplateGroups(
  list: readonly DmOutTemplate[],
  admin: boolean,
): DmTemplateGroup[] {
  const out: DmTemplateGroup[] = [];
  for (const t of list) {
    const key = t.audience === 'admin' ? 'admin' : `org:${t.module ?? 'other'}`;
    let g = out.find((x) => x.key === key);
    if (!g) {
      g = {
        key,
        label: t.audience === 'admin' ? { admin: true } : { module: t.module, prefix: admin },
        items: [],
      };
      out.push(g);
    }
    g.items.push(t);
  }
  return out;
}

/** Каталог организации по модулям в порядке `DM_MODULES` (прототип `renderDmTpl`). */
export function catalogGroups(
  list: readonly DmOutTemplate[],
): { module: DmModule; items: DmOutTemplate[] }[] {
  return DM_MODULES.map((module) => ({
    module,
    items: list.filter((t) => t.audience === 'org' && t.module === module),
  })).filter((g) => g.items.length > 0);
}

/** Значения параметров: код → значение строкой; пусто — не задан. */
export type DmParamValues = Record<string, string>;

/**
 * Параметры шаблона для формы (прототип `dmPar`): запомненное значение пользователя, иначе значение по
 * умолчанию на «сегодня» по Бишкеку.
 */
export function outParamsOf(
  params: readonly DmOutParam[],
  saved: Readonly<Record<string, unknown>> | null,
  today: IsoDate,
): DmParamValues {
  const out: DmParamValues = {};
  for (const p of params) {
    const v = saved?.[p.code];
    out[p.code] = typeof v === 'string' ? v : (dmParamDefault(p.default, today) ?? '');
  }
  return out;
}

/** Почему параметр не принят (ключи словаря `dm.par.err.*`). */
export type DmParamProblem = 'required' | 'type' | 'date_order' | 'month_order';

/**
 * Проверка параметров перед «Показать» (прототип `dmParRead`): обязательный — «Укажите значение»,
 * значение не того типа — «Неверное значение»; «По дату» раньше «С даты» и «Месяц раньше начального» —
 * у второго поля. Ответ — ошибки по кодам параметров; пусто — можно запускать.
 */
export function outParamProblems(
  params: readonly DmOutParam[],
  values: Readonly<DmParamValues>,
): Record<string, DmParamProblem> {
  const out: Record<string, DmParamProblem> = {};
  for (const p of params) {
    const v = (values[p.code] ?? '').trim();
    if (!v) {
      if (p.required) out[p.code] = 'required';
      continue;
    }
    if (dmParamValue(p.type, values[p.code] ?? '') === null) out[p.code] = 'type';
  }
  if (Object.keys(out).length) return out;
  const v = (code: string) => (values[code] ?? '').trim();
  const has = (code: string) => params.some((p) => p.code === code);
  if (has('date_from') && has('date_to') && v('date_from') && v('date_to')) {
    if (v('date_from') > v('date_to')) out.date_to = 'date_order';
  }
  if (has('month_from') && has('month_to') && v('month_from') && v('month_to')) {
    if (v('month_from') > v('month_to')) out.month_to = 'month_order';
  }
  return out;
}

/** Только заданные параметры — то, что уходит в запуск и запоминается. */
export function outParamsToSend(values: Readonly<DmParamValues>): DmParamValues {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== ''));
}

/** Годы выбора параметра «Год» (прототип `dmParHtml`): текущий и четыре прошлых. */
export function outYears(today: IsoDate): string[] {
  const y = Number(today.slice(0, 4));
  return [0, 1, 2, 3, 4].map((i) => String(y - i));
}

/** Ширина столбца по умолчанию (прототип `dmCol`): первый текстовый — 230, текст — 170, деньги — 140. */
export function outColumnWidth(col: DmOutColumn, position: number): number {
  if (col.type === 'text') return position === 0 ? 230 : 170;
  return col.type === 'money' ? 140 : 120;
}

/** Итог столбца строкой: деньги — «1 250,50», число — с дробной частью, только если есть. */
export function outTotalText(col: DmOutColumn, value: number): string {
  return col.type === 'money' ? formatSom(value) : dmNumText(value);
}

/**
 * Столбцы таблицы (прототип `dmCol`): все, кроме служебного «Контрагент для области»; ячейка знает
 * своё место в строке (`data-dx`) и строку результата (`data-dr`) — по ним таблица как в Excel берёт
 * значения.
 */
export function outColumns(
  columns: readonly DmOutColumn[],
  texts: DmOutTexts,
): GridColumn<DmOutRow>[] {
  return dmShownColumns(columns).map(({ col, index }, position) => {
    const numeric = col.type === 'num' || col.type === 'money';
    return {
      key: col.code,
      label: col.name,
      type: dmListType(col.type),
      width: outColumnWidth(col, position),
      numeric,
      text: (r) => dmText(col.type, r.v[index] ?? null, texts),
      className: numeric ? 'tabular-nums' : undefined,
      td: (r) => ({ 'data-dx': String(position), 'data-dr': String(r.i) }),
      ...(col.total && numeric ? { total: (v: number) => outTotalText(col, v) } : {}),
    };
  });
}

/** Разобранный запрос списка из параметров `useListPage` (неверный — первая страница без условий). */
function listQueryOf(params: Record<string, string>): ListQuery {
  const raw = ListQueryParams.safeParse(params);
  const parsed = raw.success ? parseListQuery(raw.data) : null;
  return parsed?.ok ? parsed.query : { sort: null, page: 1, size: 25, filters: {} };
}

/** Страница таблицы по всему результату — как ответ общего списка. */
export function outPageOf(
  rows: readonly DmOutRow[],
  columns: readonly DmOutColumn[],
  params: Record<string, string>,
  texts: DmOutTexts,
): GridPage<DmOutRow> {
  return dmOutPage(rows, columns, listQueryOf(params), texts);
}

/** Значения фильтра-галочек столбца по всему результату. */
export function outValuesOf(
  rows: readonly DmOutRow[],
  columns: readonly DmOutColumn[],
  key: string,
  texts: DmOutTexts,
  q?: string,
): GridValues {
  return dmOutValues(rows, columns, key, texts, q ?? '');
}

/** Ячейка таблицы как в Excel: строка результата и место столбца среди видимых. */
export interface OutCellRef {
  row: number;
  col: number;
}

/**
 * Координаты ячеек (прототип `dmEx`): ячейки `td[data-dx]` по порядку строк на странице получают
 * `data-sr`, `data-sc`; ответ — какая строка результата и какой столбец в каждой ячейке. Строки в
 * свёрнутых группах не нарисованы — их нет и в таблице.
 */
export function numberOutCells(root: ParentNode): OutCellRef[][] {
  const out: OutCellRef[][] = [];
  root.querySelectorAll('tbody tr').forEach((tr) => {
    const cells = tr.querySelectorAll<HTMLElement>('td[data-dx]');
    if (!cells.length) return;
    const r = out.length;
    out.push(
      [...cells].map((td, c) => {
        td.dataset.sr = String(r);
        td.dataset.sc = String(c);
        return { row: Number(td.dataset.dr), col: Number(td.dataset.dx) };
      }),
    );
  });
  return out;
}

/**
 * Ячейка для таблицы как в Excel (прототип `dmEx` `get`): текст для Ctrl+C — числа без разрядов с
 * дробной частью через запятую; число — для строки состояния; правки нет.
 */
export function outExCell(
  shown: readonly { col: DmOutColumn; index: number }[],
  row: DmOutRow | undefined,
  col: number,
  texts: DmOutTexts,
  why: string,
): ExCell {
  const s = shown[col];
  if (!row || !s) return { t: '', n: null, ed: false, why };
  const v = row.v[s.index] ?? null;
  return { t: dmCopyText(s.col.type, v, texts), n: dmStatNumber(s.col.type, v), ed: false, why };
}
