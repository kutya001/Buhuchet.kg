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
 *   4. `dm.run_org` / `dm.run_admin` выполняют запрос от роли Витрины подзапросом — только SELECT (без
 *      секретов, организация видит только свои строки, сроки по Бишкеку, ответ до 32 МБ) и отдают имена
 *      столбцов и строки массивами;
 *   5. транзакция всегда откатывается (зафиксировать её не даёт отложенный триггер `dm.runs`).
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

async function runInTx(
  tx: Tx,
  audience: 'org' | 'admin',
  q: DmQuery,
  maxTimeoutMs = DM_TIMEOUT_MS,
): Promise<never> {
  if (!Number.isInteger(q.maxRows) || q.maxRows < 1 || q.maxRows > DM_ROWS_MAX) {
    throw new RangeError(`dm: предел строк от 1 до ${DM_ROWS_MAX}`);
  }
  const timeout = Math.max(1, Math.min(q.timeoutMs ?? maxTimeoutMs, maxTimeoutMs));
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
 * Консоль запросов администратора платформы (доработки 27.11.2026: консоль запросов, блок 2, пункты 3–4;
 * этап 0, П2; миграция 0177): тот же путь, что у шаблона Админки (`dm.begin_admin`, «только чтение»,
 * `dm.run_admin` — роль `buhuchet_dm_admin` без секретов), но предел времени — 60 с, и соединение до
 * конца транзакции помечено меткой консоли этого администратора: по ней «Остановить»
 * (`cancelDmConsole`) находит запрос. Запрещённое консоли (ожидание, блокировки, запрос из строки)
 * отсекает разборщик до вызова.
 */
export const DM_CONSOLE_TIMEOUT_MS = QUERY_TIMEOUT_MS.export;

/** Метка соединения запуска консоли (`application_name`): по ней ищет `app.dm_console_cancel()`. */
export const dmConsoleTag = (adminUserId: string) => `buhuchet_dm_console:${adminUserId}`;

async function tagConsole(tx: Tx, adminUserId: string): Promise<void> {
  await tx.execute(sql`select set_config('application_name', ${dmConsoleTag(adminUserId)}, true)`);
}

/** Выполнить запрос консоли: до `maxRows` строк (на экран 1 000, в Excel 50 000), до 60 с. */
export function runDmConsole(db: Db, adminUserId: string, q: DmQuery): Promise<DmResult> {
  return rolledBack(() =>
    withUserContext(
      db,
      adminUserId,
      async (tx) => {
        await tagConsole(tx, adminUserId);
        return runInTx(tx, 'admin', q, DM_CONSOLE_TIMEOUT_MS);
      },
      'export',
    ),
  );
}

/** Ответ «Плана запроса» уносится из транзакции ошибкой — как ответ запуска. */
class DmPlanRolledBack extends Error {
  constructor(readonly plan: unknown) {
    super('dm: откат плана');
  }
}

/**
 * «План запроса» (блок 1, пункт 3): оценка запроса базой без выполнения (`dm.explain_admin`, EXPLAIN
 * без ANALYZE, формат JSON) — тем же подзапросом и ролью, что `runDmConsole`.
 */
export async function explainDmConsole(
  db: Db,
  adminUserId: string,
  q: Pick<DmQuery, 'text' | 'params'>,
): Promise<unknown> {
  try {
    await withUserContext(
      db,
      adminUserId,
      async (tx) => {
        await tagConsole(tx, adminUserId);
        await tx.execute(sql`select dm.begin_admin()`);
        await tx.execute(
          sql`select set_config('transaction_read_only', 'on', true), set_config('statement_timeout', ${String(DM_TIMEOUT_MS)}, true)`,
        );
        const [row] = await tx.execute<{ plan: unknown }>(
          sql`select dm.explain_admin(${q.text}, ${JSON.stringify(q.params)}::jsonb) as plan`,
        );
        throw new DmPlanRolledBack(row!.plan);
      },
      'export',
    );
  } catch (e) {
    if (e instanceof DmPlanRolledBack) return e.plan;
    throw e;
  }
  /* v8 ignore next */
  throw new Error('dm: план без ответа');
}

/**
 * «Остановить» (блок 2, пункт 3): отменить идущий запрос консоли этого администратора — только свой
 * (`app.dm_console_cancel` ищет соединение по метке `dmConsoleTag`). Ответ — сколько запросов отменено.
 */
export async function cancelDmConsole(db: Db, adminUserId: string): Promise<number> {
  const [row] = await withUserContext(db, adminUserId, (tx) =>
    tx.execute<{ n: number }>(sql`select app.dm_console_cancel() as n`),
  );
  return Number(row?.n ?? 0);
}

/** Строки журнала консоли старше года (история платформы, `dm_console`): задача по расписанию. */
export async function cleanupDmConsoleLog(db: Db): Promise<number> {
  const [row] = await db.execute<{ n: number }>(sql`select app.dm_console_log_cleanup() as n`);
  return Number(row?.n ?? 0);
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
