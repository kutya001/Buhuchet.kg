import { eq, like, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext } from './context';
import { createOrganization } from './organizations';
import {
  claimJobSlot,
  failHungJobRuns,
  finishJobRun,
  hasHungJobRuns,
  jobStates,
  loginLockStats,
  platformAlert,
  platformAlertThrottled,
  recordJobOutcome,
  setJobAlert,
} from './scheduler';
import {
  loginAttempts,
  rateLimits,
  schedulerJobs,
  schedulerRuns,
  telegramLinks,
  telegramOutbox,
  users,
} from './schema';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  type TestDatabase,
} from './testing';

const NOW = new Date('2026-11-07T04:00:00Z');

describe.skipIf(!databaseAvailable())('задачи по расписанию: слоты и оповещения (Р-8, Р-9)', () => {
  let t: TestDatabase;
  let adminId: string;
  let orgId: string;

  beforeAll(async () => {
    t = await createTestDatabase();
    await seedAccessReference(t.admin.db);
    const org = await createOrganization(t.app.db, {
      name: 'ОсОО «Альфа»',
      inn: '01811201810456',
      slug: 'alfa',
      owner: { fullName: 'Асанов Асан Асанович', login: 'asanov', passwordHash: 'h' },
    });
    orgId = org.orgId;
    const [admin, blocked] = await t.admin.db
      .insert(users)
      .values([
        { login: 'root', passwordHash: '!', isPlatformAdmin: true },
        { login: 'root-blocked', passwordHash: '!', isPlatformAdmin: true, blocked: true },
        { login: 'root-no-tg', passwordHash: '!', isPlatformAdmin: true },
      ])
      .returning({ id: users.id });
    adminId = admin!.id;
    await t.admin.db.insert(telegramLinks).values([
      { userId: admin!.id, orgId: null, chatId: 7001 },
      { userId: blocked!.id, orgId: null, chatId: 7002 },
      { userId: org.ownerUserId, orgId, chatId: 7003 },
    ]);
  });

  afterAll(async () => {
    await t?.drop();
  });

  it('оповещение — только незаблокированным администраторам платформы с Telegram; тот же ключ — один раз', async () => {
    expect(await platformAlert(t.app.db, { text: 'Сбой', key: 'job:x:1', now: NOW })).toBe(1);
    expect(await platformAlert(t.app.db, { text: 'Сбой', key: 'job:x:1', now: NOW })).toBe(0);
    const rows = await t.admin.db.select().from(telegramOutbox);
    expect(rows).toEqual([
      expect.objectContaining({
        orgId: null,
        userId: adminId,
        chatId: 7001,
        kind: 'alert',
        text: 'Сбой',
        status: 'pending',
        dedupeKey: `alert:job:x:1:${adminId}`,
      }),
    ]);
    // Сотрудник организации сообщения платформы в своей очереди не видит.
    const seen = await withOrgContext(t.app.db, { orgId }, (tx) =>
      tx.select().from(telegramOutbox),
    );
    expect(seen).toEqual([]);
    await expect(platformAlert(t.app.db, { text: ' ', key: 'k', now: NOW })).rejects.toThrow();
    await expect(platformAlert(t.app.db, { text: 'x', key: '', now: NOW })).rejects.toThrow();
  });

  it('слот: первая попытка, повтор только после неудачи и паузы, не больше предела; состояние задачи', async () => {
    const slot = new Date('2026-11-07T03:00:00Z');
    const claim = (now: Date) =>
      claimJobSlot(t.app.db, { job: 'j', slot, now, maxAttempts: 2, retryDelaysMinutes: [5] });
    expect(await claim(NOW)).toBe(1);
    // Идёт — не повторяется.
    expect(await claim(NOW)).toBeNull();
    await t.app.db
      .update(schedulerRuns)
      .set({ finishedAt: NOW, ok: false, error: 'x' })
      .where(eq(schedulerRuns.job, 'j'));
    expect(await claim(new Date(NOW.getTime() + 4 * 60_000))).toBeNull();
    expect(await claim(new Date(NOW.getTime() + 5 * 60_000))).toBe(2);
    await t.app.db
      .update(schedulerRuns)
      .set({ finishedAt: NOW, ok: false })
      .where(eq(schedulerRuns.job, 'j'));
    expect(await claim(new Date(NOW.getTime() + 60 * 60_000))).toBeNull();

    expect(await recordJobOutcome(t.app.db, { job: 'j', now: NOW, error: 'a' })).toMatchObject({
      lastSlot: slot,
      fails: 1,
      lastError: 'a',
    });
    expect(await setJobAlert(t.app.db, { job: 'j', alert: 'failing', now: NOW })).toBe(true);
    expect(await setJobAlert(t.app.db, { job: 'j', alert: null, now: NOW, onlyIf: 'missed' })).toBe(
      false,
    );
    expect(await recordJobOutcome(t.app.db, { job: 'j', now: NOW, error: null })).toMatchObject({
      fails: 0,
      lastOkAt: NOW,
      alert: 'failing',
    });
    expect(
      await setJobAlert(t.app.db, { job: 'j', alert: null, now: NOW, onlyIf: 'failing' }),
    ).toBe(true);
    expect((await jobStates(t.app.db)).get('j')).toMatchObject({ alert: null, alertedAt: null });
    // Зависшая попытка закрывается неудачной; её поздний итог уже не пишется.
    const hungSlot = new Date('2026-11-07T02:00:00Z');
    expect(
      await claimJobSlot(t.app.db, {
        job: 'h',
        slot: hungSlot,
        now: hungSlot,
        maxAttempts: 3,
        retryDelaysMinutes: [],
      }),
    ).toBe(1);
    expect(await hasHungJobRuns(t.app.db, NOW)).toBe(true);
    expect(
      await failHungJobRuns(t.app.db, { startedBefore: NOW, now: NOW, error: 'завис' }),
    ).toEqual([{ job: 'h', slot: hungSlot, attempts: 1, startedAt: hungSlot }]);
    expect(await hasHungJobRuns(t.app.db, NOW)).toBe(false);
    expect(
      await finishJobRun(t.app.db, { job: 'h', slot: hungSlot, attempt: 1, now: NOW, error: null }),
    ).toBe(false);
    // Роль приложения читает и пишет состояние задач (служебная таблица платформы).
    expect(await t.app.db.select().from(schedulerJobs)).toHaveLength(2);
  });

  it('блокировки входа за последний час по часам базы: логины, учётные записи, исчерпанный предел адресов (Р-8 А)', async () => {
    const base = Date.now();
    const min = (m: number) => new Date(base + m * 60_000);
    // Логин закрывается на 15 минут: в момент закрытия last_attempt_at = locked_until − 15.
    const locked = (login: string, m: number) => ({
      login,
      failures: 0,
      lockedUntil: min(m + 15),
      lastAttemptAt: min(m),
    });
    await t.admin.db
      .insert(loginAttempts)
      .values([
        locked('a', -55),
        locked('b', -5),
        locked('old', -65),
        { login: 'nolock', failures: 3, lockedUntil: null, lastAttemptAt: min(-1) },
      ]);
    await t.admin.db.insert(users).values([
      { orgId, login: 'locked-1', passwordHash: '!', loginLockedAt: min(-30) },
      { orgId, login: 'locked-old', passwordHash: '!', loginLockedAt: min(-90) },
    ]);
    // Предел 3 попытки за 10 минут: x исчерпал его раз, v — дважды (в разных отрезках по 10 минут),
    // y набрал 3 за 20 минут (нет), z — до окна (нет), у строк другого вида предела нет.
    const at = (subject: string, kind: string, ...ms: number[]) =>
      ms.map((m) => ({ kind, subject, at: min(m) }));
    await t.admin.db
      .insert(rateLimits)
      .values([
        ...at('x', 'auth_ip', -20, -18, -16),
        ...at('v', 'auth_ip', -45, -44, -43, -33, -32, -31),
        ...at('y', 'auth_ip', -40, -30, -20),
        ...at('z', 'auth_ip', -75, -72, -70),
        ...at('w', 'excel', -5, -4, -3),
      ]);
    const stats = await loginLockStats(t.app.db, {
      windowMinutes: 60,
      lockMinutes: 15,
      ip: { kind: 'auth_ip', max: 3, windowSeconds: 600 },
    });
    expect(stats).toEqual({ logins: 2, accounts: 1, ipBlocks: 3 });
  });

  it('оповещение не чаще раза в час: проверка и постановка одним шагом', async () => {
    const once = (key: string) =>
      platformAlertThrottled(t.app.db, {
        text: 'Много блокировок',
        key,
        now: NOW,
        everySeconds: 3600,
      });
    expect(await once('login-locks')).toBe(1);
    expect(await once('login-locks')).toBe(0);
    expect(await once('other-kind')).toBe(1);
    const [row] = await t.admin.db
      .select()
      .from(telegramOutbox)
      .where(like(telegramOutbox.dedupeKey, 'alert:login-locks:%'));
    expect(row).toMatchObject({
      orgId: null,
      userId: adminId,
      kind: 'alert',
      text: 'Много блокировок',
    });
    // Прошёл час — снова можно.
    await t.admin.db
      .update(telegramOutbox)
      .set({ createdAt: sql`now() - interval '61 minutes'` })
      .where(like(telegramOutbox.dedupeKey, 'alert:login-locks:%'));
    expect(await once('login-locks')).toBe(1);
    await expect(once('bad_key%')).rejects.toThrow();
  });
});
