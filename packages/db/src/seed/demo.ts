import { createHash } from 'node:crypto';
import { hashPassword, verifyPassword } from '@buhuchet/adapters/password';
import {
  FEATURES,
  defaultOrgPolicy,
  normalizeRemindDays,
  normalizeRolePermissions,
  normalizeScopes,
  SCOPE_GROUPS,
} from '@buhuchet/domain';
import { eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client';
import { seedDemoContractors } from './demo-contractors';
import { seedDemoMoney } from './demo-money';
import { seedDemoTasks } from './demo-tasks';
import {
  employees,
  organizations,
  orgReportTypes,
  orgSettings,
  rolePermissions,
  roleScopes,
  roles,
  sessions,
  users,
} from '../schema';

/** Постоянный идентификатор демо-организации «Бухгалтер Плюс» на стенде и в тестах. */
export const DEMO_ORG_ID = '00000000-0000-4000-8000-000000000001';

/** Вид записи демо-организации для постоянного uuid: у каждого модуля — свои. */
export type DemoKind =
  | 'employee'
  | 'user'
  | 'role'
  | 'contractor'
  | 'tariff'
  | 'task'
  | 'task_comment'
  | 'requisite';
export type DemoIdOf = (kind: DemoKind, protoId: string) => string;

/**
 * Постоянный uuid записи демо-организации по её коду в demoDB.json (e3, acc, …): наполнители модулей
 * ссылаются друг на друга так же, как записи прототипа (у контрагента resp: 'e3').
 */
export function demoId(kind: DemoKind, protoId: string): string {
  const h = createHash('sha256').update(`buhuchet-demo:${kind}:${protoId}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Хеш-заглушка: такой пароль не подходит никогда (verifyPassword отвечает «нет»). */
const NO_PASSWORD = '!';

const Phone = z.object({ cc: z.string(), digits: z.string() }).nullable().optional();

/** «2025-02-14 11:20» — момент по Бишкеку, как `_ca` и `_ua` записей прототипа. */
const Stamp = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
const stampOf = (value: string) => new Date(`${value.replace(' ', 'T')}:00+06:00`);

/** Подключённый вид отчёта демо-организации (`organization.types` в demoDB.json). */
const DemoReportType = z.object({
  on: z.boolean(),
  days: z.array(z.number().int()),
  needFile: z.boolean(),
  needReceipt: z.boolean(),
  _cb: z.string(),
  _ca: Stamp,
  _ub: z.string(),
  _ua: Stamp,
});

const DemoFile = z.object({
  organization: z.object({
    name: z.string(),
    inn: z.string().optional(),
    address: z.string().optional(),
    phone: Phone,
    head: z.string().optional(),
    /** «На платформе с» — дата подключения организации. */
    created: z.iso.date().optional(),
    slug: z.string(),
    features: z.record(z.string(), z.boolean()).default({}),
    remind: z.array(z.number().int()).optional(),
    overdueRepeat: z.boolean().optional(),
    digest: z.string().optional(),
    waitDays: z.number().int().optional(),
    defaultRole: z.string().optional(),
    taskConfirm: z.boolean().optional(),
    repConfirm: z.boolean().optional(),
    payFirst: z.boolean().optional(),
    types: z.record(z.string(), DemoReportType).default({}),
  }),
  roles: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      perms: z.array(z.string()),
      scope: z.record(z.string(), z.string()).optional(),
      locked: z.boolean().optional(),
    }),
  ),
  employees: z.array(
    z.object({
      id: z.string(),
      fio: z.string(),
      short: z.string(),
      login: z.string(),
      phone: Phone,
      role: z.string(),
      active: z.boolean(),
    }),
  ),
});

export interface DemoSeedOptions {
  update: boolean;
  /** Пароль демо-сотрудников (DEMO_PASSWORD). Без него войти демо-сотрудником нельзя. */
  password?: string | null;
}

export interface DemoSeedReport {
  orgId: string;
  created: boolean;
  employees: number;
}

/**
 * Демо-организация из demoDB.json: организация, роли (владелец, «Главный бухгалтер», «Бухгалтер»),
 * сотрудники с учётными записями, учётная политика и подключённые виды отчётов. Повторный запуск досоздаёт только недостающее;
 * с --update и новым паролем — меняет пароль демо-сотрудников и закрывает их сеансы. Модули по мере появления таблиц
 * добавляют сюда свои наполнители (контрагенты, отчёты…) с тем же DEMO_ORG_ID и demoId.
 */
export async function seedDemoOrganization(
  db: Db,
  file: unknown,
  options: DemoSeedOptions = { update: false },
): Promise<DemoSeedReport> {
  const demo = DemoFile.parse(file);
  const org = demo.organization;
  const orgId = DEMO_ORG_ID;
  const profile = {
    address: org.address ?? null,
    phone: org.phone ? `+${org.phone.digits}` : null,
    head: org.head ?? null,
  };
  const created = await db
    .insert(organizations)
    .values({
      id: orgId,
      slug: org.slug,
      name: org.name,
      inn: org.inn ?? null,
      ...profile,
      isDemo: true,
      // Полночь по Бишкеку: «На платформе с» показывает дату из demoDB.json, а не день наполнения.
      ...(org.created ? { createdAt: new Date(`${org.created}T00:00:00+06:00`) } : {}),
    })
    .onConflictDoNothing()
    .returning({ id: organizations.id });
  if (options.update) {
    // Демо-организация, созданная до «Моя организация» (#8): досоздать пустые поля профиля, не трогая
    // то, что уже изменили на стенде.
    await db
      .update(organizations)
      .set({
        address: sql`coalesce(${organizations.address}, ${profile.address})`,
        phone: sql`coalesce(${organizations.phone}, ${profile.phone})`,
        head: sql`coalesce(${organizations.head}, ${profile.head})`,
      })
      .where(eq(organizations.id, orgId));
  }

  await db
    .insert(roles)
    .values(
      demo.roles.map((r) => ({
        id: demoId('role', r.id),
        orgId,
        name: r.name,
        isOwner: r.locked === true,
        templateCode: r.locked ? null : r.id,
      })),
    )
    .onConflictDoNothing();
  const regular = demo.roles.filter((r) => !r.locked);
  const perms = regular.flatMap((r) =>
    normalizeRolePermissions(r.perms).map((permissionId) => ({
      orgId,
      roleId: demoId('role', r.id),
      permissionId,
    })),
  );
  if (perms.length > 0) await db.insert(rolePermissions).values(perms).onConflictDoNothing();
  await db
    .insert(roleScopes)
    .values(
      demo.roles.flatMap((r) => {
        const scopes = normalizeScopes(r.scope);
        return SCOPE_GROUPS.map((g) => ({
          orgId,
          roleId: demoId('role', r.id),
          permGroup: g,
          scope: scopes[g],
        }));
      }),
    )
    .onConflictDoNothing();

  const passwordHash = options.password ? await hashPassword(options.password) : NO_PASSWORD;
  const userIds = demo.employees.map((e) => demoId('user', e.id));
  await db
    .insert(users)
    .values(
      demo.employees.map((e) => ({
        id: demoId('user', e.id),
        orgId,
        login: e.login,
        passwordHash,
      })),
    )
    .onConflictDoNothing();
  if (options.update && options.password) {
    // Пароль сменился — новый хеш и выход со всех устройств: иначе вошедший со старым паролем так и
    // оставался бы в системе. С тем же паролем ничего не меняется, повторный запуск никого не выкидывает.
    const current = await db
      .select({ id: users.id, passwordHash: users.passwordHash })
      .from(users)
      .where(inArray(users.id, userIds));
    const changed: string[] = [];
    for (const u of current) {
      if (!(await verifyPassword(u.passwordHash, options.password))) changed.push(u.id);
    }
    if (changed.length > 0) {
      await db
        .update(users)
        .set({ passwordHash, version: sql`${users.version} + 1` })
        .where(inArray(users.id, changed));
      await db.delete(sessions).where(inArray(sessions.userId, changed));
    }
  }
  const insertedEmployees = await db
    .insert(employees)
    .values(
      demo.employees.map((e) => ({
        id: demoId('employee', e.id),
        orgId,
        userId: demoId('user', e.id),
        fullName: e.fio,
        shortName: e.short,
        phone: e.phone ? `+${e.phone.digits}` : null,
        roleId: demoId('role', e.role),
        active: e.active,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: employees.id });

  const defaults = defaultOrgPolicy();
  await db
    .insert(orgSettings)
    .values({
      orgId,
      features: Object.fromEntries(FEATURES.map((f) => [f, org.features[f] === true])),
      remindDays: org.remind ?? defaults.remindDays,
      overdueRepeat: org.overdueRepeat ?? defaults.overdueRepeat,
      digestTime: org.digest ?? defaults.digestTime,
      timezone: defaults.timezone,
      confirmWaitDays: org.waitDays ?? defaults.confirmWaitDays,
      defaultRoleId: org.defaultRole ? demoId('role', org.defaultRole) : null,
      taskConfirm: org.taskConfirm ?? defaults.taskConfirm,
      reportConfirm: org.repConfirm ?? defaults.reportConfirm,
      payBeforeSubmit: org.payFirst ?? defaults.payBeforeSubmit,
      pageSections: defaults.pageSections,
    })
    .onConflictDoNothing();

  // Виды отчётов демо-организации (модуль «Справочники», задача 2.02): автор — демо-сотрудник.
  const userOf = (protoId: string) =>
    demo.employees.some((e) => e.id === protoId) ? demoId('user', protoId) : null;
  const typeRows = Object.entries(org.types).map(([code, x]) => ({
    orgId,
    reportTypeCode: code,
    enabled: x.on,
    remindDays: normalizeRemindDays(x.days),
    needFile: x.needFile,
    needReceipt: x.needReceipt,
    createdBy: userOf(x._cb),
    updatedBy: userOf(x._ub),
    createdAt: stampOf(x._ca),
    updatedAt: stampOf(x._ua),
  }));
  if (typeRows.length > 0) await db.insert(orgReportTypes).values(typeRows).onConflictDoNothing();
  // Контрагенты (задача 2.05).
  const employeeIds = demo.employees.map((e) => e.id);
  await seedDemoContractors(db, file, { orgId, demoId, employees: employeeIds });
  // Ручные задачи (задача 2.23).
  await seedDemoTasks(db, file, { orgId, demoId, employees: employeeIds });

  await seedDemoMoney(db, file, orgId);

  return { orgId, created: created.length > 0, employees: insertedEmployees.length };
}
