/**
 * Что можно в тексте запроса «Витрины данных» — по дереву разбора самого PostgreSQL (доработки
 * 27.11.2026: консоль запросов, блок 2, пункты 5–8; этап 0, П2; docs/decisions.md п. О-68). Дерево даёт
 * `parsePgSql` из `@buhuchet/adapters/sql-parser` (libpg_query): в нём видна каждая вызванная функция,
 * и в подзапросе, и во FROM, и в имени с кавычками или схемой, — поиск слов (`FORBIDDEN` до 27.11) этого
 * не видел.
 *
 * Два вида правил:
 * - `console` — консоль администратора платформы: любые функции, кроме запрещённых (`DM_CONSOLE_DENIED`):
 *   ожидание, блокировки, запрос из строки, запись в журнал, файлы сервера, другие базы, смена настроек,
 *   сигналы другим соединениям; системные таблицы читать можно;
 * - `template` — шаблоны и токены на них (блок 8 «Витрины данных» целиком): только функции из списка
 *   разрешённых (`DM_TEMPLATE_FUNCTIONS`), без системных таблиц `pg_*` и `information_schema`.
 * Общее: ровно один оператор, только SELECT (и WITH над SELECT), без записи (INSERT, UPDATE, DELETE,
 * MERGE, в том числе внутри WITH, и SELECT … INTO) и без блокировки строк (FOR UPDATE и подобные).
 * «Только чтение» по-прежнему держат и роли базы, и исполнитель: правила — первая преграда, не единственная.
 */

export type DmSqlMode = 'console' | 'template';

/** Почему текст не годится; `position` — место в тексте, с нуля (для подчёркивания, этап 1). */
export type DmSqlRuleProblem =
  | { code: 'syntax'; message: string; position: number }
  | { code: 'two_statements'; position: number }
  | { code: 'not_select'; position: number }
  | { code: 'write'; position: number }
  | { code: 'lock'; position: number }
  | { code: 'function'; name: string; position: number }
  | { code: 'system_table'; name: string; position: number };

/** Функции, которые консоли нельзя (имя без схемы, в нижнем регистре). */
export const DM_CONSOLE_DENIED: readonly string[] = [
  // Ожидание.
  'pg_sleep',
  'pg_sleep_for',
  'pg_sleep_until',
  // Запрос, выполненный из строки.
  'query_to_xml',
  'query_to_xmlschema',
  'query_to_xml_and_xmlschema',
  'cursor_to_xml',
  'cursor_to_xmlschema',
  'table_to_xml',
  'table_to_xmlschema',
  'table_to_xml_and_xmlschema',
  'schema_to_xml',
  'schema_to_xmlschema',
  'schema_to_xml_and_xmlschema',
  'database_to_xml',
  'database_to_xmlschema',
  'database_to_xml_and_xmlschema',
  'ts_stat',
  // Запись в журнал базы и уведомления.
  'pg_logical_emit_message',
  'pg_notify',
  // Файлы сервера.
  'pg_read_file',
  'pg_read_binary_file',
  'pg_stat_file',
  'pg_current_logfile',
  // Смена настроек и состояния сервера.
  'set_config',
  'pg_reload_conf',
  'pg_rotate_logfile',
  'pg_switch_wal',
  'pg_create_restore_point',
  'pg_promote',
  'pg_wal_replay_pause',
  'pg_wal_replay_resume',
  'nextval',
  'setval',
  // Сигналы другим соединениям.
  'pg_cancel_backend',
  'pg_terminate_backend',
];

/** Начала имён, которые консоли нельзя: блокировки, файлы, другие базы, большие объекты, слоты. */
export const DM_CONSOLE_DENIED_PREFIXES: readonly string[] = [
  'pg_advisory',
  'pg_try_advisory',
  'pg_ls_',
  'pg_file_',
  'dblink',
  'lo_',
  'crosstab',
  'connectby',
  'pg_stat_reset',
  'pg_replication_',
  'pg_create_logical_',
  'pg_create_physical_',
  'pg_drop_replication_',
  'pg_logical_slot_',
  'pg_copy_',
  'pg_backup_',
  'pg_log_backend',
  'pg_import_',
];

/** Схемы, функции которых консоли не вызвать: служебные функции продукта и исполнителя «Витрины». */
const DENIED_SCHEMAS = new Set(['app', 'dm']);

/**
 * Функции шаблонов и токенов (имя без схемы `pg_catalog`): всё, что берут 18 готовых шаблонов, и
 * обычные функции отчётов — агрегаты, окна, даты, строки, числа, JSON, массивы. Не хватает функции
 * опубликованному шаблону — список расширяется, шаблон не трогают (блок 2, пункт 7).
 */
