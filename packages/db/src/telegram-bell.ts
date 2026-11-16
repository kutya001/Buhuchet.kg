import { sql } from 'drizzle-orm';
import type { Tx } from './client';
import { orgSettings } from './schema';

/*
 * Колокольчик уведомлений (доработки 16.11.2026, блок 3; поток Т; стык «Положить уведомление» —
 * /mnt/project-files/stream-t/bell-contract.md): строки по расписанию, запись и чтение строк.
 */

/** Час напоминаний организации из контекста «ЧЧ:ММ» (`org_settings.digest_time`, по умолчанию 09:00). */
export async function bellDigestTime(tx: Tx): Promise<string> {
  const [row] = await tx
    .select({ at: sql<string>`to_char(${orgSettings.digestTime}, 'HH24:MI')` })
    .from(orgSettings);
  return row?.at ?? '09:00';
}

/** Строка колокольчика для записи (`putBell` модуля telegram API). */
export interface BellRowInput {
  userId: string;
  kind: string;
  event: string;
  targetKind: string | null;
  targetId: string | null;
  contractorId: string | null;
  need: string | null;
  text: string;
  eventKey: string;
}

/**
 * Положить строки в колокольчик организации из контекста (у администратора платформы — без организации):
 * в транзакции действия; строка с тем же ключом события у того же человека второй раз не кладётся.
 * Число добавленных — по счёту строк, без RETURNING: чужие строки RLS вошедшему не показывает.
 */
export async function insertBellRows(
  tx: Tx,
  rows: readonly BellRowInput[],
  now: Date,
): Promise<number> {
  if (!rows.length) return 0;
  const json = JSON.stringify(
    rows.map((r) => ({
      user_id: r.userId,
      kind: r.kind,
      event: r.event,
      target_kind: r.targetKind,
      target_id: r.targetId,
      contractor_id: r.contractorId,
      need: r.need,
      text: r.text,
      event_key: r.eventKey,
    })),
  );
  const res = await tx.execute(sql`
    insert into bell_notifications
      (org_id, user_id, kind, event, target_kind, target_id, contractor_id, need, text, created_at, event_key)
    select app.current_org_id(), r.user_id, r.kind, r.event, r.target_kind, r.target_id,
      r.contractor_id, r.need, r.text, ${now.toISOString()}::timestamptz, r.event_key
    from jsonb_to_recordset(${json}::jsonb) as r(user_id uuid, kind text, event text,
      target_kind text, target_id text, contractor_id uuid, need text, text text, event_key text)
    on conflict (user_id, event_key) do nothing`);
  return res.count ?? 0;
}
