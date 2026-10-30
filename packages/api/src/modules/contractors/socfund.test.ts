import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { formatText, UI_TEXTS, type UiTextKey } from '@buhuchet/domain';
import {
  ApiError,
  Contractor,
  ContractorList,
  ContractorSaved,
  ContractorSocfundCheck,
  ReportCard,
  ReportList,
} from '@buhuchet/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

const ALL_YES = { cashless: true, registry: true, confirmed: true, gov: false };
const NO_FLAGS = { cashless: null, registry: null, confirmed: null, gov: null };
const t = (key: UiTextKey, params?: Record<string, string | number>) =>
  formatText(UI_TEXTS[key].ru, params);

// Пункты приёмки ТЗ 38 и 39 на уровне API; экраны (форма 2.09, карточка 2.11, список 2.10, подбор 2.07)
// подключат эти методы. Сегодня в тестах — 18.10.2026.
describe.skipIf(!databaseAvailable())('Тариф Соцфонда: методы API', () => {
  let f: Fixture;
  let owner: string;
  let acc: string;
  let senior: string;
  let ownerB: string;
  let innSeq = 500;

  const nextInn = () => `0374409740${String(innSeq++).padStart(4, '0')}`;
  const employee = (login: string) => f.people[login]!.employeeId;
  const body = (patch: Record<string, unknown> = {}) => ({
    name: `ОсОО «Соцфонд ${innSeq}»`,
    inn: nextInn(),
    phone: '+996505890076',
    kind: 'regular',
    formCode: 'ФС-01',
    regimeCode: 'РЕЖ-01',
    gked: '47.11.0',
    bases: ['employees'],
    startDate: '2026-01-15',
    responsibleEmployeeId: employee('acc-a'),
    ...patch,
  });
  const created = async (cookie: string, patch: Record<string, unknown> = {}) => {
    const res = await apiRequest(f.app, 'POST', '/api/contractors', cookie, body(patch));
    expect(res.status, await res.clone().text()).toBe(201);
    return ContractorSaved.parse(await res.json());
  };
  const card = async (cookie: string, id: string) =>
    Contractor.parse(
      await (await apiRequest(f.app, 'GET', `/api/contractors/${id}`, cookie)).json(),
    );
  const saveSocfund = (cookie: string, id: string, req: Record<string, unknown>) =>
    apiRequest(f.app, 'PUT', `/api/contractors/${id}/socfund`, cookie, req);
  const check = (cookie: string, req: Record<string, unknown>) =>
    apiRequest(f.app, 'POST', '/api/contractors/socfund-check', cookie, req);
  const failure = async (res: Response) => ApiError.parse(await res.json()).error;
  const codes = (cp: { benefits: { code: string }[] }) => cp.benefits.map((b) => b.code).sort();
  const history = (id: string) =>
    f.t.admin.db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.entity, 'contractor'), eq(schema.auditLog.entityId, id)))
      .orderBy(schema.auditLog.at);

  beforeAll(async () => {
    f = await createStaffFixture();
    await seedAllPlatformDictionaries(f.t.admin.db);
    [owner, acc, senior, ownerB] = await Promise.all([
      signIn(f.app, 'owner-a', TEST_PASSWORD),
      signIn(f.app, 'acc-a', TEST_PASSWORD),
      signIn(f.app, 'senior-a', TEST_PASSWORD),
      signIn(f.app, 'owner-b', TEST_PASSWORD),
    ]);
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('п. 38: ОсОО с ГКЭД 47.11 и всеми признаками — СПиНО автоматически; после смены ГКЭД на 64.19.1 — «больше не применим», «Сменить на базовый»', async () => {
    const cp = await created(owner, { socfund: { flags: ALL_YES } });
    expect(cp.socfund).toEqual({
      needed: true,
      flags: ALL_YES,
      tariff: {
        id: 'spino',
        short: 'СПиНО',
        title: 'Тариф Соцфонда 12,25 % (СПиНО)',
        total: '12,25 %',
        manual: false,
        reason: null,
      },
      auto: {
        id: 'spino',
        short: 'СПиНО',
        total: '12,25 %',
        why: ['Все условия выполнены'],
        miss: [],
        warn: [],
      },
      bad: false,
      badWhy: '',
      ask: false,
    });
    // Статус СПиНО (ЛЬГ-29) идёт за тарифом.
    expect(codes(cp)).toEqual(['ЛЬГ-29']);
    const [create] = await history(cp.id);
    expect(create!.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'socfundTariff',
          to: { id: 'spino', manual: false, reason: null },
        }),
      ]),
    );

    // Смена ГКЭД сама тариф не меняет: предупреждение с причиной и тариф по условиям — базовый.
    const res = await apiRequest(f.app, 'PATCH', `/api/contractors/${cp.id}`, owner, {
      version: cp.version,
      gked: '64.19.1',
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const moved = ContractorSaved.parse(await res.json());
    expect(moved.socfund).toMatchObject({
      tariff: { id: 'spino', manual: false },
      auto: { id: 'general' },
      bad: true,
      badWhy: expect.stringMatching(/^Основной ГКЭД 64\.19\.1 не допускает СПиНО: /),
      ask: false,
    });
    expect(codes(moved)).toEqual(['ЛЬГ-29']);

    // «Сменить на базовый»: тариф по условиям — не ручной; статус СПиНО снимается, в истории — смена.
    const switched = await saveSocfund(owner, cp.id, {
      version: moved.version,
      flags: ALL_YES,
      tariff: 'general',
    });
    expect(switched.status, await switched.clone().text()).toBe(200);
    const general = ContractorSaved.parse(await switched.json());
    expect(general.socfund).toMatchObject({
      tariff: { id: 'general', short: 'Базовый тариф', manual: false },
      bad: false,
      ask: false,
    });
    expect(codes(general)).toEqual([]);
    const last = (await history(cp.id)).at(-1)!;
    expect(last.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'socfundTariff',
          from: { id: 'spino', manual: false, reason: null },
          to: { id: 'general', manual: false, reason: null },
        }),
        expect.objectContaining({ field: 'benefits' }),
      ]),
    );
  });

  it('п. 39: резидент ПКИ — «Тариф ПВТ / ПКИ»; ручной «СПиНО» — только с причиной и подтверждением, в списке — «под вопросом»', async () => {
    const cp = await created(owner, {
      gked: '62.01.0',
      benefits: [{ code: 'ЛЬГ-01', validFrom: null, validTo: null }],
      socfund: { flags: NO_FLAGS },
    });
    expect(cp.socfund).toMatchObject({
      tariff: { id: 'pvtpki', short: 'Тариф ПВТ / ПКИ', manual: false },
      auto: { id: 'pvtpki', why: ['Статус «Резидент ПКИ»'] },
      ask: false,
    });

    const manual = { version: cp.version, flags: NO_FLAGS, tariff: 'spino' };
    const noReason = await saveSocfund(owner, cp.id, manual);
    expect(noReason.status).toBe(400);
    expect(await failure(noReason)).toMatchObject({
      code: 'socfund_reason_required',
      details: { field: 'socfund.reason' },
    });
    const noConfirm = await saveSocfund(owner, cp.id, { ...manual, reason: 'письмо ГНС' });
    expect(noConfirm.status).toBe(400);
    expect(await failure(noConfirm)).toEqual({
      code: 'socfund_confirm_required',
      message: t('err.socfund_confirm_required'),
      details: {
        field: 'socfund.tariff',
        text: '«СПиНО» расходится с условиями: Статус «Резидент ПКИ». Сохранить ручной выбор? В истории контрагента запишется, кто и почему его поставил.',
      },
    });
    // Отказ ничего не сохранил.
    expect((await card(owner, cp.id)).socfund.tariff?.id).toBe('pvtpki');

    const saved = await saveSocfund(owner, cp.id, {
      ...manual,
      reason: 'письмо ГНС',
      confirm: true,
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    const spino = ContractorSaved.parse(await saved.json());
    expect(spino.socfund).toMatchObject({
      tariff: { id: 'spino', manual: true, reason: 'письмо ГНС' },
      auto: { id: 'pvtpki' },
      bad: true,
      badWhy: 'Статус «Резидент ПКИ»',
      ask: true,
    });
    expect(codes(spino)).toEqual(['ЛЬГ-01', 'ЛЬГ-29']);
    // В истории — кто и почему выбрал вручную.
    const last = (await history(cp.id)).at(-1)!;
    expect(last.actorUserId).toBe(f.a.ownerUserId);
    expect(last.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'socfundTariff',
          to: { id: 'spino', manual: true, reason: 'письмо ГНС' },
        }),
      ]),
    );

    // Список: строка с тарифом и фильтр «Тариф под вопросом».
    const filters = encodeURIComponent('{"socfundAsk":{"type":"enum","vals":["yes"]}}');
    const asked = ContractorList.parse(
      await (
        await apiRequest(f.app, 'GET', `/api/contractors?size=all&filters=${filters}`, owner)
      ).json(),
    );
    expect(asked.items.find((r) => r.id === cp.id)?.socfund).toEqual({
      id: 'spino',
      short: 'СПиНО',
      total: '12,25 %',
      ask: true,
    });
    expect(asked.items.every((r) => r.socfund?.ask)).toBe(true);
  });

  it('форма и «Льготы и особые статусы» не ставят статус СПиНО в обход тарифа; разовому тариф не нужен', async () => {
    // Без признаков тариф не определён, а переданный статус СПиНО отброшен.
    const cp = await created(owner, {
      benefits: [{ code: 'ЛЬГ-29', validFrom: null, validTo: null }],
    });
    expect(codes(cp)).toEqual([]);
    expect(cp.socfund).toMatchObject({
      needed: true,
      tariff: null,
      auto: {
        id: null,
        miss: ['способ выплаты зарплаты', 'реестр работников', 'подтверждение ГНС'],
      },
      ask: true,
    });
    // «Изменить» с ЛЬГ-29 в льготах тоже его не ставит.
    const res = await apiRequest(f.app, 'PATCH', `/api/contractors/${cp.id}`, owner, {
      version: cp.version,
      benefits: [{ code: 'ЛЬГ-29', validFrom: null, validTo: null }],
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(codes(ContractorSaved.parse(await res.json()))).toEqual([]);

    const once = await created(owner, {
      kind: 'oneoff',
      bases: [],
      socfund: { flags: ALL_YES, tariff: 'spino' },
    });
    expect(once.socfund).toMatchObject({ needed: false, tariff: null, auto: null, ask: false });
    const [row] = await f.t.admin.db
      .select({ flags: schema.contractors.socfundFlags, tariff: schema.contractors.socfundTariff })
      .from(schema.contractors)
      .where(eq(schema.contractors.id, once.id));
    expect(row).toEqual({ flags: {}, tariff: null });
    const put = await saveSocfund(owner, once.id, { version: once.version, flags: ALL_YES });
    expect(put.status).toBe(400);
    expect((await failure(put)).code).toBe('socfund_not_needed');
  });

  it('ответ форме до сохранения: тариф по набранным значениям, причина и подтверждение, тарифы справочника', async () => {
    const draft = {
      kind: 'regular',
      bases: ['employees'],
      gked: '47.11.0',
      formCode: 'ФС-01',
      benefits: [],
      flags: ALL_YES,
    };
    const res = await check(acc, draft);
    expect(res.status, await res.clone().text()).toBe(200);
    const out = ContractorSocfundCheck.parse(await res.json());
    expect(out).toMatchObject({
      needed: true,
      tariff: null,
      auto: { id: 'spino', why: ['Все условия выполнены'] },
      ask: true,
      manualMismatch: false,
      confirm: '',
    });
    expect(out.tariffs.map((x) => [x.id, x.short])).toEqual([
      ['spino', 'СПиНО'],
      ['general', 'Базовый тариф'],
      ['pvtpki', 'Тариф ПВТ / ПКИ'],
    ]);
    expect(out.tariffs[0]!.rates).toBeTruthy();
    expect(out.tariffs[0]!.cap).toBeTruthy();
    expect(out.tariffs[0]!.tariff.parts.length).toBeGreaterThan(0);

    // Ручной «СПиНО» без подтверждения ГНС расходится с условиями.
    const miss = ContractorSocfundCheck.parse(
      await (
        await check(acc, { ...draft, flags: { ...ALL_YES, confirmed: null }, tariff: 'spino' })
      ).json(),
    );
    expect(miss).toMatchObject({
      tariff: { id: 'spino', manual: true },
      manualMismatch: true,
      confirm:
        '«СПиНО» расходится с условиями: не указано: подтверждение ГНС. Сохранить ручной выбор? В истории контрагента запишется, кто и почему его поставил.',
    });

    // Неверные данные — 400; созданный вне области или в другой организации — 404.
    expect((await check(acc, { ...draft, kind: 'нет' })).status).toBe(400);
    expect((await check(acc, { ...draft, flags: { cashless: 'да' } })).status).toBe(400);
    const chiefs = await created(owner, { responsibleEmployeeId: employee('chief-a') });
    expect((await check(acc, { ...draft, contractorId: chiefs.id })).status).toBe(404);
    expect((await check(ownerB, { ...draft, contractorId: chiefs.id })).status).toBe(404);
    // У созданного контрагента — его сохранённый выбор, пока выбор в форме не тронут.
    const stored = ContractorSocfundCheck.parse(
      await (await check(owner, { ...draft, contractorId: chiefs.id })).json(),
    );
    expect(stored.tariff).toBeNull();
  });

  it('окно «Тариф Соцфонда»: право, область, версия, архив; признаки без смены выбора', async () => {
    const cp = await created(owner, { socfund: { flags: ALL_YES } });
    const req = { version: cp.version, flags: { ...ALL_YES, cashless: false } };

    expect((await saveSocfund(senior, cp.id, req)).status).toBe(403);
    expect((await saveSocfund(ownerB, cp.id, req)).status).toBe(404);
    const chiefs = await created(owner, {
      responsibleEmployeeId: employee('chief-a'),
      socfund: { flags: ALL_YES },
    });
    expect((await saveSocfund(acc, chiefs.id, { ...req, version: chiefs.version })).status).toBe(
      404,
    );
    expect((await saveSocfund(acc, cp.id, { ...req, extra: 1 })).status).toBe(400);
    expect(
      (await saveSocfund(acc, cp.id, { ...req, reason: 'x'.repeat(501), tariff: 'general' }))
        .status,
    ).toBe(400);

    // Признаки изменились, выбор не тронут: тариф остаётся, но больше не применим.
    const res = await saveSocfund(acc, cp.id, req);
    expect(res.status, await res.clone().text()).toBe(200);
    const saved = ContractorSaved.parse(await res.json());
    expect(saved.socfund).toMatchObject({
      flags: { ...ALL_YES, cashless: false },
      tariff: { id: 'spino', manual: false },
      auto: { id: 'general', why: ['Зарплата не безналично'] },
      bad: true,
      badWhy: 'Зарплата не безналично',
    });
    expect(saved.version).toBe(cp.version + 1);

    const stale = await saveSocfund(acc, cp.id, req);
    expect(stale.status).toBe(409);
    expect((await failure(stale)).code).toBe('record_changed');

    await f.t.admin.db
      .update(schema.contractors)
      .set({ serviceStatus: 'archived' })
      .where(eq(schema.contractors.id, cp.id));
    const archived = await saveSocfund(owner, cp.id, { ...req, version: saved.version });
    expect(archived.status).toBe(409);
    expect((await failure(archived)).code).toBe('contractor_archived');
  });

  it('карточка отчёта STI-161: ставки тарифа и пеня информационно; без основания «Есть наёмные сотрудники» — тариф по условиям (п. А-5)', async () => {
    const connect = await apiRequest(f.app, 'POST', '/api/org-report-types/connect', owner, {
      connect: ['soc'],
      disconnect: [],
    });
    expect(connect.status, await connect.clone().text()).toBe(200);
    const assignSoc = async (contractorId: string) => {
      const res = await apiRequest(f.app, 'POST', '/api/assignments', owner, {
        contractorId,
        reportTypeCode: 'soc',
        fromMonth: '2026-08-01',
        markPast: false,
      });
      expect(res.status, await res.clone().text()).toBe(201);
    };
    const cp = await created(owner, { socfund: { flags: ALL_YES } });
    await assignSoc(cp.id);
    // П. А-5, решение заказчика (как в прототипе): с действующим STI-161 тариф нужен и без основания
    // «Есть наёмные сотрудники» — признаки и тариф по условиям, выбора ещё нет.
    const noBase = await created(owner, { bases: [], socfund: { flags: ALL_YES } });
    await assignSoc(noBase.id);
    expect((await card(owner, noBase.id)).socfund).toMatchObject({
      needed: true,
      tariff: null,
      auto: { id: 'spino' },
    });

    const reports = ReportList.parse(
      await (await apiRequest(f.app, 'GET', '/api/reports?size=all', owner)).json(),
    )
      .items.filter((r) => r.contractor.id === cp.id)
      .sort((a, b) => a.periodStart.localeCompare(b.periodStart));
    const report = async (id: string) =>
      ReportCard.parse(await (await apiRequest(f.app, 'GET', `/api/reports/${id}`, owner)).json());

    const aug = await report(reports[0]!.id);
    expect(aug.overdue).toBe(true);
    expect(aug.socfund).toEqual({
      tariff: {
        id: 'spino',
        short: 'СПиНО',
        total: '12,25 %',
        rates: expect.any(String),
        cap: expect.any(String),
      },
      auto: expect.objectContaining({ id: 'spino' }),
      capHint: expect.stringMatching(
        /^Взносы не начисляются на часть зарплаты выше предельной базы \(база не выше /,
      ),
    });
    expect(aug.socfund!.tariff!.rates).toMatch(/работодатель/i);
    expect(aug.penalty).toMatch(/^С 21-го числа/);
    expect(aug.penalty).toContain('0,09');
    // Не просроченный — без пени.
    const oct = await report(reports.find((r) => r.periodStart === '2026-10-01')!.id);
    expect(oct.penalty).toBe('');
    expect(oct.socfund?.tariff?.id).toBe('spino');

    // Без основания тарифа в карточке отчёта нет, а пеня — есть.
    const other = ReportList.parse(
      await (await apiRequest(f.app, 'GET', '/api/reports?size=all', owner)).json(),
    ).items.find((r) => r.contractor.id === noBase.id && r.periodStart === '2026-08-01')!;
    const noBaseAug = await report(other.id);
    expect(noBaseAug.socfund).toMatchObject({ tariff: null, auto: { id: 'spino' } });
    expect(noBaseAug.penalty).toContain('0,09');
  });
});
