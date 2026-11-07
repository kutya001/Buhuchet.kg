import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext } from './context';
import { createOrganization } from './organizations';
import {
  claimJobSlot,
  failHungJobRuns,
  finishJobRun,
  hasHungJobRuns,
  jobStates,
  platformAlert,
  recordJobOutcome,
  setJobAlert,
} from './scheduler';
import { schedulerJobs, schedulerRuns, telegramLinks, telegramOutbox, users } from './schema';
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
});
