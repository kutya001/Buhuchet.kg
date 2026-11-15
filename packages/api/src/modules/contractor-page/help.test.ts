import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { ioTsv } from '@buhuchet/domain';
import {
  AdminCpHelp,
  AdminDictImportApplied,
  AdminDictImportPreview,
  AdminDictIoFile,
  AdminKbHistory,
  ApiError,
  ContractorPage,
  Contractor,
  PublicPage,
} from '@buhuchet/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_ORIGIN, TEST_PASSWORD } from '../../testing';

// Подсказки и обучение на странице контрагента (доработки 15.11.2026; прототип v120 cp-help.js,
// cp-help-admin.js): тексты в ответе страницы, конец обзора в истории, вкладка Админки и Excel.

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

describe.skipIf(!databaseAvailable())('Страница контрагента: подсказки и обучение', () => {
  let f: Fixture;
  let owner: string;
  let ownerB: string;
  let admin: string;
  let cp: Contractor;
  let cpB: Contractor;
  /** Cookie страницы `cp` после верного кода. */
  let cookie: string;

  const call = (method: 'GET' | 'POST', path: string, auth?: string, body?: unknown) =>
    apiRequest(f.app, method, path, auth, body);
  const failure = async (res: Response) => ApiError.parse(await res.json()).error;
  const contractor = async (auth: string, name: string, inn: string, responsible: string) => {
    const res = await call('POST', '/api/contractors', auth, {
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
    expect(res.status, await res.clone().text()).toBe(201);
    return Contractor.parse(await res.json());
  };
  const enable = async (auth: string, id: string) => {
    const res = await call('POST', `/api/contractors/${id}/page/enable`, auth);
    expect(res.status, await res.clone().text()).toBe(200);
    return ContractorPage.parse(await res.json()).code!;
  };
  const enter = async (path: string, code: string) => {
    const res = await f.app.request(`/api/page/${path}/code`, {
      method: 'POST',
      headers: { origin: TEST_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    expect(res.status).toBe(200);
    return (res.headers.get('set-cookie') ?? '').split(';')[0]!;
  };
  const visit = async (path: string, pageCookie?: string) => {
    const res = await f.app.request(`/api/page/${path}`, {
      headers: pageCookie ? { cookie: pageCookie } : {},
    });
    expect(res.status).toBe(200);
    return PublicPage.parse(await res.json());
  };
  const tour = (path: string, body: unknown, pageCookie?: string) =>
    f.app.request(`/api/page/${path}/tour`, {
      method: 'POST',
      headers: {
        origin: TEST_ORIGIN,
        'content-type': 'application/json',
        ...(pageCookie ? { cookie: pageCookie } : {}),
      },
      body: JSON.stringify(body),
    });
  const tourHistory = (contractorId: string) =>
    f.t.admin.db
      .select({ action: schema.auditLog.action, changes: schema.auditLog.changes })
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.contractorId, contractorId),
          eq(schema.auditLog.action, 'page_tour'),
        ),
      )
      .orderBy(asc(schema.auditLog.at), asc(schema.auditLog.id));

  const A = '/api/admin/kb/cppage';
  const help = async (auth = admin) => {
    const res = await call('GET', A, auth);
    expect(res.status, await res.clone().text()).toBe(200);
    return AdminCpHelp.parse(await res.json());
  };
  const edit = (body: unknown, auth = admin) => call('POST', A, auth, body);
  const edited = async (body: unknown) => {
    const res = await edit(body);
    expect(res.status, await res.clone().text()).toBe(200);
    return AdminCpHelp.parse(await res.json());
  };
  const kbHistory = async () =>
    AdminKbHistory.parse(await (await call('GET', '/api/admin/kb/history/cppage', admin)).json());

  beforeAll(async () => {
    f = await createStaffFixture();
    await seedAllPlatformDictionaries(f.t.admin.db);
    for (const orgId of [f.a.orgId, f.b.orgId]) {
      await f.t.admin.db
        .update(schema.orgSettings)
        .set({ features: { cppage: true, fee: true } })
        .where(eq(schema.orgSettings.orgId, orgId));
    }
    [owner, ownerB, admin] = await Promise.all([
      signIn(f.app, 'owner-a', TEST_PASSWORD),
      signIn(f.app, 'owner-b', TEST_PASSWORD),
      signIn(f.app, 'platform-admin', TEST_PASSWORD),
    ]);
    cp = await contractor(
      owner,
      'ОсОО «Подсказка»',
      '03744097401861',
      f.people['acc-a']!.employeeId,
    );
    cpB = await contractor(ownerB, 'ОсОО «Другая»', '03744097401862', f.b.ownerEmployeeId);
    cookie = await enter(`org-a/${cp.inn}`, await enable(owner, cp.id));
    await enable(ownerB, cpB.id);
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('открытая страница получает подсказки: только включённые облачка и вопросы, слова с объяснением', async () => {
    const before = await help();
    // Выключенное облачко и вопрос в ответ страницы не попадают.
    const step = before.help.tour.find((s) => s.sec === 'files')!;
    const q = before.help.faq[0]!;
    let v = (
      await edited({
        op: 'tour',
        id: step.id,
        t: step.t,
        x: step.x,
        x2: step.x2,
        on: false,
        version: before.version,
      })
    ).version;
    v = (await edited({ ...q, op: 'faq', on: false, version: v, ord: undefined })).version;
    const open = await visit(`org-a/${cp.inn}`, cookie);
    expect(open.state).toBe('open');
    if (open.state !== 'open') return;
    expect(open.page.help.tour.map((s) => s.id)).toEqual(
      before.help.tour.filter((s) => s.id !== step.id).map((s) => s.id),
    );
    expect(open.page.help.faq.some((x) => x.id === q.id)).toBe(false);
    expect(open.page.help.gloss.length).toBe(before.help.gloss.length);
    expect(open.page.help.welcome.t).toBe(before.help.welcome.t);
    expect(open.page.help.hints.paidSteps).toBe(before.help.hints.paidSteps);
    // Вернуть как было — остальные тесты считают облачка наполнения.
    v = (await edited({ ...step, op: 'tour', on: true, version: v })).version;
    await edited({
      id: q.id,
      q: q.q,
      a: q.a,
      sec: q.sec,
      act: q.act,
      op: 'faq',
      on: true,
      version: v,
    });
  });

  it('конец обзора: только с запомненным кодом своей страницы, числа проверяются, запись в историю', async () => {
    const path = `org-a/${cp.inn}`;
    // Без cookie, с чужим cookie и у чужой страницы — «Страница недоступна», в базу ничего не пишется.
    expect((await tour(path, { full: true, step: 3, of: 3 })).status).toBe(404);
    expect(
      (await tour(path, { full: true, step: 3, of: 3 }, `bh_page=${'A'.repeat(43)}`)).status,
    ).toBe(404);
    expect((await tour(`org-b/${cpB.inn}`, { full: true, step: 3, of: 3 }, cookie)).status).toBe(
      404,
    );
    expect(await tourHistory(cp.id)).toEqual([]);
    // Шаг больше числа шагов, «из M» больше облачков справочника, свободный текст — 400.
    expect((await tour(path, { full: false, step: 4, of: 3 }, cookie)).status).toBe(400);
    expect((await tour(path, { full: false, step: 1, of: 13 }, cookie)).status).toBe(400);
    const steps = (await help()).help.tour.length;
    expect((await tour(path, { full: false, step: 1, of: steps + 1 }, cookie)).status).toBe(400);
    expect((await tour(path, { full: 'да', step: 1, of: 2 }, cookie)).status).toBe(400);
    expect(await tourHistory(cp.id)).toEqual([]);

    const done = await tour(path, { full: true, step: steps, of: steps }, cookie);
    expect(done.status, await done.clone().text()).toBe(200);
    expect(done.headers.get('cache-control')).toBe('no-store');
    expect((await tour(path, { full: false, step: 2, of: steps }, cookie)).status).toBe(200);
    expect(await tourHistory(cp.id)).toEqual([
      { action: 'page_tour', changes: [{ field: 'of', to: steps }] },
      {
        action: 'page_tour',
        changes: [
          { field: 'step', to: 2 },
          { field: 'of', to: steps },
        ],
      },
    ]);
  });

  it('конец обзора: не больше 10 записей за час из одного браузера', async () => {
    const path = `org-a/${cp.inn}`;
    await f.t.admin.db.execute(sql`delete from rate_limits where kind = 'cp_tour'`);
    for (let i = 0; i < 10; i++) {
      expect((await tour(path, { full: true, step: 1, of: 1 }, cookie)).status).toBe(200);
    }
    const over = await tour(path, { full: true, step: 1, of: 1 }, cookie);
    expect(over.status).toBe(429);
    expect((await failure(over)).code).toBe('rate_limited');
  });

  it('конец обзора: и на контрагента из всех браузеров — не больше 30 за час', async () => {
    const path = `org-a/${cp.inn}`;
    await f.t.admin.db.execute(sql`delete from rate_limits where kind like 'cp_tour%'`);
    const before = (await tourHistory(cp.id)).length;
    // Счёт браузера обнуляем, как у нового браузера после нового ввода кода.
    for (let i = 0; i < 30; i++) {
      if (i % 10 === 0)
        await f.t.admin.db.execute(sql`delete from rate_limits where kind = 'cp_tour'`);
      expect((await tour(path, { full: true, step: 1, of: 1 }, cookie)).status).toBe(200);
    }
    await f.t.admin.db.execute(sql`delete from rate_limits where kind = 'cp_tour'`);
    const over = await tour(path, { full: true, step: 1, of: 1 }, cookie);
    expect(over.status).toBe(429);
    expect((await failure(over)).code).toBe('rate_limited');
    expect((await tourHistory(cp.id)).length).toBe(before + 30);
    await f.t.admin.db.execute(sql`delete from rate_limits where kind like 'cp_tour%'`);
  });

  it('конец обзора: страница выключена или код сменён — прежний cookie не пишет в историю', async () => {
    const off = await contractor(
      owner,
      'ОсОО «Выключенная»',
      '03744097401863',
      f.people['acc-a']!.employeeId,
    );
    const path = `org-a/${off.inn}`;
    const offCookie = await enter(path, await enable(owner, off.id));
    expect((await tour(path, { full: true, step: 1, of: 1 }, offCookie)).status).toBe(200);
    expect(await tourHistory(off.id)).toHaveLength(1);
    // «Сменить код» — прежний браузер кода не помнит.
    expect((await call('POST', `/api/contractors/${off.id}/page/code`, owner)).status).toBe(200);
    const changed = await tour(path, { full: true, step: 1, of: 1 }, offCookie);
    expect(changed.status).toBe(404);
    expect((await failure(changed)).code).toBe('page_unavailable');
    // «Выключить» — тоже «Страница недоступна» и с новым кодом.
    const res = await call('POST', `/api/contractors/${off.id}/page/code`, owner);
    const fresh = await enter(path, ContractorPage.parse(await res.json()).code!);
    expect((await call('POST', `/api/contractors/${off.id}/page/disable`, owner)).status).toBe(200);
    const disabled = await tour(path, { full: true, step: 1, of: 1 }, fresh);
    expect(disabled.status).toBe(404);
    expect((await failure(disabled)).code).toBe('page_unavailable');
    expect(await tourHistory(off.id)).toHaveLength(1);
  });

  it('вкладка Админки: только администратор платформы; правка той версии, что видел администратор', async () => {
    expect((await call('GET', A)).status).toBe(401);
    expect((await call('GET', A, owner)).status).toBe(403);
    expect(
      (await edit({ op: 'hint', key: 'helpBtn', text: 'Справка', version: 1 }, owner)).status,
    ).toBe(403);
    const before = await help();
    const after = await edited({
      op: 'hint',
      key: 'helpBtn',
      text: 'Справка',
      version: before.version,
    });
    expect(after.version).toBe(before.version + 1);
    expect(after.help.hints.helpBtn).toBe('Справка');
    // Устаревшая версия — 409, раздел не меняется.
    const stale = await edit({
      op: 'hint',
      key: 'helpBtn',
      text: 'Помощь',
      version: before.version,
    });
    expect(stale.status).toBe(409);
    expect((await help()).help.hints.helpBtn).toBe('Справка');
    // Пустой текст — 400 с ключом словаря поля.
    const empty = await edit({ op: 'welcome', key: 't', text: '  ', version: after.version });
    expect(empty.status).toBe(400);
    // Страница сразу получает новый текст.
    const open = await visit(`org-a/${cp.inn}`, cookie);
    expect(open.state === 'open' && open.page.help.hints.helpBtn).toBe('Справка');
    await edited({ op: 'hint', key: 'helpBtn', text: 'Помощь', version: after.version });
  });

  it('частые вопросы и «Словарик»: добавить, выше / ниже, удалить; повтор слова — 400; всё в «Истории изменений»', async () => {
    let h = await help();
    const added = await edited({
      op: 'faq',
      q: 'Как распечатать страницу?',
      a: 'Нажмите «Печать»\nВыберите принтер',
      sec: '',
      act: '',
      on: true,
      version: h.version,
    });
    const q = added.help.faq.find((x) => x.q === 'Как распечатать страницу?')!;
    expect(q.id).toMatch(/^q[0-9a-z]+$/);
    expect(q.ord).toBe(Math.max(...h.help.faq.map((x) => x.ord)) + 1);
    h = await edited({ op: 'faqMove', id: q.id, dir: -1, version: added.version });
    expect(h.help.faq.find((x) => x.id === q.id)!.ord).toBeLessThan(q.ord);
    h = await edited({ op: 'faqDelete', id: q.id, version: h.version });
    expect(h.help.faq.some((x) => x.id === q.id)).toBe(false);
    expect((await edit({ op: 'faqDelete', id: q.id, version: h.version })).status).toBe(404);

    const word = h.help.gloss[0]!;
    const taken = await edit({
      op: 'gloss',
      w: word.w.toUpperCase() === word.w ? word.w : word.w.toUpperCase(),
      x: 'Объяснение',
      also: '',
      version: h.version,
    });
    expect(taken.status).toBe(400);
    expect(await failure(taken)).toMatchObject({ code: 'cph_word_taken', details: { field: 'w' } });
    h = await edited({
      op: 'gloss',
      w: 'пеня',
      x: 'Штраф за просрочку оплаты.',
      also: 'пени',
      version: h.version,
    });
    expect(h.help.gloss.find((g) => g.w === 'пеня')).toEqual({
      w: 'пеня',
      x: 'Штраф за просрочку оплаты.',
      also: 'пени',
    });
    h = await edited({ op: 'glossDelete', w: 'пеня', version: h.version });
    const step = h.help.tour[1]!;
    await edited({ op: 'tourMove', id: step.id, dir: 1, version: h.version });

    const lines = (await kbHistory()).items.map((x) => [x.code, x.action, x.label]);
    expect(lines.slice(0, 6)).toEqual([
      [`cptour:${step.id}`, 'update', step.t],
      ['cpgloss:пеня', 'delete', 'пеня'],
      ['cpgloss:пеня', 'create', 'пеня'],
      [`cpfaq:${q.id}`, 'delete', 'Как распечатать страницу?'],
      [`cpfaq:${q.id}`, 'update', 'Как распечатать страницу?'],
      [`cpfaq:${q.id}`, 'create', 'Как распечатать страницу?'],
    ]);
    // Записи других вкладок «Базы знаний» сюда не попадают.
    expect(
      (await kbHistory()).items.every((x) => /^cp(wel|hints|tour|faq|gloss):/.test(x.code)),
    ).toBe(true);
  });

  it('«Выгрузить» и «Загрузить»: выгрузка без правок — без изменений; правка текста и новое слово; новых текстов нет', async () => {
    const IO = '/api/admin/platform-dicts-io';
    const upload = (path: string, body: string) =>
      f.app.request(path, {
        method: 'POST',
        headers: {
          origin: TEST_ORIGIN,
          cookie: admin,
          'content-type': 'text/plain; charset=utf-8',
        },
        body,
      });
    const file = async (dict: string) =>
      AdminDictIoFile.parse(await (await call('GET', `${IO}/${dict}`, admin)).json());
    const preview = async (dict: string, text: string) => {
      const res = await upload(`${IO}/${dict}/preview`, text);
      expect(res.status, await res.clone().text()).toBe(200);
      return AdminDictImportPreview.parse(await res.json());
    };
    for (const dict of ['cpwel', 'cphints', 'cptour', 'cpfaq', 'cpgloss']) {
      expect((await call('GET', `${IO}/${dict}`, owner)).status, dict).toBe(403);
      const data = await file(dict);
      expect(data.rows.length, dict).toBeGreaterThan(0);
      const p = await preview(dict, ioTsv([data.header, ...data.rows]));
      expect({ errors: p.errors, add: p.add, change: p.change }, dict).toEqual({
        errors: [],
        add: [],
        change: [],
      });
    }
    const wel = await file('cpwel');
    expect(wel.header).toEqual(['Код', 'Где', 'Текст']);
    expect(wel.rows.find((r) => r[0] === 't')![1]).toBe('Заголовок окна');

    const text = ioTsv([
      wel.header,
      ...wel.rows.map((r) => (r[0] === 'lead' ? [r[0]!, r[1]!, 'Здесь всё о вашей компании.'] : r)),
      ['newKey', '', 'Новый текст'],
    ]);
    const p = await preview('cpwel', text);
    expect(p.change.map((x) => [x.code, x.name])).toEqual([['lead', 'Строка под заголовком']]);
    expect(p.errors.map((x) => [x.code, x.errors])).toEqual([
      ['newKey', ['Такой строки нет: новые тексты и облачка добавляет разработчик']],
    ]);
    const res = await upload(`${IO}/cpwel/apply?stamp=${p.stamp}`, text);
    expect(res.status, await res.clone().text()).toBe(200);
    AdminDictImportApplied.parse(await res.json());
    expect((await help()).help.welcome.lead).toBe('Здесь всё о вашей компании.');

    const gl = await file('cpgloss');
    expect(gl.header).toEqual(['Слово', 'Объяснение', 'Другие формы на странице']);
    const glText = ioTsv([gl.header, ...gl.rows, ['пеня', 'Штраф за просрочку оплаты.', 'пени']]);
    const gp = await preview('cpgloss', glText);
    expect(gp.add.map((x) => x.code)).toEqual(['пеня']);
    const applied = await upload(`${IO}/cpgloss/apply?stamp=${gp.stamp}`, glText);
    expect(applied.status, await applied.clone().text()).toBe(200);
    expect((await help()).help.gloss.some((g) => g.w === 'пеня')).toBe(true);
    // Загрузка — строкой «Истории изменений» вкладки.
    expect((await kbHistory()).items[0]).toMatchObject({ code: 'cpgloss:', action: 'import' });
  });
});
