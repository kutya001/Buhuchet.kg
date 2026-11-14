import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { telegramTopics } from './schema';
import {
  forgetTelegramTopic,
  saveTelegramTopic,
  telegramTopicKey,
  telegramTopicThread,
} from './telegram-bot';
import { createTestDatabase, databaseAvailable, type TestDatabase } from './testing';

const ORG = '0b0e1a52-6e0f-4c11-9a0e-1d1f3c2b4a5d';

// Темы в чате с ботом (поток Т, задача Т7; миграции 0133–0134, docs/decisions.md п. Т-7).
describe.skipIf(!databaseAvailable())('Темы в чате с ботом: номера тем', () => {
  let t: TestDatabase;

  beforeAll(async () => {
    t = await createTestDatabase();
  });

  afterAll(async () => {
    await t?.drop();
  });

  it('запомнить, найти по ключу и по номеру, забыть только с прежним номером', async () => {
    const db = t.app.db;
    expect(await telegramTopicThread(db, 501, 'task')).toBeNull();
    await saveTelegramTopic(db, 501, 'task', 1000);
    await saveTelegramTopic(db, 501, `org:${ORG}`, 1001);
    await saveTelegramTopic(db, 502, 'task', 2000);
    expect(await telegramTopicThread(db, 501, 'task')).toBe(1000);
    expect(await telegramTopicThread(db, 502, 'task')).toBe(2000);
    expect(await telegramTopicKey(db, 501, 1001)).toBe(`org:${ORG}`);
    expect(await telegramTopicKey(db, 501, 2000)).toBeNull();
    // Тему создали заново другой отправкой — устаревший номер строку не убирает.
    await saveTelegramTopic(db, 501, 'task', 1002);
    await forgetTelegramTopic(db, 501, 'task', 1000);
    expect(await telegramTopicThread(db, 501, 'task')).toBe(1002);
    await forgetTelegramTopic(db, 501, 'task', 1002);
    expect(await telegramTopicThread(db, 501, 'task')).toBeNull();
  });

  it('неизвестный ключ темы база не принимает', async () => {
    await expect(saveTelegramTopic(t.app.db, 503, 'other', 1)).rejects.toThrow();
    await expect(saveTelegramTopic(t.app.db, 503, 'org:x', 1)).rejects.toThrow();
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
