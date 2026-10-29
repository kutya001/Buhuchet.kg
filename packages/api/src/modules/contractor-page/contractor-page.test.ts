import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import {
  ApiError,
  Contractor,
  ContractorPage,
  ContractorPagesEnabled,
  PublicPage,
} from '@buhuchet/shared';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_ORIGIN, TEST_PASSWORD } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

const PHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

describe.skipIf(!databaseAvailable())('Страница контрагента: методы API', () => {
  let f: Fixture;
  let owner: string;
  let chief: string;
  let acc: string;
  let senior: string;
  let ownerB: string;
  /** Контрагент бухгалтера acc-a и контрагент главного бухгалтера (бухгалтеру не виден). */
  let cpAcc: Contractor;
  let cpOther: Contractor;

  const employee = (login: string) => f.people[login]!.employeeId;
  const call = (method: 'GET' | 'POST' | 'PUT', path: string, cookie?: string, body?: unknown) =>
    apiRequest(f.app, method, path, cookie, body);
  const failure = async (res: Response) => ApiError.parse(await res.json()).error;
  const block = async (res: Response, status = 200) => {
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(status);
    return ContractorPage.parse(await res.json());
  };
  const page = (cookie: string, id: string) => call('GET', `/api/contractors/${id}/page`, cookie);
  const act = (cookie: string, id: string, action: string, body?: unknown) =>
    call(action === 'sections' ? 'PUT' : 'POST', `/api/contractors/${id}/page/${action}`, cookie, body);
  const features = (orgId: string, value: Record<string, boolean>) =>
    f.t.admin.db
      .update(schema.orgSettings)
      .set({ features: value })
      .where(eq(schema.orgSettings.orgId, orgId));
  const contractor = async (name: string, inn: string, responsible: string) => {
    const res = await call('POST', '/api/contractors', owner, {
      name,
      inn,
      phone: '+996505890076',
      kind: 'regular',
      formCode: 'ФС-01',
      regimeCode: 'РЕЖ-01',
      gked: '46.34.0',
      gkedExtra: [],
      bases: [],
      startDate: '2024-07-16',
      responsibleEmployeeId: responsible,
      tariff: { amount: 0, period: 'M' },
    });
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
    return Contractor.parse(await res.json());
  };
  const history = (contractorId: string) =>
    f.t.admin.db
      .select({ action: schema.auditLog.action, changes: schema.auditLog.changes })
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.contractorId, contractorId),
          eq(schema.auditLog.entity, 'contractor_page'),
        ),
      )
      .orderBy(asc(schema.auditLog.at), asc(schema.auditLog.id));
  const pageRow = async (contractorId: string) => {
    const [row] = await f.t.admin.db
      .select()
      .from(schema.contractorPages)
      .where(eq(schema.contractorPages.contractorId, contractorId));
    return row!;
  };
  const resetLock = (contractorId: string) =>
    f.t.admin.db
      .update(schema.contractorPages)
      .set({ failures: 0, failedAt: null, lockedUntil: null })
      .where(eq(schema.contractorPages.contractorId, contractorId));

  /** Страница без входа: без cookie сеанса, со своим cookie страницы, адресом и браузером. */
  const visit = (path: string, options: { cookie?: string; ua?: string } = {}) =>
    f.app.request(`/api/page/${path}`, {
      headers: {
        ...(options.cookie ? { cookie: options.cookie } : {}),
        ...(options.ua ? { 'user-agent': options.ua } : {}),
      },
    });
  const visited = async (path: string, options: { cookie?: string; ua?: string } = {}) => {
    const res = await visit(path, options);
    expect(res.status, await res.clone().text()).toBe(200);
    return PublicPage.parse(await res.json());
  };
  const enter = (path: string, code: unknown, ip = '198.51.100.1') =>
    f.app.request(`/api/page/${path}/code`, {
      method: 'POST',
      headers: {
        origin: TEST_ORIGIN,
        'content-type': 'application/json',
        'x-forwarded-for': `${ip}, 10.0.0.1`,
      },
      body: JSON.stringify({ code }),
    });
  const wrongOf = (code: string) => (code === '000000' ? '111111' : '000000');

  beforeAll(async () => {
    f = await createStaffFixture();
    await seedAllPlatformDictionaries(f.t.admin.db);
    await features(f.a.orgId, { cppage: true, fee: true });
    await features(f.b.orgId, { cppage: true });
    // «Старший» видит всех контрагентов, но права «Управлять страницей» у него нет.
    await f.t.admin.db
      .update(schema.roleScopes)
      .set({ scope: 'all' })
      .where(eq(schema.roleScopes.roleId, f.roleIds.senior));
    [owner, chief, acc, senior, ownerB] = await Promise.all([
      signIn(f.app, 'owner-a', TEST_PASSWORD),
      signIn(f.app, 'chief-a', TEST_PASSWORD),
      signIn(f.app, 'acc-a', TEST_PASSWORD),
      signIn(f.app, 'senior-a', TEST_PASSWORD),
      signIn(f.app, 'owner-b', TEST_PASSWORD),
    ]);
    cpAcc = await contractor('ОсОО «Ала-Тоо Трейд»', '03744097401851', employee('acc-a'));
    cpOther = await contractor('ИП Садыков', '03744097401852', employee('chief-a'));
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('без входа блок не отдаётся; функция выключена — 403; чужой контрагент — 404', async () => {
    expect((await call('GET', `/api/contractors/${cpAcc.id}/page`)).status).toBe(401);
    expect((await page(acc, cpOther.id)).status).toBe(404);
    expect((await page(ownerB, cpAcc.id)).status).toBe(404);
    expect((await act(ownerB, cpAcc.id, 'enable')).status).toBe(404);
    expect((await page(owner, 'не-номер')).status).toBe(400);
    await features(f.a.orgId, { fee: true });
    const res = await page(owner, cpAcc.id);
    expect(res.status).toBe(403);
    expect((await failure(res)).code).toBe('cppage_off');
    await features(f.a.orgId, { cppage: true, fee: true });
  });

  it('до включения: блок без ссылки и кода, разделы организации с учётом функций', async () => {
    const before = await block(await page(owner, cpAcc.id));
    expect(before).toMatchObject({
      featureOn: true,
      enabled: false,
      archived: false,
      link: null,
      code: null,
      version: null,
      manage: null,
      send: 'page_off',
      whatsApp: null,
    });
    // «Деньги на налоги» и «Показатели» — только при своих функциях.
    expect(before.sections).toEqual(['pay', 'reports', 'fee', 'contacts']);
  });

  it('«Включить» — право «Управлять страницей»: ссылка, код из 6 цифр, сообщение WhatsApp, история', async () => {
    const refused = await act(acc, cpAcc.id, 'enable');
    expect(refused.status).toBe(403);
    expect((await failure(refused)).code).toBe('page_manage_right');

    const on = await block(await act(owner, cpAcc.id, 'enable'));
    expect(on.enabled).toBe(true);
    expect(on.code).toMatch(/^\d{6}$/);
    expect(on.link).toBe('http://localhost:3000/org-a/inn/03744097401851');
    expect(on.whatsApp?.phone).toBe('+996505890076');
    expect(on.whatsApp?.text).toContain(on.link);
    expect(on.whatsApp?.text).toContain(on.code);
    expect(on.whatsApp?.text).toContain('ОсОО «Ала-Тоо Трейд»');
    // Повторное «Включить» ничего не меняет: тот же код, одна запись истории.
    const again = await block(await act(chief, cpAcc.id, 'enable'));
    expect(again.code).toBe(on.code);
    const log = await history(cpAcc.id);
    expect(log.map((h) => h.action)).toEqual(['page_on']);
  });

  it('ответственный бухгалтер без права видит код и может скопировать и отправить ссылку', async () => {
    const mine = await block(await page(acc, cpAcc.id));
    expect(mine).toMatchObject({ enabled: true, manage: 'page_manage_right', send: null });
    expect(mine.code).toMatch(/^\d{6}$/);
    expect(mine.whatsApp).not.toBeNull();
    await block(await act(acc, cpAcc.id, 'copied'));
    await block(await act(acc, cpAcc.id, 'sent'));
    for (const action of ['code', 'disable']) {
      const res = await act(acc, cpAcc.id, action);
      expect(res.status).toBe(403);
      expect((await failure(res)).code).toBe('page_manage_right');
    }
    // Видит контрагента, но не ответственный и без права — отправить нельзя.
    const other = await block(await page(senior, cpAcc.id));
    expect(other).toMatchObject({ send: 'page_send_right', whatsApp: null });
    const res = await act(senior, cpAcc.id, 'copied');
    expect(res.status).toBe(403);
    expect((await failure(res)).code).toBe('page_send_right');
    const actions = (await history(cpAcc.id)).map((h) => h.action);
    expect(actions).toEqual(['page_on', 'page_copy', 'page_send']);
  });

  it('«Разделы страницы»: с версией, только разделы организации', async () => {
    const before = await block(await page(owner, cpAcc.id));
    const saved = await block(
      await act(owner, cpAcc.id, 'sections', { hiddenSections: ['fee'], version: before.version }),
    );
    expect(saved.hiddenSections).toEqual(['fee']);
    expect(saved.version).toBe(before.version! + 1);
    // Устаревшая версия — «запись изменена другим пользователем».
    const stale = await act(owner, cpAcc.id, 'sections', {
      hiddenSections: [],
      version: before.version,
    });
    expect(stale.status).toBe(409);
    // «Деньги на налоги» организация не показывает (функция выключена) — скрыть нельзя.
    const absent = await act(owner, cpAcc.id, 'sections', {
      hiddenSections: ['money'],
      version: saved.version,
    });
    expect(absent.status).toBe(400);
    for (const bad of [
      { hiddenSections: ['fee', 'fee'], version: saved.version },
      { hiddenSections: ['nothing'], version: saved.version },
      { hiddenSections: [] },
    ]) {
      expect((await act(owner, cpAcc.id, 'sections', bad)).status).toBe(400);
    }
    const refused = await act(acc, cpAcc.id, 'sections', {
      hiddenSections: [],
      version: saved.version,
    });
    expect(refused.status).toBe(403);
    // Ни разу не включённая страница — 404.
    expect(
      (await act(owner, cpOther.id, 'sections', { hiddenSections: [], version: 1 })).status,
    ).toBe(404);
  });

  it('по ссылке без входа: ввод кода, неверный код, верный — cookie этой ссылки на 30 дней', async () => {
    const path = `org-a/${cpAcc.inn}`;
    const code = (await pageRow(cpAcc.id)).code;
    const first = await visit(path);
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('no-store');
    expect(first.headers.get('x-robots-tag')).toContain('noindex');
    expect(PublicPage.parse(await first.json())).toEqual({ state: 'code' });
    // Код не попадает в ответ страницы без входа ни в каком виде.
    expect(JSON.stringify(await (await visit(path)).json())).not.toContain(code);

    const format = await enter(path, '12345');
    expect(format.status).toBe(400);
    const wrong = await enter(path, wrongOf(code));
    expect(wrong.status).toBe(403);
    expect(await failure(wrong)).toMatchObject({
      code: 'page_code_wrong',
      details: { triesLeft: 4 },
    });

    const ok = await enter(path, code);
    expect(ok.status).toBe(200);
    const setCookie = ok.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/^bh_page=[A-Za-z0-9_-]+;/);
    expect(setCookie).toContain(`Path=/org-a/inn/${cpAcc.inn}`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Max-Age=2592000');
    const cookie = setCookie.split(';')[0]!;
    // Верный код сбросил счёт неверных.
    expect((await pageRow(cpAcc.id)).failures).toBe(0);

    const open = await visited(path, { cookie, ua: PHONE_UA });
    expect(open.state).toBe('open');
    if (open.state !== 'open') return;
    expect(open.page.contractor).toMatchObject({ name: 'ОсОО «Ала-Тоо Трейд»', inn: cpAcc.inn });
    expect(open.page.org).toEqual({ name: 'Организация А', logo: null });
    // «Оплата за обслуживание» скрыта у этого контрагента.
    expect(open.page.sections).toEqual(['pay', 'reports', 'contacts']);
    const opened = (await history(cpAcc.id)).filter((h) => h.action === 'page_open');
    expect(opened).toHaveLength(1);
    expect(opened[0]!.changes).toEqual([{ field: 'device', to: 'Телефон · Safari' }]);
    // «Последнее открытие» в блоке карточки.
    const card = await block(await page(owner, cpAcc.id));
    expect(card.lastDevice).toBe('Телефон · Safari');
    expect(card.lastOpenAt).not.toBeNull();

    // Cookie подходит только к своей ссылке, выдуманный — как без cookie.
    expect(await visited(`org-a/${cpOther.inn}`, { cookie })).toEqual({ state: 'unavailable' });
    expect(await visited(path, { cookie: 'bh_page=not-a-token' })).toEqual({ state: 'code' });
    expect(
      await visited(path, { cookie: `bh_page=${'A'.repeat(43)}` }),
    ).toEqual({ state: 'code' });
  });

  it('«Страница недоступна»: неизвестный адрес или ИНН, чужая организация, не включена', async () => {
    for (const path of [
      `org-x/${cpAcc.inn}`,
      'org-a/00000000000000',
      `org-b/${cpAcc.inn}`,
      `org-a/${cpOther.inn}`,
      `ORG-A/${cpAcc.inn}`,
      'org-a/12',
    ]) {
      expect(await visited(path), path).toEqual({ state: 'unavailable' });
      const res = await enter(path, '123456');
      expect(res.status, path).toBe(404);
      expect((await failure(res)).code).toBe('page_unavailable');
    }
  });

  it('5 неверных кодов подряд — ввод закрыт на 15 минут, запись в истории', async () => {
    const path = `org-a/${cpAcc.inn}`;
    const code = (await pageRow(cpAcc.id)).code;
    await resetLock(cpAcc.id);
    let last: Response | null = null;
    for (let i = 1; i <= 5; i++) last = await enter(path, wrongOf(code), '198.51.100.2');
    expect(last!.status).toBe(429);
    const locked = await failure(last!);
    expect(locked.code).toBe('page_locked');
    const until = new Date((locked.details as { lockedUntil: string }).lockedUntil).getTime();
    expect(until - Date.now()).toBeGreaterThan(14 * 60_000);
    expect(until - Date.now()).toBeLessThanOrEqual(15 * 60_000 + 5_000);
    // Закрыт и верный код; страница показывает перерыв.
    expect((await enter(path, code, '198.51.100.2')).status).toBe(429);
    expect((await visited(path)).state).toBe('locked');
    const locks = (await history(cpAcc.id)).filter((h) => h.action === 'page_lock');
    expect(locks).toHaveLength(1);
    await resetLock(cpAcc.id);
  });

  it('30 неверных кодов за час с одного адреса — час закрыто с этого адреса', async () => {
    const path = `org-a/${cpAcc.inn}`;
    const code = (await pageRow(cpAcc.id)).code;
    const ip = '203.0.113.7';
    let last: Response | null = null;
    for (let i = 1; i <= 30; i++) {
      // Ссылка закрылась бы на пятом — снимаем перерыв, чтобы считался только адрес.
      await resetLock(cpAcc.id);
      last = await enter(path, wrongOf(code), ip);
      if (i < 30) expect(last.status).toBe(403);
    }
    expect(last!.status).toBe(429);
    expect((await failure(last!)).code).toBe('page_ip_locked');
    expect((await enter(path, code, ip)).status).toBe(429);
    // С другого адреса верный код подходит.
    expect((await enter(path, code, '203.0.113.8')).status).toBe(200);
    await resetLock(cpAcc.id);
  });

  it('«Сменить код»: прежний код и запомненные браузеры перестают действовать', async () => {
    const path = `org-a/${cpAcc.inn}`;
    const oldCode = (await pageRow(cpAcc.id)).code;
    const ok = await enter(path, oldCode, '198.51.100.3');
    const cookie = (ok.headers.get('set-cookie') ?? '').split(';')[0]!;
    expect((await visited(path, { cookie })).state).toBe('open');

    const before = await pageRow(cpAcc.id);
    const changed = await block(await act(chief, cpAcc.id, 'code'));
    const after = await pageRow(cpAcc.id);
    expect(after.codeVersion).toBe(before.codeVersion + 1);
    expect(changed.code).toBe(after.code);
    expect(await visited(path, { cookie })).toEqual({ state: 'code' });
    if (after.code !== oldCode) {
      expect((await enter(path, oldCode, '198.51.100.3')).status).toBe(403);
    }
    // Сам код в историю не пишется.
    const log = await history(cpAcc.id);
    expect(log.filter((h) => h.action === 'page_code')).toHaveLength(1);
    expect(JSON.stringify(log)).not.toContain(after.code);
  });

  it('«Выключить»: ссылка не открывается, код сменить и ссылку отправить нельзя', async () => {
    const off = await block(await act(owner, cpAcc.id, 'disable'));
    expect(off).toMatchObject({ enabled: false, link: null, code: null, send: 'page_off' });
    expect(await visited(`org-a/${cpAcc.inn}`)).toEqual({ state: 'unavailable' });
    for (const action of ['code', 'copied']) {
      const res = await act(owner, cpAcc.id, action);
      expect(res.status, action).toBe(409);
      expect((await failure(res)).code).toBe('page_off');
    }
    // Повторное «Выключить» ничего не пишет.
    await block(await act(owner, cpAcc.id, 'disable'));
    const offs = (await history(cpAcc.id)).filter((h) => h.action === 'page_off');
    expect(offs).toHaveLength(1);
    // Включить снова — новый номер кода, скрытые разделы остаются.
    const before = await pageRow(cpAcc.id);
    const on = await block(await act(owner, cpAcc.id, 'enable'));
    expect(on.hiddenSections).toEqual(['fee']);
    expect((await pageRow(cpAcc.id)).codeVersion).toBe(before.codeVersion + 1);
  });

  it('архивный контрагент: страница недоступна, включить нельзя', async () => {
    const cp = await contractor('ОсОО «Архив»', '03744097401853', employee('chief-a'));
    await block(await act(owner, cp.id, 'enable'));
    await f.t.admin.db
      .update(schema.contractors)
      .set({ serviceStatus: 'archived' })
      .where(eq(schema.contractors.id, cp.id));
    const card = await block(await page(owner, cp.id));
    expect(card).toMatchObject({ archived: true, enabled: false, manage: 'page_archived' });
    expect(await visited(`org-a/${cp.inn}`)).toEqual({ state: 'unavailable' });
    const res = await act(owner, cp.id, 'enable');
    expect(res.status).toBe(409);
    expect((await failure(res)).code).toBe('page_archived');
  });

  it('«Включить страницу» у выбранных: у каждого свой код, пропуск включённых и чужих', async () => {
    const one = await contractor('ИП Токтогулов', '03744097401854', employee('acc-a'));
    const two = await contractor('ОсОО «Нарын»', '03744097401855', employee('chief-a'));
    const ids = [one.id, two.id, cpAcc.id];
    const refused = await call('POST', '/api/contractor-pages/enable', acc, { ids });
    expect(refused.status).toBe(403);
    const res = await call('POST', '/api/contractor-pages/enable', owner, { ids });
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    expect(ContractorPagesEnabled.parse(await res.json())).toEqual({ enabled: 2, skipped: 1 });
    const [a, b] = [await pageRow(one.id), await pageRow(two.id)];
    expect(a.enabled && b.enabled).toBe(true);
    expect(a.code).toMatch(/^\d{6}$/);
    expect((await history(one.id)).map((h) => h.action)).toEqual(['page_on']);
    // Чужая организация: её контрагенты не найдены — пропущены.
    const other = await call('POST', '/api/contractor-pages/enable', ownerB, { ids: [one.id] });
    expect(ContractorPagesEnabled.parse(await other.json())).toEqual({ enabled: 0, skipped: 1 });
    for (const bad of [{ ids: [] }, { ids: [one.id, one.id] }, { ids: ['x'] }, {}]) {
      expect((await call('POST', '/api/contractor-pages/enable', owner, bad)).status).toBe(400);
    }
  });
});
