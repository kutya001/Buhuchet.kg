import {
  auditActorName,
  FEATURES,
  PAGE_SECTIONS,
  type Feature,
  type HistoryAction,
  type HistoryChange,
  type OrgPolicy,
  type PageSection,
} from '@buhuchet/domain';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Tx } from './client';
import { auditLog, employees, organizations, orgSettings } from './schema';
import type { AuditRecord } from './staff';

/**
 * Модуль «Моя организация»: «Основное» (таблица organizations) и учётная политика с настройками
 * (org_settings) организации из контекста `withOrgContext` (RLS). Меняются через `updateWithHistory`.
 */

export interface OrgProfileRecord {
  id: string;
  name: string;
  inn: string | null;
  address: string | null;
  phone: string | null;
  head: string | null;
  slug: string;
  /** Ключ логотипа в хранилище; наружу не отдаётся — только временная подписанная ссылка на картинку. */
  logoKey: string | null;
  audit: AuditRecord;
  version: number;
}

export interface OrgPolicyRecord extends OrgPolicy {
  /** Роль по умолчанию для новых сотрудников; null — не выбрана. */
  defaultRoleId: string | null;
  audit: AuditRecord;
  version: number;
}

const creator = alias(employees, 'creator');
const updater = alias(employees, 'updater');

/** «Основное» организации; null — организации нет или она чужая. */
export async function getOrgProfile(tx: Tx, orgId: string): Promise<OrgProfileRecord | null> {
  const [r] = await tx
    .select({
      id: organizations.id,
      name: organizations.name,
      inn: organizations.inn,
      address: organizations.address,
      phone: organizations.phone,
      head: organizations.head,
      slug: organizations.slug,
      logoKey: organizations.logoKey,
      createdAt: organizations.createdAt,
      createdBy: organizations.createdBy,
      createdByName: creator.shortName,
      updatedAt: organizations.updatedAt,
      updatedBy: organizations.updatedBy,
      updatedByName: updater.shortName,
      version: organizations.version,
    })
    .from(organizations)
    .leftJoin(creator, eq(creator.userId, organizations.createdBy))
    .leftJoin(updater, eq(updater.userId, organizations.updatedBy))
    .where(eq(organizations.id, orgId));
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    inn: r.inn,
    address: r.address,
    phone: r.phone,
    head: r.head,
    slug: r.slug,
    logoKey: r.logoKey,
    audit: {
      createdAt: r.createdAt,
      createdBy: auditActorName(r.createdBy, r.createdByName),
      updatedAt: r.updatedAt,
      updatedBy: auditActorName(r.updatedBy, r.updatedByName),
    },
    version: r.version,
  };
}

/**
 * Ключ логотипа из заблокированной до конца транзакции строки организации: прежний файл, который
 * удалят после замены, — тот, что был в базе в момент правки. null — логотипа нет или организация чужая.
 */
export async function lockOrgLogoKey(
  tx: Tx,
  orgId: string,
): Promise<{ logoKey: string | null } | null> {
  const [row] = await tx
    .select({ logoKey: organizations.logoKey })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .for('update');
  return row ?? null;
}

/** Набор функций: каждая из `FEATURES`, чего нет в записи — выключено. */
export function featureSet(stored: Readonly<Record<string, boolean>>): Record<Feature, boolean> {
  return Object.fromEntries(FEATURES.map((f) => [f, stored[f] === true])) as Record<
    Feature,
    boolean
  >;
}

