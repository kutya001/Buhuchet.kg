import { hashPassword } from '@buhuchet/adapters/password';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withUserContext } from './auth';
import { withOrgContext } from './context';
import { adminAnswerDictRequest } from './admin-dict-requests';
import { runDmAdmin, runDmOrg } from './datamart-run';
import { createDictRequest, listDictRequests } from './dict-requests';
import { createOrganization, type CreatedOrganization } from './organizations';
import {
  dictChangeRequests,
  employees,
  requestMessages,
  requestNotes,
  requestShots,
  taskSeries,
  tasks,
  users,
} from './schema';
import { createEmployee } from './staff';
import {
  createTestDatabase,
  createTestDatabaseAt,
  databaseAvailable,
  seedAccessReference,
  seedAllPlatformDictionaries,
  type TestDatabase,
} from './testing';

/*
 * Общая основа пакета 28.11.2026 (этап 0, П2; миграции 0178–0179, docs/decisions.md п. О-72):
 * повторяющиеся задачи и запросы администратору — изоляция организаций, «Заметки» только Админке,
 * ночная вставка задачи серии без пользователя, одна дата — одна задача, действия организации на
 * запросе, номер запроса, ответ Админки лентой.
 */

const permissionDenied = expect.objectContaining({
  cause: expect.objectContaining({ code: '42501' }),
});
const violates = (constraint: string) =>
  expect.objectContaining({ cause: expect.objectContaining({ constraint_name: constraint }) });

