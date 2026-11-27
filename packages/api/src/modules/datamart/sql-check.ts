import { parsePgSql } from '@buhuchet/adapters/sql-parser';
import {
  dmQueryParseText,
  dmQueryProblem,
  dmRuleQueryProblem,
  dmSqlRules,
  type DmQueryProblem,
  type DmSqlMode,
  type DmSqlRuleProblem,
} from '@buhuchet/domain';

/**
 * Проверка текста запроса разборщиком PostgreSQL (доработки 27.11.2026: консоль запросов, блок 2,
 * пункты 5–8; этап 0, П2; docs/decisions.md п. О-68): консоль — `console`, шаблоны и токены — `template`.
 * Разбор — до транзакции и до места запуска: в базу ничего не уходит.
 */
export type DmRulesOutcome =
  | { ok: true }
  | { ok: false; problem: DmSqlRuleProblem }
  /** Разборщика нет (worker без wasm): решает вызывающий. */
  | { ok: false; unavailable: true; message: string };

/** Разобрать готовый текст (параметры уже `$n`) и проверить правилами вида. */
export async function dmCheckRules(text: string, mode: DmSqlMode): Promise<DmRulesOutcome> {
  const parsed = await parsePgSql(text);
  if (!parsed.ok) {
    if (parsed.unavailable) return { ok: false, unavailable: true, message: parsed.message };
    return {
      ok: false,
      problem: { code: 'syntax', message: parsed.message, position: parsed.position },
    };
  }
  const problem = dmSqlRules(parsed.tree, mode);
  return problem ? { ok: false, problem } : { ok: true };
}

/**
 * Что не так с текстом шаблона: проверка окна (`dmQueryProblem`), потом разборщик по правилам шаблонов
 * (список разрешённых функций, без системных таблиц, записи и блокировок). Разборщика нет — отказ
 * `syntax`: сохранить непроверенный текст нельзя (сайт разборщик загружает всегда).
 */
export async function dmTemplateSqlProblem(query: string): Promise<DmQueryProblem | null> {
  const first = dmQueryProblem(query);
  if (first) return first;
  const text = dmQueryParseText(query);
  if (text === null) return { code: 'parens' };
  const out = await dmCheckRules(text, 'template');
  if (out.ok) return null;
  if ('unavailable' in out) return { code: 'syntax', error: out.message };
  return dmRuleQueryProblem(out.problem);
}

/**
 * Опубликованный шаблон перед запуском («Вывод», токен, ночная проверка): то, что нельзя и консоли
 * (`console`: ожидание, блокировки, запрос из строки, запись) — отказ, как прежде отказывали слова
 * `FORBIDDEN`; функции не из списка шаблонов — пока только `onMiss` (строка журнала сервера): список
 * сверяется со всеми опубликованными шаблонами стенда и рабочего сайта, и шаблон не ломается (блок 2,
 * пункт 7; docs/decisions.md п. О-68). Разборщика нет (worker) — проверки нет: держат роли базы.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#О-102
export async function dmPublishedSqlProblem(
  text: string,
  onMiss: (miss: DmSqlRuleProblem | 'unavailable') => void,
): Promise<DmQueryProblem | null> {
  const parsed = await parsePgSql(text);
  if (!parsed.ok) {
    if (parsed.unavailable) {
      onMiss('unavailable');
      return null;
    }
    return { code: 'syntax', error: parsed.message };
  }
  const denied = dmSqlRules(parsed.tree, 'console');
  if (denied) return dmRuleQueryProblem(denied);
  const miss = dmSqlRules(parsed.tree, 'template');
  if (miss) onMiss(miss);
  return null;
}
