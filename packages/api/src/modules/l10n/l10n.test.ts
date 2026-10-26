import { schema, type Db } from '@buhuchet/db';
import { createTestDatabase, databaseAvailable, type TestDatabase } from '@buhuchet/db/testing';
import { UI_TEXTS } from '@buhuchet/domain';
import { ApiError, UiDictionary } from '@buhuchet/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { createTestDeps } from '../../testing';

const { uiTexts } = schema;

async function dictionary(res: Response) {
  expect(res.status, await res.clone().text()).toBe(200);
  return UiDictionary.parse(await res.json());
}

/** База, которая падает на запросе: цепочка drizzle строится, а ожидание ответа — ошибка. */
function failingDb(): Db {
  const chain: object = new Proxy(() => chain, {
    get: (_target, prop) =>
      prop === 'then'
        ? (_resolve: unknown, reject: (err: Error) => void) => reject(new Error('база недоступна'))
        : chain,
    apply: () => chain,
  });
  return chain as Db;
}

describe('словарь текстов: без базы', () => {
  const app = createApp(createTestDeps({ db: failingDb() }));

  it('база недоступна — тексты по умолчанию, ответ не кэшируется', async () => {
    const res = await app.request('/api/l10n');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('etag')).toBeNull();
    const body = await dictionary(res);
    expect(body).toMatchObject({ lang: 'ru', version: 'default' });
    expect(body.texts['health.title']).toBe(UI_TEXTS['health.title'].ru);
  });

  it('язык, которого нет, — 400', async () => {
    const res = await app.request('/api/l10n?lang=en');
    expect(res.status).toBe(400);
    expect(ApiError.parse(await res.json()).error.code).toBe('validation_failed');
  });
});

describe.skipIf(!databaseAvailable())('словарь текстов интерфейса', () => {
  let t: TestDatabase;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    t = await createTestDatabase();
    await t.admin.db.insert(uiTexts).values([
      { key: 'nav.home', text: 'Главная', section: 'Меню' },
      { key: 'health.title', text: 'Проверка системы', section: 'Система' },
    ]);
    app = createApp(createTestDeps({ db: t.app.db }));
  });

  afterAll(async () => {
    await t?.drop();
  });

  it('открыт без входа: тексты базы поверх текстов по умолчанию, версия в ETag', async () => {
    const res = await app.request('/api/l10n');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    const body = await dictionary(res);
    expect(res.headers.get('etag')).toBe(`"${body.version}"`);
    expect(body.lang).toBe('ru');
    expect(body.texts['nav.home']).toBe('Главная');
    // Из базы, а не из UI_TEXTS.
    expect(body.texts['health.title']).toBe('Проверка системы');
    // Ключа ещё нет в базе (наполнение не запускали) — текст по умолчанию.
    expect(body.texts['health.state']).toBe(UI_TEXTS['health.state'].ru);
    expect(await dictionary(await app.request('/api/l10n?lang=ru'))).toEqual(body);
  });

  it('та же версия в If-None-Match — 304 без тела', async () => {
    const etag = (await app.request('/api/l10n')).headers.get('etag')!;
    for (const header of [etag, `W/${etag}`, `"other", ${etag}`, '*']) {
      const res = await app.request('/api/l10n', { headers: { 'if-none-match': header } });
      expect(res.status, header).toBe(304);
      expect(await res.text()).toBe('');
    }
    const other = await app.request('/api/l10n', { headers: { 'if-none-match': '"other"' } });
    expect(other.status).toBe(200);
  });

  it('текст, изменённый в таблице словаря, виден со следующего запроса — с новой версией', async () => {
    const before = await dictionary(await app.request('/api/l10n'));
    await t.admin.db
      .update(uiTexts)
      .set({ text: 'Проверка работы' })
      .where(eq(uiTexts.key, 'health.title'));
    const after = await dictionary(await app.request('/api/l10n'));
    expect(after.texts['health.title']).toBe('Проверка работы');
    expect(after.version).not.toBe(before.version);
    const stale = await app.request('/api/l10n', {
      headers: { 'if-none-match': `"${before.version}"` },
    });
    expect(stale.status).toBe(200);

    // Новый ключ и удалённый текст — тоже новая версия; без текста в базе — снова текст по умолчанию.
    await t.admin.db.insert(uiTexts).values({ key: 'x.new', text: 'Новый', section: 'Тест' });
    const added = await dictionary(await app.request('/api/l10n'));
    expect(added.texts['x.new']).toBe('Новый');
    await t.admin.db.delete(uiTexts).where(eq(uiTexts.key, 'health.title'));
    const removed = await dictionary(await app.request('/api/l10n'));
    expect(removed.version).not.toBe(added.version);
    expect(removed.texts['health.title']).toBe(UI_TEXTS['health.title'].ru);
  });
});
