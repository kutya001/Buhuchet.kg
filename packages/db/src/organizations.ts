import { randomUUID } from 'node:crypto';
import {
  defaultOrgPolicy,
  isValidLogin,
  isValidOrgInn,
  isValidSlug,
  normalizeLogin,
  rolesForNewOrganization,
  SCOPE_GROUPS,
  shortName,
} from '@buhuchet/domain';
import { asc, eq, sql } from 'drizzle-orm';
import type { Db, Tx } from './client';
import { withOrgContext } from './context';
import { writeHistory } from './history';
import {
  employees,
  organizations,
  orgSettings,
  rolePermissions,
  roleScopes,
  roles,
  roleTemplates,
  users,
} from './schema';

export interface CreateOrganizationInput {
  name: string;
  /** 14 цифр. */
  inn: string;
  /** Адрес страницы организации. */
  slug: string;
  owner: {
    fullName: string;
    login: string;
    /** Хеш временного пароля (`hashPassword` из @buhuchet/adapters/password). */
    passwordHash: string;
    phone?: string | null;
  };
  /** Администратор платформы, который создаёт организацию. */
  createdBy?: string | null;
}

export interface CreatedOrganization {
  orgId: string;
  ownerUserId: string;
  ownerEmployeeId: string;
  roles: { id: string; name: string; isOwner: boolean; templateCode: string | null }[];
}

/** Неверные данные новой организации; field — какое поле исправить. */
export class OrganizationInputError extends Error {
  constructor(
    readonly field: 'name' | 'inn' | 'slug' | 'ownerFullName' | 'ownerLogin' | 'templates',
    message: string,
  ) {
    super(message);
    this.name = 'OrganizationInputError';
  }
}

const UNIQUE_FIELDS: Record<string, [OrganizationInputError['field'], string]> = {
  organizations_inn_unique: ['inn', 'Организация с таким ИНН уже есть'],
  organizations_slug_unique: ['slug', 'Такой адрес страницы уже занят другой организацией'],
  users_login_unique: ['ownerLogin', 'Логин уже занят'],
};

/** Имя нарушенного ограничения уникальности (код 23505), если ошибка — она. */
function uniqueViolation(error: unknown): string | null {
  for (let e: unknown = error; e && typeof e === 'object'; e = (e as { cause?: unknown }).cause) {
    const pg = e as { code?: string; constraint_name?: string };
    if (pg.code === '23505') return pg.constraint_name ?? null;
  }
  return null;
}

/**
 * Организация и её владелец (ТЗ «Админка» → «Модуль организаций»): копии шаблонов ролей платформы,
 * учётная политика по умолчанию, владелец с временным паролем, который при входе нужно сменить.
 * Всё в одной транзакции от имени новой организации, поэтому работает и ролью приложения под RLS.
 */
export async function createOrganization(
  db: Db,
  input: CreateOrganizationInput,
): Promise<CreatedOrganization> {
  const name = input.name.trim();
  const fullName = input.owner.fullName.trim();
  const login = normalizeLogin(input.owner.login);
  if (!name) throw new OrganizationInputError('name', 'Введите название');
  if (!isValidOrgInn(input.inn)) throw new OrganizationInputError('inn', 'ИНН — 14 цифр');
  if (!isValidSlug(input.slug)) {
    throw new OrganizationInputError(
      'slug',
      'Адрес страницы: 3–30 символов, строчные латинские буквы, цифры и дефис',
    );
  }
  if (!fullName) throw new OrganizationInputError('ownerFullName', 'Введите ФИО владельца');
  if (!isValidLogin(login)) {
    throw new OrganizationInputError(
      'ownerLogin',
      'Логин: латиница, цифры, точка, дефис; от 3 символов',
    );
  }

  const orgId = randomUUID();
  try {
    return await withOrgContext(db, { orgId, userId: input.createdBy ?? null }, (tx) =>
      insertOrganization(tx, orgId, { ...input, name, owner: { ...input.owner, fullName, login } }),
    );
  } catch (error) {
    const known = UNIQUE_FIELDS[uniqueViolation(error) ?? ''];
    if (known) throw new OrganizationInputError(known[0], known[1]);
    throw error;
  }
}

