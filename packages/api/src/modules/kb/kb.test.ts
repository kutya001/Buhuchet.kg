import { withOrgContext, writeHistory } from '@buhuchet/db';
import { databaseAvailable, seedKbReference } from '@buhuchet/db/testing';
import {
  ApiError,
  EmployeeList,
  KbArticle,
  KbArticleList,
  KbArticleReadResult,
  KbMarkResult,
  KbMemberProgress,
  KbState,
  KbTeamList,
  ListValues,
  listQueryParams,
  type ListQuery,
} from '@buhuchet/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD, unzipTexts } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

describe.skipIf(!databaseAvailable())('«База знаний»: API', () => {
  let f: Fixture;
  let owner: string;
  let acc: string;
  let hr: string;
  let ownerB: string;
  let admin: string;

  const call = (method: 'GET' | 'POST' | 'DELETE', path: string, cookie?: string, body?: unknown) =>
    apiRequest(f.app, method, path, cookie, body);
  const ok = async (res: Response) => {
    expect(res.status, await res.clone().text()).toBe(200);
    return res.json();
  };
  const state = async (cookie: string) =>
    KbState.parse(await ok(await call('GET', '/api/kb/me', cookie)));
  const steps = (s: KbState) => s.lessons.flatMap((l) => l.steps);
  const step = (s: KbState, id: string) => steps(s).find((x) => x.id === id);
  const errorOf = async (res: Response) => ApiError.parse(await res.json()).error.code;
  /** Запись истории от имени сотрудника — как после сохранения на экране. */
  const saved = (userId: string, entity: 'org_settings' | 'organization', field: string) =>
    withOrgContext(f.t.app.db, { orgId: f.a.orgId, userId }, (tx) =>
      writeHistory(tx, {
        entity,
        entityId: f.a.orgId,
        action: 'update',
        changes: [{ field, from: null, to: 'x' }],
      }),
    );

  beforeAll(async () => {
    f = await createStaffFixture();
    await seedKbReference(f.t.admin.db);
    owner = await signIn(f.app, 'owner-a', TEST_PASSWORD);
    acc = await signIn(f.app, 'acc-a', TEST_PASSWORD);
    hr = await signIn(f.app, 'hr-a', TEST_PASSWORD);
    ownerB = await signIn(f.app, 'owner-b', TEST_PASSWORD);
    admin = await signIn(f.app, 'platform-admin', TEST_PASSWORD);
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('программа из прав: владелец — модули организации, бухгалтер — без них; без входа — 401', async () => {
    const own = await state(owner);
    expect(own.admin).toBe(false);
    expect(own.lessons.map((l) => l.id)).toEqual([
      'org',
      'me',
      'dicts',
      'staff',
      'cps',
      'tasks',
      'files',
      'lists',
    ]);
    expect(own.progress).toMatchObject({ total: 25, done: 0, pct: 0, level: 0, next: 1, need: 7 });
    expect(own.progress.levels.map((l) => l.name)).toEqual([
      'Новичок',
      'Ученик',
      'Уверенный пользователь',
      'Профи',
      'Эксперт',
    ]);
    expect(own.nextStepId).toBe('profile');
    expect(step(own, 'roles')).toMatchObject({
      learn: true,
      screens: ['staff.roles'],
      articleId: 'a3',
    });
    expect(step(own, 'profile')).toMatchObject({
      star: true,
      learn: false,
      screens: [],
      done: null,
    });
    // «Можно включить» — выключенные функции с работающим уроком (правило стыков): «Показатели
    // контрагентов» (2.27) и «Страница контрагента по ссылке» — урок «Контрагенты» (2.09).
    expect(own.offers.map((o) => o.feature)).toEqual(['indicators', 'cppage']);
    // «Пройти урок» есть только у функции, чей урок уже в программе: «Напоминания в Telegram» — «Мой
    // профиль», «Задачи» — урок «Задачи» (задача 2.23), «Файлы в карточках» — урок «Файловый менеджер»
    // (задача 2.29), «Страница контрагента» — «Контрагенты».
    expect(own.featureLessons).toEqual({
      tasks: 'tasks',
      telegram: 'me',
      files: 'files',
      cppage: 'cps',
    });

    const mine = await state(acc);
    expect(mine.lessons.map((l) => l.id)).toEqual([
      'me',
      'dicts',
      'cps',
      'tasks',
      'files',
      'lists',
    ]);
    expect(steps(mine).map((s) => s.id)).toEqual([
      'tg',
      'pdicts',
      'cp1',
      'daymonth',
      'tdone',
      'upload',
      'ffind',
      'search',
      'cols',
      'grp',
      'xls',
      'swipe',
    ]);
    expect((await call('GET', '/api/kb/me')).status).toBe(401);
  });

  it('администратор платформы — своя программа: шаги сделанных модулей Админки', async () => {
    const s = await state(admin);
    expect(s).toMatchObject({ admin: true, offers: [], featureLessons: {} });
    expect(s.progress.levels).toHaveLength(5);
    // «Каталог видов отчётов», календарь, шаблоны и загрузка из Excel — с их вкладками.
    expect(steps(s).map((x) => [x.id, x.module, x.learn])).toEqual([
      ['a-dicts', 'pdicts', true],
      ['a-cal', 'pdicts', true],
      ['a-l10n', 'l10n', true],
      ['a-org', 'orgs', false],
    ]);
    expect(step(s, 'a-dicts')!.screens).toContain('pdicts.regimes');
    expect(step(s, 'a-cal')!.screens).toEqual(['pdicts.calendar']);
    // Статьи Админки — только о сделанных модулях («Справочники платформы» — с задачей 2.37).
    const arts = KbArticleList.parse(await ok(await call('GET', '/api/kb/articles', admin)));
    const ids = arts.items.map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(['a19_1', 'a19_2', 'a19_4']));
    expect(ids).not.toContain('a19_3');

    // «Проверить справочники платформы» — 3 секунды на экране шага (docs/deviations.md п. Д-7).
    const looked = KbMarkResult.parse(
      await ok(await call('POST', '/api/kb/steps/a-dicts/look', admin)),
    );
    expect(step(looked.state, 'a-dicts')?.done?.how).toBe('visit');
    const l10n = KbMarkResult.parse(
      await ok(await call('POST', '/api/kb/steps/a-l10n/look', admin)),
    );
    expect(step(l10n.state, 'a-l10n')?.done?.how).toBe('visit');
    // Шаг «Сделать» просмотром не засчитывается.
    expect((await call('POST', '/api/kb/steps/a-org/look', admin)).status).toBe(400);
    // «Создать организацию и её владельца» — организацией, созданной им самим.
    const created = await call('POST', '/api/admin/organizations', admin, {
      name: 'ОсОО «Урок»',
      inn: '03811201810458',
      ownerFullName: 'Урокова Айпери',
      ownerLogin: 'urokova',
      temporaryPassword: 'Bh-7K4M-Q9TX',
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const synced = KbMarkResult.parse(
      await ok(await call('POST', '/api/kb/sync', admin, { reason: 'saved' })),
    );
    expect(synced.fresh).toEqual([
      { id: 'a-org', title: 'Создать организацию и её владельца', learn: false, how: 'action' },
    ]);
  });

  it('«Сделать» засчитывается по истории своих действий: недавнее — «действием», поздравление с уровнем', async () => {
    await saved(f.a.ownerUserId, 'org_settings', 'features');
    const first = KbMarkResult.parse(
      await ok(await call('POST', '/api/kb/sync', owner, { reason: 'saved' })),
    );
    expect(first.fresh).toEqual([
      { id: 'policy', title: expect.any(String), learn: false, how: 'action' },
    ]);
    // Первый уровень записывается без поздравления.
    expect(first.congrats).toBeNull();
    expect(first.state.progress.levels[0]!.reachedAt).not.toBeNull();
    expect(step(first.state, 'policy')?.done?.how).toBe('action');

    // Действие другого сотрудника не засчитывается.
    const other = KbMarkResult.parse(
      await ok(await call('POST', '/api/kb/sync', acc, { reason: 'saved' })),
    );
    expect(other.fresh).toEqual([]);

    // Шаг с событием в истории вызовом «первого использования» не засчитывается.
    const remindHit = KbMarkResult.parse(
      await ok(await call('POST', '/api/kb/hits/remind', owner)),
    );
    expect(remindHit.fresh).toEqual([]);
    // «Сохранить» без изменений («Настройки», «Профиль») — тоже действие, но только у своего шага.
    const savedAsIs = KbMarkResult.parse(
      await ok(await call('POST', '/api/kb/hits/settings', ownerB)),
    );
    expect(savedAsIs.fresh.map((x) => [x.id, x.how])).toEqual([['settings', 'action']]);
    const notMine = KbMarkResult.parse(await ok(await call('POST', '/api/kb/hits/profile', acc)));
    expect(notMine.fresh).toEqual([]);

    // Ещё 6 шагов — 7 из 25 (28 %): уровень «Ученик». «Добавить первого контрагента» (задача 2.09) —
    // по истории создания контрагента.
    await saved(f.a.ownerUserId, 'organization', 'name');
    await withOrgContext(f.t.app.db, { orgId: f.a.orgId, userId: f.a.ownerUserId }, (tx) =>
      writeHistory(tx, {
        entity: 'contractor',
        entityId: crypto.randomUUID(),
        action: 'create',
        changes: [],
      }),
    );
    await saved(f.a.ownerUserId, 'org_settings', 'remindDays');
    await saved(f.a.ownerUserId, 'org_settings', 'timezone');
    const hit = KbMarkResult.parse(await ok(await call('POST', '/api/kb/hits/search', owner)));
    expect(hit.fresh.map((x) => [x.id, x.how])).toEqual([['search', 'use']]);
    const cols = KbMarkResult.parse(await ok(await call('POST', '/api/kb/hits/cols', owner)));
    expect(cols.fresh.map((x) => [x.id, x.how])).toEqual([['cols', 'use']]);
    const second = KbMarkResult.parse(
      await ok(await call('POST', '/api/kb/sync', owner, { reason: 'saved' })),
    );
    expect(second.fresh.map((x) => x.id).sort()).toEqual(['cp1', 'profile', 'remind', 'settings']);
    expect(second.congrats).toBe('Ученик');
    expect(second.state.progress).toMatchObject({ done: 7, pct: 28, level: 1 });
    // Повтор ничего не меняет.
    const again = KbMarkResult.parse(
      await ok(await call('POST', '/api/kb/sync', owner, { reason: 'open' })),
    );
    expect(again).toMatchObject({ fresh: [], congrats: null });
    expect((await call('POST', '/api/kb/sync', owner, { reason: 'x' })).status).toBe(400);
  });

  it('«Посмотреть» после «Перейти»: только шаг программы с экраном', async () => {
    const look = KbMarkResult.parse(await ok(await call('POST', '/api/kb/steps/pdicts/look', acc)));
    expect(look.fresh).toEqual([
      { id: 'pdicts', title: expect.any(String), learn: true, how: 'visit' },
    ]);
    const twice = KbMarkResult.parse(
      await ok(await call('POST', '/api/kb/steps/pdicts/look', acc)),
    );
    expect(twice.fresh).toEqual([]);
    const notLearn = await call('POST', '/api/kb/steps/tg/look', acc);
    expect(notLearn.status).toBe(400);
    expect(await errorOf(await call('POST', '/api/kb/steps/roles/look', acc))).toBe('not_found');
    expect((await call('POST', '/api/kb/steps/nope/look', acc)).status).toBe(404);
    expect((await call('POST', '/api/kb/steps/BAD!/look', acc)).status).toBe(400);
    // Первое использование засчитывает «Посмотреть» только в разделе «Работа со списками».
    const card = KbMarkResult.parse(await ok(await call('POST', '/api/kb/hits/empcard', owner)));
    expect(card.fresh).toEqual([]);
  });

  it('«Пропустить» и «Вернуть»: следующий шаг идёт мимо пропущенного; выполненный не пропускается', async () => {
    const skipped = KbState.parse(await ok(await call('POST', '/api/kb/steps/tg/skip', acc)));
    expect(step(skipped, 'tg')?.skipped).toBe(true);
    expect(skipped.nextStepId).toBe('cp1');
    const done = KbState.parse(await ok(await call('POST', '/api/kb/steps/pdicts/skip', acc)));
    expect(step(done, 'pdicts')).toMatchObject({ skipped: false, done: { how: 'visit' } });
    const back = KbState.parse(await ok(await call('DELETE', '/api/kb/steps/tg/skip', acc)));
    expect(step(back, 'tg')?.skipped).toBe(false);
    expect(back.nextStepId).toBe('tg');
    expect((await call('POST', '/api/kb/steps/roles/skip', acc)).status).toBe(404);
  });

  it('статьи: только видные пользователю; блоки без разметки; прочтение засчитывает шаг статьи', async () => {
    const own = KbArticleList.parse(await ok(await call('GET', '/api/kb/articles', owner)));
    const ids = own.items.map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(['a3', 'a15']));
    const mine = KbArticleList.parse(await ok(await call('GET', '/api/kb/articles', acc)));
    // «Сотрудников» нет в меню бухгалтера — статьи о них нет.
    expect(mine.items.find((a) => a.module === 'staff')).toBeUndefined();
    expect((await call('GET', '/api/kb/articles/a15', acc)).status).toBe(404);

    const article = KbArticle.parse(await ok(await call('GET', '/api/kb/articles/a15', owner)));
    expect(article.blocks.length).toBeGreaterThan(0);
    expect(JSON.stringify(article.blocks)).not.toMatch(/<[a-z]/);
    for (const b of article.blocks.filter((x) => x.type === 'screen')) {
      expect(article.screens[b.module]).toBeDefined();
    }

    const read = KbArticleReadResult.parse(
      await ok(await call('POST', '/api/kb/articles/a3/read', owner, { stepId: 'roles' })),
    );
    expect(read.first).toBe(true);
    expect(read.fresh.map((x) => [x.id, x.how])).toEqual([['roles', 'art']]);
    expect(read.state.articles.read).toBe(1);
    const reread = KbArticleReadResult.parse(
      await ok(await call('POST', '/api/kb/articles/a3/read', owner, {})),
    );
    expect(reread).toMatchObject({ first: false, fresh: [] });
    // Чужая статья шага не засчитывает шаг.
    const wrong = KbArticleReadResult.parse(
      await ok(await call('POST', '/api/kb/articles/a15/read', owner, { stepId: 'pdicts' })),
    );
    expect(wrong.fresh).toEqual([]);
    expect((await call('POST', '/api/kb/articles/zz/read', owner, {})).status).toBe(404);
  });

  it('«Уровни сотрудников»: право «Видеть уровни сотрудников», только своя организация', async () => {
    const list = async (cookie: string, query: Partial<ListQuery> = {}) => {
      const params = new URLSearchParams(
        listQueryParams({ sort: undefined, page: 1, size: 25, filters: {}, ...query }),
      );
      return call('GET', `/api/kb/team?${params}`, cookie);
    };
    const team = KbTeamList.parse(await ok(await list(owner)));
    expect(team.total).toBe(5);
    // По умолчанию — от высшего уровня: у владельца «Ученик».
    expect(team.items[0]).toMatchObject({
      fullName: 'Владелец owner-a',
      level: 1,
      levelName: 'Ученик',
      of: 5,
      done: 8,
      total: 25,
      levelAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    const accRow = team.items.find((r) => r.fullName === 'Сотрудник acc-a');
    expect(accRow).toMatchObject({ level: 0, done: 1, total: 12, pct: 8 });
    const values = ListValues.parse(
      await ok(await call('GET', '/api/kb/team/values?col=level', owner)),
    );
    expect(values.items.map((v) => v.value).sort()).toEqual(['Новичок', 'Ученик']);
    const file = await call('GET', '/api/kb/team/export?cols=fullName,level', owner);
    expect(file.status).toBe(200);
    expect(Object.values(unzipTexts(new Uint8Array(await file.arrayBuffer()))).join('')).toContain(
      'Ученик',
    );

    expect((await list(acc)).status).toBe(403);
    expect((await list(admin)).status).toBe(403);
    const other = KbTeamList.parse(await ok(await list(ownerB)));
    expect(other.items.map((r) => r.fullName).sort()).toEqual([
      'Владелец owner-b',
      'Сотрудник acc-b',
    ]);
    expect((await list(owner, { sort: { key: 'secret', dir: 'asc' } })).status).toBe(400);
  });

  it('уровень сотрудника: свой — всегда, чужой — с правом; другая организация — 404', async () => {
    const id = f.people['acc-a']!.employeeId;
    const self = KbMemberProgress.parse(
      await ok(await call('GET', `/api/kb/employees/${id}`, acc)),
    );
    expect(self).toMatchObject({ employeeId: id, progress: { done: 1, total: 12 } });
    expect(self.progress.groups.map((g) => g.id)).toEqual([
      'me',
      'dicts',
      'cps',
      'tasks',
      'files',
      'lists',
    ]);
    expect((await call('GET', `/api/kb/employees/${id}`, owner)).status).toBe(200);
    expect((await call('GET', `/api/kb/employees/${id}`, hr)).status).toBe(403);
    expect((await call('GET', `/api/kb/employees/${id}`, ownerB)).status).toBe(404);
  });

  it('столбец «Уровень знаний» в «Сотрудниках» — только с правом «Видеть уровни сотрудников»', async () => {
    const staff = async (cookie: string, qs = 'size=25') => {
      const res = await call('GET', `/api/staff?${qs}`, cookie);
      expect(res.status, await res.clone().text()).toBe(200);
      return EmployeeList.parse(await res.json());
    };
    const own = await staff(owner);
    expect(own.items.find((e) => e.login === 'owner-a')?.kb).toEqual({
      level: 1,
      name: 'Ученик',
      pct: 32,
      of: 5,
    });
    const sorted = await staff(
      owner,
      new URLSearchParams(
        listQueryParams({ sort: { key: 'kb', dir: 'desc' }, page: 1, size: 25, filters: {} }),
      ).toString(),
    );
    expect(sorted.items[0]?.login).toBe('owner-a');
    expect((await staff(hr)).items.every((e) => e.kb === null)).toBe(true);
    const denied = await call(
      'GET',
      `/api/staff?${new URLSearchParams(listQueryParams({ sort: { key: 'kb', dir: 'desc' }, page: 1, size: 25, filters: {} }))}`,
      hr,
    );
    expect(denied.status).toBe(400);
  });

  it('прогресс у каждого свой: другая организация не видит отметок', async () => {
    // У владельца Б — только своя отметка «Настроек» (сохранение без изменений выше).
    const b = await state(ownerB);
    expect(b.progress.done).toBe(1);
    expect(
      steps(b)
        .filter((s) => s.done)
        .map((s) => s.id),
    ).toEqual(['settings']);
  });
});
