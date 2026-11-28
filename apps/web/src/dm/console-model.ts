import {
  dmMethodSql,
  dmMethodToSelect,
  dmOutRows,
  dmSqlMoneyName,
  dmSqlOutputNames,
  type DmCellType,
  type DmMethodSqlSource,
  type DmOutColumn,
} from '@buhuchet/domain';
import type {
  DmConsoleResult,
  DmTemplateColumnInput,
  DmTemplateParamInput,
} from '@buhuchet/shared';
import { consoleParamNames, knownFields, type SchemaIndex } from './console-assist';
import type { ConsoleOpen } from './console-store';
import type { DmOutResult } from './out-model';

/*
 * Чистые правила вкладки «Консоль» (доработки 27.11.2026: консоль запросов, блоки 1, 4, 5; этап 1,
 * П4–П6; прототип v166 `dmcRun`, `dmcResDraw`, `dmcToTpl`, `dmcFromMethod`): что уходит в базу,
 * столбцы результата (деньги — тыйыны, на экране — сомы), окно шаблона по запросу консоли и запрос
 * метода API в консоль.
 */

/** Значения параметров текста для «Выполнить»: пустое поле — пусто (`null`). */
export function consoleParamsToSend(
  sql: string,
  values: Readonly<Record<string, string>>,
): Record<string, string | null> {
  return Object.fromEntries(
    consoleParamNames(sql).map((k) => [k, values[k]?.trim() ? values[k]! : null]),
  );
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MOMENT = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

/** Тип столбца ответа консоли по имени и значениям (у консоли нет описания столбцов, как у шаблона). */
export function consoleColumnType(name: string, values: readonly unknown[]): DmCellType {
  const seen = values.filter((v) => v !== null && v !== undefined && v !== '');
  const numeric = seen.every(
    (v) => typeof v === 'number' || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)),
  );
  if (dmSqlMoneyName(name) && numeric) return 'money';
  if (!seen.length) return 'text';
  if (seen.every((v) => typeof v === 'boolean')) return 'bool';
  if (seen.every((v) => typeof v === 'number')) return 'num';
  if (seen.every((v) => typeof v === 'string' && DATE.test(v))) return 'date';
  if (seen.every((v) => typeof v === 'string' && MOMENT.test(v))) return 'datetime';
  return 'text';
}

/** Ответ «Выполнить» в таблицу «как в Excel» «Вывода»: имя денежного столбца — «… · сом». */
export function consoleResult(
  answer: DmConsoleResult,
  somLabel: (name: string) => string,
): DmOutResult {
  const columns: DmOutColumn[] = answer.columns.map((name, k) => {
    const type = consoleColumnType(
      name,
      answer.rows.map((r) => r[k]),
    );
    // Одинаковые имена (два «name») — свой код у каждого: таблица различает столбцы по коду.
    const code = answer.columns.indexOf(name) === k ? name : `${name}_${k + 1}`;
    return { code, name: type === 'money' ? somLabel(name) : name, type, total: type === 'money' };
  });
  return {
    columns,
    rows: dmOutRows(columns, answer.rows),
    more: answer.more,
    max: answer.max,
    ms: answer.ms,
    orgName: null,
  };
}

/** Есть ли деньги в результате: пометка «деньги — в сомах, в базе тыйыны». */
export const consoleHasMoney = (r: DmOutResult) => r.columns.some((c) => c.type === 'money');

/** Тип параметра шаблона по имени (прототип `dmcToTpl`). */
const paramType = (k: string): DmTemplateParamInput['type'] =>
  /month/.test(k)
    ? 'month'
    : /date|_from$|_to$/.test(k)
      ? 'date'
      : /year/.test(k)
        ? 'year'
        : 'text';

const FIELD = /^[a-z][a-z0-9_]{0,39}$/;

/** Тип столбца по имени, когда запуска не было (прототип `dmcRewrite`: деньги, контрагент, `_at`, `_date`). */
function columnTypeByName(code: string): DmCellType {
  if (dmSqlMoneyName(code)) return 'money';
  if (code === 'contractor_id') return 'cp';
  if (code.endsWith('_at')) return 'datetime';
  if (code === 'date' || code.endsWith('_date') || code.endsWith('_on')) return 'date';
  return 'text';
}

/**
 * Окно шаблона по запросу консоли (блок 1, пункт 7; блок 4, пункт 4; прототип `dmcToTpl`): запрос,
 * параметры и столбцы последнего запуска (без запуска — из списка SELECT); у шаблона, из которого
 * открыт запрос, — его же параметры и столбцы по коду. Неподходящие имена окно оставит — «Проверить»
 * скажет, что поправить.
 */
