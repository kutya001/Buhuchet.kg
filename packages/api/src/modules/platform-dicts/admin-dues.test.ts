import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { ioTsv } from '@buhuchet/domain';
import {
  AdminCalendarChanged,
  AdminCalendarCopyPlan,
  AdminCalendarList,
  AdminDictHistory,
  AdminDictImportApplied,
  AdminDictImportPreview,
  AdminDictIoFile,
  AdminDictLoad,
  AdminDictValue,
  AdminDuesPreview,
} from '@buhuchet/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_ORIGIN, TEST_PASSWORD } from '../../testing';
import { DUES_PREVIEW_RATE_LIMIT, duesRecalcJob } from './admin-dues';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

/**
 * Пример переноса вкладки «Календарь» по каталогу на 18.10.2026: срок вида 18-го числа после квартала
 * выпадает на воскресенье и переносится на понедельник.
 */
const EXAMPLE = { type: '65-автом', period: 'III кв. 2026', from: '2026-10-18', to: '2026-10-19' };

const {
  auditLog,
  contractorBenefits,
  contractors,
  duesRecalcs,
  platformAuditLog,
  productionCalendar,
  rateLimits,
  reports,
  reportTypes,
  users,
} = schema;

// Сегодня в тестах — 18.10.2026 (`createTestDeps`). НДС за октябрь — до 25.11.2026 (среда).
describe.skipIf(!databaseAvailable())(
  'Админка: сроки несданных отчётов после правки каталога (задача 2.37)',
  () => {
    let f: Fixture;
    let admin: string;
    let owner: string;
    let cpA = '';
    let cpManual = '';
    let cpBig = '';
    let cpB = '';

    const P = '/api/admin/platform-dicts';
    const IO = '/api/admin/platform-dicts-io';
    type Method = Parameters<typeof apiRequest>[1];
    const send = (method: Method, path: string, body?: unknown, cookie = admin) =>
      apiRequest(f.app, method, path, cookie, body);
    const dues = async (path: string, body?: unknown, cookie = admin) => {
      const res = await send('POST', path, body, cookie);
      expect(res.status, await res.clone().text()).toBe(200);
      return AdminDuesPreview.parse(await res.json());
    };
    const value = async (path: string) =>
      AdminDictValue.parse(await (await send('GET', path)).json());
    /** Тело «Сохранить» из значения: поля значения и версия. */
    const bodyOf = (x: AdminDictValue, patch: Record<string, unknown> = {}) => ({
      name: x.name,
      ...x.data,
      ...patch,
      version: x.version,
    });
    const upload = (path: string, text: string) =>
      f.app.request(path, {
        method: 'POST',
        headers: {
          origin: TEST_ORIGIN,
          cookie: admin,
          'content-type': 'text/plain; charset=utf-8',
        },
        body: text,
      });
    /** Сроки октябрьского НДС контрагентов: [срок сдачи, срок оплаты, ручной]. */
    const october = async (...ids: string[]) =>
      (
        await f.t.admin.db
          .select({
            cp: reports.contractorId,
            due: reports.dueDate,
            pay: reports.payDue,
            manual: reports.dueManual,
          })
          .from(reports)
          .where(and(inArray(reports.contractorId, ids), eq(reports.periodStart, '2026-10-01')))
      )
        .map((r) => [ids.indexOf(r.cp), r.due, r.pay, r.manual] as const)
        .sort((x, y) => x[0] - y[0]);

    beforeAll(async () => {
      f = await createStaffFixture();
      await seedAllPlatformDictionaries(f.t.admin.db);
      [admin, owner] = await Promise.all([
        signIn(f.app, 'platform-admin', TEST_PASSWORD),
        signIn(f.app, 'owner-a', TEST_PASSWORD),
      ]);
      const contractor = async (orgId: string, name: string, inn: string) => {
        const [row] = await f.t.admin.db
          .insert(contractors)
          .values({
            orgId,
            name,
            inn,
            phone: '+996505890076',
            formCode: 'ФС-01',
            regimeCode: 'РЕЖ-01',
            startDate: '2026-01-15',
          })
          .returning({ id: contractors.id });
        return row!.id;
      };
      cpA = await contractor(f.a.orgId, 'ОсОО «Ала-Тоо»', '01111111111111');
      cpManual = await contractor(f.a.orgId, 'ИП Садыков', '21111111111112');
      cpBig = await contractor(f.a.orgId, 'ОАО «Крупный»', '01111111111113');
      cpB = await contractor(f.b.orgId, 'ОсОО «Бета»', '02222222222221');
      // «Крупный налогоплательщик»: НДС сдаётся до последнего дня, уплата — до 25-го (ст. 319).
      await f.t.admin.db
        .insert(contractorBenefits)
        .values({ orgId: f.a.orgId, contractorId: cpBig, benefitCode: 'ЛЬГ-30' });
      const report = (orgId: string, contractorId: string, due: string, manual = false) => ({
        orgId,
        contractorId,
        reportTypeCode: 'nds',
        period: 'M' as const,
        periodStart: '2026-10-01',
        act: 'both' as const,
        dueBase: due,
        dueDate: manual ? '2026-11-27' : due,
        dueManual: manual,
        payDue: manual ? '2026-11-27' : '2026-11-25',
      });
      await f.t.admin.db
        .insert(reports)
        .values([
          report(f.a.orgId, cpA, '2026-11-25'),
          report(f.a.orgId, cpManual, '2026-11-25', true),
          report(f.a.orgId, cpBig, '2026-11-30'),
          report(f.b.orgId, cpB, '2026-11-25'),
        ]);
    });

    afterAll(async () => {
      await f?.t.drop();
    });

    it('предпросмотр — только администратору платформы', async () => {
      const nds = await value(`${P}/types/nds`);
      const calls: [string, unknown][] = [
        [`${P}/types/nds/dues-preview`, bodyOf(nds, { dueDay: 20 })],
        [`${P}/calendar/dues-preview`, { date: '2026-11-25', type: 'off', name: 'Перенос' }],
        [`${P}/calendar/03-08/dues-preview?version=1`, undefined],
        [`${P}/calendar/copy/dues-preview`, undefined],
        [`/api/admin/platform-dict-loads/${crypto.randomUUID()}/dues-preview`, undefined],
      ];
      for (const [path, body] of calls) {
        expect((await send('POST', path, body, owner)).status, path).toBe(403);
        expect((await send('POST', path, body, '')).status, path).toBe(401);
      }
    });

    it('(проверка задачи #93) правка календаря в предпросмотре и после применения меняет сроки несданных отчётов в двух организациях одинаково, а срок, изменённый вручную, не меняется', async () => {
      const ids = [cpA, cpManual, cpBig, cpB];
      const before = await october(...ids);
      const holiday = { date: '2026-11-25', type: 'off', name: 'Перенос рабочего дня' };
      // А: обычный и «Крупный» (уплата 25.11), Б: один; ручной срок не считается.
      expect(await dues(`${P}/calendar/dues-preview`, holiday)).toEqual({ reports: 3, orgs: 2 });
      expect(await october(...ids)).toEqual(before);
      // Предпросмотр дня с ошибкой (дата не в годах вкладки) — нули, без отказа.
      expect(await dues(`${P}/calendar/dues-preview`, { ...holiday, date: '2025-11-25' })).toEqual({
        reports: 0,
        orgs: 0,
      });

      const res = await send('POST', `${P}/calendar`, holiday);
      expect(res.status, await res.clone().text()).toBe(201);
      expect(AdminCalendarChanged.parse(await res.json())).toEqual({
        recalculated: 3,
        pending: false,
      });
      expect(await october(...ids)).toEqual([
        [0, '2026-11-26', '2026-11-26', false],
        [1, '2026-11-27', '2026-11-27', true],
        [2, '2026-11-30', '2026-11-26', false],
        [3, '2026-11-26', '2026-11-26', false],
      ]);
      // Пересчёт прошёл сразу после сохранения: строка очереди выполнена.
      const [task] = await f.t.admin.db
        .select()
        .from(duesRecalcs)
        .where(eq(duesRecalcs.kind, 'calendar'));
      expect(task).toMatchObject({ reports: 3, orgs: 2, attempts: 1, lastError: null });
      expect(task!.doneAt).not.toBeNull();

      // В истории отчёта организации — было → стало с причиной.
      const [entry] = await f.t.admin.db
        .select({ reason: auditLog.reason, changes: auditLog.changes, orgId: auditLog.orgId })
        .from(auditLog)
        .innerJoin(reports, eq(sql`${reports.id}::text`, auditLog.entityId))
        .where(and(eq(auditLog.entity, 'report'), eq(reports.contractorId, cpB)));
      expect(entry).toEqual({
        reason: 'Изменён производственный календарь',
        orgId: f.b.orgId,
        changes: [
          { field: 'dueDate', from: '2026-11-25', to: '2026-11-26' },
          { field: 'payDue', from: '2026-11-25', to: '2026-11-26' },
        ],
      });

      // Удаление дня: предпросмотр и пересчёт обратно.
      const [day] = await f.t.admin.db
        .select({ version: productionCalendar.version })
        .from(productionCalendar)
        .where(eq(productionCalendar.day, '2026-11-25'));
      const del = `${P}/calendar/2026-11-25`;
      expect(await dues(`${del}/dues-preview?version=${day!.version}`)).toEqual({
        reports: 3,
        orgs: 2,
      });
      // Устаревшая версия — удалить нельзя, нули.
      expect(await dues(`${del}/dues-preview?version=${day!.version + 1}`)).toEqual({
        reports: 0,
        orgs: 0,
      });
      expect((await send('DELETE', `${del}?version=${day!.version}`)).status).toBe(204);
      expect(await october(...ids)).toEqual(before);

      // «Календарь на следующий год копированием»: сроки отчётов этого года не меняются.
      const plan = AdminCalendarCopyPlan.parse(
        await (await send('GET', `${P}/calendar/copy`)).json(),
      );
      expect(plan.items.length).toBeGreaterThan(0);
      expect(await dues(`${P}/calendar/copy/dues-preview`)).toEqual({ reports: 0, orgs: 0 });
      expect(
        AdminCalendarCopyPlan.parse(await (await send('GET', `${P}/calendar/copy`)).json()),
      ).toEqual(plan);
    });

    it('пример переноса на вкладке «Календарь» — из каталога: ближайший срок, перенесённый с нерабочего дня', async () => {
      const list = AdminCalendarList.parse(await (await send('GET', `${P}/calendar`)).json());
      expect(list.example).toEqual(EXAMPLE);
    });

    it('неверные параметры предпросмотра — 400; предпросмотр не пишет историю и не меняет версию', async () => {
      for (const path of [
        `${P}/calendar/xx/dues-preview?version=1`,
        `${P}/calendar/2026-11-25/dues-preview`,
        `/api/admin/platform-dict-loads/not-a-uuid/dues-preview`,
        `${P}/unknown/nds/dues-preview`,
      ]) {
        expect((await send('POST', path, {})).status, path).toBe(400);
      }
      expect((await send('POST', `${P}/calendar/dues-preview`, { date: 1 })).status).toBe(400);

      const path = `${P}/benefits/${encodeURIComponent('ЛЬГ-30')}`;
      const raw = await value(path);
      const big = { ...raw, data: { ...raw.data, validUntil: raw.data.validUntil ?? '' } };
      const audit = async () =>
        (await f.t.admin.db.select({ id: platformAuditLog.id }).from(platformAuditLog)).length;
      const written = await audit();
      expect(await dues(`${path}/dues-preview`, bodyOf(big, { dueRules: [] }))).toEqual({
        reports: 1,
        orgs: 1,
      });
      expect(await audit()).toBe(written);
      expect((await value(path)).version).toBe(raw.version);
      expect((await october(cpBig))[0]).toEqual([0, '2026-11-30', '2026-11-25', false]);
    });

    it('вид отчёта: предпросмотр правки правила срока и пересчёт после «Сохранить»; отчёты вида в окне', async () => {
      const nds = await value(`${P}/types/nds`);
      expect(nds.reports).toEqual({ total: 4, open: 4, orgs: 2 });
      // Без правки правила — нули; срок 20-го — у трёх отчётов (у «Крупного» — по статусу).
      expect(await dues(`${P}/types/nds/dues-preview`, bodyOf(nds))).toEqual({
        reports: 0,
        orgs: 0,
      });
      expect(await dues(`${P}/types/nds/dues-preview`, bodyOf(nds, { dueDay: 20 }))).toEqual({
        reports: 2,
        orgs: 2,
      });
      // Срок оплаты тоже пересчитывается (docs/deviations.md п. Д-17); у «Крупного» он по статусу.
      expect(await dues(`${P}/types/nds/dues-preview`, bodyOf(nds, { payDay: 28 }))).toEqual({
        reports: 2,
        orgs: 2,
      });
      // Правка с ошибкой (нет краткого названия) — нули.
      expect(
        await dues(`${P}/types/nds/dues-preview`, bodyOf(nds, { dueDay: 20, shortName: ' ' })),
      ).toEqual({ reports: 0, orgs: 0 });
      expect((await value(`${P}/types/nds`)).version).toBe(nds.version);

      const saved = await send('PUT', `${P}/types/nds`, bodyOf(nds, { dueDay: 20 }));
      expect(saved.status, await saved.clone().text()).toBe(200);
      expect(await october(cpA, cpManual, cpBig, cpB)).toEqual([
        [0, '2026-11-20', '2026-11-25', false],
        [1, '2026-11-27', '2026-11-27', true],
        [2, '2026-11-30', '2026-11-25', false],
        [3, '2026-11-20', '2026-11-25', false],
      ]);
      const back = await value(`${P}/types/nds`);
      expect((await send('PUT', `${P}/types/nds`, bodyOf(back, { dueDay: 25 }))).status).toBe(200);
      expect((await october(cpA))[0]).toEqual([0, '2026-11-25', '2026-11-25', false]);
    });

    it('статус: «Меняет сроки» — предпросмотр, пересчёт и в истории «сроки по статусу пересчитаны у N отчётов»', async () => {
      const raw = await value(`${P}/benefits/${encodeURIComponent('ЛЬГ-30')}`);
      // В окне статуса «Действует до» без даты — пустая строка.
      const big = { ...raw, data: { ...raw.data, validUntil: raw.data.validUntil ?? '' } };
      const path = `${P}/benefits/${encodeURIComponent('ЛЬГ-30')}`;
      expect(await dues(`${path}/dues-preview`, bodyOf(big, { dueRules: [] }))).toEqual({
        reports: 1,
        orgs: 1,
      });
      const res = await send('PUT', path, bodyOf(big, { dueRules: [] }));
      expect(res.status, await res.clone().text()).toBe(200);
      expect((await october(cpBig))[0]).toEqual([0, '2026-11-25', '2026-11-25', false]);
      const history = AdminDictHistory.parse(
        await (await send('GET', `${P}/benefits/history`)).json(),
      );
      expect(history.items[0]!.changes).toContainEqual({ field: 'recalculated', to: 1 });

      // Отключённый статус сроков не даёт, включённый — снова даёт.
      const now = { ...(await value(path)), data: { ...big.data } };
      now.version = (await value(path)).version;
      expect((await send('PUT', path, bodyOf(now, { dueRules: big.data.dueRules }))).status).toBe(
        200,
      );
      expect((await october(cpBig))[0]).toEqual([0, '2026-11-30', '2026-11-25', false]);
      const on = await value(path);
      const off = await send('POST', `${path}/active`, { active: false, version: on.version });
      expect(off.status).toBe(200);
      expect((await october(cpBig))[0]).toEqual([0, '2026-11-25', '2026-11-25', false]);
      const offValue = await value(path);
      await send('POST', `${path}/active`, { active: true, version: offValue.version });
      expect((await october(cpBig))[0]).toEqual([0, '2026-11-30', '2026-11-25', false]);
    });

    it('загрузка из Excel: в сравнении — сколько сроков изменится и «Что нужно сделать»; после применения и отката — пересчёт', async () => {
      const data = AdminDictIoFile.parse(await (await send('GET', `${IO}/types`)).json());
      const rows = data.rows.map((r) => [...r]);
      const nds = rows.find((r) => r[0] === 'nds')!;
      nds[data.header.indexOf('Срок: число')] = '20';
      nds[data.header.indexOf('Что нужно сделать')] = 'Сдача';
      const text = ioTsv([data.header, ...rows]);
      const res = await upload(`${IO}/types/preview`, text);
      expect(res.status, await res.clone().text()).toBe(200);
      const preview = AdminDictImportPreview.parse(await res.json());
      expect(preview.change.map((x) => x.code)).toEqual(['nds']);
      expect(preview.dues).toEqual({ reports: 2, orgs: 2 });
      expect(preview.act).toEqual({ types: 1, reports: 4 });

      const applied = await upload(`${IO}/types/apply?stamp=${preview.stamp}`, text);
      expect(applied.status, await applied.clone().text()).toBe(200);
      const { load, preview: done, pending } = AdminDictImportApplied.parse(await applied.json());
      expect([done.dues, pending]).toEqual([{ reports: 2, orgs: 2 }, false]);
      // Отчёт сохраняет «Сдача + уплата»; своего срока оплаты у вида больше нет — он равен сроку сдачи.
      expect((await october(cpA))[0]).toEqual([0, '2026-11-20', '2026-11-20', false]);

      // Вопрос «Откатить последнюю загрузку?» — сколько сроков изменится; загрузка остаётся.
      expect(await dues(`/api/admin/platform-dict-loads/${load.id}/dues-preview`)).toEqual({
        reports: 2,
        orgs: 2,
      });
      const rolled = await apiRequest(
        f.app,
        'POST',
        `/api/admin/platform-dict-loads/${load.id}/rollback`,
        admin,
      );
      expect(rolled.status, await rolled.clone().text()).toBe(200);
      expect(AdminDictLoad.parse(await rolled.json()).rolledBackAt).not.toBeNull();
      expect((await october(cpA, cpB)).map((r) => r[1])).toEqual(['2026-11-25', '2026-11-25']);
      // Откаченную — откатить нельзя: нули.
      expect(await dues(`/api/admin/platform-dict-loads/${load.id}/dues-preview`)).toEqual({
        reports: 0,
        orgs: 0,
      });
    });

    it('предпросмотров у администратора — не больше предела за час: дальше 429', async () => {
      const [me] = await f.t.admin.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.login, 'platform-admin'));
      await f.t.admin.db.insert(rateLimits).values(
        Array.from({ length: DUES_PREVIEW_RATE_LIMIT.max }, () => ({
          kind: DUES_PREVIEW_RATE_LIMIT.kind,
          subject: me!.id,
        })),
      );
      try {
        const res = await send('POST', `${P}/calendar/copy/dues-preview`);
        expect(res.status).toBe(429);
        expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
          'dues_preview_limit',
        );
      } finally {
        await f.t.admin.db.delete(rateLimits).where(eq(rateLimits.subject, me!.id));
      }
    });

    it('пересчёт, который не прошёл сразу после сохранения, догоняет задача по расписанию', async () => {
      // Правило вида изменено, а строка очереди осталась невыполненной (функцию оборвали).
      await f.t.admin.db.update(reportTypes).set({ dueDay: 20 }).where(eq(reportTypes.code, 'nds'));
      try {
        const [row] = await f.t.admin.db
          .insert(duesRecalcs)
          .values({
            kind: 'types',
            codes: ['nds'],
            createdAt: sql`now() - interval '10 minutes'`,
            attempts: 1,
            claimedUntil: sql`now() - interval '1 minute'`,
          })
          .returning({ id: duesRecalcs.id });
        await duesRecalcJob.run(f.deps, new Date());
        expect((await october(cpA, cpB)).map((r) => r[1])).toEqual(['2026-11-20', '2026-11-20']);
        const [done] = await f.t.admin.db
          .select()
          .from(duesRecalcs)
          .where(eq(duesRecalcs.id, row!.id));
        expect(done).toMatchObject({ attempts: 2, reports: 2, orgs: 2, lastError: null });
        expect(done!.doneAt).not.toBeNull();
        // Повтор задачи ничего не делает: строка выполнена.
        await duesRecalcJob.run(f.deps, new Date());
        expect(
          (await f.t.admin.db.select().from(duesRecalcs).where(eq(duesRecalcs.id, row!.id)))[0]!
            .attempts,
        ).toBe(2);
      } finally {
        await f.t.admin.db
          .update(reportTypes)
          .set({ dueDay: 25 })
          .where(eq(reportTypes.code, 'nds'));
        await f.t.admin.db.insert(duesRecalcs).values({
          kind: 'types',
          codes: ['nds'],
          createdAt: sql`now() - interval '10 minutes'`,
        });
        await duesRecalcJob.run(f.deps, new Date());
      }
      expect((await october(cpA, cpB)).map((r) => r[1])).toEqual(['2026-11-25', '2026-11-25']);
    });
  },
);
