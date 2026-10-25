import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client';
import { GKED_LEVELS, gkedItems, platformReference } from '../schema';
import { checksumOf } from './checksum';

export interface SeedOptions {
  /** true — обновить изменившиеся записи; false — только добавить недостающие. */
  update: boolean;
}

export interface SeedReport {
  inserted: number;
  updated: number;
  unchanged: number;
}

/** Разделы refDB.json → platform_reference (раздел = строка). */
export async function seedPlatformReference(
  db: Db,
  refDB: Record<string, unknown>,
  source: string,
  options: SeedOptions,
): Promise<SeedReport> {
  const existing = new Map(
    (
      await db
        .select({ key: platformReference.key, checksum: platformReference.checksum })
        .from(platformReference)
    ).map((r) => [r.key, r.checksum]),
  );
  const report: SeedReport = { inserted: 0, updated: 0, unchanged: 0 };
  for (const [key, payload] of Object.entries(refDB)) {
    const checksum = checksumOf(payload);
    const current = existing.get(key);
    if (current === undefined) {
      await db.insert(platformReference).values({ key, payload, checksum, source });
      report.inserted++;
    } else if (current !== checksum && options.update) {
      await db
        .update(platformReference)
        .set({
          payload,
          checksum,
          source,
          version: sql`${platformReference.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(sql`${platformReference.key} = ${key}`);
      report.updated++;
    } else {
      report.unchanged++;
    }
  }
  return report;
}

const GkedFile = z.object({
  items: z.array(
    z.object({
      code: z.string().min(1),
      name: z.string().min(1),
      level: z.enum(GKED_LEVELS),
      parent: z.string().nullable(),
      active: z.boolean(),
      note: z.string(),
    }),
  ),
});

/** ГКЭД из gkedDB.json → gked_items. */
export async function seedGked(db: Db, file: unknown, options: SeedOptions): Promise<SeedReport> {
  const { items } = GkedFile.parse(file);
  const rows = items.map((item, i) => ({
    code: item.code,
    name: item.name,
    level: item.level,
    parentCode: item.parent,
    active: item.active,
    note: item.note,
    sortOrder: i + 1,
  }));
  const before = await db.$count(gkedItems);
  let touched = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const insert = db.insert(gkedItems).values(chunk);
    const result = options.update
      ? await insert
          .onConflictDoUpdate({
            target: gkedItems.code,
            set: {
              name: sql`excluded.name`,
              level: sql`excluded.level`,
              parentCode: sql`excluded.parent_code`,
              active: sql`excluded.active`,
              note: sql`excluded.note`,
              sortOrder: sql`excluded.sort_order`,
              updatedAt: sql`now()`,
            },
            setWhere: sql`(${gkedItems.name}, ${gkedItems.level}, ${gkedItems.parentCode}, ${gkedItems.active}, ${gkedItems.note}, ${gkedItems.sortOrder})
              is distinct from (excluded.name, excluded.level, excluded.parent_code, excluded.active, excluded.note, excluded.sort_order)`,
          })
          .returning({ code: gkedItems.code })
      : await insert.onConflictDoNothing().returning({ code: gkedItems.code });
    touched += result.length;
  }
  const inserted = (await db.$count(gkedItems)) - before;
  return { inserted, updated: touched - inserted, unchanged: rows.length - touched };
}
