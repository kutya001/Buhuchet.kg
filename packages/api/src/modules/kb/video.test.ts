import type { FixedClock, MemoryStorage } from '@buhuchet/adapters';
import { databaseAvailable, seedKbReference } from '@buhuchet/db/testing';
import {
  AdminKbStep,
  ApiError,
  VideoAdminCard,
  VideoAdminList,
  VideoAdminSaved,
  VideoCatalog,
  VideoList,
  VideoOpened,
  VideoPartLinks,
  VideoProgressSaved,
  VideoUploadChecked,
  VideoUploadStarted,
  VideoViewHistory,
  VideoViewList,
  type VideoAdminItem,
} from '@buhuchet/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readLandingDicts } from '../../landing-dicts';
import { apiRequest, createStaffFixture, signIn, TEST_ORIGIN, TEST_PASSWORD } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const text = (s: string) => [...s].map((c) => c.charCodeAt(0));
const box = (type: string, body: number[]) => [...be32(8 + body.length), ...text(type), ...body];

/** Короткий MP4: ftyp, moov с mvhd (135 с), mdat. */
function mp4(): Uint8Array {
  const ftyp = box('ftyp', [...text('isom'), 0, 0, 2, 0, ...text('isomavc1')]);
  const mvhd = box('mvhd', [
    0,
    0,
    0,
    0,
    ...be32(0),
    ...be32(0),
    ...be32(1000),
    ...be32(135_000),
    ...new Array(80).fill(0),
  ]);
  return Uint8Array.from([...ftyp, ...box('moov', mvhd), ...box('mdat', new Array(64).fill(7))]);
}

/** Начало JPEG: FF D8 FF E0 … JFIF. */
const jpeg = () =>
  Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...text('JFIF'), 0, ...new Array(64).fill(1)]);

