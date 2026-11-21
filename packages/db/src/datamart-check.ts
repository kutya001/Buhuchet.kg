import { asc, eq, sql } from 'drizzle-orm';
import type { Db, Tx } from './client';
import type { DmTemplateColumn, DmTemplateParam } from './datamart-output';
import { dmTemplates } from './schema';

/*
 * Проверка шаблонов «Витрины данных» системой (доработки 20.11.2026: Витрина данных, блок 8, пункт 7;
 * общий план 20.11, этап 2, П4; миграции 0172–0173, docs/decisions.md п. О-66): после выпуска с
 * миграциями и каждую ночь каждый опубликованный и сломанный шаблон запускается — шаблон организаций на
 * демо-организации, шаблон Админки от имени администратора платформы. Список и итог — функции базы
 * `app.dm_check_due`, `app.dm_check_mark` (только задаче по расписанию: на пуле, без контекста).
 */

/** Шаблон, который пора проверить. */
export interface DmCheckItem {
  id: string;
  code: string;
  name: string;
  audience: 'org' | 'admin';
  state: 'published' | 'broken';
  version: number;
  query: string;
  params: DmTemplateParam[];
  columns: DmTemplateColumn[];
}

/** Что проверить и на чём: число применённых миграций, демо-организация, администратор платформы. */
export interface DmCheckDue {
  schema: number;
  demoOrgId: string | null;
  adminId: string | null;
  items: DmCheckItem[];
}

/**
 * Шаблоны, не проверенные системой с `since` (последняя ночная проверка) или при другом числе миграций
 * (был выпуск), — не больше `limit`, сначала давно не проверенные.
 */
export async function dmCheckDue(db: Db, since: Date, limit: number): Promise<DmCheckDue> {
  const [row] = await db.execute<{ r: Record<string, unknown> }>(
    sql`select app.dm_check_due(${since.toISOString()}::timestamptz, ${limit}::integer) as r`,
  );
  const r = row?.r ?? {};
  const id = (v: unknown) => (typeof v === 'string' ? v : null);
  return {
    schema: Number(r.schema ?? 0),
    demoOrgId: id(r.demo),
    adminId: id(r.admin),
    items: Array.isArray(r.items) ? (r.items as DmCheckItem[]) : [],
  };
}

/** Итог проверки: новое состояние, «то же» или «пропущен» (шаблон изменили или отключили). */
export type DmCheckMarked = 'broken' | 'published' | 'same' | 'skip';

export async function dmCheckMark(
  db: Db,
  m: {
    id: string;
    version: number;
    ok: boolean;
    error: string | null;
    orgId: string | null;
    schema: number;
    now: Date;
  },
): Promise<DmCheckMarked> {
  const [row] = await db.execute<{ r: string }>(
    sql`select app.dm_check_mark(${m.id}::uuid, ${m.version}::integer, ${m.ok}, ${m.error}, ${m.orgId}::uuid, ${m.schema}::integer, ${m.now.toISOString()}::timestamptz) as r`,
  );
  const r = row?.r;
  return r === 'broken' || r === 'published' || r === 'same' ? r : 'skip';
}

/** Сломанные шаблоны — для колокольчика администратора платформы (в его `withUserContext`). */
export function dmBrokenTemplates(tx: Tx) {
  return tx
    .select({ id: dmTemplates.id, name: dmTemplates.name, version: dmTemplates.version })
    .from(dmTemplates)
    .where(eq(dmTemplates.state, 'broken'))
    .orderBy(asc(dmTemplates.code));
}
