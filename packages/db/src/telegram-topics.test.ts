import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { telegramTopics } from './schema';
import { createTestDatabase, databaseAvailable, type TestDatabase } from './testing';

// Темы в чате с ботом (поток Т, задача Т7; миграции 0141–0142, docs/decisions.md п. Т-7) убраны
// по решению заказчика 14.11.2026 (п. Т-10): код таблицу не трогает, пока её не удалит отдельная
// миграция — она остаётся закрытой для роли приложения.
describe.skipIf(!databaseAvailable())('Темы в чате с ботом: таблица закрыта', () => {
  let t: TestDatabase;

  beforeAll(async () => {
    t = await createTestDatabase();
  });

  afterAll(async () => {
    await t?.drop();
  });

  it('таблицу роль приложения не видит и не меняет — только функциями', async () => {
    const denied = { cause: { message: expect.stringMatching(/permission denied/) } };
    await expect(t.app.db.select().from(telegramTopics)).rejects.toMatchObject(denied);
    await expect(
      t.app.db.insert(telegramTopics).values({ chatId: 504, key: 'sec', threadId: 1 }),
    ).rejects.toMatchObject(denied);
    await expect(t.app.db.execute(sql`delete from public.telegram_topics`)).rejects.toMatchObject(
      denied,
    );
  });
});
