import { PERMISSIONS } from '@buhuchet/domain';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client';
import { permissions, roleTemplates } from '../schema';
import type { SeedOptions, SeedReport } from './platform';

const PermissionsSection = z.array(
  z.object({ id: z.string(), group: z.string(), name: z.string(), desc: z.string() }),
);

const RoleTemplatesSection = z.array(
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    perms: z.array(z.string()),
    scope: z.record(z.string(), z.string()).default({}),
  }),
);

/**
 * Каталог прав из refDB.permissions. Набор и группы прав задаёт система: если refDB с ним расходится,
 * наполнение останавливается — права нельзя добавить или переложить в другую группу только данными.
 * Название и описание, поправленные в Админке («Изменил» задан), `--update` не затирает.
 */
export async function seedPermissions(
  db: Db,
  section: unknown,
  options: SeedOptions,
): Promise<SeedReport> {
  const items = PermissionsSection.parse(section);
  const fromRef = items.map((p) => `${p.id}:${p.group}`).join(',');
  const fromCode = PERMISSIONS.map(([id, group]) => `${id}:${group}`).join(',');
  if (fromRef !== fromCode) {
    throw new Error(
      'Каталог прав в refDB.json расходится с системным (PERMISSIONS в @buhuchet/domain): ' +
        'добавьте право в код и в справочник вместе.',
    );
  }
  const rows = items.map((p, i) => ({
    id: p.id,
    permGroup: p.group,
    name: p.name,
    description: p.desc,
    sortOrder: i + 1,
  }));
  const insert = db.insert(permissions).values(rows);
  const before = await db.$count(permissions);
  const touched = options.update
    ? await insert
        .onConflictDoUpdate({
          target: permissions.id,
          set: {
            permGroup: sql`excluded.perm_group`,
            name: sql`case when ${permissions.updatedBy} is null then excluded.name else ${permissions.name} end`,
            description: sql`case when ${permissions.updatedBy} is null then excluded.description else ${permissions.description} end`,
            sortOrder: sql`excluded.sort_order`,
            updatedAt: sql`now()`,
          },
          setWhere: sql`(${permissions.permGroup}, ${permissions.sortOrder}) is distinct from (excluded.perm_group, excluded.sort_order)
            or (${permissions.updatedBy} is null
              and (${permissions.name}, ${permissions.description}) is distinct from (excluded.name, excluded.description))`,
        })
        .returning({ id: permissions.id })
    : await insert.onConflictDoNothing().returning({ id: permissions.id });
  const inserted = (await db.$count(permissions)) - before;
  return { inserted, updated: touched.length - inserted, unchanged: rows.length - touched.length };
}

/**
 * Шаблоны ролей из refDB.roleTemplates → role_templates. Шаблон, поправленный в Админке («Изменил»
 * задан), `--update` не затирает.
 */
export async function seedRoleTemplates(
  db: Db,
  section: unknown,
  options: SeedOptions,
): Promise<SeedReport> {
  const rows = RoleTemplatesSection.parse(section).map((t, i) => ({
    code: t.id,
    name: t.name,
    permissions: t.perms,
    scopes: t.scope,
    sortOrder: i + 1,
  }));
  const insert = db.insert(roleTemplates).values(rows);
  const before = await db.$count(roleTemplates);
  const touched = options.update
    ? await insert
        .onConflictDoUpdate({
          target: roleTemplates.code,
          set: {
            name: sql`excluded.name`,
            permissions: sql`excluded.permissions`,
            scopes: sql`excluded.scopes`,
            sortOrder: sql`excluded.sort_order`,
            updatedAt: sql`now()`,
            version: sql`${roleTemplates.version} + 1`,
          },
          setWhere: sql`${roleTemplates.updatedBy} is null
            and (${roleTemplates.name}, ${roleTemplates.permissions}, ${roleTemplates.scopes}, ${roleTemplates.sortOrder})
            is distinct from (excluded.name, excluded.permissions, excluded.scopes, excluded.sort_order)`,
        })
        .returning({ code: roleTemplates.code })
    : await insert.onConflictDoNothing().returning({ code: roleTemplates.code });
  const inserted = (await db.$count(roleTemplates)) - before;
  return { inserted, updated: touched.length - inserted, unchanged: rows.length - touched.length };
}
