import { createFakeTelegram, fixedClock } from '@buhuchet/adapters';
import { createManualReport, schema, withOrgContext } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { ACCOUNT_LOCK_FAILURES, BELL_FROM, UI_TEXTS, type Tyiyn } from '@buhuchet/domain';
import { ApiError, BellCount, BellPage, Task } from '@buhuchet/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import type { ApiDeps } from '../../deps';
import {
  apiRequest,
  createStaffFixture,
  createTestDeps,
  signIn,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from '../../testing';
import { notifyPageClosed } from '../contractor-page/closed';
import { addSentFiles } from '../files/sent-add';
import { bellContractor, putBell } from './bell';
import { bellCleanupJob, bellDayJob } from './bell-day';

/*
 * Колокольчик уведомлений (доработки 16.11.2026, блок 3; поток Т): методы панели, строки о событиях —
 * и без привязанного Telegram, и при выключенных «Напоминаниях в Telegram», строки дня, уборка,
 * события контрагента, «Вход заблокирован» и сообщение платформы.
 */

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

const {
  bellNotifications,
  contractorPages,
  contractors,
  loginAttempts,
  news,
  newsReads,
  orgSettings,
  platformLeads,
  rolePermissions,
  telegramLinks,
} = schema;
const ru = (key: keyof typeof UI_TEXTS) => UI_TEXTS[key].ru;

// Пятница, 20.11.2026, 09:00 по Бишкеку — час напоминаний организации по умолчанию.
const NOW = '2026-11-20T03:00:00Z';
const TODAY = '2026-11-20';

describe.skipIf(!databaseAvailable())('Колокольчик уведомлений (доработки 16.11, блок 3)', () => {
  let f: Fixture;
  let deps: ApiDeps;
  let app: ReturnType<typeof createApp>;
  const cookies: Record<string, string> = {};
  let cp = '';

  const person = (login: string) => f.people[login]!;
  const call = (
    login: string | null,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<Response> =>
    Promise.resolve(apiRequest(app, method, path, login ? cookies[login] : undefined, body));
  const page = async (login: string, tab = 'all') => {
    const res = await call(login, 'GET', `/api/bell?tab=${tab}`);
    expect(res.status, await res.clone().text()).toBe(200);
    return BellPage.parse(await res.json());
  };
  const unseen = async (login: string) => {
    const res = await call(login, 'GET', '/api/bell/count');
    expect(res.status).toBe(200);
    return BellCount.parse(await res.json()).unseen;
  };
  const rowsOf = (userId: string, event?: string) =>
    f.t.admin.db
      .select()
      .from(bellNotifications)
      .where(
        event
          ? and(eq(bellNotifications.userId, userId), eq(bellNotifications.event, event))
          : eq(bellNotifications.userId, userId),
      );
  const clear = () => f.t.admin.db.delete(bellNotifications);
  const setFeatures = (on: Record<string, boolean>) =>
    f.t.admin.db.update(orgSettings).set({ features: on }).where(eq(orgSettings.orgId, f.a.orgId));
  const inOrg = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(f.t.app.db, { orgId: f.a.orgId, kind: 'job' }, fn);

  beforeAll(async () => {
    f = await createStaffFixture();
    await seedAllPlatformDictionaries(f.t.admin.db);
    // Бот у сайта есть, но Telegram не привязан ни у кого, а «Напоминания в Telegram» выключены:
    // колокольчик от них не зависит.
    deps = createTestDeps({
      db: f.t.app.db,
      clock: fixedClock(NOW),
      telegram: createFakeTelegram(),
    });
    app = createApp(deps);
    await f.t.admin.db
      .update(orgSettings)
      .set({ features: { tasks: true, files: true } })
      .where(eq(orgSettings.orgId, f.a.orgId));
    for (const login of ['owner-a', 'chief-a', 'acc-a', 'senior-a', 'acc-b', 'platform-admin']) {
      cookies[login] = await signIn(app, login, TEST_PASSWORD);
    }
    const [row] = await f.t.admin.db
      .insert(contractors)
      .values({
        orgId: f.a.orgId,
        name: 'ОсОО «Ала-Тоо Трейд»',
        inn: '03744097401851',
        phone: '+996505890076',
        formCode: 'ФС-01',
        regimeCode: 'РЕЖ-01',
        startDate: '2026-01-15',
        responsibleEmployeeId: person('acc-a').employeeId,
      })
      .returning({ id: contractors.id });
    cp = row!.id;
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('методы: без входа — 401; неверная вкладка или номер строки — 400; чужая строка — 404', async () => {
    await clear();
    expect((await call(null, 'GET', '/api/bell')).status).toBe(401);
    expect((await call(null, 'GET', '/api/bell/count')).status).toBe(401);
    expect((await call(null, 'POST', '/api/bell/seen')).status).toBe(401);
    expect((await call(null, 'POST', '/api/bell/read-all')).status).toBe(401);
    expect((await call('acc-a', 'GET', '/api/bell?tab=leads')).status).toBe(400);
    expect((await call('acc-a', 'GET', '/api/bell?before=1')).status).toBe(400);
    expect((await call('acc-a', 'POST', '/api/bell/1/read')).status).toBe(400);

    await inOrg((tx) =>
      putBell(
        tx,
        [
          {
            userId: f.a.ownerUserId,
            kind: 'other',
            event: 'login_locked',
            text: 'Строка владельца',
            eventKey: 'test:owner',
          },
        ],
        new Date(NOW),
      ),
    );
    const [own] = await rowsOf(f.a.ownerUserId);
    // Чужую строку не прочитать — даже зная номер; сотрудник другой организации — тоже.
    for (const login of ['acc-a', 'acc-b', 'platform-admin']) {
      const res = await call(login, 'POST', `/api/bell/${own!.id}/read`);
      expect(res.status).toBe(404);
      expect(ApiError.parse(await res.json()).error.code).toBe('not_found');
    }
    expect((await page('acc-a')).items).toEqual([]);
    expect((await page('acc-b')).items).toEqual([]);
    expect((await rowsOf(f.a.ownerUserId))[0]!.readAt).toBeNull();
    expect((await call('owner-a', 'POST', `/api/bell/${own!.id}/read`)).status).toBe(200);
    expect((await rowsOf(f.a.ownerUserId))[0]!.readAt).not.toBeNull();
  });

  it('новая задача — строка исполнителю без Telegram; себе — нет; счётчик, «просмотрено», «прочитано»', async () => {
    await clear();
    const body = {
      title: 'Собрать первичку за ноябрь',
      description: '',
      categoryCode: 'КАТ-001',
      contractorId: cp,
      executorEmployeeId: person('acc-a').employeeId,
      term: 'day',
      dueDate: '2026-11-27',
      needFile: false,
      confirm: true,
    };
    const res = await call('owner-a', 'POST', '/api/tasks', body);
    expect(res.status, await res.clone().text()).toBe(201);
    const task = Task.parse(await res.json());
    // Себе — строки нет.
    const self = await call('owner-a', 'POST', '/api/tasks', {
      ...body,
      title: 'Своя задача',
      executorEmployeeId: f.a.ownerEmployeeId,
    });
    expect(self.status).toBe(201);
    expect(await rowsOf(f.a.ownerUserId)).toEqual([]);

    expect(await unseen('acc-a')).toBe(1);
    const tasks = await page('acc-a', 'tasks');
    expect(tasks.items).toHaveLength(1);
    expect(tasks.items[0]).toMatchObject({
      kind: 'tasks',
      event: 'task_new',
      contractor: { id: cp, name: 'ОсОО «Ала-Тоо Трейд»' },
      read: false,
      open: { kind: 'task', id: task.id },
    });
    expect(tasks.items[0]!.text).toContain('Собрать первичку за ноябрь');
    expect((await page('acc-a', 'reports')).items).toEqual([]);
    // Колокольчик открыт — счётчик гаснет, строка ещё не прочитана.
    expect((await call('acc-a', 'POST', '/api/bell/seen')).status).toBe(200);
    expect(await unseen('acc-a')).toBe(0);
    expect((await page('acc-a')).items[0]!.read).toBe(false);
    expect((await call('acc-a', 'POST', `/api/bell/${tasks.items[0]!.id}/read`)).status).toBe(200);
    expect((await page('acc-a')).items[0]!.read).toBe(true);
    // Сменили ответственного за контрагента и область «Свои» — строки чужого контрагента не видно.
    await f.t.admin.db
      .update(contractors)
      .set({ responsibleEmployeeId: person('chief-a').employeeId })
      .where(eq(contractors.id, cp));
    try {
      expect((await page('acc-a')).items).toEqual([]);
    } finally {
      await f.t.admin.db
        .update(contractors)
        .set({ responsibleEmployeeId: person('acc-a').employeeId })
        .where(eq(contractors.id, cp));
    }
  });

  it('«Прочитать все» — все строки вошедшего, чужие не трогает', async () => {
    await clear();
    const row = (userId: string, n: number) => ({
      userId,
      kind: 'other' as const,
      event: 'login_locked',
      text: `Строка ${n}`,
      eventKey: `test:${userId}:${n}`,
    });
    await inOrg((tx) =>
      putBell(
        tx,
        [row(person('acc-a').userId, 1), row(person('acc-a').userId, 2), row(f.a.ownerUserId, 3)],
        new Date(NOW),
      ),
    );
    expect((await call('acc-a', 'POST', '/api/bell/read-all')).status).toBe(200);
    expect((await page('acc-a')).items.map((x) => x.read)).toEqual([true, true]);
    expect((await rowsOf(f.a.ownerUserId))[0]!.readAt).toBeNull();
  });

  it('(приёмка блока 3) сотрудник без Telegram утром видит «Сроки на сегодня»; не в час напоминаний — ничего; повтор запуска не удваивает', async () => {
    await clear();
    await withOrgContext(f.t.app.db, { orgId: f.a.orgId, userId: f.a.ownerUserId }, (tx) =>
      createManualReport(
        tx,
        {
          contractorId: cp,
          reportTypeCode: 't1m',
          month: '2026-10-01',
          eventDate: null,
          due: TODAY,
          reasonCode: 'ПРЧ-001',
          reasonName: 'Продление от госоргана',
        },
        { today: TODAY, scope: undefined },
      ),
    );
    // Не в час напоминаний организации — ничего.
    await bellDayJob.run(deps, new Date('2026-11-20T04:00:00Z'));
    expect(await rowsOf(person('acc-a').userId, 'day_dues')).toEqual([]);
    await bellDayJob.run(deps, new Date(NOW));
    await bellDayJob.run(deps, new Date(NOW));
    const rows = await rowsOf(person('acc-a').userId, 'day_dues');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'reports',
      targetKind: 'reports_day',
      targetId: TODAY,
      need: 'repView',
      eventKey: `day_dues:${TODAY}`,
    });
    expect(rows[0]!.text).toBe(
      ru('bell.line.day').replace('{list}', ru('bell.line.day.reports.one').replace('{n}', '1')),
    );
    // Строка — в колокольчике бухгалтера; у других сотрудников своих отчётов на сегодня нет.
    const day = await page('acc-a', 'reports');
    expect(day.items.map((x) => [x.event, x.open])).toEqual([
      ['day_dues', { kind: 'reports_day', id: TODAY }],
    ]);
    // «Только свои отчёты»: владелец и главный бухгалтер видят все отчёты, но своих на сегодня у них нет.
    expect(await rowsOf(f.a.ownerUserId, 'day_dues')).toEqual([]);
    expect(await rowsOf(person('chief-a').userId, 'day_dues')).toEqual([]);

    // День — по Бишкеку: час напоминаний 05:00, запуск в 23:00 UTC предыдущего дня по UTC.
    await clear();
    await f.t.admin.db
      .update(orgSettings)
      .set({ digestTime: '05:00' })
      .where(eq(orgSettings.orgId, f.a.orgId));
    try {
      await bellDayJob.run(deps, new Date('2026-11-19T23:00:00Z'));
      expect((await rowsOf(person('acc-a').userId, 'day_dues')).map((r) => r.eventKey)).toEqual([
        `day_dues:${TODAY}`,
      ]);
    } finally {
      await f.t.admin.db
        .update(orgSettings)
        .set({ digestTime: '09:00' })
        .where(eq(orgSettings.orgId, f.a.orgId));
    }
  });

  it('уборка: строки старше 90 дней удаляются задачей, свежие остаются', async () => {
    await clear();
    await inOrg((tx) =>
      putBell(
        tx,
        [
          {
            userId: person('acc-a').userId,
            kind: 'other',
            event: 'x',
            text: 'Старая',
            eventKey: 'old',
          },
          {
            userId: person('acc-a').userId,
            kind: 'other',
            event: 'x',
            text: 'Свежая',
            eventKey: 'new',
          },
        ],
        new Date(NOW),
      ),
    );
    // Уборка сверяет с часами базы (`now()`): сроки строк — от настоящих часов (№ 52).
    await f.t.admin.db
      .update(bellNotifications)
      .set({ createdAt: new Date(Date.now() - 91 * 86_400_000) })
      .where(eq(bellNotifications.eventKey, 'old'));
    await f.t.admin.db
      .update(bellNotifications)
      .set({ createdAt: new Date() })
      .where(eq(bellNotifications.eventKey, 'new'));
    await bellCleanupJob.run(deps, new Date(NOW));
    expect((await rowsOf(person('acc-a').userId)).map((r) => r.text)).toEqual(['Свежая']);
  });

  it('события контрагента: ответственному и без Telegram, с Telegram — ещё и тому, кому ушло сообщение; оплата обслуживания — только тем, кто видит плату', async () => {
    await clear();
    const question = (messageId: string) =>
      inOrg((tx) =>
        bellContractor(deps, tx, cp, {
          event: 'cp_question',
          messageId,
          question: 'Когда сдаём отчёт в Соцфонд?',
        }),
      );
    expect(await question('0b7f8a52-8a36-4a8e-9a43-000000000001')).toBe(1);
    const [row] = await rowsOf(person('acc-a').userId, 'cp_question');
    expect(row).toMatchObject({ kind: 'other', contractorId: cp, need: null });
    expect(row!.text).toBe(
      ru('bell.line.cp_question').replace('{text}', 'Когда сдаём отчёт в Соцфонд?'),
    );
    expect(await rowsOf(f.a.ownerUserId)).toEqual([]);
    // Тот же вопрос второй раз — строки не удваиваются.
    expect(await question('0b7f8a52-8a36-4a8e-9a43-000000000001')).toBe(0);

    // У владельца Telegram, у ответственного нет — сообщение ушло владельцу: строка и ему.
    await f.t.admin.db
      .insert(telegramLinks)
      .values({ userId: f.a.ownerUserId, orgId: f.a.orgId, chatId: 7_400_001 });
    try {
      expect(await question('0b7f8a52-8a36-4a8e-9a43-000000000002')).toBe(2);
      expect(await rowsOf(f.a.ownerUserId, 'cp_question')).toHaveLength(1);

      // Оплата за обслуживание: у бухгалтера нет права «Видеть плату за обслуживание» — только владельцу.
      expect(
        await inOrg((tx) =>
          bellContractor(deps, tx, cp, {
            event: 'fee_paid',
            messageId: '0b7f8a52-8a36-4a8e-9a43-000000000003',
            amount: 150_000 as Tyiyn,
          }),
        ),
      ).toBe(1);
      const [fee] = await rowsOf(f.a.ownerUserId, 'fee_paid');
      expect(fee).toMatchObject({ kind: 'money', need: 'fee', contractorId: cp });
      expect(await rowsOf(person('acc-a').userId, 'fee_paid')).toEqual([]);
      // Владелец видит её в панели (все права — по роли владельца), пока включена «Плата за обслуживание».
      const money = async () => (await page('owner-a', 'money')).items.map((x) => x.event);
      expect(await money()).toEqual([]);
      await setFeatures({ tasks: true, files: true, fee: true });
      try {
        expect(await money()).toEqual(['fee_paid']);
      } finally {
        await setFeatures({ tasks: true, files: true });
      }
    } finally {
      await f.t.admin.db.delete(telegramLinks).where(eq(telegramLinks.userId, f.a.ownerUserId));
    }
  });

  it('право строки — действующее: «Видеть плату за обслуживание» без «Просматривать контрагентов» строки не показывает', async () => {
    await clear();
    const senior = person('senior-a').userId;
    const role = f.roleIds.senior;
    await inOrg((tx) =>
      putBell(
        tx,
        [
          {
            userId: senior,
            kind: 'money',
            event: 'fee_paid',
            need: 'fee',
            text: 'Оплата',
            eventKey: 'fee:1',
          },
        ],
        new Date(NOW),
      ),
    );
    await setFeatures({ tasks: true, files: true, fee: true });
    await f.t.admin.db
      .insert(rolePermissions)
      .values({ orgId: f.a.orgId, roleId: role, permissionId: 'fee' });
    try {
      // В роли «Старший» — «Просматривать контрагентов» и «Видеть плату…»: строка видна.
      expect((await page('senior-a', 'money')).items.map((x) => x.event)).toEqual(['fee_paid']);
      // Сняли «Просматривать контрагентов» — «Видеть плату…» само не действует: строки нет.
      await f.t.admin.db
        .delete(rolePermissions)
        .where(and(eq(rolePermissions.roleId, role), eq(rolePermissions.permissionId, 'cpView')));
      expect((await page('senior-a', 'money')).items).toEqual([]);
    } finally {
      await f.t.admin.db
        .delete(rolePermissions)
        .where(and(eq(rolePermissions.roleId, role), eq(rolePermissions.permissionId, 'fee')));
      await f.t.admin.db
        .insert(rolePermissions)
        .values({ orgId: f.a.orgId, roleId: role, permissionId: 'cpView' })
        .onConflictDoNothing();
      await setFeatures({ tasks: true, files: true });
    }
  });

  it('(приёмка блока 3) контрагент прислал файлы — у ответственного «1», строка ведёт в «Отправленные файлы»; открыл панель на одном устройстве — счётчик погас и на другом', async () => {
    await clear();
    const phone = await signIn(app, 'acc-a', TEST_PASSWORD);
    // Страница контрагента включена, загрузка файлов разрешена — контрагент может прислать файлы.
    await f.t.admin.db
      .insert(contractorPages)
      .values({ contractorId: cp, orgId: f.a.orgId, code: '482915' })
      .onConflictDoNothing();
    await setFeatures({ tasks: true, files: true, cppage: true });
    try {
      // Контрагент отправил два файла со страницы — общий вход «Отправленных файлов».
      const pdf = new TextEncoder().encode('%PDF-1.4\n%колокольчик\n');
      const { ids } = await addSentFiles(deps, {
        orgId: f.a.orgId,
        contractorId: cp,
        source: 'page',
        files: [
          { name: 'Акт сверки.pdf', bytes: pdf },
          { name: 'Счёт.pdf', bytes: pdf },
        ],
      });
      expect(ids).toHaveLength(2);
      expect(
        (await rowsOf(person('acc-a').userId, 'cp_file')).map((r) => [r.eventKey, r.need]),
      ).toEqual([[`cp_file:${ids[0]}`, 'filesView']]);
      expect(await unseen('acc-a')).toBe(1);
      const files = await page('acc-a', 'files');
      expect(files.items.map((x) => [x.event, x.text, x.open])).toEqual([
        ['cp_file', ru('bell.line.cp_file.many').replace('{n}', '2'), { kind: 'cp_sent', id: cp }],
      ]);
      // Открыл панель на телефоне — на ПК счётчик погас при следующем запросе.
      const seen = await apiRequest(app, 'POST', '/api/bell/seen', phone);
      expect(seen.status).toBe(200);
      expect(await unseen('acc-a')).toBe(0);
      // Страницу контрагента выключили — «Отправленных файлов» нет, строки не видно.
      await setFeatures({ tasks: true, files: true });
      expect((await page('acc-a', 'files')).items).toEqual([]);
    } finally {
      await setFeatures({ tasks: true, files: true });
    }
  });

  it('сообщение платформы — строкой каждому действующему сотруднику, и без Telegram', async () => {
    await clear();
    const res = await call('platform-admin', 'POST', '/api/admin/telegram/broadcast', {
      org: null,
      title: '',
      text: 'С 22:00 до 23:00 платформа будет недоступна',
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const text = ru('bell.line.broadcast').replace(
      '{text}',
      'С 22:00 до 23:00 платформа будет недоступна',
    );
    for (const userId of [
      f.a.ownerUserId,
      f.b.ownerUserId,
      ...Object.values(f.people).map((p) => p.userId),
    ]) {
      const rows = await rowsOf(userId, 'broadcast');
      expect(rows.map((r) => r.text)).toEqual([text]);
    }
    expect((await page('acc-b')).items.map((x) => x.text)).toEqual([text]);
  });

  it('«Вход заблокирован» — строка самому и владельцу организации, и без Telegram', async () => {
    await clear();
    const login = (password: string) =>
      app.request('/api/auth/login', {
        method: 'POST',
        headers: { origin: TEST_ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ login: 'hr-a', password }),
      });
    for (let i = 0; i < ACCOUNT_LOCK_FAILURES; i++) {
      await f.t.admin.db.delete(loginAttempts).where(eq(loginAttempts.login, 'hr-a'));
      expect((await login(`неверный-${i}`)).status).toBe(401);
    }
    await f.t.admin.db.delete(loginAttempts).where(eq(loginAttempts.login, 'hr-a'));
    expect((await login(TEST_PASSWORD)).status).toBe(403);

    const self = await rowsOf(person('hr-a').userId, 'login_locked');
    expect(self.map((r) => r.text)).toEqual([ru('bell.line.login_locked')]);
    const toOwner = await rowsOf(f.a.ownerUserId, 'login_locked');
    expect(toOwner).toHaveLength(1);
    expect(toOwner[0]).toMatchObject({
      targetKind: 'employee',
      targetId: person('hr-a').employeeId,
      text: ru('bell.line.login_locked.staff').replace('{name}', 'hr-a'),
    });
    // Главному бухгалтеру — нет: снимает блокировку владелец.
    expect(await rowsOf(person('chief-a').userId, 'login_locked')).toEqual([]);
  });
  it('«На исправление» — строка ответственному с причиной (право «Просматривать отчёты»), и без Telegram', async () => {
    await clear();
    await f.t.admin.db
      .update(orgSettings)
      .set({ reportConfirm: true })
      .where(eq(orgSettings.orgId, f.a.orgId));
    try {
      const report = await withOrgContext(
        f.t.app.db,
        { orgId: f.a.orgId, userId: f.a.ownerUserId },
        (tx) =>
          createManualReport(
            tx,
            {
              contractorId: cp,
              reportTypeCode: 't1m',
              month: '2026-08-01',
              eventDate: null,
              due: '2026-11-25',
              reasonCode: 'ПРЧ-001',
              reasonName: 'Продление от госоргана',
            },
            { today: TODAY, scope: undefined },
          ),
      );
      const sent = await call('acc-a', 'POST', `/api/reports/${report.id}/submit`, {
        version: report.version,
        date: '2026-11-19',
      });
      expect(sent.status, await sent.clone().text()).toBe(200);
      const { version } = (await sent.json()) as { version: number };
      const fix = await call('chief-a', 'POST', `/api/reports/${report.id}/fix`, {
        version,
        reason: 'Неверная численность',
      });
      expect(fix.status, await fix.clone().text()).toBe(200);
      const rows = await rowsOf(person('acc-a').userId, 'report_fix');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        kind: 'reports',
        need: 'repView',
        targetKind: 'report',
        targetId: report.id,
        contractorId: cp,
      });
      expect(rows[0]!.text).toContain('Неверная численность');
      // Себе не пишется: вернувший строки не получает.
      expect(await rowsOf(person('chief-a').userId)).toEqual([]);
      expect((await page('acc-a', 'reports')).items.map((x) => x.event)).toEqual(['report_fix']);
    } finally {
      await f.t.admin.db
        .update(orgSettings)
        .set({ reportConfirm: false })
        .where(eq(orgSettings.orgId, f.a.orgId));
    }
  });

  it('задача выполнена — строка постановщику; возвращена на доработку — исполнителю с причиной', async () => {
    const created = await call('owner-a', 'POST', '/api/tasks', {
      title: 'Сверить остатки по кассе',
      description: '',
      categoryCode: 'КАТ-001',
      contractorId: cp,
      executorEmployeeId: person('acc-a').employeeId,
      term: 'day',
      dueDate: '2026-11-27',
      needFile: false,
      confirm: true,
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const task = Task.parse(await created.json());
    await clear();
    const done = await call('acc-a', 'POST', `/api/tasks/${task.id}/done`, {});
    expect(done.status, await done.clone().text()).toBe(200);
    const onConfirm = await rowsOf(f.a.ownerUserId, 'task_on_confirm');
    expect(onConfirm).toHaveLength(1);
    expect(onConfirm[0]).toMatchObject({ kind: 'tasks', targetKind: 'task', targetId: task.id });
    expect(onConfirm[0]!.text).toContain('Сверить остатки по кассе');
    expect(await rowsOf(person('acc-a').userId)).toEqual([]);

    const back = await call('owner-a', 'POST', `/api/tasks/${task.id}/rework`, {
      reason: 'Нет акта сверки',
    });
    expect(back.status, await back.clone().text()).toBe(200);
    const rework = await rowsOf(person('acc-a').userId, 'task_rework');
    expect(rework).toHaveLength(1);
    expect(rework[0]!.text).toContain('Сверить остатки по кассе');
    expect(rework[0]!.text).toContain('Нет акта сверки');
    expect((await page('acc-a', 'tasks')).items.map((x) => x.event)).toEqual(['task_rework']);
  });

  it('страница контрагента закрыта после неверных кодов — строка ответственному и без бота, одна за день', async () => {
    await clear();
    const noBot = createTestDeps({ db: f.t.app.db, clock: fixedClock(NOW), telegram: undefined });
    await notifyPageClosed(noBot, f.a.orgId, cp);
    await notifyPageClosed(noBot, f.a.orgId, cp);
    const rows = await rowsOf(person('acc-a').userId, 'page_closed');
    expect(rows.map((r) => [r.eventKey, r.targetKind, r.targetId])).toEqual([
      [`page_closed:${cp}:${TODAY}`, 'contractor', cp],
    ]);
  });

  it('новость — строкой в колокольчике; прочитана в колокольчике — прочитана и в «Новостях»', async () => {
    await clear();
    await f.t.admin.db.insert(news).values({
      id: 'bell-api-news',
      type: 'feature',
      title: 'Колокольчик уведомлений',
      short: 'Коротко',
      md: 'Текст',
      status: 'published',
      // Дата — с появления колокольчика: новость видна по часам базы (`now()`), будущая не видна (№ 52).
      publishDate: BELL_FROM,
      // Вышла позже создания учётных записей теста — иначе считается прочитанной (п. Г-3).
      publishedAt: new Date(),
    });
    try {
      const items = (await page('acc-a', 'news')).items;
      expect(items.map((x) => [x.event, x.text, x.open])).toEqual([
        ['news', 'Колокольчик уведомлений', { kind: 'news', id: 'bell-api-news' }],
      ]);
      expect((await call('acc-a', 'POST', `/api/bell/${items[0]!.id}/read`)).status).toBe(200);
      const reads = await f.t.admin.db
        .select()
        .from(newsReads)
        .where(
          and(eq(newsReads.userId, person('acc-a').userId), eq(newsReads.newsId, 'bell-api-news')),
        );
      expect(reads).toHaveLength(1);
      // У другого сотрудника новость не прочитана.
      expect((await page('chief-a', 'news')).items.map((x) => x.read)).toEqual([false]);
    } finally {
      await f.t.admin.db.delete(news).where(eq(news.id, 'bell-api-news'));
    }
  });

  it('режим Админка: новая заявка с сайта — строкой администратору платформы, сотрудникам — нет', async () => {
    await clear();
    const [lead] = await f.t.admin.db
      .insert(platformLeads)
      .values({
        name: 'Заявитель',
        firm: 'ОсОО «Колокол»',
        phone: '+996555000002',
        size: '1-10',
        createdAt: new Date('2026-11-19T06:00:00Z'),
      })
      .returning({ id: platformLeads.id });
    try {
      const items = (await page('platform-admin')).items;
      expect(items.map((x) => [x.event, x.text, x.open])).toEqual([
        [
          'lead',
          ru('bell.line.lead').replace('{name}', 'ОсОО «Колокол»'),
          { kind: 'lead', id: lead!.id },
        ],
      ]);
      expect((await page('owner-a')).items).toEqual([]);
    } finally {
      await f.t.admin.db.delete(platformLeads).where(eq(platformLeads.id, lead!.id));
    }
  });
});