describe.skipIf(!databaseAvailable())('Видео платформы: API', () => {
  let f: Fixture;
  let owner: string;
  let acc: string;
  let ownerB: string;
  let admin: string;

  const clock = () => f.deps.clock as FixedClock;
  const storage = () => f.deps.storage as MemoryStorage;
  const call = (
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    cookie?: string,
    body?: unknown,
  ) => apiRequest(f.app, method, path, cookie, body);
  const ok = async (res: Response, status = 200) => {
    expect(res.status, await res.clone().text()).toBe(status);
    return status === 204 ? null : res.json();
  };
  const errorOf = async (res: Response) => ApiError.parse(await res.json()).error.code;
  const fields = (patch: Record<string, unknown> = {}) => ({
    title: 'Как сдать отчёт',
    kind: 'instr',
    source: 'yt',
    yt: 'https://youtu.be/dQw4w9WgXcQ',
    ytDuration: 100,
    cover: 'none',
    description: 'Пошагово',
    module: 'reports',
    article: null,
    ord: 1,
    audience: 'all',
    ...patch,
  });
  const create = async (patch: Record<string, unknown> = {}, publish = true) =>
    VideoAdminSaved.parse(
      await ok(await call('POST', '/api/admin/videos', admin, { ...fields(patch), publish }), 201),
    ).video;
  const update = async (v: VideoAdminItem, patch: Record<string, unknown>) =>
    VideoAdminSaved.parse(
      await ok(
        await call('PUT', `/api/admin/videos/${v.id}`, admin, {
          ...fields({
            title: v.title,
            kind: v.kind,
            module: v.module,
            audience: v.audience,
            cover: 'keep',
          }),
          version: v.version,
          ...patch,
        }),
      ),
    ).video;
  const catalog = async (cookie: string) =>
    VideoCatalog.parse(await ok(await call('GET', '/api/kb/videos/all', cookie)));
  const open = async (cookie: string, id: string) =>
    VideoOpened.parse(await ok(await call('POST', `/api/kb/videos/${id}/open`, cookie)));
  const progress = (cookie: string, id: string, session: string, segs: number[][], pos = 0) =>
    call('PUT', `/api/kb/videos/${id}/sessions/${session}`, cookie, { segs, pos });
  const guest = (method: 'GET' | 'POST', path: string, body?: unknown) =>
    apiRequest(f.app, method, path, undefined, body);

  beforeAll(async () => {
    f = await createStaffFixture();
    await seedKbReference(f.t.admin.db);
    owner = await signIn(f.app, 'owner-a', TEST_PASSWORD);
    acc = await signIn(f.app, 'acc-a', TEST_PASSWORD);
    ownerB = await signIn(f.app, 'owner-b', TEST_PASSWORD);
    admin = await signIn(f.app, 'platform-admin', TEST_PASSWORD);
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('без входа — 401; Админка → «Видео» и загрузка — только администратору платформы', async () => {
    expect((await call('GET', '/api/kb/videos/all')).status).toBe(401);
    expect((await call('GET', '/api/kb/videos')).status).toBe(401);
    expect((await call('GET', '/api/kb/video-views')).status).toBe(401);
    for (const cookie of [owner, acc]) {
      expect((await call('GET', '/api/admin/videos', cookie)).status).toBe(403);
      expect(
        (await call('POST', '/api/admin/videos', cookie, { ...fields(), publish: true })).status,
      ).toBe(403);
      expect(
        (await call('POST', '/api/admin/videos/uploads', cookie, { name: 'a.mp4', size: 10 }))
          .status,
      ).toBe(403);
      expect((await call('GET', '/api/admin/video-views', cookie)).status).toBe(403);
    }
    // Неверные поля — 400 с полем.
    const bad = await call('POST', '/api/admin/videos', admin, {
      ...fields({ title: ' ' }),
      publish: true,
    });
    expect(bad.status).toBe(400);
    expect((ApiError.parse(await bad.json()).error.details as { field: string }).field).toBe(
      'title',
    );
    const noLink = await call('POST', '/api/admin/videos', admin, {
      ...fields({ yt: 'https://example.com/x' }),
      publish: true,
    });
    expect(noLink.status).toBe(400);
  });

  it('кому видно: черновик, «для администраторов» и модуль не из меню сотруднику не показываются', async () => {
    const reports = await create({ title: 'Отчёты: вкладки' });
    const draft = await create({ title: 'Черновик' }, false);
    const adm = await create({ title: 'Для администраторов', audience: 'adm' });
    const staff = await create({ title: 'Сотрудники', module: 'staff' });
    const pres = await create({ title: 'Презентация', kind: 'pres', module: null });

    const own = (await catalog(owner)).items.map((v) => v.id);
    expect(own).toEqual(expect.arrayContaining([reports.id, staff.id, pres.id]));
    expect(own).not.toContain(draft.id);
    expect(own).not.toContain(adm.id);
    // Бухгалтер не видит модуль «Сотрудники» — и его видео.
    const mine = await catalog(acc);
    expect(mine.tracked).toBe(true);
    expect(mine.items.map((v) => v.id)).not.toContain(staff.id);
    expect(mine.items.find((v) => v.id === reports.id)).toMatchObject({
      isNew: true,
      view: { opens: 0, status: 'none' },
    });
    expect((await call('POST', `/api/kb/videos/${staff.id}/open`, acc)).status).toBe(403);
    const off = await call('POST', `/api/kb/videos/${draft.id}/open`, owner);
    expect(off.status).toBe(404);
    expect(await errorOf(off)).toBe('video_off');
    // Администратор платформы видит и «для администраторов», его просмотры не учитываются.
    const forAdmin = await catalog(admin);
    expect(forAdmin.tracked).toBe(false);
    expect(forAdmin.items.map((v) => v.id)).toContain(adm.id);
    const adminOpen = await open(admin, draft.id);
    expect(adminOpen.session).toBeNull();

    // Вкладка «Видео»: страница списка и «Не просмотренные».
    const tab = VideoList.parse(await ok(await call('GET', '/api/kb/videos?size=50', owner)));
    expect(tab.tracked).toBe(true);
    expect(tab.items.map((v) => v.id)).toEqual(expect.arrayContaining([reports.id, pres.id]));
    expect(tab.unseen).toBe(tab.total);
  });

  it('просмотр: открытия, секунды не больше, чем могло проиграться, «Просмотрено» при 90 % засчитывает шаг урока', async () => {
    const v = await create({ title: 'Вкладки отчётов' });
    // Шаг «Посмотреть» урока «Отчеты для сдачи» с этим видео (Админка → «База знаний (содержимое)»).
    const step = AdminKbStep.parse(await ok(await call('GET', '/api/admin/kb/steps/rtabs', admin)));
    const stepBody = {
      g: step.g,
      t: step.t,
      w: step.w,
      learn: step.learn,
      art: step.art,
      star: step.star,
      perm: step.perm,
      featk: step.featk,
      evk: step.evk,
      active: step.active,
      version: step.version,
    };
    const unknown = await call('PUT', '/api/admin/kb/steps/rtabs', admin, {
      ...stepBody,
      video: 'net-takogo',
    });
    expect(unknown.status).toBe(400);
    await ok(await call('PUT', '/api/admin/kb/steps/rtabs', admin, { ...stepBody, video: v.id }));

    const first = await open(owner, v.id);
    expect(first.play).toEqual({ kind: 'yt', ytId: 'dQw4w9WgXcQ' });
    expect(first.video.view).toMatchObject({ opens: 1, status: 'none', pct: 0 });
    const session = first.session!;
    // Сразу после открытия 50 секунд проиграться не могли.
    const cheat = await progress(owner, v.id, session, [[0, 50]]);
    expect(cheat.status).toBe(400);
    expect(await errorOf(cheat)).toBe('video_progress_invalid');
    // Чужое открытие не принимается.
    clock().advance(30_000);
    expect((await progress(ownerB, v.id, session, [[0, 10]])).status).toBe(404);
    expect((await progress(admin, v.id, session, [[0, 10]])).status).toBe(403);

    const half = VideoProgressSaved.parse(
      await ok(await progress(owner, v.id, session, [[0, 50]], 50)),
    );
    expect(half).toMatchObject({ done: false, steps: [] });
    expect(half.view).toMatchObject({ pct: 50, status: 'started', pos: 50 });
    clock().advance(30_000);
    const done = VideoProgressSaved.parse(
      await ok(
        await progress(
          owner,
          v.id,
          session,
          [
            [0, 50],
            [50, 95],
          ],
          95,
        ),
      ),
    );
    expect(done.done).toBe(true);
    expect(done.view).toMatchObject({ pct: 95, status: 'done' });
    expect(done.steps.map((s) => s.id)).toEqual(['rtabs']);
    const again = await open(owner, v.id);
    expect(again.video.view).toMatchObject({ opens: 2, status: 'done' });
    expect((await catalog(owner)).items.find((x) => x.id === v.id)?.isNew).toBe(false);

    // «Просмотры видео»: владелец (уровни сотрудников) видит свою организацию, бухгалтер — нет права.
    const views = VideoViewList.parse(
      await ok(await call('GET', '/api/kb/video-views?size=all', owner)),
    );
    const row = views.items.find((r) => r.videoId === v.id && r.fullName === 'Владелец owner-a');
    expect(row).toMatchObject({ pct: 95, status: 'done', opens: 2 });
    expect(views.items.every((r) => r.fullName.endsWith('-a'))).toBe(true);
    expect((await call('GET', '/api/kb/video-views', acc)).status).toBe(403);
    // Чужая организация не видна.
    const other = VideoViewList.parse(
      await ok(await call('GET', '/api/kb/video-views?size=all', ownerB)),
    );
    expect(other.items.length).toBeGreaterThan(0);
    expect(other.items.every((r) => r.fullName.endsWith('-b'))).toBe(true);
    expect(other.items.find((r) => r.videoId === v.id && r.status !== 'none')).toBeUndefined();
    const history = VideoViewHistory.parse(
      await ok(await call('GET', `/api/kb/video-views/${row!.userId}/${v.id}`, owner)),
    );
    expect(history.sessions.length).toBe(2);
    expect((await call('GET', `/api/kb/video-views/${row!.userId}/${v.id}`, ownerB)).status).toBe(
      404,
    );

    // Администратор платформы: все организации и сводка по видео.
    const all = VideoViewList.parse(
      await ok(await call('GET', '/api/admin/video-views?size=all', admin)),
    );
    expect(new Set(all.items.map((r) => r.orgName))).toEqual(
      new Set(['Организация А', 'Организация Б']),
    );
    expect(all.summary?.find((s) => s.videoId === v.id)).toMatchObject({ viewers: 1, done: 1 });
  });

  it('загрузка файла частями: проверка содержимого, файл играет по подписанной ссылке, замена и удаление', async () => {
    const bytes = mp4();
    const started = VideoUploadStarted.parse(
      await ok(
        await call('POST', '/api/admin/videos/uploads', admin, {
          name: 'Знакомство.mp4',
          size: bytes.length,
          type: 'video/mp4',
        }),
        201,
      ),
    );
    expect(started.parts).toBe(1);
    expect(
      (await call('POST', '/api/admin/videos/uploads', admin, { name: 'вирус.exe', size: 10 }))
        .status,
    ).toBe(400);
    const links = VideoPartLinks.parse(
      await ok(
        await call('POST', `/api/admin/videos/uploads/${started.id}/parts`, admin, {
          numbers: [1],
        }),
      ),
    );
    const uploadId = new URL(
      links.links[0]!.url.replace('memory://', 'http://x/'),
    ).searchParams.get('uploadId')!;
    // Видео нельзя сохранить, пока файл не проверен.
    const early = await call('POST', '/api/admin/videos', admin, {
      ...fields({ source: 'file', upload: started.id, yt: undefined }),
      publish: true,
    });
    expect(early.status).toBe(400);
    storage().putPart(uploadId, 1, bytes);
    const checked = VideoUploadChecked.parse(
      await ok(await call('POST', `/api/admin/videos/uploads/${started.id}/complete`, admin)),
    );
    expect(checked).toMatchObject({ type: 'video/mp4', duration: 135 });

    const cover = await f.app.request('/api/admin/videos/covers', {
      method: 'POST',
      headers: { origin: TEST_ORIGIN, cookie: admin, 'content-type': 'image/jpeg' },
      body: jpeg(),
    });
    const coverId = ((await ok(cover, 201)) as { id: string }).id;
    const notJpeg = await f.app.request('/api/admin/videos/covers', {
      method: 'POST',
      headers: { origin: TEST_ORIGIN, cookie: admin, 'content-type': 'image/jpeg' },
      body: Uint8Array.from(text('<svg></svg>')),
    });
    expect(notJpeg.status).toBe(400);

    const v = await create({
      title: 'Знакомство',
      kind: 'pres',
      module: null,
      source: 'file',
      yt: undefined,
      ytDuration: undefined,
      upload: started.id,
      cover: { upload: coverId, kind: 'own' },
    });
    expect(v).toMatchObject({
      source: 'file',
      fileName: 'Знакомство.mp4',
      duration: 135,
      coverKind: 'own',
    });
    const opened = await open(owner, v.id);
    expect(opened.play.kind).toBe('file');
    expect(opened.play.kind === 'file' && opened.play.url).toMatch(
      /^memory:\/\/platform\/videos\//,
    );
    const coverLink = await call('GET', `/api/kb/videos/${v.id}/cover`, owner);
    expect(coverLink.status).toBe(302);

    // Файл, который не видео, не принимается и удаляется из хранилища.
    const junk = new Uint8Array(200).fill(9);
    const s2 = VideoUploadStarted.parse(
      await ok(
        await call('POST', '/api/admin/videos/uploads', admin, {
          name: 'x.mp4',
          size: junk.length,
        }),
        201,
      ),
    );
    const l2 = VideoPartLinks.parse(
      await ok(
        await call('POST', `/api/admin/videos/uploads/${s2.id}/parts`, admin, { numbers: [1] }),
      ),
    );
    storage().putPart(
      new URL(l2.links[0]!.url.replace('memory://', 'http://x/')).searchParams.get('uploadId')!,
      1,
      junk,
    );
    const rejected = await call('POST', `/api/admin/videos/uploads/${s2.id}/complete`, admin);
    expect(rejected.status).toBe(400);
    expect(await errorOf(rejected)).toBe('video_not_video');
    expect([...storage().files.keys()].some((k) => k.includes(s2.id))).toBe(false);

    // Карточка, список, удаление: опубликованное не удаляется, снятое — да, файл и обложка уходят.
    const card = VideoAdminCard.parse(
      await ok(await call('GET', `/api/admin/videos/${v.id}`, admin)),
    );
    expect(card.history.map((h) => h.kind)).toEqual(expect.arrayContaining(['upload', 'publish']));
    const list = VideoAdminList.parse(
      await ok(await call('GET', '/api/admin/videos?size=all', admin)),
    );
    expect(list.items.map((x) => x.id)).toContain(v.id);
    expect((await call('GET', '/api/admin/videos/options', admin)).status).toBe(200);
    expect(
      (await call('DELETE', `/api/admin/videos/${v.id}?version=${v.version}`, admin)).status,
    ).toBe(400);
    const offed = VideoAdminSaved.parse(
      await ok(
        await call('POST', `/api/admin/videos/${v.id}/off`, admin, {
          version: v.version,
          off: true,
        }),
      ),
    ).video;
    expect((await call('POST', `/api/kb/videos/${v.id}/open`, owner)).status).toBe(404);
    const keysBefore = [...storage().files.keys()].filter((k) => k.includes('platform/video'));
    await ok(
      await call('DELETE', `/api/admin/videos/${v.id}?version=${offed.version}`, admin),
      204,
    );
    const keysAfter = [...storage().files.keys()].filter((k) => k.includes('platform/video'));
    expect(keysAfter.length).toBe(keysBefore.length - 2);
  });

  it('лендинг: только опубликованное «На лендинге» видео, без входа; гости — запуски и средний процент', async () => {
    const pres = await create({ title: 'О Buhuchet.kg', kind: 'pres', module: null });
    const hidden = await create({ title: 'Не на лендинге', kind: 'pres', module: null });
    // Новое видео на лендинг не попадает — отметка доступна только у опубликованного.
    expect(pres.landing).toBe(false);
    const shown = await update(pres, { landing: true, landingOrd: 1 });
    expect(shown.landing).toBe(true);

    const dicts = await readLandingDicts(f.t.app.db);
    expect(dicts.videos.map((v) => v.id)).toContain(pres.id);
    expect(dicts.videos.map((v) => v.id)).not.toContain(hidden.id);
    expect(dicts.videos.find((v) => v.id === pres.id)).not.toHaveProperty('fileKey');

    expect(await ok(await guest('GET', `/api/landing/videos/${pres.id}/play`))).toEqual({
      kind: 'yt',
      ytId: 'dQw4w9WgXcQ',
    });
    expect((await guest('GET', `/api/landing/videos/${hidden.id}/play`)).status).toBe(404);
    expect((await guest('POST', `/api/landing/videos/${hidden.id}/start`)).status).toBe(404);
    expect((await guest('GET', `/api/landing/videos/${pres.id}/cover`)).status).toBe(404);
    await ok(await guest('POST', `/api/landing/videos/${pres.id}/start`), 204);
    await ok(await guest('POST', `/api/landing/videos/${pres.id}/watched`, { pct: 40 }), 204);
    expect(
      (await guest('POST', `/api/landing/videos/${pres.id}/watched`, { pct: 400 })).status,
    ).toBe(400);
    // Без входа другие методы видео закрыты.
    expect((await guest('POST', `/api/kb/videos/${pres.id}/open`)).status).toBe(401);

    const all = VideoViewList.parse(await ok(await call('GET', '/api/admin/video-views', admin)));
    expect(all.guests?.find((g) => g.videoId === pres.id)).toMatchObject({ starts: 1, avgPct: 40 });
  });
});