export const DM_TEMPLATE_FUNCTIONS: readonly string[] = [
  // Агрегаты.
  'count',
  'sum',
  'avg',
  'min',
  'max',
  'string_agg',
  'array_agg',
  'bool_and',
  'bool_or',
  'every',
  'json_agg',
  'jsonb_agg',
  'json_object_agg',
  'jsonb_object_agg',
  'percentile_cont',
  'percentile_disc',
  'mode',
  'stddev',
  'stddev_pop',
  'stddev_samp',
  'variance',
  'var_pop',
  'var_samp',
  // Окна.
  'row_number',
  'rank',
  'dense_rank',
  'percent_rank',
  'cume_dist',
  'ntile',
  'lag',
  'lead',
  'first_value',
  'last_value',
  'nth_value',
  // Даты и время.
  'date_trunc',
  'date_part',
  'extract',
  'make_date',
  'make_time',
  'make_timestamp',
  'make_timestamptz',
  'make_interval',
  'age',
  'now',
  'clock_timestamp',
  'statement_timestamp',
  'transaction_timestamp',
  'timezone',
  'to_char',
  'to_date',
  'to_timestamp',
  'to_number',
  'generate_series',
  'date_bin',
  'justify_days',
  'justify_hours',
  'justify_interval',
  'isfinite',
  'overlaps',
  // Строки.
  'lower',
  'upper',
  'initcap',
  'length',
  'char_length',
  'character_length',
  'octet_length',
  'trim',
  'btrim',
  'ltrim',
  'rtrim',
  'substr',
  'substring',
  'left',
  'right',
  'lpad',
  'rpad',
  'replace',
  'translate',
  'split_part',
  'strpos',
  'position',
  'concat',
  'concat_ws',
  'format',
  'repeat',
  'reverse',
  'starts_with',
  'regexp_replace',
  'regexp_match',
  'regexp_matches',
  'regexp_like',
  'regexp_count',
  'regexp_substr',
  'regexp_split_to_array',
  'regexp_split_to_table',
  'string_to_array',
  'array_to_string',
  'md5',
  'chr',
  'ascii',
  'quote_literal',
  'quote_ident',
  'normalize',
  'overlay',
  // Числа.
  'round',
  'trunc',
  'floor',
  'ceil',
  'ceiling',
  'abs',
  'sign',
  'mod',
  'div',
  'power',
  'sqrt',
  'exp',
  'ln',
  'log',
  'greatest',
  'least',
  'width_bucket',
  // JSON.
  'to_json',
  'to_jsonb',
  'row_to_json',
  'json_build_object',
  'jsonb_build_object',
  'json_build_array',
  'jsonb_build_array',
  'json_array_length',
  'jsonb_array_length',
  'json_array_elements',
  'jsonb_array_elements',
  'json_array_elements_text',
  'jsonb_array_elements_text',
  'json_each',
  'jsonb_each',
  'json_each_text',
  'jsonb_each_text',
  'json_object_keys',
  'jsonb_object_keys',
  'json_extract_path',
  'jsonb_extract_path',
  'json_extract_path_text',
  'jsonb_extract_path_text',
  'json_typeof',
  'jsonb_typeof',
  'jsonb_strip_nulls',
  'jsonb_path_query',
  'jsonb_path_query_first',
  'jsonb_path_exists',
  // Массивы.
  'unnest',
  'array_length',
  'array_position',
  'array_positions',
  'array_append',
  'array_prepend',
  'array_cat',
  'array_remove',
  'array_upper',
  'array_lower',
  'cardinality',
  // Прочее.
  'coalesce',
  'nullif',
  'num_nulls',
  'num_nonnulls',
];

const TEMPLATE_ALLOWED = new Set(DM_TEMPLATE_FUNCTIONS);
const CONSOLE_DENIED = new Set(DM_CONSOLE_DENIED);

/** Записи в дереве, которые меняют данные (и внутри WITH). */
const WRITE_NODES = new Set(['InsertStmt', 'UpdateStmt', 'DeleteStmt', 'MergeStmt', 'IntoClause']);

type Node = Record<string, unknown>;

const isObj = (v: unknown): v is Node => typeof v === 'object' && v !== null && !Array.isArray(v);

const locationOf = (n: unknown): number =>
  isObj(n) && typeof n.location === 'number' && n.location >= 0 ? n.location : 0;

/** Имя функции частями (`["pg_catalog", "extract"]`), в нижнем регистре, как его хранит PostgreSQL. */
function funcName(call: Node): string[] {
  const parts = Array.isArray(call.funcname) ? call.funcname : [];
  return parts.map((p) =>
    isObj(p) && isObj(p.String) && typeof p.String.sval === 'string' ? p.String.sval : '',
  );
}

