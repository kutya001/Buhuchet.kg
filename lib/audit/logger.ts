import { createAdminClient } from '@/lib/supabase/server';

export interface AuditLogPayload {
  action: string;
  entityType: string;
  entityId: string;
  actorUserId?: string | null;
  companyId?: string | null;
  oldValues?: Record<string, any> | null;
  newValues?: Record<string, any> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Серверная запись события в неизменяемый журнал аудита audit_logs
 */
export async function logAuditEvent(payload: AuditLogPayload): Promise<void> {
  try {
    const adminSupabase = await createAdminClient();
    await adminSupabase.from('audit_logs').insert({
      action: payload.action,
      entity_type: payload.entityType,
      entity_id: payload.entityId,
      actor_user_id: payload.actorUserId || null,
      company_id: payload.companyId || null,
      old_values: payload.oldValues || null,
      new_values: payload.newValues || null,
      ip_address: payload.ipAddress || null,
      user_agent: payload.userAgent || null,
    });
  } catch (err) {
    console.error('[Audit Log Error]: Failed to write audit event', err);
  }
}
