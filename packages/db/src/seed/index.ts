import type { Db } from '../client';
import { readSpecJson, specCommit } from '../spec-data';
import { seedDemoOrganization } from './demo';
import { seedGked, seedPlatformReference, type SeedReport } from './platform';

export { checksumOf } from './checksum';
export { DEMO_ORG_ID, seedDemoOrganization } from './demo';
export { seedGked, seedPlatformReference, type SeedOptions, type SeedReport } from './platform';

export interface SeedAllResult {
  platformReference: SeedReport;
  gked: SeedReport;
  demo: { orgId: string; created: boolean } | null;
}

/** Всё начальное наполнение из spec/data. Подключение — владельцем схемы (обходит RLS). */
export async function seedAll(
  db: Db,
  options: { update: boolean; demo: boolean },
): Promise<SeedAllResult> {
  const commit = await specCommit();
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const platformReference = await seedPlatformReference(
      t,
      await readSpecJson<Record<string, unknown>>('data/refDB.json'),
      `refDB.json@${commit}`,
      options,
    );
    const gked = await seedGked(t, await readSpecJson('data/gkedDB.json'), options);
    const demo = options.demo
      ? await seedDemoOrganization(t, await readSpecJson('data/demoDB.json'))
      : null;
    return { platformReference, gked, demo };
  });
}
