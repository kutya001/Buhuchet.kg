import { hashPassword } from '@buhuchet/adapters/password';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withUserContext } from './auth';
import { withOrgContext } from './context';
import {
  addVideoGuest,
  createVideo,
  landingVideoRecords,
  openVideoSession,
  ownVideoSession,
  ownVideoViews,
  saveVideo,
  saveVideoProgress,
  setVideoDuration,
  setVideoState,
  videoRecord,
  videoRecords,
  type VideoValues,
} from './kb-video';
import { createOrganization, type CreatedOrganization } from './organizations';
import { users, videoGuestStats, videoSessions, videoViews, videos } from './schema';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  type TestDatabase,
} from './testing';

const permissionDenied = expect.objectContaining({
  cause: expect.objectContaining({ code: '42501' }),
});

const values = (patch: Partial<VideoValues> = {}): VideoValues => ({
  title: 'Как сдать отчёт',
  kind: 'instr',
  source: 'yt',
  ytId: 'dQw4w9WgXcQ',
  file: null,
  duration: 100,
  cover: null,
  description: '',
  module: 'reports',
  article: null,
  ord: 1,
  audience: 'all',
  ...patch,
});

describe.skipIf(!databaseAvailable())('Видео платформы: база', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let adminId: string;
  const asOwner = <T>(org: CreatedOrganization, fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: org.orgId, userId: org.ownerUserId }, fn);
  const asAdmin = <T>(fn: Parameters<typeof withUserContext<T>>[2]) =>
    withUserContext(db.app.db, adminId, fn);

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAccessReference(db.admin.db);
    const passwordHash = await hashPassword('Bh-4821-temp');
    const [admin] = await db.admin.db
      .insert(users)
      .values({ login: 'platform', passwordHash, isPlatformAdmin: true })
      .returning({ id: users.id });
    adminId = admin!.id;
    a = await createOrganization(db.app.db, {
      name: 'ОсОО «Альфа»',
      inn: '01811201810456',
      slug: 'alfa',
      owner: { fullName: 'Асанов Асан Асанович', login: 'asanov', passwordHash },
    });
    b = await createOrganization(db.app.db, {
      name: 'ОсОО «Бета»',
      inn: '02811201810457',
      slug: 'beta',
      owner: { fullName: 'Бекова Бермет', login: 'bekova', passwordHash },
    });
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('видео ведёт только администратор платформы; черновик и «для администраторов» сотруднику не видны', async () => {
    const live = await asAdmin((tx) => createVideo(tx, values(), true));
    const draft = await asAdmin((tx) => createVideo(tx, values({ title: 'Черновик' }), false));
    const adm = await asAdmin((tx) =>
      createVideo(tx, values({ title: 'Для администраторов', audience: 'adm' }), true),
    );
    await expect(
      asOwner(a, (tx) =>
        tx.insert(videos).values({ id: 'vx', title: 'x', kind: 'instr', source: 'yt' }),
      ),
    ).rejects.toThrow();
    const seen = (await asOwner(a, (tx) => videoRecords(tx))).map((v) => v.id);
    expect(seen).toContain(live.id);
    expect(seen).not.toContain(draft.id);
    expect(seen).not.toContain(adm.id);
    const all = (await asAdmin((tx) => videoRecords(tx))).map((v) => v.id);
    expect(all).toEqual(expect.arrayContaining([live.id, draft.id, adm.id]));
  });

  it('чужая организация не видна: просмотры и открытия видео — только своей организации', async () => {
    const v = await asAdmin((tx) => createVideo(tx, values({ title: 'Изоляция' }), true));
    const now = new Date('2026-11-08T10:00:00Z');
    const { sessionId } = await asOwner(a, (tx) => openVideoSession(tx, a.ownerUserId, v.id, now));
    await asOwner(a, async (tx) => {
      const session = await ownVideoSession(tx, sessionId, a.ownerUserId, v.id);
      await saveVideoProgress(tx, { session: session!, segs: [[0, 30]], pos: 30, duration: 100 });
    });
    // Организация Б не видит ни просмотра, ни открытия организации А.
    expect(await asOwner(b, (tx) => tx.select().from(videoViews))).toEqual([]);
    expect(await asOwner(b, (tx) => tx.select().from(videoSessions))).toEqual([]);
    expect((await asOwner(b, (tx) => ownVideoViews(tx, a.ownerUserId))).size).toBe(0);
    expect(
      await asOwner(b, (tx) => ownVideoSession(tx, sessionId, a.ownerUserId, v.id)),
    ).toBeNull();
    // Записать просмотр от имени сотрудника другой организации нельзя.
    await expect(
      asOwner(b, (tx) =>
        tx.insert(videoViews).values({ orgId: a.orgId, userId: a.ownerUserId, videoId: v.id }),
      ),
    ).rejects.toEqual(permissionDenied);
    // Своя организация видит; администратор платформы — для статистики.
    const own = await asOwner(a, (tx) => ownVideoViews(tx, a.ownerUserId, [v.id]));
    expect(own.get(v.id)?.segs).toEqual([[0, 30]]);
    const forAdmin = await asAdmin((tx) => tx.select().from(videoViews));
    expect(forAdmin.map((r) => r.orgId)).toContain(a.orgId);
  });

  it('прогресс: отрезки открытий сливаются, «Просмотрено» при 90 % — один раз', async () => {
    const v = await asAdmin((tx) => createVideo(tx, values({ title: 'Прогресс' }), true));
    const now = new Date('2026-11-08T10:00:00Z');
    const save = (sessionId: string, segs: [number, number][]) =>
      asOwner(a, async (tx) => {
        const session = await ownVideoSession(tx, sessionId, a.ownerUserId, v.id);
        return saveVideoProgress(tx, { session: session!, segs, pos: 0, duration: 100 });
      });
    const first = await asOwner(a, (tx) => openVideoSession(tx, a.ownerUserId, v.id, now));
    expect((await save(first.sessionId, [[0, 50]])).doneNow).toBe(false);
    const second = await asOwner(a, (tx) => openVideoSession(tx, a.ownerUserId, v.id, now));
    expect(second.view.opens).toBe(2);
    const done = await save(second.sessionId, [[40, 95]]);
    expect(done.doneNow).toBe(true);
    expect(done.view.segs).toEqual([[0, 95]]);
    expect(done.view.doneAt).not.toBeNull();
    const again = await save(second.sessionId, [[95, 100]]);
    expect(again.doneNow).toBe(false);
    expect(again.view.doneAt).toEqual(done.view.doneAt);
  });

  it('длительность от зрителя — только пока неизвестна; гости — только у видео на лендинге', async () => {
    const v = await asAdmin((tx) =>
      createVideo(
        tx,
        values({ title: 'Без длительности', duration: null, kind: 'pres', module: null }),
        true,
      ),
    );
    expect(await asOwner(a, (tx) => setVideoDuration(tx, v.id, 125))).toBe(true);
    expect(await asOwner(a, (tx) => setVideoDuration(tx, v.id, 300))).toBe(false);
    expect((await asAdmin((tx) => videoRecord(tx, v.id)))?.duration).toBe(125);
    // Не на лендинге — гость не считается.
    expect(await addVideoGuest(db.app.db, v.id, true, 0)).toBe(false);
    const row = await asAdmin((tx) => videoRecord(tx, v.id));
    const saved = await asAdmin((tx) =>
      saveVideo(
        tx,
        v.id,
        row!.version,
        {
          ...values({ title: row!.title, kind: 'pres', module: null }),
          cover: 'keep',
          duration: 125,
          landing: true,
          landingOrd: 1,
        },
        false,
      ),
    );
    expect(saved.ok).toBe(true);
    expect((await landingVideoRecords(db.app.db)).map((x) => x.id)).toContain(v.id);
    expect(await addVideoGuest(db.app.db, v.id, true, 0)).toBe(true);
    expect(await addVideoGuest(db.app.db, v.id, false, 150)).toBe(true);
    const [stats] = await asAdmin((tx) => tx.select().from(videoGuestStats));
    expect(stats).toMatchObject({ videoId: v.id, starts: 1, pctSum: 100 });
    // Снятое с публикации с лендинга уходит.
    const current = await asAdmin((tx) => videoRecord(tx, v.id));
    await asAdmin((tx) => setVideoState(tx, v.id, current!.version, 'off'));
    expect((await landingVideoRecords(db.app.db)).map((x) => x.id)).not.toContain(v.id);
  });
});
