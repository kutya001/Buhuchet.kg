import type { ServicePeriod, YearMonth } from '@buhuchet/domain';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import type { Tx } from './client';
import { contractorServicePeriods } from './schema';

/** Период обслуживания из базы: с причиной приостановки, которая начинается после него. */
export interface ServicePeriodRow extends ServicePeriod {
  pauseReason: string;
}

/** «2026-10-01» → «2026-10». */
const monthOfDate = (d: string): YearMonth => d.slice(0, 7);
/** «2026-10» → «2026-10-01». */
export const dateOfMonth = (m: YearMonth) => `${m}-01`;

/** Периоды обслуживания контрагентов по порядку (нет периодов — пустой список). */
export async function servicePeriodsOf(
  tx: Tx,
  contractorIds: readonly string[],
): Promise<Map<string, ServicePeriodRow[]>> {
  const out = new Map<string, ServicePeriodRow[]>(contractorIds.map((id) => [id, []]));
  if (contractorIds.length === 0) return out;
  const rows: {
    contractorId: string;
    fromMonth: string;
    toMonth: string | null;
    pauseReason: string;
  }[] = [];
  // Пачками: у postgres.js не больше 65 535 параметров в запросе.
  const ids = [...new Set(contractorIds)];
  for (let i = 0; i < ids.length; i += 10_000) {
    rows.push(
      ...(await tx
        .select({
          contractorId: contractorServicePeriods.contractorId,
          fromMonth: contractorServicePeriods.fromMonth,
          toMonth: contractorServicePeriods.toMonth,
          pauseReason: contractorServicePeriods.pauseReason,
        })
        .from(contractorServicePeriods)
        .where(inArray(contractorServicePeriods.contractorId, ids.slice(i, i + 10_000)))
        .orderBy(
          asc(contractorServicePeriods.contractorId),
          asc(contractorServicePeriods.fromMonth),
        )),
    );
  }
  for (const r of rows) {
    out.get(r.contractorId)!.push({
      from: monthOfDate(r.fromMonth),
      to: r.toMonth ? monthOfDate(r.toMonth) : null,
      pauseReason: r.pauseReason,
    });
  }
  return out;
}

/**
 * Записать периоды контрагента целым набором (их собирают правила `@buhuchet/domain`). Причина
 * приостановки остаётся у закончившегося периода, пока он не продолжен.
 */
export async function writeServicePeriods(
  tx: Tx,
  orgId: string,
  contractorId: string,
  periods: readonly ServicePeriodRow[],
): Promise<void> {
  await tx
    .delete(contractorServicePeriods)
    .where(eq(contractorServicePeriods.contractorId, contractorId));
  if (periods.length === 0) return;
  await tx.insert(contractorServicePeriods).values(
    periods.map((p) => ({
      orgId,
      contractorId,
      fromMonth: dateOfMonth(p.from),
      toMonth: p.to ? dateOfMonth(p.to) : null,
      pauseReason: p.to ? p.pauseReason : '',
      createdBy: sql`app.current_user_id()`,
    })),
  );
}