describe.skipIf(!databaseAvailable())('Пакет 28.11.2026, этап 0: основа', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let adminId: string;
  const staff = { employeeId: '', userId: '' };

  const inOrg = <T>(
    org: CreatedOrganization,
    userId: string | undefined,
    fn: Parameters<typeof withOrgContext<T>>[2],
  ) => withOrgContext(db.app.db, { orgId: org.orgId, ...(userId ? { userId } : {}) }, fn);
  const asOwner = <T>(org: CreatedOrganization, fn: Parameters<typeof withOrgContext<T>>[2]) =>
    inOrg(org, org.ownerUserId, fn);

  /** Серия организации от имени владельца (постановщик — он). */
  const newSeries = (
    org: CreatedOrganization,
    patch: Partial<typeof taskSeries.$inferInsert> = {},
  ) =>
    asOwner(org, async (tx) => {
      const [row] = await tx
        .insert(taskSeries)
        .values({
          orgId: org.orgId,
          title: 'Сверка банковской выписки',
          categoryCode: 'КАТ-001',
          executorEmployeeId: org.ownerEmployeeId,
          authorEmployeeId: org.ownerEmployeeId,
          confirm: false,
          unit: 'week',
          weekDays: [0],
          startDate: '2026-12-07',
          createdBy: org.ownerUserId,
          ...patch,
        })
        .returning({ id: taskSeries.id });
      return row!.id;
    });

  /** Задача серии так, как её ставит ночной запуск: без пользователя, постановщик — постановщик серии. */
  const seriesTask = (
    org: CreatedOrganization,
    seriesId: string,
    date: string,
    patch: Partial<typeof tasks.$inferInsert> = {},
  ) =>
    inOrg(org, undefined, (tx) =>
      tx
        .insert(tasks)
        .values({
          orgId: org.orgId,
          title: 'Сверка банковской выписки',
          categoryCode: 'КАТ-001',
          executorEmployeeId: org.ownerEmployeeId,
          authorEmployeeId: org.ownerEmployeeId,
          term: 'day',
          dueDate: date,
          confirm: false,
          seriesId,
          seriesDate: date,
          createdBy: null,
          ...patch,
        })
        .returning({ id: tasks.id }),
    );

  const newRequest = (org: CreatedOrganization, userId: string, what = 'Форма 1-ИП') =>
    inOrg(org, userId, (tx) => createDictRequest(tx, { dict: 'types', what, comment: '' }));

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAccessReference(db.admin.db);
    await seedAllPlatformDictionaries(db.admin.db);
    const passwordHash = await hashPassword('Bh-4821-temp');
    const [admin] = await db.admin.db
      .insert(users)
      .values({ login: 'p2811-admin', passwordHash, isPlatformAdmin: true })
      .returning({ id: users.id });
    adminId = admin!.id;
    a = await createOrganization(db.app.db, {
      name: 'ОсОО «Альфа»',
      inn: '01811201810456',
      slug: 'p2811-a',
      owner: { fullName: 'Асанов Асан Асанович', login: 'p2811-owner-a', passwordHash },
    });
    b = await createOrganization(db.app.db, {
      name: 'ОсОО «Бета»',
      inn: '02811201810457',
      slug: 'p2811-b',
      owner: { fullName: 'Бекова Бермет', login: 'p2811-owner-b', passwordHash },
    });
    const role = a.roles.find((r) => r.templateCode === 'acc')!;
    Object.assign(
      staff,
      await asOwner(a, async (tx) => {
        const employeeId = await createEmployee(tx, {
          fullName: 'Токтогулов Алишер Бакытович',
          shortName: 'Алишер Т.',
          login: 'p2811-acc',
          passwordHash: 'x',
          phone: null,
          role,
        });
        const [row] = await tx
          .select({ userId: employees.userId })
          .from(employees)
          .where(eq(employees.id, employeeId));
        return { employeeId, userId: row!.userId };
      }),
    );
  });

  afterAll(async () => {
    await db?.drop();
  });

  describe('повторяющиеся задачи', () => {
    it('серия чужой организации не видна, её задачи — тоже', async () => {
      const id = await newSeries(a);
      await seriesTask(a, id, '2026-12-07');
      expect(await asOwner(b, (tx) => tx.select().from(taskSeries))).toEqual([]);
      expect(
        await asOwner(b, (tx) => tx.select().from(tasks).where(eq(tasks.seriesId, id))),
      ).toEqual([]);
      expect(
        await asOwner(a, (tx) => tx.select().from(taskSeries).where(eq(taskSeries.id, id))),
      ).toHaveLength(1);
    });

    it('серию ставят только от своего имени и своим постановщиком', async () => {
      await expect(newSeries(a, { createdBy: staff.userId })).rejects.toEqual(permissionDenied);
      await expect(newSeries(a, { authorEmployeeId: staff.employeeId })).rejects.toEqual(
        permissionDenied,
      );
      // Без пользователя (ночной запуск) серию не создать.
      await expect(
        inOrg(a, undefined, (tx) =>
          tx.insert(taskSeries).values({
            orgId: a.orgId,
            title: 'Без автора',
            categoryCode: 'КАТ-001',
            executorEmployeeId: a.ownerEmployeeId,
            authorEmployeeId: a.ownerEmployeeId,
            confirm: false,
            unit: 'day',
            startDate: '2026-12-07',
          }),
        ),
      ).rejects.toEqual(permissionDenied);
    });

    it('ночная вставка без пользователя — только с действующей серией и её постановщиком', async () => {
      const id = await newSeries(a);
      expect(await seriesTask(a, id, '2026-12-14')).toHaveLength(1);
      // Без серии, с чужим постановщиком, с автором записи, с серией другой организации — нельзя.
      await expect(
        inOrg(a, undefined, (tx) =>
          tx.insert(tasks).values({
            orgId: a.orgId,
            title: 'Без серии',
            categoryCode: 'КАТ-001',
            executorEmployeeId: a.ownerEmployeeId,
            authorEmployeeId: a.ownerEmployeeId,
            dueDate: '2026-12-14',
            confirm: false,
          }),
        ),
      ).rejects.toEqual(permissionDenied);
      await expect(
        seriesTask(a, id, '2026-12-21', { authorEmployeeId: staff.employeeId }),
      ).rejects.toEqual(permissionDenied);
      await expect(seriesTask(a, id, '2026-12-21', { createdBy: a.ownerUserId })).rejects.toEqual(
        permissionDenied,
      );
      const other = await newSeries(b);
      await expect(seriesTask(a, other, '2026-12-21')).rejects.toEqual(permissionDenied);
      // Остановленная серия задач больше не ставит.
      await inOrg(a, undefined, (tx) =>
        tx
          .update(taskSeries)
          .set({ state: 'stopped', stopReason: 'executor', nextDate: null })
          .where(eq(taskSeries.id, id)),
      );
      await expect(seriesTask(a, id, '2026-12-21')).rejects.toEqual(permissionDenied);
    });

    it('одна дата серии — одна задача: и при повторе, и при одновременном запуске', async () => {
      const id = await newSeries(a);
      await seriesTask(a, id, '2026-12-07');
      await expect(seriesTask(a, id, '2026-12-07')).rejects.toEqual(
        violates('tasks_series_date_unique'),
      );
      const both = await Promise.allSettled([
        seriesTask(a, id, '2026-12-14'),
        seriesTask(a, id, '2026-12-14'),
      ]);
      expect(both.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failed = both.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(failed.reason).toEqual(violates('tasks_series_date_unique'));
      const made = await asOwner(a, (tx) =>
        tx
          .select({ n: sql<number>`count(*)::int` })
          .from(tasks)
          .where(eq(tasks.seriesId, id)),
      );
      expect(made[0]!.n).toBe(2);
    });

    it('без пользователя у серии меняются только состояние и счёт; удалить серию нельзя', async () => {
      const id = await newSeries(a);
      await inOrg(a, undefined, (tx) =>
        tx
          .update(taskSeries)
          .set({ made: 3, nextDate: '2026-12-28', updatedAt: new Date() })
          .where(eq(taskSeries.id, id)),
      );
      await expect(
        inOrg(a, undefined, (tx) =>
          tx.update(taskSeries).set({ title: 'Другое' }).where(eq(taskSeries.id, id)),
        ),
      ).rejects.toEqual(permissionDenied);
      await expect(
        inOrg(a, undefined, (tx) =>
          tx.update(taskSeries).set({ every: 2 }).where(eq(taskSeries.id, id)),
        ),
      ).rejects.toEqual(permissionDenied);
      // Сотрудник правит правило; постановщика и организацию — никто.
      await asOwner(a, (tx) =>
        tx.update(taskSeries).set({ every: 2, title: 'Сверка' }).where(eq(taskSeries.id, id)),
      );
      await expect(
        asOwner(a, (tx) =>
          tx
            .update(taskSeries)
            .set({ authorEmployeeId: staff.employeeId })
            .where(eq(taskSeries.id, id)),
        ),
      ).rejects.toEqual(permissionDenied);
      await expect(
        asOwner(a, (tx) => tx.delete(taskSeries).where(eq(taskSeries.id, id))),
      ).rejects.toEqual(permissionDenied);
    });

    it('«Эту и следующие»: задачу не привязать к серии другой организации и к серии без даты', async () => {
      const own = await newSeries(a);
      const foreign = await newSeries(b);
      const [task] = await asOwner(a, (tx) =>
        tx
          .insert(tasks)
          .values({
            orgId: a.orgId,
            title: 'Разовая',
            categoryCode: 'КАТ-001',
            executorEmployeeId: a.ownerEmployeeId,
            authorEmployeeId: a.ownerEmployeeId,
            dueDate: '2026-12-10',
            confirm: false,
            createdBy: a.ownerUserId,
          })
          .returning({ id: tasks.id }),
      );
      const link = (seriesId: string, seriesDate: string | null) =>
        asOwner(a, (tx) =>
          tx.update(tasks).set({ seriesId, seriesDate }).where(eq(tasks.id, task!.id)),
        );
      await expect(link(foreign, '2026-12-10')).rejects.toEqual(violates('tasks_series_fk'));
      await expect(link(own, null)).rejects.toEqual(violates('tasks_series_check'));
      await link(own, '2026-12-10');
    });

    it('проверки правила: интервал, дни недели, «На месяц» — последний день месяца', async () => {
      await expect(newSeries(a, { every: 100 })).rejects.toEqual(
        violates('task_series_every_check'),
      );
      await expect(newSeries(a, { weekDays: [7] })).rejects.toEqual(
        violates('task_series_week_days_check'),
      );
      await expect(
        newSeries(a, { term: 'month', unit: 'month', weekDays: null, startDate: '2026-12-15' }),
      ).rejects.toEqual(violates('task_series_month_term_check'));
      await expect(
        newSeries(a, { term: 'month', unit: 'month', weekDays: null, startDate: '2026-12-31' }),
      ).resolves.toBeTruthy();
    });
  });

  describe('запросы администратору', () => {
    it('номер ставит база по порядку, свой номер не задать', async () => {
      const first = await newRequest(a, a.ownerUserId, 'Номер 1');
      const second = await newRequest(b, b.ownerUserId, 'Номер 2');
      const rows = await db.admin.db
        .select({ id: dictChangeRequests.id, no: dictChangeRequests.no })
        .from(dictChangeRequests);
      const no = (id: string) => rows.find((r) => r.id === id)!.no;
      expect(no(first.id)).toBeGreaterThanOrEqual(1201);
      expect(no(second.id)).toBe(no(first.id) + 1);
      const [own] = await asOwner(a, (tx) =>
        tx
          .insert(dictChangeRequests)
          .values({
            orgId: a.orgId,
            no: 5000,
            dict: 'types',
            what: 'Свой номер',
            topic: 'Свой номер',
            formId: 'type',
            createdBy: a.ownerUserId,
          })
          .returning({ no: dictChangeRequests.no }),
      );
      expect(own!.no).not.toBe(5000);
    });

    it('переписка, снимки и заметки чужой организации не видны; заметки — только Админке', async () => {
      const req = await newRequest(a, a.ownerUserId, 'Изоляция');
      await inOrg(a, adminId, async (tx) => {
        await tx.insert(requestMessages).values({
          orgId: a.orgId,
          requestId: req.id,
          n: 1,
          kind: 'ask',
          byAdmin: true,
          text: 'Пришлите номер формы',
        });
        await tx.insert(requestNotes).values({
          orgId: a.orgId,
          requestId: req.id,
          text: 'Сверить с перечнем Нацстаткома',
        });
      });
      await asOwner(a, (tx) =>
        tx.insert(requestShots).values({
          orgId: a.orgId,
          requestId: req.id,
          storageKey: `org/${a.orgId}/requests/${randomUUID()}`,
          name: 'снимок.png',
          size: 1024,
          mime: 'image/png',
        }),
      );
      for (const table of [requestMessages, requestShots, requestNotes]) {
        expect(await asOwner(b, (tx) => tx.select().from(table))).toEqual([]);
      }
      expect(
        await asOwner(a, (tx) =>
          tx.select().from(requestMessages).where(eq(requestMessages.requestId, req.id)),
        ),
      ).toHaveLength(1);
      expect(
        await asOwner(a, (tx) =>
          tx.select().from(requestShots).where(eq(requestShots.requestId, req.id)),
        ),
      ).toHaveLength(1);
      // Заметку организация не видит и не пишет, даже автор запроса; администратор — видит.
      expect(await asOwner(a, (tx) => tx.select().from(requestNotes))).toEqual([]);
      await expect(
        asOwner(a, (tx) =>
          tx.insert(requestNotes).values({ orgId: a.orgId, requestId: req.id, text: 'Своя' }),
        ),
      ).rejects.toEqual(permissionDenied);
      expect(
        await inOrg(a, adminId, (tx) =>
          tx.select().from(requestNotes).where(eq(requestNotes.requestId, req.id)),
        ),
      ).toHaveLength(1);
      // Ролям «Витрины данных» заметки закрыты, снимки и переписка — только Админке, без ключа.
      const [priv] = (await db.admin.db.execute(sql`
        select has_table_privilege('buhuchet_dm_org', 'public.request_notes', 'select') as org_notes,
               has_table_privilege('buhuchet_dm_admin', 'public.request_notes', 'select') as adm_notes,
               has_table_privilege('buhuchet_dm_org', 'public.request_messages', 'select') as org_msgs,
               has_column_privilege('buhuchet_dm_admin', 'public.request_shots', 'storage_key', 'select') as adm_key,
               has_column_privilege('buhuchet_dm_admin', 'public.request_shots', 'name', 'select') as adm_name
      `)) as unknown as Record<string, boolean>[];
      expect(priv).toEqual({
        org_notes: false,
        adm_notes: false,
        org_msgs: false,
        adm_key: false,
        adm_name: true,
      });
    });

    it('сообщение — от своего имени; «от администратора» и вопрос — только администратор', async () => {
      const req = await newRequest(a, staff.userId, 'Сообщения');
      const msg = (patch: Partial<typeof requestMessages.$inferInsert>) =>
        inOrg(a, staff.userId, (tx) =>
          tx.insert(requestMessages).values({
            orgId: a.orgId,
            requestId: req.id,
            n: 1,
            kind: 'msg',
            text: 'Уточнение',
            ...patch,
          }),
        );
      await expect(msg({ byAdmin: true })).rejects.toEqual(permissionDenied);
      await expect(msg({ authorUserId: a.ownerUserId })).rejects.toEqual(permissionDenied);
      await expect(
        msg({ kind: 'st', text: '', fromStatus: 'in_work', toStatus: 'solved' }),
      ).rejects.toEqual(permissionDenied);
      await msg({});
      await expect(
        inOrg(a, staff.userId, (tx) =>
          tx
            .update(requestMessages)
            .set({ text: 'Другое' })
            .where(eq(requestMessages.requestId, req.id)),
        ),
      ).rejects.toEqual(permissionDenied);
      await expect(
        inOrg(a, staff.userId, (tx) =>
          tx.delete(requestMessages).where(eq(requestMessages.requestId, req.id)),
        ),
      ).rejects.toEqual(permissionDenied);
    });

    it('«Отозвать» — только автор и только «Новый»; статусы администратора организации не ставит', async () => {
      const req = await newRequest(a, staff.userId, 'Отозвать');
      const setStatus = (userId: string, status: 'withdrawn' | 'solved' | 'in_work') =>
        inOrg(a, userId, (tx) =>
          tx
            .update(dictChangeRequests)
            .set({ status })
            .where(eq(dictChangeRequests.id, req.id))
            .returning({ closedAt: dictChangeRequests.closedAt }),
        );
      await expect(setStatus(a.ownerUserId, 'withdrawn')).rejects.toEqual(permissionDenied);
      await expect(setStatus(staff.userId, 'solved')).rejects.toEqual(permissionDenied);
      await expect(setStatus(staff.userId, 'in_work')).rejects.toEqual(permissionDenied);
      const [done] = await setStatus(staff.userId, 'withdrawn');
      expect(done!.closedAt).not.toBeNull();
      // Отозванный не открыть ответом.
      await expect(setStatus(staff.userId, 'in_work')).rejects.toEqual(permissionDenied);
    });

    it('ответ в закрытый: «В работе» не позже 30 дней, «Ждёт ответа» организация только снимает', async () => {
      const req = await newRequest(a, staff.userId, 'Ответ в закрытый');
      await inOrg(a, adminId, (tx) =>
        tx
          .update(dictChangeRequests)
          .set({ status: 'added', closedAt: sql`now() - interval '10 days'` })
          .where(eq(dictChangeRequests.id, req.id)),
      );
      const reopen = (userId: string) =>
        inOrg(a, userId, (tx) =>
          tx
            .update(dictChangeRequests)
            .set({ status: 'in_work' })
            .where(eq(dictChangeRequests.id, req.id))
            .returning({ closedAt: dictChangeRequests.closedAt, wait: dictChangeRequests.wait }),
        );
      expect(await reopen(staff.userId)).toEqual([{ closedAt: null, wait: false }]);
      await expect(
        inOrg(a, staff.userId, (tx) =>
          tx
            .update(dictChangeRequests)
            .set({ wait: true })
            .where(eq(dictChangeRequests.id, req.id)),
        ),
      ).rejects.toEqual(permissionDenied);
      // Закрыт 40 дней назад — уже не открыть.
      await inOrg(a, adminId, (tx) =>
        tx
          .update(dictChangeRequests)
          .set({ status: 'solved', closedAt: sql`now() - interval '40 days'` })
          .where(eq(dictChangeRequests.id, req.id)),
      );
      await expect(reopen(staff.userId)).rejects.toEqual(permissionDenied);
    });

    it('вопрос и ошибку открывает ответом только автор или владелец', async () => {
      const [req] = await db.admin.db
        .insert(dictChangeRequests)
        .values({
          orgId: a.orgId,
          no: 0,
          kind: 'q',
          topic: 'Как передать контрагентов?',
          form: { text: 'Сотрудник уходит в отпуск' },
          status: 'solved',
          closedAt: new Date(),
          createdBy: a.ownerUserId,
        })
        .returning({ id: dictChangeRequests.id });
      await expect(
        inOrg(a, staff.userId, (tx) =>
          tx
            .update(dictChangeRequests)
            .set({ status: 'in_work' })
            .where(eq(dictChangeRequests.id, req!.id)),
        ),
      ).rejects.toEqual(permissionDenied);
      await asOwner(a, (tx) =>
        tx
          .update(dictChangeRequests)
          .set({ status: 'in_work' })
          .where(eq(dictChangeRequests.id, req!.id)),
      );
    });

    it('прежний список Админки «Запросы» до этапа 2 — только «Добавить в справочник» прежних статусов', async () => {
      const dict = await newRequest(a, staff.userId, 'Прежний список');
      const [typo] = await db.admin.db
        .insert(dictChangeRequests)
        .values({
          orgId: a.orgId,
          no: 0,
          kind: 'typo',
          topic: '«Отчеты для сдачи»',
          form: { was: 'Отчеты для сдачи', right: 'Отчёты для сдачи' },
          createdBy: staff.userId,
        })
        .returning({ id: dictChangeRequests.id });
      const seen = await withUserContext(db.app.db, adminId, (tx) =>
        tx.execute<{ id: string }>(sql`select id from app.admin_dict_change_requests`),
      );
      const listed = seen.map((r) => r.id);
      expect(listed).toContain(dict.id);
      expect(listed).not.toContain(typo!.id);
      const [count] = await withUserContext(db.app.db, adminId, (tx) =>
        tx.execute<{ n: number }>(sql`select app.admin_dict_requests() as n`),
      );
      expect(count!.n).toBe(listed.length);
    });

    it('«прочитано» — только автор и не дальше ленты; прочие поля организация не меняет', async () => {
      const req = await newRequest(a, staff.userId, 'Прочитано');
      await inOrg(a, adminId, (tx) =>
        tx.insert(requestMessages).values({
          orgId: a.orgId,
          requestId: req.id,
          n: 1,
          kind: 'msg',
          byAdmin: true,
          text: 'Добавим',
        }),
      );
      const read = (userId: string, n: number) =>
        inOrg(a, userId, (tx) =>
          tx
            .update(dictChangeRequests)
            .set({ readAuthor: n })
            .where(eq(dictChangeRequests.id, req.id)),
        );
      await expect(read(a.ownerUserId, 1)).rejects.toEqual(permissionDenied);
      await expect(read(staff.userId, 2)).rejects.toEqual(permissionDenied);
      await read(staff.userId, 1);
      for (const patch of [
        { topic: 'Другая тема' },
        { leadAdmin: staff.userId },
        { readAdmin: 1 },
        { answer: 'Свой ответ' },
      ]) {
        await expect(
          inOrg(a, staff.userId, (tx) =>
            tx.update(dictChangeRequests).set(patch).where(eq(dictChangeRequests.id, req.id)),
          ),
        ).rejects.toEqual(permissionDenied);
      }
    });

    it('ответ Админки на «Добавить в справочник» — сообщением и сменой статуса в ленте', async () => {
      const req = await newRequest(a, staff.userId, 'Ответ Админки');
      const answered = await withUserContext(db.app.db, adminId, (tx) =>
        adminAnswerDictRequest(tx, {
          id: req.id,
          status: 'rejected',
          answer: 'Уже есть в каталоге',
          version: 1,
        }),
      );
      expect(answered).toMatchObject({ ok: true, record: { status: 'rejected', version: 2 } });
      const feed = await asOwner(a, (tx) =>
        tx
          .select({
            n: requestMessages.n,
            kind: requestMessages.kind,
            byAdmin: requestMessages.byAdmin,
            by: requestMessages.authorUserId,
            text: requestMessages.text,
            to: requestMessages.toStatus,
          })
          .from(requestMessages)
          .where(eq(requestMessages.requestId, req.id))
          .orderBy(requestMessages.n),
      );
      expect(feed).toEqual([
        { n: 1, kind: 'msg', byAdmin: true, by: adminId, text: 'Уже есть в каталоге', to: null },
        { n: 2, kind: 'st', byAdmin: true, by: adminId, text: '', to: 'rejected' },
      ]);
      const [row] = await db.admin.db
        .select()
        .from(dictChangeRequests)
        .where(eq(dictChangeRequests.id, req.id));
      expect(row).toMatchObject({
        status: 'rejected',
        leadAdmin: adminId,
        readAdmin: 2,
        wait: false,
      });
      expect(row!.closedAt).not.toBeNull();
    });
  });

  describe('прежние «Попросить добавить» и «Мои запросы» на новой схеме', () => {
    it('новый запрос — вид «Добавить в справочник», тема, форма по справочнику', async () => {
      const typed = await inOrg(a, staff.userId, (tx) =>
        createDictRequest(tx, { dict: 'types', what: ' Форма 2-ИП ', comment: '' }),
      );
      const other = await inOrg(a, staff.userId, (tx) =>
        createDictRequest(tx, { dict: 'forms', what: 'Кооператив', comment: 'Есть два клиента' }),
      );
      const rows = await db.admin.db
        .select({
          id: dictChangeRequests.id,
          kind: dictChangeRequests.kind,
          topic: dictChangeRequests.topic,
          formId: dictChangeRequests.formId,
          form: dictChangeRequests.form,
          status: dictChangeRequests.status,
        })
        .from(dictChangeRequests)
        .where(sql`${dictChangeRequests.id} in (${typed.id}, ${other.id})`);
      const of = (id: string) => rows.find((r) => r.id === id);
      expect(of(typed.id)).toEqual({
        id: typed.id,
        kind: 'dict',
        topic: 'Форма 2-ИП',
        formId: 'type',
        form: { name: 'Форма 2-ИП' },
        status: 'new',
      });
      expect(of(other.id)).toEqual({
        id: other.id,
        kind: 'dict',
        topic: 'Кооператив',
        formId: 'other',
        form: { name: 'Кооператив', dict: 'Формы собственности', note: 'Есть два клиента' },
        status: 'new',
      });
    });

    it('прежний код без темы и формы (окно выпуска) запрос создаёт: тема и форма — из «Что добавить»', async () => {
      const [row] = await asOwner(a, (tx) =>
        tx
          .insert(dictChangeRequests)
          .values({
            orgId: a.orgId,
            no: 0,
            dict: 'regimes',
            what: ' Патент на такси ',
            comment: '',
            createdBy: a.ownerUserId,
          })
          .returning({ topic: dictChangeRequests.topic, formId: dictChangeRequests.formId }),
      );
      expect(row).toEqual({ topic: 'Патент на такси', formId: 'tax' });
    });

    it('«Мои запросы» — без вопросов, ошибок, опечаток и отозванных', async () => {
      const shown = await inOrg(a, staff.userId, (tx) =>
        createDictRequest(tx, { dict: 'types', what: 'Видно в списке', comment: '' }),
      );
      const gone = await inOrg(a, staff.userId, (tx) =>
        createDictRequest(tx, { dict: 'types', what: 'Отозван', comment: '' }),
      );
      await inOrg(a, staff.userId, (tx) =>
        tx
          .update(dictChangeRequests)
          .set({ status: 'withdrawn' })
          .where(eq(dictChangeRequests.id, gone.id)),
      );
      const [typo] = await db.admin.db
        .insert(dictChangeRequests)
        .values({
          orgId: a.orgId,
          no: 0,
          kind: 'typo',
          topic: '«Отчеты»',
          form: { was: 'Отчеты', right: 'Отчёты' },
          createdBy: staff.userId,
        })
        .returning({ id: dictChangeRequests.id });
      const listed = (await inOrg(a, staff.userId, (tx) => listDictRequests(tx))).map((r) => r.id);
      expect(listed).toContain(shown.id);
      expect(listed).not.toContain(gone.id);
      expect(listed).not.toContain(typo!.id);
    });

    it('Админка не отвечает прежним путём на отозванный запрос и запрос другого вида', async () => {
      const gone = await newRequest(a, staff.userId, 'Отозван до ответа');
      await inOrg(a, staff.userId, (tx) =>
        tx
          .update(dictChangeRequests)
          .set({ status: 'withdrawn' })
          .where(eq(dictChangeRequests.id, gone.id)),
      );
      const [q] = await db.admin.db
        .insert(dictChangeRequests)
        .values({
          orgId: a.orgId,
          no: 0,
          kind: 'q',
          topic: 'Как выгрузить отчёты?',
          form: { text: 'Нужна выгрузка' },
          createdBy: staff.userId,
        })
        .returning({ id: dictChangeRequests.id, version: dictChangeRequests.version });
      for (const [id, version] of [
        [gone.id, 2],
        [q!.id, q!.version],
      ] as const) {
        const answered = await withUserContext(db.app.db, adminId, (tx) =>
          adminAnswerDictRequest(tx, { id, status: 'added', answer: 'Добавили', version }),
        );
        expect(answered.ok).toBe(false);
        const [direct] = await withUserContext(db.app.db, adminId, (tx) =>
          tx.execute<{ v: number | null }>(
            sql`select app.admin_answer_dict_request(${id}, 'added', 'Добавили', ${version}) as v`,
          ),
        );
        expect(direct!.v).toBeNull();
        const feed = await db.admin.db
          .select({ n: requestMessages.n })
          .from(requestMessages)
          .where(and(eq(requestMessages.requestId, id), eq(requestMessages.byAdmin, true)));
        expect(feed).toEqual([]);
      }
      const after = await db.admin.db
        .select({ status: dictChangeRequests.status })
        .from(dictChangeRequests)
        .where(sql`${dictChangeRequests.id} in (${gone.id}, ${q!.id})`);
      expect(after.map((r) => r.status).sort()).toEqual(['new', 'withdrawn']);
    });
  });

  describe('вторая преграда базы', () => {
    it('чужая организация не создаёт серию, сообщение и снимок у себя от чужого имени и не меняет чужие', async () => {
      const seriesId = await newSeries(a);
      const req = await newRequest(a, a.ownerUserId, 'Чужая организация');
      // Строки с org_id другой организации — отказ политики изоляции.
      await expect(
        asOwner(b, (tx) =>
          tx.insert(taskSeries).values({
            orgId: a.orgId,
            title: 'Чужая серия',
            categoryCode: 'КАТ-001',
            executorEmployeeId: a.ownerEmployeeId,
            authorEmployeeId: a.ownerEmployeeId,
            confirm: false,
            unit: 'day',
            startDate: '2026-12-07',
            createdBy: b.ownerUserId,
          }),
        ),
      ).rejects.toEqual(permissionDenied);
      await expect(
        asOwner(b, (tx) =>
          tx.insert(requestMessages).values({
            orgId: a.orgId,
            requestId: req.id,
            n: 1,
            kind: 'msg',
            authorUserId: b.ownerUserId,
            text: 'Чужое',
          }),
        ),
      ).rejects.toEqual(permissionDenied);
      // Свой org_id, но запрос другой организации — составной ключ не пускает.
      await expect(
        asOwner(b, (tx) =>
          tx.insert(requestMessages).values({
            orgId: b.orgId,
            requestId: req.id,
            n: 1,
            kind: 'msg',
            authorUserId: b.ownerUserId,
            text: 'Чужое',
          }),
        ),
      ).rejects.toEqual(permissionDenied);
      await expect(
        asOwner(b, (tx) =>
          tx.insert(requestShots).values({
            orgId: b.orgId,
            requestId: req.id,
            storageKey: `org/${b.orgId}/requests/${randomUUID()}`,
            name: 'снимок.png',
            size: 1024,
            mime: 'image/png',
            createdBy: b.ownerUserId,
          }),
        ),
      ).rejects.toEqual(violates('request_shots_request_fk'));
      // Изменить серию и запрос другой организации нельзя: строк не находится.
      expect(
        await asOwner(b, (tx) =>
          tx
            .update(taskSeries)
            .set({ title: 'Чужая правка' })
            .where(eq(taskSeries.id, seriesId))
            .returning({ id: taskSeries.id }),
        ),
      ).toEqual([]);
      expect(
        await asOwner(b, (tx) =>
          tx
            .update(dictChangeRequests)
            .set({ status: 'withdrawn' })
            .where(eq(dictChangeRequests.id, req.id))
            .returning({ id: dictChangeRequests.id }),
        ),
      ).toEqual([]);
    });

    it('ночная задача — с исполнителем серии и не раньше её начала', async () => {
      const id = await newSeries(a);
      await expect(
        seriesTask(a, id, '2026-12-14', { executorEmployeeId: staff.employeeId }),
      ).rejects.toEqual(permissionDenied);
      await expect(seriesTask(a, id, '2026-11-30')).rejects.toEqual(permissionDenied);
      expect(await seriesTask(a, id, '2026-12-14')).toHaveLength(1);
    });

    it('номер сообщения ставит база: следующий после последнего, свой не задать', async () => {
      const req = await newRequest(a, staff.userId, 'Номер сообщения');
      const put = (n: number) =>
        inOrg(a, staff.userId, (tx) =>
          tx
            .insert(requestMessages)
            .values({ orgId: a.orgId, requestId: req.id, n, kind: 'msg', text: `Сообщение ${n}` })
            .returning({ n: requestMessages.n }),
        );
      expect(await put(2147483647)).toEqual([{ n: 1 }]);
      expect(await put(1)).toEqual([{ n: 2 }]);
    });

    it('смену статуса в ленту организация пишет только о настоящей смене', async () => {
      const req = await newRequest(a, staff.userId, 'Ложная история');
      const st = () =>
        inOrg(a, staff.userId, (tx) =>
          tx.insert(requestMessages).values({
            orgId: a.orgId,
            requestId: req.id,
            n: 1,
            kind: 'st',
            text: '',
            fromStatus: 'new',
            toStatus: 'withdrawn',
          }),
        );
      await expect(st()).rejects.toEqual(permissionDenied);
      await inOrg(a, staff.userId, (tx) =>
        tx
          .update(dictChangeRequests)
          .set({ status: 'withdrawn' })
          .where(eq(dictChangeRequests.id, req.id)),
      );
      await st();
    });

    it('время последнего движения при отправке не в будущем', async () => {
      await expect(
        asOwner(a, (tx) =>
          tx.insert(dictChangeRequests).values({
            orgId: a.orgId,
            no: 0,
            dict: 'types',
            what: 'Наверх очереди',
            topic: 'Наверх очереди',
            formId: 'type',
            lastAt: new Date(Date.now() + 365 * 24 * 3600 * 1000),
            createdBy: a.ownerUserId,
          }),
        ),
      ).rejects.toEqual(permissionDenied);
    });

    it('снимок — под ключом своей организации и к сообщению того же запроса', async () => {
      const one = await newRequest(a, staff.userId, 'Снимок 1');
      const two = await newRequest(a, staff.userId, 'Снимок 2');
      const [msg] = await inOrg(a, staff.userId, (tx) =>
        tx
          .insert(requestMessages)
          .values({ orgId: a.orgId, requestId: one.id, n: 1, kind: 'msg', text: 'Со снимком' })
          .returning({ id: requestMessages.id }),
      );
      const shot = (requestId: string, storageKey: string) =>
        inOrg(a, staff.userId, (tx) =>
          tx.insert(requestShots).values({
            orgId: a.orgId,
            requestId,
            messageId: msg!.id,
            storageKey,
            name: 'снимок.png',
            size: 1024,
            mime: 'image/png',
            createdBy: staff.userId,
          }),
        );
      await expect(shot(one.id, `org/${b.orgId}/requests/${randomUUID()}`)).rejects.toEqual(
        permissionDenied,
      );
      await expect(shot(two.id, `org/${a.orgId}/requests/${randomUUID()}`)).rejects.toEqual(
        permissionDenied,
      );
      await shot(one.id, `org/${a.orgId}/requests/${randomUUID()}`);
    });

    it('роль Витрины организации видит только «Добавить в справочник», Админки — все запросы', async () => {
      const dict = await newRequest(a, staff.userId, 'Видно Витрине');
      const [q] = await db.admin.db
        .insert(dictChangeRequests)
        .values({
          orgId: a.orgId,
          no: 0,
          kind: 'q',
          topic: 'Личный вопрос сотрудника',
          form: { text: 'Только автору и владельцу' },
          createdBy: staff.userId,
        })
        .returning({ id: dictChangeRequests.id });
      const ids = (r: { columns: string[]; rows: unknown[][] }) =>
        r.rows.map((v) => v[r.columns.indexOf('id')]);
      const query = { text: 'SELECT id FROM dict_change_requests', params: [], maxRows: 1000 };
      const org = ids(await runDmOrg(db.app.db, { orgId: a.orgId, userId: a.ownerUserId }, query));
      expect(org).toContain(dict.id);
      expect(org).not.toContain(q!.id);
      const admin = ids(await runDmAdmin(db.app.db, adminId, query));
      expect(admin).toEqual(expect.arrayContaining([dict.id, q!.id]));
      const [seq] = (await db.admin.db.execute(sql`
        select has_sequence_privilege('buhuchet_app', 'public.request_no_seq', 'usage') as usage
      `)) as unknown as { usage: boolean }[];
      expect(seq!.usage).toBe(false);
    });
  });
});

