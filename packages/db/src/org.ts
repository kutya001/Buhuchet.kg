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
import { and, desc, eq } from 'drizzle-orm';
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
  /** Ключ логотипа в хранилище; наружу не отдаётся — только признак и адрес GET /api/org/logo. */
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
 * «История изменений учётной политики» (ТЗ: что изменено, было → стало, кто, когда): записи истории
 * учётной политики и настроек организации, сначала новые.
 */
export async function orgPolicyHistory(tx: Tx, orgId: string, limit = 100): Promise<HistoryItem[]> {
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
    .where(and(eq(auditLog.entity, 'org_settings'), eq(auditLog.entityId, orgId)))
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(limit);
  return rows.map((r) => ({
    at: r.at,
    actor: auditActorName(r.actorUserId, r.actorName),
    action: r.action as HistoryAction,
    changes: r.changes,
    reason: r.reason,
  }));
}
