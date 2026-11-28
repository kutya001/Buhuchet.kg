import { sql } from 'drizzle-orm';
import { withUserContext } from './auth';
import type { Db } from './client';

/**
 * Карта базы для подсказок консоли «Витрины данных» (доработки 27.11.2026: консоль запросов, блок 3;
 * этап 0, П3): таблицы и поля — из самой базы, ровно то, что может прочитать роль шаблонов Админки
 * (`buhuchet_dm_admin`): закрытые таблицы и секретные поля (`DM_CLOSED_TABLES`, `DM_SECRET_COLUMNS`)
 * не попадают. Названия и описания добавляет API из схемы прототипа (`techdocs`).
 *
 * Связь поля — внешний ключ из одного столбца или составной «поле + `org_id`» (так связаны записи
 * организации: `(contractor_id, org_id) → contractors(id, org_id)`); без второго вида «Собрать запрос»
 * (этап 2, П9) не видел связей отчётов, денег и задач с контрагентом.
 */
export interface DmSchemaColumnRow {
  table: string;
  column: string;
  type: string;
  /** Открыта ли таблица роли организаций (хоть одно поле). */
  orgVisible: boolean;
  /** Открыто ли само поле роли организаций (этап 2, П7). */
  orgField: boolean;
  refTable: string | null;
  refColumn: string | null;
}

export async function dmSchemaColumns(db: Db, adminUserId: string): Promise<DmSchemaColumnRow[]> {
  const rows = await withUserContext(db, adminUserId, (tx) =>
    tx.execute<{
      table: string;
      column: string;
      type: string;
      org_visible: boolean;
      org_field: boolean;
      ref_table: string | null;
      ref_column: string | null;
    }>(sql`
      select c.relname as "table", a.attname as "column",
        pg_catalog.format_type(a.atttypid, a.atttypmod) as type,
        has_any_column_privilege('buhuchet_dm_org', c.oid, 'SELECT') as org_visible,
        has_column_privilege('buhuchet_dm_org', c.oid, a.attnum, 'SELECT') as org_field,
        fk.ref_table, fk.ref_column
      from pg_catalog.pg_class c
      join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      left join lateral (
        select rc.relname as ref_table, ra.attname as ref_column
        from pg_catalog.pg_constraint k
        join pg_catalog.pg_class rc on rc.oid = k.confrelid
        cross join lateral unnest(k.conkey, k.confkey) as p(src, dst)
        join pg_catalog.pg_attribute ra on ra.attrelid = k.confrelid and ra.attnum = p.dst
        where k.conrelid = c.oid and k.contype = 'f' and p.src = a.attnum
          and not exists (
            select 1 from unnest(k.conkey) as o(n)
            join pg_catalog.pg_attribute oa on oa.attrelid = c.oid and oa.attnum = o.n
            where o.n <> a.attnum and oa.attname <> 'org_id'
          )
        order by cardinality(k.conkey), k.conname
        limit 1
      ) fk on true
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v')
        and has_column_privilege('buhuchet_dm_admin', c.oid, a.attnum, 'SELECT')
      order by c.relname, a.attnum`),
  );
  return rows.map((r) => ({
    table: r.table,
    column: r.column,
    type: r.type,
    orgVisible: r.org_visible,
    orgField: r.org_field,
    refTable: r.ref_table,
    refColumn: r.ref_column,
  }));
}
