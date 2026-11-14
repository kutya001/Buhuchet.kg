import type { MemoryStorage } from '@buhuchet/adapters';
import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import {
  ApiError,
  ContractorHistory,
  EmployeeList,
  FileManagerList,
  FileUploadTicket,
  FinJournalRow,
  FinSummary,
  listPageSchema,
  ServiceCard,
  ServiceForm,
  ServicePaymentWindow,
  ServiceSaved,
} from '@buhuchet/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

/** Сомы в тыйынах. */
const som = (n: number) => n * 100;

const ALL_ON = { files: true, taxpay: true, accounts: true, finops: true, fee: true };
const Journal = listPageSchema(FinJournalRow);
const MISSING = '00000000-0000-4000-8000-0000000000ff';

// Сегодня в тестах — 18.10.2026 (`createTestDeps`).
describe.skipIf(!databaseAvailable())(
  'Разовые услуги и их оплаты, вкладка «Проекты и услуги», «Баланс счёта» сотрудника — методы API (задача 2.22)',
  () => {
    let f: Fixture;
    let owner: string;
    let chief: string;
    let acc: string;
    let hr: string;
    let senior: string;
    let ownerB: string;
    let cpA = '';
    let cpHr = '';
    let cpArch = '';

    const employee = (login: string) => f.people[login]!.employeeId;
    const call = (
      method: 'GET' | 'POST' | 'PUT' | 'DELETE',
      path: string,
      cookie: string,
      body?: unknown,
    ) => apiRequest(f.app, method, path, cookie, body);
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
    const payment = (cookie: string, id: string) =>
      get(cookie, `/api/one-off-service-payments/${id}`, (x) => ServicePaymentWindow.parse(x));
    const journal = (cookie: string, query = '') =>
      get(cookie, `/api/fin/journal?size=all${query}`, (x) => Journal.parse(x));
    const summary = (cookie: string) => get(cookie, '/api/fin/summary', (x) => FinSummary.parse(x));
    const create = async (cookie: string, body: Record<string, unknown>) =>
      ServiceSaved.parse(
        await (
          await expectStatus(
            await call('POST', '/api/one-off-services', cookie, {
              contractorId: cpA,
              name: 'Восстановление учёта',
              date: '2026-10-10',
              amount: som(5000),
              performerId: null,
              ...body,
            }),
            201,
          )
        ).json(),
      ).id;
    const pay = (cookie: string, id: string, amount: number, date = '2026-10-17') =>
      call('POST', `/api/one-off-services/${id}/payments`, cookie, { amount, date });
    /** Загрузка файла к записи, как окно: билет, файл в хранилище, «готово». */
    const upload = async (cookie: string, source: { kind: string; id: string }, name: string) => {
      const started = await call('POST', '/api/files/uploads', cookie, { name, size: 5, source });
      if (started.status !== 201) return started;
      const ticket = FileUploadTicket.parse(await started.json());
      const [row] = await f.t.admin.db
        .select({ key: schema.files.storageKey, type: schema.files.contentType })
        .from(schema.files)
        .where(eq(schema.files.id, ticket.id));
      await (f.deps.storage as MemoryStorage).put(row!.key, new Uint8Array(5), {
        contentType: row!.type,
      });
      return call('POST', `/api/files/${ticket.id}/complete`, cookie);
    };

    async function contractor(name: string, inn: string, responsible: string, archived = false) {
      const [row] = await f.t.admin.db
        .insert(schema.contractors)
        .values({
          orgId: f.a.orgId,
          name,
          inn,
          phone: '+996505890076',
          formCode: 'ФС-01',
          regimeCode: 'РЕЖ-01',
          startDate: '2026-07-01',
          feeDay: 15,
          responsibleEmployeeId: responsible,
          paysTo: 'emp',
          ...(archived ? { serviceStatus: 'archived' as const } : {}),
          createdAt: new Date('2026-06-20T10:00:00+06:00'),
        })
        .returning({ id: schema.contractors.id });
      return row!.id;
    }

    const features = (orgId: string, on: Record<string, boolean>) =>
      f.t.admin.db
        .update(schema.orgSettings)
        .set({ features: on, reportConfirm: false })
        .where(eq(schema.orgSettings.orgId, orgId));

    beforeAll(async () => {
      f = await createStaffFixture();
      await seedAllPlatformDictionaries(f.t.admin.db);
      await features(f.a.orgId, ALL_ON);
      await features(f.b.orgId, ALL_ON);
      // «Кадры» (область «Свои» во всех группах) ведёт проекты и разовые услуги — только своих.
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
      cpA = await contractor('ОсОО «Ала-Тоо Трейд»', '03744097401851', employee('acc-a'));
      cpHr = await contractor('ИП Садыков', '20101199000123', employee('hr-a'));
      cpArch = await contractor('ОсОО «Архив»', '03744097401853', employee('acc-a'), true);
    }, 120_000);

    afterAll(async () => {
      await f?.t.drop();
    });

    it('вход, права, функции и изоляция организаций', async () => {
      const id = await create(owner, { name: 'Консультация' });
      for (const [method, path] of [
        ['GET', '/api/one-off-services/form'],
        ['POST', '/api/one-off-services'],
        ['GET', `/api/one-off-services/${id}`],
        ['POST', `/api/one-off-services/${id}/payments`],
      ] as const) {
        expect((await apiRequest(f.app, method, path)).status).toBe(401);
      }
      // «Бухгалтер» не ведёт проекты и не видит услуг; «Старший» — тоже.
      expect((await call('GET', '/api/one-off-services/form', acc)).status).toBe(403);
      expect(
        (await call('POST', '/api/one-off-services', acc, { contractorId: cpA, name: 'x' })).status,
      ).toBe(403);
      expect((await call('GET', `/api/one-off-services/${id}`, acc)).status).toBe(403);
      expect((await call('GET', `/api/one-off-services/${id}`, senior)).status).toBe(403);
      expect((await pay(acc, id, som(1))).status).toBe(403);
      // Другая организация: услуги нет.
      expect((await call('GET', `/api/one-off-services/${id}`, ownerB)).status).toBe(404);
      expect(await refused(await pay(ownerB, id, som(1)), 404)).toBe('not_found');
      expect((await journal(ownerB, '&tab=proj')).total).toBe(0);
      expect(
        await refused(
          await call('POST', '/api/one-off-services', ownerB, {
            contractorId: cpA,
            name: 'Чужая',
            date: '2026-10-10',
            amount: som(10),
            performerId: null,
          }),
          400,
        ),
      ).toBe('service_contractor_invalid');
      // Нет такой услуги — 404; неверные данные — 400.
      expect((await call('GET', `/api/one-off-services/${MISSING}`, owner)).status).toBe(404);
      expect((await call('GET', '/api/one-off-services/not-a-uuid', owner)).status).toBe(400);
      expect(
        (await call('POST', '/api/one-off-services', owner, { contractorId: cpA, extra: 1 }))
          .status,
      ).toBe(400);
      expect(
        await refused(
          await call('POST', '/api/one-off-services', owner, {
            contractorId: cpA,
            name: '  ',
            date: '2026-10-10',
            amount: som(10),
            performerId: null,
          }),
          400,
        ),
      ).toBe('service_name_required');
      // «Финансовые операции по контрагентам» выключены — 403 `finops_off`.
      await features(f.a.orgId, { ...ALL_ON, finops: false });
      try {
        expect(await refused(await call('GET', `/api/one-off-services/${id}`, owner), 403)).toBe(
          'finops_off',
        );
        expect(await refused(await pay(owner, id, som(1)), 403)).toBe('finops_off');
      } finally {
        await features(f.a.orgId, ALL_ON);
      }
    });

    it('окно «Разовая услуга»: контрагенты области, исполнитель по умолчанию; архивный — 409', async () => {
      const form = await get(owner, `/api/one-off-services/form?contractorId=${cpA}`, (x) =>
        ServiceForm.parse(x),
      );
      const ids = form.contractors.map((c) => c.id);
      expect(ids).toContain(cpA);
      expect(ids).toContain(cpHr);
      expect(ids).not.toContain(cpArch);
      // ИНН — для поиска в списке формы (прототип v93).
      expect(form.contractors.every((c) => /^\d{14}$/.test(c.inn))).toBe(true);
      // Прототип serviceDlg: исполнитель — ответственный контрагента.
      expect(form.performer).toBe(employee('acc-a'));
      expect(form.today).toBe('2026-10-18');
      // «Кадры» с областью «Свои»: только свои контрагенты.
      const own = await get(hr, '/api/one-off-services/form', (x) => ServiceForm.parse(x));
      expect(own.contractors.map((c) => c.id)).toEqual([cpHr]);
      expect(own.performer).toBe(employee('hr-a'));
      expect(
        await refused(
          await call('POST', '/api/one-off-services', owner, {
            contractorId: cpArch,
            name: 'Архив',
            date: '2026-10-10',
            amount: som(10),
            performerId: null,
          }),
          409,
        ),
      ).toBe('contractor_archived');
    });

    it('оплата: частичная, сверх остатка, будущей датой; «Оплачено сразу»; журнал и плашка', async () => {
      const before = await summary(owner);
      const id = await create(owner, { amount: som(5000), performerId: employee('acc-a') });
      let row = (await journal(owner, '&tab=proj')).items.find((r) => r.id === id)!;
      expect(row.src).toBe('svc');
      expect(row.amount).toBe(som(5000));
      expect(row.service).toMatchObject({ status: 'unpaid', paid: 0, pay: null });
      expect(row.locks).toEqual({ edit: null, del: null });
      expect((await summary(owner)).proj!.open).toBe(before.proj!.open + 1);

      await expectStatus(await pay(owner, id, som(2000)), 201);
      expect(await refused(await pay(owner, id, som(3001)), 400)).toBe('service_pay_over');
      expect(await refused(await pay(owner, id, som(10), '2026-10-19'), 400)).toBe(
        'money_date_future',
      );
      expect((await call('POST', `/api/one-off-services/${id}/payments`, owner, {})).status).toBe(
        400,
      );
      let c = await card(owner, id);
      expect(c.status).toBe('partial');
      expect(c.paid).toBe(som(2000));
      expect(c.payments).toHaveLength(1);
      expect(c.performer?.id).toBe(employee('acc-a'));
      await expectStatus(await pay(owner, id, som(3000)), 201);
      c = await card(owner, id);
      expect(c.status).toBe('paid');
      expect(c.locks.pay?.code).toBe('service_paid_full');
      expect(await refused(await pay(owner, id, som(1)), 409)).toBe('service_paid_full');
      row = (await journal(owner, '&tab=proj')).items.find((r) => r.id === id)!;
      expect(row.service?.status).toBe('paid');
      const after = await summary(owner);
      expect(after.proj!.open).toBe(before.proj!.open);
      expect(after.proj!.received).toBe(before.proj!.received + som(5000));

      // «Оплачено сразу»: оплата на всю стоимость сегодняшним днём.
      const paid = await create(owner, { name: 'Регистрация', amount: som(700), paidNow: true });
      const p = await card(owner, paid);
      expect(p.status).toBe('paid');
      expect(p.payments.map((x) => [x.date, x.amount])).toEqual([['2026-10-18', som(700)]]);
      // Вкладки «Все» и «Проекты и услуги» показывают услугу; «Налоги» — нет.
      expect((await journal(owner)).items.some((r) => r.id === paid)).toBe(true);
      expect((await journal(owner, '&tab=tax')).items.some((r) => r.id === paid)).toBe(false);
    });

    it('изменение и удаление: не меньше полученного, причина, устаревшая версия, удалённая услуга', async () => {
      const id = await create(owner, { amount: som(1000) });
      await expectStatus(await pay(owner, id, som(400)), 201);
      const c = await card(owner, id);
      const edit = (body: Record<string, unknown>) =>
        call('PUT', `/api/one-off-services/${id}`, owner, {
          version: c.version,
          name: c.name,
          date: c.date,
          amount: c.amount,
          performerId: null,
          description: '',
          reason: '',
          ...body,
        });
      expect(await refused(await edit({ amount: som(300), reason: 'скидка' }), 400)).toBe(
        'service_amount_less',
      );
      expect(await refused(await edit({ amount: som(1200) }), 400)).toBe('service_reason_required');
      await expectStatus(await edit({ amount: som(1200), reason: 'договорились' }), 200);
      expect(await refused(await edit({ name: 'Устарело' }), 409)).toBe('record_changed');
      const edited = await card(owner, id);
      expect(edited.amount).toBe(som(1200));
      expect(edited.edited).toBe(true);
      expect(edited.history.map((h) => h.action)).toContain('update');

      // Оплата: окно, изменение не больше остатка, удаление с причиной.
      const pid = edited.payments[0]!.id;
      const w = await payment(owner, pid);
      expect(w.service).toMatchObject({ id, amount: som(1200), paid: som(400) });
      expect(w.max).toBe(som(1200));
      expect(
        await refused(
          await call('PUT', `/api/one-off-service-payments/${pid}`, owner, {
            version: w.version,
            amount: som(1300),
            date: w.date,
            reason: 'x',
          }),
          400,
        ),
      ).toBe('op_service_over');
      await expectStatus(
        await call('PUT', `/api/one-off-service-payments/${pid}`, owner, {
          version: w.version,
          amount: som(500),
          date: w.date,
          reason: 'не та сумма',
        }),
        200,
      );
      expect((await card(owner, id)).paid).toBe(som(500));
      expect(
        await refused(
          await call('POST', `/api/one-off-service-payments/${pid}/delete`, owner, { reason: '' }),
          400,
        ),
      ).toBe('validation_failed');
      await expectStatus(
        await call('POST', `/api/one-off-service-payments/${pid}/delete`, owner, {
          reason: 'дубль',
        }),
        200,
      );
      expect((await payment(owner, pid)).deleted?.reason).toBe('дубль');
      expect((await card(owner, id)).paid).toBe(0);

      // Удаление услуги: в журнале — удалённой, действия закрыты.
      await expectStatus(
        await call('POST', `/api/one-off-services/${id}/delete`, owner, { reason: 'ошибка' }),
        200,
      );
      const gone = await card(owner, id);
      expect(gone.deleted?.reason).toBe('ошибка');
      expect(gone.locks.edit?.code).toBe('service_deleted');
      expect(gone.locks.pay?.code).toBe('service_deleted');
      expect(await refused(await pay(owner, id, som(1)), 409)).toBe('service_deleted');
      expect((await journal(owner, '&tab=proj')).items.some((r) => r.id === id)).toBe(false);
      const shown = (await journal(owner, '&tab=proj&deleted=1')).items.find((r) => r.id === id);
      expect(shown?.deleted).toBe(true);
    });

    it('удалённая услуга: окно её оплаты — «Удалена» с причиной услуги, изменить и удалить нельзя', async () => {
      const id = await create(owner, { name: 'Перенос базы', amount: som(800) });
      await expectStatus(await pay(owner, id, som(300)), 201);
      const pid = (await card(owner, id)).payments[0]!.id;
      await expectStatus(
        await call('POST', `/api/one-off-services/${id}/delete`, owner, { reason: 'не та услуга' }),
        200,
      );
      const w = await payment(owner, pid);
      expect(w.deleted?.reason).toBe('не та услуга');
      expect(w.locks.edit?.code).toBe('service_deleted');
      expect(w.locks.del?.code).toBe('service_deleted');
      expect(
        await refused(
          await call('PUT', `/api/one-off-service-payments/${pid}`, owner, {
            version: w.version,
            amount: som(100),
            date: w.date,
            reason: 'x',
          }),
          409,
        ),
      ).toBe('service_deleted');
    });

    it('контрагента с разовой услугой удалить нельзя — только в архив', async () => {
      const cp = await contractor('ОсОО «Без отчётов»', '03744097401859', employee('acc-a'));
      await create(owner, { contractorId: cp, name: 'Консультация', amount: som(100) });
      const res = await expectStatus(await call('DELETE', `/api/contractors/${cp}`, owner), 409);
      const err = await failure(res);
      expect(err.code).toBe('contractor_in_use');
      expect(err.details).toMatchObject({ variant: 'has_projects' });
    });

    it('видит услугу, но не ведёт: «Записать оплату» — «Нужно право «Вести проекты…»», запись — 403', async () => {
      // «Старший» с «Видеть плату за обслуживание» видит вкладку и свои услуги, но не ведёт их.
      await f.t.admin.db.insert(schema.rolePermissions).values({
        orgId: f.a.orgId,
        roleId: f.roleIds.senior,
        permissionId: 'fee',
      });
      const cp = await contractor('ИП Осмонов', '20101199000125', employee('senior-a'));
      const id = await create(owner, { contractorId: cp, name: 'Сверка', amount: som(200) });
      const seen = await card(senior, id);
      expect(seen.locks.pay?.code).toBe('service_pay_right');
      expect(seen.locks.pay?.text).toBe('Нужно право «Вести проекты и разовые услуги»');
      expect(seen.locks.edit?.code).toBe('op_view_only');
      expect((await pay(senior, id, som(1))).status).toBe(403);

      // Файлы услуги и оплаты (п. В-34): без права «Просматривать файлы» — ни имён, ни записей о файлах.
      await expectStatus(await pay(owner, id, som(100)), 201);
      const pid = (await card(owner, id)).payments[0]!.id;
      await expectStatus(await upload(owner, { kind: 'one_off_service', id }, 'акт.pdf'), 200);
      await expectStatus(
        await upload(owner, { kind: 'one_off_service_payment', id: pid }, 'платёжка.pdf'),
        200,
      );
      const fileActions = (h: readonly { action: string }[]) =>
        h.filter((e) => e.action === 'file_attach').length;
      const full = await card(owner, id);
      expect(full.files).toBe(true);
      expect(full.payments[0]!.files).toEqual(['платёжка.pdf']);
      expect(fileActions(full.history)).toBeGreaterThan(0);
      const bare = await card(senior, id);
      expect(bare.files).toBe(false);
      expect(bare.payments[0]!.files).toEqual([]);
      expect(fileActions(bare.history)).toBe(0);
      const ownerWindow = await payment(owner, pid);
      expect(ownerWindow.files).toBe(1);
      expect(fileActions(ownerWindow.history)).toBeGreaterThan(0);
      const seniorWindow = await payment(senior, pid);
      expect(seniorWindow.files).toBeNull();
      expect(fileActions(seniorWindow.history)).toBe(0);
    });

    it('область «Свои»: чужой контрагент — нет услуги и не записать', async () => {
      const others = await create(owner, { name: 'Чужая услуга' });
      const mine = await create(hr, { contractorId: cpHr, name: 'Своя услуга', amount: som(300) });
      expect((await call('GET', `/api/one-off-services/${others}`, hr)).status).toBe(404);
      expect(await refused(await pay(hr, others, som(1)), 404)).toBe('not_found');
      expect(
        await refused(
          await call('POST', '/api/one-off-services', hr, {
            contractorId: cpA,
            name: 'Нельзя',
            date: '2026-10-10',
            amount: som(10),
            performerId: null,
          }),
          400,
        ),
      ).toBe('service_contractor_invalid');
      const ids = (await journal(hr, '&tab=proj')).items.map((r) => r.id);
      expect(ids).toContain(mine);
      expect(ids).not.toContain(others);
      // «Главный бухгалтер» (всё во всех группах) видит обе и может записать оплату.
      const chiefIds = (await journal(chief, '&tab=proj')).items.map((r) => r.id);
      expect(chiefIds).toEqual(expect.arrayContaining([mine, others]));
      await expectStatus(await pay(chief, mine, som(100)), 201);

      // Плашка и число у вкладки — по контрагентам области (п. В-35): оплата чужой услуги их не меняет.
      const [hrBefore, ownerBefore] = [(await summary(hr)).proj!, (await summary(owner)).proj!];
      await expectStatus(await pay(owner, others, som(50)), 201);
      expect((await summary(hr)).proj).toEqual(hrBefore);
      expect((await summary(owner)).proj!.received).toBe(ownerBefore.received + som(50));
    });

    it('файлы услуги и оплаты: Файловый менеджер, «Разовая услуга», история контрагента', async () => {
      const id = await create(owner, { name: 'Аудит', amount: som(900) });
      await expectStatus(await pay(owner, id, som(900)), 201);
      const pid = (await card(owner, id)).payments[0]!.id;
      await expectStatus(await upload(owner, { kind: 'one_off_service', id }, 'договор.pdf'), 200);
      await expectStatus(
        await upload(owner, { kind: 'one_off_service_payment', id: pid }, 'чек.png'),
        200,
      );
      // Без права вести услуги — загрузить нельзя.
      expect([403, 404]).toContain(
        (await upload(acc, { kind: 'one_off_service', id }, 'нельзя.pdf')).status,
      );
      expect((await card(owner, id)).payments[0]!.files).toEqual(['чек.png']);
      const files = (cookie: string) =>
        get(cookie, '/api/files/manager?size=all', (x) => FileManagerList.parse(x)).then((l) =>
          l.items
            .filter((r) => r.sourceRef === id)
            .map((r) => [r.name, r.kind, r.source])
            .sort(),
        );
      // Файлы оплаты — тоже вида «Разовая услуга»; «Перейти к источнику» — карточка услуги.
      expect(await files(owner)).toEqual([
        ['договор.pdf', 'one_off_service', 'Аудит'],
        ['чек.png', 'one_off_service', 'Аудит'],
      ]);
      // «Бухгалтер» услуг не видит — и их файлов в Файловом менеджере нет.
      expect(await files(acc)).toEqual([]);
      // История контрагента: записи услуги и оплаты — тем, кто видит услуги.
      const history = (cookie: string) =>
        get(cookie, `/api/contractors/${cpA}/history`, (x) => ContractorHistory.parse(x)).then(
          (h) => new Set(h.items.map((e) => e.entity)),
        );
      const seen = await history(owner);
      expect(seen.has('one_off_service')).toBe(true);
      expect(seen.has('one_off_service_payment')).toBe(true);
      const accSeen = await history(acc);
      expect(accSeen.has('one_off_service')).toBe(false);
      expect(accSeen.has('one_off_service_payment')).toBe(false);
    });

    it('столбец «Баланс счёта» сотрудников: с правами денег и включёнными счетами', async () => {
      // Поступление 1 000 сом на счёт ответственного «Бухгалтера».
      await expectStatus(
        await call('POST', `/api/contractors/${cpA}/receipts`, owner, {
          date: '2026-10-17',
          total: som(1000),
        }),
        201,
      );
      const balances = (cookie: string) =>
        get(cookie, '/api/staff?size=all', (x) => EmployeeList.parse(x)).then((l) =>
          Object.fromEntries(l.items.map((e) => [e.id, e.balance])),
        );
      const all = await balances(owner);
      expect(all[employee('acc-a')]).toBe(som(1000));
      expect(all[employee('chief-a')]).toBe(0);
      // «Кадры»: счета видны в своей области — поступления по чужому контрагенту не входят.
      expect((await balances(hr))[employee('acc-a')]).toBe(0);
      // «Счета сотрудников» выключены — столбца нет.
      await features(f.a.orgId, { ...ALL_ON, accounts: false });
      try {
        expect((await balances(owner))[employee('acc-a')]).toBeUndefined();
      } finally {
        await features(f.a.orgId, ALL_ON);
      }
    });
  },
);
