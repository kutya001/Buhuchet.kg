import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { formatText, UI_TEXTS, type UiTextKey } from '@buhuchet/domain';
import {
  ApiError,
  AssignContractorsResult,
  Contractor,
  ContractorGkedNotes,
  ContractorList,
  ContractorTabCounts,
  ListValues,
  TransferContractorsPreview,
} from '@buhuchet/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD, unzipTexts } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

describe.skipIf(!databaseAvailable())('Контрагенты: методы API', () => {
  let f: Fixture;
  let owner: string;
  let chief: string;
  let acc: string;
  let hr: string;
  let senior: string;
  let ownerB: string;
  let innSeq = 100;

  /** Следующий правильный ИНН: 14 цифр, первая — 0. */
  const nextInn = () => `0374409740${String(innSeq++).padStart(4, '0')}`;
  const employee = (login: string) => f.people[login]!.employeeId;
  const body = (patch: Record<string, unknown> = {}) => ({
    name: 'ОсОО «Ала-Тоо Трейд»',
    inn: nextInn(),
    phone: '+996505890076',
    kind: 'regular',
    formCode: 'ФС-01',
    regimeCode: 'РЕЖ-01',
    gked: '46.34.0',
    gkedExtra: ['47.19.0'],
    bases: ['employees'],
    contractNo: '160/24',
    contractDate: '2024-07-16',
    startDate: '2024-07-16',
    responsibleEmployeeId: employee('acc-a'),
    tariff: { amount: 2_800_000, period: 'M' },
    ...patch,
  });
  const post = (cookie: string, patch: Record<string, unknown> = {}) =>
    apiRequest(f.app, 'POST', '/api/contractors', cookie, body(patch));
  const created = async (cookie: string, patch: Record<string, unknown> = {}) => {
    const res = await post(cookie, patch);
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
    return Contractor.parse(await res.json());
  };
  const get = (cookie: string, path: string) => apiRequest(f.app, 'GET', path, cookie);
  const card = async (cookie: string, id: string) =>
    Contractor.parse(await (await get(cookie, `/api/contractors/${id}`)).json());
  const failure = async (res: Response) => ApiError.parse(await res.json()).error;
  /** Что покажет экран: текст словаря по коду и варианту с подстановками из details. */
  const screen = ({ code, details }: { code: string; details?: unknown }) => {
    const { variant, ...params } = (details ?? {}) as Record<string, string | number>;
    const key = (variant ? `err.${code}.${variant}` : `err.${code}`) as UiTextKey;
    return formatText(UI_TEXTS[key].ru, params);
  };
  const history = (contractorId: string) =>
    f.t.admin.db
      .select()
      .from(schema.auditLog)
      .where(
        and(eq(schema.auditLog.entity, 'contractor'), eq(schema.auditLog.entityId, contractorId)),
      );

  beforeAll(async () => {
    f = await createStaffFixture();
    await seedAllPlatformDictionaries(f.t.admin.db);
    // Функция «Плата за обслуживание» включена у организации А: владелец и главный бухгалтер видят
    // плату (право «Видеть плату за обслуживание»), бухгалтер — нет.
    await f.t.admin.db
      .update(schema.orgSettings)
      .set({ features: { fee: true } })
      .where(eq(schema.orgSettings.orgId, f.a.orgId));
    [owner, chief, acc, hr, senior, ownerB] = await Promise.all([
      signIn(f.app, 'owner-a', TEST_PASSWORD),
      signIn(f.app, 'chief-a', TEST_PASSWORD),
      signIn(f.app, 'acc-a', TEST_PASSWORD),
      signIn(f.app, 'hr-a', TEST_PASSWORD),
      signIn(f.app, 'senior-a', TEST_PASSWORD),
      signIn(f.app, 'owner-b', TEST_PASSWORD),
    ]);
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('создаёт одним целым: карточка, первая ставка с месяца начала, история', async () => {
    const cp = await created(owner, { feeDay: 15, firstMonthMode: 'prorate' });
    expect(cp).toMatchObject({
      name: 'ОсОО «Ала-Тоо Трейд»',
      phoneText: '+996 505 890 076',
      kind: 'regular',
      form: { code: 'ФС-01' },
      regime: { code: 'РЕЖ-01', name: 'ОНР' },
      gked: { code: '46.34.0' },
      gkedExtra: [{ code: '47.19.0' }],
      bases: [{ code: 'employees' }],
      responsible: { id: employee('acc-a'), shortName: 'acc-a', active: true },
      contractNo: '160/24',
      startDate: '2024-07-16',
      feeDay: 15,
      firstMonthMode: 'prorate',
      paysTo: 'emp',
      serviceStatus: 'active',
      tariff: { amount: 2_800_000, period: 'M', validFrom: '2024-07-01' },
      gkedConfirmation: null,
      version: 1,
    });
    const [tariff] = await f.t.admin.db
      .select()
      .from(schema.contractorTariffs)
      .where(eq(schema.contractorTariffs.contractorId, cp.id));
    expect(tariff).toMatchObject({ note: 'Первая ставка', validFrom: '2024-07-01' });
    const [entry] = await history(cp.id);
    expect(entry).toMatchObject({ action: 'create', contractorId: cp.id });
    expect(entry!.changes).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'name', to: cp.name })]),
    );

    // Бухгалтер видит карточку своего контрагента, но не плату за обслуживание.
    expect((await card(acc, cp.id)).tariff).toBeNull();
  });

  it('права: без «Создавать» — 403; ставку задаёт только тот, кто видит плату; у постоянного она обязательна', async () => {
    expect((await post(senior)).status).toBe(403);
    const withTariff = await post(acc);
    expect(withTariff.status).toBe(403);
    expect((await failure(withTariff)).code).toBe('forbidden');
    // Бухгалтер без права «Видеть плату» создаёт контрагента без ставки.
    const cp = await created(acc, { tariff: null });
    expect(cp.tariff).toBeNull();

    const noTariff = await post(owner, { tariff: null });
    expect(noTariff.status).toBe(400);
    expect(await failure(noTariff)).toMatchObject({
      code: 'tariff_required',
      details: { field: 'tariff' },
    });
    const oneoff = await post(owner, { kind: 'oneoff' });
    expect(oneoff.status).toBe(400);
    expect((await failure(oneoff)).code).toBe('validation_failed');
    expect((await created(owner, { kind: 'oneoff', tariff: null })).kind).toBe('oneoff');
  });

  it('ИНН: формат и дубль называет найденного, в том числе архивного', async () => {
    const bad = await post(owner, { inn: '1234567890123' });
    expect(bad.status).toBe(400);
    const badError = await failure(bad);
    expect(badError).toMatchObject({ code: 'inn_format', details: { field: 'inn' } });
    expect(screen(badError)).toBe(badError.message);
    expect((await failure(await post(owner, { inn: '31234567890123' }))).code).toBe('inn_start');

    const first = await created(owner, { name: 'ИП Асанов' });
    const dup = await post(owner, { inn: first.inn });
    expect(dup.status).toBe(409);
    const dupError = await failure(dup);
    expect(dupError).toMatchObject({
      code: 'inn_duplicate',
      message: 'Такой ИНН уже есть: ИП Асанов',
      details: { field: 'inn', id: first.id, name: 'ИП Асанов', archived: false },
    });
    expect(screen(dupError)).toBe(dupError.message);

    await f.t.admin.db
      .update(schema.contractors)
      .set({ serviceStatus: 'archived' })
      .where(eq(schema.contractors.id, first.id));
    const archived = await failure(await post(owner, { inn: first.inn }));
    expect(archived).toMatchObject({
      code: 'inn_duplicate',
      message:
        'Такой ИНН уже есть: ИП Асанов (в архиве — верните его из архива, а не создавайте заново)',
      details: { archived: true, variant: 'archived' },
    });
    expect(screen(archived)).toBe(archived.message);

    // При правке другого контрагента — свой вариант текста.
    const other = await created(owner);
    const edit = await failure(
      await apiRequest(f.app, 'PATCH', `/api/contractors/${other.id}`, owner, {
        version: other.version,
        inn: first.inn,
      }),
    );
    expect(edit).toMatchObject({
      code: 'inn_duplicate',
      message: 'Такой ИНН уже есть: ИП Асанов (в архиве)',
      details: { variant: 'archived_edit' },
    });
    expect(screen(edit)).toBe(edit.message);
  });

  it('неудачное сохранение не создаёт ничего', async () => {
    const count = async () => (await f.t.admin.db.select().from(schema.contractors)).length;
    const before = await count();
    const cases: [Record<string, unknown>, string, string][] = [
      [
        { benefits: [{ code: 'нет-такой', validFrom: null, validTo: null }] },
        'validation_failed',
        'benefits',
      ],
      [{ gked: '46.34' }, 'gked_not_subclass', 'gked'],
      [{ gked: null }, 'gked_required', 'gked'],
      [{ gkedExtra: ['46.34.0'] }, 'gked_extra_main', 'gkedExtra'],
      [{ regimeCode: null, regime2Code: 'РЕЖ-02' }, 'regime2_without_regime', 'regime2Code'],
      [{ phone: '+7123' }, 'invalid_phone', 'phone'],
      [{ formCode: 'нет-такой' }, 'validation_failed', 'formCode'],
      [{ registration: { okpo: '123' } }, 'okpo_format', 'registration.okpo'],
    ];
    for (const [patch, code, field] of cases) {
      const res = await post(owner, patch);
      const err = await failure(res);
      expect(res.status, JSON.stringify(patch)).toBe(400);
      expect(err, JSON.stringify(patch)).toMatchObject({ code, details: { field } });
    }
    expect(await count()).toBe(before);
  });

  it('новое значение — только действующее; отключённое у контрагента сохраняется при правке', async () => {
    const cp = await created(owner, { regimeCode: 'РЕЖ-01' });
    await f.t.admin.db
      .update(schema.taxRegimes)
      .set({ active: false })
      .where(eq(schema.taxRegimes.code, 'РЕЖ-01'));
    try {
      const res = await post(owner);
      expect(res.status).toBe(400);
      expect(await failure(res)).toMatchObject({
        code: 'value_inactive',
        details: { field: 'regimeCode' },
      });
      const saved = await apiRequest(f.app, 'PATCH', `/api/contractors/${cp.id}`, owner, {
        version: cp.version,
        note: 'Режим отключён в справочнике',
      });
      expect(saved.status).toBe(200);
      expect(Contractor.parse(await saved.json()).regime?.code).toBe('РЕЖ-01');
    } finally {
      await f.t.admin.db
        .update(schema.taxRegimes)
        .set({ active: true })
        .where(eq(schema.taxRegimes.code, 'РЕЖ-01'));
    }
  });

  it('ГКЭД: запрет режима — отказ; вопрос о праве — без «Подтверждаю» отказ, с ним — подтверждение у контрагента', async () => {
    const blocked = await post(owner, { gked: '64.19.1', gkedExtra: [], regimeCode: 'РЕЖ-03' });
    expect(blocked.status).toBe(400);
    const blockedError = await failure(blocked);
    expect(blockedError).toMatchObject({ code: 'gked_blocked', details: { field: 'regimeCode' } });
    expect(screen(blockedError)).toBe(blockedError.message);
    expect(String((blockedError.details as { notes: string[] }).notes[0])).toContain('ст. 419');

    const internet = { gked: '61.10.0', gkedExtra: [], regimeCode: 'РЕЖ-03' };
    const ask = await post(owner, internet);
    expect(ask.status).toBe(400);
    const askError = await failure(ask);
    expect(askError).toMatchObject({
      code: 'gked_confirm_required',
      details: { field: 'regimeCode', ask: 'Оказывает услуги интернета?' },
    });
    expect(screen(askError)).toBe(askError.message);

    const cp = await created(owner, { ...internet, gkedConfirm: true });
    const [ownerRow] = await f.t.admin.db
      .select({ shortName: schema.employees.shortName })
      .from(schema.employees)
      .where(eq(schema.employees.id, f.a.ownerEmployeeId));
    expect(cp.gkedConfirmation).toEqual({
      by: ownerRow!.shortName,
      employeeId: f.a.ownerEmployeeId,
      at: '2026-10-18',
      ask: 'Оказывает услуги интернета?',
    });
    expect(cp.gkedNotes.confirmNeeded).toBe(false);
    expect(cp.gkedNotes.regime[0]).toContain(
      `подтвердил ${ownerRow!.shortName} 18.10.2026: «Оказывает услуги интернета?» — нет`,
    );

    // Правка, которая не меняет основание, подтверждение не спрашивает и сохраняет.
    const noted = await apiRequest(f.app, 'PATCH', `/api/contractors/${cp.id}`, owner, {
      version: cp.version,
      note: 'Только связь',
    });
    expect(noted.status).toBe(200);
    const after = Contractor.parse(await noted.json());
    expect(after.gkedConfirmation?.employeeId).toBe(f.a.ownerEmployeeId);

    // Другой основной ГКЭД с тем же вопросом — подтверждение нужно снова.
    const changed = await apiRequest(f.app, 'PATCH', `/api/contractors/${cp.id}`, owner, {
      version: after.version,
      gked: '61.30.0',
    });
    expect(changed.status).toBe(400);
    expect((await failure(changed)).code).toBe('gked_confirm_required');
  });

  it('сверка с ГКЭД для формы: подсказка ставки и вопрос о праве, ничего не сохраняет', async () => {
    const check = (cookie: string, payload: Record<string, unknown>) =>
      apiRequest(f.app, 'POST', '/api/contractors/gked-check', cookie, {
        formCode: 'ФС-01',
        regimeCode: 'РЕЖ-03',
        regime2Code: null,
        ...payload,
      });
    const rate = await check(acc, { gked: '47.11.0' });
    expect(rate.status).toBe(200);
    const notes = ContractorGkedNotes.parse(await rate.json());
    expect(notes.rate[0]).toContain('Ставка единого налога по основному ГКЭД 47.11.0: 0,5 %');
    expect(notes.confirmNeeded).toBe(false);

    const ask = ContractorGkedNotes.parse(await (await check(acc, { gked: '61.10.0' })).json());
    expect(ask).toMatchObject({ confirmNeeded: true, ask: 'Оказывает услуги интернета?' });
    const block = ContractorGkedNotes.parse(await (await check(acc, { gked: '64.19.1' })).json());
    expect(block.block[0]).toContain('ст. 419');

    expect((await check(senior, { gked: '47.11.0' })).status).toBe(403);
    // Сохранённое подтверждение учитывается только у контрагента в области сотрудника.
    const other = await created(owner, { responsibleEmployeeId: employee('chief-a') });
    expect((await check(acc, { gked: '47.11.0', contractorId: other.id })).status).toBe(404);
  });

  it('«Изменить»: с версией, устаревшая — 409; история «было → стало»; архивного не меняют', async () => {
    const cp = await created(owner);
    const res = await apiRequest(f.app, 'PATCH', `/api/contractors/${cp.id}`, owner, {
      version: cp.version,
      phone: '+996555111222',
      gkedExtra: ['47.19.0', '62.01.0'],
    });
    expect(res.status).toBe(200);
    const saved = Contractor.parse(await res.json());
    expect(saved).toMatchObject({ version: cp.version + 1, phoneText: '+996 555 111 222' });
    expect(saved.gkedExtra.map((x) => x.code)).toEqual(['47.19.0', '62.01.0']);

    const stale = await apiRequest(f.app, 'PATCH', `/api/contractors/${cp.id}`, owner, {
      version: cp.version,
      note: 'Устаревшая правка',
    });
    expect(stale.status).toBe(409);
    expect((await failure(stale)).code).toBe('record_changed');

    const updates = (await history(cp.id)).filter((e) => e.action === 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0]!.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'phone', from: '+996505890076', to: '+996555111222' }),
      ]),
    );

    await f.t.admin.db
      .update(schema.contractors)
      .set({ serviceStatus: 'archived' })
      .where(eq(schema.contractors.id, cp.id));
    const archived = await apiRequest(f.app, 'PATCH', `/api/contractors/${cp.id}`, owner, {
      version: saved.version,
      note: 'В архиве',
    });
    expect(archived.status).toBe(409);
    const archivedError = await failure(archived);
    expect(archivedError.code).toBe('contractor_archived');
    expect(screen(archivedError)).toBe(archivedError.message);

    expect(
      (
        await apiRequest(f.app, 'PATCH', `/api/contractors/${cp.id}`, senior, {
          version: saved.version,
          note: 'x',
        })
      ).status,
    ).toBe(403);
  });

  it('область «Свои контрагенты»: бухгалтер видит только своих, чужой — «не найден»', async () => {
    const mine = await created(owner, { name: 'Свой контрагент бухгалтера' });
    const foreign = await created(owner, {
      name: 'Контрагент главного',
      responsibleEmployeeId: employee('chief-a'),
    });

    const list = ContractorList.parse(await (await get(acc, '/api/contractors?size=all')).json());
    expect(list.items.length).toBeGreaterThan(0);
    expect(list.items.every((r) => r.responsible?.id === employee('acc-a'))).toBe(true);
    expect(list.items.some((r) => r.id === mine.id)).toBe(true);
    expect(list.items.every((r) => r.tariff === null)).toBe(true);

    const notFound = await get(acc, `/api/contractors/${foreign.id}`);
    expect(notFound.status).toBe(404);
    const notFoundError = await failure(notFound);
    expect(notFoundError.code).toBe('contractor_not_found');
    expect(screen(notFoundError)).toBe(notFoundError.message);
    const patch = await apiRequest(f.app, 'PATCH', `/api/contractors/${foreign.id}`, acc, {
      version: foreign.version,
      note: 'Не мой',
    });
    expect(patch.status).toBe(404);

    // Владелец видит всех на обслуживании; архивные — только с фильтром «Статус обслуживания».
    const all = ContractorList.parse(await (await get(owner, '/api/contractors?size=all')).json());
    expect(all.items.some((r) => r.id === foreign.id)).toBe(true);
    expect(all.items.every((r) => r.serviceStatus !== 'archived')).toBe(true);
    expect(all.items.find((r) => r.id === foreign.id)?.tariff).toEqual({
      amount: 2_800_000,
      period: 'M',
    });
    const filters = encodeURIComponent('{"service":{"type":"enum","vals":["archived"]}}');
    const archived = ContractorList.parse(
      await (await get(owner, `/api/contractors?size=all&filters=${filters}`)).json(),
    );
    expect(archived.total).toBeGreaterThan(0);
    expect(archived.items.every((r) => r.serviceStatus === 'archived')).toBe(true);

    const counts = ContractorTabCounts.parse(
      await (await get(acc, '/api/contractors/tab-counts')).json(),
    );
    expect(counts.all).toBe(counts.mine);
    const ownerCounts = ContractorTabCounts.parse(
      await (await get(owner, '/api/contractors/tab-counts')).json(),
    );
    expect(ownerCounts.all).toBe(all.total);
    expect(ownerCounts.mine).toBe(0);
    const tabMine = ContractorList.parse(
      await (await get(owner, '/api/contractors?size=all&tab=mine')).json(),
    );
    expect(tabMine.total).toBe(0);

    const values = ListValues.parse(
      await (await get(owner, '/api/contractors/values?col=responsible')).json(),
    );
    expect(values.items.map((v) => v.label)).toEqual(expect.arrayContaining(['acc-a', 'chief-a']));
  });

  it('чужая организация не видна', async () => {
    const cp = await created(owner);
    expect((await get(ownerB, `/api/contractors/${cp.id}`)).status).toBe(404);
    const list = ContractorList.parse(
      await (await get(ownerB, '/api/contractors?size=all')).json(),
    );
    expect(list.total).toBe(0);
    // Тот же ИНН в другой организации — не дубль; ответственный из чужой организации — не найден.
    const res = await apiRequest(f.app, 'POST', '/api/contractors', ownerB, {
      ...body({ inn: cp.inn, tariff: null }),
      responsibleEmployeeId: employee('acc-b'),
    });
    expect(res.status).toBe(201);
    const foreignResponsible = await apiRequest(f.app, 'POST', '/api/contractors', ownerB, {
      ...body({ tariff: null }),
      responsibleEmployeeId: employee('acc-a'),
    });
    expect(foreignResponsible.status).toBe(400);
    const assign = await apiRequest(f.app, 'POST', '/api/contractors/assign', ownerB, {
      ids: [cp.id],
      responsibleEmployeeId: employee('acc-b'),
    });
    expect(assign.status).toBe(404);
  });

  it('ответственный: массово и в карточке, все или никто, с историей', async () => {
    const one = await created(owner);
    const two = await created(owner);
    const res = await apiRequest(f.app, 'POST', '/api/contractors/assign', owner, {
      ids: [one.id, two.id],
      responsibleEmployeeId: employee('chief-a'),
    });
    expect(res.status).toBe(200);
    expect(AssignContractorsResult.parse(await res.json())).toEqual({ changed: 2 });
    expect((await card(owner, one.id)).responsible?.id).toBe(employee('chief-a'));
    const [entry] = (await history(one.id)).filter((e) => e.action === 'update');
    expect(entry!.changes).toEqual([
      { field: 'responsibleEmployeeId', from: employee('acc-a'), to: employee('chief-a') },
    ]);

    // Бухгалтер (право «Создавать и изменять») — только своим; вне области — «не найден» целиком.
    const own = await created(acc, { tariff: null });
    const outside = await apiRequest(f.app, 'POST', '/api/contractors/assign', acc, {
      ids: [own.id, one.id],
      responsibleEmployeeId: employee('chief-a'),
    });
    expect(outside.status).toBe(404);
    expect((await card(owner, own.id)).responsible?.id).toBe(employee('acc-a'));
    expect(
      (
        await apiRequest(f.app, 'POST', '/api/contractors/assign', senior, {
          ids: [own.id],
          responsibleEmployeeId: employee('chief-a'),
        })
      ).status,
    ).toBe(403);

    await f.t.admin.db
      .update(schema.employees)
      .set({ active: false })
      .where(eq(schema.employees.id, employee('senior-a')));
    const inactive = await apiRequest(f.app, 'POST', '/api/contractors/assign', owner, {
      ids: [own.id],
      responsibleEmployeeId: employee('senior-a'),
    });
    expect(inactive.status).toBe(400);
    const inactiveError = await failure(inactive);
    expect(inactiveError.code).toBe('responsible_inactive');
    expect(screen(inactiveError)).toBe(inactiveError.message);
    await f.t.admin.db
      .update(schema.employees)
      .set({ active: true })
      .where(eq(schema.employees.id, employee('senior-a')));

    await f.t.admin.db
      .update(schema.contractors)
      .set({ serviceStatus: 'archived' })
      .where(eq(schema.contractors.id, two.id));
    const archived = await apiRequest(f.app, 'POST', '/api/contractors/assign', owner, {
      ids: [one.id, two.id],
      responsibleEmployeeId: employee('acc-a'),
    });
    expect(archived.status).toBe(409);
    expect(await failure(archived)).toMatchObject({
      code: 'contractor_archived',
      details: { ids: [two.id] },
    });
    expect((await card(owner, one.id)).responsible?.id).toBe(employee('chief-a'));
  });

  it('передача дел: все контрагенты сотрудника — другому, «Кому» по умолчанию — главный бухгалтер', async () => {
    const from = employee('acc-a');
    const preview = await get(hr, `/api/contractors/transfer?from=${from}`);
    expect(preview.status).toBe(200);
    const { contractors, defaultTo } = TransferContractorsPreview.parse(await preview.json());
    expect(contractors).toBeGreaterThan(0);
    expect(defaultTo).toBe(employee('chief-a'));

    expect((await get(acc, `/api/contractors/transfer?from=${from}`)).status).toBe(403);
    const unknown = await get(hr, `/api/contractors/transfer?from=${employee('acc-b')}`);
    expect(unknown.status).toBe(404);
    const unknownError = await failure(unknown);
    expect(unknownError.code).toBe('employee_not_found');
    expect(screen(unknownError)).toBe(unknownError.message);

    const same = await apiRequest(f.app, 'POST', '/api/contractors/transfer', hr, {
      from,
      to: from,
    });
    expect(same.status).toBe(400);
    const sameError = await failure(same);
    expect(sameError.code).toBe('transfer_same');
    expect(screen(sameError)).toBe(sameError.message);

    const res = await apiRequest(f.app, 'POST', '/api/contractors/transfer', hr, {
      from,
      to: employee('chief-a'),
    });
    expect(res.status).toBe(200);
    expect(AssignContractorsResult.parse(await res.json()).changed).toBe(contractors);
    const left = TransferContractorsPreview.parse(
      await (await get(hr, `/api/contractors/transfer?from=${from}`)).json(),
    );
    expect(left.contractors).toBe(0);
  });

  it('удалить: только с правом и без отчётов; история остаётся', async () => {
    const cp = await created(owner);
    expect((await apiRequest(f.app, 'DELETE', `/api/contractors/${cp.id}`, chief)).status).toBe(
      403,
    );
    const res = await apiRequest(f.app, 'DELETE', `/api/contractors/${cp.id}`, owner);
    expect(res.status).toBe(204);
    expect((await get(owner, `/api/contractors/${cp.id}`)).status).toBe(404);
    expect((await apiRequest(f.app, 'DELETE', `/api/contractors/${cp.id}`, owner)).status).toBe(
      404,
    );
    const entries = await history(cp.id);
    expect(entries.map((e) => e.action)).toEqual(expect.arrayContaining(['create', 'delete']));
    expect(entries.every((e) => e.contractorId === null)).toBe(true);
  });

  it('Excel: все записи под фильтрами; плата — только тому, кто видит', async () => {
    await created(owner, { name: 'ОсОО «Выгрузка»' });
    const res = await get(owner, '/api/contractors/export?cols=name,phone,contract,fee&q=Выгрузка');
    expect(res.status).toBe(200);
    const files = unzipTexts(new Uint8Array(await res.arrayBuffer()));
    const sheet = Object.entries(files).find(([name]) => name.includes('sheet1'))?.[1] ?? '';
    const strings = files['xl/sharedStrings.xml'] ?? '';
    expect(`${sheet}${strings}`).toContain('ОсОО «Выгрузка»');
    expect(`${sheet}${strings}`).toContain('+996 505 890 076');
    expect(`${sheet}${strings}`).toContain('№ 160/24 от 16.07.2024');

    // У бухгалтера столбца платы нет — запрос с ним отклоняется как неизвестный столбец.
    expect((await get(acc, '/api/contractors/export?cols=name,fee')).status).toBe(400);
    expect((await get(senior, '/api/contractors/export?cols=name')).status).toBe(403);
  });

  it('день оплаты и «Первый неполный месяц» — только тому, кто видит плату; по умолчанию — 10-е, без поля — «Полный месяц»', async () => {
    const own = await created(owner, { feeDay: 20, firstMonthMode: 'next' });
    expect(own).toMatchObject({ feeDay: 20, firstMonthMode: 'next' });
    // Поле в форме по умолчанию — «Пропорционально дням»; при ставке «в год» поля нет.
    expect(await created(owner)).toMatchObject({ firstMonthMode: 'prorate' });
    expect(await created(owner, { tariff: { amount: 12_000_000, period: 'Y' } })).toMatchObject({
      firstMonthMode: 'full',
    });
    // Создал бухгалтер без права на плату — «Полный месяц» (решение заказчика 27.10.2026, п. А-1).
    const byAcc = await created(acc, { tariff: null });
    expect(byAcc).toMatchObject({ feeDay: null, firstMonthMode: null });
    expect(await card(owner, byAcc.id)).toMatchObject({ feeDay: 10, firstMonthMode: 'full' });

    expect((await post(acc, { tariff: null, feeDay: 12 })).status).toBe(403);
    expect((await post(acc, { tariff: null, firstMonthMode: 'full' })).status).toBe(403);
    const patch = await apiRequest(f.app, 'PATCH', `/api/contractors/${byAcc.id}`, acc, {
      version: byAcc.version,
      feeDay: 12,
    });
    expect(patch.status).toBe(403);
    // Дата начала и «Первый неполный месяц» после создания не меняются: поля «Изменить» их не берут.
    const saved = await apiRequest(f.app, 'PATCH', `/api/contractors/${own.id}`, owner, {
      version: own.version,
      feeDay: 25,
      startDate: '2020-01-01',
      firstMonthMode: 'full',
    });
    expect(saved.status).toBe(200);
    expect(Contractor.parse(await saved.json())).toMatchObject({
      feeDay: 25,
      startDate: '2024-07-16',
      firstMonthMode: 'next',
    });
  });

  it('дубль ИНН вне области называет найденного, но без номера записи', async () => {
    const foreign = await created(owner, {
      name: 'ОсОО «Чужой дубль»',
      responsibleEmployeeId: employee('chief-a'),
    });
    const err = await failure(await post(acc, { inn: foreign.inn, tariff: null }));
    expect(err).toMatchObject({ code: 'inn_duplicate', details: { name: 'ОсОО «Чужой дубль»' } });
    expect(err.details).not.toHaveProperty('id');
    const ownerErr = await failure(await post(owner, { inn: foreign.inn }));
    expect(ownerErr.details).toMatchObject({ id: foreign.id });
  });

  it('нулевой символ в тексте — 400, а не ошибка сервера', async () => {
    for (const patch of [
      { name: 'ОсОО\u0000' },
      { note: 'x\u0000' },
      { formCode: 'ФС\u000001' },
      { registration: { address: 'г. Бишкек\u0000' } },
    ]) {
      const res = await post(owner, patch);
      expect(res.status, JSON.stringify(patch)).toBe(400);
      expect((await failure(res)).code).toBe('validation_failed');
    }
  });

  it('история: подтверждение права на режим, удаление архивного, правка без ГКЭД', async () => {
    const cp = await created(owner, {
      gked: '61.10.0',
      gkedExtra: [],
      regimeCode: 'РЕЖ-03',
      gkedConfirm: true,
    });
    const [entry] = await history(cp.id);
    expect(entry!.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'gkedConfirmation',
          to: expect.objectContaining({
            employeeId: f.a.ownerEmployeeId,
            ask: 'Оказывает услуги интернета?',
          }),
        }),
      ]),
    );

    // У созданного без ГКЭД (до справочника) «Изменить» требует его указать — свой текст.
    await f.t.admin.db
      .update(schema.contractors)
      .set({ gked: null, gkedConfirmation: null, regimeCode: 'РЕЖ-01' })
      .where(eq(schema.contractors.id, cp.id));
    const noGked = await failure(
      await apiRequest(f.app, 'PATCH', `/api/contractors/${cp.id}`, owner, {
        version: cp.version,
        note: 'Без ГКЭД',
      }),
    );
    expect(noGked).toMatchObject({
      code: 'gked_required',
      message: 'Укажите основной вид деятельности (ГКЭД)',
      details: { field: 'gked', variant: 'edit' },
    });
    expect(screen(noGked)).toBe(noGked.message);

    await f.t.admin.db
      .update(schema.contractors)
      .set({ serviceStatus: 'archived' })
      .where(eq(schema.contractors.id, cp.id));
    const del = await apiRequest(f.app, 'DELETE', `/api/contractors/${cp.id}`, owner);
    expect(del.status).toBe(409);
    expect((await failure(del)).code).toBe('contractor_archived');
  });

  it('бухгалтер со «Своими»: значения фильтра и Excel — только его контрагенты', async () => {
    await created(owner, {
      name: 'ОсОО «Не для бухгалтера»',
      responsibleEmployeeId: employee('chief-a'),
    });
    const values = ListValues.parse(
      await (await get(acc, '/api/contractors/values?col=responsible')).json(),
    );
    expect(values.items.map((v) => v.label)).toEqual(['acc-a']);
    const file = await get(acc, '/api/contractors/export?cols=name,responsible');
    expect(file.status).toBe(200);
    const texts = Object.values(unzipTexts(new Uint8Array(await file.arrayBuffer()))).join('');
    expect(texts).not.toContain('Не для бухгалтера');
    expect(texts).not.toContain('chief-a');
  });
});
