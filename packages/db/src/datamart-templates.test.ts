import { randomUUID } from 'node:crypto';
import {
  bishkekDate,
  dmBind,
  formatText,
  periodLabel,
  revenueRows,
  UI_TEXTS,
  type IsoDate,
  type ReportPeriod,
  type Translate,
} from '@buhuchet/domain';
import { and, asc, between, eq, isNull, ne, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext } from './context';
import { runDmAdmin, runDmOrg, type DmResult } from './datamart-run';
import { feeLedgers } from './fees';
import { revenueSource } from './home';
import { createOrganization, type CreatedOrganization } from './organizations';
import {
  contractorSentFiles,
  contractorTariffs,
  contractors,
  dmTemplateSql,
  dmTemplates,
  employees,
  feeAllocations,
  feePayments,
  files,
  indicators,
  indicatorValues,
  moneyOperations,
  oneOffServicePayments,
  oneOffServices,
  organizations,
  platformLeads,
  projectPayments,
  projects,
  reports,
  schedulerRuns,
  sessionLog,
  subscriptionPayments,
  tasks,
  telegramOutbox,
  users,
} from './schema';
import {
  DEMO_ORG_ID,
  demoId,
  DM_BUILTIN_PERMISSION,
  dmBuiltinRows,
  dmParamDefsOf,
  seedAll,
  seedDmTemplates,
  type DmTemplateColumn,
  type DmTemplateParam,
} from './seed';
import type { DemoKind } from './seed/demo';
import { readSpecJson } from './spec-data';
import { createTestDatabase, databaseAvailable, type TestDatabase } from './testing';

const t: Translate = (key, params) => formatText(UI_TEXTS[key].ru, params);

interface Builtin {
  code: string;
  audience: 'org' | 'admin';
  module: string | null;
  needPermission: string | null;
  params: DmTemplateParam[];
  columns: DmTemplateColumn[];
  query: string;
}

/** Строки ответа исполнителя объектами «столбец → значение». */
const objsOf = (r: DmResult) =>
  r.rows.map((v) => Object.fromEntries(r.columns.map((c, i) => [c, v[i]]))) as Record<
    string,
    unknown
  >[];

const num = (v: unknown) => Number(v);

