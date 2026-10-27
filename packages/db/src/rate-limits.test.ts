import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withUserContext } from './auth';
import { QUERY_TIMEOUT_MS, withOrgContext, type QueryKind } from './context';
import { queryTimedOut } from './errors';
import { createOrganization, type CreatedOrganization } from './organizations';
import { cleanupRateLimits, releaseRateLimit, takeRateLimit, type RateLimit } from './rate-limits';
import { rateLimits } from './schema';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  type TestDatabase,
} from './testing';

const permissionDenied = expect.objectContaining({
  cause: expect.objectContaining({ code: '42501' }),
});

describe.skipIf(!databaseAvailable())('защита тяжёлых запросов', () => {
  let t: TestDatabase;
  let a: CreatedOrganization;

  beforeAll(async () => {
    t = await createTestDatabase();
    await seedAccessReference(t.admin.db);
    a = await createOrganization(t.app.db, {
      name: 'Организация А',
      inn: '01811201810456',
      slug: 'org-a',
      owner: { fullName: 'Токтомаматов Бекзат', login: 'Owner-A', passwordHash: 'hash-a' },
    });
  });

  afterAll(async () => {
    await t?.drop();
  });

  describe('предел времени запроса', () => {
    it.each<[QueryKind | undefined, number]>([
      [undefined, 15_000],
      ['request', 15_000],
      ['export', 60_000],
      ['job', 240_000],
    ])('withOrgContext с видом работы %s — %i мс', async (kind, ms) => {
      expect(QUERY_TIMEOUT_MS[kind ?? 'request']).toBe(ms);
      const value = await withOrgContext(
        t.app.db,
        { orgId: a.orgId, userId: a.ownerUserId, ...(kind ? { kind } : {}) },
        async (tx) => {
          const [row] = await tx.execute<{ v: string }>(
            sql`select current_setting('statement_timeout') as v`,
          );
          return row!.v;
        },
      );
      expect(value).toBe(ms % 60_000 === 0 ? `${ms / 60_000}min` : `${ms / 1000}s`);
    });

    it('withUserContext ставит тот же предел по виду работы', async () => {
      const read = (kind?: QueryKind) =>
        withUserContext(
          t.app.db,
          a.ownerUserId,
          async (tx) => {
            const [row] = await tx.execute<{ v: string }>(
              sql`select current_setting('statement_timeout') as v`,
            );
            return row!.v;
          },
          kind,
        );
      expect(await read()).toBe('15s');
      expect(await read('export')).toBe('1min');
    });

    it('предел действует только до конца транзакции', async () => {
      await withOrgContext(t.app.db, { orgId: a.orgId, kind: 'export' }, async () => undefined);
      const [row] = await t.app.db.execute<{ v: string }>(
        sql`select current_setting('statement_timeout') as v`,
      );
      expect(row!.v).toBe('0');
    });

    it('запрос дольше предела прерывается, и это узнаётся по ошибке', async () => {
      const error = await withOrgContext(t.app.db, { orgId: a.orgId }, async (tx) => {
        await tx.execute(sql`set local statement_timeout = 50`);
        await tx.execute(sql`select pg_sleep(1)`);
      }).catch((e: unknown) => e);
      expect(queryTimedOut(error)).toBe(true);
      expect(queryTimedOut(new Error('другая ошибка'))).toBe(false);
      expect(queryTimedOut({ cause: { code: '23505' } })).toBe(false);
    });
  });

  describe('частота действий', () => {
    const limit = (over: Partial<RateLimit> = {}): RateLimit => ({
      kind: 'test',
      max: 3,
      windowSeconds: 3600,
      leaseSeconds: 120,
      ...over,
    });
    const rows = (subject: string) =>
      t.admin.db.select().from(rateLimits).where(eq(rateLimits.subject, subject));

    it('одно действие одновременно: пока не отпущено — busy', async () => {
      const first = await takeRateLimit(t.app.db, limit(), 'u-busy');
      expect(first.ok).toBe(true);
      expect(await takeRateLimit(t.app.db, limit(), 'u-busy')).toEqual({
        ok: false,
        reason: 'busy',
      });
      // У другого пользователя и у другого вида действия — свой счёт.
      expect((await takeRateLimit(t.app.db, limit(), 'u-other')).ok).toBe(true);
      expect((await takeRateLimit(t.app.db, limit({ kind: 'test-2' }), 'u-busy')).ok).toBe(true);
      if (first.ok) await releaseRateLimit(t.app.db, first.ticket);
      expect((await takeRateLimit(t.app.db, limit(), 'u-busy')).ok).toBe(true);
    });

    it('не больше max за окно, отпущенные действия тоже считаются', async () => {
      for (let i = 0; i < 3; i++) {
        const take = await takeRateLimit(t.app.db, limit(), 'u-limit');
        expect(take.ok).toBe(true);
        if (take.ok) await releaseRateLimit(t.app.db, take.ticket);
      }
      expect(await takeRateLimit(t.app.db, limit(), 'u-limit')).toEqual({
        ok: false,
        reason: 'limited',
      });
      expect(await rows('u-limit')).toHaveLength(3);
    });

    it('действие старше окна в счёт не входит', async () => {
      await t.admin.db.insert(rateLimits).values(
        Array.from({ length: 3 }, () => ({
          kind: 'test',
          subject: 'u-old',
          at: new Date(Date.now() - 2 * 3600_000),
        })),
      );
      expect((await takeRateLimit(t.app.db, limit(), 'u-old')).ok).toBe(true);
    });

    it('забытое действие перестаёт мешать после leaseSeconds', async () => {
      await t.admin.db.insert(rateLimits).values({
        kind: 'test',
        subject: 'u-lease',
        busyUntil: new Date(Date.now() - 1000),
      });
      expect((await takeRateLimit(t.app.db, limit(), 'u-lease')).ok).toBe(true);
    });

    it('без leaseSeconds одновременность не следится', async () => {
      const free = limit({ leaseSeconds: undefined });
      expect((await takeRateLimit(t.app.db, free, 'u-free')).ok).toBe(true);
      expect((await takeRateLimit(t.app.db, free, 'u-free')).ok).toBe(true);
      const [row] = await rows('u-free');
      expect(row!.busyUntil).toBeNull();
    });

    it('одновременные запросы не проходят сверх предела', async () => {
      const takes = await Promise.all(
        Array.from({ length: 8 }, () =>
          takeRateLimit(t.app.db, limit({ leaseSeconds: undefined }), 'u-race'),
        ),
      );
      expect(takes.filter((x) => x.ok)).toHaveLength(3);
      const busy = await Promise.all(
        Array.from({ length: 5 }, () => takeRateLimit(t.app.db, limit(), 'u-race-busy')),
      );
      expect(busy.filter((x) => x.ok)).toHaveLength(1);
    });

    it('очистка удаляет строки старше суток, кроме занятых', async () => {
      const old = new Date(Date.now() - 2 * 86_400_000);
      await t.admin.db.insert(rateLimits).values([
        { kind: 'test', subject: 'u-clean', at: old },
        { kind: 'test', subject: 'u-clean', at: old, busyUntil: new Date(Date.now() + 60_000) },
        { kind: 'test', subject: 'u-clean' },
      ]);
      expect(await cleanupRateLimits(t.app.db)).toBeGreaterThanOrEqual(1);
      expect(await rows('u-clean')).toHaveLength(2);
    });

    it('роль приложения не читает и не меняет таблицу напрямую', async () => {
      await expect(t.app.db.select().from(rateLimits)).rejects.toThrow();
      await expect(
        t.app.db.insert(rateLimits).values({ kind: 'test', subject: 'x' }),
      ).rejects.toEqual(permissionDenied);
      await expect(t.app.db.delete(rateLimits)).rejects.toEqual(permissionDenied);
    });
  });
});
