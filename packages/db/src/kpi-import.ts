import { auditActorName, KPI_IMPORT_FILE_MAX_LENGTH, type YearMonth } from '@buhuchet/domain';
import { desc, eq, sql } from 'drizzle-orm';
import type { Tx } from './client';
import { employees, indicatorImports } from './schema';

/*
 * «История загрузок» ввода показателей из Excel (задача 2.28; прототип `DB.indicatorImports`, `kxApply`,
 * `kxHistHtml`). Значения записывает `saveIndicatorValues` с пометкой «Из Excel» (`xlsx`) в истории.
 */

/** Пометка в истории значения: «Из Excel». */
export const KPI_IMPORT_REASON = 'xlsx';

export interface IndicatorImportRecord {
  id: string;
  at: Date;
  /** Кто загрузил — краткое ФИО. */
  actor: string | null;
  fileName: string;
  from: YearMonth | null;
  to: YearMonth | null;
  added: number;
  changed: number;
  errors: number;
  skippedChecked: number;
}

/** Имя файла для истории: без пути и управляющих символов, не длиннее предела (имя проверяет API). */
export function importFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const base = (name.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return [...(base || '-')].slice(0, KPI_IMPORT_FILE_MAX_LENGTH).join('');
}

/** Записать загрузку в «Историю загрузок» от имени текущего пользователя. */
export async function insertIndicatorImport(
  tx: Tx,
  rec: Omit<IndicatorImportRecord, 'id' | 'at' | 'actor'>,
): Promise<{ id: string; at: Date }> {
  const [row] = await tx
    .insert(indicatorImports)
    .values({
      orgId: sql`app.current_org_id()`,
      fileName: importFileName(rec.fileName),
      fromMonth: rec.from,
      toMonth: rec.to,
      added: rec.added,
      changed: rec.changed,
      errors: rec.errors,
      skippedChecked: rec.skippedChecked,
      createdBy: sql`app.current_user_id()`,
    })
    .returning({ id: indicatorImports.id, at: indicatorImports.createdAt });
  return row!;
}

/** «История загрузок»: последние 200, сначала новые. */
export async function listIndicatorImports(tx: Tx): Promise<IndicatorImportRecord[]> {
  const rows = await tx
    .select({
      id: indicatorImports.id,
      at: indicatorImports.createdAt,
      createdBy: indicatorImports.createdBy,
      shortName: employees.shortName,
      fileName: indicatorImports.fileName,
      from: indicatorImports.fromMonth,
      to: indicatorImports.toMonth,
      added: indicatorImports.added,
      changed: indicatorImports.changed,
      errors: indicatorImports.errors,
      skippedChecked: indicatorImports.skippedChecked,
    })
    .from(indicatorImports)
    .leftJoin(employees, eq(employees.userId, indicatorImports.createdBy))
    .orderBy(desc(indicatorImports.createdAt), desc(indicatorImports.id))
    .limit(200);
  return rows.map(({ createdBy, shortName, from, to, ...r }) => ({
    ...r,
    actor: auditActorName(createdBy, shortName),
    from: from as YearMonth | null,
    to: to as YearMonth | null,
  }));
}
