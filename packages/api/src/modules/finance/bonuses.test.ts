import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import {
  ApiError,
  BonusBalanceList,
  BonusEmployee,
  BonusLogList,
  BonusOutSaved,
  BonusSummary,
  EmployeeAccount,
  ServiceCard,
  ServiceForm,
  ServiceSaved,
} from '@buhuchet/shared';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

/** Сомы в тыйынах. */
const som = (n: number) => n * 100;
const ALL_ON = { files: true, taxpay: true, accounts: true, finops: true, fee: true };
const MISSING = '00000000-0000-4000-8000-0000000000ff';
/** Суммы в текстах — с неразрывными пробелами; в сравнении — обычные. */
const plain = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');

// Прототип v84 и v87 (modules/services.js: serviceDlg, bonusLog, bonusSum, bonusOutDlg, bonusUndo;
// modules/staff.js: вкладка «Бонусы»), docs/deviations.md п. О-75. Сегодня в тестах — 18.10.2026.
describe.skipIf(!databaseAvailable())(
  'Бонусы сотрудников: бонус за разовую услугу после её полной оплаты, остатки, журнал, списание',
  () => {
    let f: Fixture;
    let owner: string;
    let chief: string;
    let acc: string;
    let hr: string;
    let senior: string;
    let ownerB: string;
    let cpA = '';
    let service = '';

    const employee = (login: string) => f.people[login]!.employeeId;
    const call = (method: 'GET' | 'POST' | 'PUT', path: string, cookie: string, body?: unknown) =>
      apiRequest(f.app, method, path, cookie, body);
    const failure = async (res: Response) => ApiError.parse(await res.json()).error;
    const expectStatus = async (res: Response, status: number) => {
      expect(res.status, await res.clone().text()).toBe(status);
      return res;
    };
    const get = async <T>(cookie: string, path: string, parse: (x: unknown) => T) =>
      parse(await (await expectStatus(await call('GET', path, cookie), 200)).json());
    const refused = async (res: Response, status: number) =>
      (await failure(await expectStatus(res, status))).code;
    const card = (cookie: string, id: string) =>
      get(cookie, `/api/one-off-services/${id}`, (x) => ServiceCard.parse(x));
    const summary = (cookie: string) =>
      get(cookie, '/api/bonuses/summary', (x) => BonusSummary.parse(x));
    const balances = async (cookie: string) =>
      (await get(cookie, '/api/bonuses/balances?size=all', (x) => BonusBalanceList.parse(x))).items;
    const log = async (cookie: string, query = '') =>
      (await get(cookie, `/api/bonuses/log?size=all${query}`, (x) => BonusLogList.parse(x))).items;
    const balanceOf = async (login: string) =>
      (await balances(owner)).find((r) => r.id === employee(login))!;
    const serviceBody = (body: Record<string, unknown>) => ({
      contractorId: cpA,
      name: 'Восстановление учёта',
      date: '2026-10-10',
      amount: som(5000),
      performerId: null,
      ...body,
    });
    const create = async (cookie: string, body: Record<string, unknown>) =>
      ServiceSaved.parse(
        await (
          await expectStatus(
            await call('POST', '/api/one-off-services', cookie, serviceBody(body)),
            201,
          )
        ).json(),
      ).id;
    const edit = async (cookie: string, id: string, body: Record<string, unknown>) => {
      const now = await card(owner, id);
      return call('PUT', `/api/one-off-services/${id}`, cookie, {
        version: now.version,
        name: now.name,
        date: now.date,
        amount: now.amount,
        performerId: now.performer?.id ?? null,
        description: now.description,
        reason: '',
        ...body,
      });
    };
    const pay = (id: string, amount: number, date = '2026-10-17') =>
      call('POST', `/api/one-off-services/${id}/payments`, owner, { amount, date });
    const writeOff = (cookie: string, login: string, body: Record<string, unknown>) =>
      call('POST', `/api/bonuses/employees/${employee(login)}/writeoffs`, cookie, {
        amount: som(200),
        date: '2026-10-18',
        note: 'Выдано с зарплатой',
        ...body,
      });
    const undo = (cookie: string, w: { id: string; version: number }) =>
      call('POST', `/api/bonus-writeoffs/${w.id}/undo`, cookie, { version: w.version });
    const line = (login: string, amount: number) => ({ employeeId: employee(login), amount });

    beforeAll(async () => {
      f = await createStaffFixture();
      await seedAllPlatformDictionaries(f.t.admin.db);
      for (const orgId of [f.a.orgId, f.b.orgId])
        await f.t.admin.db
          .update(schema.orgSettings)
          .set({ features: ALL_ON, reportConfirm: false })
          .where(eq(schema.orgSettings.orgId, orgId));
      // «Кадры» (область «Свои») ведёт разовые услуги своих контрагентов; права на бонусы у неё нет.
      await f.t.admin.db.insert(schema.rolePermissions).values({
        orgId: f.a.orgId,
        roleId: f.roleIds.hr,
        permissionId: 'projects',
      });
      [owner, chief, acc, hr, senior, ownerB] = await Promise.all([
        signIn(f.app, 'owner-a', TEST_PASSWORD),
        signIn(f.app, 'chief-a', TEST_PASSWORD),
        signIn(f.app, 'acc-a', TEST_PASSWORD),
        signIn(f.app, 'hr-a', TEST_PASSWORD),
        signIn(f.app, 'senior-a', TEST_PASSWORD),
        signIn(f.app, 'owner-b', TEST_PASSWORD),
      ]);
      const [row] = await f.t.admin.db
        .insert(schema.contractors)
        .values({
          orgId: f.a.orgId,
          name: 'ОсОО «Ала-Тоо Трейд»',
          inn: '03744097401851',
          phone: '+996505890076',
          formCode: 'ФС-01',
          regimeCode: 'РЕЖ-01',
          startDate: '2026-07-01',
          feeDay: 15,
          responsibleEmployeeId: employee('acc-a'),
          paysTo: 'emp',
        })
        .returning({ id: schema.contractors.id });
      cpA = row!.id;
    });

    afterAll(async () => {
      await f?.t.drop();
    });

    it('бонусы в услуге задаёт только право «Списывать остаток в бонус»; строки проверяются', async () => {
      const form = (cookie: string) =>
        get(cookie, '/api/one-off-services/form', (x) => ServiceForm.parse(x));
      expect((await form(owner)).canBonus).toBe(true);
      expect((await form(hr)).canBonus).toBe(false);
      // «Кадры» ведёт услуги, но бонусы задать не может — даже пустым списком.
      expect(
        await refused(
          await call('POST', '/api/one-off-services', hr, serviceBody({ bonuses: [] })),
          403,
        ),
      ).toBe('bonus_right');
      const bad = async (bonuses: unknown[]) => {
        const e = await failure(
          await expectStatus(
            await call('POST', '/api/one-off-services', owner, serviceBody({ bonuses })),
            400,
          ),
        );
        return [e.code, (e.details as { field?: string } | undefined)?.field];
      };
      expect(await bad([line('acc-a', som(100)), line('acc-a', som(50))])).toEqual([
        'bonus_employee_twice',
        'bonuses',
      ]);
      expect(await bad([line('acc-a', 0)])).toEqual(['bonus_amount_required', 'bonuses']);
      const over = await failure(
        await call(
          'POST',
          '/api/one-off-services',
          owner,
          serviceBody({ bonuses: [line('acc-a', som(3000)), line('hr-a', som(2500))] }),
        ),
      );
      expect([over.code, plain(over.message)]).toEqual([
        'bonus_over_cost',
        'Бонусы в сумме больше стоимости услуги: 5 500 сом',
      ]);
      // Сотрудник другой организации и несуществующий — «Выберите сотрудника».
      expect(await bad([{ employeeId: f.people['acc-b']!.employeeId, amount: som(1) }])).toEqual([
        'bonus_employee_invalid',
        'bonuses',
      ]);
      expect(await bad([{ employeeId: MISSING, amount: som(1) }])).toEqual([
        'bonus_employee_invalid',
        'bonuses',
      ]);
      // Ничего не создано.
      expect(await log(owner)).toEqual([]);
    });

    it('бонус ждёт полной оплаты услуги: в остаток не входит; начисляется датой последней оплаты', async () => {
      service = await create(owner, {
        bonuses: [line('acc-a', som(500)), line('hr-a', som(300))],
      });
      const now = await card(owner, service);
      expect(now.bonuses).toEqual({
        total: som(800),
        on: null,
        lines: [
          {
            employeeId: employee('acc-a'),
            name: expect.any(String),
            short: expect.any(String),
            amount: som(500),
          },
          {
            employeeId: employee('hr-a'),
            name: expect.any(String),
            short: expect.any(String),
            amount: som(300),
          },
        ],
      });
      // Запись истории хранит краткое имя сотрудника и сумму (без отдельного полного имени).
      expect(now.history.at(-1)!.changes.find((ch) => ch.field === 'bonuses')?.to).toEqual([
        { employeeId: employee('acc-a'), name: expect.any(String), amount: som(500) },
        { employeeId: employee('hr-a'), name: expect.any(String), amount: som(300) },
      ]);
      expect(await summary(owner)).toMatchObject({ wait: som(800), svc: 0, bal: 0, canOut: true });
      const waiting = await log(owner);
      expect(waiting.map((r) => [r.kind, r.date, r.amount])).toEqual(
        expect.arrayContaining([
          ['wait', '2026-10-10', som(500)],
          ['wait', '2026-10-10', som(300)],
        ]),
      );
      expect(plain(waiting[0]!.what)).toBe('Восстановление учёта · оплачено 0 сом из 5 000 сом');
      // Ожидающий бонус в итог журнала не входит и не списывается.
      const page = await get(owner, '/api/bonuses/log', (x) => BonusLogList.parse(x));
      expect(page.totals).toMatchObject({ sum: 0 });
      expect(await refused(await writeOff(owner, 'acc-a', {}), 409)).toBe('bonus_none');

      await expectStatus(await pay(service, som(2000), '2026-10-12'), 201);
      expect(await summary(owner)).toMatchObject({ wait: som(800), svc: 0 });
      await expectStatus(await pay(service, som(3000), '2026-10-17'), 201);
      expect(await summary(owner)).toMatchObject({
        cp: 0,
        svc: som(800),
        wait: 0,
        out: 0,
        bal: som(800),
      });
      expect((await card(owner, service)).bonuses!.on).toBe('2026-10-17');
      const accrued = await log(owner, `&employeeId=${employee('acc-a')}`);
      expect(accrued).toHaveLength(1);
      expect(accrued[0]).toMatchObject({
        kind: 'svc',
        date: '2026-10-17',
        amount: som(500),
        employee: { id: employee('acc-a') },
        contractor: { id: cpA, name: 'ОсОО «Ала-Тоо Трейд»' },
        what: 'Восстановление учёта',
        serviceId: service,
        operationId: null,
        writeoff: null,
      });
      // «Остатки»: по умолчанию — по остатку, от больших.
      const rows = await balances(owner);
      expect(rows.slice(0, 2).map((r) => [r.id, r.svc, r.bal])).toEqual([
        [employee('acc-a'), som(500), som(500)],
        [employee('hr-a'), som(300), som(300)],
      ]);
      // Действующие сотрудники без бонусов тоже в списке.
      expect(rows.find((r) => r.id === employee('senior-a'))).toMatchObject({
        bal: 0,
        active: true,
      });
    });

    it('раздел видят «Сотрудники и роли» или «Списывать остаток в бонус»; контрагент и основание — только тому, кто видит услугу', async () => {
      // Право на бонусы без «Просматривать сотрудников» раздел не открывает: он — вкладка «Сотрудников».
      await f.t.admin.db.insert(schema.rolePermissions).values({
        orgId: f.a.orgId,
        roleId: f.roleIds.senior,
        permissionId: 'bonus',
      });
      for (const cookie of [acc, senior])
        for (const path of ['summary', 'balances', 'log', `employees/${employee('acc-a')}`])
          expect((await call('GET', `/api/bonuses/${path}`, cookie)).status, path).toBe(403);
      expect((await writeOff(senior, 'acc-a', {})).status).toBe(403);
      expect((await call('GET', '/api/bonuses/summary', '')).status).toBe(401);
      // Главный бухгалтер: право на бонусы, область «Все».
      expect(await summary(chief)).toMatchObject({ bal: som(800), canOut: true });
      expect((await log(chief))[0]).toMatchObject({ contractor: { id: cpA }, serviceId: service });
      // «Кадры»: «Сотрудники и роли», область «Свои» — суммы видны, чужой контрагент и услуга нет.
      expect(await summary(hr)).toMatchObject({ bal: som(800), canOut: false });
      const seen = await log(hr);
      expect(seen).toHaveLength(2);
      for (const r of seen)
        expect(r).toMatchObject({ kind: 'svc', contractor: null, what: '', serviceId: null });
      // Значения фильтров — тоже без контрагента и основания.
      expect(
        await (
          await expectStatus(await call('GET', '/api/bonuses/log/values?col=cp', hr), 200)
        ).text(),
      ).not.toContain('Ала-Тоо');
      expect(await (await call('GET', '/api/bonuses/log/values?col=cp', chief)).text()).toContain(
        'Ала-Тоо',
      );
      expect(
        await get(hr, `/api/bonuses/employees/${employee('acc-a')}`, (x) => BonusEmployee.parse(x)),
      ).toMatchObject({ svc: som(500), bal: som(500), canOut: false, today: '2026-10-18' });
      expect((await call('GET', `/api/bonuses/employees/${MISSING}`, owner)).status).toBe(404);
      // Карточка услуги: без права на бонусы и сотрудников — только своя строка, истории о бонусах нет.
      const [accRole] = await f.t.admin.db
        .select({ roleId: schema.employees.roleId })
        .from(schema.employees)
        .where(eq(schema.employees.id, employee('acc-a')));
      await f.t.admin.db.insert(schema.rolePermissions).values({
        orgId: f.a.orgId,
        roleId: accRole!.roleId,
        permissionId: 'projects',
      });
      const own = await card(acc, service);
      expect(own.bonuses).toEqual({
        total: som(500),
        on: '2026-10-17',
        lines: [
          {
            employeeId: employee('acc-a'),
            name: expect.any(String),
            short: expect.any(String),
            amount: som(500),
          },
        ],
      });
      expect(own.history.flatMap((h) => h.changes.map((ch) => ch.field))).not.toContain('bonuses');
      // Выгрузка — с правом «Выгружать в Excel».
      expect(
        (await call('GET', '/api/bonuses/balances/export?cols=fio,bal', owner)).headers.get(
          'content-type',
        ),
      ).toContain('spreadsheetml');
      expect((await call('GET', '/api/bonuses/log/values?col=kind', owner)).status).toBe(200);
    });

    it('чужая организация не видна: бонусы и списания организации А у организации Б не показываются и не меняются', async () => {
      expect(await summary(ownerB)).toMatchObject({ cp: 0, svc: 0, wait: 0, out: 0, bal: 0 });
      expect(await log(ownerB)).toEqual([]);
      expect((await balances(ownerB)).every((r) => r.bal === 0)).toBe(true);
      expect((await writeOff(ownerB, 'acc-a', {})).status).toBe(404);
      expect(
        (await call('GET', `/api/bonuses/employees/${employee('acc-a')}`, ownerB)).status,
      ).toBe(404);
    });

    it('«Списать бонус»: право, сумма не больше остатка, дата и основание; «Отменить списание» возвращает сумму', async () => {
      expect((await writeOff(hr, 'acc-a', {})).status).toBe(403);
      expect((await writeOff(acc, 'acc-a', {})).status).toBe(403);
      const over = await failure(
        await expectStatus(await writeOff(chief, 'acc-a', { amount: som(600) }), 400),
      );
      expect([over.code, plain(over.message), (over.details as { field: string }).field]).toEqual([
        'bonus_out_over',
        'Не больше остатка: 500 сом',
        'amount',
      ]);
      expect(await refused(await writeOff(chief, 'acc-a', { amount: 0 }), 400)).toBe(
        'bonus_out_amount_required',
      );
      expect(await refused(await writeOff(chief, 'acc-a', { date: '2026-10-19' }), 400)).toBe(
        'bonus_out_date_future',
      );
      expect(await refused(await writeOff(chief, 'acc-a', { note: '  ' }), 400)).toBe(
        'bonus_out_note_required',
      );
      expect(await refused(await writeOff(chief, 'senior-a', {}), 409)).toBe('bonus_none');
      expect(
        (
          await call('POST', `/api/bonuses/employees/${MISSING}/writeoffs`, chief, {
            amount: som(1),
            date: '2026-10-18',
            note: 'x',
          })
        ).status,
      ).toBe(404);

      const saved = BonusOutSaved.parse(
        await (await expectStatus(await writeOff(chief, 'acc-a', {}), 201)).json(),
      );
      expect(saved.balance).toBe(som(300));
      expect(await balanceOf('acc-a')).toMatchObject({
        svc: som(500),
        out: som(200),
        bal: som(300),
      });
      const out = (await log(owner)).find((r) => r.kind === 'out')!;
      expect(out).toMatchObject({
        date: '2026-10-18',
        amount: -som(200),
        what: 'Выдано с зарплатой',
        contractor: null,
        writeoff: { id: saved.id, version: 1 },
      });
      // История сотрудника: сумма, дата, остаток «было → стало», основание.
      const [hist] = await f.t.admin.db
        .select({ changes: schema.auditLog.changes, reason: schema.auditLog.reason })
        .from(schema.auditLog)
        .where(
          and(
            eq(schema.auditLog.entity, 'employee'),
            eq(schema.auditLog.entityId, employee('acc-a')),
            eq(schema.auditLog.action, 'update'),
          ),
        )
        .orderBy(asc(schema.auditLog.at));
      expect(hist).toMatchObject({
        reason: 'Выдано с зарплатой',
        changes: [
          { field: 'bonusOut', to: som(200) },
          { field: 'bonusOutDate', to: '2026-10-18' },
          { field: 'bonusBalance', from: som(500), to: som(300) },
        ],
      });

      // Отмена: право, версия, повтор.
      expect((await undo(hr, out.writeoff!)).status).toBe(403);
      expect((await undo(ownerB, out.writeoff!)).status).toBe(404);
      expect((await undo(chief, { id: saved.id, version: 7 })).status).toBe(409);
      await expectStatus(await undo(chief, out.writeoff!), 200);
      expect(await refused(await undo(chief, { id: saved.id, version: 2 }), 409)).toBe(
        'bonus_out_undone',
      );
      expect(await balanceOf('acc-a')).toMatchObject({ out: 0, bal: som(500) });
      expect((await log(owner)).some((r) => r.kind === 'out')).toBe(false);
    });

    it('правка услуги не уводит уже списанный бонус в минус; бонусы меняются отдельной записью истории', async () => {
      const saved = BonusOutSaved.parse(
        await (
          await expectStatus(await writeOff(owner, 'acc-a', { amount: som(500) }), 201)
        ).json(),
      );
      // Уменьшить бонус ниже списанного нельзя.
      const less = await failure(
        await expectStatus(
          await edit(owner, service, {
            bonuses: [line('acc-a', som(100)), line('hr-a', som(300))],
          }),
          409,
        ),
      );
      expect(less.code).toBe('bonus_spent');
      expect(plain(less.message)).toMatch(
        /: бонус уже списан, остаток бонусов 0 сом — уменьшить настолько нельзя$/,
      );
      // Поднять стоимость так, что услуга перестанет быть оплаченной, — тоже.
      const wait = await failure(
        await expectStatus(
          await edit(owner, service, {
            amount: som(6000),
            reason: 'Согласовали заново',
            bonuses: [line('acc-a', som(500)), line('hr-a', som(300))],
          }),
          409,
        ),
      );
      expect(wait.message).toMatch(/услуга перестанет быть оплаченной, и бонус уйдёт в ожидание$/);
      // Без блока бонусов стоимость тоже не уводит списанный бонус в ожидание и не опускается ниже суммы
      // бонусов: отказ — без имён и сумм.
      expect(
        await refused(
          await edit(owner, service, { amount: som(6000), reason: 'Согласовали заново' }),
          409,
        ),
      ).toBe('bonus_cost');
      const small = await create(owner, {
        amount: som(1000),
        bonuses: [line('hr-a', som(800))],
      });
      const cut = await failure(
        await expectStatus(
          await edit(owner, small, { amount: som(500), reason: 'Согласовали заново' }),
          409,
        ),
      );
      expect(cut.code).toBe('bonus_cost');
      expect(cut.message).not.toMatch(/\d/);
      await expectStatus(
        await edit(owner, small, { amount: som(900), reason: 'Согласовали заново' }),
        200,
      );
      await expectStatus(await edit(owner, small, { bonuses: [] }), 200);
      // Без права на бонусы правка услуги бонусы не трогает; со строками — отказ.
      expect(await refused(await edit(hr, service, { bonuses: [] }), 403)).toBe('bonus_right');
      await expectStatus(await edit(owner, service, { description: 'Уточнили' }), 200);
      expect((await card(owner, service)).bonuses!.total).toBe(som(800));

      await expectStatus(await undo(owner, { id: saved.id, version: 1 }), 200);
      await expectStatus(
        await edit(owner, service, { bonuses: [line('hr-a', som(300)), line('acc-a', som(100))] }),
        200,
      );
      const now = await card(owner, service);
      expect(now.bonuses!.lines.map((b) => [b.employeeId, b.amount])).toEqual([
        [employee('hr-a'), som(300)],
        [employee('acc-a'), som(100)],
      ]);
      const change = now.history.at(0)!.changes.find((ch) => ch.field === 'bonuses')!;
      expect((change.from as { amount: number }[]).map((b) => b.amount)).toEqual([
        som(500),
        som(300),
      ]);
      expect((change.to as { amount: number }[]).map((b) => b.amount)).toEqual([
        som(300),
        som(100),
      ]);
      expect(await balanceOf('acc-a')).toMatchObject({ svc: som(100), bal: som(100) });
      // Убрать все бонусы.
      await expectStatus(await edit(owner, service, { bonuses: [] }), 200);
      expect((await card(owner, service)).bonuses).toBeNull();
      expect(await summary(owner)).toMatchObject({ svc: 0, bal: 0 });
    });

    it('удалённая оплата возвращает бонус в ожидание; удалённая услуга бонус не даёт', async () => {
      const id = await create(owner, { paidNow: true, bonuses: [line('acc-a', som(700))] });
      expect(await balanceOf('acc-a')).toMatchObject({ svc: som(700), wait: 0, bal: som(700) });
      const [payment] = (await card(owner, id)).payments;
      await expectStatus(
        await call('POST', `/api/one-off-service-payments/${payment!.id}/delete`, owner, {
          reason: 'Ошиблись',
        }),
        200,
      );
      expect(await balanceOf('acc-a')).toMatchObject({ svc: 0, wait: som(700), bal: 0 });
      await expectStatus(
        await call('POST', `/api/one-off-services/${id}/delete`, owner, { reason: 'Отказались' }),
        200,
      );
      expect(await balanceOf('acc-a')).toMatchObject({ svc: 0, wait: 0, bal: 0 });
      expect(await log(owner)).toEqual([]);
    });

    it('остаток контрагента, списанный в бонус со счёта сотрудника, копится вместе с бонусами за услуги', async () => {
      await f.t.admin.db.insert(schema.moneyOperations).values({
        orgId: f.a.orgId,
        contractorId: cpA,
        kind: 'bonus',
        amount: som(1200),
        opDate: '2026-10-15',
        holderKind: 'employee',
        holderEmployeeId: employee('acc-a'),
        note: 'Остаток после оплаты налогов',
        createdBy: f.people['chief-a']!.userId,
      });
      expect(await balanceOf('acc-a')).toMatchObject({ cp: som(1200), bal: som(1200) });
      const [row] = await log(chief);
      expect(row).toMatchObject({
        kind: 'cp',
        date: '2026-10-15',
        amount: som(1200),
        contractor: { id: cpA },
        what: 'Остаток после оплаты налогов',
        operationId: expect.any(String),
      });
      // «Кадры»: чужой контрагент — сумма видна, контрагент и основание нет.
      expect((await log(hr))[0]).toMatchObject({
        kind: 'cp',
        amount: som(1200),
        contractor: null,
        what: '',
        operationId: null,
      });
      // «Счёт» сотрудника: плашка «Накоплено бонусов».
      const account = await get(owner, `/api/staff/${employee('acc-a')}/account`, (x) =>
        EmployeeAccount.parse(x),
      );
      expect(account.bonuses).toEqual({ bal: som(1200), out: 0, svc: 0 });
      // Списание — из общего остатка.
      await expectStatus(await writeOff(chief, 'acc-a', { amount: som(1200) }), 201);
      expect(await balanceOf('acc-a')).toMatchObject({ cp: som(1200), out: som(1200), bal: 0 });
    });
  },
);
