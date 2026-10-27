import { gkedCheck, gkedCheckTexts, UI_TEXTS, formatText, type ListQuery } from '@buhuchet/domain';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext } from './context';
import { contractorGkedDicts, getContractor, listContractorsPage } from './contractors';
import { readHistory } from './history';
import { contractors, contractorTariffs } from './schema';
import { DEMO_ORG_ID, demoId, seedAll } from './seed';
import { createTestDatabase, databaseAvailable, type TestDatabase } from './testing';

const t = (key: string, params?: Record<string, string | number>) =>
  formatText((UI_TEXTS as Record<string, { ru: string }>)[key]?.ru ?? key, params);

describe.skipIf(!databaseAvailable())('Контрагенты демо-организации из demoDB.json', () => {
  let db: TestDatabase;
  const inDemo = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: DEMO_ORG_ID, userId: demoId('user', 'e1') }, fn);

  const confirmations = () =>
    inDemo((tx) => readHistory(tx, 'contractor', demoId('contractor', '26')));

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAll(db.admin.db, { update: false, demo: true });
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('все контрагенты с кодами справочников, ставками и ответственными', async () => {
    const all = await db.admin.db
      .select()
      .from(contractors)
      .where(eq(contractors.orgId, DEMO_ORG_ID));
    expect(all).toHaveLength(30);

    const first = await inDemo((tx) =>
      getContractor(tx, demoId('contractor', '1'), { scope: undefined, today: '2026-10-27' }),
    );
    expect(first).toMatchObject({
      name: 'ОсОО «Ала-Тоо Трейд»',
      inn: '03744097401851',
      phone: '+996505890076',
      kind: 'regular',
      form: { code: 'ФС-01', name: 'ОсОО' },
      regime: { name: 'ОНР' },
      regime2: null,
      gked: { code: '46.34.0' },
      gkedExtra: [{ code: '47.19.0' }],
      taxOffice: { code: expect.any(String) },
      bizSize: 'medium',
      benefits: [{ name: 'Тариф Соцфонда 12,25 % (СПиНО)', validFrom: null, validTo: null }],
      bases: [{ code: 'employees' }, { code: 'statSample' }],
      responsible: { id: demoId('employee', 'e3') },
      contractNo: '160/24',
      contractDate: '2024-07-16',
      startDate: '2024-07-16',
      firstMonthMode: 'prorate',
      feeDay: 15,
      paysTo: 'emp',
      serviceStatus: 'active',
      tariff: { amount: 2_800_000, period: 'M', validFrom: '2026-01-01' },
    });
    expect(first!.audit.createdAt.toISOString()).toBe('2024-07-16T10:16:00.000Z');

    const noResponsible = all.find((c) => c.id === demoId('contractor', '22'));
    expect(noResponsible?.responsibleEmployeeId).toBeNull();
    expect(all.find((c) => c.id === demoId('contractor', '29'))?.gked).toBeNull();
    expect(all.find((c) => c.id === demoId('contractor', '30'))?.kind).toBe('oneoff');

    // Архивный — только с фильтром «Статус обслуживания».
    const page = await inDemo((tx) =>
      listContractorsPage(tx, { page: 1, size: 'all', filters: {} } as unknown as ListQuery, {
        t,
        today: '2026-10-27',
        fee: true,
        scope: undefined,
        tab: 'all',
        employeeId: demoId('employee', 'e1'),
      }),
    );
    expect(page.total).toBe(29);
  });

  it('подтверждение права на режим у демо-ИП на патенте — как в прототипе (п. 58)', async () => {
    const cp = await inDemo((tx) =>
      getContractor(tx, demoId('contractor', '26'), { scope: undefined, today: '2026-10-27' }),
    );
    expect(cp).toMatchObject({
      serviceStatus: 'archived',
      gkedConfirmation: { employeeId: demoId('employee', 'e4'), at: '2026-10-23', ask: '' },
    });
    const dicts = await inDemo((tx) => contractorGkedDicts(tx, ['96.02.0']));
    const check = gkedCheck(
      {
        gked: '96.02.0',
        gkedExtra: [],
        form: { code: cp!.form.code, declarationFor: cp!.form.declarationFor },
        regimes: [cp!.regime!.code],
        benefits: [],
      },
      dicts,
      {
        sig: cp!.gkedConfirmation!.sig,
        by: cp!.gkedConfirmation!.by,
        at: cp!.gkedConfirmation!.at,
        ask: cp!.gkedConfirmation!.ask,
      },
    );
    expect(gkedCheckTexts(check, t).regime).toEqual([
      'Режим «Патент»: ни один вид деятельности контрагента не входит в перечень для ИП — подтвердил Айгерим С. 23.10.2026',
    ]);
    // В истории контрагента — кто и когда подтвердил (п. 58).
    expect(await confirmations()).toEqual([
      expect.objectContaining({
        action: 'update',
        actorUserId: demoId('user', 'e4'),
        at: new Date('2026-10-23T04:00:00.000Z'),
        changes: [
          expect.objectContaining({
            field: 'gkedConfirmation',
            from: null,
            to: expect.objectContaining({ employeeId: demoId('employee', 'e4'), ask: '' }),
          }),
        ],
      }),
    ]);
  });

  it('повторное наполнение не задваивает контрагентов и ставки', async () => {
    const tariffs = async () =>
      (
        await db.admin.db
          .select()
          .from(contractorTariffs)
          .where(eq(contractorTariffs.orgId, DEMO_ORG_ID))
      ).length;
    const before = await tariffs();
    expect(before).toBe(35);
    await seedAll(db.admin.db, { update: true, demo: true });
    expect(await tariffs()).toBe(before);
    expect(
      (await db.admin.db.select().from(contractors).where(eq(contractors.orgId, DEMO_ORG_ID)))
        .length,
    ).toBe(30);
    expect(await confirmations()).toHaveLength(1);
  });
});
