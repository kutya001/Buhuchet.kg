import { schema } from '@buhuchet/db';
import { databaseAvailable } from '@buhuchet/db/testing';
import {
  AdminUiText,
  AdminUiTextList,
  ApiError,
  ListValues,
  UiDictionary,
  UiLanguages,
} from '@buhuchet/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import {
  apiRequest,
  createStaffFixture,
  createTestDeps,
  signIn,
  TEST_PASSWORD,
  unzipTexts,
} from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

describe.skipIf(!databaseAvailable())('Админка → «Локализация»', () => {
  let f: Fixture;
  let admin: string;
  let owner: string;

  beforeAll(async () => {
    f = await createStaffFixture();
    await f.t.admin.db.insert(schema.uiTexts).values([
      { key: 'nav.home', text: 'Главная', section: 'Меню' },
      { key: 'staff.count.many', text: '{n} сотрудников', section: 'Сотрудники' },
      { key: 'btn.save', text: 'Сохранить', section: 'Кнопки' },
    ]);
    admin = await signIn(f.app, 'platform-admin', TEST_PASSWORD);
    owner = await signIn(f.app, 'owner-a', TEST_PASSWORD);
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  const get = (path: string, cookie = admin) => apiRequest(f.app, 'GET', path, cookie);
  const put = (key: string, body: unknown, cookie = admin) =>
    apiRequest(f.app, 'PUT', `/api/admin/ui-texts/${encodeURIComponent(key)}`, cookie, body);
  const errorOf = async (res: Response) => ApiError.parse(await res.json()).error;

  it('только администратор платформы: сотруднику организации и без входа — отказ', async () => {
    for (const path of [
      '/api/admin/ui-texts',
      '/api/admin/ui-texts/values?col=section',
      '/api/admin/ui-texts/export?cols=key',
      '/api/admin/ui-languages',
    ]) {
      expect((await get(path, owner)).status).toBe(403);
      expect((await get(path, '')).status).toBe(401);
    }
    expect((await put('nav.home', { text: 'Взлом', version: 1 }, owner)).status).toBe(403);
    expect((await put('nav.home', { text: 'Взлом', version: 1 }, '')).status).toBe(401);
  });

  it('список словаря, значения раздела и языки: русский — 100 %', async () => {
    const list = AdminUiTextList.parse(
      await (await get('/api/admin/ui-texts?sort=key.asc')).json(),
    );
    expect(list.items.map((x) => [x.key, x.text, x.section])).toEqual([
      ['btn.save', 'Сохранить', 'Кнопки'],
      ['nav.home', 'Главная', 'Меню'],
      ['staff.count.many', '{n} сотрудников', 'Сотрудники'],
    ]);
    const sections = ListValues.parse(
      await (await get('/api/admin/ui-texts/values?col=section')).json(),
    );
    expect(sections.items.map((v) => v.value)).toEqual(['Кнопки', 'Меню', 'Сотрудники']);
    const languages = UiLanguages.parse(await (await get('/api/admin/ui-languages')).json());
    expect(languages.items).toEqual([
      { lang: 'ru', isDefault: true, enabled: true, texts: 3, total: 3, share: 100 },
    ]);
  });

  it('правка: текст сразу в словаре экранов, «было → стало» — в истории; устаревшая версия — 409', async () => {
    const res = await put('nav.home', { text: '  Рабочий стол ', version: 1 });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(AdminUiText.parse(await res.json())).toMatchObject({
      key: 'nav.home',
      text: 'Рабочий стол',
      version: 2,
      audit: { updatedBy: 'Администратор платформы' },
    });
    const dictionary = UiDictionary.parse(await (await f.app.request('/api/l10n')).json());
    expect(dictionary.texts['nav.home']).toBe('Рабочий стол');

    const history = await f.t.admin.db
      .select()
      .from(schema.platformAuditLog)
      .where(eq(schema.platformAuditLog.entityId, 'ru:nav.home'));
    expect(history).toHaveLength(1);
    expect(history[0]!.changes).toEqual([{ field: 'text', from: 'Главная', to: 'Рабочий стол' }]);

    const stale = await put('nav.home', { text: 'Главная', version: 1 });
    expect(stale.status).toBe(409);
    expect((await errorOf(stale)).code).toBe('record_changed');
    expect((await put('nav.nothing', { text: 'Нет', version: 1 })).status).toBe(404);
    const one = AdminUiText.parse(await (await get('/api/admin/ui-texts/nav.home')).json());
    expect(one).toMatchObject({ text: 'Рабочий стол', version: 2 });
    expect((await get('/api/admin/ui-texts/nav.nothing')).status).toBe(404);
    expect((await get('/api/admin/ui-texts/nav.home', owner)).status).toBe(403);
  });

  it('подстановки {…} остаются те же; пустой текст не сохраняется', async () => {
    const lost = await put('staff.count.many', { text: 'Сотрудники', version: 1 });
    expect(lost.status).toBe(400);
    expect(await errorOf(lost)).toMatchObject({
      code: 'ui_text_placeholders',
      details: { names: '{n}' },
    });
    const extra = await put('btn.save', { text: 'Сохранить {name}', version: 1 });
    expect(extra.status).toBe(400);
    expect(await errorOf(extra)).toMatchObject({
      code: 'ui_text_placeholders',
      details: { variant: 'none' },
    });
    const empty = await put('btn.save', { text: '   ', version: 1 });
    expect(empty.status).toBe(400);
    expect((await errorOf(empty)).code).toBe('validation_failed');
    const kept = await put('staff.count.many', { text: 'Сотрудников: {n}', version: 1 });
    expect(kept.status).toBe(200);
  });

  it('правка сразу видна во всех словарях процесса (страницы — другая сборка), даже если они сверяются с базой редко', async () => {
    const pages = createApp(createTestDeps({ db: f.t.app.db, l10nRecheckMs: 60_000 }));
    const before = UiDictionary.parse(await (await pages.request('/api/l10n')).json());
    const current = AdminUiText.parse(await (await get('/api/admin/ui-texts/btn.save')).json());
    const res = await put('btn.save', { text: 'Сохранить всё', version: current.version });
    expect(res.status).toBe(200);
    const after = UiDictionary.parse(await (await pages.request('/api/l10n')).json());
    expect(after.version).not.toBe(before.version);
    expect(after.texts['btn.save']).toBe('Сохранить всё');
  });

  it('выгрузка в Excel: видимые столбцы, правленый текст', async () => {
    const res = await get('/api/admin/ui-texts/export?cols=key,text,section&sort=key.asc');
    expect(res.status).toBe(200);
    const files = unzipTexts(new Uint8Array(await res.arrayBuffer()));
    const text = Object.values(files).join('');
    expect(text).toContain('Рабочий стол');
    expect(text).toContain('Сотрудников: {n}');
  });
});