export function consoleTemplatePrefill(
  sql: string,
  last: DmOutResult | null,
  had: {
    params: readonly DmTemplateParamInput[];
    columns: readonly DmTemplateColumnInput[];
  } | null,
): { query: string; params: DmTemplateParamInput[]; columns: DmTemplateColumnInput[] } {
  const params = consoleParamNames(sql)
    .filter((k) => FIELD.test(k))
    .map(
      (k): DmTemplateParamInput =>
        had?.params.find((p) => p.code === k) ?? {
          code: k,
          name: k,
          type: paramType(k),
          required: true,
          default: null,
        },
    );
  const fromRun = last?.columns.map((c) => ({ code: c.code, type: c.type, total: c.total }));
  const cols =
    fromRun ??
    dmSqlOutputNames(sql).map((code) => ({
      code,
      type: columnTypeByName(code),
      total: false,
    }));
  const columns = cols
    .filter((c) => FIELD.test(c.code))
    .map(
      (c): DmTemplateColumnInput =>
        had?.columns.find((x) => x.code === c.code) ?? {
          code: c.code,
          name: c.code,
          type: c.type,
          total: c.total,
        },
    );
  return { query: sql, params, columns };
}

/** Карточка метода API для П6: метод, адрес, краткое описание и его запросы. */
export interface MethodSource {
  method: string;
  path: string;
  summary: string;
  queries: readonly { kind: string; text: string }[];
}

/** Точный SQL метода чтения или `null` — запрос написан кодом (прототип `dmcMethodSql`). */
export function methodSqlOf(card: MethodSource): string | null {
  const sql: DmMethodSqlSource[] = card.queries.map((q) => ({ k: q.kind, t: q.text }));
  return dmMethodSql({ m: card.method, q: sql.map((_, i) => i) }, sql);
}

/**
 * Запрос метода API → вкладка консоли (блок 5, пункты 2–4; прототип `dmcFromMethod`): CREATE VIEW →
 * SELECT, проверки «администратор» и «моя организация» убраны, параметры — `:имя`, что заменено и что
 * заменить — пометкой над редактором. `null` — запрос метода не SELECT.
 */
export function methodToConsole(
  card: MethodSource,
  schema: SchemaIndex | null,
  toTemplate: boolean,
  /** Комментарий у служебной функции в тексте (`-- …`), `{list}` — их имена; из словаря. */
  svcComment?: string,
): ConsoleOpen | null {
  const src = methodSqlOf(card);
  if (!src) return null;
  const r = dmMethodToSelect(src, schema ? knownFields(schema) : undefined, svcComment);
  if (!r.sql) return null;
  return {
    sql: r.sql,
    params: Object.fromEntries(r.params.map((k) => [k, ''])),
    name: card.summary || card.path,
    notes: {
      from: `${card.method} ${card.path}`,
      changed: r.changed,
      replace: r.replace,
      money: r.money,
    },
    toTemplate,
  };
}

/** Строка «Плана запроса»: глубина узла, вид операции, таблица, оценка строк и стоимости. */
export interface PlanLine {
  depth: number;
  type: string;
  relation: string | null;
  rows: number;
  cost: number;
}

/** Ответ EXPLAIN (FORMAT JSON) базы деревом строк; непонятное — пропускается. */
export function consolePlanLines(plan: unknown): PlanLine[] {
  const out: PlanLine[] = [];
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const walk = (node: unknown, depth: number) => {
    if (!node || typeof node !== 'object' || out.length >= 500) return;
    const n = node as Record<string, unknown>;
    const type = typeof n['Node Type'] === 'string' ? n['Node Type'] : null;
    if (type) {
      const rel = n['Relation Name'];
      out.push({
        depth,
        type,
        relation: typeof rel === 'string' ? rel : null,
        rows: num(n['Plan Rows']),
        cost: num(n['Total Cost']),
      });
    }
    if (Array.isArray(n.Plans)) for (const c of n.Plans) walk(c, depth + 1);
  };
  const top = Array.isArray(plan) ? plan : [plan];
  for (const x of top)
    walk(x && typeof x === 'object' ? (x as Record<string, unknown>).Plan : null, 0);
  return out;
}

/**
 * Столбцы окна шаблона после автостолбца «Контрагент» (этап 2, П7; прототип `dmcToTpl`):
 * `contractor_id`, которого не было у шаблона, — вид «Контрагент (для области)»; дописанный в запрос —
 * первым, а если последний запуск шёл до дописывания и его не знает, — добавляется.
 */
export function consoleCpColumns(
  columns: DmTemplateColumnInput[],
  own: ReadonlySet<string>,
  added: boolean,
  cpName: string,
): DmTemplateColumnInput[] {
  const cols = columns.map((c) =>
    c.code === 'contractor_id' && !own.has(c.code)
      ? { ...c, name: cpName, type: 'cp' as const, total: false }
      : c,
  );
  if (!added) return cols;
  const cp = cols.find((c) => c.code === 'contractor_id') ?? {
    code: 'contractor_id',
    name: cpName,
    type: 'cp' as const,
    total: false,
  };
  return [cp, ...cols.filter((c) => c.code !== 'contractor_id')];
}
