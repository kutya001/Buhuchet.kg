import { formatText, reportDue, effectiveRule, UI_TEXTS } from '@buhuchet/domain';
import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminCalendarAdd, adminCalendarDelete } from './admin-calendar';
import { adminTypeReportCounts } from './admin-platform-dicts';
import { withUserContext } from './auth';
import type { Tx } from './client';
import { withOrgContext } from './context';
import { createContractor, type ContractorFields } from './contractors';
import { readHistory } from './history';
import { createOrganization, type CreatedOrganization } from './organizations';
import {
  claimDuesRecalc,
  cleanupDuesRecalcs,
  DUES_RECALC_ATTEMPTS,
  enqueueDuesRecalc,
  finishDuesRecalc,
} from './dues-recalcs';
import {
  createAssignment,
  createManualReport,
  createRevision,
  type AssignmentInput,
  type AssignmentTexts,
} from './reports';
import {
  dueCatalog,
  dueShiftExample,
  mergeRedueScopes,
  redueAllOrgs,
  redueOpenReports,
  type CatalogRedueTexts,
  type DueCatalog,
} from './reports-redue';
import {
  duesRecalcs,
  productionCalendar,
  reports,
  reportTypes,
  taxBenefitDueRules,
  users,
} from './schema';
import { seedPermissions, seedRoleTemplates } from './seed';
import { readSpecJson } from './spec-data';
import {
  createTestDatabase,
  databaseAvailable,
  seedAllPlatformDictionaries,
  type TestDatabase,
} from './testing';

const TODAY = '2026-10-27';
const t = (key: string) => formatText((UI_TEXTS as Record<string, { ru: string }>)[key]!.ru);
const TEXTS: CatalogRedueTexts = {
  byType: t('pdicts.dues.reason.type'),
  byCalendar: t('pdicts.dues.reason.calendar'),
  byStatus: t('report.reason.due_status'),
  byStatusDropped: t('report.reason.due_catalog_dropped'),
  byCatalog: t('report.reason.due_catalog'),
};
/** Нерабочий день на срок НДС за октябрь. */
const HOLIDAY = { date: '2026-11-25', type: 'off' as const, name: 'Перенос' };
const ASSIGNMENT_TEXTS: AssignmentTexts = {
  ended: 'Назначение снято',
  restored: 'Назначено снова',
  until: 'Позже «до какого периода»',
  past: 'Создан за прошлый период при назначении',
  pastMarked: 'Создан за прошлый период и отмечен сданным при назначении',
  pastConfirmed: 'Создан за прошлый период и отмечен сданным и подтверждённым при назначении',
  pastConfirmNote: 'Прошлый период отмечен при назначении',
  ownRuleChanged: 'В назначении изменены периодичность или срок — отчёт создан заново',
};

const fields = (patch: Partial<ContractorFields>): ContractorFields => ({
  name: 'ОсОО «Ала-Тоо Трейд»',
  inn: '03744097401851',
  phone: '+996505890076',
  kind: 'regular',
  formCode: 'ФС-01',
  regimeCode: 'РЕЖ-01',
  regime2Code: null,
  gked: '46.34.0',
  gkedExtra: [],
  taxOfficeCode: null,
  bizSize: 'small',
  benefits: [],
  bases: [],
  responsibleEmployeeId: null,
  head: '',
  contact: '',
  contractNo: '',
  contractDate: null,
  note: '',
  registration: {},
  startDate: '2024-07-16',
  firstMonthMode: 'full',
  feeDay: 15,
  paysTo: 'emp',
  gkedConfirmation: null,
  ...patch,
});

const assignment = (
  contractorId: string,
): AssignmentInput & {
  contractorId: string;
  reportTypeCode: string;
} => ({
  contractorId,
  reportTypeCode: 'nds',
  fromMonth: '2026-10-01',
  untilMonth: null,
  responsibleEmployeeId: null,
  rate: '12 %',
  enRates: [],
  rateAdditions: [],
  dueDay: null,
  ownPeriod: null,
  ownDay: null,
  ownMonth: null,
  fixedAmount: null,
  note: '',
});

/** Правка в транзакции администратора, которая откатывается: каталог сроков после неё. */
class Rollback extends Error {
  constructor(readonly catalog: DueCatalog) {
    super('rollback');
  }
}

