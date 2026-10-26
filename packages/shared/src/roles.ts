import { PERMISSION_GROUPS, SCOPES, type PermissionGroupId } from '@buhuchet/domain';
import { z } from 'zod';
import { PermissionIdSchema, ScopeGroupIdSchema } from './auth';
import { RecordAudit, RecordVersion, Uuid } from './common';
import { listPageSchema } from './list';

/** Название роли: уникально в организации. */
export const ROLE_NAME_MAX_LENGTH = 100;
const RoleName = z.string().trim().min(1).max(ROLE_NAME_MAX_LENGTH);

export const PermissionGroupIdSchema = z.enum(
  PERMISSION_GROUPS.map((g) => g.id) as [PermissionGroupId, ...PermissionGroupId[]],
);

/** Область группы: «Свои контрагенты» или «Все контрагенты». */
export const ScopeSchema = z.enum(SCOPES);

/**
 * Справочник платформы «Права ролей»: названия и описания прав для формы роли, в порядке групп.
 * Группы, их права просмотра и область — `PERMISSION_GROUPS` из @buhuchet/domain.
 */
export const PermissionCatalog = z.object({
  items: z.array(
    z.object({
      id: PermissionIdSchema,
      group: PermissionGroupIdSchema,
      name: z.string(),
      description: z.string(),
    }),
  ),
});
export type PermissionCatalog = z.infer<typeof PermissionCatalog>;

/** Роль в списке ролей (прототип modules/staff.js, вкладка «Роли»). */
export const RoleListItem = z.object({
  id: Uuid,
  name: z.string(),
  /** Роль владельца: все права, не меняется и не удаляется. */
  isOwner: z.boolean(),
  /** Активных сотрудников с этой ролью. */
  employees: z.number().int().nonnegative(),
  /** Число прав; у роли владельца — все. */
  permissionCount: z.number().int().nonnegative(),
  audit: RecordAudit,
  version: RecordVersion,
});
export type RoleListItem = z.infer<typeof RoleListItem>;

/**
 * Страница списка ролей (вкладка «Роли» на общем списке): сортировка, страницы и фильтры — на
 * сервере. Все роли сразу (для выбора роли в формах) — `size=all&sort=name.asc`.
 */
export const RoleList = listPageSchema(RoleListItem);
export type RoleList = z.infer<typeof RoleList>;

/**
 * Карточка роли: права и область каждой группы, как они сохранены в роли (у роли владельца — все
 * права и «Все» везде). Действует ли право, решает ещё и просмотр группы (`hasPermission`). Если в
 * роли действует «Видеть все отчёты и всех контрагентов», область фактически «Все» во всех группах
 * (`scopeOf`), что бы ни было сохранено: форма роли показывает «Все контрагенты» без выбора, как
 * прототип (scopeHtml).
 */
export const Role = RoleListItem.extend({
  permissions: z.array(PermissionIdSchema),
  scopes: z.record(ScopeGroupIdSchema, ScopeSchema),
});
export type Role = z.infer<typeof Role>;

/** Новая роль: название и роль, из которой скопировать права (без неё — роль без прав). */
export const CreateRoleRequest = z.object({
  name: RoleName,
  copyFromRoleId: Uuid.optional(),
});
export type CreateRoleRequest = z.infer<typeof CreateRoleRequest>;

/**
 * Сохранение формы роли: название, полный набор прав, область групп. Не переданное не меняется;
 * область — только переданные группы.
 */
export const UpdateRoleRequest = z.object({
  version: RecordVersion,
  name: RoleName.optional(),
  permissions: z
    .array(PermissionIdSchema)
    .refine((p) => new Set(p).size === p.length, 'Право указано дважды')
    .optional(),
  scopes: z.partialRecord(ScopeGroupIdSchema, ScopeSchema).optional(),
});
export type UpdateRoleRequest = z.infer<typeof UpdateRoleRequest>;

/** Удаление роли: версия, которую видел пользователь (в строке запроса). */
export const DeleteRoleQuery = z.object({ version: z.coerce.number().int().nonnegative() });
export type DeleteRoleQuery = z.infer<typeof DeleteRoleQuery>;
