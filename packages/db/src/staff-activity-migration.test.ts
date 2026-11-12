import { hashPassword } from '@buhuchet/adapters/password';
import { and, eq } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOrganization, type CreatedOrganization } from './organizations';
import { auditLog, permissions, rolePermissions, roles, roleTemplates } from './schema';
import { seedPermissions, seedRoleTemplates } from './seed';
import { readSpecJson } from './spec-data';
import { createTestDatabase, databaseAvailable, type TestDatabase } from './testing';

const here = path.dirname(fileURLToPath(import.meta.url));
// Представление app.org_sessions создано миграциями тестовой базы — повторяется только часть о праве.
const MIGRATION = readFileSync(path.join(here, '../migrations/0115_staff_activity.sql'), 'utf8')
  .split('--> statement-breakpoint')
  .filter((s) => !/app\.org_sessions/.test(s))
  .join('\n');

/**
 * Миграция 0115 (прототип v84, перенос данных v84 в core/data.js): право «Смотреть аналитику по
 * сотрудникам» — в каталог, в шаблон «Главный бухгалтер» и ролям «Главный бухгалтер» уже созданных
 * организаций, у которых есть «Просматривать сотрудников»; запись в истории роли — от имени системы;
 * повтор ничего не меняет.
 */
describe.skipIf(!databaseAvailable())(
  'Право «Смотреть аналитику по сотрудникам» прежним организациям',
  () => {
    let db: TestDatabase;
    let a: CreatedOrganization;
    let b: CreatedOrganization;

    const roleOf = (org: CreatedOrganization, code: string | null) =>
      org.roles.find((r) => (code ? r.templateCode === code && !r.isOwner : r.isOwner))!;
    const has = async (roleId: string, permission = 'staffStats') =>
      (
        await db.admin.db
          .select({ id: rolePermissions.permissionId })
          .from(rolePermissions)
          .where(
            and(eq(rolePermissions.roleId, roleId), eq(rolePermissions.permissionId, permission)),
          )
      ).length === 1;
    const versionOf = async (roleId: string) =>
      (await db.admin.db.select({ v: roles.version }).from(roles).where(eq(roles.id, roleId)))[0]!
        .v;
    const historyOf = (roleId: string) =>
      db.admin.db
        .select({
          action: auditLog.action,
          changes: auditLog.changes,
          actor: auditLog.actorUserId,
          orgId: auditLog.orgId,
        })
        .from(auditLog)
        .where(and(eq(auditLog.entity, 'role'), eq(auditLog.entityId, roleId)));

    beforeAll(async () => {
      db = await createTestDatabase();
      const refDB = await readSpecJson<Record<string, unknown>>('data/refDB.json');
      await seedPermissions(db.admin.db, refDB.permissions, { update: false });
      await seedRoleTemplates(db.admin.db, refDB.roleTemplates, { update: false });
      const org = async (n: number) =>
        createOrganization(db.app.db, {
          name: `Организация ${n}`,
          inn: `0${n}811201810456`,
          slug: `staff-stats-${n}`,
          owner: {
            fullName: 'Владелец Организации',
            login: `staff-stats-owner-${n}`,
            passwordHash: await hashPassword('Bh-4821-temp'),
          },
        });
      [a, b] = [await org(1), await org(2)];
      // Как до v84: права нет ни в каталоге, ни в шаблоне, ни у ролей. У главного бухгалтера
      // организации Б отнято «Просматривать сотрудников» — ему право не выдаётся.
      await db.admin.db
        .delete(rolePermissions)
        .where(eq(rolePermissions.permissionId, 'staffStats'));
      await db.admin.db.delete(permissions).where(eq(permissions.id, 'staffStats'));
      await db.admin
        .sql`update role_templates set permissions = array_remove(permissions, 'staffStats')`;
      await db.admin.db
        .delete(rolePermissions)
        .where(
          and(
            eq(rolePermissions.roleId, roleOf(b, 'chief').id),
            eq(rolePermissions.permissionId, 'staffView'),
          ),
        );
      await db.admin.sql`delete from audit_log`;
    });

    afterAll(async () => {
      await db?.drop();
    });

    it('каталог, шаблон и роли «Главный бухгалтер» с «Просматривать сотрудников» получают право; запись в истории — от имени системы', async () => {
      const chiefA = roleOf(a, 'chief').id;
      const before = await versionOf(chiefA);
      await db.admin.sql.unsafe(MIGRATION);

      const [row] = await db.admin.db
        .select()
        .from(permissions)
        .where(eq(permissions.id, 'staffStats'));
      const [view] = await db.admin.db
        .select()
        .from(permissions)
        .where(eq(permissions.id, 'staffView'));
      expect(row).toMatchObject({
        permGroup: 'staff',
        name: 'Смотреть аналитику по сотрудникам',
        sortOrder: view!.sortOrder + 1,
        updatedBy: null,
      });

      const [chief] = await db.admin.db
        .select()
        .from(roleTemplates)
        .where(eq(roleTemplates.code, 'chief'));
      const at = chief!.permissions.indexOf('staffView');
      expect(chief!.permissions[at + 1]).toBe('staffStats');
      expect(chief!.version).toBe(2);
      const [acc] = await db.admin.db
        .select()
        .from(roleTemplates)
        .where(eq(roleTemplates.code, 'acc'));
      expect(acc!.permissions).not.toContain('staffStats');
      expect(acc!.version).toBe(1);

      expect(await has(chiefA)).toBe(true);
      expect(await versionOf(chiefA)).toBe(before + 1);
      const history = await historyOf(chiefA);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ action: 'update', actor: null, orgId: a.orgId });
      const [change] = history[0]!.changes as { field: string; from: string[]; to: string[] }[];
      expect(change!.field).toBe('permissions');
      expect(change!.from).not.toContain('staffStats');
      expect(change!.to.filter((p) => !change!.from.includes(p))).toEqual(['staffStats']);
      expect(change!.to[change!.to.indexOf('staffView') + 1]).toBe('staffStats');

      // Без «Просматривать сотрудников», бухгалтеру и владельцу право не выдаётся.
      const chiefB = roleOf(b, 'chief').id;
      expect(await has(chiefB)).toBe(false);
      expect(await historyOf(chiefB)).toEqual([]);
      expect(await has(roleOf(a, 'acc').id)).toBe(false);
      expect(await has(roleOf(a, null).id)).toBe(false);
    });

    it('повтор ничего не меняет', async () => {
      const chiefA = roleOf(a, 'chief').id;
      const before = await versionOf(chiefA);
      await db.admin.sql.unsafe(MIGRATION);
      expect(await versionOf(chiefA)).toBe(before);
      expect(await historyOf(chiefA)).toHaveLength(1);
      const [chief] = await db.admin.db
        .select()
        .from(roleTemplates)
        .where(eq(roleTemplates.code, 'chief'));
      expect(chief!.permissions.filter((p) => p === 'staffStats')).toHaveLength(1);
      expect(chief!.version).toBe(2);
    });

    it('в базе без каталога прав (до наполнения) миграция ничего не добавляет', async () => {
      const empty = await createTestDatabase();
      try {
        await empty.admin.sql.unsafe(MIGRATION);
        expect(await empty.admin.db.select().from(permissions)).toEqual([]);
        expect(await empty.admin.db.select().from(rolePermissions)).toEqual([]);
      } finally {
        await empty.drop();
      }
    });
  },
);
