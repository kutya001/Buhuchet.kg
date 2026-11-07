import { createFakeTelegram, fixedClock } from '@buhuchet/adapters';
import { schema } from '@buhuchet/db';
import { createOrganization } from '@buhuchet/db/organizations';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  type TestDatabase,
} from '@buhuchet/db/testing';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUTH_IP_LIMIT } from '../modules/auth/ip-limit';
import { createTestDeps } from '../testing';
import { AUTH_IP_KIND, LOGIN_LOCKS_ALERT_MIN, watchLoginLocksJob } from './login-locks';

it('вид строк предела по адресу — тот же, что у входа', () => {
  expect(AUTH_IP_KIND).toBe(AUTH_IP_LIMIT.kind);
});

describe.skipIf(!databaseAvailable())('оповещение о массовых блокировках входа (Р-8 А)', () => {
  let t: TestDatabase;
  let orgId: string;

  beforeAll(async () => {
    t = await createTestDatabase();
    await seedAccessReference(t.admin.db);
    orgId = (
      await createOrganization(t.app.db, {
        name: 'ОсОО «Альфа»',
        inn: '01811201810456',
        slug: 'alfa',
        owner: { fullName: 'Асанов Асан Асанович', login: 'asanov', passwordHash: 'h' },
      })
    ).orgId;
    const [admin] = await t.admin.db
      .insert(schema.users)
      .values({ login: 'root', passwordHash: '!', isPlatformAdmin: true })
      .returning({ id: schema.users.id });
    await t.admin.db
      .insert(schema.telegramLinks)
      .values({ userId: admin!.id, orgId: null, chatId: 5001 });
  });

  afterAll(async () => {
    await t?.drop();
  });

  const alerts = () =>
    t.admin.db.select().from(schema.telegramOutbox).where(eq(schema.telegramOutbox.kind, 'alert'));
  /** Момент `m` минут от настоящего (окно считается по часам базы). */
  const min = (m: number) => new Date(Date.now() + m * 60_000);
  /** Логины, закрытые на 15 минут `minutesAgo` минут назад. */
  const lockLogins = (prefix: string, n: number, minutesAgo: number) =>
    t.admin.db.insert(schema.loginAttempts).values(
      Array.from({ length: n }, (_, i) => ({
        login: `${prefix}${i}`,
        failures: 0,
        lockedUntil: min(15 - minutesAgo),
        lastAttemptAt: min(-minutesAgo),
      })),
    );

  it('меньше порога — тихо; от порога — сообщение администратору, не чаще раза в час', async () => {
    const clock = fixedClock('2026-11-07T05:00:00Z');
    const telegram = createFakeTelegram();
    const deps = createTestDeps({ db: t.app.db, clock, telegram });
    // Блокировка до окна (70 минут назад) не считается.
    await lockLogins('old', 5, 70);
    await lockLogins('a', LOGIN_LOCKS_ALERT_MIN - 2, 30);
    await t.admin.db
      .insert(schema.users)
      .values({ orgId, login: 'locked', passwordHash: '!', loginLockedAt: min(-20) });
    await watchLoginLocksJob.run(deps, clock.now());
    expect(await alerts()).toEqual([]);

    // Адрес исчерпал предел попыток (30 за 10 минут) — ещё одна, всего 9 + 1 = 10.
    await t.admin.db.insert(schema.rateLimits).values(
      Array.from({ length: 30 }, (_, i) => ({
        kind: AUTH_IP_KIND,
        subject: 'addr',
        at: new Date(Date.now() - 300_000 + i * 1000),
      })),
    );
    await watchLoginLocksJob.run(deps, clock.now());
    const [alert] = await alerts();
    expect(alert).toMatchObject({ orgId: null, chatId: 5001, status: 'sent' });
    expect(alert!.text).toBe(
      '⚠️ Много блокировок входа за последний час: 10. Похоже на перебор паролей.\nЛогинов закрыто на 15 минут после неверных паролей: 8. Учётных записей заблокировано после 10 неверных паролей подряд: 1. Сколько раз адреса исчерпали предел попыток входа (30 за 10 минут): 1.\nПроверьте журнал сайта; на Vercel — правила Firewall.',
    );
    expect(telegram.sent.map((m) => m.chatId)).toEqual([5001]);

    // Через 10 минут блокировок ещё больше — второго сообщения в тот же час нет.
    clock.set('2026-11-07T05:10:00Z');
    await lockLogins('c', 5, 1);
    await watchLoginLocksJob.run(deps, clock.now());
    expect(await alerts()).toHaveLength(1);

    // Прошёл час с прошлого сообщения, блокировки продолжаются — новое.
    await t.admin.db
      .update(schema.telegramOutbox)
      .set({ createdAt: sql`now() - interval '61 minutes'` });
    await watchLoginLocksJob.run(deps, clock.now());
    expect(await alerts()).toHaveLength(2);
  });
});
