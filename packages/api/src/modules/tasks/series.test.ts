import { createFakeTelegram, fixedClock, type FakeTelegram } from '@buhuchet/adapters';
import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { ApiError, SeriesList, SeriesTasks, Task, TaskSummary } from '@buhuchet/shared';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import type { ApiDeps } from '../../deps';
import {
  apiRequest,
  createStaffFixture,
  createTestDeps,
  linkTelegram,
  signIn,
  TEST_PASSWORD,
} from '../../testing';
import { taskSeriesJob, taskSeriesNotifyJob } from './series-job';

/*
 * Повторяющиеся задачи (доработки 28.11.2026; план 28.11, этап 1, П6–П8): методы серии — права и
 * область, чужая организация, выключенные «Задачи»; ночной запуск — по двум организациям, повтор и
 * остановка без человека; сообщения — «Повтор: <правило>» сразу, следующие задачи и «Повтор
 * закончился / остановлен» — в «Час напоминаний» (подставной бот проверяет каждое сообщение).
 */

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;
const BASE = 'https://test.buhuchet.kg';
/** Воскресенье, 18.10.2026, 09:00 по Бишкеку. */
const NOW = '2026-10-18T03:00:00Z';
const at = (day: string, hm = '00:05') => new Date(`${day}T${hm}:00+06:00`);
const WEEKLY = { every: 1, unit: 'week', weekDays: [0, 2], end: { kind: 'never' } } as const;