// Готовые шаблоны «Витрины данных» (доработки 20.11.2026: Витрина данных, блок 7; общий план 20.11,
// этап 1, П11): запросы выполняет настоящий исполнитель (`runDmOrg`, `runDmAdmin`) на демо-организации, а
// ответ сверяется с тем, что показывает продукт: «Аналитика» «Главной», долг вкладки «Обслуживание»,
// списки отчётов, денег, проектов, показателей и задач. Блок 8, пункт 8: «Чужая организация не видна» —
// на каждый готовый шаблон организаций.
describe.skipIf(!databaseAvailable())('готовые шаблоны «Витрины данных»', () => {
  let db: TestDatabase;
  let refDB: Record<string, unknown>;
  let adminId = '';
  let b: CreatedOrganization;
  let bCp = '';
  let bEmp = '';
  const B_NAME = 'ОсОО «Чужая Витрина»';
  const builtin = new Map<string, Builtin>();
  /** Сегодня по Бишкеку: запросы считают «сегодня» по часам базы (`current_date`). */
  const TODAY = bishkekDate(new Date());

  const run = async (
    code: string,
    input: Record<string, string | null> = {},
    orgId: string = DEMO_ORG_ID,
  ) => {
    const tpl = builtin.get(code);
    if (!tpl) throw new Error(`нет шаблона ${code}`);
    const bound = dmBind(tpl.query, dmParamDefsOf(tpl.params), input, TODAY);
    if (!bound.ok) throw new Error(`${code}: ${JSON.stringify(bound)}`);
    const q = { text: bound.text, params: bound.params, maxRows: 50_000 };
    const r =
      tpl.audience === 'org'
        ? await runDmOrg(
            db.app.db,
            {
              orgId,
              userId: orgId === DEMO_ORG_ID ? demoId('user', 'e1') : b.ownerUserId,
            },
            q,
          )
        : await runDmAdmin(db.app.db, adminId, q);
    return { ...r, objs: objsOf(r) };
  };
  const inDemo = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: DEMO_ORG_ID, userId: demoId('user', 'e1') }, fn);
  const demo = (kind: DemoKind, code: string | number) => demoId(kind, String(code));

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAll(db.admin.db, { update: false, demo: true });
    refDB = await readSpecJson<Record<string, unknown>>('data/refDB.json');
    const [admin] = await db.admin.db
      .insert(users)
      .values({ login: 'dmt-platform', passwordHash: 'x', isPlatformAdmin: true })
      .returning({ id: users.id });
    adminId = admin!.id;
    for (const row of await db.admin.db
      .select({
        code: dmTemplates.code,
        audience: dmTemplates.audience,
        module: dmTemplates.module,
        needPermission: dmTemplates.needPermission,
        params: dmTemplates.params,
        columns: dmTemplates.columns,
        query: dmTemplateSql.query,
      })
      .from(dmTemplates)
      .innerJoin(dmTemplateSql, eq(dmTemplateSql.templateId, dmTemplates.id))
      .where(eq(dmTemplates.builtin, true)))
      builtin.set(row.code, row as Builtin);

    // Организация Б: по записи в каждой таблице, которую читают шаблоны организаций.
    b = await createOrganization(db.app.db, {
      name: 'Организация Витрины Б',
      inn: '02811201810499',
      slug: 'dmt-b',
      owner: { fullName: 'Витринова Чужая Бэ', login: 'dmt-owner-b', passwordHash: 'x' },
    });
    bEmp = b.ownerEmployeeId;
    bCp = randomUUID();
    const org = b.orgId;
    await db.admin.db.insert(contractors).values({
      id: bCp,
      orgId: org,
      name: B_NAME,
      inn: '01234567890999',
      phone: '+996555100999',
      kind: 'regular',
      formCode: 'ФС-01',
      regimeCode: 'РЕЖ-01',
      startDate: '2026-01-01',
      responsibleEmployeeId: bEmp,
      createdAt: new Date('2025-12-31T00:00:00Z'),
    });
    await db.admin.db.insert(contractorTariffs).values({
      orgId: org,
      contractorId: bCp,
      amount: 500_000,
      period: 'M',
      validFrom: '2026-01-01',
    });
    const [pay] = await db.admin.db
      .insert(feePayments)
      .values({
        orgId: org,
        contractorId: bCp,
        amount: 500_000,
        paidOn: '2026-02-01',
        toKind: 'org',
      })
      .returning({ id: feePayments.id });
    await db.admin.db
      .insert(feeAllocations)
      .values({ orgId: org, paymentId: pay!.id, month: '2026-01-01', amount: 500_000 });
    await db.admin.db.insert(reports).values({
      orgId: org,
      contractorId: bCp,
      reportTypeCode: 'nds',
      act: 'both',
      period: 'M',
      periodStart: '2026-09-01',
      dueBase: '2026-10-25',
      dueDate: '2026-10-25',
      payDue: '2026-10-25',
      amount: 100_000,
      responsibleEmployeeId: bEmp,
    });
    await db.admin.db.insert(moneyOperations).values({
      orgId: org,
      contractorId: bCp,
      kind: 'in',
      amount: 100_000,
      total: 100_000,
      opDate: '2026-10-10',
      holderKind: 'org',
      note: 'Чужое поступление',
    });
    // Поступление только за обслуживание (сумма за налоги 0): шаблон его не показывает (п. В-19).
    await db.admin.db.insert(moneyOperations).values({
      orgId: org,
      contractorId: bCp,
      kind: 'in',
      amount: 0,
      total: 50_000,
      opDate: '2026-10-11',
      holderKind: 'org',
      note: 'Только за обслуживание',
    });
    const [project] = await db.admin.db
      .insert(projects)
      .values({
        orgId: org,
        contractorId: bCp,
        name: 'Проект Б',
        startsOn: '2026-10-01',
        endsOn: '2026-10-31',
        plan: 200_000,
        leadEmployeeId: bEmp,
      })
      .returning({ id: projects.id });
    await db.admin.db
      .insert(projectPayments)
      .values({ orgId: org, projectId: project!.id, amount: 50_000, paidOn: '2026-10-05' });
    const [service] = await db.admin.db
      .insert(oneOffServices)
      .values({
        orgId: org,
        contractorId: bCp,
        name: 'Услуга Б',
        serviceDate: '2026-10-02',
        amount: 30_000,
      })
      .returning({ id: oneOffServices.id });
    await db.admin.db
      .insert(oneOffServicePayments)
      .values({ orgId: org, serviceId: service!.id, amount: 30_000, paidOn: '2026-10-03' });
    const [indicator] = await db.admin.db
      .insert(indicators)
      .values({
        orgId: org,
        name: 'Выручка Б',
        unit: 'сом',
        type: 'som',
        startMonth: '2026-01',
        sortOrder: 1,
      })
      .returning({ id: indicators.id });
    await db.admin.db.insert(indicatorValues).values({
      orgId: org,
      contractorId: bCp,
      indicatorId: indicator!.id,
      month: '2026-09',
      value: 12_345_600,
    });
    await db.admin.db.insert(tasks).values({
      orgId: org,
      title: 'Задача Б',
      categoryCode: 'КАТ-001',
      contractorId: bCp,
      executorEmployeeId: bEmp,
      authorEmployeeId: bEmp,
      dueDate: '2026-10-15',
      confirm: false,
    });
  }, 300_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('наполнение останавливается на ошибке refDB.json: код дважды, нет запроса продукта, право не из каталога, чужой столбец «Контрагент»', () => {
    const list = refDB.dmTemplates as Record<string, unknown>[];
    const debtors = list.find((t) => t.code === 'debtors')!;
    expect(() => dmBuiltinRows([debtors, debtors])).toThrow(/дважды/);
    expect(() => dmBuiltinRows([{ ...debtors, code: 'dm-unknown' }])).toThrow(
      /нет запроса продукта/,
    );
    expect(() => dmBuiltinRows([{ ...debtors, perm: 'feeSee' }])).toThrow(/не из каталога прав/);
    expect(() => dmBuiltinRows([{ ...debtors, cpCol: 'debt' }])).toThrow(/Контрагент/);
    expect(dmBuiltinRows([debtors])[0]!.template.needPermission).toBe('fee');
  });

  it('наполнение: 12 шаблонов организаций и 6 Админки из refDB.json — опубликованы, готовые, для всех; повтор ничего не дублирует, --update возвращает запрос и описание, но не состояние', async () => {
    const all = await db.admin.db.select().from(dmTemplates).orderBy(asc(dmTemplates.code));
    const list = refDB.dmTemplates as {
      code: string;
      name: string;
      kind: string;
      mod: string | null;
      perm: string | null;
      cpCol: string | null;
      cols: { k: string }[];
    }[];
    expect(all.map((x) => x.code).sort()).toEqual(list.map((x) => x.code).sort());
    expect(all.filter((x) => x.audience === 'org')).toHaveLength(12);
    expect(all.filter((x) => x.audience === 'admin')).toHaveLength(6);
    for (const x of all) {
      const src = list.find((s) => s.code === x.code)!;
      expect(x, x.code).toMatchObject({
        name: src.name,
        builtin: true,
        state: 'published',
        access: 'all',
        module: src.mod,
        needPermission: DM_BUILTIN_PERMISSION[x.code] ?? src.perm,
        audience: src.kind === 'org' ? 'org' : 'admin',
        createdBy: null,
      });
      const cols = x.columns as DmTemplateColumn[];
      expect(cols.map((c) => c.code)).toEqual(src.cols.map((c) => c.k));
      expect(cols.filter((c) => c.contractor).map((c) => c.code)).toEqual(
        src.cpCol ? [src.cpCol] : [],
      );
    }
    // Плата за обслуживание, «Должники» и «Выручка» — с правом «Видеть плату за обслуживание».
    expect(
      all
        .filter((x) => x.needPermission === 'fee')
        .map((x) => x.code)
        .sort(),
    ).toEqual(['debtors', 'revenue', 'service-fee']);
    // «Задачи» — только с «Видеть задачи всех» (п. К-27): в refDB права у шаблона нет.
    expect(all.find((x) => x.code === 'tasks')!.needPermission).toBe('tasksAll');
    expect(list.find((x) => x.code === 'tasks')!.perm).toBeNull();

    expect(await seedDmTemplates(db.admin.db, refDB.dmTemplates, { update: true })).toEqual({
      inserted: 0,
      updated: 0,
      unchanged: 18,
    });
    // Администратор выключил шаблон; запрос и название поменяли мимо Админки — выпуск их вернёт.
    const leads = all.find((x) => x.code === 'leads')!;
    await db.admin.db
      .update(dmTemplates)
      .set({ state: 'off', name: 'Испорчено' })
      .where(eq(dmTemplates.id, leads.id));
    await db.admin.db
      .update(dmTemplateSql)
      .set({ query: 'SELECT 1', checkError: 'ошибка' })
      .where(eq(dmTemplateSql.templateId, leads.id));
    expect(await seedDmTemplates(db.admin.db, refDB.dmTemplates, { update: false })).toEqual({
      inserted: 0,
      updated: 0,
      unchanged: 18,
    });
    expect(await seedDmTemplates(db.admin.db, refDB.dmTemplates, { update: true })).toEqual({
      inserted: 0,
      updated: 1,
      unchanged: 17,
    });
    const [after] = await db.admin.db
      .select({
        name: dmTemplates.name,
        state: dmTemplates.state,
        query: dmTemplateSql.query,
        checkError: dmTemplateSql.checkError,
      })
      .from(dmTemplates)
      .innerJoin(dmTemplateSql, eq(dmTemplateSql.templateId, dmTemplates.id))
      .where(eq(dmTemplates.id, leads.id));
    expect(after).toEqual({
      name: 'Заявки с лендинга',
      state: 'off',
      query: builtin.get('leads')!.query,
      checkError: null,
    });
    await db.admin.db
      .update(dmTemplates)
      .set({ state: 'published' })
      .where(eq(dmTemplates.id, leads.id));
  });

  it('каждый готовый шаблон выполняется со значениями параметров по умолчанию: столбцы ответа — столбцы шаблона по порядку', async () => {
    expect(builtin.size).toBe(18);
    for (const [code, tpl] of builtin) {
      const r = await run(code);
      expect(r.columns, code).toEqual(tpl.columns.map((c) => c.code));
      expect(r.more, code).toBe(false);
    }
  });

  it('«Контрагенты»: все, кроме архивных; форма и режим — названиями, ответственный — кратко, обслуживание — статусом', async () => {
    const r = await run('contractors');
    const own = await db.admin.db
      .select({ id: contractors.id })
      .from(contractors)
      .where(and(eq(contractors.orgId, DEMO_ORG_ID), ne(contractors.serviceStatus, 'archived')));
    expect(r.objs.map((x) => x.contractor_id).sort()).toEqual(own.map((x) => x.id).sort());
    const [resp] = await db.admin.db
      .select({ name: employees.shortName })
      .from(employees)
      .where(eq(employees.id, demo('employee', 'e3')));
    expect(r.objs.find((x) => x.contractor_id === demo('contractor', 1))).toEqual({
      contractor_id: demo('contractor', 1),
      cp: 'ОсОО «Ала-Тоо Трейд»',
      inn: '03744097401851',
      form: 'ОсОО',
      regime: 'ОНР',
      resp: resp!.name,
      svc: 'Обслуживается',
      start: '2024-07-16',
    });
    const paused = await db.admin.db
      .select({ id: contractors.id })
      .from(contractors)
      .where(and(eq(contractors.orgId, DEMO_ORG_ID), eq(contractors.serviceStatus, 'paused')));
    expect(paused.length).toBeGreaterThan(0);
    for (const p of paused)
      expect(r.objs.find((x) => x.contractor_id === p.id)?.svc).toBe('Приостановлен');
  });

  it('«Отчёты к сдаче»: срок в периоде, подпись периода как в списках, статус словами, сумма и оплачено; фильтр по статусу', async () => {
    const from = '2026-08-01';
    const to = '2026-08-31';
    const r = await run('reports-due', { date_from: from, date_to: to });
    const own = await db.admin.db
      .select({
        id: reports.id,
        contractorId: reports.contractorId,
        period: reports.period,
        periodStart: reports.periodStart,
        eventDate: reports.eventDate,
        dueDate: reports.dueDate,
        status: reports.status,
        amount: reports.amount,
        paid: reports.paid,
      })
      .from(reports)
      .where(
        and(
          eq(reports.orgId, DEMO_ORG_ID),
          eq(reports.superseded, false),
          between(reports.dueDate, from, to),
        ),
      );
    expect(own.length).toBeGreaterThan(10);
    expect(r.rows).toHaveLength(own.length);
    const labels = (rows: typeof own) =>
      rows
        .map((x) =>
          [
            x.contractorId,
            x.dueDate,
            periodLabel(
              {
                period: x.period as ReportPeriod,
                start: x.periodStart as IsoDate,
                event: x.eventDate as IsoDate | null,
              },
              t,
            ),
            UI_TEXTS[`status.report.${x.status}` as keyof typeof UI_TEXTS].ru,
            x.amount ?? 0,
            x.paid ?? 0,
          ].join('|'),
        )
        .sort();
    expect(
      r.objs
        .map((x) => [x.contractor_id, x.due, x.period, x.status, num(x.sum), num(x.paid)].join('|'))
        .sort(),
    ).toEqual(labels(own));
    expect(r.objs.map((x) => x.due)).toEqual([...r.objs.map((x) => x.due as string)].sort());
    // НДС «Ала-Тоо Трейд» за 07.2026 — сдан и оплачен (demoDB.json, отчёт 1).
    expect(
      r.objs.find(
        (x) =>
          x.contractor_id === demo('contractor', 1) && x.period === '07.2026' && x.rep === 'НДС',
      ),
    ).toMatchObject({ due: '2026-08-25', status: 'Сдан', sum: 2_062_000, paid: 2_062_000 });

    const done = await run('reports-due', { date_from: from, date_to: to, status: 'submitted' });
    expect(done.rows).toHaveLength(own.filter((x) => x.status === 'submitted').length);
    expect(new Set(done.objs.map((x) => x.status))).toEqual(new Set(['Сдан']));
  });

  it('«Просроченные отчёты»: не сданные со сроком раньше даты и на сколько дней', async () => {
    const date = '2026-10-18';
    const r = await run('reports-overdue', { date });
    const own = await db.admin.db
      .select({ id: reports.id, dueDate: reports.dueDate, status: reports.status })
      .from(reports)
      .where(
        and(
          eq(reports.orgId, DEMO_ORG_ID),
          eq(reports.superseded, false),
          sql`${reports.status} not in ('submitted', 'not_required')`,
          sql`${reports.dueDate} < ${date}::date`,
        ),
      );
    expect(own.length).toBeGreaterThan(10);
    expect(r.rows).toHaveLength(own.length);
    for (const x of r.objs) {
      expect((x.due as string) < date).toBe(true);
      expect(x.days).toBe(
        Math.round((Date.parse(date) - Date.parse(x.due as string)) / 86_400_000),
      );
      expect(['Сдан', 'Не требуется']).not.toContain(x.status);
    }
  });

  it('«Сдача отчётов по сотрудникам»: отчёты со сроком в месяце — сдано, просрочено и осталось от сегодняшнего дня', async () => {
    const r = await run('reports-by-staff', { month: '2026-10' });
    const own = await db.admin.db
      .select({ resp: employees.shortName, status: reports.status, dueDate: reports.dueDate })
      .from(reports)
      .leftJoin(employees, eq(employees.id, reports.responsibleEmployeeId))
      .where(
        and(
          eq(reports.orgId, DEMO_ORG_ID),
          eq(reports.superseded, false),
          between(reports.dueDate, '2026-10-01', '2026-10-31'),
        ),
      );
    const open = (s: string) => !['submitted', 'not_required'].includes(s);
    const expected = new Map<string, number[]>();
    for (const x of own) {
      const k = x.resp ?? 'Без ответственного';
      const v = expected.get(k) ?? [0, 0, 0, 0];
      v[0]! += 1;
      if (!open(x.status)) v[1]! += 1;
      else if (x.dueDate < TODAY) v[2]! += 1;
      else v[3]! += 1;
      expected.set(k, v);
    }
    expect(
      Object.fromEntries(
        r.objs.map((x) => [x.emp, [x.total, x.done, x.overdue, x.remaining].map(num)]),
      ),
    ).toEqual(Object.fromEntries(expected));
    expect(r.objs.map((x) => x.emp)).toEqual([...expected.keys()].sort((a, c) => (a < c ? -1 : 1)));
  });

  it('«К оплате налогов по контрагентам»: по месяцу срока оплаты, оплачено и остаток', async () => {
    const r = await run('tax-due', { month: '2026-08' });
    const own = await db.admin.db
      .select({
        contractorId: reports.contractorId,
        amount: reports.amount,
        paid: reports.paid,
        payDue: reports.payDue,
        dueDate: reports.dueDate,
      })
      .from(reports)
      .where(
        and(
          eq(reports.orgId, DEMO_ORG_ID),
          eq(reports.superseded, false),
          sql`${reports.amount} > 0`,
        ),
      );
    const expected = new Map<string, [number, number, number]>();
    for (const x of own) {
      if ((x.payDue ?? x.dueDate).slice(0, 7) !== '2026-08') continue;
      const v = expected.get(x.contractorId) ?? [0, 0, 0];
      v[0] += x.amount!;
      v[1] += x.paid ?? 0;
      v[2] += Math.max(0, x.amount! - (x.paid ?? 0));
      expected.set(x.contractorId, v);
    }
    expect(expected.size).toBeGreaterThan(3);
    expect(
      Object.fromEntries(r.objs.map((x) => [x.contractor_id, [x.sum, x.paid, x.rest].map(num)])),
    ).toEqual(Object.fromEntries(expected));
    const rest = r.objs.map((x) => num(x.rest));
    expect(rest).toEqual([...rest].sort((a, c) => c - a));
  });

  it('«Плата за обслуживание» и «Выручка по контрагентам» за год — те же числа, что «Аналитика» на «Главной»', async () => {
    // Год данных — постоянный: оплаты в демо — за 2025–2026, «сегодня» — по часам.
    const year = 2026;
    const source = await inDemo((tx) =>
      revenueSource(tx, { scope: undefined, today: TODAY, from: year, to: year }),
    );
    const rows = revenueRows(source.contractors, source.payments, year, TODAY);

    const fee = await run('service-fee', { year: String(year) });
    const feeExpected = rows
      .filter((x) => !x.oneOff && (x.feeCh || x.fee))
      .map((x) => [x.id, x.feeCh, x.fee, Math.max(0, x.feeCh - x.fee)]);
    expect(feeExpected.length).toBeGreaterThan(10);
    expect(
      fee.objs.map((x) => [x.contractor_id, num(x.charged), num(x.paid), num(x.debt)]).sort(),
    ).toEqual(feeExpected.sort());

    const revenue = await run('revenue', { year: String(year) });
    const revExpected = rows
      .filter((x) => x.total > 0)
      .map((x) => [x.id, x.fee, x.proj, x.svc, x.total]);
    expect(revExpected.length).toBeGreaterThan(10);
    expect(
      revenue.objs
        .map((x) => [x.contractor_id, num(x.fee), num(x.proj), num(x.svc), num(x.total)])
        .sort(),
    ).toEqual(revExpected.sort());
    const totals = revenue.objs.map((x) => num(x.total));
    expect(totals).toEqual([...totals].sort((a, c) => c - a));
  });

  it('«Должники»: на сегодня — долг вкладки «Обслуживание» каждого контрагента и месяцы с недоплатой; на прошлую дату — только месяцы со сроком до неё', async () => {
    const ledgers = await inDemo((tx) => feeLedgers(tx, { scope: undefined, today: TODAY }));
    const expectedOn = (date: string) =>
      [...ledgers]
        .map(([id, f]) => {
          const ms = f.months.filter((m) => m.due <= date && m.charge - m.got > 0);
          return [id, ms.reduce((a, m) => a + m.charge - m.got, 0), ms.length] as const;
        })
        .filter(([, debt]) => debt > 0);

    const today = await run('debtors', { date: TODAY });
    const now = expectedOn(TODAY);
    expect(now.length).toBeGreaterThan(5);
    expect(today.objs.map((x) => [x.contractor_id, num(x.debt), num(x.months)]).sort()).toEqual(
      now.map((x) => [...x]).sort(),
    );
    for (const [id, debt] of now) expect(ledgers.get(id)!.debt, id).toBe(debt);

    const past = await run('debtors', { date: '2026-06-30' });
    expect(past.objs.map((x) => [x.contractor_id, num(x.debt), num(x.months)]).sort()).toEqual(
      expectedOn('2026-06-30')
        .map((x) => [...x])
        .sort(),
    );
  });

  it('«Финансовые операции»: действующие операции с датой в периоде, вид словами, сумма без части за обслуживание', async () => {
    const r = await run('money-operations', { date_from: '2026-10-01', date_to: '2026-10-31' });
    const own = await db.admin.db
      .select({
        contractorId: moneyOperations.contractorId,
        kind: moneyOperations.kind,
        amount: moneyOperations.amount,
        date: moneyOperations.opDate,
      })
      .from(moneyOperations)
      .where(
        and(
          eq(moneyOperations.orgId, DEMO_ORG_ID),
          isNull(moneyOperations.cancelledAt),
          between(moneyOperations.opDate, '2026-10-01', '2026-10-31'),
        ),
      );
    expect(own.length).toBeGreaterThan(10);
    expect(
      r.objs.map((x) => [x.contractor_id, x.date, x.kind, num(x.amount)].join('|')).sort(),
    ).toEqual(
      own
        .filter((x) => !(x.kind === 'in' && x.amount === 0))
        .map((x) =>
          [
            x.contractorId,
            x.date,
            UI_TEXTS[`money.op.${x.kind}` as keyof typeof UI_TEXTS].ru,
            x.amount,
          ].join('|'),
        )
        .sort(),
    );
    // Поступление только за обслуживание видно только тому, кто видит плату (п. В-19): в шаблоне его нет.
    const inB = await run(
      'money-operations',
      { date_from: '2026-10-01', date_to: '2026-10-31' },
      b.orgId,
    );
    expect(inB.objs.map((x) => x.note)).toEqual(['Чужое поступление']);
  });

  it('«Проекты и разовые услуги»: проекты, начатые в периоде, и услуги с датой в нём — стоимость, оплачено, долг', async () => {
    const r = await run('projects-services', { date_from: '2026-08-01', date_to: '2026-09-30' });
    const [p1] = await db.admin.db
      .select({ plan: projects.plan })
      .from(projects)
      .where(eq(projects.id, demo('project', 'p1')));
    const [pay] = await db.admin.db
      .select({ paid: sql<string>`coalesce(sum(${projectPayments.amount}), 0)` })
      .from(projectPayments)
      .where(
        and(
          eq(projectPayments.projectId, demo('project', 'p1')),
          isNull(projectPayments.deletedAt),
        ),
      );
    expect(r.objs.find((x) => x.name === 'Восстановление учёта 2024–2025')).toEqual({
      contractor_id: demo('contractor', 1),
      kind: 'Проект',
      name: 'Восстановление учёта 2024–2025',
      cp: 'ОсОО «Ала-Тоо Трейд»',
      date: '2026-08-19',
      cost: p1!.plan,
      paid: num(pay!.paid),
      debt: Math.max(0, p1!.plan! - num(pay!.paid)),
    });
    expect(
      r.objs.find((x) => x.name === 'Проверка бухгалтерского учёта за 2025 год'),
    ).toMatchObject({
      kind: 'Разовая услуга',
      date: '2026-09-08',
      cost: 3_500_000,
      paid: 3_500_000,
      debt: 0,
    });
    const nProjects = await db.admin.db.$count(
      projects,
      and(eq(projects.orgId, DEMO_ORG_ID), between(projects.startsOn, '2026-08-01', '2026-09-30')),
    );
    const nServices = await db.admin.db.$count(
      oneOffServices,
      and(
        eq(oneOffServices.orgId, DEMO_ORG_ID),
        isNull(oneOffServices.deletedAt),
        between(oneOffServices.serviceDate, '2026-08-01', '2026-09-30'),
      ),
    );
    expect(r.rows).toHaveLength(nProjects + nServices);
    const dates = r.objs.map((x) => x.date as string);
    expect(dates).toEqual([...dates].sort());
  });

  it('«Показатели контрагентов по месяцам»: значения как их вводят (в базе — сотые), единица показателя', async () => {
    const r = await run('indicators-by-month', { month_from: '2025-10', month_to: '2025-10' });
    const n = await db.admin.db.$count(
      indicatorValues,
      and(eq(indicatorValues.orgId, DEMO_ORG_ID), eq(indicatorValues.month, '2025-10')),
    );
    expect(r.rows).toHaveLength(n);
    const own = r.objs.filter((x) => x.contractor_id === demo('contractor', 1));
    expect(own.slice(0, 2)).toEqual([
      {
        contractor_id: demo('contractor', 1),
        cp: 'ОсОО «Ала-Тоо Трейд»',
        ind: 'Выручка',
        month: '2025-10',
        value: 1_850_900,
        unit: 'сом',
      },
      {
        contractor_id: demo('contractor', 1),
        cp: 'ОсОО «Ала-Тоо Трейд»',
        ind: 'Количество сотрудников',
        month: '2025-10',
        value: 37,
        unit: 'чел.',
      },
    ]);
  });

  it('«Задачи»: задачи со сроком в периоде — исполнитель, срок и статус словами', async () => {
    const r = await run('tasks', { date_from: '2026-10-01', date_to: '2026-10-31' });
    const n = await db.admin.db.$count(
      tasks,
      and(eq(tasks.orgId, DEMO_ORG_ID), between(tasks.dueDate, '2026-10-01', '2026-10-31')),
    );
    expect(r.rows).toHaveLength(n);
    const [exec] = await db.admin.db
      .select({ name: employees.shortName })
      .from(employees)
      .where(eq(employees.id, demo('employee', 'e3')));
    expect(r.objs.find((x) => x.title === 'Собрать первичку за сентябрь')).toEqual({
      contractor_id: demo('contractor', 1),
      title: 'Собрать первичку за сентябрь',
      cp: 'ОсОО «Ала-Тоо Трейд»',
      exec: exec!.name,
      due: '2026-10-12',
      status: 'Выполнена',
    });
  });

  it('«Чужая организация не видна» — в каждом готовом шаблоне организаций: демо не видит строк организации Б, Б — строк демо', async () => {
    const params: Record<string, Record<string, string>> = {
      'reports-due': { date_from: '2026-10-01', date_to: '2026-10-31' },
      'reports-overdue': { date: '2026-11-30' },
      'reports-by-staff': { month: '2026-10' },
      'tax-due': { month: '2026-10' },
      'service-fee': { year: '2026' },
      debtors: { date: TODAY },
      'money-operations': { date_from: '2026-10-01', date_to: '2026-10-31' },
      revenue: { year: '2026' },
      'projects-services': { date_from: '2026-10-01', date_to: '2026-10-31' },
      'indicators-by-month': { month_from: '2026-09', month_to: '2026-09' },
      tasks: { date_from: '2026-10-01', date_to: '2026-10-31' },
    };
    const [owner] = await db.admin.db
      .select({ name: employees.shortName })
      .from(employees)
      .where(eq(employees.id, bEmp));
    const demoNames = (
      await db.admin.db
        .select({ name: contractors.name })
        .from(contractors)
        .where(eq(contractors.orgId, DEMO_ORG_ID))
    ).map((x) => x.name);
    const orgCodes = [...builtin.values()].filter((x) => x.audience === 'org').map((x) => x.code);
    expect(orgCodes).toHaveLength(12);
    for (const code of orgCodes) {
      const inDemoOrg = await run(code, params[code] ?? {});
      const text = JSON.stringify(inDemoOrg.rows);
      expect(inDemoOrg.rows.length, code).toBeGreaterThan(0);
      expect(text, code).not.toContain(bCp);
      expect(text, code).not.toContain(B_NAME);
      expect(text, code).not.toContain(owner!.name);

      const inB = await run(code, params[code] ?? {}, b.orgId);
      expect(inB.rows.length, `${code} в Б`).toBeGreaterThan(0);
      const bText = JSON.stringify(inB.rows);
      for (const name of demoNames) expect(bText, code).not.toContain(name);
      if (inB.columns.includes('contractor_id'))
        expect(new Set(inB.objs.map((x) => x.contractor_id)), code).toEqual(new Set([bCp]));
      else
        expect(
          inB.objs.map((x) => x.emp),
          code,
        ).toEqual([owner!.name]);
    }
  });

  it('шаблоны Админки: числа и названия организаций, без телефонов; входы — по журналу сеансов, задачи — названиями «Запусков»', async () => {
    const day = '2026-11-03';
    const at = (time: string) => new Date(`${day}T${time}+06:00`);
    // Организация Б: файл 2 МБ, присланный и не принятый — 1 МБ, заблокирована.
    await db.admin.db.insert(files).values({
      id: randomUUID(),
      orgId: b.orgId,
      sourceKind: 'contractor',
      sourceId: bCp,
      contractorId: bCp,
      name: 'акт.pdf',
      contentType: 'application/pdf',
      sizeBytes: 2 * 1_048_576,
      storageKey: `org/${b.orgId}/files/${randomUUID()}`,
      state: 'ready',
      createdBy: b.ownerUserId,
    });
    const sentId = randomUUID();
    await db.admin.db.insert(contractorSentFiles).values({
      id: sentId,
      orgId: b.orgId,
      contractorId: bCp,
      source: 'page',
      name: 'чек.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1_048_576,
      storageKey: `org/${b.orgId}/sent/${sentId}`,
      state: 'ready',
    });
    await db.admin.db
      .update(organizations)
      .set({ status: 'blocked', blockedReason: 'Сквозная проверка витрины' })
      .where(eq(organizations.id, b.orgId));
    const orgs = await run('orgs');
    // Телефона контрагента Б и владельца нет ни в каком виде.
    expect(JSON.stringify(orgs.rows).replace(/\D/g, '')).not.toContain('555100999');
    expect(orgs.objs.find((x) => x.org === 'Организация Витрины Б')).toEqual({
      org: 'Организация Витрины Б',
      status: 'Заблокирована',
      staff: 1,
      cps: 1,
      mb: 3,
    });
    expect(orgs.objs.find((x) => x.org === 'ОсОО «Бухгалтер Плюс»')).toMatchObject({
      status: 'Активна',
    });

    // Два входа владельца Б в один день — «Входов» 2, «Пользователей» 1.
    for (const time of ['09:00:00', '15:30:00'])
      await db.admin.db.insert(sessionLog).values({
        id: randomUUID(),
        userId: b.ownerUserId,
        orgId: b.orgId,
        startedAt: at(time),
        lastSeenAt: at(time),
        expiresAt: new Date('2027-01-01T00:00:00Z'),
      });
    const activity = await run('org-activity', { date_from: day, date_to: day });
    expect(activity.objs.filter((x) => x.org === 'Организация Витрины Б')).toEqual([
      { day, org: 'Организация Витрины Б', logins: 2, users: 1 },
    ]);

    await db.admin.db.insert(subscriptionPayments).values({
      id: randomUUID(),
      orgId: b.orgId,
      kind: 'free',
      planId: 'm1',
      months: 0,
      seats: 20,
      status: 'confirmed',
      reason: 'Бесплатный период для проверки',
      decidedAt: at('10:00:00'),
      paidUntil: '2026-12-03',
      createdAt: at('10:00:00'),
    });
    const subs = await run('subscriptions', { date_from: day, date_to: day });
    expect(subs.objs.filter((x) => x.org === 'Организация Витрины Б')).toEqual([
      {
        at: day,
        org: 'Организация Витрины Б',
        what: 'Бесплатный период',
        pack: 20,
        sum: 0,
        status: 'Подтверждена',
        paid_to: '2026-12-03',
      },
    ]);

    await db.admin.db.insert(platformLeads).values({
      name: 'Заявитель Витрины',
      firm: 'ОсОО «Заявка Витрины»',
      phone: '+996555777888',
      size: 'До 20',
      createdAt: at('11:00:00'),
    });
    const leads = await run('leads', { date_from: day, date_to: day });
    expect(leads.objs.filter((x) => x.firm === 'ОсОО «Заявка Витрины»')).toEqual([
      { at: day, firm: 'ОсОО «Заявка Витрины»', size: 'До 20', status: 'Новая' },
    ]);
    expect(JSON.stringify(leads.rows)).not.toContain('555777888');

    const botDay = '2020-01-15';
    for (const status of ['sent', 'sent', 'error', 'pending'] as const)
      await db.admin.db.insert(telegramOutbox).values({
        orgId: b.orgId,
        userId: b.ownerUserId,
        chatId: 777_000_111,
        kind: 'broadcast',
        text: 'Сообщение витрины',
        status,
        createdAt: new Date(`${botDay}T12:00:00+06:00`),
      });
    const bot = await run('bot-messages', { date_from: botDay, date_to: botDay });
    expect(bot.objs).toEqual([{ day: botDay, sent: 2, errors: 1 }]);
    expect(JSON.stringify(bot.rows)).not.toContain('777000111');

    const runDay = '2020-02-10';
    const slot = (h: number) => new Date(`${runDay}T0${h}:00:00+06:00`);
    await db.admin.db.insert(schedulerRuns).values([
      { job: 'reports.create-due', slot: slot(1), startedAt: slot(1), ok: true },
      { job: 'reports.create-due', slot: slot(2), startedAt: slot(2), ok: false, error: 'сбой' },
      { job: 'reports.create-due', slot: slot(3), startedAt: slot(3), ok: true },
      { job: 'dm.unknown-job', slot: slot(4), startedAt: slot(4), ok: true },
    ]);
    const runs = await run('scheduler-runs', { date_from: runDay, date_to: runDay });
    expect(runs.objs.map((x) => [x.job, x.runs, x.ok, x.errors])).toEqual([
      [UI_TEXTS['alert.job.reports_create_due' as keyof typeof UI_TEXTS].ru, 3, 2, 1],
      ['dm.unknown-job', 1, 1, 0],
    ]);
    expect(Date.parse(runs.objs[0]!.last as string)).toBe(slot(3).getTime());
  });
});
