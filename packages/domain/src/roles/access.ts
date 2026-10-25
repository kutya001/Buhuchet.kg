import {
  PERMISSION_GROUPS,
  PERMISSION_IDS,
  viewPermissionOf,
  type PermissionId,
  type Scope,
  type ScopeGroupId,
} from './permissions';

/**
 * Кто действует: сотрудник организации с ролью. Администратор платформы прав в организации не имеет
 * и субъектом не бывает (прототип core/session.js: can и seeAll для него — false).
 */
export interface AccessSubject {
  employeeId: string;
  /** Роль «Владелец организации»: все права, область «Все контрагенты». */
  isOwner: boolean;
  permissions: ReadonlySet<PermissionId>;
  scopes: Readonly<Partial<Record<ScopeGroupId, Scope>>>;
}

/**
 * Есть ли право. Владелец имеет все права. Право группы действует, только если в роли есть и
 * «Просматривать …» этой группы (прототип core/session.js, can).
 */
export function hasPermission(subject: AccessSubject, permission: PermissionId): boolean {
  if (subject.isOwner) return true;
  if (!subject.permissions.has(permission)) return false;
  const view = viewPermissionOf(permission);
  return view === null || view === permission || subject.permissions.has(view);
}

/** Все действующие права субъекта в порядке каталога. */
export function effectivePermissions(subject: AccessSubject): PermissionId[] {
  return PERMISSION_IDS.filter((p) => hasPermission(subject, p));
}

/**
 * Область группы: у владельца и у права «Видеть все отчёты и всех контрагентов» — «Все» во всех
 * группах, иначе — как задано в роли, по умолчанию «Свои» (прототип core/session.js, seeAll).
 */
export function scopeOf(subject: AccessSubject, group: ScopeGroupId): Scope {
  if (subject.isOwner || hasPermission(subject, 'viewAll')) return 'all';
  return subject.scopes[group] ?? 'own';
}

const SCOPE_GROUP_VIEW = Object.fromEntries(
  PERMISSION_GROUPS.filter((g) => g.scope).map((g) => [g.id, g.view]),
) as Record<ScopeGroupId, PermissionId>;

/**
 * Видит ли субъект данные контрагента в группе прав: нужно право просмотра группы, а при области
 * «Свои контрагенты» — чтобы субъект был ответственным за контрагента.
 */
export function canSeeContractor(
  subject: AccessSubject,
  group: ScopeGroupId,
  contractor: { responsibleEmployeeId: string | null },
): boolean {
  if (!hasPermission(subject, SCOPE_GROUP_VIEW[group])) return false;
  return (
    scopeOf(subject, group) === 'all' || contractor.responsibleEmployeeId === subject.employeeId
  );
}