describe.skipIf(!databaseAvailable())(
  'Повторяющиеся задачи: методы API, ночной запуск, сообщения',
  () => {
    let f: Fixture;
    let deps: ApiDeps & { clock: ReturnType<typeof fixedClock> };
    let app: ReturnType<typeof createApp>;
    let tg: FakeTelegram;
    const cookies: Record<string, string> = {};
    let cp: string;

    const employee = (login: string) => f.people[login]?.employeeId ?? '';
    const call = (
      login: string,
      method: 'GET' | 'POST' | 'PATCH' | 'PUT',
      path: string,
      body?: unknown,
    ) => apiRequest(app, method, path, cookies[login], body);
    const failure = async (res: Response) => ApiError.parse(await res.json()).error;
    const body = (patch: Record<string, unknown> = {}) => ({
      title: 'Выписка банка',
      description: '',
      categoryCode: 'КАТ-001',
      contractorId: null,
      executorEmployeeId: employee('acc-a'),
      term: 'day',
      dueDate: '2026-10-18',
      needFile: false,
      confirm: false,
      repeat: WEEKLY,
      ...patch,
    });
    const create = async (login: string, patch: Record<string, unknown> = {}) => {
      const res = await call(login, 'POST', '/api/tasks', body(patch));
      expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
      return Task.parse(await res.json());
    };
    const card = async (login: string, id: string) => {
      const res = await call(login, 'GET', `/api/tasks/${id}`);
      expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
      return Task.parse(await res.json());
    };
    const seriesTasks = async (seriesId: string) =>
      f.t.admin.db
        .select({
          id: schema.tasks.id,
          date: schema.tasks.seriesDate,
          org: schema.tasks.orgId,
          author: schema.tasks.authorEmployeeId,
          createdBy: schema.tasks.createdBy,
          title: schema.tasks.title,
          status: schema.tasks.status,
        })
        .from(schema.tasks)
        .where(eq(schema.tasks.seriesId, seriesId))
        .orderBy(schema.tasks.seriesDate);
    const seriesRow = async (id: string) =>
      (await f.t.admin.db.select().from(schema.taskSeries).where(eq(schema.taskSeries.id, id)))[0]!;
    const runNight = (day: string) => taskSeriesJob.run(deps, at(day));
    const features = (value: Record<string, boolean>, orgId = f.a.orgId) =>
      f.t.admin.db
        .update(schema.orgSettings)
        .set({ features: value })
        .where(eq(schema.orgSettings.orgId, orgId));
    const history = async (taskId: string) =>
      f.t.admin.db
        .select({
          action: schema.auditLog.action,
          actor: schema.auditLog.actorUserId,
          changes: schema.auditLog.changes,
        })
        .from(schema.auditLog)
        .where(and(eq(schema.auditLog.entity, 'task'), eq(schema.auditLog.entityId, taskId)))
        .orderBy(schema.auditLog.id);

    beforeAll(async () => {
      f = await createStaffFixture();
      await seedAllPlatformDictionaries(f.t.admin.db);
      tg = createFakeTelegram();
      deps = createTestDeps({
        db: f.t.app.db,
        clock: fixedClock(NOW),
        telegram: tg,
      }) as typeof deps;
      app = createApp(deps);
      await features({ tasks: true, telegram: true });
      await features({ tasks: true, telegram: true }, f.b.orgId);
      // «Кадры» — постановщик своих задач: «Ставить задачи» без «Видеть задачи всех».
      await f.t.admin.db
        .insert(schema.rolePermissions)
        .values({ orgId: f.a.orgId, roleId: f.roleIds.hr, permissionId: 'tasksCreate' });
      for (const login of ['owner-a', 'chief-a', 'acc-a', 'hr-a', 'owner-b']) {
        cookies[login] = await signIn(app, login, TEST_PASSWORD);
      }
      const [row] = await f.t.admin.db
        .insert(schema.contractors)
        .values({
          orgId: f.a.orgId,
          name: 'ОсОО «Ала-Тоо Трейд»',
          inn: '03744097401851',
          phone: '+996505890076',
          formCode: 'ФС-01',
          regimeCode: 'РЕЖ-01',
          startDate: '2026-01-15',
          responsibleEmployeeId: employee('acc-a'),
        })
        .returning({ id: schema.contractors.id });
      cp = row!.id;
    });

    beforeEach(() => {
      deps.clock.set(NOW);
    });

    afterAll(async () => {
      await f?.t.drop();
    });

    it('«Сохранить» с повтором: серия и первая задача на ближайшую дату, «Повтор настроен», строка «Повтор» в карточке', async () => {
      const task = await create('hr-a');
      // 18.10 — воскресенье: первая задача — на ближайший отмеченный день, понедельник 19.10.
      expect(task.dueDate).toBe('2026-10-19');
      expect(task.series).toMatchObject({
        text: 'Каждую неделю: пн, ср',
        state: 'active',
        next: '2026-10-21',
        count: 1,
        manage: true,
        refusal: null,
      });
      // Правило словами — и в `repeat` карточки, как у строки списка: по нему сайт спрашивает «эту / эту и следующие».
      expect(task.repeat).toBe('Каждую неделю: пн, ср');
      expect(task.author.id).toBe(employee('hr-a'));
      const actions = (await history(task.id)).map((h) => h.action);
      expect(actions).toEqual(['create', 'series_set']);
      // Исполнитель видит строку «Повтор» без кнопок.
      expect((await card('acc-a', task.id)).series).toMatchObject({ manage: false, refusal: null });
      // В списке — правило словами и фильтр «Повторяющиеся».
      const res = await call(
        'acc-a',
        'GET',
        `/api/tasks?tab=mine&filters=${encodeURIComponent(JSON.stringify({ rep: { type: 'enum', vals: ['repeat'] } }))}`,
      );
      expect(res.status).toBe(200);
      const items = ((await res.json()) as { items: { id: string; repeat: string | null }[] })
        .items;
      expect(items.find((r) => r.id === task.id)?.repeat).toBe('Каждую неделю: пн, ср');
    });

    it('правило проверяет сервер: 400 с полем; дат нет — 400 «series_no_dates»; без «Ставить задачи» — 403', async () => {
      const before = (
        await f.t.admin.db.select({ n: sql<number>`count(*)::int` }).from(schema.taskSeries)
      )[0]!.n;
      const noDays = await call(
        'hr-a',
        'POST',
        '/api/tasks',
        body({ repeat: { ...WEEKLY, weekDays: [] } }),
      );
      expect(noDays.status).toBe(400);
      expect(await failure(noDays)).toMatchObject({
        code: 'series_week_days',
        details: { field: 'repeat.weekDays' },
      });
      const early = await call(
        'hr-a',
        'POST',
        '/api/tasks',
        body({ repeat: { ...WEEKLY, end: { kind: 'date', date: '2026-10-01' } } }),
      );
      expect((await failure(early)).code).toBe('series_end_before_start');
      // Начало — воскресенье, конец — тот же день: по правилу «пн, ср» дат нет.
      const none = await call(
        'hr-a',
        'POST',
        '/api/tasks',
        body({ repeat: { ...WEEKLY, end: { kind: 'date', date: '2026-10-18' } } }),
      );
      expect(none.status).toBe(400);
      expect((await failure(none)).code).toBe('series_no_dates');
      const month = await call(
        'hr-a',
        'POST',
        '/api/tasks',
        body({ term: 'month', repeat: WEEKLY }),
      );
      expect((await failure(month)).code).toBe('series_unit');
      expect((await call('acc-a', 'POST', '/api/tasks', body())).status).toBe(403);
      const after = (
        await f.t.admin.db.select({ n: sql<number>`count(*)::int` }).from(schema.taskSeries)
      )[0]!.n;
      expect(after).toBe(before);
    });

    it('права и область: «Повторы» — свои у постановщика, все у владельца и «Видеть задачи всех»; без права — 403; чужая организация — 404', async () => {
      const mine = await create('hr-a', { title: 'Своя серия кадров' });
      const chiefs = await create('chief-a', {
        title: 'Серия главного',
        executorEmployeeId: employee('chief-a'),
      });
      const ids = async (login: string) => {
        const res = await call(login, 'GET', '/api/task-series?size=100');
        expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
        return SeriesList.parse(await res.json()).items.map((r) => r.id);
      };
      expect(await ids('hr-a')).toContain(mine.series!.id);
      expect(await ids('hr-a')).not.toContain(chiefs.series!.id);
      expect(await ids('chief-a')).toEqual(
        expect.arrayContaining([mine.series!.id, chiefs.series!.id]),
      );
      expect(await ids('owner-a')).toEqual(
        expect.arrayContaining([mine.series!.id, chiefs.series!.id]),
      );
      expect((await call('acc-a', 'GET', '/api/task-series')).status).toBe(403);
      expect(await ids('owner-b')).toEqual([]);
      // Счётчик вкладки — действующие серии в видимости; без права — null.
      const summary = async (login: string) =>
        TaskSummary.parse(await (await call(login, 'GET', '/api/tasks/summary')).json()).series;
      expect(await summary('acc-a')).toBeNull();
      expect(await summary('hr-a')).toBeGreaterThanOrEqual(1);

      const sid = mine.series!.id;
      // Исполнитель видит задачи серии, чужая организация — нет (как будто серии нет).
      const list = await call('acc-a', 'GET', `/api/task-series/${sid}/tasks`);
      expect(list.status).toBe(200);
      expect(SeriesTasks.parse(await list.json()).items).toHaveLength(1);
      for (const path of [`/api/task-series/${sid}/tasks`]) {
        expect((await call('owner-b', 'GET', path)).status).toBe(404);
      }
      const v = (await seriesRow(sid)).version;
      expect(
        (await call('owner-b', 'POST', `/api/task-series/${sid}/stop`, { version: v })).status,
      ).toBe(404);
      expect(
        (
          await call('owner-b', 'PUT', `/api/task-series/${sid}/rule`, {
            rule: WEEKLY,
            start: '2026-10-19',
            version: v,
          })
        ).status,
      ).toBe(404);
      // Не постановщик и не владелец не меняет: исполнитель и «Видеть задачи всех».
      for (const login of ['acc-a', 'chief-a']) {
        const res = await call(login, 'POST', `/api/task-series/${sid}/stop`, { version: v });
        expect(res.status).toBe(403);
        expect((await failure(res)).code).toBe('series_author_only');
      }
      // Устаревшая версия — 409.
      expect(
        (await call('hr-a', 'POST', `/api/task-series/${sid}/stop`, { version: v - 1 })).status,
      ).toBe(409);
      // Владелец может.
      const stopped = await call('owner-a', 'POST', `/api/task-series/${sid}/stop`, { version: v });
      expect(stopped.status, JSON.stringify(await stopped.clone().json())).toBe(200);
      expect(((await stopped.json()) as { series: { state: string } }).series.state).toBe(
        'stopped',
      );
      expect((await history(mine.id)).map((h) => h.action)).toContain('series_stop');

      // Постановщик без «Ставить задачи» видит кнопки неактивными с подсказкой и не меняет.
      await f.t.admin.db
        .delete(schema.rolePermissions)
        .where(
          and(
            eq(schema.rolePermissions.roleId, f.roleIds.hr),
            eq(schema.rolePermissions.permissionId, 'tasksCreate'),
          ),
        );
      try {
        const view = (await card('hr-a', mine.id)).series!;
        expect(view.manage).toBe(false);
        expect(view.refusal).toContain('«Ставить задачи»');
        const res = await call('hr-a', 'POST', `/api/task-series/${sid}/resume`, {
          version: view.version,
        });
        expect((await failure(res)).code).toBe('series_create_right');
      } finally {
        await f.t.admin.db
          .insert(schema.rolePermissions)
          .values({ orgId: f.a.orgId, roleId: f.roleIds.hr, permissionId: 'tasksCreate' });
      }

      // «Задачи» выключены — 403 у каждого метода.
      await features({ telegram: true });
      try {
        for (const [method, path] of [
          ['GET', '/api/task-series'],
          ['GET', `/api/task-series/${sid}/tasks`],
          ['POST', `/api/task-series/${sid}/resume`],
        ] as const) {
          const res = await call(
            'owner-a',
            method,
            path,
            method === 'POST' ? { version: 1 } : undefined,
          );
          expect(res.status).toBe(403);
          expect((await failure(res)).code).toBe('tasks_off');
        }
      } finally {
        await features({ tasks: true, telegram: true });
      }
    });

    it('«Возобновить»: задача на ближайшую дату, пропущенные не ставятся; при заблокированном исполнителе — отказ с причиной', async () => {
      const task = await create('hr-a', { title: 'Возобновляемая' });
      const sid = task.series!.id;
      let v = (await seriesRow(sid)).version;
      expect(
        (await call('hr-a', 'POST', `/api/task-series/${sid}/stop`, { version: v })).status,
      ).toBe(200);
      // Прошла неделя: задача 19.10 позади, ближайшая по правилу — среда 28.10.
      deps.clock.set('2026-10-26T06:00:00Z');
      await f.t.admin.db
        .update(schema.employees)
        .set({ active: false })
        .where(eq(schema.employees.id, employee('acc-a')));
      v = (await seriesRow(sid)).version;
      try {
        const blocked = await call('hr-a', 'POST', `/api/task-series/${sid}/resume`, {
          version: v,
        });
        expect(blocked.status).toBe(409);
        const err = await failure(blocked);
        expect(err.code).toBe('series_resume_blocked');
        expect(err.message).toContain('Исполнитель заблокирован');
      } finally {
        await f.t.admin.db
          .update(schema.employees)
          .set({ active: true })
          .where(eq(schema.employees.id, employee('acc-a')));
      }
      const res = await call('hr-a', 'POST', `/api/task-series/${sid}/resume`, { version: v });
      expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
      expect(((await res.json()) as { made: boolean }).made).toBe(true);
      const rows = await seriesTasks(sid);
      expect(rows.map((r) => r.date)).toEqual(['2026-10-19', '2026-10-26']);
      // Ночная вставка — от имени постановщика серии, без автора записи.
      expect(rows[1]).toMatchObject({ author: employee('hr-a'), createdBy: null });
      expect((await seriesRow(sid)).state).toBe('active');
    });

    it('«Только эту задачу» правило не меняет; «Эту и следующие» правит серию и открытые следующие задачи; отмена «Эту и следующие» останавливает повтор', async () => {
      const first = await create('hr-a', { title: 'Сверка кассы' });
      const sid = first.series!.id;
      deps.clock.set('2026-10-20T06:00:00Z');
      await runNight('2026-10-20');
      const [, second] = await seriesTasks(sid);
      expect(second?.date).toBe('2026-10-21');
      const edit = (patch: Record<string, unknown>) =>
        call('hr-a', 'PATCH', `/api/tasks/${first.id}`, {
          ...body(),
          dueDate: '2026-10-19',
          version: first.version,
          ...patch,
        });
      const one = await edit({ scope: 'one', repeat: { ...WEEKLY, weekDays: [4] } });
      expect(one.status).toBe(400);
      expect((await failure(one)).code).toBe('series_rule_one');
      const next = await edit({
        scope: 'next',
        title: 'Сверка кассы и банка',
        repeat: { ...WEEKLY, weekDays: [0, 4] },
      });
      expect(next.status, JSON.stringify(await next.clone().json())).toBe(200);
      const after = Task.parse(await next.json());
      expect(after.series?.text).toBe('Каждую неделю: пн, пт');
      expect((await seriesTasks(sid)).map((r) => r.title)).toEqual([
        'Сверка кассы и банка',
        'Сверка кассы и банка',
      ]);
      const edits = (await history(first.id)).filter((h) => h.action === 'series_edit');
      expect(edits[0]?.changes).toEqual([
        { field: 'repeat', from: 'Каждую неделю: пн, ср', to: 'Каждую неделю: пн, пт' },
      ]);
      // Отмена: исполнитель — не постановщик, отказ; постановщик «Эту и следующие» — повтор остановлен.
      expect(
        (await call('acc-a', 'POST', `/api/tasks/${second!.id}/cancel?scope=next`)).status,
      ).toBe(403);
      const cancelled = await call('hr-a', 'POST', `/api/tasks/${second!.id}/cancel?scope=next`);
      expect(cancelled.status, JSON.stringify(await cancelled.clone().json())).toBe(200);
      expect((await seriesRow(sid)).state).toBe('stopped');
      expect((await seriesRow(sid)).stopReason).toBe('manual');
    });

    it('ночной запуск: по двум организациям — свои задачи, повтор не удваивает, сбой одной не мешает другой; останавливает без человека', async () => {
      const a = await create('chief-a', { title: 'Ночная А', contractorId: cp });
      const b = Task.parse(
        await (
          await call(
            'owner-b',
            'POST',
            '/api/tasks',
            body({ title: 'Ночная Б', executorEmployeeId: employee('acc-b') }),
          )
        ).json(),
      );
      deps.clock.set('2026-10-20T00:00:00Z');
      await runNight('2026-10-20');
      await runNight('2026-10-20');
      const rowsA = await seriesTasks(a.series!.id);
      const rowsB = await seriesTasks(b.series!.id);
      expect(rowsA.map((r) => r.date)).toEqual(['2026-10-19', '2026-10-21']);
      expect(rowsB.map((r) => r.date)).toEqual(['2026-10-19', '2026-10-21']);
      expect(rowsA.every((r) => r.org === f.a.orgId)).toBe(true);
      expect(rowsB.every((r) => r.org === f.b.orgId)).toBe(true);
      expect((await history(rowsA[1]!.id)).map((h) => h.action)).toEqual(['series_make']);

      // Одновременный запуск — одна задача на дату.
      deps.clock.set('2026-10-22T00:00:00Z');
      await Promise.all([runNight('2026-10-22'), runNight('2026-10-22')]);
      expect((await seriesTasks(a.series!.id)).map((r) => r.date)).toEqual([
        '2026-10-19',
        '2026-10-21',
        '2026-10-26',
      ]);

      // Контрагент приостановлен — пропуск без остановки; в архиве — «Остановлена» с причиной.
      deps.clock.set('2026-10-27T00:00:00Z');
      await f.t.admin.db
        .update(schema.contractors)
        .set({ serviceStatus: 'paused' })
        .where(eq(schema.contractors.id, cp));
      await runNight('2026-10-27');
      expect(await seriesTasks(a.series!.id)).toHaveLength(3);
      expect((await seriesRow(a.series!.id)).state).toBe('active');
      await f.t.admin.db
        .update(schema.contractors)
        .set({ serviceStatus: 'archived' })
        .where(eq(schema.contractors.id, cp));
      await runNight('2026-10-27');
      const stopped = await seriesRow(a.series!.id);
      expect(stopped).toMatchObject({ state: 'stopped', stopReason: 'archive' });
      const halt = (await history(rowsA[2]?.id ?? ''))
        .concat(...(await Promise.all((await seriesTasks(a.series!.id)).map((r) => history(r.id)))))
        .find((h) => h.action === 'series_stop');
      expect(halt).toMatchObject({
        actor: null,
        changes: [{ field: 'why', to: 'Контрагент в архиве' }],
      });
      await f.t.admin.db
        .update(schema.contractors)
        .set({ serviceStatus: 'active' })
        .where(eq(schema.contractors.id, cp));

      // «Задачи» выключены в организации Б — задачи не ставятся, серия остаётся «Действует».
      const beforeOff = (await seriesTasks(b.series!.id)).length;
      await features({ tasks: false, telegram: true }, f.b.orgId);
      try {
        deps.clock.set('2026-11-02T00:00:00Z');
        await runNight('2026-11-02');
        expect(await seriesTasks(b.series!.id)).toHaveLength(beforeOff);
        expect((await seriesRow(b.series!.id)).state).toBe('active');
      } finally {
        await features({ tasks: true, telegram: true }, f.b.orgId);
      }
    });

    it('«После N повторов»: последняя задача — серия «Завершена», «Повтор закончился»', async () => {
      const task = await create('hr-a', {
        title: 'Два раза',
        repeat: { every: 1, unit: 'day', end: { kind: 'count', count: 2 } },
      });
      const sid = task.series!.id;
      deps.clock.set('2026-10-20T00:00:00Z');
      await runNight('2026-10-20');
      const rows = await seriesTasks(sid);
      expect(rows.map((r) => r.date)).toEqual(['2026-10-18', '2026-10-20']);
      expect((await seriesRow(sid)).state).toBe('finished');
      await runNight('2026-10-21');
      expect(await seriesTasks(sid)).toHaveLength(2);
      const all = (await Promise.all(rows.map((r) => history(r.id)))).flat();
      expect(all.filter((h) => h.action === 'series_end')).toHaveLength(1);
    });

    it('сообщения: первая задача — сразу со строкой «Повтор:»; следующие и «Повтор остановлен» — в час напоминаний, один раз', async () => {
      await linkTelegram(app, cookies['acc-a']!, 7202);
      await linkTelegram(app, cookies['hr-a']!, 7204);
      tg.sent.length = 0;
      const task = await create('hr-a', { title: 'Отчёт по кассе' });
      const firstMsg = tg.sent.filter((m) => m.chatId === 7202);
      expect(firstMsg).toHaveLength(1);
      expect(firstMsg[0]!.text).toContain('Повтор: Каждую неделю: пн, ср');

      deps.clock.set('2026-10-20T18:05:00Z');
      await runNight('2026-10-21');
      const notify = taskSeriesNotifyJob(BASE);
      tg.sent.length = 0;
      // До часа напоминаний (09:00) — ничего.
      deps.clock.set(at('2026-10-21', '08:55').toISOString());
      await notify.run(deps, at('2026-10-21', '08:55'));
      expect(tg.sent.filter((m) => m.chatId === 7202)).toHaveLength(0);
      deps.clock.set(at('2026-10-21', '09:00').toISOString());
      await notify.run(deps, at('2026-10-21', '09:00'));
      await notify.run(deps, at('2026-10-21', '09:05'));
      const next = tg.sent.filter((m) => m.chatId === 7202 && m.text.includes('Отчёт по кассе'));
      expect(next).toHaveLength(1);
      expect(next[0]!.text).toContain('Повтор: Каждую неделю: пн, ср');

      // Остановлена без человека (исполнитель заблокирован) — постановщику, один раз.
      await f.t.admin.db
        .update(schema.employees)
        .set({ active: false })
        .where(eq(schema.employees.id, employee('acc-a')));
      try {
        deps.clock.set(at('2026-10-22').toISOString());
        await runNight('2026-10-22');
        deps.clock.set(at('2026-10-22', '09:10').toISOString());
        tg.sent.length = 0;
        await notify.run(deps, at('2026-10-22', '09:10'));
        await notify.run(deps, at('2026-10-22', '09:15'));
        const stop = tg.sent.filter(
          (m) => m.chatId === 7204 && m.text.includes('Повтор остановлен: Отчёт по кассе'),
        );
        expect(stop).toHaveLength(1);
        expect(stop[0]!.text).toContain('Исполнитель заблокирован');
        const bell = await f.t.admin.db
          .select({ text: schema.bellNotifications.text })
          .from(schema.bellNotifications)
          .where(
            and(
              eq(schema.bellNotifications.userId, f.people['hr-a']!.userId),
              eq(schema.bellNotifications.event, 'task_series_stop'),
            ),
          );
        expect(bell.filter((r) => r.text.includes('Отчёт по кассе'))).toEqual([
          { text: 'Повтор остановлен: Отчёт по кассе. Исполнитель заблокирован' },
        ]);
        expect((await seriesRow(task.series!.id)).state).toBe('stopped');
      } finally {
        await f.t.admin.db
          .update(schema.employees)
          .set({ active: true })
          .where(eq(schema.employees.id, employee('acc-a')));
      }
    });
    it('«Сменить ответственного»: серии по контрагенту у прежнего переходят новому вместе с открытыми задачами, завершённые — нет (прототип `transferCp`)', async () => {
      const [own] = await f.t.admin.db
        .insert(schema.contractors)
        .values({
          orgId: f.a.orgId,
          name: 'ОсОО «Передача»',
          inn: '03744097401860',
          phone: '+996505890077',
          formCode: 'ФС-01',
          regimeCode: 'РЕЖ-01',
          startDate: '2026-01-15',
          responsibleEmployeeId: employee('acc-a'),
        })
        .returning({ id: schema.contractors.id });
      const moving = await create('chief-a', { title: 'Передача: идёт', contractorId: own!.id });
      const done = await create('chief-a', { title: 'Передача: завершена', contractorId: own!.id });
      await f.t.admin.db
        .update(schema.taskSeries)
        .set({ state: 'finished' })
        .where(eq(schema.taskSeries.id, done.series!.id));
      const res = await call('chief-a', 'POST', '/api/contractors/assign', {
        ids: [own!.id],
        responsibleEmployeeId: employee('chief-a'),
      });
      expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
      expect((await seriesRow(moving.series!.id)).executorEmployeeId).toBe(employee('chief-a'));
      expect((await card('chief-a', moving.id)).executor.id).toBe(employee('chief-a'));
      expect((await seriesRow(done.series!.id)).executorEmployeeId).toBe(employee('acc-a'));
    });
  },
);
