import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { storageDeleteRetries } from './schema';
import { storageRetryAdd, storageRetryDone, storageRetryDue } from './storage-retries';
import { createTestDatabase, databaseAvailable, type TestDatabase } from './testing';

const permissionDenied = expect.objectContaining({
  cause: expect.objectContaining({ code: '42501' }),
});
const checkFailed = expect.objectContaining({
  cause: expect.objectContaining({ code: '23514' }),
});

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// Повторное удаление файлов из хранилища (доработки 14.11.2026, этап 3; docs/deviations.md п. И-10):
// ключи публичных загрузок видят и меняют только функции app.storage_retry_*.
describe.skipIf(!databaseAvailable())('повторное удаление файлов из хранилища', () => {
  let t: TestDatabase;

  beforeAll(async () => {
    t = await createTestDatabase();
  });

  afterAll(async () => {
    await t?.drop();
  });

  it('роль приложения таблицу не видит и не меняет — только функции', async () => {
    await expect(t.app.db.select().from(storageDeleteRetries)).rejects.toEqual(permissionDenied);
    await expect(
      t.app.db.insert(storageDeleteRetries).values({ key: `leads/upload/${U(1)}` }),
    ).rejects.toEqual(permissionDenied);
    await expect(t.app.db.execute(sql`delete from storage_delete_retries`)).rejects.toEqual(
      permissionDenied,
    );
  });

  it('принимает только ключи публичных загрузок: файлы заявок, отправленные контрагентом и копию принятого', async () => {
    const ok = [
      `leads/upload/${U(1)}`,
      `leads/${U(2)}/${U(3)}`,
      `org/${U(4)}/sent/${U(5)}`,
      `org/${U(4)}/sent/${U(5)}.up`,
      `org/${U(4)}/sent/${U(5)}.chk-${U(6)}`,
      `org/${U(4)}/files/${U(7)}`,
    ];
    expect(await storageRetryAdd(t.app.db, ok)).toBe(ok.length);
    // Повтор того же ключа — без изменений.
    expect(await storageRetryAdd(t.app.db, [ok[0]!])).toBe(0);
    for (const bad of [
      'secret/key',
      `org/${U(4)}/logo/${U(8)}`,
      `org/${U(4)}/files/${U(7)}/../x`,
      `leads/upload/${U(1)}\nleads/x`,
      `kb/videos/${U(9)}`,
    ]) {
      await expect(storageRetryAdd(t.app.db, [bad]), bad).rejects.toEqual(checkFailed);
    }
    await expect(
      t.app.db.execute(
        sql`select app.storage_retry_add(array_fill(${`leads/upload/${U(1)}`}::text, array[101]))`,
      ),
    ).rejects.toThrow();
    // Больше 100 — частями.
    const many = Array.from({ length: 150 }, (_, i) => `leads/upload/${U(1000 + i)}`);
    expect(await storageRetryAdd(t.app.db, many)).toBe(150);
    await t.admin.db.delete(storageDeleteRetries);
  });

  it('повтор: сначала не пробованные, затем не раньше чем через заданные минуты; удалённые убираются, неудачи считаются', async () => {
    const now = new Date('2026-11-15T10:00:00Z');
    const a = `leads/upload/${U(11)}`;
    const b = `org/${U(4)}/sent/${U(12)}`;
    await storageRetryAdd(t.app.db, [a, b]);
    expect((await storageRetryDue(t.app.db, now, 50, 10)).sort()).toEqual([a, b].sort());
    expect(
      await storageRetryDone(t.app.db, { now, done: [a], failed: [b], stuckAttempts: 2 }),
    ).toEqual({ left: 1, stuck: 0 });
    expect(await storageRetryDue(t.app.db, new Date(now.getTime() + 49 * 60_000), 50, 10)).toEqual(
      [],
    );
    const later = new Date(now.getTime() + 50 * 60_000);
    expect(await storageRetryDue(t.app.db, later, 50, 10)).toEqual([b]);
    expect(
      await storageRetryDone(t.app.db, { now: later, done: [], failed: [b], stuckAttempts: 2 }),
    ).toEqual({ left: 1, stuck: 1 });
    await t.admin.db.delete(storageDeleteRetries);
  });
});
