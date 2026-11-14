import type { FakeTelegram } from '@buhuchet/adapters';
import { schema } from '@buhuchet/db';
import { databaseAvailable } from '@buhuchet/db/testing';
import {
  AdminTelegramBroadcastResult,
  AdminTelegramCastCount,
  AdminTelegramCastImage,
  AdminTelegramCastOptions,
  ApiError,
} from '@buhuchet/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import type { ApiDeps } from '../../deps';
import { cookieOf, createStaffFixture, TEST_PASSWORD } from '../../testing';
import { telegramSendJob } from '../telegram/outbox';

/*
 * Оформленная рассылка (поток Т, задача Т6; прототип v103 admin/tg-cast.js): картинка, заголовок, текст
 * и кнопки «Подробнее» и «Смотреть видео» — только на записи сайта, которые видят все пользователи.
 */

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

const SITE = 'https://test.buhuchet.kg';
const CHAT_A = 700_300_001;
const CHAT_B = 700_300_002;
const noPause = async () => {};

/** Картинка PNG: подпись файла и немного данных (тип проверяется по первым байтам). */
const png = () => {
  const b = new Uint8Array(64);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return b;
};

describe.skipIf(!databaseAvailable())('Админка → «Телеграм» → оформленная рассылка (Т6)', () => {
  let f: Fixture;
  let deps: ApiDeps;
  let app: ReturnType<typeof createApp>;
  let admin: string;
  let owner: string;
  const tg = () => deps.telegram as FakeTelegram;

  beforeAll(async () => {
    f = await createStaffFixture();
    // Кнопки-ссылки бывают только у сайта по https.
    deps = { ...f.deps, config: { ...f.deps.config, APP_BASE_URL: SITE } };
    app = createApp(deps);
    // Сайт по https — cookie сеанса другое (`__Host-`): вход — на нём же.
    const signInHttps = async (login: string) =>
      cookieOf(
        await app.request('/api/auth/login', {
          method: 'POST',
          headers: { origin: SITE, 'content-type': 'application/json' },
          body: JSON.stringify({ login, password: TEST_PASSWORD }),
        }),
      );
    admin = await signInHttps('platform-admin');
    owner = await signInHttps('owner-a');
    await f.t.admin.db.insert(schema.telegramLinks).values([
      { userId: f.a.ownerUserId, orgId: f.a.orgId, chatId: CHAT_A, username: 'owner_a' },
      { userId: f.people['acc-b']!.userId, orgId: f.b.orgId, chatId: CHAT_B, username: 'acc_b' },
    ]);
    // Бухгалтер Б включил «Сообщения простым текстом».
    await f.t.admin.db
      .update(schema.users)
      .set({ telegramPlain: true })
      .where(eq(schema.users.id, f.people['acc-b']!.userId));
    const published = new Date('2026-10-01T03:00:00Z');
    await f.t.admin.db.insert(schema.videos).values([
      {
        id: 'v-intro',
        title: 'Знакомство',
        kind: 'pres',
        source: 'yt',
        ytId: 'aaaaaaaaaaa',
        status: 'published',
        publishedAt: published,
      },
      {
        id: 'v-adm',
        title: 'Для Админки',
        kind: 'pres',
        source: 'yt',
        ytId: 'bbbbbbbbbbb',
        status: 'published',
        publishedAt: published,
        audience: 'adm',
      },
      { id: 'v-draft', title: 'Черновик', kind: 'pres', source: 'yt', ytId: 'ccccccccccc' },
    ]);
    const news = (id: string, v: Partial<typeof schema.news.$inferInsert>) => ({
      id,
      title: `Новость ${id}`,
      type: 'announce',
      publishDate: '2026-10-01',
      short: `Коротко ${id}`,
      md: 'Текст',
      status: 'published',
      publishedAt: published,
      ...v,
    });
    await f.t.admin.db
      .insert(schema.news)
      .values([
        news('nlive', { linkKind: 'video', linkId: 'v-intro' }),
        news('nadmvid', { linkKind: 'video', linkId: 'v-adm' }),
        news('nadm', { audience: 'adm' }),
        news('ndraft', { status: 'draft', publishedAt: null }),
        news('nlater', { publishDate: '2026-12-01' }),
      ]);
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  const call = (
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    o: { cookie?: string; json?: unknown; bytes?: Uint8Array; type?: string } = {},
  ) =>
    app.request(path, {
      method,
      headers: {
        origin: SITE,
        ...(o.cookie !== undefined ? { cookie: o.cookie } : { cookie: admin }),
        ...(o.json !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(o.bytes ? { 'content-type': o.type ?? 'image/png' } : {}),
      },
      body: o.json !== undefined ? JSON.stringify(o.json) : o.bytes,
    });
  const errorCode = async (res: Response) => ApiError.parse(await res.json()).error.code;

  it('только администратор платформы: сотруднику организации и без входа — отказ', async () => {
    for (const cookie of [owner, '']) {
      const want = cookie ? 403 : 401;
      expect((await call('GET', '/api/admin/telegram/cast-options', { cookie })).status).toBe(want);
      expect((await call('GET', '/api/admin/telegram/broadcast/count', { cookie })).status).toBe(
        want,
      );
      expect(
        (await call('PUT', '/api/admin/telegram/images', { cookie, bytes: png() })).status,
      ).toBe(want);
    }
  });

  it('картинка: PNG сохраняется в хранилище; не картинка — 400, больше 2 МБ — 413', async () => {
    const ok = await call('PUT', '/api/admin/telegram/images', { bytes: png() });
    expect(ok.status).toBe(201);
    const { id } = AdminTelegramCastImage.parse(await ok.json());
    expect(await deps.storage.exists(`platform/telegram-cast/${id}`)).toBe(true);
    // Тип — по первым байтам, а не по заголовку запроса.
    const gif = new TextEncoder().encode('GIF89a' + ' '.repeat(40));
    const bad = await call('PUT', '/api/admin/telegram/images', { bytes: gif });
    expect(bad.status).toBe(400);
    expect(await errorCode(bad)).toBe('cast_image_type');
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set(png());
    const tooBig = await call('PUT', '/api/admin/telegram/images', { bytes: big });
    expect(tooBig.status).toBe(413);
    expect(await errorCode(tooBig)).toBe('cast_image_too_large');
  });

  it('кнопки — только на опубликованные записи для всех; число получателей — как у рассылки', async () => {
    const options = AdminTelegramCastOptions.parse(
      await (await call('GET', '/api/admin/telegram/cast-options')).json(),
    );
    expect(options.news).toEqual([
      { id: 'nadmvid', title: 'Новость nadmvid', short: 'Коротко nadmvid', video: null },
      { id: 'nlive', title: 'Новость nlive', short: 'Коротко nlive', video: 'v-intro' },
    ]);
    expect(options.videos).toEqual([{ id: 'v-intro', title: 'Знакомство' }]);
    const count = async (q = '') => {
      const r = await call('GET', `/api/admin/telegram/broadcast/count${q}`);
      return {
        status: r.status,
        body: r.status === 200 ? AdminTelegramCastCount.parse(await r.json()) : await r.json(),
      };
    };
    expect(await count()).toEqual({ status: 200, body: { count: 2 } });
    expect(await count(`?org=${f.b.orgId}`)).toEqual({ status: 200, body: { count: 1 } });
    expect((await count('?org=x')).status).toBe(400);
    await f.t.admin.db.execute(
      sql`update organizations set status = 'blocked' where id = ${f.b.orgId}`,
    );
    expect((await count(`?org=${f.b.orgId}`)).status).toBe(409);
    await f.t.admin.db.execute(
      sql`update organizations set status = 'active' where id = ${f.b.orgId}`,
    );
  });

  it('недоступная новость, статья, видео или картинка — 409, в очередь ничего не встаёт', async () => {
    const before = (await f.t.admin.db.select().from(schema.telegramOutbox)).length;
    const base = { org: null, text: 'Текст' };
    for (const [body, code] of [
      [{ ...base, more: { kind: 'news', id: 'nadm' } }, 'cast_more'],
      [{ ...base, more: { kind: 'news', id: 'ndraft' } }, 'cast_more'],
      [{ ...base, more: { kind: 'news', id: 'nlater' } }, 'cast_more'],
      [{ ...base, more: { kind: 'article', id: 'no-such' } }, 'cast_more'],
      [{ ...base, video: 'v-adm' }, 'cast_video'],
      [{ ...base, video: 'v-draft' }, 'cast_video'],
      [{ ...base, image: '0b7f8a52-8a36-4a8e-9a43-1f1f4b7a1c11' }, 'cast_image'],
    ] as const) {
      const res = await call('POST', '/api/admin/telegram/broadcast', { json: body });
      expect(res.status, JSON.stringify(body)).toBe(409);
      expect(await errorCode(res)).toBe(code);
    }
    // Свой адрес кнопки прислать нельзя; заголовок длиннее 80 и текст длиннее 900 — 400.
    for (const body of [
      { ...base, url: 'https://evil.example' },
      { ...base, more: { kind: 'url', id: 'https://evil.example' } },
      { ...base, title: 'з'.repeat(81) },
      { ...base, text: 'т'.repeat(901) },
    ]) {
      expect((await call('POST', '/api/admin/telegram/broadcast', { json: body })).status).toBe(
        400,
      );
    }
    expect((await f.t.admin.db.select().from(schema.telegramOutbox)).length).toBe(before);
  });

  it('рассылка уходит картинкой с подписью и кнопками-ссылками; картинка грузится один раз; простым текстом — та же картинка и кнопки', async () => {
    const up = await call('PUT', '/api/admin/telegram/images', { bytes: png() });
    const { id: image } = AdminTelegramCastImage.parse(await up.json());
    const res = await call('POST', '/api/admin/telegram/broadcast', {
      json: {
        org: null,
        title: 'Плановые работы <15 ноября>',
        text: '  С 22:00 до 23:00 платформа будет недоступна  ',
        image,
        more: { kind: 'news', id: 'nlive' },
        video: 'v-intro',
      },
    });
    expect(res.status).toBe(200);
    expect(AdminTelegramBroadcastResult.parse(await res.json())).toEqual({ queued: 2 });

    tg().sent.length = 0;
    tg().photos.length = 0;
    await telegramSendJob(noPause).run(deps, deps.clock.now());
    const buttons = [
      [
        { text: 'Подробнее', url: `${SITE}/app/kb/news?news=nlive` },
        { text: 'Смотреть видео', url: `${SITE}/app/kb/video?video=v-intro` },
      ],
    ];
    const byChat = new Map(tg().sent.map((m) => [m.chatId, m]));
    // Владелец А — подпись с выделенным заголовком; разметка из текста не выполняется.
    expect(byChat.get(CHAT_A)).toMatchObject({
      text: '<b>Плановые работы &lt;15 ноября&gt;</b>\nС 22:00 до 23:00 платформа будет недоступна',
      options: { html: true, keyboard: buttons },
    });
    // Бухгалтер Б — простой текст: та же картинка и кнопки, заголовок не выделен.
    expect(byChat.get(CHAT_B)).toMatchObject({
      text: 'Плановые работы <15 ноября>\nС 22:00 до 23:00 платформа будет недоступна',
      options: { keyboard: buttons },
    });
    expect(byChat.get(CHAT_B)!.options.html).toBeUndefined();
    // Первому получателю — файл, второму — номер файла у Telegram.
    expect(tg().photos.map((p) => ('bytes' in p.photo ? 'file' : 'id'))).toEqual(['file', 'id']);

    const [history] = await f.t.admin.db
      .select()
      .from(schema.platformAuditLog)
      .where(eq(schema.platformAuditLog.entity, 'telegram_broadcast'));
    expect(history!.changes).toEqual([
      { field: 'title', to: 'Плановые работы <15 ноября>' },
      {
        field: 'text',
        to: 'Плановые работы <15 ноября>\nС 22:00 до 23:00 платформа будет недоступна',
      },
      { field: 'image', to: image },
      { field: 'more', to: 'news:nlive' },
      { field: 'video', to: 'v-intro' },
      { field: 'queued', to: 2 },
    ]);
  });

  it('картинку убрали из хранилища до отправки — сообщение «Ошибка», без повторов; простое объявление — прежним текстом', async () => {
    const up = await call('PUT', '/api/admin/telegram/images', { bytes: png() });
    const { id: image } = AdminTelegramCastImage.parse(await up.json());
    await call('POST', '/api/admin/telegram/broadcast', {
      json: { org: f.b.orgId, text: 'С картинкой', image },
    });
    await deps.storage.delete(`platform/telegram-cast/${image}`);
    await call('POST', '/api/admin/telegram/broadcast', {
      json: { org: f.b.orgId, text: 'Просто' },
    });
    tg().sent.length = 0;
    await telegramSendJob(noPause).run(deps, deps.clock.now());
    expect(tg().sent.map((m) => [m.chatId, m.text, m.options.photo ?? null])).toEqual([
      [CHAT_B, 'Просто', null],
    ]);
    const rows = await f.t.admin.db
      .select()
      .from(schema.telegramOutbox)
      .where(eq(schema.telegramOutbox.kind, 'broadcast'));
    expect(rows.find((r) => r.text === 'С картинкой')).toMatchObject({ status: 'error' });
    expect(rows.find((r) => r.text === 'Просто')).toMatchObject({ status: 'sent', payload: null });
  });

  it('«Отправить в Telegram» у новости старше 20 последних: она приходит в списке, черновик и «только для Админки» — нет', async () => {
    const fresh = Array.from({ length: 20 }, (_, i) => ({
      id: `nfresh${i}`,
      title: `Свежая ${i}`,
      type: 'announce',
      publishDate: '2026-10-01',
      short: 'Коротко',
      md: 'Текст',
      status: 'published',
      // Тот же день, вышли позже — в списке выше всех прежних.
      publishedAt: new Date(Date.parse('2026-10-01T03:00:00Z') + (i + 1) * 60_000),
    }));
    await f.t.admin.db.insert(schema.news).values(fresh);
    const ids = async (q: string) =>
      AdminTelegramCastOptions.parse(
        await (await call('GET', `/api/admin/telegram/cast-options${q}`)).json(),
      ).news.map((n) => n.id);
    expect(await ids('')).not.toContain('nlive');
    expect(await ids('?news=nlive')).toContain('nlive');
    expect(await ids('?news=nlive')).toHaveLength(21);
    expect(await ids('?news=nadm')).toHaveLength(20);
    expect(await ids('?news=ndraft')).toHaveLength(20);
    expect((await call('GET', '/api/admin/telegram/cast-options?news=a%2Fb')).status).toBe(400);
    await f.t.admin.db.delete(schema.news).where(sql`${schema.news.id} like 'nfresh%'`);
  });
});
