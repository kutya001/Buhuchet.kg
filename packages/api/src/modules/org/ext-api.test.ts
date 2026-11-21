import { schema } from '@buhuchet/db';
import { databaseAvailable } from '@buhuchet/db/testing';
import { DmTokenCard, DmTokenIssued, OrgExtApi, OrgPolicy } from '@buhuchet/shared';
import { and, desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';

/*
 * «Моя организация» → «Настройки» → «Внешний доступ по API» (доработки 20.11.2026: Витрина данных,
 * блок 5, пункт 9; общий план 20.11, этап 3, П2; прототип v155 `dmApiBox`, `dmApiMount`): сначала
 * выключен, меняет только владелец (поле `extApi` учётной политики, с версией и историей организации),
 * в демо-организации — никто; выключение останавливает токены, включение — снова выпуск и ответы.
 */

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;
const { auditLog, dmTemplates, organizations } = schema;

describe.skipIf(!databaseAvailable())('Моя организация: «Внешний доступ по API»', () => {
  let f: Fixture;
  const cookies: Record<string, string> = {};
  let template = '';

  const call = (
    login: string | null,
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
  ) => apiRequest(f.app, method, path, login ? cookies[login] : undefined, body);
  const ok = async <T>(res: Response, status: number, parse: { parse: (v: unknown) => T }) => {
    expect(res.status, await res.clone().text()).toBe(status);
    return parse.parse(await res.json());
  };
  const errCode = async (res: Response) =>
    ((await res.json()) as { error: { code: string } }).error.code;
  const policy = async (login = 'owner-a') =>
    ok(await call(login, 'GET', '/api/org/policy'), 200, OrgPolicy);
  const extApi = async (login = 'owner-a') =>
    ok(await call(login, 'GET', '/api/org/ext-api'), 200, OrgExtApi);
  const setExtApi = async (on: boolean, login = 'owner-a') =>
    call(login, 'PATCH', '/api/org/policy', { version: (await policy(login)).version, extApi: on });
  const lastHistory = async (orgId: string) => {
    const [row] = await f.t.admin.db
      .select({ changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.entity, 'org_settings'), eq(auditLog.entityId, orgId)))
      .orderBy(desc(auditLog.id))
      .limit(1);
    return row?.changes;
  };

  beforeAll(async () => {
    f = await createStaffFixture();
    for (const login of ['owner-a', 'acc-a', 'hr-a', 'owner-b', 'platform-admin']) {
      cookies[login] = await signIn(f.app, login, TEST_PASSWORD);
    }
    const [t] = await f.t.admin.db
      .insert(dmTemplates)
      .values({
        code: 'ext-api-rep',
        name: 'Шаблон ext-api',
        module: 'reports',
        state: 'published',
      })
      .returning({ id: dmTemplates.id });
    template = t!.id;
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('сначала выключен; блок видят все сотрудники, Админке и без входа — нет', async () => {
    for (const login of ['owner-a', 'acc-a', 'owner-b']) {
      expect((await policy(login)).extApi, login).toBe(false);
      expect(await extApi(login), login).toEqual({ demo: false, activeTokens: 0 });
    }
    expect((await call('platform-admin', 'GET', '/api/org/ext-api')).status).toBe(403);
    expect((await call(null, 'GET', '/api/org/ext-api')).status).toBe(401);
  });

  it('меняет только владелец своей организации — с версией и записью в историю; тот же — без новой версии; устаревшая версия — 409', async () => {
    for (const login of ['acc-a', 'hr-a', 'platform-admin']) {
      const res = await call(login, 'PATCH', '/api/org/policy', {
        version: (await policy()).version,
        extApi: true,
      });
      expect(res.status, login).toBe(403);
    }
    expect((await policy()).extApi).toBe(false);

    const before = await policy();
    const saved = await ok(await setExtApi(true), 200, OrgPolicy);
    expect(saved).toMatchObject({ extApi: true, version: before.version + 1 });
    expect((await policy('acc-a')).extApi).toBe(true);
    expect((await policy('owner-b')).extApi).toBe(false);
    expect(await lastHistory(f.a.orgId)).toEqual([{ field: 'extApi', from: false, to: true }]);

    const same = await ok(await setExtApi(true), 200, OrgPolicy);
    expect(same.version).toBe(saved.version);
    const stale = await call('owner-a', 'PATCH', '/api/org/policy', {
      version: before.version,
      extApi: false,
    });
    expect(stale.status).toBe(409);
    expect((await policy()).extApi).toBe(true);
    for (const extApi of ['да', 1, null]) {
      const bad = await call('owner-a', 'PATCH', '/api/org/policy', {
        version: saved.version,
        extApi,
      });
      expect(bad.status, String(extApi)).toBe(400);
    }
  });

  it('выключение останавливает действующие токены и выпуск, включение — возвращает; число действующих — в блоке', async () => {
    // Доступ включается здесь же: тест не опирается на предыдущий (запуск одного теста через `-t`).
    if (!(await policy()).extApi) await ok(await setExtApi(true), 200, OrgPolicy);
    const issued = await ok(
      await call('owner-a', 'POST', '/api/dm/tokens', {
        templateId: template,
        name: 'Power BI',
        term: 30,
      }),
      201,
      DmTokenIssued,
    );
    expect(issued.item.state).toBe('active');
    expect(await extApi()).toEqual({ demo: false, activeTokens: 1 });
    // Число видят все сотрудники — без названий и авторов токенов.
    expect(await extApi('acc-a')).toEqual({ demo: false, activeTokens: 1 });
    expect(await extApi('owner-b')).toEqual({ demo: false, activeTokens: 0 });

    const off = await ok(await setExtApi(false), 200, OrgPolicy);
    expect(off.extApi).toBe(false);
    expect(await lastHistory(f.a.orgId)).toEqual([{ field: 'extApi', from: true, to: false }]);
    const card = await ok(
      await call('owner-a', 'GET', `/api/dm/tokens/${issued.item.id}`),
      200,
      DmTokenCard,
    );
    expect(card).toMatchObject({ state: 'stopped', stop: 'api_off' });
    expect(await extApi()).toEqual({ demo: false, activeTokens: 0 });
    const refused = await call('owner-a', 'POST', '/api/dm/tokens', {
      templateId: template,
      name: 'Excel',
      term: 30,
    });
    expect(refused.status).toBe(403);
    expect(await errCode(refused)).toBe('dm_token_api_off');

    await ok(await setExtApi(true), 200, OrgPolicy);
    const again = await ok(
      await call('owner-a', 'GET', `/api/dm/tokens/${issued.item.id}`),
      200,
      DmTokenCard,
    );
    expect(again).toMatchObject({ state: 'active', stop: null });
    expect(await extApi()).toEqual({ demo: false, activeTokens: 1 });
  });

  it('в демо-организации выключатель не меняется — 400; остальные настройки сохраняются', async () => {
    const db = f.t.admin.db;
    const aOn = (await policy('owner-a')).extApi;
    await db.update(organizations).set({ isDemo: true }).where(eq(organizations.id, f.b.orgId));
    try {
      expect(await extApi('owner-b')).toEqual({ demo: true, activeTokens: 0 });
      const res = await setExtApi(true, 'owner-b');
      expect(res.status).toBe(400);
      expect(await errCode(res)).toBe('ext_api_demo');
      expect((await policy('owner-b')).extApi).toBe(false);
      // То же значение и другие поля — как обычно.
      expect((await setExtApi(false, 'owner-b')).status).toBe(200);
      const other = await call('owner-b', 'PATCH', '/api/org/policy', {
        version: (await policy('owner-b')).version,
        overdueRepeat: false,
      });
      expect(other.status, await other.clone().text()).toBe(200);
      // У другой организации выключатель не тронут.
      expect((await policy('owner-a')).extApi).toBe(aOn);
    } finally {
      await db.update(organizations).set({ isDemo: false }).where(eq(organizations.id, f.b.orgId));
    }
  });
});