/** Учётная политика и настройки организации; null — записи нет (организация чужая). */
export async function getOrgPolicy(tx: Tx, orgId: string): Promise<OrgPolicyRecord | null> {
  const [r] = await tx
    .select({
      settings: orgSettings,
      createdByName: creator.shortName,
      updatedByName: updater.shortName,
    })
    .from(orgSettings)
    .leftJoin(creator, eq(creator.userId, orgSettings.createdBy))
    .leftJoin(updater, eq(updater.userId, orgSettings.updatedBy))
    .where(eq(orgSettings.orgId, orgId));
  if (!r) return null;
  const s = r.settings;
  return {
    features: featureSet(s.features),
    remindDays: s.remindDays,
    overdueRepeat: s.overdueRepeat,
    // В базе — time «09:00:00», в интерфейсе — «09:00».
    digestTime: s.digestTime.slice(0, 5),
    timezone: s.timezone,
    confirmWaitDays: s.confirmWaitDays,
    taskConfirm: s.taskConfirm,
    reportConfirm: s.reportConfirm,
    payBeforeSubmit: s.payBeforeSubmit,
    pageSections: PAGE_SECTIONS.filter((p) => s.pageSections.includes(p)) as PageSection[],
    defaultRoleId: s.defaultRoleId,
    audit: {
      createdAt: s.createdAt,
      createdBy: auditActorName(s.createdBy, r.createdByName),
      updatedAt: s.updatedAt,
      updatedBy: auditActorName(s.updatedBy, r.updatedByName),
    },
    version: s.version,
  };
}

/** Включённые функции организации — для меню модулей в «кто я». */
export async function orgFeatures(tx: Tx, orgId: string): Promise<Record<Feature, boolean>> {
  const [r] = await tx
    .select({ features: orgSettings.features })
    .from(orgSettings)
    .where(eq(orgSettings.orgId, orgId));
  return featureSet(r?.features ?? {});
}

export interface HistoryItem {
  at: Date;
  /** Кто: короткое имя сотрудника, «Администратор платформы» или null — система. */
  actor: string | null;
  action: HistoryAction;
  changes: HistoryChange[];
  reason: string | null;
}

const actor = alias(employees, 'actor');

/**
 * Поля учётной политики (вкладка «Учётная политика»); изменения вкладки «Настройки» (часовой пояс,
 * сводка, повтор при просрочке, роль по умолчанию) в её историю не входят — как в прототипе, где они
 * пишутся отдельно (modules/org.js: log('org', 'settings')).
 */
export const ORG_POLICY_FIELDS = [
  'features',
  'taskConfirm',
  'reportConfirm',
  'confirmWaitDays',
  'payBeforeSubmit',
  'remindDays',
  'pageSections',
] as const;

/**
 * «История изменений учётной политики» (ТЗ: что изменено, было → стало, кто, когда): создание и
 * правки учётной политики организации, сначала новые; в правке — только поля учётной политики.
 * total — сколько всего таких записей (заголовок «История … · N»), items — последние `limit`.
 */
export async function orgPolicyHistory(
  tx: Tx,
  orgId: string,
  limit = 100,
): Promise<{ total: number; items: HistoryItem[] }> {
  const fields = sql.join(
    ORG_POLICY_FIELDS.map((f) => sql`${f}`),
    sql`, `,
  );
  const match = and(
    eq(auditLog.entity, 'org_settings'),
    eq(auditLog.entityId, orgId),
    or(
      eq(auditLog.action, 'create'),
      sql`exists (select 1 from jsonb_array_elements(${auditLog.changes}) as c where c->>'field' in (${fields}))`,
    ),
  );
  const [count] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(auditLog)
    .where(match);
  const rows = await tx
    .select({
      at: auditLog.at,
      actorUserId: auditLog.actorUserId,
      actorName: actor.shortName,
      action: auditLog.action,
      changes: auditLog.changes,
      reason: auditLog.reason,
    })
    .from(auditLog)
    .leftJoin(actor, eq(actor.userId, auditLog.actorUserId))
    .where(match)
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(limit);
  const policyField = (field: string) => (ORG_POLICY_FIELDS as readonly string[]).includes(field);
  return {
    total: Number(count?.total ?? 0),
    items: rows.map((r) => ({
      at: r.at,
      actor: auditActorName(r.actorUserId, r.actorName),
      action: r.action as HistoryAction,
      changes: r.changes.filter((c) => policyField(c.field)),
      reason: r.reason,
    })),
  };
}
