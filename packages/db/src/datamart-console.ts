import { RecordChangedError, RecordNotFoundError, type HistoryChange } from '@buhuchet/domain';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Tx } from './client';
import { dmConsoleQueries, platformAuditLog } from './schema';

/*
 * «Мои запросы» и «История» консоли запросов Витрины (доработки 27.11.2026: консоль запросов, блок 4,
 * пункт 2; этап 1, П4; docs/decisions.md п. О-69). Только внутри `withUserContext` администратора
 * платформы: таблицу `dm_console_queries` RLS открывает лишь автору (миграция 0177), журнал консоли —
 * история платформы (`entity = 'dm_console'`), «История» берёт из него только свои запуски.
 */

export interface DmConsoleQueryRow {
  id: string;
  name: string;
  query: string;
  params: Record<string, string | null>;
  updatedAt: string;
  version: number;
}

const columns = {
  id: dmConsoleQueries.id,
  name: dmConsoleQueries.name,
  query: dmConsoleQueries.query,
  params: dmConsoleQueries.params,
  updatedAt: dmConsoleQueries.updatedAt,
  version: dmConsoleQueries.version,
};

const rowOf = (r: {
  id: string;
  name: string;
  query: string;
  params: unknown;
  updatedAt: Date;
  version: number;
}): DmConsoleQueryRow => ({
  ...r,
  params: (r.params ?? {}) as Record<string, string | null>,
  updatedAt: r.updatedAt.toISOString(),
});

/** Свои запросы, последние изменённые — сверху. */
export async function listDmConsoleQueries(tx: Tx): Promise<DmConsoleQueryRow[]> {
  const rows = await tx
    .select(columns)
    .from(dmConsoleQueries)
    .orderBy(desc(dmConsoleQueries.updatedAt), desc(dmConsoleQueries.id));
  return rows.map(rowOf);
}

export interface DmConsoleQueryInput {
  name: string;
  query: string;
  params: Record<string, string | null>;
}

/** «Сохранить в Мои запросы»: автор — из контекста транзакции. */
export async function createDmConsoleQuery(
  tx: Tx,
  v: DmConsoleQueryInput,
): Promise<DmConsoleQueryRow> {
  const [row] = await tx
    .insert(dmConsoleQueries)
    .values({ name: v.name.trim(), query: v.query, params: v.params })
    .returning(columns);
  return rowOf(row!);
}

/** Изменить свой запрос с версией: чужой и удалённый — нет записи, устаревшая версия — 409. */
export async function updateDmConsoleQuery(
  tx: Tx,
  id: string,
  v: DmConsoleQueryInput & { version: number },
): Promise<DmConsoleQueryRow> {
  const [row] = await tx
    .update(dmConsoleQueries)
    .set({
      name: v.name.trim(),
      query: v.query,
      params: v.params,
      updatedAt: sql`now()`,
      version: sql`${dmConsoleQueries.version} + 1`,
    })
    .where(and(eq(dmConsoleQueries.id, id), eq(dmConsoleQueries.version, v.version)))
    .returning(columns);
  if (row) return rowOf(row);
  throw await missingOrChanged(tx, id);
}

/** Удалить свой запрос с версией. */
export async function deleteDmConsoleQuery(tx: Tx, id: string, version: number): Promise<void> {
  const gone = await tx
    .delete(dmConsoleQueries)
    .where(and(eq(dmConsoleQueries.id, id), eq(dmConsoleQueries.version, version)))
    .returning({ id: dmConsoleQueries.id });
  if (!gone.length) throw await missingOrChanged(tx, id);
}

async function missingOrChanged(tx: Tx, id: string): Promise<Error> {
  const [cur] = await tx
    .select({ version: dmConsoleQueries.version })
    .from(dmConsoleQueries)
    .where(eq(dmConsoleQueries.id, id));
  return cur
    ? new RecordChangedError('dm_console_query', id, cur.version)
    : new RecordNotFoundError('dm_console_query', id);
}

export interface DmConsoleRunRow {
  id: number;
  at: string;
  action: 'dm_console_run' | 'dm_console_export';
  query: string;
  params: Record<string, string | null>;
  outcome: 'ok' | 'error' | 'timeout' | 'stopped' | 'refused';
  rows: number | null;
  ms: number | null;
  error: string | null;
}

const OUTCOMES = ['ok', 'error', 'timeout', 'stopped', 'refused'] as const;

/** «История»: свои последние запуски консоли из журнала (новые — сверху). */
export async function dmConsoleHistory(tx: Tx, limit: number): Promise<DmConsoleRunRow[]> {
  const rows = await tx
    .select({
      id: platformAuditLog.id,
      at: platformAuditLog.at,
      action: platformAuditLog.action,
      changes: platformAuditLog.changes,
    })
    .from(platformAuditLog)
    .where(
      and(
        eq(platformAuditLog.entity, 'dm_console'),
        sql`${platformAuditLog.actorUserId} = app.current_user_id()`,
      ),
    )
    .orderBy(desc(platformAuditLog.at), desc(platformAuditLog.id))
    .limit(limit);
  return rows.map((r) => {
    const get = (field: string) =>
      (r.changes as HistoryChange[]).find((c) => c.field === field)?.to;
    const outcome = get('outcome');
    const num = (v: unknown) =>
      typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
    const params = get('params');
    return {
      id: r.id,
      at: r.at.toISOString(),
      action: r.action === 'dm_console_export' ? 'dm_console_export' : 'dm_console_run',
      query: typeof get('query') === 'string' ? (get('query') as string) : '',
      params:
        params && typeof params === 'object' && !Array.isArray(params)
          ? (params as Record<string, string | null>)
          : {},
      outcome: OUTCOMES.includes(outcome as (typeof OUTCOMES)[number])
        ? (outcome as DmConsoleRunRow['outcome'])
        : 'error',
      rows: num(get('rows')),
      ms: num(get('ms')),
      error: typeof get('error') === 'string' ? (get('error') as string) : null,
    };
  });
}
