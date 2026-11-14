import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { formatSomWithUnit } from '@buhuchet/domain';
import { ContractorHistory, ContractorMonthPay } from '@buhuchet/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;
type Report = typeof schema.reports.$inferInsert;

const som = formatSomWithUnit;

/** M-Bank — код refDB.json. */
const MBANK = 'БНК-13';

// Сегодня в тестах — 18.10.2026 (`createTestDeps`).
describe.skipIf(!databaseAvailable())(
  '«К оплате клиенту» за месяц в карточке контрагента (доработки 13.11.2026, К4; прототип v94)',
  () => {
    let f: Fixture;
    let owner: string;
    let chief: string;
    let acc: string;
    let senior: string;
    let ownerB: string;
    let cpA = '';
    let cpChief = '';
    let cpB = '';
    const ids: Record<string, string> = {};

    const employee = (login: string) => f.people[login]!.employeeId;
    const call = (
      cookie: string | undefined,
      method: 'GET' | 'POST',
      path: string,
      body?: unknown,
    ) => apiRequest(f.app, method, path, cookie, body);
    const pay = async (cookie: string, cp: string, month: string) => {
      const res = await call(cookie, 'GET', `/api/contractors/${cp}/month-pay?month=${month}`);
      expect(res.status, await res.clone().text()).toBe(200);
      return ContractorMonthPay.parse(await res.json());
    };
    const copied = (cookie: string | undefined, cp: string, month: unknown) =>
      call(cookie, 'POST', `/api/contractors/${cp}/month-pay/copied`, { month });
    /** Область группы прав у роли «Кадры» (hr-a: права бухгалтера, по умолчанию — «Свои»). */
    const scope = (roleId: string, group: 'cps' | 'reports', value: 'all' | 'own') =>
      f.t.admin.db
        .update(schema.roleScopes)
        .set({ scope: value })
        .where(and(eq(schema.roleScopes.roleId, roleId), eq(schema.roleScopes.permGroup, group)));
    const payTextLines = async (cookie: string, cp: string) => {
      const res = await call(cookie, 'GET', `/api/contractors/${cp}/history`);
      expect(res.status, await res.clone().text()).toBe(200);
      return ContractorHistory.parse(await res.json()).items.filter((h) =>
        h.changes.some((x) => x.field === 'payText'),
      );
    };
    const codeOf = async (res: Response) =>
      ((await res.json()) as { error: { code: string } }).error.code;

    async function contractor(orgId: string, name: string, inn: string, responsible: string) {
      const [row] = await f.t.admin.db
        .insert(schema.contractors)
        .values({
          orgId,
          name,
          inn,
          phone: '+996505890076',
          formCode: 'ФС-01',
          regimeCode: 'РЕЖ-01',
          startDate: '2026-01-15',
          responsibleEmployeeId: responsible,
        })
        .returning({ id: schema.contractors.id });
      return row!.id;
    }

    async function report(key: string, values: Omit<Report, 'orgId'>) {
      const [row] = await f.t.admin.db
        .insert(schema.reports)
        .values({ orgId: f.a.orgId, ...values })
        .returning({ id: schema.reports.id });
      ids[key] = row!.id;
    }

    const taxpay = async (on: boolean) => {
      const [before] = await f.t.admin.db
        .select({ features: schema.orgSettings.features })
        .from(schema.orgSettings)
        .where(eq(schema.orgSettings.orgId, f.a.orgId));
      await f.t.admin.db
        .update(schema.orgSettings)
        .set({ features: { ...before!.features, taxpay: on } })
        .where(eq(schema.orgSettings.orgId, f.a.orgId));
    };

    beforeAll(async () => {
      f = await createStaffFixture();
      await seedAllPlatformDictionaries(f.t.admin.db);
      [owner, chief, acc, senior, ownerB] = await Promise.all([
        signIn(f.app, 'owner-a', TEST_PASSWORD),
        signIn(f.app, 'chief-a', TEST_PASSWORD),
        signIn(f.app, 'acc-a', TEST_PASSWORD),
        signIn(f.app, 'senior-a', TEST_PASSWORD),
        signIn(f.app, 'owner-b', TEST_PASSWORD),
      ]);
      const res = await call(owner, 'POST', '/api/org-report-types/connect', {
        connect: ['nds', 't1m', 'pat', 'utli'],
        disconnect: [],
      });
      expect(res.status, await res.clone().text()).toBe(200);
      cpA = await contractor(
        f.a.orgId,
        'ОсОО «Ала-Тоо Трейд»',
        '03744097401851',
        employee('acc-a'),
      );
      cpChief = await contractor(f.a.orgId, 'ИП Садыков', '20101199000123', employee('chief-a'));
      cpB = await contractor(f.b.orgId, 'ОсОО «Бишкек»', '03744097401852', employee('acc-b'));
      // Реквизит ответственного бухгалтера: контрагент по умолчанию переводит деньги сотруднику.
      const wallet = await call(acc, 'POST', '/api/profile/wallets', {
        kind: 'phone',
        bankCode: null,
        accountNo: null,
        phone: '+996555123456',
        phoneBanks: [MBANK],
        holderName: 'Бухгалтер А.',
        isMain: true,
      });
      expect(wallet.status, await wallet.clone().text()).toBeLessThan(300);

      const mine = { contractorId: cpA, responsibleEmployeeId: employee('acc-a') };
      const sep = { period: 'M' as const, periodStart: '2026-09-01' };
      // НДС за сентябрь: оплачен частично, срок оплаты позже патента.
      await report('nds', {
        ...mine,
        ...sep,
        reportTypeCode: 'nds',
        act: 'both',
        dueBase: '2026-10-20',
        dueDate: '2026-10-20',
        payDue: '2026-10-25',
        amount: 500_000,
        paid: 120_000,
      });
      // Патент за сентябрь: только уплата, не оплачен.
      await report('pat', {
        ...mine,
        ...sep,
        reportTypeCode: 'pat',
        act: 'pay',
        dueBase: '2026-10-20',
        dueDate: '2026-10-20',
        payDue: '2026-10-20',
        amount: 87_050,
      });
      // Сумма ещё не указана — в расчёт не входит, считается отдельно.
      await report('utli', {
        ...mine,
        ...sep,
        reportTypeCode: 'utli',
        act: 'both',
        dueBase: '2026-10-20',
        dueDate: '2026-10-20',
        payDue: '2026-10-20',
      });
      // Только сдача — к оплате не относится.
      await report('t1', {
        ...mine,
        ...sep,
        reportTypeCode: 't1m',
        act: 'sub',
        dueBase: '2026-10-15',
        dueDate: '2026-10-15',
      });
      // Август оплачен целиком.
      await report('ndsAug', {
        ...mine,
        reportTypeCode: 'nds',
        period: 'M',
        periodStart: '2026-08-01',
        act: 'both',
        dueBase: '2026-09-21',
        dueDate: '2026-09-21',
        payDue: '2026-09-25',
        amount: 300_000,
        paid: 300_000,
      });
      // Контрагент главного бухгалтера, но отчёт ведёт бухгалтер.
      await report('chiefNds', {
        contractorId: cpChief,
        responsibleEmployeeId: employee('acc-a'),
        ...sep,
        reportTypeCode: 'nds',
        act: 'both',
        dueBase: '2026-10-20',
        dueDate: '2026-10-20',
        payDue: '2026-10-25',
        amount: 100_000,
      });
      await taxpay(true);
    });

    afterAll(async () => {
      await f?.t.drop();
    });

    it('налоги месяца с остатком от ближайшего срока, итог, реквизит и текст по шаблону', async () => {
      const p = await pay(owner, cpA, '2026-09');
      expect(p.rows.map((x) => [x.reportId, x.left, x.due])).toEqual([
        [ids.pat, 87_050, '2026-10-20'],
        [ids.nds, 380_000, '2026-10-25'],
      ]);
      expect(p).toMatchObject({
        month: '2026-09',
        total: 467_050,
        noAmount: 1,
        due: '2026-10-20',
        refusal: null,
      });
      expect(p.requisite).toBe('Перевод по номеру 0555 123 456 (M-Bank), получатель Бухгалтер А.');
      expect(som(467_050).replace(/\s/g, ' ')).toBe('4 670,50 сом');
      const [patName, ndsName] = p.rows.map((x) => x.name);
      expect(p.text).toBe(
        `Уважаемые ОсОО «Ала-Тоо Трейд»! Налоги к оплате за сентябрь 2026: ${patName} — ${som(87_050)} (до 20.10.2026), ${ndsName} — ${som(380_000)} (до 25.10.2026). Итого — ${som(467_050)}. Просим перечислить до 20.10.2026 на: ${p.requisite}`,
      );
      // Шаблон waPayMonth справочника платформы — вместо запасного текста.
      await f.t.admin.db
        .insert(schema.messageTemplateTexts)
        .values({
          key: 'waPayMonth',
          text: '{контрагент}: {сумма} до {срок} на {реквизиты}',
          sortOrder: 999,
        })
        .onConflictDoUpdate({
          target: schema.messageTemplateTexts.key,
          set: { text: '{контрагент}: {сумма} до {срок} на {реквизиты}' },
        });
      try {
        expect((await pay(owner, cpA, '2026-09')).text).toBe(
          `ОсОО «Ала-Тоо Трейд»: ${som(467_050)} до 20.10.2026 на ${p.requisite}`,
        );
      } finally {
        await f.t.admin.db
          .delete(schema.messageTemplateTexts)
          .where(eq(schema.messageTemplateTexts.key, 'waPayMonth'));
      }
    });

    it('платить нечего — строк и текста нет; копировать нечего — 409', async () => {
      expect(await pay(owner, cpA, '2026-08')).toEqual({
        month: '2026-08',
        rows: [],
        total: 0,
        noAmount: 0,
        due: null,
        requisite: null,
        text: null,
        refusal: null,
        // «Напоминания в Telegram» и «Страница контрагента по ссылке» выключены — кнопки отправки нет.
        send: null,
      });
      expect(await pay(owner, cpA, '2026-01')).toMatchObject({ rows: [], text: null });
      const res = await copied(owner, cpA, '2026-08');
      expect(res.status).toBe(409);
      expect(await codeOf(res)).toBe('month_pay_empty');
    });

    it('без «Учёта оплаты налогов» — вся сумма и без реквизита', async () => {
      await taxpay(false);
      try {
        const p = await pay(owner, cpA, '2026-09');
        expect(p.rows.map((x) => x.left)).toEqual([87_050, 500_000]);
        expect(p).toMatchObject({ total: 587_050, requisite: null });
        expect(p.text).toMatch(/на: —$/);
        // Оплаченный август без учёта оплаты тоже «к оплате»: оплата не отмечается.
        expect((await pay(owner, cpA, '2026-08')).total).toBe(300_000);
      } finally {
        await taxpay(true);
      }
    });

    it('«Скопировать для клиента» пишет в историю контрагента месяц и сумму', async () => {
      const res = await copied(acc, cpA, '2026-09');
      expect(res.status, await res.clone().text()).toBe(200);
      expect(ContractorMonthPay.parse(await res.json()).total).toBe(467_050);
      const lines = await payTextLines(owner, cpA);
      expect(lines.map((h) => h.changes[0])).toMatchObject([
        { field: 'payText', to: { month: '2026-09', total: 467_050 } },
      ]);
      // Повтор того же нажатия вторую запись не добавляет; другой сотрудник — своя запись.
      expect((await copied(acc, cpA, '2026-09')).status).toBe(200);
      expect(await payTextLines(owner, cpA)).toHaveLength(1);
      expect((await copied(owner, cpA, '2026-09')).status).toBe(200);
      expect(await payTextLines(owner, cpA)).toHaveLength(2);
      // Одновременные нажатия одного сотрудника идут по очереди: запись всё равно одна.
      const burst = await Promise.all([1, 2, 3, 4].map(() => copied(chief, cpA, '2026-09')));
      expect(burst.map((r) => r.status)).toEqual([200, 200, 200, 200]);
      expect(await payTextLines(owner, cpA)).toHaveLength(3);
    });

    it('при равном сроке оплаты — по краткому названию вида, как строки месяца', async () => {
      // У отчёта без суммы появляется сумма: срок оплаты тот же, что у патента.
      await f.t.admin.db
        .update(schema.reports)
        .set({ amount: 10_000 })
        .where(eq(schema.reports.id, ids.utli!));
      try {
        const p = await pay(owner, cpA, '2026-09');
        const same = p.rows.filter((x) => x.due === '2026-10-20');
        expect(same.map((x) => x.reportId).sort()).toEqual([ids.pat, ids.utli].sort());
        expect(same.map((x) => x.name)).toEqual(
          [...same.map((x) => x.name)].sort((a, b) => a.localeCompare(b, 'ru')),
        );
        expect(p.rows.at(-1)!.reportId).toBe(ids.nds);
        expect(p).toMatchObject({ total: 477_050, noAmount: 0 });
      } finally {
        await f.t.admin.db
          .update(schema.reports)
          .set({ amount: null })
          .where(eq(schema.reports.id, ids.utli!));
      }
    });

    it('реквизит: счёт организации для налогов, а без счёта — «—»', async () => {
      await f.t.admin.db
        .update(schema.contractors)
        .set({ paysTo: 'org' })
        .where(eq(schema.contractors.id, cpA));
      try {
        // Счёта для налогов у организации ещё нет.
        const none = await pay(acc, cpA, '2026-09');
        expect(none).toMatchObject({ requisite: null, refusal: null });
        expect(none.text).toMatch(/на: —$/);
        const made = await call(owner, 'POST', '/api/org/accounts', {
          kind: 'acc',
          bankCode: 'БНК-14',
          accountNo: '1091 8200 0456 7012',
          bik: '109018',
          phone: null,
          phoneBanks: [],
          holderName: 'Организация А',
          purpose: 'both',
          mainTax: true,
          mainFee: false,
        });
        expect(made.status, await made.clone().text()).toBeLessThan(300);
        // Счёт организации видит каждый сотрудник — и тот, кто за контрагента не отвечает.
        for (const cookie of [acc, owner]) {
          const p = await pay(cookie, cpA, '2026-09');
          expect(p.requisite).toContain('1091 8200 0456 7012');
          expect(p.requisite).toContain('109018');
          expect(p.text?.endsWith(`на: ${p.requisite}`)).toBe(true);
        }
      } finally {
        await f.t.admin.db
          .update(schema.contractors)
          .set({ paysTo: 'emp' })
          .where(eq(schema.contractors.id, cpA));
      }
    });

    it('реквизит ответственного — только ему, владельцу и главному бухгалтеру; остальным текста нет', async () => {
      // «Кадры» видят всех контрагентов и все отчёты, но без «Видеть все…» реквизит чужого сотрудника
      // не получают (решение 27.10.2026, docs/deviations.md п. В-1, В-25).
      await scope(f.roleIds.hr, 'cps', 'all');
      await scope(f.roleIds.hr, 'reports', 'all');
      try {
        const hr = await signIn(f.app, 'hr-a', TEST_PASSWORD);
        const p = await pay(hr, cpA, '2026-09');
        expect(p).toMatchObject({
          total: 467_050,
          requisite: null,
          text: null,
          refusal: 'month_pay_requisite_hidden',
        });
        // Номера отчётов — случайные UUID и сами могут содержать «555»: телефон ищется в остальном ответе.
        const rows = p.rows.map(({ reportId: _id, ...row }) => row);
        expect(JSON.stringify({ ...p, rows })).not.toContain('555');
        const res = await copied(hr, cpA, '2026-09');
        expect(res.status).toBe(409);
        expect(await codeOf(res)).toBe('month_pay_requisite_hidden');
        expect((await call(hr, 'GET', `/api/staff/${employee('acc-a')}/wallets`)).status).toBe(403);
        // Сам ответственный, владелец и главный бухгалтер реквизит видят.
        for (const cookie of [acc, owner, chief]) {
          const seen = await pay(cookie, cpA, '2026-09');
          expect(seen.requisite).toContain('0555 123 456');
          expect(seen.refusal).toBeNull();
        }
      } finally {
        await scope(f.roleIds.hr, 'cps', 'own');
        await scope(f.roleIds.hr, 'reports', 'own');
      }
    });

    it('часть отчётов месяца вне области сотрудника — неполный итог клиенту не уходит', async () => {
      // «Кадры»: все контрагенты, отчёты — «Свои»; патент контрагента бухгалтера ведёт сотрудник кадров.
      await scope(f.roleIds.hr, 'cps', 'all');
      await f.t.admin.db
        .update(schema.reports)
        .set({ responsibleEmployeeId: employee('hr-a') })
        .where(eq(schema.reports.id, ids.pat!));
      await f.t.admin.db
        .update(schema.contractors)
        .set({ paysTo: 'org' })
        .where(eq(schema.contractors.id, cpA));
      try {
        const hr = await signIn(f.app, 'hr-a', TEST_PASSWORD);
        const p = await pay(hr, cpA, '2026-09');
        expect(p.rows.map((x) => x.reportId)).toEqual([ids.pat]);
        expect(p).toMatchObject({ total: 87_050, text: null, refusal: 'month_pay_partial' });
        const res = await copied(hr, cpA, '2026-09');
        expect(res.status).toBe(409);
        expect(await codeOf(res)).toBe('month_pay_partial');
        // Строку истории с суммой видит тот, кто видит все отчёты контрагента.
        expect(await payTextLines(hr, cpA)).toEqual([]);
        expect((await payTextLines(acc, cpA)).length).toBeGreaterThan(0);
      } finally {
        await scope(f.roleIds.hr, 'cps', 'own');
        await f.t.admin.db
          .update(schema.reports)
          .set({ responsibleEmployeeId: employee('acc-a') })
          .where(eq(schema.reports.id, ids.pat!));
        await f.t.admin.db
          .update(schema.contractors)
          .set({ paysTo: 'emp' })
          .where(eq(schema.contractors.id, cpA));
      }
    });

    it('без права «Просматривать отчёты» суммы налогов в истории контрагента нет', async () => {
      // «Старший»: «Просматривать контрагентов» по всем контрагентам, отчётов не видит.
      await scope(f.roleIds.senior, 'cps', 'all');
      try {
        const again = await signIn(f.app, 'senior-a', TEST_PASSWORD);
        expect(await payTextLines(again, cpA)).toEqual([]);
        expect((await payTextLines(owner, cpA)).length).toBeGreaterThan(0);
      } finally {
        await scope(f.roleIds.senior, 'cps', 'own');
      }
    });

    it('вход, права, область «Свои», чужая организация и неверные данные', async () => {
      const path = `/api/contractors/${cpA}/month-pay?month=2026-09`;
      expect((await call(undefined, 'GET', path)).status).toBe(401);
      expect((await copied(undefined, cpA, '2026-09')).status).toBe(401);
      // «Старший»: «Просматривать контрагентов» есть, «Просматривать отчёты» — нет.
      expect((await call(senior, 'GET', path)).status).toBe(403);
      expect((await copied(senior, cpA, '2026-09')).status).toBe(403);
      // Бухгалтер ведёт отчёт чужого контрагента, но сам контрагент — вне его области.
      const foreign = `/api/contractors/${cpChief}/month-pay?month=2026-09`;
      expect((await call(acc, 'GET', foreign)).status).toBe(404);
      expect((await copied(acc, cpChief, '2026-09')).status).toBe(404);
      expect((await pay(chief, cpChief, '2026-09')).total).toBe(100_000);
      // Другая организация: ни своего контрагента чужим, ни чужого — своим.
      expect((await call(ownerB, 'GET', path)).status).toBe(404);
      expect((await copied(ownerB, cpA, '2026-09')).status).toBe(404);
      expect(
        (await call(owner, 'GET', `/api/contractors/${cpB}/month-pay?month=2026-09`)).status,
      ).toBe(404);
      for (const month of ['', '2026-13', '1999-12', "2026-09'"]) {
        expect(
          (
            await call(
              owner,
              'GET',
              `/api/contractors/${cpA}/month-pay?month=${encodeURIComponent(month)}`,
            )
          ).status,
        ).toBe(400);
        expect((await copied(owner, cpA, month)).status).toBe(400);
      }
      expect(
        (await call(owner, 'GET', '/api/contractors/не-номер/month-pay?month=2026-09')).status,
      ).toBe(400);
      // Отказы в историю не пишут.
      const hist = ContractorHistory.parse(
        await (await call(owner, 'GET', `/api/contractors/${cpChief}/history`)).json(),
      );
      expect(hist.items.some((h) => h.changes.some((x) => x.field === 'payText'))).toBe(false);
    });
  },
);