async function insertOrganization(
  tx: Tx,
  orgId: string,
  input: CreateOrganizationInput,
): Promise<CreatedOrganization> {
  const templates = await tx
    .select()
    .from(roleTemplates)
    .where(eq(roleTemplates.active, true))
    .orderBy(asc(roleTemplates.sortOrder));
  if (templates.length === 0) {
    throw new OrganizationInputError(
      'templates',
      'Шаблоны ролей платформы не загружены: сначала pnpm db:seed',
    );
  }
  const createdBy = input.createdBy ?? null;

  await tx
    .insert(organizations)
    .values({ id: orgId, slug: input.slug, name: input.name, inn: input.inn });

  const created: CreatedOrganization['roles'] = [];
  for (const role of rolesForNewOrganization(templates)) {
    const [row] = await tx
      .insert(roles)
      .values({
        orgId,
        name: role.name,
        isOwner: role.isOwner,
        templateCode: role.templateCode,
        createdBy,
        updatedBy: createdBy,
      })
      .returning({ id: roles.id });
    const roleId = row!.id;
    if (role.permissions.length > 0) {
      await tx
        .insert(rolePermissions)
        .values(role.permissions.map((permissionId) => ({ orgId, roleId, permissionId })));
    }
    await tx
      .insert(roleScopes)
      .values(SCOPE_GROUPS.map((g) => ({ orgId, roleId, permGroup: g, scope: role.scopes[g] })));
    created.push({
      id: roleId,
      name: role.name,
      isOwner: role.isOwner,
      templateCode: role.templateCode,
    });
  }
  const ownerRole = created.find((r) => r.isOwner)!;

  const [user] = await tx
    .insert(users)
    .values({
      orgId,
      login: input.owner.login,
      passwordHash: input.owner.passwordHash,
      mustChangePassword: true,
    })
    .returning({ id: users.id });
  const [employee] = await tx
    .insert(employees)
    .values({
      orgId,
      userId: user!.id,
      fullName: input.owner.fullName,
      shortName: shortName(input.owner.fullName),
      phone: input.owner.phone ?? null,
      roleId: ownerRole.id,
      createdBy,
      updatedBy: createdBy,
    })
    .returning({ id: employees.id });

  const policy = defaultOrgPolicy();
  await tx.insert(orgSettings).values({
    orgId,
    features: policy.features,
    remindDays: policy.remindDays,
    overdueRepeat: policy.overdueRepeat,
    digestTime: policy.digestTime,
    timezone: policy.timezone,
    confirmWaitDays: policy.confirmWaitDays,
    // Роль новых сотрудников — «Бухгалтер», как defaultRole в TemDB.json прототипа.
    defaultRoleId: created.find((r) => r.templateCode === 'acc')?.id ?? null,
    taskConfirm: policy.taskConfirm,
    reportConfirm: policy.reportConfirm,
    payBeforeSubmit: policy.payBeforeSubmit,
    createdBy,
    updatedBy: createdBy,
  });
  // Кто создал организацию и что появилось вместе с ней; учётная политика — запись с ключом org_id.
  await writeHistory(
    tx,
    { entity: 'organization', entityId: orgId, action: 'create' },
    ...created.map((r) => ({ entity: 'role' as const, entityId: r.id, action: 'create' as const })),
    { entity: 'user', entityId: user!.id, action: 'create' },
    { entity: 'employee', entityId: employee!.id, action: 'create' },
    { entity: 'org_settings', entityId: orgId, action: 'create' },
  );

  return { orgId, ownerUserId: user!.id, ownerEmployeeId: employee!.id, roles: created };
}

/**
 * Номера всех организаций для задач по расписанию (функция app.org_ids, SECURITY DEFINER):
 * задача обходит их по одной, каждую — в своей транзакции withOrgContext.
 */
export async function orgIds(db: Db): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`select id from app.org_ids() as id`);
  return rows.map((r) => r.id);
}
