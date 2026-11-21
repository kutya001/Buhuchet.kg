/**
 * Редактор шаблонов «Витрины данных» в Админке (доработки 20.11.2026: Витрина данных, блок 2,
 * пункты 2–7; блок 3, пункт 1; общий план 20.11, этап 2, П3) — прототип v155 `modules/vitrina.js`:
 * `dmEdit`, `dmSqlErr`, `syncPars`, `dmCopy`, `dmStateDlg`. Что можно ввести в окно шаблона, какие
 * параметры и столбцы берутся из запроса и его ответа при «Проверить», что нельзя менять у
 * опубликованного и какое состояние разрешено следующим.
 */
import type { DM_COLUMN_TYPES, DM_TEMPLATE_STATES } from './datamart';
import { DM_PARAMS_MAX, dmParseSql, type DmParamDef, type DmParamType } from './query';

/** Код параметра и столбца: латиница в нижнем регистре, цифры и «_» (как готовые шаблоны refDB). */
export const DM_FIELD_RE = '^[a-z][a-z0-9_]{0,39}$';
const FIELD = new RegExp(DM_FIELD_RE);
/** Название параметра и столбца — до 100 знаков. */
export const DM_LABEL_MAX = 100;
/** Название шаблона — до 200 знаков, описание — до 2 000 (ограничение `dm_templates_fields_check`). */
export const DM_NAME_MAX = 200;
export const DM_DESCRIPTION_MAX = 2000;
/** Столбцов в шаблоне — не больше 100. */
export const DM_COLUMNS_MAX = 100;
/** Выбранных организаций шаблона — не больше 500. */
export const DM_ORGS_MAX = 500;
/** «Проверить» показывает первые 100 строк (блок 3, пункт 1). */
export const DM_CHECK_ROWS = 100;
/** Причина «Отключить» и «Включить» — до 500 знаков. */
export const DM_REASON_MAX = 500;
/** «Ещё одно право» шаблона (прототип `de-p`): «Не нужно» или «Видеть плату за обслуживание». */
export const DM_EXTRA_PERMISSIONS = ['fee'] as const;

export type DmTemplateStateCode = (typeof DM_TEMPLATE_STATES)[number];
export type DmColumnType = (typeof DM_COLUMN_TYPES)[number];

/**
 * Почему текст запроса не годится (прототип `dmSqlErr`; ключ словаря `dm.tpl.sql.<код>`): пусто; не
 * SELECT и не WITH; второй оператор; слово, которое шаблону не нужно (`word`). Разбор строк и
 * параметров — `dmParseSql`, само «только чтение» держат роли базы и исполнитель (блок 8, пункты 2–3).
 */
export type DmQueryProblem =
  | { code: 'empty' }
  | { code: 'not_select' }
  | { code: 'two_statements' }
  | { code: 'unclosed' }
  | { code: 'parens' }
  | { code: 'positional' }
  | { code: 'too_many_params' }
  | { code: 'forbidden'; word: string };

const FORBIDDEN =
  /\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|copy|call|vacuum|lock|set_config|pg_sleep|pg_read_file|pg_ls_dir|dblink|pg_catalog|information_schema)\b/i;

/** Текст без комментариев `--` и `/* *\/` — для проверки начала и слов (строки не трогаются). */
const withoutComments = (sql: string) =>
  sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');

/** Что не так с текстом запроса; null — годится (прототип `dmSqlErr`). */
export function dmQueryProblem(sql: string): DmQueryProblem | null {
  const s = withoutComments(sql).trim();
  if (!s) return { code: 'empty' };
  if (!/^(select|with)\b/i.test(s)) return { code: 'not_select' };
  const names = dmQueryParamNames(sql);
  if (!Array.isArray(names)) return names;
  const bad = FORBIDDEN.exec(s);
  return bad ? { code: 'forbidden', word: bad[1]!.toLowerCase() } : null;
}

/**
 * Параметры запроса по порядку появления (прототип `dmSqlPars`): `:month`, `:date_from`. Строки,
 * имена в кавычках, комментарии и `::тип` не считаются — разбор тот же, что у исполнителя
 * (`dmParseSql`).
 */
export function dmQueryParamNames(
  sql: string,
): string[] | Exclude<DmQueryProblem, { code: 'empty' | 'not_select' | 'forbidden' }> {
  const defs: DmParamDef[] = [];
  for (;;) {
    const parsed = dmParseSql(sql, defs);
    if (!('problem' in parsed)) return parsed.names;
    if (parsed.problem !== 'unknown_param') return { code: parsed.problem };
    if (defs.length >= DM_PARAMS_MAX) return { code: 'too_many_params' };
    defs.push({ k: parsed.name, type: 'text', req: false, def: null });
  }
}

/** Параметр шаблона в окне (как в базе `dm_templates.params`). */
export interface DmEditorParam {
  code: string;
  name: string;
  type: DmParamType;
  required: boolean;
  default: string | null;
}

/** Столбец шаблона в окне (как в базе `dm_templates.columns`). */
export interface DmEditorColumn {
  code: string;
  name: string;
  type: DmColumnType;
  total: boolean;
}

