import type { MemoryStorage } from '@buhuchet/adapters';
import { databaseAvailable, seedKbReference } from '@buhuchet/db/testing';
import {
  AdminNewsList,
  AdminNewsRecord,
  ApiError,
  ListValues,
  NewsAdminHistory,
  NewsFeed,
  NewsArticleOptions,
  NewsImageUploaded,
  NewsReadResult,
  NewsUnread,
  WhatsNew,
  type CreateNewsRequest,
} from '@buhuchet/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apiRequest,
  createStaffFixture,
  signIn,
  TEST_ORIGIN,
  TEST_PASSWORD,
  unzipTexts,
} from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

const day = (shift: number) => new Date(Date.now() + shift * 86_400_000).toISOString().slice(0, 10);

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);

describe.skipIf(!databaseAvailable())('«Новости»: API', () => {
  let f: Fixture;
  let owner: string;
  let acc: string;
  let ownerB: string;
  let admin: string;

  const call = (
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    cookie?: string,
    body?: unknown,
  ) => apiRequest(f.app, method, path, cookie, body);
  const ok = async (res: Response, status = 200) => {
    expect(res.status, await res.clone().text()).toBe(status);
    return res.json();
  };
  const fail = async (res: Response, status: number) => {
    expect(res.status, await res.clone().text()).toBe(status);
    return ApiError.parse(await res.json()).error;
  };
  const feed = async (cookie: string) =>
    NewsFeed.parse(await ok(await call('GET', '/api/news', cookie)));
  const unread = async (cookie: string) =>
    NewsUnread.parse(await ok(await call('GET', '/api/news/unread', cookie))).unread;

  const input = (over: Partial<CreateNewsRequest> = {}): CreateNewsRequest => ({
    title: 'Версия 1.4',
    type: 'update',
    release: '1.4',
    date: day(-2),
    short: 'Коротко о версии',
    md: '## Что нового\n- Новые отчёты\n\n## Изменено\n- \n',
    link: null,
    pinned: false,
    showOnLogin: true,
    audience: 'all',
    publish: true,
    ...over,
  });
  const create = async (over: Partial<CreateNewsRequest> = {}) =>
    AdminNewsRecord.parse(await ok(await call('POST', '/api/admin/news', admin, input(over)), 201));

  let live: AdminNewsRecord;
  let adminOnly: AdminNewsRecord;
  let draft: AdminNewsRecord;
  let future: AdminNewsRecord;
  let quiet: AdminNewsRecord;

  beforeAll(async () => {
    f = await createStaffFixture();
    // Статьи Базы знаний — для ссылки «Подробнее».
    await seedKbReference(f.t.admin.db);
    owner = await signIn(f.app, 'owner-a', TEST_PASSWORD);
    acc = await signIn(f.app, 'acc-a', TEST_PASSWORD);
    ownerB = await signIn(f.app, 'owner-b', TEST_PASSWORD);
    admin = await signIn(f.app, 'platform-admin', TEST_PASSWORD);
    live = await create();
    adminOnly = await create({ title: 'Для администраторов', audience: 'adm', release: '1.4' });
    draft = await create({ title: 'Черновик', publish: false, release: '' });
    future = await create({ title: 'Будущая', date: day(10) });
    quiet = await create({
      title: 'Объявление без окна',
      type: 'announce',
      release: '',
      showOnLogin: false,
      date: day(-3),
    });
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('лента: опубликованные с наступившей датой; «Только режим Админка» — администратору; без входа — 401', async () => {
    const own = await feed(owner);
    expect(own.items.map((n) => n.id)).toEqual([live.id, quiet.id]);
    expect(own.items[0]).toMatchObject({
      title: 'Версия 1.4',
      type: 'update',
      release: '1.4',
      read: false,
      // Пустой раздел шаблона убран при сохранении.
      md: '## Что нового\n- Новые отчёты',
    });
    const adm = await feed(admin);
    expect(adm.items.map((n) => n.id).sort()).toEqual([live.id, adminOnly.id, quiet.id].sort());
    expect(adm.items.map((n) => n.id)).not.toContain(draft.id);
    expect(adm.items.map((n) => n.id)).not.toContain(future.id);
    expect((await call('GET', '/api/news')).status).toBe(401);
    expect(await unread(owner)).toBe(2);
  });

  it('«Что нового»: непрочитанные «Показывать при входе»; показанные отмечаются, окно впервые — `first`', async () => {
    const before = WhatsNew.parse(await ok(await call('GET', '/api/news/whats-new', acc)));
    expect(before.first).toBe(true);
    expect(before.items.map((n) => n.id)).toEqual([live.id]);
    const read = NewsReadResult.parse(
      await ok(await call('POST', '/api/news/read', acc, { ids: [live.id, draft.id, future.id] })),
    );
    // Черновик и будущая не видны — их отметить нельзя.
    expect(read).toEqual({ marked: 1, unread: 1 });
    const after = WhatsNew.parse(await ok(await call('GET', '/api/news/whats-new', acc)));
    expect(after).toEqual({ items: [], first: false });
    const again = NewsReadResult.parse(
      await ok(await call('POST', '/api/news/read', acc, { ids: [live.id] })),
    );
    expect(again).toEqual({ marked: 0, unread: 1 });
    // Отметки — у каждого свои: владелец и другая организация их не видят.
    expect(await unread(owner)).toBe(2);
    expect(await unread(ownerB)).toBe(2);
    expect((await call('POST', '/api/news/read', acc, { ids: [] })).status).toBe(400);
  });

  it('«Отметить все прочитанными» — все видимые, у себя', async () => {
    const r = NewsReadResult.parse(await ok(await call('POST', '/api/news/read-all', ownerB)));
    expect(r).toEqual({ marked: 2, unread: 0 });
    expect((await feed(ownerB)).items.every((n) => n.read)).toBe(true);
    expect(await unread(owner)).toBe(2);
  });

  it('правка — только администратору платформы', async () => {
    for (const [method, path, body] of [
      ['GET', '/api/admin/news'],
      ['GET', `/api/admin/news/${live.id}`],
      ['GET', '/api/admin/news/articles'],
      ['GET', '/api/admin/news/values?col=type'],
      ['GET', '/api/admin/news/export'],
      ['GET', '/api/admin/news/history'],
      ['POST', '/api/admin/news', input()],
      ['PUT', `/api/admin/news/${live.id}`, { ...input(), version: live.version }],
      ['POST', `/api/admin/news/${draft.id}/publish`, { version: draft.version }],
      ['POST', `/api/admin/news/${live.id}/off`, { version: live.version, off: true }],
      ['DELETE', `/api/admin/news/${draft.id}?version=${draft.version}`],
    ] as const) {
      expect((await call(method, path, owner, body)).status, path).toBe(403);
    }
    expect((await call('GET', '/api/admin/news')).status).toBe(401);
  });

  it('статьи для «Подробнее» — все активные статьи Базы знаний', async () => {
    const res = await call('GET', '/api/admin/news/articles', admin);
    const { items } = NewsArticleOptions.parse(await ok(res));
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((a) => a.id && a.title)).toBe(true);
  });

  it('проверка полей: обязательные, версия при публикации, ссылка «Подробнее»', async () => {
    const field = async (over: Partial<CreateNewsRequest>) => {
      const e = await fail(await call('POST', '/api/admin/news', admin, input(over)), 400);
      return [e.code, (e.details as { field: string }).field, e.message];
    };
    expect(await field({ title: '  ' })).toEqual([
      'news_title_required',
      'title',
      'Введите заголовок',
    ]);
    expect(await field({ md: '## Что нового\n- \n' })).toEqual([
      'news_md_required',
      'md',
      'Введите подробное описание',
    ]);
    expect(await field({ release: '' })).toEqual([
      'news_version_required',
      'version',
      'Укажите версию: без неё можно только объявление',
    ]);
    expect(await field({ date: '27.10.2026' })).toEqual([
      'news_date_required',
      'date',
      'Укажите дату',
    ]);
    expect(await field({ link: { kind: 'art', id: 'nope' } })).toEqual([
      'news_link',
      'link',
      'Нет такой статьи или модуля',
    ]);
    expect(await field({ link: { kind: 'mod', id: 'nope' } })).toEqual([
      'news_link',
      'link',
      'Нет такой статьи или модуля',
    ]);
    // Черновик без версии и объявление без версии сохраняются; ссылка на модуль — да.
    const ok1 = await create({ publish: false, release: '', link: { kind: 'mod', id: 'reports' } });
    expect(ok1).toMatchObject({ status: 'draft', state: 'draft', release: null });
    expect(ok1.link).toEqual({ kind: 'mod', id: 'reports' });
    expect(
      (await call('DELETE', `/api/admin/news/${ok1.id}?version=${ok1.version}`, admin)).status,
    ).toBe(204);
  });

  it('жизнь новости: правка опубликованной — «Изменено», версия записи, публикация, снять и вернуть, удалить черновик', async () => {
    const edited = AdminNewsRecord.parse(
      await ok(
        await call('PUT', `/api/admin/news/${quiet.id}`, admin, {
          ...input({ title: 'Объявление (исправлено)', type: 'announce', release: '' }),
          showOnLogin: false,
          date: quiet.date,
          version: quiet.version,
        }),
      ),
    );
    expect(edited).toMatchObject({ title: 'Объявление (исправлено)', state: 'live' });
    expect(edited.editedAt).not.toBeNull();
    expect(edited.version).toBe(quiet.version + 1);
    expect((await feed(owner)).items.find((n) => n.id === quiet.id)?.editedAt).toBe(
      edited.editedAt,
    );

    const stale = await fail(
      await call('PUT', `/api/admin/news/${quiet.id}`, admin, {
        ...input({ type: 'announce', release: '' }),
        version: quiet.version,
      }),
      409,
    );
    expect(stale).toMatchObject({ code: 'record_changed', details: { version: edited.version } });

    // Опубликованную нельзя удалить — только снять с публикации.
    const notDraft = await fail(
      await call('DELETE', `/api/admin/news/${quiet.id}?version=${edited.version}`, admin),
      409,
    );
    expect(notDraft).toMatchObject({
      code: 'news_delete_not_draft',
      message: 'Удалить можно только черновик; опубликованную — снять с публикации',
    });
    const off = AdminNewsRecord.parse(
      await ok(
        await call('POST', `/api/admin/news/${quiet.id}/off`, admin, {
          version: edited.version,
          off: true,
        }),
      ),
    );
    expect(off.state).toBe('off');
    expect((await feed(owner)).items.map((n) => n.id)).not.toContain(quiet.id);
    const back = AdminNewsRecord.parse(
      await ok(
        await call('POST', `/api/admin/news/${quiet.id}/off`, admin, {
          version: off.version,
          off: false,
        }),
      ),
    );
    expect(back.state).toBe('live');

    // Черновик без версии из меню не публикуется: та же проверка, что в окне.
    const noVersion = await fail(
      await call('POST', `/api/admin/news/${draft.id}/publish`, admin, { version: draft.version }),
      400,
    );
    expect(noVersion.code).toBe('news_version_required');
    // Черновик снять с публикации нельзя: он ещё не опубликован.
    const offDraft = await fail(
      await call('POST', `/api/admin/news/${draft.id}/off`, admin, {
        version: draft.version,
        off: true,
      }),
      409,
    );
    expect(offDraft).toMatchObject({
      code: 'news_off_draft',
      message: 'Снять с публикации можно только опубликованную новость',
    });
    const full = AdminNewsRecord.parse(
      await ok(
        await call('PUT', `/api/admin/news/${draft.id}`, admin, {
          ...input({ title: 'Черновик', release: '1.5', date: day(-1) }),
          publish: false,
          version: draft.version,
        }),
      ),
    );
    expect(full).toMatchObject({ status: 'draft', editedAt: null });
    const published = AdminNewsRecord.parse(
      await ok(
        await call('POST', `/api/admin/news/${draft.id}/publish`, admin, {
          version: full.version,
        }),
      ),
    );
    expect(published).toMatchObject({ status: 'published', state: 'live' });
    expect(published.publishedAt).not.toBeNull();
    const again = await fail(
      await call('POST', `/api/admin/news/${draft.id}/publish`, admin, {
        version: published.version,
      }),
      409,
    );
    expect(again.code).toBe('news_not_draft');

    const temp = await create({ title: 'Удаляемый', publish: false });
    expect(
      (await call('DELETE', `/api/admin/news/${temp.id}?version=${temp.version + 1}`, admin))
        .status,
    ).toBe(409);
    expect(
      (await call('DELETE', `/api/admin/news/${temp.id}?version=${temp.version}`, admin)).status,
    ).toBe(204);
    expect((await call('GET', `/api/admin/news/${temp.id}`, admin)).status).toBe(404);

    // «История изменений · N»: новые сверху, черновик удалён — с заголовком.
    const history = NewsAdminHistory.parse(
      await ok(await call('GET', '/api/admin/news/history', admin)),
    );
    expect(history.items[0]).toMatchObject({
      kind: 'deleted',
      title: 'Удаляемый',
      actor: 'Администратор платформы',
    });
    expect(history.items[1]).toMatchObject({ kind: 'draft', title: 'Удаляемый' });
    expect(history.items.length).toBeLessThanOrEqual(12);
    expect(history.total).toBeGreaterThanOrEqual(history.items.length);
  });

  it('список Админки: все новости, состояние, «Прочитали»; значения столбца; Excel', async () => {
    const list = AdminNewsList.parse(await ok(await call('GET', '/api/admin/news?size=50', admin)));
    const byId = new Map(list.items.map((n) => [n.id, n]));
    expect(byId.get(future.id)?.state).toBe('scheduled');
    expect(byId.get(adminOnly.id)).toMatchObject({ audience: 'adm', state: 'live' });
    expect(byId.get(live.id)).toMatchObject({
      reads: 2,
      audit: { createdBy: 'Администратор платформы' },
    });
    // По умолчанию, как во всех списках, — от новых к старым по «Создано».
    const created = list.items.map((n) => n.audit.createdAt);
    expect(created).toEqual([...created].sort().reverse());

    const types = ListValues.parse(
      await ok(await call('GET', '/api/admin/news/values?col=type', admin)),
    );
    expect(types.items.map((v) => v.label)).toEqual(
      expect.arrayContaining(['Обновление', 'Объявление']),
    );
    const status = ListValues.parse(
      await ok(await call('GET', '/api/admin/news/values?col=status', admin)),
    );
    expect(status.items.map((v) => v.label)).toContain(
      `2/2 Опубликовано · появится ${future.date.split('-').reverse().join('.')} в 09:00`,
    );

    const res = await call('GET', '/api/admin/news/export?cols=date,title,type,status', admin);
    expect(res.status).toBe(200);
    const files = unzipTexts(new Uint8Array(await res.arrayBuffer()));
    const text = Object.values(files).join('');
    expect(text).toContain('Для администраторов');
    expect(text).toContain('Обновление');
  });

  it('картинка: PNG до 2 МБ в хранилище, адрес для markdown, ссылка любому вошедшему; не картинка и больше 2 МБ — нет', async () => {
    const put = (bytes: Uint8Array, cookie = admin, type = 'image/png') =>
      f.app.request('/api/admin/news/images', {
        method: 'PUT',
        headers: { origin: TEST_ORIGIN, cookie, 'content-type': type },
        body: bytes,
      });
    const up = NewsImageUploaded.parse(await ok(await put(PNG), 201));
    expect(up.url).toBe(`/api/news/images/${up.id}`);
    const files = (f.deps.storage as MemoryStorage).files;
    expect(files.get(`platform/news/${up.id}`)?.contentType).toBe('image/png');

    const link = await call('GET', up.url, acc);
    expect(link.status).toBe(302);
    expect(link.headers.get('location')).toBe(`memory://platform/news/${up.id}?expires=900`);
    expect((await call('GET', up.url)).status).toBe(401);
    expect((await call('GET', '/api/news/images/not-a-uuid', acc)).status).toBe(400);

    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect((await fail(await put(svg, admin, 'image/svg+xml'), 400)).code).toBe('news_image_type');
    const big = new Uint8Array(2 * 1048576 + 10);
    big.set(PNG);
    expect((await fail(await put(big), 413)).code).toBe('news_image_too_large');
    expect((await put(PNG, owner)).status).toBe(403);
  });
});
