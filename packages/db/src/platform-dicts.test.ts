import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  listAuthorities,
  listReportBases,
  listReportTypes,
  listTaxBenefits,
  listTaxOffices,
  listTaxRegimes,
  productionCalendarEntries,
} from './platform-dicts';
import {
  authorities,
  productionCalendar,
  reportBases,
  reportTypeBases,
  reportTypeRegimes,
  reportTypes,
  taxBenefitDueRules,
  taxBenefitOffices,
  taxBenefitReportTypes,
  taxBenefits,
  taxOffices,
  taxRegimes,
  users,
} from './schema';
import { platformDictRows, seedPlatformDicts } from './seed';
import { readSpecJson } from './spec-data';
import { createTestDatabase, databaseAvailable, type TestDatabase } from './testing';

/** Нет права на действие с таблицей (у drizzle ошибка базы — в cause). */
const permissionDenied = expect.objectContaining({
  cause: expect.objectContaining({ code: '42501' }),
});
const fkViolation = expect.objectContaining({
  cause: expect.objectContaining({ code: '23503' }),
});
const violates = (constraint: string) =>
  expect.objectContaining({ cause: expect.objectContaining({ constraint_name: constraint }) });

type Item = Record<string, unknown> & { active: boolean };
interface RefDB {
  dictionaries: Record<'organs' | 'regimes' | 'bases' | 'ugns' | 'benefits', { items: Item[] }>;
  reportTypes: Item[];
  holidays: Record<string, string>;
  workingSaturdays: string[];
}

const clone = <T>(value: T): T => structuredClone(value);
const without = (item: Record<string, unknown>, keys: string[]) =>
  Object.fromEntries(Object.entries(item).filter(([k]) => !keys.includes(k)));
const AUDIT = ['_cb', '_ca', '_ub', '_ua'];

describe('справочники платформы из refDB.json: проверка ссылок до записи', () => {
  let ref: RefDB;

  beforeAll(async () => {
    ref = await readSpecJson<RefDB>('data/refDB.json');
  });

  it('строк столько же, сколько записей в refDB.json; праздники и рабочие субботы — в календаре', () => {
    const rows = platformDictRows(ref);
    expect(rows.authorities).toHaveLength(ref.dictionaries.organs.items.length);
    expect(rows.taxRegimes).toHaveLength(ref.dictionaries.regimes.items.length);
    expect(rows.reportBases).toHaveLength(ref.dictionaries.bases.items.length);
    expect(rows.taxOffices).toHaveLength(ref.dictionaries.ugns.items.length);
    expect(rows.taxBenefits).toHaveLength(ref.dictionaries.benefits.items.length);
    expect(rows.reportTypes).toHaveLength(ref.reportTypes.length);
    expect(rows.productionCalendar).toHaveLength(
      Object.keys(ref.holidays).length + ref.workingSaturdays.length,
    );
  });

  it('неизвестный орган, режим, основание или вид отчёта останавливает наполнение с местом ошибки', () => {
    const organ = clone(ref);
    organ.reportTypes[0]!.organ = 'Нет такого';
    expect(() => platformDictRows(organ)).toThrow(/reportTypes\.nds\.organ — «Нет такого»/);
    const regime = clone(ref);
    regime.reportTypes[0]!.regimes = ['Нет такого'];
    expect(() => platformDictRows(regime)).toThrow(/reportTypes\.nds\.regimes/);
    const basis = clone(ref);
    basis.reportTypes[0]!.basis = ['nobasis'];
    expect(() => platformDictRows(basis)).toThrow(/reportTypes\.nds\.basis/);
    const adds = clone(ref);
    adds.dictionaries.benefits.items[0]!.adds = ['notype'];
    expect(() => platformDictRows(adds)).toThrow(/benefits\.ЛЬГ-01\.adds/);
    const office = clone(ref);
    const status = office.dictionaries.benefits.items.find((b) => b.code === 'ЛЬГ-30')!;
    (status.suggest as { ugns: string[] }).ugns = ['ugns-none'];
    expect(() => platformDictRows(office)).toThrow(/ЛЬГ-30\.suggest\.ugns/);
  });

  it('повторный код и неизвестное поле тоже останавливают: данные не теряются молча', () => {
    const twice = clone(ref);
    twice.reportTypes.push(clone(twice.reportTypes[0]!));
    expect(() => platformDictRows(twice)).toThrow(/reportTypes — код «nds» повторяется/);
    const field = clone(ref);
    field.dictionaries.regimes.items[0]!.newField = 'x';
    expect(() => platformDictRows(field)).toThrow(/newField/);
    const calendar = clone(ref);
    calendar.workingSaturdays.push('2026-03-13');
    expect(() => platformDictRows(calendar)).toThrow(/рабочая суббота — не суббота/);
  });
});

