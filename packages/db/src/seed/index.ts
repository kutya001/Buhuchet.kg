import type { Db } from '../client';
import { readSpecJson, specCommit } from '../spec-data';
import { seedPermissions, seedRoleTemplates } from './access';
import { seedPlatformAdmin, type PlatformAdminReport, type PlatformAdminSeed } from './admin';
import { seedDemoOrganization, type DemoSeedReport } from './demo';
import { seedUiTexts } from './l10n';
import { seedGked, seedPlatformReference, type SeedReport } from './platform';
import { seedPlatformDicts, type PlatformDictsReport } from './platform-dicts';
import { seedMessageTemplates, seedStatusTones } from './system-dicts';

export { checksumOf } from './checksum';
export { seedPermissions, seedRoleTemplates } from './access';
export { seedPlatformAdmin, type PlatformAdminReport, type PlatformAdminSeed } from './admin';
export {
  DEMO_ORG_ID,
  demoId,
  seedDemoOrganization,
  type DemoSeedOptions,
  type DemoSeedReport,
} from './demo';
export { seedUiTexts, uiTextSeedRows, type UiTextSeedRow } from './l10n';
export {
  referenceSections,
  seedGked,
  seedPlatformReference,
  type SeedOptions,
  type SeedReport,
} from './platform';
export {
  platformDictRows,
  seedPlatformDicts,
  TABLE_DICTIONARIES,
  TABLE_SECTIONS,
  type PlatformDictsReport,
} from './platform-dicts';
export { seedMessageTemplates, seedStatusTones } from './system-dicts';

export interface SeedAllResult {
  platformReference: SeedReport;
  platformDicts: PlatformDictsReport;
  gked: SeedReport;
  permissions: SeedReport;
  roleTemplates: SeedReport;
  statusTones: SeedReport;
  messageTemplates: SeedReport;
  uiTexts: SeedReport;
  demo: DemoSeedReport | null;
  platformAdmin: PlatformAdminReport | null;
}

/** Всё начальное наполнение из spec/data. Подключение — владельцем схемы (обходит RLS). */
export async function seedAll(
  db: Db,
  options: {
    update: boolean;
    demo: boolean;
    demoPassword?: string | null;
    platformAdmin?: PlatformAdminSeed | null;
  },
): Promise<SeedAllResult> {
  const commit = await specCommit();
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const refDB = await readSpecJson<Record<string, unknown>>('data/refDB.json');
    const platformReference = await seedPlatformReference(
      t,
      refDB,
      `refDB.json@${commit}`,
      options,
    );
    const platformDicts = await seedPlatformDicts(t, refDB, options);
    const gked = await seedGked(t, await readSpecJson('data/gkedDB.json'), options);
    const permissions = await seedPermissions(t, refDB.permissions, options);
    const roleTemplates = await seedRoleTemplates(t, refDB.roleTemplates, options);
    const statusTones = await seedStatusTones(t, options);
    const messageTemplates = await seedMessageTemplates(
      t,
      refDB.messageTemplates,
      refDB.templateNotes,
      options,
    );
    const uiTexts = await seedUiTexts(t, refDB.localization, options);
    const demo = options.demo
      ? await seedDemoOrganization(t, await readSpecJson('data/demoDB.json'), {
          update: options.update,
          password: options.demoPassword ?? null,
        })
      : null;
    const platformAdmin = options.platformAdmin
      ? await seedPlatformAdmin(t, options.platformAdmin)
      : null;
    return {
      platformReference,
      platformDicts,
      gked,
      permissions,
      roleTemplates,
      statusTones,
      messageTemplates,
      uiTexts,
      demo,
      platformAdmin,
    };
  });
}
