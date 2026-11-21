import { TPL_HINT, TPL_HINT_ADMIN } from './tpl-admin-model';

/*
 * Подсветка синтаксиса SQL в окне шаблона «Витрины данных» (просьба заказчика 21.11.2026; прототип v161
 * `modules/vitrina.js` `dmHl`, `DM_KW`): ключевые слова, таблицы базы, параметры `:имя`, строки, числа
 * и комментарии — своим цветом. Только вид поля: проверку запроса делает сервер (разборщик SQL и роль
 * базы только для чтения), подсветка её не заменяет и ничего не решает.
 */

/** Чем окрашен кусок запроса; `plain` — обычный текст. */
export type SqlTokenKind =
  'plain' | 'keyword' | 'table' | 'param' | 'string' | 'number' | 'comment';

export interface SqlToken {
  kind: SqlTokenKind;
  text: string;
}

/** Слова SQL, которые подсвечиваются как ключевые (прототип `DM_KW`). */
const KEYWORDS: ReadonlySet<string> = new Set(
  (
    'select from where and or not in is null as on join left right inner outer full cross group by order having limit offset distinct case when then else end ' +
    'with recursive union all exists between like ilike asc desc nulls first last over partition filter cast true false interval lateral using any some array ' +
    'sum count avg min max coalesce nullif greatest least extract date_trunc to_char round abs floor ceil now current_date row_number rank dense_rank lag lead string_agg array_agg ' +
    'date numeric int integer bigint text boolean varchar timestamp'
  ).split(' '),
);

/** Таблицы из подсказки «Таблицы и столбцы» окна шаблона — организации и администратора. */
const TABLES: ReadonlySet<string> = new Set(
  [...TPL_HINT, ...TPL_HINT_ADMIN].map(([name]) => name.toLowerCase()),
);

/**
 * Комментарий `--…` и блочный (незакрытый — до конца), строка в одинарных кавычках (незакрытая — до
 * конца), параметр `:имя` или приведение `::тип`, число, слово.
 */
const PARTS =
  /(--[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|('(?:[^']|'')*'?)|(::?[a-z_][a-z0-9_]*)|(\b\d+(?:\.\d+)?\b)|([a-z_][a-z0-9_]*)/gi;

/** Запрос кусками с видом каждого: куски подряд дают исходный текст без потерь. */
export function sqlTokens(sql: string): SqlToken[] {
  const out: SqlToken[] = [];
  const push = (kind: SqlTokenKind, text: string) => {
    if (text === '') return;
    const last = out[out.length - 1];
    if (last && last.kind === kind && kind === 'plain') last.text += text;
    else out.push({ kind, text });
  };
  let at = 0;
  for (const m of sql.matchAll(PARTS)) {
    const [text, comment, string, param, number, word] = m;
    push('plain', sql.slice(at, m.index));
    at = m.index + text.length;
    if (comment !== undefined) push('comment', text);
    else if (string !== undefined) push('string', text);
    // `::date` — приведение типа, как ключевое слово; `:month` — параметр шаблона.
    else if (param !== undefined) push(param.startsWith('::') ? 'keyword' : 'param', text);
    else if (number !== undefined) push('number', text);
    else if (word !== undefined) {
      const lower = word.toLowerCase();
      push(KEYWORDS.has(lower) ? 'keyword' : TABLES.has(lower) ? 'table' : 'plain', text);
    }
  }
  push('plain', sql.slice(at));
  return out;
}

/** Номера строк слева от запроса: «1\n2\n3» (прототип `dmLn`). */
export function sqlLineNumbers(sql: string): string {
  let lines = 1;
  for (let i = sql.indexOf('\n'); i !== -1; i = sql.indexOf('\n', i + 1)) lines++;
  return Array.from({ length: lines }, (_, i) => i + 1).join('\n');
}
