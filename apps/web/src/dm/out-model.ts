import {
  DM_MODULES,
  dmCopyText,
  dmListType,
  dmNumText,
  dmOutPage,
  dmOutRows,
  dmOutValues,
  dmParamValue,
  dmShownColumns,
  dmStatNumber,
  dmText,
  formatSom,
  type DmModule,
  type DmOutColumn,
  type DmOutRow,
  type DmOutTexts,
  type IsoDate,
  type ListQuery,
} from '@buhuchet/domain';
import {
  DmBadParam,
  ListQueryParams,
  parseListQuery,
  type DmParam,
  type DmRunResult,
  type DmTemplateCard,
} from '@buhuchet/shared';
import type { GridColumn, GridPage, GridValues } from '@buhuchet/ui';
import type { ExCell } from '../kpi/ex-table';

/*
 * «Витрина данных» → «Вывод» и «Шаблоны» (доработки 20.11.2026: Витрина данных, блоки 3–4; прототип
 * v155 `modules/vitrina.js`: `dmOutList`, `dmOptHtml`, `dmPar`, `dmParRead`, `dmCol`, `dmEx`,
 * `renderDmTpl`). Чистые правила экрана: шаблоны по группам, параметры по умолчанию и их проверка,
 * результат запуска по столбцам шаблона, столбцы таблицы и страница по всему результату (правила
 * домена `datamart/output.ts`), ячейки таблицы «как в Excel» только для просмотра.
 */

/** Результат на экране: столбцы и строки ответа (деньги — тыйыны), сколько показано и время. */
export interface DmOutResult {
  columns: DmOutColumn[];
  rows: DmOutRow[];
  /** Строк больше предела: показаны первые `max`. */
  more: boolean;
  max: number;
  ms: number;
  /** У Админки «глазами организации» — её название. */
  orgName: string | null;
}

/** Ответ «Показать» в строки таблицы: строка — значения по порядку столбцов ответа. */
export function outResult(answer: DmRunResult): DmOutResult {
  return {
    columns: answer.columns,
    rows: dmOutRows(answer.columns, answer.rows),
    more: answer.more,
    max: answer.max,
    ms: answer.ms,
    orgName: answer.orgName,
  };
}

const resultIds = new WeakMap<object, number>();
let lastResultId = 0;

/**
 * Номер ответа «Показать» для ключа страницы таблицы: новый ответ — новый номер, тот же ответ (и его
 * показ, пока грузится следующий) — тот же, поэтому страница таблицы не смешивает строки двух ответов.
 */
export function outResultKey(answer: object): string {
  let id = resultIds.get(answer);
  if (id === undefined) {
    lastResultId += 1;
    id = lastResultId;
    resultIds.set(answer, id);
  }
  return String(id);
}

/** Группа выбора шаблона (прототип `dmOptHtml`): у Админки «Для администратора» и «Для организаций · …». */
export interface DmTemplateGroup {
  key: string;
  /** Ключ словаря подписи группы и модуль для подстановки. */
  label: { admin: true } | { module: DmModule | null; prefix: boolean };
  items: DmTemplateCard[];
}

/** Шаблоны по группам в порядке списка (прототип `dmOptHtml`: группа — по первому шаблону). */
export function outTemplateGroups(
  list: readonly DmTemplateCard[],
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
  list: readonly DmTemplateCard[],
): { module: DmModule; items: DmTemplateCard[] }[] {
  return DM_MODULES.map((module) => ({
    module,
    items: list.filter((t) => t.audience === 'org' && t.module === module),
  })).filter((g) => g.items.length > 0);
}

/** Значения параметров: код → значение строкой; пусто — не задан. */
export type DmParamValues = Record<string, string>;

/**
 * Параметры шаблона для формы (прототип `dmPar`): запомненное значение пользователя, иначе значение по
 * умолчанию на «сегодня» по Бишкеку (его считает сервер — `value` параметра). Пустое запомненное — тоже
 * значение по умолчанию: прототип запоминает пустое поле как `null` (`dmParRead`).
 */
