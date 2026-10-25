import { z } from 'zod';
import type { Db } from '../client';
import { organizations } from '../schema';

/** Постоянный идентификатор демо-организации «Бухгалтер Плюс» на стенде и в тестах. */
export const DEMO_ORG_ID = '00000000-0000-4000-8000-000000000001';

const DemoFile = z.object({
  organization: z.object({
    name: z.string(),
    inn: z.string().optional(),
    slug: z.string(),
  }),
});

/**
 * Демо-организация из demoDB.json. Этап 0 заводит саму организацию; модули по мере появления таблиц
 * добавляют сюда свои наполнители (сотрудники, контрагенты, отчёты…) с тем же DEMO_ORG_ID.
 */
export async function seedDemoOrganization(
  db: Db,
  file: unknown,
): Promise<{ orgId: string; created: boolean }> {
  const { organization } = DemoFile.parse(file);
  const created = await db
    .insert(organizations)
    .values({
      id: DEMO_ORG_ID,
      slug: organization.slug,
      name: organization.name,
      inn: organization.inn ?? null,
      isDemo: true,
    })
    .onConflictDoNothing()
    .returning({ id: organizations.id });
  return { orgId: DEMO_ORG_ID, created: created.length > 0 };
}
