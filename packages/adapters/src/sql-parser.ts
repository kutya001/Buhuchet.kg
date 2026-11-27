import { createRequire } from 'node:module';

/**
 * Разборщик SQL самого PostgreSQL (libpg_query, грамматика PostgreSQL 17, собрана в WebAssembly) —
 * консоль запросов «Витрины данных» и проверка текста шаблонов (доработки 27.11.2026: консоль запросов,
 * блок 2, пункт 5; этап 0, П2; docs/decisions.md п. О-68). Отдаёт дерево разбора как есть (JSON); что в
 * нём разрешено — правила `dmSqlRules` из `@buhuchet/domain`. Запрос не выполняется и в базу не уходит.
 *
 * Модуль грузится при первом вызове (около 1 МБ). Где файла `libpg-query.wasm` нет (worker — один файл
 * без node_modules), ответ — `unavailable`: вызывающий решает сам, отказать или обойтись без разбора.
 */

export type PgParseResult =
  | { ok: true; tree: unknown }
  | { ok: false; unavailable?: false; message: string; position: number }
  | { ok: false; unavailable: true; message: string; position: null };

interface PgQueryModule {
  loadModule(): Promise<void>;
  parseSync(query: string): unknown;
}

let loading: Promise<PgQueryModule> | null = null;

function load(): Promise<PgQueryModule> {
  if (!loading) {
    loading = (async () => {
      // CommonJS-вход пакета: ESM-вход ищет wasm через import.meta.url, а сборка Next.js его переносит.
      const require = createRequire(import.meta.url);
      const mod = require('libpg-query') as PgQueryModule;
      await mod.loadModule();
      return mod;
    })();
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

/** Позиция ошибки разбора в тексте (с нуля); неизвестна — 0. */
function positionOf(err: unknown): number {
  const d = (err as { sqlDetails?: { cursorPosition?: unknown } }).sqlDetails;
  return typeof d?.cursorPosition === 'number' && d.cursorPosition >= 0 ? d.cursorPosition : 0;
}

/** Разобрать текст: дерево или текст ошибки разбора PostgreSQL с позицией. */
export async function parsePgSql(text: string): Promise<PgParseResult> {
  let mod: PgQueryModule;
  try {
    mod = await load();
  } catch (err) {
    return {
      ok: false,
      unavailable: true,
      message: err instanceof Error ? err.message : String(err),
      position: null,
    };
  }
  try {
    return { ok: true, tree: mod.parseSync(text) };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      position: positionOf(err),
    };
  }
}