export function outParamsOf(
  params: readonly DmParam[],
  saved: Readonly<Record<string, unknown>> | null,
): DmParamValues {
  const out: DmParamValues = {};
  for (const p of params) {
    const v = saved?.[p.code];
    out[p.code] = typeof v === 'string' && v !== '' ? v : (p.value ?? '');
  }
  return out;
}

/** Ошибка «Показать» для экрана: неверный параметр — у поля, сломанный шаблон — состояние, иначе — текстом. */
export type DmRunFailure =
  | { kind: 'param'; param: string; problem: DmParamProblem }
  | { kind: 'broken'; error: string | null }
  | { kind: 'other' };

/** Разбор отказа «Показать» (`DM_RUN_ERRORS`): `details` — `{ param, why }` или `{ error }` у Админки. */
export function outRunFailure(code: string, details: unknown): DmRunFailure {
  if (code === 'dm_bad_param') {
    const d = DmBadParam.safeParse(details);
    if (d.success) {
      return {
        kind: 'param',
        param: d.data.param,
        problem: outServerProblem(d.data.param, d.data.why),
      };
    }
  }
  if (code === 'dm_template_broken') {
    const error =
      typeof details === 'object' && details !== null && 'error' in details ? details.error : null;
    return { kind: 'broken', error: typeof error === 'string' && error ? error : null };
  }
  return { kind: 'other' };
}

/**
 * Запускать ли шаблон сразу при открытии (прототип `renderDmOut` рисует результат сразу): только
 * опубликованный, с верными параметрами и не «глазами организации» — запуск Админки по шаблону
 * организации пишется в её историю, поэтому он — только по «Показать» (docs/deviations.md п. И-16).
 */
export function outAutoRun(
  tpl: Pick<DmTemplateCard, 'state' | 'params' | 'audience'>,
  values: Readonly<DmParamValues>,
  admin: boolean,
): boolean {
  if (tpl.state !== 'published') return false;
  if (admin && tpl.audience === 'org') return false;
  return Object.keys(outParamProblems(tpl.params, values)).length === 0;
}

/** Выбор «Год»: текущий и четыре прошлых, запомненный год вне них — тоже в списке, первым. */
export function outYearOptions(today: IsoDate, value: string): string[] {
  const years = outYears(today);
  return value && !years.includes(value) ? [value, ...years] : years;
}

/** Почему параметр не принят (ключи словаря `dm.par.err.*`). */
export type DmParamProblem = 'required' | 'type' | 'date_order' | 'month_order';

/**
 * Проверка параметров перед «Показать» (прототип `dmParRead`): обязательный — «Укажите значение»,
 * значение не того типа — «Неверное значение»; «По дату» раньше «С даты» и «Месяц раньше начального» —
 * у второго поля. Ответ — ошибки по кодам параметров; пусто — можно запускать.
 */
export function outParamProblems(
  params: readonly DmParam[],
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

/**
 * Параметры для «Показать» (прототип `dmParRead`: `v || null`): пустое поле уходит пустым — у
 * необязательного параметра это «все», а не значение по умолчанию.
 */
export function outParamsToSend(
  params: readonly DmParam[],
  values: Readonly<DmParamValues>,
): Record<string, string | null> {
  return Object.fromEntries(
    params.map((p) => {
      const v = (values[p.code] ?? '').trim();
      return [p.code, v === '' ? null : v];
    }),
  );
}

/** Отказ сервера по параметру (`dm_bad_param`: `type`, `required`, `range`) — ошибка поля формы. */
export function outServerProblem(
  param: string,
  why: 'type' | 'required' | 'range',
): DmParamProblem {
  if (why !== 'range') return why;
  return param.startsWith('month') ? 'month_order' : 'date_order';
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