describe.skipIf(!databaseAvailable())(
  'Пересчёт сроков несданных отчётов после правки каталога (задача 2.37)',
  () => {
    let db: TestDatabase;
    let a: CreatedOrganization;
    let b: CreatedOrganization;
    let adminId = '';
    let cpA = '';
    let cpManual = '';
    let cpBig = '';
    let cpB = '';

    const inOrg = <T>(org: CreatedOrganization, fn: (tx: Tx) => Promise<T>) =>
      withOrgContext(db.app.db, { orgId: org.orgId, userId: org.ownerUserId }, fn);
    const asAdmin = <T>(fn: (tx: Tx) => Promise<T>) => withUserContext(db.app.db, adminId, fn);
    /** Каталог после правки `edit`, которая не сохраняется (как предпросмотр в Админке). */
    const previewCatalog = async (edit: (tx: Tx) => Promise<unknown>) => {
      try {
        await asAdmin(async (tx) => {
          await edit(tx);
          throw new Rollback(await dueCatalog(tx));
        });
      } catch (err) {
        if (err instanceof Rollback) return err.catalog;
        throw err;
      }
      throw new Error('без каталога');
    };
    /** Октябрьский отчёт НДС контрагента: сроки и признак ручного срока. */
    const october = async (org: CreatedOrganization, contractorId: string) => {
      const [row] = await inOrg(org, (tx) =>
        tx
          .select()
          .from(reports)
          .where(
            and(
              eq(reports.contractorId, contractorId),
              eq(reports.reportTypeCode, 'nds'),
              eq(reports.periodStart, '2026-10-01'),
            ),
          )
          .orderBy(asc(reports.revision)),
      );
      return row!;
    };
    const dues = async (org: CreatedOrganization, contractorId: string) => {
      const r = await october(org, contractorId);
      return [r.dueBase, r.dueDate, r.payDue];
    };

    beforeAll(async () => {
      db = await createTestDatabase();
      const refDB = await readSpecJson<Record<string, unknown>>('data/refDB.json');
      await seedPermissions(db.admin.db, refDB.permissions, { update: false });
      await seedRoleTemplates(db.admin.db, refDB.roleTemplates, { update: false });
      await seedAllPlatformDictionaries(db.admin.db);
      const [admin] = await db.admin.db
        .insert(users)
        .values({ login: 'platform', passwordHash: '!', isPlatformAdmin: true })
        .returning({ id: users.id });
      adminId = admin!.id;
      const owner = (login: string) => ({ fullName: 'Владелец', login, passwordHash: 'x' });
      a = await createOrganization(db.app.db, {
        name: 'Организация А',
        inn: '01811201810456',
        slug: 'redue-a',
        owner: owner('redue-owner-a'),
      });
      b = await createOrganization(db.app.db, {
        name: 'Организация Б',
        inn: '02811201810457',
        slug: 'redue-b',
        owner: owner('redue-owner-b'),
      });
      const ctx = {
        today: TODAY,
        scope: undefined,
        markPast: false,
        confirm: false,
        texts: ASSIGNMENT_TEXTS,
      };
      [cpA, cpManual, cpBig] = await inOrg(a, async (tx) => [
        await createContractor(tx, a.orgId, fields({}), null),
        await createContractor(
          tx,
          a.orgId,
          fields({ name: 'ИП Садыков', inn: '20101199000123' }),
          null,
        ),
        await createContractor(
          tx,
          a.orgId,
          fields({
            name: 'ОАО «Крупный»',
            inn: '01504200510012',
            benefits: [{ code: 'ЛЬГ-30', validFrom: null, validTo: null }],
          }),
          null,
        ),
      ]);
      cpB = await inOrg(b, (tx) => createContractor(tx, b.orgId, fields({}), null));
      await inOrg(a, async (tx) => {
        for (const id of [cpA, cpManual, cpBig]) await createAssignment(tx, assignment(id), ctx);
      });
      await inOrg(b, (tx) => createAssignment(tx, assignment(cpB), ctx));
      // Срок, изменённый вручную, пересчёт не трогает.
      await db.admin.db
        .update(reports)
        .set({ dueManual: true, dueDate: '2026-11-27' })
        .where(and(eq(reports.contractorId, cpManual), eq(reports.periodStart, '2026-10-01')));
    });

    afterAll(async () => {
      await db?.drop();
    });

    it('правка календаря: в предпросмотре и после применения сроки несданных отчётов меняются в двух организациях одинаково, ручной срок — нет', async () => {
      expect(await dues(a, cpA)).toEqual(['2026-11-25', '2026-11-25', '2026-11-25']);
      expect(await dues(b, cpB)).toEqual(['2026-11-25', '2026-11-25', '2026-11-25']);
      // «Крупный налогоплательщик»: сдача — до последнего дня, уплата — до 25-го (ст. 319).
      expect(await dues(a, cpBig)).toEqual(['2026-11-30', '2026-11-30', '2026-11-25']);
      const holiday = HOLIDAY;

      // Предпросмотр: день не сохраняется, счёт — тем же кодом по каталогу с ним.
      const catalog = await previewCatalog((tx) => adminCalendarAdd(tx, holiday, TODAY));
      const preview = await redueAllOrgs(db.app.db, { kind: 'calendar' }, TODAY, {
        write: false,
        texts: TEXTS,
        catalog,
      });
      expect(preview).toEqual({ reports: 3, orgs: 2, failed: [], left: 0 });
      expect(
        await db.admin.db
          .select()
          .from(productionCalendar)
          .where(eq(productionCalendar.day, '2026-11-25')),
      ).toEqual([]);
      expect(await dues(a, cpA)).toEqual(['2026-11-25', '2026-11-25', '2026-11-25']);

      // Применение: тот же счёт, сроки перенесены на следующий рабочий день.
      expect(await asAdmin((tx) => adminCalendarAdd(tx, holiday, TODAY))).toEqual({ ok: true });
      const applied = await redueAllOrgs(db.app.db, { kind: 'calendar' }, TODAY, {
        write: true,
        texts: TEXTS,
      });
      expect(applied).toEqual(preview);
      expect(await dues(a, cpA)).toEqual(['2026-11-25', '2026-11-26', '2026-11-26']);
      expect(await dues(b, cpB)).toEqual(['2026-11-25', '2026-11-26', '2026-11-26']);
      expect(await dues(a, cpBig)).toEqual(['2026-11-30', '2026-11-30', '2026-11-26']);
      const manual = await october(a, cpManual);
      expect([manual.dueDate, manual.dueManual]).toEqual(['2026-11-27', true]);

      // В истории отчёта — было → стало с причиной; автор — система.
      const report = await october(b, cpB);
      const history = await inOrg(b, (tx) => readHistory(tx, 'report', report.id));
      expect(history.at(-1)).toMatchObject({
        action: 'update',
        actorUserId: null,
        reason: 'Изменён производственный календарь',
        contractorId: cpB,
        changes: [
          { field: 'dueDate', from: '2026-11-25', to: '2026-11-26' },
          { field: 'payDue', from: '2026-11-25', to: '2026-11-26' },
        ],
      });

      // Повтор ничего не меняет.
      expect(
        await redueAllOrgs(db.app.db, { kind: 'calendar' }, TODAY, { write: true, texts: TEXTS }),
      ).toEqual({ reports: 0, orgs: 0, failed: [], left: 0 });

      // Удаление дня возвращает сроки.
      const [day] = await db.admin.db
        .select()
        .from(productionCalendar)
        .where(eq(productionCalendar.day, '2026-11-25'));
      expect(await asAdmin((tx) => adminCalendarDelete(tx, '2026-11-25', day!.version))).toEqual({
        ok: true,
      });
      await redueAllOrgs(db.app.db, { kind: 'calendar' }, TODAY, { write: true, texts: TEXTS });
      expect(await dues(a, cpA)).toEqual(['2026-11-25', '2026-11-25', '2026-11-25']);
    });

    it('правка правила срока вида: только отчёты вида, без ручного срока; «Что сделать» — отчёта', async () => {
      // Сданный отчёт и отчёт «только сдача» (вид потом поменяли) — как в жизни.
      const report = await october(b, cpB);
      await db.admin.db
        .update(reports)
        .set({ act: 'sub', payDue: null })
        .where(eq(reports.id, report.id));
      await db.admin.db
        .update(reports)
        .set({ status: 'submitted' })
        .where(and(eq(reports.contractorId, cpA), eq(reports.periodStart, '2026-11-01')));
      await db.admin.db.update(reportTypes).set({ dueDay: 20 }).where(eq(reportTypes.code, 'nds'));
      try {
        const scope = { kind: 'types', codes: ['nds'] } as const;
        const counted = await inOrg(a, (tx) =>
          redueOpenReports(tx, scope, TODAY, { write: false, texts: TEXTS }),
        );
        // А: октябрь cpA (ноябрь сдан) и ноябрь с ручным октябрём; у «Крупного» сроки по статусу.
        expect(counted).toBe(2);
        const summary = await redueAllOrgs(db.app.db, scope, TODAY, { write: true, texts: TEXTS });
        expect(summary).toEqual({ reports: 2 + 2, orgs: 2, failed: [], left: 0 });
        expect(await dues(a, cpBig)).toEqual(['2026-11-30', '2026-11-30', '2026-11-25']);
        // Уплата НДС — своим правилом (до 25-го), оно не менялось.
        expect(await dues(a, cpA)).toEqual(['2026-11-20', '2026-11-20', '2026-11-25']);
        // У отчёта «только сдача» срока оплаты нет, хотя вид теперь с уплатой.
        expect(await dues(b, cpB)).toEqual(['2026-11-20', '2026-11-20', null]);
        expect((await october(a, cpManual)).dueDate).toBe('2026-11-27');
        const history = await inOrg(a, async (tx) =>
          readHistory(tx, 'report', (await october(a, cpA)).id),
        );
        expect(history.at(-1)?.reason).toBe('Изменено правило срока вида отчёта');
      } finally {
        await db.admin.db
          .update(reportTypes)
          .set({ dueDay: 25 })
          .where(eq(reportTypes.code, 'nds'));
        await redueAllOrgs(db.app.db, { kind: 'types', codes: ['nds'] }, TODAY, {
          write: true,
          texts: TEXTS,
        });
      }
    });

    it('«Меняет сроки» статуса: отчёты контрагентов со статусом, причина — срок по статусу или «снят статус»', async () => {
      const scope = { kind: 'statuses', codes: ['ЛЬГ-30'] } as const;
      const [rule] = await db.admin.db
        .select()
        .from(taxBenefitDueRules)
        .where(eq(taxBenefitDueRules.benefitCode, 'ЛЬГ-30'));
      // Предпросмотр по каталогу в памяти: статус больше не меняет срок НДС.
      const catalog = await asAdmin((tx) => dueCatalog(tx));
      const without: DueCatalog = {
        ...catalog,
        statuses: new Map([...catalog.statuses].filter(([code]) => code !== 'ЛЬГ-30')),
      };
      expect(
        await redueAllOrgs(db.app.db, scope, TODAY, {
          write: false,
          texts: TEXTS,
          catalog: without,
        }),
      ).toEqual({ reports: 2, orgs: 1, failed: [], left: 0 });

      await db.admin.db
        .delete(taxBenefitDueRules)
        .where(eq(taxBenefitDueRules.benefitCode, 'ЛЬГ-30'));
      const summary = await redueAllOrgs(db.app.db, scope, TODAY, { write: true, texts: TEXTS });
      expect(summary).toEqual({ reports: 2, orgs: 1, failed: [], left: 0 });
      const big = await october(a, cpBig);
      expect([big.dueDate, big.payDue]).toEqual(['2026-11-25', '2026-11-25']);
      const dropped = await inOrg(a, (tx) => readHistory(tx, 'report', big.id));
      expect(dropped.at(-1)?.reason).toMatch(/^Срок по каталогу \(снят статус «.+»\)$/);

      await db.admin.db.insert(taxBenefitDueRules).values(rule!);
      expect(
        await redueAllOrgs(db.app.db, scope, TODAY, { write: true, texts: TEXTS }),
      ).toMatchObject({ reports: 2, orgs: 1 });
      const back = await october(a, cpBig);
      expect([back.dueDate, back.payDue]).toEqual(['2026-11-30', '2026-11-25']);
      const restored = await inOrg(a, (tx) => readHistory(tx, 'report', back.id));
      expect(restored.at(-1)?.reason).toMatch(/^Срок по статусу «.+»$/);
    });

    it('отчёты по видам во всех организациях: всего, несданных и в скольких организациях', async () => {
      const counts = await adminTypeReportCounts(db.app.db);
      // А: три контрагента × два периода (один ноябрьский сдан); Б: два.
      expect(counts.get('nds')).toEqual({ total: 8, open: 7, orgs: 2 });
      expect(counts.get('soc')).toBeUndefined();
    });

    it('области пересчёта объединяются: календарь поглощает остальные', () => {
      expect(mergeRedueScopes([null, null])).toBeNull();
      expect(
        mergeRedueScopes([
          { kind: 'types', codes: ['nds'] },
          null,
          { kind: 'types', codes: ['nds', 'soc'] },
        ]),
      ).toEqual({ kind: 'types', codes: ['nds', 'soc'] });
      expect(
        mergeRedueScopes([
          { kind: 'types', codes: ['nds'] },
          { kind: 'statuses', codes: ['ЛЬГ-30'] },
        ]),
      ).toEqual({ kind: 'calendar' });
      expect(
        mergeRedueScopes([{ kind: 'statuses', codes: ['ЛЬГ-30'] }, { kind: 'calendar' }]),
      ).toEqual({ kind: 'calendar' });
    });

    it('чужая организация не видна: пересчёт в контексте организации меняет только её отчёты', async () => {
      await db.admin.db.update(reportTypes).set({ dueDay: 15 }).where(eq(reportTypes.code, 'nds'));
      try {
        const n = await inOrg(b, (tx) =>
          redueOpenReports(tx, { kind: 'types', codes: ['nds'] }, TODAY, {
            write: true,
            texts: TEXTS,
          }),
        );
        expect(n).toBe(2);
        // 15.11.2026 — воскресенье: срок переносится на понедельник.
        expect((await october(b, cpB)).dueDate).toBe('2026-11-16');
        expect((await october(a, cpA)).dueDate).toBe('2026-11-25');
      } finally {
        await db.admin.db
          .update(reportTypes)
          .set({ dueDay: 25 })
          .where(eq(reportTypes.code, 'nds'));
        await redueAllOrgs(db.app.db, { kind: 'types', codes: ['nds'] }, TODAY, {
          write: true,
          texts: TEXTS,
        });
      }
      // Всё вернулось к сроку по закону: переносов и следов чужой правки нет.
      const [left] = await db.admin.db.execute<{ n: number }>(
        sql`select count(*)::int as n from reports where due_date <> due_base and not due_manual`,
      );
      expect(left?.n).toBe(0);
    });

    it('уточнённый и «Разовый отчёт»: правило вида их срок не меняет, календарь переносит их срок по закону', async () => {
      // «Разовый отчёт» за август со сроком, заданным руками, и уточнённый июльский.
      const [manual, revision] = await inOrg(b, async (tx) => {
        const made = (month: string) =>
          createManualReport(
            tx,
            {
              contractorId: cpB,
              reportTypeCode: 'nds',
              month,
              eventDate: null,
              due: '2026-11-25',
              reasonCode: 'ПРЧ-001',
              reasonName: 'Запрос органа',
            },
            { today: TODAY, scope: undefined },
          );
        const august = await made('2026-08-01');
        const july = await made('2026-07-01');
        await tx.update(reports).set({ status: 'submitted' }).where(eq(reports.id, july.id));
        const next = await createRevision(tx, july.id, {
          version: july.version,
          today: TODAY,
          scope: undefined,
        });
        return [august, next];
      });
      expect([manual.dueBase, manual.dueDate, manual.dueManual]).toEqual([
        '2026-11-25',
        '2026-11-25',
        false,
      ]);
      expect([revision.revision, revision.dueBase, revision.dueDate]).toEqual([
        1,
        '2026-11-25',
        '2026-11-25',
      ]);
      const byId = async (id: string) =>
        (await inOrg(b, (tx) => tx.select().from(reports).where(eq(reports.id, id))))[0]!;

      // Правило срока вида: только отчёты по назначению (октябрь и ноябрь), их срок — не правило.
      await db.admin.db.update(reportTypes).set({ dueDay: 20 }).where(eq(reportTypes.code, 'nds'));
      try {
        const types = { kind: 'types', codes: ['nds'] } as const;
        expect(
          await inOrg(b, (tx) => redueOpenReports(tx, types, TODAY, { write: true, texts: TEXTS })),
        ).toBe(2);
        expect((await byId(manual.id)).dueDate).toBe('2026-11-25');
        expect((await byId(revision.id)).dueDate).toBe('2026-11-25');
      } finally {
        await db.admin.db
          .update(reportTypes)
          .set({ dueDay: 25 })
          .where(eq(reportTypes.code, 'nds'));
        await redueAllOrgs(db.app.db, { kind: 'types', codes: ['nds'] }, TODAY, {
          write: true,
          texts: TEXTS,
        });
      }

      // Календарь: срок по закону переносится на рабочий день у всех, срок оплаты своим правилом — за
      // свой период; срок по закону не меняется.
      expect(await asAdmin((tx) => adminCalendarAdd(tx, HOLIDAY, TODAY))).toEqual({ ok: true });
      try {
        const counted = await inOrg(b, (tx) =>
          redueOpenReports(tx, { kind: 'calendar' }, TODAY, { write: true, texts: TEXTS }),
        );
        // Октябрь по назначению, август вручную и уточнённый июль.
        expect(counted).toBe(3);
        const [m, r] = [await byId(manual.id), await byId(revision.id)];
        expect([m.dueBase, m.dueDate, m.payDue]).toEqual([
          '2026-11-25',
          '2026-11-26',
          '2026-09-25',
        ]);
        expect([r.dueBase, r.dueDate, r.payDue]).toEqual([
          '2026-11-25',
          '2026-11-26',
          '2026-08-25',
        ]);
        const history = await inOrg(b, (tx) => readHistory(tx, 'report', manual.id));
        expect(history.at(-1)).toMatchObject({
          reason: 'Изменён производственный календарь',
          changes: [{ field: 'dueDate', from: '2026-11-25', to: '2026-11-26' }],
        });
      } finally {
        const [day] = await db.admin.db
          .select()
          .from(productionCalendar)
          .where(eq(productionCalendar.day, HOLIDAY.date));
        await asAdmin((tx) => adminCalendarDelete(tx, HOLIDAY.date, day!.version));
        await redueAllOrgs(db.app.db, { kind: 'calendar' }, TODAY, { write: true, texts: TEXTS });
      }
      expect((await byId(manual.id)).dueDate).toBe('2026-11-25');
    });

    it('сдвинулся только срок по закону: сохраняется молча — без счёта и записи в историю', async () => {
      const types = { kind: 'types', codes: ['nds'] } as const;
      const historyOf = async () =>
        inOrg(a, async (tx) => readHistory(tx, 'report', (await october(a, cpA)).id));
      // 28.11.2026 — суббота, 29.11 — воскресенье: оба переносятся на понедельник 30.11.
      try {
        await db.admin.db
          .update(reportTypes)
          .set({ dueDay: 28 })
          .where(eq(reportTypes.code, 'nds'));
        await redueAllOrgs(db.app.db, types, TODAY, { write: true, texts: TEXTS });
        expect(await dues(a, cpA)).toEqual(['2026-11-28', '2026-11-30', '2026-11-25']);
        const before = (await historyOf()).length;
        await db.admin.db
          .update(reportTypes)
          .set({ dueDay: 29 })
          .where(eq(reportTypes.code, 'nds'));
        // Октябрьские отчёты не в счёт; ноябрьские (срок в декабре: 28 → 29, вторник) — в счёт.
        expect(await redueAllOrgs(db.app.db, types, TODAY, { write: true, texts: TEXTS })).toEqual({
          reports: 2,
          orgs: 2,
          failed: [],
          left: 0,
        });
        expect(await dues(a, cpA)).toEqual(['2026-11-29', '2026-11-30', '2026-11-25']);
        expect((await historyOf()).length).toBe(before);
      } finally {
        await db.admin.db
          .update(reportTypes)
          .set({ dueDay: 25 })
          .where(eq(reportTypes.code, 'nds'));
        await redueAllOrgs(db.app.db, types, TODAY, { write: true, texts: TEXTS });
      }
      expect(await dues(a, cpA)).toEqual(['2026-11-25', '2026-11-25', '2026-11-25']);
    });

    it('проход по организациям останавливается к сроку: до остальных не дошло — их число в `left`', async () => {
      const summary = await redueAllOrgs(db.app.db, { kind: 'calendar' }, TODAY, {
        write: true,
        texts: TEXTS,
        until: 0,
      });
      expect(summary).toMatchObject({ reports: 0, orgs: 0, failed: [] });
      expect(summary.left).toBeGreaterThanOrEqual(2);
    });

    it('очередь пересчёта: строка занимается арендой, свободная после неудачи, выполненная — нет', async () => {
      const id = await asAdmin((tx) => enqueueDuesRecalc(tx, { kind: 'types', codes: ['nds'] }));
      const [row] = await db.admin.db.select().from(duesRecalcs).where(eq(duesRecalcs.id, id));
      expect(row).toMatchObject({ kind: 'types', codes: ['nds'], createdBy: adminId, attempts: 0 });

      // Задача по расписанию свежую строку не берёт — её проходят сразу после сохранения.
      expect(
        await claimDuesRecalc(db.app.db, { leaseSeconds: 60, olderThanSeconds: 600 }),
      ).toBeNull();
      const task = await claimDuesRecalc(db.app.db, { id, leaseSeconds: 60 });
      expect(task).toEqual({ id, scope: { kind: 'types', codes: ['nds'] }, attempts: 1 });
      // Занятую не выдать второй раз.
      expect(await claimDuesRecalc(db.app.db, { id, leaseSeconds: 60 })).toBeNull();
      await finishDuesRecalc(db.app.db, id, { done: false, reports: 2, orgs: 1, error: 'Error' });
      const again = await claimDuesRecalc(db.app.db, { leaseSeconds: 60 });
      expect(again).toMatchObject({ id, attempts: 2 });
      await finishDuesRecalc(db.app.db, id, { done: true, reports: 1, orgs: 1, error: null });
      expect(await claimDuesRecalc(db.app.db, { id, leaseSeconds: 60 })).toBeNull();
      const [done] = await db.admin.db.select().from(duesRecalcs).where(eq(duesRecalcs.id, id));
      expect(done).toMatchObject({ reports: 3, orgs: 2, lastError: null, claimedUntil: null });
      expect(done!.doneAt).not.toBeNull();

      // Исчерпавшая попытки строка остаётся в очереди, но не выдаётся.
      const tired = await asAdmin((tx) => enqueueDuesRecalc(tx, { kind: 'calendar' }));
      await db.admin.db
        .update(duesRecalcs)
        .set({ attempts: DUES_RECALC_ATTEMPTS })
        .where(eq(duesRecalcs.id, tired));
      expect(await claimDuesRecalc(db.app.db, { id: tired, leaseSeconds: 60 })).toBeNull();

      // Выполненные старше срока удаляются, невыполненные — нет.
      await db.admin.db
        .update(duesRecalcs)
        .set({ doneAt: sql`now() - interval '31 days'` })
        .where(eq(duesRecalcs.id, id));
      await cleanupDuesRecalcs(db.app.db, 30);
      const left = await db.admin.db.select({ id: duesRecalcs.id }).from(duesRecalcs);
      expect(left).toEqual([{ id: tired }]);
      await db.admin.db.delete(duesRecalcs);
    });

    it('пример переноса на вкладке «Календарь» — из каталога платформы, без данных организаций', async () => {
      const example = await asAdmin((tx) => dueShiftExample(tx, TODAY));
      expect(example).not.toBeNull();
      const { shortName, period, periodStart, dueBase, dueDate } = example!;
      expect(dueDate > dueBase).toBe(true);
      expect(dueDate >= TODAY).toBe(true);
      // Тот же расчёт, что у отчётов: срок вида за этот период по календарю.
      const catalog = await asAdmin((tx) => dueCatalog(tx));
      const type = [...catalog.types.values()].find((x) => x.shortName === shortName)!;
      expect(
        reportDue(
          effectiveRule(type, null, null),
          { period, start: periodStart },
          catalog.calendar,
        ),
      ).toMatchObject({ base: dueBase, due: dueDate });
    });
  },
);
