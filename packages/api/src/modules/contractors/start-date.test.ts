import { hashPassword } from '@buhuchet/adapters/password';
import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { formatText, UI_TEXTS, type UiTextKey } from '@buhuchet/domain';
import { ApiError, ContractorHistory, ContractorSaved, ContractorService } from '@buhuchet/shared';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

// Сегодня в тестах — 18.10.2026 (`createTestDeps`): идущий месяц — октябрь 2026.
describe.skipIf(!databaseAvailable())('Контрагенты: дата начала обслуживания — «Изменить»', () => {
  let f: Fixture;
  let owner: string;
  let acc: string;
  let senior: string;
  let plain: string;
  let narrowCookie: string;
  let ownerB: string;
  let innSeq = 700;

  const employee = (login: string) => f.people[login]!.employeeId;
  const failure = async (res: Response) => {
    expect(res.status, await res.clone().text()).toBe(400);
    return ApiError.parse(await res.json()).error;
  };
  /** Что покажет экран: текст словаря по коду ошибки. */
  const screen = ({ code, details }: { code: string; details?: unknown }) => {
    const { variant, ...params } = (details ?? {}) as Record<string, string | number>;
    const key = (variant ? `err.${code}.${variant}` : `err.${code}`) as UiTextKey;
    return formatText(UI_TEXTS[key].ru, params);
  };
  const row = async (id: string) =>
    (await f.t.admin.db.select().from(schema.contractors).where(eq(schema.contractors.id, id)))[0]!;
  const periods = async (id: string) =>
    (
      await f.t.admin.db
        .select({
          from: schema.contractorServicePeriods.fromMonth,
          to: schema.contractorServicePeriods.toMonth,
        })
        .from(schema.contractorServicePeriods)
        .where(eq(schema.contractorServicePeriods.contractorId, id))
        .orderBy(asc(schema.contractorServicePeriods.fromMonth))
    ).map((p) => `${p.from.slice(0, 7)}…${p.to ? p.to.slice(0, 7) : ''}`);
  /** «Изменить» с версией из базы. */
  const patch = async (cookie: string, id: string, body: Record<string, unknown>) =>
    apiRequest(f.app, 'PATCH', `/api/contractors/${id}`, cookie, {
      version: (await row(id)).version,
      ...body,
    });
  const history = async (cookie: string, id: string) => {
    const res = await apiRequest(f.app, 'GET', `/api/contractors/${id}/history`, cookie);
    expect(res.status, await res.clone().text()).toBe(200);
    return ContractorHistory.parse(await res.json()).items;
  };

  /** Контрагент А (ответственный — acc-a): первый период ставит база с месяца начала. */
  async function contractor(patchRow: Partial<typeof schema.contractors.$inferInsert> = {}) {
    const [created] = await f.t.admin.db
      .insert(schema.contractors)
      .values({
        orgId: f.a.orgId,
        name: `ОсОО «Начало ${innSeq}»`,
        inn: `0374409740${String(innSeq++).padStart(4, '0')}`,
        phone: '+996505890076',
        formCode: 'ФС-01',
        regimeCode: 'РЕЖ-01',
        gked: '46.34.0',
        startDate: '2026-05-15',
        responsibleEmployeeId: employee('acc-a'),
        ...patchRow,
      })
      .returning({ id: schema.contractors.id });
    return created!.id;
  }

  beforeAll(async () => {
    f = await createStaffFixture();
    await seedAllPlatformDictionaries(f.t.admin.db);
    await f.t.admin.db
      .update(schema.orgSettings)
      .set({ features: { fee: true } })
      .where(eq(schema.orgSettings.orgId, f.a.orgId));
    // «Только контрагенты»: создаёт и меняет контрагентов, отчётов и платы не видит.
    const [role] = await f.t.admin.db
      .insert(schema.roles)
      .values({ orgId: f.a.orgId, name: 'Только контрагенты' })
      .returning({ id: schema.roles.id });
    await f.t.admin.db.insert(schema.rolePermissions).values(
      ['cpView', 'createCp', 'viewAll'].map((permissionId) => ({
        orgId: f.a.orgId,
        roleId: role!.id,
        permissionId,
      })),
    );
    const [user] = await f.t.admin.db
      .insert(schema.users)
      .values({
        orgId: f.a.orgId,
        login: 'plain-a',
        passwordHash: await hashPassword(TEST_PASSWORD),
      })
      .returning({ id: schema.users.id });
    await f.t.admin.db.insert(schema.employees).values({
      orgId: f.a.orgId,
      userId: user!.id,
      fullName: 'Сотрудник plain-a',
      shortName: 'plain-a',
      roleId: role!.id,
    });
    // «Чужие отчёты не видит»: контрагенты — все, отчёты — только свои.
    const [narrow] = await f.t.admin.db
      .insert(schema.roles)
      .values({ orgId: f.a.orgId, name: 'Все контрагенты, свои отчёты' })
      .returning({ id: schema.roles.id });
    await f.t.admin.db.insert(schema.rolePermissions).values(
      ['cpView', 'createCp', 'repView'].map((permissionId) => ({
        orgId: f.a.orgId,
        roleId: narrow!.id,
        permissionId,
      })),
    );
    await f.t.admin.db.insert(schema.roleScopes).values([
      { orgId: f.a.orgId, roleId: narrow!.id, permGroup: 'cps', scope: 'all' },
      { orgId: f.a.orgId, roleId: narrow!.id, permGroup: 'reports', scope: 'own' },
    ]);
    const [narrowUser] = await f.t.admin.db
      .insert(schema.users)
      .values({
        orgId: f.a.orgId,
        login: 'narrow-a',
        passwordHash: await hashPassword(TEST_PASSWORD),
      })
      .returning({ id: schema.users.id });
    await f.t.admin.db.insert(schema.employees).values({
      orgId: f.a.orgId,
      userId: narrowUser!.id,
      fullName: 'Сотрудник narrow-a',
      shortName: 'narrow-a',
      roleId: narrow!.id,
    });
    narrowCookie = await signIn(f.app, 'narrow-a', TEST_PASSWORD);
    [owner, acc, senior, plain, ownerB] = await Promise.all([
      signIn(f.app, 'owner-a', TEST_PASSWORD),
      signIn(f.app, 'acc-a', TEST_PASSWORD),
      signIn(f.app, 'senior-a', TEST_PASSWORD),
      signIn(f.app, 'plain-a', TEST_PASSWORD),
      signIn(f.app, 'owner-b', TEST_PASSWORD),
    ]);
    const res = await apiRequest(f.app, 'POST', '/api/org-report-types/connect', owner, {
      connect: ['soc'],
      disconnect: [],
    });
    expect(res.status, await res.clone().text()).toBe(200);
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('новая дата с причиной: дата, начало первого периода и одна запись истории; та же дата — не правка', async () => {
    const id = await contractor();
    expect(await periods(id)).toEqual(['2026-05…']);

    // Та же дата: причина не нужна, в историю ничего не пишется.
    const same = await patch(acc, id, { startDate: '2026-05-15' });
    expect(same.status, await same.clone().text()).toBe(200);
    expect((await row(id)).version).toBe(1);

    const res = await patch(acc, id, {
      startDate: '2026-03-02',
      startReason: ' внесли с ошибкой ',
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(ContractorSaved.parse(await res.json()).startDate).toBe('2026-03-02');
    expect((await row(id)).startDate).toBe('2026-03-02');
    expect(await periods(id)).toEqual(['2026-03…']);
    const [entry] = await history(acc, id);
    expect(entry!.action).toBe('update');
    expect(entry!.changes).toEqual([
      { field: 'startDate', from: '2026-05-15', to: '2026-03-02' },
      { field: 'startReason', to: 'внесли с ошибкой' },
    ]);

    // В том же месяце период не трогается; вместе с другими полями — одна запись.
    const again = await patch(acc, id, {
      startDate: '2026-03-20',
      startReason: 'уточнили',
      head: 'Асанов А.',
    });
    expect(again.status, await again.clone().text()).toBe(200);
    expect(await periods(id)).toEqual(['2026-03…']);
    const [last] = await history(acc, id);
    expect(last!.changes.map((c) => c.field).sort()).toEqual(['head', 'startDate', 'startReason']);
  });

  it('проверки: причина, будущее, год, конец первого периода — отказ у своего поля, ничего не меняется', async () => {
    const id = await contractor();
    const refuse = async (body: Record<string, unknown>) => failure(await patch(acc, id, body));

    let e = await refuse({ startDate: '2026-04-01' });
    expect([e.code, (e.details as { field: string }).field]).toEqual([
      'start_reason',
      'startReason',
    ]);
    expect(screen(e)).toBe('Укажите причину: меняется дата начала');
    e = await refuse({ startDate: '2026-04-01', startReason: '   ' });
    expect(e.code).toBe('start_reason');

    e = await refuse({ startDate: '2026-10-19', startReason: 'ошибка' });
    expect([e.code, (e.details as { field: string }).field]).toEqual(['start_future', 'startDate']);
    expect(e.message).toBe('Дата не может быть позже сегодняшней');
    e = await refuse({ startDate: '1999-12-31', startReason: 'ошибка' });
    expect(e.code).toBe('start_year');
    expect(e.message).toBe('Проверьте год');
    e = await refuse({ startDate: 'вчера', startReason: 'ошибка' });
    expect(e.code).toBe('validation_failed');
    e = await refuse({ startDate: '2026-04-01', startReason: 'я'.repeat(301) });
    expect(e.code).toBe('validation_failed');

    // Первый период закончился в июле: позже июля начало не поставить, в июле — можно.
    await f.t.admin.db
      .update(schema.contractorServicePeriods)
      .set({ toMonth: '2026-07-01' })
      .where(eq(schema.contractorServicePeriods.contractorId, id));
    await f.t.admin.db
      .update(schema.contractors)
      .set({ serviceStatus: 'paused' })
      .where(eq(schema.contractors.id, id));
    e = await refuse({ startDate: '2026-08-01', startReason: 'ошибка' });
    expect(e.code).toBe('start_period');
    expect(e.message).toBe(
      'Первый период обслуживания закончился в июль 2026: дата начала должна быть не позже',
    );
    expect(screen(e)).toBe(e.message);
    expect((await row(id)).startDate).toBe('2026-05-15');
    expect((await row(id)).version).toBe(1);

    const ok = await patch(acc, id, { startDate: '2026-07-31', startReason: 'ошибка' });
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(await periods(id)).toEqual(['2026-07…2026-07']);
    expect((await row(id)).serviceStatus).toBe('paused');
  });

  it('оплата обслуживания и сданный отчёт: позже них дату не поставить; кто их не видит — получает только срок', async () => {
    const id = await contractor({ startDate: '2026-01-15' });
    // Оплаты обслуживания: удалённая за февраль не мешает, действующая — за июнь.
    for (const [month, deleted] of [
      ['2026-02-01', true],
      ['2026-06-01', false],
    ] as const) {
      const [pay] = await f.t.admin.db
        .insert(schema.feePayments)
        .values({
          orgId: f.a.orgId,
          contractorId: id,
          amount: 100_000,
          paidOn: '2026-07-01',
          toKind: 'owner',
          ...(deleted
            ? { deletedAt: new Date(), deletedBy: f.a.ownerUserId, deleteReason: 'ошибка' }
            : {}),
        })
        .returning({ id: schema.feePayments.id });
      await f.t.admin.db
        .insert(schema.feeAllocations)
        .values({ orgId: f.a.orgId, paymentId: pay!.id, month, amount: 100_000 });
    }
    const body = { startDate: '2026-07-01', startReason: 'ошибка' };

    // Владелец видит плату — ему называют месяц оплаты.
    let e = await failure(await patch(owner, id, body));
    expect([e.code, (e.details as { field: string }).field]).toEqual(['start_paid', 'startDate']);
    expect(e.message).toBe(
      'Есть оплата обслуживания за июнь 2026: дата начала должна быть не позже этого месяца',
    );
    expect(screen(e)).toBe(e.message);
    // Бухгалтер платы не видит — ему только до какого месяца можно.
    e = await failure(await patch(acc, id, body));
    expect([e.code, (e.details as { field: string }).field]).toEqual(['start_limit', 'startDate']);
    expect(e.message).toBe('Дата начала должна быть не позже месяца: июнь 2026');
    expect(screen(e)).toBe(e.message);
    expect(JSON.stringify(e)).not.toMatch(/оплат|paid/);

    // В месяце оплаты — можно.
    let ok = await patch(acc, id, { startDate: '2026-06-30', startReason: 'ошибка' });
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(await periods(id)).toEqual(['2026-06…']);

    // Соцфонд с марта, прошлые периоды отмечены сданными: самый ранний сдан в срок за март.
    const other = await contractor({ startDate: '2026-01-15' });
    const asg = await apiRequest(f.app, 'POST', '/api/assignments', owner, {
      contractorId: other,
      reportTypeCode: 'soc',
      fromMonth: '2026-03-01',
      markPast: true,
    });
    expect(asg.status, await asg.clone().text()).toBe(201);
    const [first] = await f.t.admin.db
      .select({ on: schema.reports.submittedOn })
      .from(schema.reports)
      .where(eq(schema.reports.contractorId, other))
      .orderBy(asc(schema.reports.submittedOn))
      .limit(1);
    const on = first!.on!;
    const dateRu = `${on.slice(8, 10)}.${on.slice(5, 7)}.${on.slice(0, 4)}`;
    const later = { startDate: '2026-09-01', startReason: 'ошибка' };
    e = await failure(await patch(acc, other, later));
    expect([e.code, (e.details as { field: string }).field]).toEqual(['start_report', 'startDate']);
    expect(e.message).toBe(
      `Отчёт «Соцфонд 03.2026» сдан ${dateRu}: дата начала должна быть не позже`,
    );
    expect(screen(e)).toBe(e.message);
    // Без права «Просматривать отчёты» — без названия отчёта.
    e = await failure(await patch(plain, other, later));
    expect([e.code, (e.details as { field: string }).field]).toEqual(['start_limit', 'startDate']);
    expect(e.message).toBe(`Дата начала должна быть не позже ${dateRu}`);
    expect(screen(e)).toBe(e.message);
    expect(JSON.stringify(e)).not.toMatch(/Соцфонд|report/);
    // С правом, но чужой отчёт вне области «Свои» отчётов — тоже без названия.
    e = await failure(await patch(narrowCookie, other, later));
    expect(e.code).toBe('start_limit');
    expect(JSON.stringify(e)).not.toMatch(/Соцфонд|report/);
    // В день сдачи — можно: отчёты и оплаты не меняются.
    ok = await patch(plain, other, { startDate: on, startReason: 'ошибка' });
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect((await row(other)).startDate).toBe(on);
  });

  it('начало было в будущем, стало в прошлом — «Обслуживается» сразу, с записью в «Истории статусов»', async () => {
    const id = await contractor({ startDate: '2026-12-01', serviceStatus: 'paused' });
    expect(await periods(id)).toEqual(['2026-12…']);
    const res = await patch(owner, id, { startDate: '2026-10-01', startReason: 'начали раньше' });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await periods(id)).toEqual(['2026-10…']);
    const svc = await apiRequest(f.app, 'GET', `/api/contractors/${id}/service`, owner);
    const service = ContractorService.parse(await svc.json());
    expect(service.status).toBe('active');
    expect(service.statusHistory.at(-1)).toMatchObject({ from: 'paused', to: 'active' });
    // Ответ сохранения — уже с новой версией: следующая правка проходит.
    const saved = ContractorSaved.parse(await res.json());
    expect(saved.version).toBe((await row(id)).version);
  });

  it('разовый контрагент: дата первого обращения меняется, периодов нет', async () => {
    const id = await contractor({ kind: 'oneoff' });
    expect(await periods(id)).toEqual([]);
    const res = await patch(acc, id, { startDate: '2026-04-10', startReason: 'ошибка' });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await row(id)).startDate).toBe('2026-04-10');
    expect(await periods(id)).toEqual([]);
    // История помнит, что дата звалась «Дата первого обращения».
    const [entry] = await history(acc, id);
    expect(entry!.changes).toEqual([
      { field: 'startDate', from: '2026-05-15', to: '2026-04-10' },
      { field: 'startReason', to: 'ошибка' },
      { field: 'startKind', to: 'oneoff' },
    ]);
  });

  it('права и область: без «Создавать и изменять» — 403, чужой и вне области — 404, архивный — 409, устаревшая версия — 409', async () => {
    const id = await contractor();
    const body = { startDate: '2026-04-01', startReason: 'ошибка' };
    expect((await patch(senior, id, body)).status).toBe(403);
    expect((await patch(ownerB, id, body)).status).toBe(404);
    expect(
      (await apiRequest(f.app, 'PATCH', `/api/contractors/${id}`, '', { version: 1, ...body }))
        .status,
    ).toBe(401);
    // Вне области «Свои»: контрагент главного бухгалтера бухгалтеру не виден.
    const foreign = await contractor({ responsibleEmployeeId: employee('chief-a') });
    expect((await patch(acc, foreign, body)).status).toBe(404);
    const stale = await apiRequest(f.app, 'PATCH', `/api/contractors/${id}`, acc, {
      version: 99,
      ...body,
    });
    expect(stale.status).toBe(409);
    await f.t.admin.db
      .update(schema.contractors)
      .set({ serviceStatus: 'archived' })
      .where(eq(schema.contractors.id, id));
    expect((await patch(owner, id, body)).status).toBe(409);
    expect((await row(id)).startDate).toBe('2026-05-15');
    expect(await periods(id)).toEqual(['2026-05…']);
  });
});