describe.skipIf(!databaseAvailable())('справочники платформы в своих таблицах', () => {
  let t: TestDatabase;
  let ref: RefDB;

  beforeAll(async () => {
    t = await createTestDatabase();
    ref = await readSpecJson<RefDB>('data/refDB.json');
  });

  afterAll(async () => {
    await t?.drop();
  });

  it('после наполнения записей в каждой таблице столько же, сколько в refDB.json', async () => {
    const report = await seedPlatformDicts(t.admin.db, ref, { update: false });
    const d = ref.dictionaries;
    const expected = {
      authorities: d.organs.items.length,
      taxRegimes: d.regimes.items.length,
      reportBases: d.bases.items.length,
      taxOffices: d.ugns.items.length,
      reportTypes: ref.reportTypes.length,
      taxBenefits: d.benefits.items.length,
      productionCalendar: Object.keys(ref.holidays).length + ref.workingSaturdays.length,
    };
    for (const [table, n] of Object.entries(expected))
      expect(report[table as keyof typeof report], table).toEqual({
        inserted: n,
        updated: 0,
        unchanged: 0,
      });
    const db = t.app.db;
    expect(await db.$count(authorities)).toBe(expected.authorities);
    expect(await db.$count(taxRegimes)).toBe(expected.taxRegimes);
    expect(await db.$count(reportBases)).toBe(expected.reportBases);
    expect(await db.$count(taxOffices)).toBe(expected.taxOffices);
    expect(await db.$count(reportTypes)).toBe(expected.reportTypes);
    expect(await db.$count(taxBenefits)).toBe(expected.taxBenefits);
    expect(await db.$count(productionCalendar)).toBe(expected.productionCalendar);
    // Связи — столько же, сколько ссылок в refDB.json.
    const count = (f: (x: Item) => unknown[]) =>
      ref.reportTypes.reduce((n, x) => n + f(x).length, 0);
    expect(await db.$count(reportTypeRegimes)).toBe(
      count((x) => [...(x.regimes as string[]), ...((x.regimesNot as string[]) ?? [])]),
    );
    expect(await db.$count(reportTypeBases)).toBe(count((x) => x.basis as string[]));
    expect(await db.$count(taxBenefitReportTypes)).toBe(
      d.benefits.items.reduce(
        (n, b) => n + (b.adds as string[]).length + (b.removes as string[]).length,
        0,
      ),
    );
    expect(await db.$count(taxBenefitOffices)).toBe(1);
    expect(await db.$count(taxBenefitDueRules)).toBe(1);
  });

  it('отключённое значение не приходит в списке для новых записей, со всеми — приходит с отметкой', async () => {
    const d = ref.dictionaries;
    const cases = [
      [listTaxRegimes, d.regimes.items, 'code'],
      [listReportBases, d.bases.items, 'code'],
      [listTaxOffices, d.ugns.items, 'id'],
      [listAuthorities, d.organs.items, 'code'],
      [listTaxBenefits, d.benefits.items, 'code'],
      [listReportTypes, ref.reportTypes, 'id'],
    ] as const;
    for (const [list, items, key] of cases) {
      const active = await list(t.app.db);
      const all = await list(t.app.db, { all: true });
      // Порядок — порядок справочника.
      expect(all.map((x) => x.code)).toEqual(items.map((x) => x[key]));
      expect(active.map((x) => x.code)).toEqual(items.filter((x) => x.active).map((x) => x[key]));
      expect(active.every((x) => x.active)).toBe(true);
    }
    // В refDB.json есть отключённые: режим, основание «Есть транспорт», УГНС, виды отчётов.
    expect((await listTaxRegimes(t.app.db, { all: true })).some((r) => !r.active)).toBe(true);
    const bases = await listReportBases(t.app.db);
    expect(bases.map((b) => b.code)).not.toContain('transport');
    const types = await listReportTypes(t.app.db);
    expect(types.map((x) => x.code)).not.toContain('t1q');
    expect(
      (await listReportTypes(t.app.db, { all: true })).find((x) => x.code === 't1q'),
    ).toMatchObject({ active: false });
  });

  it('вид отчёта в базе — те же значения, что в refDB.json (ссылки — кодами)', async () => {
    const organs = new Map(ref.dictionaries.organs.items.map((o) => [o.code, o.name]));
    const regimes = new Map(ref.dictionaries.regimes.items.map((r) => [r.code, r.name]));
    const all = new Map((await listReportTypes(t.app.db, { all: true })).map((x) => [x.code, x]));
    for (const src of ref.reportTypes) {
      const r = all.get(src.id as string)!;
      // Обратно в вид прототипа: те же поля, кроме служебных отметок, производных от «Что нужно
      // сделать» (sum, payOnly) и не используемых прототипом (range, rate).
      const back: Record<string, unknown> = {
        id: r.code,
        name: r.name,
        short: r.shortName,
        code: r.formCode,
        organ: organs.get(r.authorityCode),
        per: r.period,
        day: r.dueDay,
        ...(r.dueAfter !== null && { after: r.dueAfter }),
        ...(r.dueMonth !== null && { ym: r.dueMonth }),
        ...(r.dueFrom === 'start' && { from: 'start' }),
        ...(r.payDay !== null && {
          pay: { day: r.payDay, after: r.payAfter, ...(r.payMonth !== null && { ym: r.payMonth }) },
        }),
        ...(r.paySchedule && { inst: r.paySchedule }),
        shift: r.shiftToWorkday,
        ...(r.skipQuarters.length && { skipQ: r.skipQuarters }),
        ...(r.oneOff && { oneOff: true }),
        ...(r.eventLabel && { evLabel: r.eventLabel }),
        ...(r.periodPerAssignment && { perAssign: true }),
        act: r.act,
        pays: r.payments.map((p) => ({ n: p.name, to: organs.get(p.authority), kbk: p.kbk })),
        kind: r.kind,
        who: r.payer,
        regimes: r.regimes.map((c) => regimes.get(c)).sort(),
        ...(r.notForRegimes.length && {
          regimesNot: r.notForRegimes.map((c) => regimes.get(c)).sort(),
        }),
        ...(r.notForEnRates.length && { enRatesNot: r.notForEnRates }),
        basis: [...r.bases].sort(),
        ...(r.bizSizes.length && { bizSize: r.bizSizes }),
        group: r.pickGroup,
        preselect: r.preselect,
        ...(r.choiceNote && { choice: r.choiceNote }),
        ...(r.pickHint && { extra: r.pickHint }),
        rates: r.rates,
        ...(r.rateAdditions.length && { rateAdd: r.rateAdditions }),
        desc: r.description,
        clientNote: r.clientNote,
        art: r.article,
        ...(r.note && { note: r.note }),
        ...(r.source && { source: r.source }),
        ...(r.statIndex && { index: r.statIndex }),
        ...(r.respondents && { respondents: r.respondents }),
        verify: r.verify,
        ...(src.verifyNote !== undefined && { verifyNote: r.verifyNote }),
        ...(src.gnsAt !== undefined && { gnsAt: r.gnsCheckedAt ?? '', gnsBy: r.gnsCheckedBy }),
        ...(r.gked && { gked: r.gked }),
        active: r.active,
      };
      const want = without(src, [...AUDIT, 'sum', 'payOnly', 'range', 'rate']);
      want.regimes = [...(want.regimes as string[])].sort();
      if (want.regimesNot) want.regimesNot = [...(want.regimesNot as string[])].sort();
      want.basis = [...(want.basis as string[])].sort();
      expect(back, src.id as string).toEqual(want);
    }
  });

  it('льготы и статусы, основания, УГНС и календарь — те же значения, что в refDB.json', async () => {
    const benefits = new Map(
      (await listTaxBenefits(t.app.db, { all: true })).map((b) => [b.code, b]),
    );
    for (const src of ref.dictionaries.benefits.items) {
      const b = benefits.get(src.code as string)!;
      expect(b, src.code as string).toMatchObject({
        name: src.name,
        kind: src.kind ?? 'benefit',
        gives: src.gives,
        payer: src.who,
        validUntil: src.until || null,
        verify: src.verify,
        gkedMainOnly: src.gkedMain ?? false,
        taxCode: src.tax ?? '',
        gked: src.gked ?? null,
        active: src.active,
      });
      expect([...b.adds].sort()).toEqual([...(src.adds as string[])].sort());
      expect([...b.removes].sort()).toEqual([...(src.removes as string[])].sort());
    }
    // «Крупный налогоплательщик»: ставится сам по УГНС, НДС — до последнего дня, уплата — до 25-го.
    expect(benefits.get('ЛЬГ-30')).toMatchObject({
      kind: 'status',
      taxOffices: ['ugns-large'],
      dueRules: [
        { reportType: 'nds', dueDay: 31, dueAfter: 1, dueMonth: null, payDay: 25, payAfter: 1 },
      ],
    });
    expect(benefits.get('ЛЬГ-30')!.suggest).not.toHaveProperty('ugns');
    expect(benefits.get('ЛЬГ-29')!.suggest).toMatchObject({ basis: 'employees', preselect: true });

    const offices = await listTaxOffices(t.app.db, { all: true });
    expect(offices.find((o) => o.code === 'ugns-large')).toMatchObject({ gnsCode: null });
    expect(offices.filter((o) => o.gnsCode).length).toBe(
      ref.dictionaries.ugns.items.filter((u) => u.code).length,
    );
    const bases = await listReportBases(t.app.db, { all: true });
    expect(bases.find((b) => b.code === 'employees')?.reportTypes).toContain('soc');

    const calendar = await productionCalendarEntries(t.app.db);
    expect(calendar).toContainEqual({ day: '01-01', kind: 'holiday', name: 'Новый год' });
    expect(calendar).toContainEqual({
      day: '2026-03-09',
      kind: 'transfer',
      name: 'Перенос: 8 марта',
    });
    expect(calendar).toContainEqual({ day: '2026-03-14', kind: 'workday', name: '' });
  });

  it('повторное наполнение ничего не меняет; без --update изменённое не трогает, новое добавляет со связями', async () => {
    const again = await seedPlatformDicts(t.admin.db, ref, { update: true });
    expect(Object.values(again).every((r) => r.inserted === 0 && r.updated === 0)).toBe(true);

    const changed = clone(ref);
    const nds = changed.reportTypes.find((x) => x.id === 'nds')!;
    nds.name = 'НДС (новое название)';
    nds.regimes = ['ОНР', 'Единый налог'];
    changed.reportTypes.push({ ...clone(nds), id: 'nds2', name: 'НДС 2', regimes: ['ОНР'] });
    changed.holidays['2027-01-02'] = 'Пример';

    const quiet = await seedPlatformDicts(t.admin.db, changed, { update: false });
    expect(quiet.reportTypes).toEqual({
      inserted: 1,
      updated: 0,
      unchanged: ref.reportTypes.length,
    });
    expect(quiet.productionCalendar.inserted).toBe(1);
    const [before] = await t.app.db.select().from(reportTypes).where(eq(reportTypes.code, 'nds'));
    expect(before).toMatchObject({ name: 'НДС', version: 1 });
    const types = await listReportTypes(t.app.db, { all: true });
    expect(types.find((x) => x.code === 'nds')!.regimes).toEqual(['РЕЖ-01']);
    expect(types.find((x) => x.code === 'nds2')!.regimes).toEqual(['РЕЖ-01']);

    const loud = await seedPlatformDicts(t.admin.db, changed, { update: true });
    expect(loud.reportTypes).toMatchObject({ inserted: 0, updated: 1 });
    const [after] = await t.app.db.select().from(reportTypes).where(eq(reportTypes.code, 'nds'));
    expect(after).toMatchObject({ name: 'НДС (новое название)', version: 2 });
    const regimes = (await listReportTypes(t.app.db, { all: true })).find((x) => x.code === 'nds')!;
    expect(regimes.regimes).toEqual(['РЕЖ-01', 'РЕЖ-03']);

    // Запись, которой больше нет в refDB.json, не удаляется — значение справочника только отключают.
    await seedPlatformDicts(t.admin.db, ref, { update: true });
    expect(await t.app.db.$count(reportTypes, eq(reportTypes.code, 'nds2'))).toBe(1);
    const [restored] = await t.app.db.select().from(reportTypes).where(eq(reportTypes.code, 'nds'));
    expect(restored).toMatchObject({ name: 'НДС', version: 3 });
  });

  it('--update не затирает значение, поправленное в Админке, и его связи', async () => {
    const [admin] = await t.admin.db
      .insert(users)
      .values({ login: 'dict-admin', passwordHash: 'x', isPlatformAdmin: true })
      .returning({ id: users.id });
    // Правка Админки (поток Д): название и связь с режимами, в записи — кто поправил.
    await t.admin.db
      .update(reportTypes)
      .set({ name: 'НДС (правка Админки)', updatedBy: admin!.id })
      .where(eq(reportTypes.code, 'nds'));
    await t.admin.db
      .insert(reportTypeRegimes)
      .values({ reportTypeCode: 'nds', regimeCode: 'РЕЖ-03', relation: 'applies' });
    await t.admin.db
      .update(productionCalendar)
      .set({ name: 'Новый год (правка)', updatedBy: admin!.id })
      .where(eq(productionCalendar.day, '01-01'));

    const report = await seedPlatformDicts(t.admin.db, ref, { update: true });
    expect(report.reportTypes.updated).toBe(0);
    expect(report.productionCalendar.updated).toBe(0);
    const nds = (await listReportTypes(t.app.db, { all: true })).find((x) => x.code === 'nds')!;
    expect(nds).toMatchObject({ name: 'НДС (правка Админки)', regimes: ['РЕЖ-01', 'РЕЖ-03'] });
    const calendar = await productionCalendarEntries(t.app.db);
    expect(calendar).toContainEqual({ day: '01-01', kind: 'holiday', name: 'Новый год (правка)' });

    // Значение снова «из наполнения» — --update приводит его к refDB.json.
    await t.admin.db
      .update(reportTypes)
      .set({ updatedBy: null })
      .where(eq(reportTypes.code, 'nds'));
    await t.admin.db
      .update(productionCalendar)
      .set({ updatedBy: null })
      .where(eq(productionCalendar.day, '01-01'));
    await seedPlatformDicts(t.admin.db, ref, { update: true });
    const back = (await listReportTypes(t.app.db, { all: true })).find((x) => x.code === 'nds')!;
    expect(back).toMatchObject({ name: 'НДС', regimes: ['РЕЖ-01'] });
    expect(await productionCalendarEntries(t.app.db)).toContainEqual({
      day: '01-01',
      kind: 'holiday',
      name: 'Новый год',
    });
  });

  it('приложение только читает справочники; используемое значение удалить нельзя', async () => {
    const app = t.app.db;
    expect((await app.select().from(reportTypes)).length).toBeGreaterThan(100);
    await expect(app.update(reportTypes).set({ name: 'Взлом' })).rejects.toThrow(permissionDenied);
    await expect(app.delete(productionCalendar)).rejects.toThrow(permissionDenied);
    await expect(
      app.insert(taxRegimes).values({
        code: 'X',
        name: 'X',
        fullName: 'X',
        kind: 'special',
        sortOrder: 99,
      }),
    ).rejects.toThrow(permissionDenied);
    await expect(app.delete(reportTypeRegimes)).rejects.toThrow(permissionDenied);
    // Режим, орган и основание, на которые ссылаются виды отчётов, не удаляются (внешние ключи).
    await expect(
      t.admin.db.delete(taxRegimes).where(eq(taxRegimes.code, 'РЕЖ-01')),
    ).rejects.toThrow(fkViolation);
    await expect(
      t.admin.db.delete(authorities).where(eq(authorities.code, 'ОРГ-01')),
    ).rejects.toThrow(fkViolation);
    await expect(
      t.admin.db.delete(reportBases).where(eq(reportBases.code, 'employees')),
    ).rejects.toThrow(fkViolation);
    await expect(
      t.admin.db.delete(taxOffices).where(eq(taxOffices.code, 'ugns-large')),
    ).rejects.toThrow(fkViolation);
    // Ограничения значений: неизвестная периодичность и рабочая суббота «каждый год» не сохраняются.
    await expect(
      t.admin.db.execute(sql`update report_types set period = 'W' where code = 'nds'`),
    ).rejects.toThrow(violates('report_types_period_check'));
    await expect(
      t.admin.db.insert(productionCalendar).values({ day: '03-14', kind: 'workday' }),
    ).rejects.toThrow(violates('production_calendar_day_check'));
  });
});