/** Нельзя ли консоли функцию `parts`; да — её имя для сообщения. */
function consoleDenied(parts: readonly string[]): string | null {
  const name = parts[parts.length - 1] ?? '';
  const schema = parts.length > 1 ? parts[parts.length - 2]! : null;
  const full = parts.join('.');
  if (schema && DENIED_SCHEMAS.has(schema)) return full;
  if (CONSOLE_DENIED.has(name)) return full;
  if (DM_CONSOLE_DENIED_PREFIXES.some((p) => name.startsWith(p))) return full;
  return null;
}

/** Нет ли функции `parts` в списке шаблонов; нет — её имя для сообщения. */
function templateDenied(parts: readonly string[]): string | null {
  const name = parts[parts.length - 1] ?? '';
  const schema = parts.length > 1 ? parts[parts.length - 2]! : null;
  if (schema && schema !== 'pg_catalog') return parts.join('.');
  return TEMPLATE_ALLOWED.has(name) ? null : parts.join('.');
}

/** Системная таблица, которой шаблону нельзя: `pg_*` и схемы `pg_catalog`, `information_schema`. */
function systemTable(rv: Node): string | null {
  const rel = typeof rv.relname === 'string' ? rv.relname : '';
  const schema = typeof rv.schemaname === 'string' ? rv.schemaname : null;
  if (schema === 'pg_catalog' || schema === 'information_schema' || schema === 'pg_toast') {
    return `${schema}.${rel}`;
  }
  if (!schema && rel.startsWith('pg_')) return rel;
  return null;
}

/**
 * Запасная проверка без разборщика (worker на VPS собирается одним файлом без wasm): имя перед «(»,
 * которое консоли нельзя, — отказ; `FOR UPDATE` и подобные — отказ. Строже разборщика (слово в строке или
 * комментарии тоже отказ), зато ожидание и блокировки не пройдут и там, где разборщика нет.
 */
export function dmSqlDeniedWord(text: string): DmSqlRuleProblem | null {
  const call = /((?:"[^"]+"|[a-z_][a-z0-9_$]*)\s*\.\s*)?("[^"]+"|[a-z_][a-z0-9_$]*)\s*\(/gi;
  for (let m = call.exec(text); m; m = call.exec(text)) {
    const unq = (w: string) => (w.startsWith('"') ? w.slice(1, -1) : w.toLowerCase());
    const parts = m[1] ? [unq(m[1].replace(/\s*\.\s*$/, '').trim()), unq(m[2]!)] : [unq(m[2]!)];
    const name = consoleDenied(parts);
    if (name) return { code: 'function', name, position: m.index };
  }
  const lock = /\bfor\s+(?:no\s+key\s+)?(?:update|share|key\s+share)\b/i.exec(text);
  return lock ? { code: 'lock', position: lock.index } : null;
}

/**
 * Первая причина отказа по дереву разбора (`parsePgSql(...).tree`); null — годится. Ошибку разбора
 * (`syntax`) отдаёт вызывающий: дерева у неё нет.
 */
export function dmSqlRules(tree: unknown, mode: DmSqlMode): DmSqlRuleProblem | null {
  const stmts = isObj(tree) && Array.isArray(tree.stmts) ? tree.stmts : [];
  if (stmts.length !== 1) {
    const second = stmts[1];
    const at = isObj(second) && typeof second.stmt_location === 'number' ? second.stmt_location : 0;
    return stmts.length === 0
      ? { code: 'not_select', position: 0 }
      : { code: 'two_statements', position: at };
  }
  const raw = stmts[0];
  const stmt = isObj(raw) && isObj(raw.stmt) ? raw.stmt : {};
  if (!isObj(stmt.SelectStmt)) return { code: 'not_select', position: 0 };

  let found: DmSqlRuleProblem | null = null;
  const visit = (v: unknown): void => {
    if (found) return;
    if (Array.isArray(v)) {
      for (const x of v) visit(x);
      return;
    }
    if (!isObj(v)) return;
    for (const [key, val] of Object.entries(v)) {
      if (found) return;
      if (WRITE_NODES.has(key)) {
        found = { code: 'write', position: locationOf(val) };
        return;
      }
      if (key === 'SelectStmt' && isObj(val)) {
        if (isObj(val.intoClause)) {
          found = { code: 'write', position: 0 };
          return;
        }
        if (Array.isArray(val.lockingClause) && val.lockingClause.length > 0) {
          found = { code: 'lock', position: 0 };
          return;
        }
      }
      if (key === 'FuncCall' && isObj(val)) {
        const parts = funcName(val);
        const bad = mode === 'console' ? consoleDenied(parts) : templateDenied(parts);
        if (bad) {
          found = { code: 'function', name: bad, position: locationOf(val) };
          return;
        }
      }
      if (key === 'RangeVar' && isObj(val) && mode === 'template') {
        const sys = systemTable(val);
        if (sys) {
          found = { code: 'system_table', name: sys, position: locationOf(val) };
          return;
        }
      }
      visit(val);
    }
  };
  visit(stmt);
  return found;
}
