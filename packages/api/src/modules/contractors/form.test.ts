import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import {
  ApiError,
  AssignmentList,
  ContractorCreated,
  ContractorFormOptions,
  ContractorGkedNotes,
  ContractorSaved,
  GkedSearchResult,
  ReportList,
} from '@buhuchet/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

// Методы формы контрагента (задача 2.09): окно выбора ГКЭД и создание вместе с отчётами. Сегодня в
// тестах — 18.10.2026.
describe.skipIf(!databaseAvailable())('Форма контрагента: методы API', () => {
  let f: Fixture;
  let owner: string;
  let acc: string;
  let hr: string;
  let senior: string;
  let ownerB: string;
  let innSeq = 100;

  const nextInn = () => `0285509740${String(innSeq++).padStart(4, '0')}`;
  const failure = async (res: Response) => ApiError.parse(await res.json()).error;
  const draft = (patch: Record<string, unknown> = {}) => ({
    name: `ОсОО «Форма ${innSeq}»`,
    inn: nextInn(),
    phone: '+996505890076',
    kind: 'regular',
    formCode: 'ФС-01',
    regimeCode: 'РЕЖ-01',
    gked: '47.11.0',
    startDate: '2026-10-01',
    responsibleEmployeeId: f.people['acc-a']!.employeeId,
    ...patch,
  });
  const create = (body: Record<string, unknown>) =>
    apiRequest(f.app, 'POST', '/api/contractors', owner, body);
  const created = async (body: Record<string, unknown>) => {
    const res = await create(body);
    expect(res.status, await res.clone().text()).toBe(201);
    return ContractorCreated.parse(await res.json());
  };
  const assignmentsOf = async (id: string) =>
    AssignmentList.parse(
      await (await apiRequest(f.app, 'GET', `/api/contractors/${id}/assignments`, owner)).json(),
    ).items;
  const reportsOf = async (id: string) =>
    ReportList.parse(
      await (await apiRequest(f.app, 'GET', '/api/reports?size=all', owner)).json(),
    ).items.filter((r) => r.contractor.id === id);
  const contractorsWithInn = (inn: string) =>
    f.t.admin.db
      .select({ id: schema.contractors.id })
      .from(schema.contractors)
      .where(and(eq(schema.contractors.orgId, f.a.orgId), eq(schema.contractors.inn, inn)));
  const search = async (q: string, cookie = acc) => {
    const res = await apiRequest(
      f.app,
      'GET',
      `/api/contractors/gked-search?q=${encodeURIComponent(q)}`,
      cookie,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    return GkedSearchResult.parse(await res.json());
  };

  beforeAll(async () => {
    f = await createStaffFixture();
    await seedAllPlatformDictionaries(f.t.admin.db);
    [owner, acc, hr, senior, ownerB] = await Promise.all([
      signIn(f.app, 'owner-a', TEST_PASSWORD),
      signIn(f.app, 'acc-a', TEST_PASSWORD),
      signIn(f.app, 'hr-a', TEST_PASSWORD),
      signIn(f.app, 'senior-a', TEST_PASSWORD),
      signIn(f.app, 'owner-b', TEST_PASSWORD),
    ]);
    const res = await apiRequest(f.app, 'POST', '/api/org-report-types/connect', owner, {
      connect: ['nds', 'nspm', 'npa', 'enq', 'endo', 'soc'],
      disconnect: [],
    });
    expect(res.status, await res.clone().text()).toBe(200);
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('окно выбора ГКЭД: по началу кода и словам названия — действующие подклассы, путь от секции, первые 80 и сколько всего', async () => {
    const code = await search('69.20');
    expect(code).toEqual({
      items: [
        {
          code: '69.20.0',
          name: 'Деятельность в области бухгалтерского учета и аудита',
          path: ['M', 'MA', '69', '69.2', '69.20'],
        },
      ],
      total: 1,
    });
    // Все слова, без учёта регистра и «ё»; выше подкласса ничего не предлагается.
    const words = await search('УЧЁТА бухгалтерского');
    expect(words.items.map((x) => x.code)).toEqual(['69.20.0']);
    const trade = await search('47');
    expect(trade.total).toBe(trade.items.length);
    expect(trade.items.every((x) => /^47\.\d\d\.\d$/.test(x.code))).toBe(true);
    expect(trade.items[0]).toMatchObject({ code: '47.11.0', path: ['G', '47', '47.1', '47.11'] });
    // Пустой поиск — первые 80 по порядку справочника и сколько всего.
    const all = await search('');
    expect(all.items).toHaveLength(80);
    expect(all.total).toBeGreaterThan(80);
    expect(all.items.every((x) => /^\d\d\.\d\d\.\d$/.test(x.code))).toBe(true);
    // Знаки шаблона LIKE — обычные символы.
    expect((await search('%')).total).toBe(0);
    expect((await search('_')).total).toBe(0);
    // Справочник платформы один на всех: другая организация видит то же.
    expect(await search('69.20', ownerB)).toEqual(code);

    const anon = await apiRequest(f.app, 'GET', '/api/contractors/gked-search?q=69');
    expect(anon.status).toBe(401);
    const long = await apiRequest(
      f.app,
      'GET',
      `/api/contractors/gked-search?q=${'4'.repeat(201)}`,
      acc,
    );
    expect(long.status).toBe(400);
  });

  it('значения формы: действующие сотрудники, ответственный по умолчанию и видна ли плата за обслуживание', async () => {
    const options = async (cookie: string) => {
      const res = await apiRequest(f.app, 'GET', '/api/contractors/form-options', cookie);
      expect(res.status, await res.clone().text()).toBe(200);
      return ContractorFormOptions.parse(await res.json());
    };
    const all = await options(owner);
    const ids = all.employees.map((e) => e.id);
    expect(ids).toContain(f.people['acc-a']!.employeeId);
    expect(ids).toContain(f.people['hr-a']!.employeeId);
    // Сотрудники другой организации не видны.
    expect(ids).not.toContain(f.people['acc-b']!.employeeId);
    // Владелец видит всех контрагентов — ответственного не подставляем; плата в организации выключена.
    expect(all).toMatchObject({ defaultResponsible: null, fee: false, feeOn: false });
    // Область «Свои контрагенты» — ответственный по умолчанию он сам.
    expect((await options(hr)).defaultResponsible).toBe(f.people['hr-a']!.employeeId);
    // Без права «Создавать и изменять контрагентов» формы нет.
    const denied = await apiRequest(f.app, 'GET', '/api/contractors/form-options', senior);
    expect(denied.status).toBe(403);
  });

  it('п. 56, 57: сверка для формы даёт окно «Проверьте право на режим» с текстом и кнопкой, как в прототипе', async () => {
    const check = async (body: Record<string, unknown>) => {
      const res = await apiRequest(f.app, 'POST', '/api/contractors/gked-check', owner, {
        formCode: 'ФС-01',
        regime2Code: null,
        ...body,
      });
      expect(res.status, await res.clone().text()).toBe(200);
      return ContractorGkedNotes.parse(await res.json());
    };
    const tail =
      '\n\nПодтвердите: режим сохранится, в карточке останется предупреждение, в историю запишется, кто подтвердил.';
    // Связь (61.10) — вопрос группы и «Нет, не оказывает».
    const net = await check({ gked: '61.10.0', regimeCode: 'РЕЖ-03' });
    expect(net.confirm).toEqual({
      title: net.ask,
      text: expect.stringMatching(
        /^Основной ГКЭД 61\.10\.0 «Предоставление услуг проводной связи»/,
      ),
      ok: 'Нет, не оказывает',
    });
    expect(net.ask).not.toBe('');
    expect(net.confirm!.text.endsWith(`Если оказывает — режим применять нельзя.${tail}`)).toBe(
      true,
    );
    // МФО (64.19.2) — общий вопрос «Подтверждаю».
    const mfo = await check({ gked: '64.19.2', regimeCode: 'РЕЖ-03' });
    expect(mfo.confirm).toMatchObject({
      title: 'Проверьте право на режим «Единый налог»',
      ok: 'Подтверждаю',
    });
    expect(mfo.confirm!.text).toMatch(
      /^Основной ГКЭД 64\.19\.2 «Денежное посредничество прочих финансовых учреждений».*Если контрагент ведёт запрещённую деятельность, режим применять нельзя\.\n\n/s,
    );
    // ИП на патенте с ювелирной торговлей — вне перечня для ИП: все коды в тексте.
    const jewel = await check({ formCode: 'ФС-02', gked: '47.77.0', regimeCode: 'РЕЖ-02' });
    expect(jewel.confirm).toMatchObject({
      title: 'Проверьте право на режим «Патент»',
      ok: 'Подтверждаю',
    });
    expect(jewel.confirm!.text).toMatch(
      /^Ни один вид деятельности контрагента \(47\.77\.0 «Розничная торговля в специализированных магазинах часами и ювелирными изделиями»\) не входит в перечень режима «Патент» для ИП/,
    );
    // Без вопроса окна нет.
    expect(
      (await check({ formCode: 'ФС-02', gked: '47.11.0', regimeCode: 'РЕЖ-02' })).confirm,
    ).toBeNull();
  });

  it('новый контрагент создаётся одним целым вместе с отчётами: ставки по умолчанию и выбранные, отчёты на сегодня', async () => {
    const cp = await created(
      draft({
        bizSize: 'medium',
        reports: [
          { code: 'nds' },
          { code: 'npa' },
          { code: 'nspm', rate: '3 %', rateAdditions: ['anon'] },
          { code: 'endo' },
        ],
      }),
    );
    const reports = await reportsOf(cp.id);
    expect(cp.reportsCreated).toBe(reports.length);
    expect(cp.reportsCreated).toBeGreaterThan(0);
    expect(new Set(reports.map((r) => r.type.code))).toEqual(
      new Set(['nds', 'npa', 'nspm', 'endo']),
    );
    // Ответственный за отчёты — ответственный контрагента.
    expect(reports.every((r) => r.responsible?.id === f.people['acc-a']!.employeeId)).toBe(true);
    const items = await assignmentsOf(cp.id);
    const by = (code: string) => items.find((a) => a.reportTypeCode === code);
    expect(items).toHaveLength(4);
    // Ставка не выбрана — по умолчанию (прототип defRate: первая ставка вида).
    expect(by('nds')).toMatchObject({ rate: '12 %', rateAdditions: [] });
    expect(by('npa')).toMatchObject({ rate: '10 %' });
    expect(by('nspm')).toMatchObject({ rate: '3 %', rateAdditions: ['anon'] });
    expect(by('endo')).toMatchObject({ rate: '10 %' });
    const history = await f.t.admin.db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.contractorId, cp.id),
          eq(schema.auditLog.entity, 'assignment'),
          eq(schema.auditLog.action, 'create'),
        ),
      );
    expect(history).toHaveLength(4);
  });

  it('сотрудник с областью «Свои» создаёт контрагента за собой вместе с отчётами и видит его', async () => {
    const res = await apiRequest(
      f.app,
      'POST',
      '/api/contractors',
      hr,
      draft({ responsibleEmployeeId: f.people['hr-a']!.employeeId, reports: [{ code: 'nds' }] }),
    );
    expect(res.status, await res.clone().text()).toBe(201);
    const cp = ContractorCreated.parse(await res.json());
    expect(cp.reportsCreated).toBeGreaterThan(0);
    expect((await assignmentsOf(cp.id)).map((a) => a.reportTypeCode)).toEqual(['nds']);
    const own = await apiRequest(f.app, 'GET', `/api/contractors/${cp.id}`, hr);
    expect(own.status).toBe(200);
  });

  it('ставка единого налога подставляется по основному ГКЭД строкой справочника целиком', async () => {
    const cp = await created(
      draft({
        regimeCode: 'РЕЖ-03',
        gked: '69.20.0',
        reports: [{ code: 'enq' }, { code: 'endo' }],
      }),
    );
    const items = await assignmentsOf(cp.id);
    // Услуги (69.20) — «Остальные виды деятельности» ЕНС-04: 4 % безнал + 6 % нал.
    expect(items.find((a) => a.reportTypeCode === 'enq')).toMatchObject({
      enRates: [{ code: 'ЕНС-04', variant: null }],
    });
    // Выбранная бухгалтером строка сохраняется как есть.
    const own = await created(
      draft({
        regimeCode: 'РЕЖ-03',
        gked: '69.20.0',
        reports: [{ code: 'enq', enRates: [{ code: 'ЕНС-01', variant: null }] }],
      }),
    );
    expect((await assignmentsOf(own.id))[0]).toMatchObject({
      enRates: [{ code: 'ЕНС-01', variant: null }],
    });
  });

  it('у постоянного нужен хотя бы один отчёт; неверный отчёт или ставка — ничего не создаётся, повторное «Сохранить» не упирается в ИНН', async () => {
    const body = draft();
    const refused = async (patch: Record<string, unknown>, status: number, code: string) => {
      const res = await create({ ...body, ...patch });
      const error = await failure(res);
      expect([res.status, error.code, error.details]).toEqual([
        status,
        code,
        expect.objectContaining({ field: 'reports' }),
      ]);
      return error;
    };
    expect((await refused({ reports: [] }, 400, 'reports_required')).message).toBe(
      'Выберите хотя бы один отчёт',
    );
    // НДС к единому налогу не подходит.
    await refused(
      { regimeCode: 'РЕЖ-03', gked: '69.20.0', reports: [{ code: 'nds' }] },
      400,
      'report_type_incompatible',
    );
    // Вид не подключён в организации; нет такого вида.
    await refused({ reports: [{ code: 'fin' }] }, 409, 'report_type_not_connected');
    await refused({ reports: [{ code: 'нет-такого' }] }, 400, 'validation_failed');
    // Ставки — только из ставок вида; строки ЕНС — только у единого налога.
    await refused({ reports: [{ code: 'nds', rate: '7 %' }] }, 400, 'rate_invalid');
    await refused(
      { reports: [{ code: 'nds', enRates: [{ code: 'ЕНС-04', variant: null }] }] },
      400,
      'en_rates_invalid',
    );
    await refused(
      { reports: [{ code: 'nds', rateAdditions: ['anon'] }] },
      400,
      'rate_additions_invalid',
    );
    // У разового отчётов нет.
    await refused({ kind: 'oneoff', reports: [{ code: 'nds' }] }, 400, 'validation_failed');
    expect(await contractorsWithInn(body.inn as string)).toEqual([]);

    // После отказов тот же ИНН сохраняется: наполовину созданной записи нет.
    const cp = await created({ ...body, reports: [{ code: 'nds' }] });
    expect(cp.inn).toBe(body.inn);
    // Разовый — без отчётов; запрос без поля `reports` — контрагент без отчётов (docs/decisions.md п. А-5).
    const oneoff = await created(draft({ kind: 'oneoff', reports: [] }));
    expect(oneoff.reportsCreated).toBe(0);
    const bare = await created(draft());
    expect([bare.reportsCreated, await assignmentsOf(bare.id)]).toEqual([0, []]);
  });

  it('снятый с подтверждением обязательный отчёт — запись «Не назначен отчёт …, хотя он …» в истории контрагента', async () => {
    const cp = await created(
      draft({
        regimeCode: 'РЕЖ-03',
        gked: '69.20.0',
        reports: [{ code: 'endo' }],
        // НДС не обязателен этому контрагенту, ЕНД назначен — о них записей нет.
        reportsForced: ['enq', 'nds', 'endo'],
      }),
    );
    const notes = await f.t.admin.db
      .select({ reason: schema.auditLog.reason })
      .from(schema.auditLog)
      .where(
        and(eq(schema.auditLog.contractorId, cp.id), eq(schema.auditLog.entity, 'contractor')),
      );
    expect(notes.map((n) => n.reason).filter((r) => r?.startsWith('Не назначен'))).toEqual([
      'Не назначен отчёт Единый налог, квартальный, хотя он обязателен по режиму «Единый налог»',
    ]);
  });

  it('статус по УГНС, снятый в форме вручную, сервер не возвращает; оставленный — в истории', async () => {
    const large = 'Отмечен статус «Крупный налогоплательщик» по УГНС';
    const reasons = async (id: string) =>
      (
        await f.t.admin.db
          .select({ reason: schema.auditLog.reason })
          .from(schema.auditLog)
          .where(
            and(eq(schema.auditLog.contractorId, id), eq(schema.auditLog.entity, 'contractor')),
          )
      )
        .map((n) => n.reason)
        .filter((r) => r?.includes('по УГНС'));

    // Без списка в запросе (загрузка, другие клиенты) статус ставит сервер.
    const auto = await created(draft({ taxOfficeCode: 'ugns-large' }));
    expect([auto.benefits.map((b) => b.code), auto.notices]).toEqual([['ЛЬГ-30'], [large]]);

    // Форма сняла статус — список как прислан, без уведомления.
    const removed = await created(draft({ taxOfficeCode: 'ugns-large', benefits: [] }));
    expect([removed.benefits, removed.notices, await reasons(removed.id)]).toEqual([[], [], []]);

    // Форма оставила статус — запись «Отмечен статус … по УГНС».
    const kept = await created(
      draft({
        taxOfficeCode: 'ugns-large',
        benefits: [{ code: 'ЛЬГ-30', validFrom: null, validTo: null }],
      }),
    );
    expect([kept.benefits.map((b) => b.code), kept.notices, await reasons(kept.id)]).toEqual([
      ['ЛЬГ-30'],
      [large],
      [large],
    ]);

    // «Изменить»: смена УГНС вместе со списком — статус, который оставили, не снимается.
    const moved = ContractorSaved.parse(
      await (
        await apiRequest(f.app, 'PATCH', `/api/contractors/${kept.id}`, owner, {
          version: kept.version,
          taxOfficeCode: 'ugns-bishkek-lenin',
          benefits: [{ code: 'ЛЬГ-30', validFrom: null, validTo: null }],
        })
      ).json(),
    );
    expect([moved.benefits.map((b) => b.code), moved.notices]).toEqual([['ЛЬГ-30'], []]);
    // Обратно в УГНС крупных, статус сняли вручную — не возвращается.
    const back = ContractorSaved.parse(
      await (
        await apiRequest(f.app, 'PATCH', `/api/contractors/${kept.id}`, owner, {
          version: moved.version,
          taxOfficeCode: 'ugns-large',
          benefits: [],
        })
      ).json(),
    );
    expect([back.benefits, back.notices, await reasons(kept.id)]).toEqual([[], [], [large]]);
  });
});
