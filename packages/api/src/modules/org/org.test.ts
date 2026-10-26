import type { MemoryStorage } from '@buhuchet/adapters';
import { schema } from '@buhuchet/db';
import { databaseAvailable } from '@buhuchet/db/testing';
import { LOGO_MAX_BYTES } from '@buhuchet/domain';
import { ApiError, MeResponse, OrgPolicy, OrgPolicyHistory, OrgProfile } from '@buhuchet/shared';
import { and, desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_ORIGIN, TEST_PASSWORD } from '../../testing';

const { auditLog, organizations } = schema;

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 5, 6, 7, 8]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');

async function apiErr(res: Response) {
  return ApiError.parse(await res.json()).error;
}

describe.skipIf(!databaseAvailable())('Моя организация: API', () => {
  let f: Fixture;
  let owner: string;
  let acc: string;
  let hr: string;
  let ownerB: string;
  let admin: string;

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    cookie?: string,
    body?: unknown,
  ) => apiRequest(f.app, method, path, cookie, body);

  async function profile(cookie = owner): Promise<OrgProfile> {
    const res = await call('GET', '/api/org', cookie);
    expect(res.status).toBe(200);
    return OrgProfile.parse(await res.json());
  }

  async function policy(cookie = owner): Promise<OrgPolicy> {
    const res = await call('GET', '/api/org/policy', cookie);
    expect(res.status).toBe(200);
    return OrgPolicy.parse(await res.json());
  }

  async function me(cookie: string): Promise<MeResponse> {
    return MeResponse.parse(await (await call('GET', '/api/auth/me', cookie)).json());
  }

  const patchProfile = async (body: Record<string, unknown>, cookie = owner) =>
    call('PATCH', '/api/org', cookie, { version: (await profile()).version, ...body });

  const patchPolicy = async (body: Record<string, unknown>, cookie = owner) =>
    call('PATCH', '/api/org/policy', cookie, { version: (await policy()).version, ...body });

  const putLogo = (bytes: Uint8Array, version: number, cookie = owner, type = 'image/png') =>
    f.app.request(`/api/org/logo?version=${version}`, {
      method: 'PUT',
      headers: { origin: TEST_ORIGIN, cookie, 'content-type': type },
      body: bytes,
    });

  const files = () => (f.deps.storage as MemoryStorage).files;

  beforeAll(async () => {
    f = await createStaffFixture();
    owner = await signIn(f.app, 'owner-a', TEST_PASSWORD);
    acc = await signIn(f.app, 'acc-a', TEST_PASSWORD);
    hr = await signIn(f.app, 'hr-a', TEST_PASSWORD);
    ownerB = await signIn(f.app, 'owner-b', TEST_PASSWORD);
    admin = await signIn(f.app, 'platform-admin', TEST_PASSWORD);
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  describe('«Основное»', () => {
    it('видят все сотрудники своей организации; чужая организация не видна', async () => {
      const own = await profile(owner);
      expect(own).toMatchObject({
        id: f.a.orgId,
        name: 'Организация А',
        inn: '01811201810456',
        slug: 'org-a',
        logoUrl: null,
        version: 1,
      });
      expect(await profile(acc)).toEqual(own);
      expect((await profile(ownerB)).id).toBe(f.b.orgId);
      expect((await call('GET', '/api/org')).status).toBe(401);
      expect((await call('GET', '/api/org', admin)).status).toBe(403);
    });

    it('бухгалтер видит профиль, но изменить не может (403)', async () => {
      for (const cookie of [acc, hr, admin]) {
        const res = await patchProfile({ name: 'Взлом' }, cookie);
        expect(res.status).toBe(403);
        expect(await apiErr(res)).toMatchObject({ code: 'forbidden' });
      }
      expect((await profile()).name).toBe('Организация А');
    });

    it('владелец меняет название, ИНН, адрес, телефон и руководителя — с историей и версией', async () => {
      const res = await patchProfile({
        name: '  ОсОО «Ахти»  ',
        inn: '01811201810999',
        address: 'г. Бишкек, ул. Токтогула, 1',
        phone: '+996555100200',
        head: 'Ахтиев Ахти',
      });
      expect(res.status, await res.clone().text()).toBe(200);
      expect(OrgProfile.parse(await res.json())).toMatchObject({
        name: 'ОсОО «Ахти»',
        inn: '01811201810999',
        address: 'г. Бишкек, ул. Токтогула, 1',
        phone: '+996555100200',
        head: 'Ахтиев Ахти',
        version: 2,
        audit: { updatedBy: 'owner-a В.' },
      });
      const [entry] = await f.t.admin.db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.entity, 'organization'), eq(auditLog.action, 'update')));
      expect(entry?.changes.map((c) => c.field)).toEqual([
        'name',
        'inn',
        'address',
        'phone',
        'head',
      ]);

      // Пустая строка очищает необязательное поле.
      const cleared = await patchProfile({ head: '' });
      expect(OrgProfile.parse(await cleared.json()).head).toBeNull();
    });

    it('неверные данные — тексты прототипа', async () => {
      const cases: [Record<string, unknown>, string, string][] = [
        [{ name: '  ' }, 'name_required', 'Введите название'],
        [{ inn: '123' }, 'inn_invalid', 'ИНН — 14 цифр'],
        [{ inn: '02811201810457' }, 'inn_taken', 'Организация с таким ИНН уже есть'],
        [{ phone: '+99655510020' }, 'invalid_phone', 'Номер — 9 цифр после кода страны'],
      ];
      for (const [body, code, message] of cases) {
        const res = await patchProfile(body);
        expect(res.status, code).toBe(400);
        expect(await apiErr(res)).toMatchObject({ code, message });
      }
    });

    it('адрес страницы: занятое слово программы и адрес другой организации не сохраняются, «ahti» — сохраняется', async () => {
      const cases: [string, string, string][] = [
        ['admin', 'slug_reserved', 'Этот адрес занят, выберите другой'],
        ['api', 'slug_reserved', 'Этот адрес занят, выберите другой'],
        ['org-b', 'slug_taken', 'Такой адрес уже занят другой организацией'],
        ['ah', 'slug_invalid', '3–30 символов: строчные латинские буквы, цифры и дефис'],
        ['ах-ти', 'slug_invalid', '3–30 символов: строчные латинские буквы, цифры и дефис'],
      ];
      for (const [slug, code, message] of cases) {
        const res = await patchProfile({ slug });
        expect(res.status, slug).toBe(400);
        expect(await apiErr(res)).toMatchObject({ code, message });
      }
      expect((await profile()).slug).toBe('org-a');

      const res = await patchProfile({ slug: ' AHTI ' });
      expect(res.status).toBe(200);
      expect(OrgProfile.parse(await res.json()).slug).toBe('ahti');
      expect((await me(acc)).organization?.slug).toBe('ahti');
    });

    it('устаревшая версия — 409, статус организации правкой не меняется', async () => {
      const stale = await call('PATCH', '/api/org', owner, { version: 1, name: 'Старое' });
      expect(stale.status).toBe(409);
      expect(await apiErr(stale)).toMatchObject({ code: 'record_changed' });

      const before = await profile();
      const res = await patchProfile({ status: 'blocked', blockedReason: 'x', isDemo: true });
      expect(res.status).toBe(200);
      expect(OrgProfile.parse(await res.json()).version).toBe(before.version);
      const [row] = await f.t.admin.db
        .select()
        .from(organizations)
        .where(eq(organizations.id, f.a.orgId));
      expect(row).toMatchObject({ status: 'active', blockedReason: null, isDemo: false });
    });
  });

  describe('логотип', () => {
    it('владелец загружает PNG до 2 МБ, все сотрудники видят картинку', async () => {
      const res = await putLogo(PNG, (await profile()).version);
      expect(res.status, await res.clone().text()).toBe(200);
      const { logoUrl } = OrgProfile.parse(await res.json());
      expect(logoUrl).toMatch(/^\/api\/org\/logo\?v=[0-9a-f-]{36}$/);
      expect([...files().keys()]).toEqual([expect.stringMatching(`^org/${f.a.orgId}/logo/`)]);

      for (const cookie of [owner, acc]) {
        const img = await f.app.request(logoUrl!, { headers: { cookie } });
        expect(img.status).toBe(200);
        expect(img.headers.get('content-type')).toBe('image/png');
        expect(img.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
        expect(img.headers.get('content-security-policy')).toContain('sandbox');
        expect(new Uint8Array(await img.arrayBuffer())).toEqual(PNG);
      }
      const plain = await f.app.request('/api/org/logo', { headers: { cookie: acc } });
      expect(plain.headers.get('cache-control')).toBe('private, no-cache');
      expect((await f.app.request(logoUrl!)).status).toBe(401);

      // У организации Б логотипа нет — чужой не отдаётся; со своим каждая получает только свою картинку.
      expect((await f.app.request(logoUrl!, { headers: { cookie: ownerB } })).status).toBe(404);
      const versionB = (await profile(ownerB)).version;
      expect((await putLogo(JPEG, versionB, ownerB, 'image/jpeg')).status).toBe(200);
      const own = await f.app.request('/api/org/logo', { headers: { cookie: ownerB } });
      expect(new Uint8Array(await own.arrayBuffer())).toEqual(JPEG);
      const mine = await f.app.request('/api/org/logo', { headers: { cookie: acc } });
      expect(new Uint8Array(await mine.arrayBuffer())).toEqual(PNG);
      const versionB2 = (await profile(ownerB)).version;
      expect((await call('DELETE', `/api/org/logo?version=${versionB2}`, ownerB)).status).toBe(200);

      // В историю — только факт загрузки, без ключа хранилища.
      const [entry] = await f.t.admin.db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.entity, 'organization'), eq(auditLog.entityId, f.a.orgId)))
        .orderBy(desc(auditLog.id))
        .limit(1);
      expect(entry?.changes).toEqual([{ field: 'logoKey' }]);
    });

    it('не картинка, больше 2 МБ, без права, устаревшая версия — отказ, лишних файлов нет', async () => {
      const version = (await profile()).version;
      const svg = await putLogo(SVG, version, owner, 'image/png');
      expect(svg.status).toBe(400);
      expect(await apiErr(svg)).toMatchObject({
        code: 'logo_type',
        message: 'Логотип — картинка PNG или JPG',
      });

      const big = new Uint8Array(LOGO_MAX_BYTES + 1);
      big.set(PNG);
      const tooBig = await putLogo(big, version);
      expect(tooBig.status).toBe(413);
      expect(await apiErr(tooBig)).toMatchObject({
        code: 'logo_too_large',
        message: 'Файл больше 2 МБ',
      });

      expect((await putLogo(PNG, version, acc)).status).toBe(403);
      // Свой предел тела у логотипа — после проверки входа и права: большое тело без них — 401 и 403.
      const over = new Uint8Array(1024 * 1024 + 10);
      expect((await putLogo(over, version, acc)).status).toBe(403);
      const anonymous = await f.app.request(`/api/org/logo?version=${version}`, {
        method: 'PUT',
        headers: { origin: TEST_ORIGIN, 'content-type': 'image/png' },
        body: over,
      });
      expect(anonymous.status).toBe(401);
      const stale = await putLogo(JPEG, version - 1, owner, 'image/jpeg');
      expect(stale.status).toBe(409);
      expect(files().size).toBe(1);
    });

    it('новый логотип заменяет прежний файл; «Убрать» стирает логотип и файл', async () => {
      const oldKey = [...files().keys()][0]!;
      const replaced = await putLogo(JPEG, (await profile()).version, owner, 'image/jpeg');
      expect(replaced.status).toBe(200);
      expect(files().has(oldKey)).toBe(false);
      expect(files().size).toBe(1);
      const { logoUrl } = OrgProfile.parse(await replaced.json());
      const img = await f.app.request(logoUrl!, { headers: { cookie: acc } });
      expect(img.headers.get('content-type')).toBe('image/jpeg');

      expect(
        (await call('DELETE', `/api/org/logo?version=${(await profile()).version}`, acc)).status,
      ).toBe(403);
      const removed = await call(
        'DELETE',
        `/api/org/logo?version=${(await profile()).version}`,
        owner,
      );
      expect(removed.status).toBe(200);
      expect(OrgProfile.parse(await removed.json()).logoUrl).toBeNull();
      expect(files().size).toBe(0);
      expect((await f.app.request('/api/org/logo', { headers: { cookie: acc } })).status).toBe(404);
    });
  });

  describe('учётная политика и настройки', () => {
    it('видят все сотрудники, меняет только владелец', async () => {
      expect(await policy(acc)).toMatchObject({
        features: { tasks: true, calendar: true, projects: false, cppage: false },
        remindDays: [7, 3],
        taskConfirm: true,
        reportConfirm: true,
        confirmWaitDays: 3,
        payBeforeSubmit: true,
        timezone: 'Asia/Bishkek',
        digestTime: '09:00',
        overdueRepeat: true,
        defaultRoleId: f.templateRole(f.a, 'acc'),
        version: 1,
      });
      for (const cookie of [acc, hr, admin]) {
        expect((await patchPolicy({ taskConfirm: false }, cookie)).status).toBe(403);
      }
    });

    it('выключенный модуль пропадает из меню у всех, включённый — появляется', async () => {
      expect((await me(acc)).modules).not.toContain('projects');
      const on = await patchPolicy({ features: { projects: true } });
      expect(on.status, await on.clone().text()).toBe(200);
      expect((await me(acc)).modules).toContain('projects');
      expect((await me(owner)).modules).toContain('projects');

      const off = await patchPolicy({ features: { projects: false, tasks: false } });
      expect(off.status).toBe(200);
      for (const cookie of [acc, owner]) {
        const { modules, features } = await me(cookie);
        expect(modules).not.toContain('projects');
        expect(modules).not.toContain('tasks');
        expect(features).toMatchObject({ projects: false, tasks: false });
        expect(modules).toEqual(expect.arrayContaining(['home', 'dicts', 'org', 'kb']));
      }
      // У другой организации ничего не изменилось.
      expect((await me(ownerB)).modules).toContain('tasks');
    });

    it('функция, нужная другой, не выключается; без нужной — не включается', async () => {
      const alone = await patchPolicy({ features: { accounts: true } });
      expect(alone.status).toBe(400);
      expect(await apiErr(alone)).toMatchObject({
        code: 'feature_requires',
        message: 'Сначала включите «Учёт оплаты налогов»',
      });
      expect((await patchPolicy({ features: { taxpay: true, accounts: true } })).status).toBe(200);
      const needed = await patchPolicy({ features: { taxpay: false } });
      expect(needed.status).toBe(400);
      expect(await apiErr(needed)).toMatchObject({
        code: 'feature_required_by',
        message:
          'Сначала отключите «Виртуальные счета и бонусы» — она работает только вместе с этой функцией',
      });
      expect((await policy()).features).toMatchObject({ taxpay: true, accounts: true });
    });

    it('дни напоминаний, подтверждения, разделы страницы и настройки', async () => {
      const res = await patchPolicy({
        remindDays: [3, 14, 7, 3],
        taskConfirm: false,
        reportConfirm: false,
        confirmWaitDays: 5,
        payBeforeSubmit: false,
        pageSections: ['contacts', 'pay'],
        timezone: 'Asia/Almaty',
        digestTime: '18:30',
        overdueRepeat: false,
        defaultRoleId: f.templateRole(f.a, 'chief'),
      });
      expect(res.status, await res.clone().text()).toBe(200);
      expect(OrgPolicy.parse(await res.json())).toMatchObject({
        remindDays: [14, 7, 3],
        taskConfirm: false,
        reportConfirm: false,
        confirmWaitDays: 5,
        payBeforeSubmit: false,
        pageSections: ['pay', 'contacts'],
        timezone: 'Asia/Almaty',
        digestTime: '18:30',
        overdueRepeat: false,
        defaultRoleId: f.templateRole(f.a, 'chief'),
        audit: { updatedBy: 'owner-a В.' },
      });

      // Те же значения — без новой версии и записи в истории.
      const before = await policy();
      const same = await patchPolicy({ digestTime: '18:30', remindDays: [14, 7, 3] });
      expect(OrgPolicy.parse(await same.json()).version).toBe(before.version);
      expect((await patchPolicy({ remindDays: [] })).status).toBe(200);
      expect((await policy()).remindDays).toEqual([]);
    });

    it('неверные дни и роль по умолчанию — отказ', async () => {
      const cases: [Record<string, unknown>, number, string][] = [
        [{ remindDays: [0] }, 400, 'remind_days_invalid'],
        [{ remindDays: [61] }, 400, 'remind_days_invalid'],
        [{ confirmWaitDays: 31 }, 400, 'confirm_wait_days_invalid'],
        [
          { defaultRoleId: f.b.roles.find((r) => r.templateCode === 'acc')!.id },
          400,
          'role_not_found',
        ],
        [{ defaultRoleId: f.a.roles.find((r) => r.isOwner)!.id }, 400, 'default_role_owner'],
        [{ timezone: 'Mars/Olympus' }, 400, 'validation_failed'],
        [{ digestTime: '25:00' }, 400, 'validation_failed'],
      ];
      for (const [body, status, code] of cases) {
        const res = await patchPolicy(body);
        expect(res.status, code).toBe(status);
        expect((await apiErr(res)).code).toBe(code);
      }
      expect(
        await apiErr(await call('PATCH', '/api/org/policy', owner, { version: 1 })),
      ).toMatchObject({ code: 'record_changed' });
    });

    it('история учётной политики: сначала новые, кто и было → стало; видна всем, чужая — нет', async () => {
      const res = await call('GET', '/api/org/policy/history', acc);
      expect(res.status).toBe(200);
      const { total, items } = OrgPolicyHistory.parse(await res.json());
      expect(total).toBe(items.length);
      expect(items[0]).toMatchObject({
        actor: 'owner-a В.',
        action: 'update',
        changes: [{ field: 'remindDays', from: [14, 7, 3], to: [] }],
      });
      expect(items.at(-1)).toMatchObject({ action: 'create', actor: null });
      expect(items.some((h) => h.changes.some((c) => c.field === 'features'))).toBe(true);

      // Изменения вкладки «Настройки» — не в истории учётной политики (как в прототипе).
      const fields = items.flatMap((h) => h.changes.map((c) => c.field));
      for (const field of ['timezone', 'digestTime', 'overdueRepeat', 'defaultRoleId']) {
        expect(fields).not.toContain(field);
      }
      expect(await patchPolicy({ timezone: 'Europe/Moscow' }).then((r) => r.status)).toBe(200);
      const after = OrgPolicyHistory.parse(
        await (await call('GET', '/api/org/policy/history', acc)).json(),
      );
      expect(after.total).toBe(total);

      const other = await call('GET', '/api/org/policy/history', ownerB);
      expect(OrgPolicyHistory.parse(await other.json()).items).toEqual([
        expect.objectContaining({ action: 'create' }),
      ]);
    });
  });
});