/** Тип нового параметра по имени (прототип `syncPars`): date → дата, month → месяц, year → год. */
const paramTypeOf = (code: string): DmParamType =>
  /date/.test(code) ? 'date' : /month/.test(code) ? 'month' : /year/.test(code) ? 'year' : 'text';

/**
 * Параметры после «Проверить» (прототип `syncPars`): по одному на `:имя` запроса, по порядку; у уже
 * заданных — прежние название, тип, «обязательный» и значение по умолчанию; новые — обязательные.
 */
export function dmSyncParams(
  names: readonly string[],
  current: readonly DmEditorParam[],
): DmEditorParam[] {
  return names.map(
    (code) =>
      current.find((p) => p.code === code) ?? {
        code,
        name: code,
        type: paramTypeOf(code),
        required: true,
        default: null,
      },
  );
}

/**
 * Столбцы после «Проверить» (прототип: столбцы из «AS» запроса): по одному на столбец ответа базы, по
 * порядку; у уже заданных — прежние название, тип и итог; `contractor_id` — «Контрагент (для
 * области)», остальные — текст.
 */
export function dmSyncColumns(
  names: readonly string[],
  current: readonly DmEditorColumn[],
): DmEditorColumn[] {
  return names.map(
    (code) =>
      current.find((c) => c.code === code) ?? {
        code,
        name: code,
        type: code === 'contractor_id' ? 'cp' : 'text',
        total: false,
      },
  );
}

/**
 * Что не так со столбцами ответа базы при «Проверить» (ключ словаря `dm.tpl.check.<код>`): столбцов
 * нет; имя не латиницей (`?column?`, «Сумма») — по нему строятся адрес и ответ внешней программе;
 * одно имя дважды; нужный столбец опубликованного шаблона пропал (блок 2, пункт 7).
 */
export type DmColumnsProblem =
  | { code: 'no_columns' }
  | { code: 'bad_name'; column: string }
  | { code: 'dup_name'; column: string }
  | { code: 'removed'; column: string };

export function dmResultColumnsProblem(
  names: readonly string[],
  published: readonly DmEditorColumn[] | null,
): DmColumnsProblem | null {
  if (names.length === 0) return { code: 'no_columns' };
  const seen = new Set<string>();
  for (const n of names) {
    if (!FIELD.test(n)) return { code: 'bad_name', column: n };
    if (seen.has(n)) return { code: 'dup_name', column: n };
    seen.add(n);
  }
  const gone = (published ?? []).find((c) => !seen.has(c.code));
  return gone ? { code: 'removed', column: gone.name } : null;
}

/**
 * Что мешает сохранить состав столбцов (блок 2, пункт 7): столбцов больше `DM_COLUMNS_MAX`, код дважды,
 * больше одного «Контрагента»; у опубликованного (и отключённого, и сломанного) шаблона прежний столбец
 * не убирается и код его не меняется — только добавить.
 */
export function dmColumnsProblem(
  columns: readonly DmEditorColumn[],
  published: readonly DmEditorColumn[] | null,
): DmColumnsProblem | { code: 'two_cp' } | { code: 'too_many' } | null {
  if (columns.length > DM_COLUMNS_MAX) return { code: 'too_many' };
  const codes = new Set<string>();
  for (const c of columns) {
    if (codes.has(c.code)) return { code: 'dup_name', column: c.code };
    codes.add(c.code);
  }
  if (columns.filter((c) => c.type === 'cp').length > 1) return { code: 'two_cp' };
  const gone = (published ?? []).find((c) => !codes.has(c.code));
  return gone ? { code: 'removed', column: gone.name } : null;
}

/** «Опубликован» в смысле правил правки: всё, кроме черновика (прототип `pub`). */
export const dmTemplatePublished = (state: DmTemplateStateCode): boolean => state !== 'draft';

/**
 * Можно ли «Отключить» или «Включить» (прототип меню строки и `dmStateDlg`): «Отключить» — не черновик и
 * не уже отключён; «Включить» — только отключённый. Опубликовать черновик — только окном шаблона после
 * проверки.
 */
export function dmStateChangeAllowed(from: DmTemplateStateCode, to: 'off' | 'published'): boolean {
  return to === 'off' ? from === 'published' || from === 'broken' : from === 'off';
}

/**
 * Код копии (прототип `dmCopy`): «<код>-copy», занят — «-copy2», «-copy3»… Не длиннее 60 знаков
 * (`DM_CODE_RE`): длинный код укорачивается перед «-copy».
 */
export function dmCopyCode(code: string, taken: ReadonlySet<string>): string {
  for (let i = 1; ; i += 1) {
    const tail = i === 1 ? '-copy' : `-copy${i}`;
    const base = code.slice(0, 60 - tail.length).replace(/-+$/, '');
    const next = `${base}${tail}`;
    if (!taken.has(next)) return next;
  }
}

/** Поля шаблона в истории «Изменено: …» (прототип `dmEdit` → `ch`), по порядку прототипа. */
export const DM_TEMPLATE_HISTORY_FIELDS = [
  'name',
  'code',
  'description',
  'audience',
  'query',
  'module',
  'needPermission',
  'access',
  'params',
  'columns',
] as const;
export type DmTemplateHistoryField = (typeof DM_TEMPLATE_HISTORY_FIELDS)[number];
