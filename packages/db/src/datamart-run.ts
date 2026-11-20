import { sql } from 'drizzle-orm';
import { withUserContext } from './auth';
import type { Db, Tx } from './client';
import { QUERY_TIMEOUT_MS, withOrgContext } from './context';

/**
 * Исполнитель запросов «Витрины данных» (доработки 20.11.2026: Витрина данных, блок 8; миграция 0166,
 * docs/decisions.md п. О-62). Путь одного запроса — один и тот же из «Вывода», «Проверить» и по токену:
 *   1. своя транзакция (`withOrgContext` организации или `withUserContext` администратора платформы):
 *      организация — из сеанса или токена, а не из параметров запроса;
 *   2. `dm.begin_org()` / `dm.begin_admin()` записывают запуск этой транзакции;
 *   3. транзакция становится «только чтение», предел времени — не больше 15 с;
 *   4. `dm.run_org` / `dm.run_admin` выполняют запрос от роли Витрины (без секретов, организация видит
 *      только свои строки, сроки по Бишкеку) и отдают имена столбцов и строки массивами;
 *   5. транзакция всегда откатывается.
 * Запрос и параметры готовит `dmBind` из `@buhuchet/domain` (`:month` → `($1::text)`); проверку шаблона
 * (опубликован, не сломан), право и область, токен, «Внешний доступ по API», частоту и журнал делает
 * вызывающий — этапы 1–3.
 */

/** Предел строк результата (блок 4, пункт 3): больше — показаны первые 50 000 и уведомление. */
export const DM_ROWS_MAX = 50_000;
/** Предел времени запроса (блок 4, пункт 3): дольше — «Запрос выполнялся слишком долго». */
export const DM_TIMEOUT_MS = QUERY_TIMEOUT_MS.request;

export interface DmQuery {
  /** Один оператор SELECT с параметрами `$1…$20` (после `dmBind`). */
  text: string;
  /** Значения `$1…$20` текстом; приводит к типу сам запрос. */
  params: readonly (string | null)[];
  /** Сколько строк отдать, 1…50 000. */
  maxRows: number;
  /** Предел времени, мс: не больше `DM_TIMEOUT_MS` (тесты и «Проверить» могут меньше). */
  timeoutMs?: number;
}

export interface DmResult {
  /**
   * Имена столбцов в порядке запроса — и у пустого результата («Проверить», блок 2, пункт 5); одинаковых
   * имён нет (база отклоняет такой запрос).
   */
  columns: string[];
  /** Строки в порядке запроса: значения по порядку `columns`, как их отдал `row_to_json` (деньги — тыйыны). */
  rows: unknown[][];
  /** Строк больше `maxRows`: отданы первые. */
  more: boolean;
  /** Время выполнения запроса, мс. */
  ms: number;
}

/** Ответ запуска уносится из транзакции ошибкой: так транзакция откатывается и строка запуска не остаётся. */
class DmRolledBack extends Error {
  constructor(readonly result: DmResult) {
    super('dm: откат запуска');
  }
}

async function runInTx(tx: Tx, audience: 'org' | 'admin', q: DmQuery): Promise<never> {
  if (!Number.isInteger(q.maxRows) || q.maxRows < 1 || q.maxRows > DM_ROWS_MAX) {
    throw new RangeError(`dm: предел строк от 1 до ${DM_ROWS_MAX}`);
  }
  const timeout = Math.max(1, Math.min(q.timeoutMs ?? DM_TIMEOUT_MS, DM_TIMEOUT_MS));
  await tx.execute(audience === 'org' ? sql`select dm.begin_org()` : sql`select dm.begin_admin()`);
  await tx.execute(
    sql`select set_config('transaction_read_only', 'on', true), set_config('statement_timeout', ${String(timeout)}, true)`,
  );
  const params = JSON.stringify(q.params);
  const started = performance.now();
  const [row] = await tx.execute<{ out: { columns: string[]; rows: unknown[][] } }>(
    audience === 'org'
      ? sql`select dm.run_org(${q.text}, ${params}::jsonb, ${q.maxRows}) as out`
      : sql`select dm.run_admin(${q.text}, ${params}::jsonb, ${q.maxRows}) as out`,
  );
  const ms = Math.round(performance.now() - started);
  const all = row!.out.rows;
  throw new DmRolledBack({
    columns: row!.out.columns,
    rows: all.slice(0, q.maxRows),
    more: all.length > q.maxRows,
    ms,
  });
}

async function rolledBack(run: () => Promise<never>): Promise<DmResult> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof DmRolledBack) return e.result;
    throw e;
  }
}

/**
 * Запрос шаблона организации: организация и сотрудник — из сеанса или токена (`ctx`). Ошибка запроса
 * (нет таблицы, нет права, предел времени — `queryTimedOut`) приходит ошибкой базы: её код и текст —
 * `dmErrorOf`.
 */
export function runDmOrg(
  db: Db,
  ctx: { orgId: string; userId?: string | null },
  q: DmQuery,
): Promise<DmResult> {
  return rolledBack(() =>
    withOrgContext(db, { orgId: ctx.orgId, userId: ctx.userId ?? null }, (tx) =>
      runInTx(tx, 'org', q),
    ),
  );
}

/** Запрос шаблона Админки: только администратор платформы (`dm.begin_admin` проверяет сам). */
export function runDmAdmin(db: Db, adminUserId: string, q: DmQuery): Promise<DmResult> {
  return rolledBack(() => withUserContext(db, adminUserId, (tx) => runInTx(tx, 'admin', q)));
}

/**
 * Код и текст ошибки базы (блок 3, «Проверить»: «ошибка запроса показывается текстом базы» — только
 * администратору платформы; организации — «Шаблон временно не работает»). Не ошибка базы — null.
 */
export function dmErrorOf(error: unknown): { code: string; message: string } | null {
  for (let e: unknown = error; e && typeof e === 'object'; e = (e as { cause?: unknown }).cause) {
    const pg = e as { code?: unknown; message?: unknown; severity?: unknown };
    if (typeof pg.code === 'string' && /^[0-9A-Z]{5}$/.test(pg.code) && pg.severity !== undefined) {
      return { code: pg.code, message: typeof pg.message === 'string' ? pg.message : '' };
    }
  }
  return null;
}