describe.skipIf(!databaseAvailable())('Перенос прежних запросов (миграция 0178)', () => {
  let db: Awaited<ReturnType<typeof createTestDatabaseAt>>;
  const org = randomUUID();
  const other = randomUUID();
  const ids = {
    added: randomUUID(),
    rejected: randomUUID(),
    fresh: randomUUID(),
    noAuthor: randomUUID(),
  };
  let userId = '';
  let adminId = '';
  const exec = <T>(q: ReturnType<typeof sql>) => db.admin.db.execute(q) as unknown as Promise<T[]>;

  beforeAll(async () => {
    db = await createTestDatabaseAt('0177_dm_console');
    await exec(sql`
      insert into organizations (id, name, slug, inn, status) values
        (${org}::uuid, 'Фирма А', 'rq-a', '01811201810451', 'active'),
        (${other}::uuid, 'Фирма Б', 'rq-b', '01811201810452', 'active')`);
    const [u] = await exec<{ id: string }>(sql`
      insert into users (org_id, login, password_hash) values (${org}::uuid, 'rq-owner', 'x')
      returning id`);
    const [adm] = await exec<{ id: string }>(sql`
      insert into users (login, password_hash, is_platform_admin) values ('rq-admin', 'x', true)
      returning id`);
    userId = u!.id;
    adminId = adm!.id;
    // Прежние статусы: «Новый», «Добавлено» с ответом, «Отклонено» с ответом, ответ без автора (демо).
    await exec(sql`
      insert into dict_change_requests
        (id, org_id, dict, what, comment, status, answer, created_by, decided_by, decided_at, created_at, updated_at)
      values
        (${ids.added}::uuid, ${org}::uuid, 'banks', 'Элдик Банк', '', 'added', 'Добавили', ${userId}::uuid,
          ${adminId}::uuid, '2026-10-15 03:12+00', '2026-10-14 10:40+00', '2026-10-15 03:12+00'),
        (${ids.rejected}::uuid, ${org}::uuid, 'forms', 'ОсОО-П', 'Нужна для ИП', 'rejected', 'Уже есть', ${userId}::uuid,
          ${adminId}::uuid, '2026-10-07 04:20+00', '2026-10-06 05:05+00', '2026-10-07 04:20+00'),
        (${ids.fresh}::uuid, ${org}::uuid, 'cats', 'Сверка с Соцфондом', '', 'new', '', ${userId}::uuid,
          null, null, '2026-10-24 06:30+00', '2026-10-24 06:30+00'),
        (${ids.noAuthor}::uuid, ${org}::uuid, 'types', 'Форма 1-ИП', '', 'rejected', 'В каталоге уже есть', ${userId}::uuid,
          null, '2026-10-07 04:20+00', '2026-10-05 05:05+00', '2026-10-07 04:20+00')`);
    await db.migrateRest();
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('номер по дате отправки, вид «Добавить в справочник», тема и форма из прежних полей', async () => {
    const rows = await db.admin.db.select().from(dictChangeRequests).orderBy(dictChangeRequests.no);
    expect(rows.map((r) => [r.no, r.id])).toEqual([
      [1201, ids.noAuthor],
      [1202, ids.rejected],
      [1203, ids.added],
      [1204, ids.fresh],
    ]);
    const by = (id: string) => rows.find((r) => r.id === id)!;
    expect(by(ids.rejected)).toMatchObject({
      kind: 'dict',
      topic: 'ОсОО-П',
      formId: 'other',
      form: { name: 'ОсОО-П', note: 'Нужна для ИП', dict: 'Формы собственности' },
      status: 'rejected',
      leadAdmin: adminId,
      wait: false,
    });
    expect(by(ids.added)).toMatchObject({ formId: 'bank', form: { name: 'Элдик Банк' } });
    expect(by(ids.added).closedAt).toEqual(new Date('2026-10-15T03:12:00Z'));
    expect(by(ids.fresh)).toMatchObject({ status: 'new', closedAt: null, readAuthor: 0 });
    // Следующий запрос получает номер после перенесённых.
    const [next] = await exec<{ no: number }>(sql`
      insert into dict_change_requests (org_id, dict, what, topic, form_id, created_by)
      values (${other}::uuid, 'types', 'Новый', 'Новый', 'type', ${userId}::uuid) returning no`);
    expect(next!.no).toBe(1205);
  });

  it('ответ — первым сообщением администратора, решение — сменой статуса; прочитано обоими', async () => {
    const feed = await db.admin.db
      .select()
      .from(requestMessages)
      .orderBy(requestMessages.requestId, requestMessages.n);
    const of = (id: string) =>
      feed
        .filter((m) => m.requestId === id)
        .map((m) => [m.n, m.kind, m.byAdmin, m.authorUserId, m.text, m.fromStatus, m.toStatus]);
    expect(of(ids.added)).toEqual([
      [1, 'msg', true, adminId, 'Добавили', null, null],
      [2, 'st', true, adminId, '', 'new', 'added'],
    ]);
    expect(of(ids.noAuthor)).toEqual([
      [1, 'msg', true, null, 'В каталоге уже есть', null, null],
      [2, 'st', true, null, '', 'new', 'rejected'],
    ]);
    expect(of(ids.fresh)).toEqual([]);
    const [row] = await db.admin.db
      .select({ a: dictChangeRequests.readAuthor, m: dictChangeRequests.readAdmin })
      .from(dictChangeRequests)
      .where(and(eq(dictChangeRequests.id, ids.added)));
    expect(row).toEqual({ a: 2, m: 2 });
  });
});
