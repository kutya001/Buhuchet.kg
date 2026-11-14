import { createHash } from 'node:crypto';
import { CP_TG_MAX, CP_TG_MAX_TOKENS, defaultOrgPolicy } from '@buhuchet/domain';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withOrgContext } from './context';
import { enableContractorPage, tryContractorPageCode } from './contractor-page';
import {
  cleanupContractorTelegramLinks,
  contractorTelegramChats,
  contractorTelegramCounts,
  ContractorTelegramRefusedError,
  decideContractorTelegram,
  issueContractorTelegramLink,
  leaveContractorTelegram,
  listContractorTelegram,
  peekContractorTelegramLink,
  startContractorTelegram,
} from './contractor-telegram';
import { createContractor, type ContractorFields } from './contractors';
import { readHistory } from './history';
import { createOrganization, type CreatedOrganization } from './organizations';
import {
  contractorPages,
  contractors,
  contractorTelegramLinks,
  contractorTelegramTokens,
  orgSettings,
} from './schema';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  seedAllPlatformDictionaries,
  type TestDatabase,
} from './testing';

const permissionDenied = expect.objectContaining({
  cause: expect.objectContaining({ code: '42501' }),
});
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

const contractor = (inn: string, name: string): ContractorFields => ({
  name,
  inn,
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
  feeDay: 10,
  paysTo: 'emp',
  gkedConfirmation: null,
});

describe.skipIf(!databaseAvailable())('Telegram контрагента: данные', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let cpId = '';
  let cpB = '';
  const INN = '03807819461915';
  const GRANT = hash('grant-a');
  const inA = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: a.orgId, userId: a.ownerUserId }, fn);
  const inB = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: b.orgId, userId: b.ownerUserId }, fn);
  /** Бот без входа: контекст организации ссылки без пользователя. */
  const asBot = <T>(orgId: string, fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId, userId: null }, fn);
  const features = (orgId: string, patch: Record<string, boolean>) =>
    db.admin.db
      .update(orgSettings)
      .set({ features: { ...defaultOrgPolicy().features, cppage: true, telegram: true, ...patch } })
      .where(eq(orgSettings.orgId, orgId));
  const issue = (token: string, grant = GRANT, slug = 'tg-a') =>
    issueContractorTelegramLink(db.app.db, {
      slug,
      inn: INN,
      grantHash: grant,
      tokenHash: hash(token),
    });
  /** Клиент открыл ссылку и нажал «Старт». */
  const start = async (token: string, chatId: number, name = 'Клиент') => {
    const peek = await peekContractorTelegramLink(db.app.db, hash(token), chatId);
    if (peek?.state !== 'ok') return { outcome: peek ? ('repeat' as const) : ('invalid' as const) };
    return asBot(peek.orgId, (tx) =>
      startContractorTelegram(tx, { tokenHash: hash(token), chatId, name }),
    );
  };
  let seq = 0;
  /** Готовый запрос «ждёт подтверждения» от нового чата. */
  const request = async (chatId: number, name = 'Клиент') => {
    const token = `t-${++seq}`;
    expect(await issue(token)).toBe('ok');
    const res = await start(token, chatId, name);
    if (res.outcome !== 'asked') throw new Error(`запрос не создан: ${res.outcome}`);
    return res.linkId;
  };
  const versionOf = async (id: string) =>
    (
      await db.admin.db
        .select({ v: contractorTelegramLinks.version })
        .from(contractorTelegramLinks)
        .where(eq(contractorTelegramLinks.id, id))
    )[0]!.v;
  const decide = async (linkId: string, action: 'approve' | 'reject' | 'unlink') =>
    inA(async (tx) =>
      decideContractorTelegram(tx, {
        contractorId: cpId,
        linkId,
        action,
        version: await versionOf(linkId),
      }),
    );

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAccessReference(db.admin.db);
    await seedAllPlatformDictionaries(db.admin.db);
    const owner = (login: string) => ({ fullName: 'Владелец', login, passwordHash: 'x' });
    a = await createOrganization(db.app.db, {
      name: 'Организация А',
      inn: '01811201810456',
      slug: 'tg-a',
      owner: owner('tg-owner-a'),
    });
    b = await createOrganization(db.app.db, {
      name: 'Организация Б',
      inn: '02811201810457',
      slug: 'tg-b',
      owner: owner('tg-owner-b'),
    });
    await features(a.orgId, {});
    await features(b.orgId, {});
    cpId = await inA((tx) => createContractor(tx, a.orgId, contractor(INN, 'ОсОО «Укс»'), null));
    cpB = await inB((tx) => createContractor(tx, b.orgId, contractor(INN, 'ОсОО «Чужой»'), null));
    await inA((tx) => enableContractorPage(tx, cpId, '482915'));
    await inB((tx) => enableContractorPage(tx, cpB, '482915'));
    // Браузер клиента: верный код страницы организации А запомнен.
    const opened = await tryContractorPageCode(db.app.db, {
      slug: 'tg-a',
      inn: INN,
      code: '482915',
      ipHash: hash('ip'),
      tokenHash: GRANT,
    });
    expect(opened.outcome).toBe('ok');
  });

  afterAll(async () => {
    await db?.drop();
  });

  beforeEach(async () => {
    await db.admin.db.delete(contractorTelegramLinks);
    await db.admin.db.delete(contractorTelegramTokens);
    await features(a.orgId, {});
    await db.admin.db
      .update(contractorPages)
      .set({ enabled: true, closedAt: null, hiddenSections: [] });
    await db.admin.db.update(contractors).set({ serviceStatus: 'active' });
  });

  it('новая организация: раздел «Telegram» включён в учётной политике', async () => {
    const [row] = await db.admin.db
      .select({ sections: orgSettings.pageSections })
      .from(orgSettings)
      .where(eq(orgSettings.orgId, a.orgId));
    expect(row!.sections).toContain('tg');
  });

  it('ссылку получает только браузер с запомненным кодом своей страницы', async () => {
    expect(await issue('t1')).toBe('ok');
    expect(await issue('t2', hash('чужой браузер'))).toBe('unavailable');
    // Запомненный код страницы организации А не подходит странице организации Б с тем же ИНН.
    expect(await issue('t3', GRANT, 'tg-b')).toBe('unavailable');
    expect(await issue('t4', GRANT, 'нет-такой')).toBe('unavailable');
  });

  it('ссылка не выдаётся: страница выключена или закрыта, раздел скрыт, функция выключена, архив', async () => {
    await db.admin.db.update(contractorPages).set({ enabled: false });
    expect(await issue('t1')).toBe('unavailable');
    await db.admin.db.update(contractorPages).set({ enabled: true, closedAt: new Date() });
    expect(await issue('t2')).toBe('unavailable');
    await db.admin.db.update(contractorPages).set({ closedAt: null });
    await db.admin.db.update(contractorPages).set({ hiddenSections: ['tg'] });
    expect(await issue('t3')).toBe('unavailable');
    await db.admin.db.update(contractorPages).set({ hiddenSections: [] });
    await features(a.orgId, { telegram: false });
    expect(await issue('t4')).toBe('unavailable');
    await features(a.orgId, {});
    await db.admin.db
      .update(orgSettings)
      .set({ pageSections: ['pay', 'reports'] })
      .where(eq(orgSettings.orgId, a.orgId));
    expect(await issue('t5')).toBe('unavailable');
    await db.admin.db
      .update(orgSettings)
      .set({ pageSections: defaultOrgPolicy().pageSections })
      .where(eq(orgSettings.orgId, a.orgId));
    expect(await issue('t6')).toBe('ok');
  });

  it('«Старт»: запрос ждёт подтверждения, ссылка одноразовая, история — от контрагента', async () => {
    expect(await issue('t1')).toBe('ok');
    const res = await start('t1', 1001, 'Назгуль');
    expect(res).toMatchObject({ outcome: 'asked', contractorId: cpId, contractor: 'ОсОО «Укс»' });
    // Telegram повторил то же сообщение — второй раз не отвечаем; другой чат — «ссылка устарела».
    expect((await start('t1', 1001)).outcome).toBe('repeat');
    expect((await start('t1', 2002)).outcome).toBe('invalid');
    expect((await start('нет такой', 1001)).outcome).toBe('invalid');

    const list = await inA((tx) => listContractorTelegram(tx, cpId));
    expect(list).toMatchObject([{ name: 'Назгуль', status: 'wait', decidedBy: null, version: 1 }]);
    expect(list[0]).not.toHaveProperty('chatId');
    const history = await inA((tx) => readHistory(tx, 'contractor_page', cpId));
    const last = history.at(-1)!;
    expect(last).toMatchObject({ action: 'page_tg_request', actorUserId: null });
    expect(last.changes).toEqual([{ field: 'telegram', to: 'Назгуль' }]);
  });

  it('тот же чат: запрос уже ждёт — второго нет; уже подключён — «уже подключён»', async () => {
    const id = await request(1001);
    expect(await issue('again')).toBe('ok');
    expect(await start('again', 1001)).toMatchObject({ outcome: 'pending', linkId: id });
    await decide(id, 'approve');
    expect(await issue('again2')).toBe('ok');
    expect(await start('again2', 1001)).toMatchObject({ outcome: 'already', linkId: id });
    expect(await inA((tx) => listContractorTelegram(tx, cpId))).toHaveLength(1);
  });

  it('ссылка с истёкшим сроком не работает и удаляется уборкой', async () => {
    expect(await issue('t1')).toBe('ok');
    await db.admin.db
      .update(contractorTelegramTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) });
    expect((await start('t1', 1001)).outcome).toBe('invalid');
    expect(await cleanupContractorTelegramLinks(db.app.db)).toBe(1);
    expect(await db.admin.db.select().from(contractorTelegramTokens)).toHaveLength(0);
  });

  it('ссылка перестаёт работать, когда контрагент в архиве или страницу выключили после выдачи', async () => {
    expect(await issue('t1')).toBe('ok');
    await db.admin.db.update(contractors).set({ serviceStatus: 'archived' });
    expect((await start('t1', 1001)).outcome).toBe('invalid');
    await db.admin.db.update(contractors).set({ serviceStatus: 'active' });
    await db.admin.db.update(contractorPages).set({ enabled: false });
    expect((await start('t1', 1001)).outcome).toBe('invalid');
    // Выключение отзывает выданные ссылки: после включения прежняя не действует.
    await db.admin.db.update(contractorPages).set({ enabled: true });
    expect((await start('t1', 1001)).outcome).toBe('invalid');
    expect(await db.admin.db.select().from(contractorTelegramTokens)).toHaveLength(0);
  });

  it('ссылка, выданная до смены кода страницы или до её закрытия, не работает; использованная остаётся', async () => {
    expect(await issue('t1')).toBe('ok');
    expect(await issue('t2')).toBe('ok');
    expect((await start('t1', 1001)).outcome).toBe('asked');
    // «Сменить код» и повторное включение увеличивают номер кода страницы.
    await db.admin.db
      .update(contractorPages)
      .set({ codeVersion: sql`${contractorPages.codeVersion} + 1` })
      .where(eq(contractorPages.contractorId, cpId));
    try {
      expect((await start('t2', 2002)).outcome).toBe('invalid');
      // Использованная ссылка остаётся до уборки: на повтор сообщения бот не отвечает второй раз.
      expect((await start('t1', 1001)).outcome).toBe('repeat');
      expect(await db.admin.db.select().from(contractorTelegramTokens)).toHaveLength(1);
    } finally {
      await db.admin.db
        .update(contractorPages)
        .set({ codeVersion: sql`${contractorPages.codeVersion} - 1` })
        .where(eq(contractorPages.contractorId, cpId));
    }
    // Страницу закрыли (много неверных кодов) — то же.
    expect(await issue('t3')).toBe('ok');
    await db.admin.db.update(contractorPages).set({ closedAt: new Date() });
    await db.admin.db.update(contractorPages).set({ closedAt: null });
    expect((await start('t3', 3003)).outcome).toBe('invalid');
    // Страница чужой организации ссылки этого контрагента не трогает.
    expect(await issue('t4')).toBe('ok');
    await db.admin.db
      .update(contractorPages)
      .set({ enabled: false })
      .where(eq(contractorPages.contractorId, cpB));
    expect((await start('t4', 4004)).outcome).toBe('asked');
  });

  it('«Старт» — только в транзакции организации ссылки', async () => {
    expect(await issue('t1')).toBe('ok');
    const foreign = await asBot(b.orgId, (tx) =>
      startContractorTelegram(tx, { tokenHash: hash('t1'), chatId: 1001, name: 'Клиент' }),
    );
    expect(foreign.outcome).toBe('invalid');
    expect(await db.admin.db.select().from(contractorTelegramLinks)).toHaveLength(0);
    expect((await start('t1', 1001)).outcome).toBe('asked');
  });

  it(`неиспользованных ссылок — не больше ${CP_TG_MAX_TOKENS}: самая старая заменяется`, async () => {
    for (let i = 0; i <= CP_TG_MAX_TOKENS; i += 1) expect(await issue(`many-${i}`)).toBe('ok');
    expect(await db.admin.db.select().from(contractorTelegramTokens)).toHaveLength(
      CP_TG_MAX_TOKENS,
    );
    expect((await start('many-0', 1001)).outcome).toBe('invalid');
    expect((await start(`many-${CP_TG_MAX_TOKENS}`, 1001)).outcome).toBe('asked');
  });

  it(`мест ${CP_TG_MAX}: подключённые и ждущие считаются вместе`, async () => {
    const ids: string[] = [];
    for (let i = 0; i < CP_TG_MAX - 1; i += 1) ids.push(await request(3000 + i));
    // Ссылка выдана, пока место было; место заняли — «мест нет».
    expect(await issue('last')).toBe('ok');
    expect(await issue('late')).toBe('ok');
    expect((await start('last', 3100)).outcome).toBe('asked');
    expect(await start('late', 3200)).toMatchObject({ outcome: 'limit', contractor: 'ОсОО «Укс»' });
    expect(await issue('full')).toBe('full');
    expect(await inA((tx) => contractorTelegramCounts(tx, cpId))).toEqual({
      on: 0,
      wait: CP_TG_MAX,
    });
    // Отклонили один запрос — место освободилось.
    await decide(ids[0]!, 'reject');
    expect(await issue('free')).toBe('ok');
  });

  it('решение сотрудника: подтвердить, отключить, отклонить; история и версия', async () => {
    const id = await request(1001, 'Назгуль');
    const on = await decide(id, 'approve');
    expect(on).toEqual({ chatId: 1001, name: 'Назгуль', contractor: 'ОсОО «Укс»', status: 'on' });
    const [row] = await inA((tx) => listContractorTelegram(tx, cpId));
    expect(row).toMatchObject({ status: 'on', decidedBy: 'Владелец', byClient: false, version: 2 });
    expect(row!.decidedAt).not.toBeNull();

    // Решение по устаревшему списку — «запись изменена другим пользователем».
    await expect(
      inA((tx) =>
        decideContractorTelegram(tx, {
          contractorId: cpId,
          linkId: id,
          action: 'unlink',
          version: 1,
        }),
      ),
    ).rejects.toMatchObject({ code: 'record_changed' });
    await expect(decide(id, 'approve')).rejects.toBeInstanceOf(ContractorTelegramRefusedError);
    await expect(decide(id, 'reject')).rejects.toMatchObject({ code: 'cp_tg_done' });
    expect((await decide(id, 'unlink')).status).toBe('off');
    await expect(decide(id, 'unlink')).rejects.toMatchObject({ code: 'cp_tg_not_on' });

    const no = await request(2002, 'Азамат');
    expect((await decide(no, 'reject')).status).toBe('no');
    const actions = (await inA((tx) => readHistory(tx, 'contractor_page', cpId))).map(
      (h) => h.action,
    );
    expect(actions.slice(-5)).toEqual([
      'page_tg_request',
      'page_tg_on',
      'page_tg_off',
      'page_tg_request',
      'page_tg_no',
    ]);
  });

  it(`подтвердить нельзя, когда уже подключено ${CP_TG_MAX}`, async () => {
    const ids: string[] = [];
    for (let i = 0; i < CP_TG_MAX; i += 1) ids.push(await request(4000 + i));
    for (const id of ids) await decide(id, 'approve');
    // Шестая строка «ждёт» могла остаться только от прежних правил: вставляем её владельцем таблиц.
    const [extra] = await db.admin.db
      .insert(contractorTelegramLinks)
      .values({ orgId: a.orgId, contractorId: cpId, chatId: 4999, name: 'Шестой' })
      .returning({ id: contractorTelegramLinks.id });
    await expect(decide(extra!.id, 'approve')).rejects.toMatchObject({ code: 'cp_tg_limit' });
    expect((await decide(extra!.id, 'reject')).status).toBe('no');
  });

  it('клиент отключается сам: только свой чат и только подключённая строка', async () => {
    const id = await request(1001, 'Назгуль');
    expect(await contractorTelegramChats(db.app.db, 1001)).toEqual([]);
    await decide(id, 'approve');
    const chats = await contractorTelegramChats(db.app.db, 1001);
    expect(chats).toEqual([
      { linkId: id, orgId: a.orgId, contractorId: cpId, contractor: 'ОсОО «Укс»' },
    ]);
    // Чужой чат строку не отключит.
    expect(
      await asBot(a.orgId, (tx) => leaveContractorTelegram(tx, { linkId: id, chatId: 2002 })),
    ).toBe(false);
    expect(
      await asBot(a.orgId, (tx) => leaveContractorTelegram(tx, { linkId: id, chatId: 1001 })),
    ).toBe(true);
    expect(
      await asBot(a.orgId, (tx) => leaveContractorTelegram(tx, { linkId: id, chatId: 1001 })),
    ).toBe(false);
    const [row] = await inA((tx) => listContractorTelegram(tx, cpId));
    expect(row).toMatchObject({ status: 'off', byClient: true, decidedBy: null });
    const last = (await inA((tx) => readHistory(tx, 'contractor_page', cpId))).at(-1)!;
    expect(last).toMatchObject({ action: 'page_tg_leave', actorUserId: null });
    expect(await contractorTelegramChats(db.app.db, 1001)).toEqual([]);
  });

  it('чужая организация не видна: список, решение и отключение', async () => {
    const id = await request(1001);
    expect(await inB((tx) => listContractorTelegram(tx, cpId))).toEqual([]);
    expect(await inB((tx) => contractorTelegramCounts(tx, cpId))).toEqual({ on: 0, wait: 0 });
    await expect(
      inB((tx) =>
        decideContractorTelegram(tx, {
          contractorId: cpId,
          linkId: id,
          action: 'approve',
          version: 1,
        }),
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    await decide(id, 'approve');
    expect(
      await asBot(b.orgId, (tx) => leaveContractorTelegram(tx, { linkId: id, chatId: 1001 })),
    ).toBe(false);
    // Без контекста организации строк не видно.
    expect(await db.app.db.select().from(contractorTelegramLinks)).toEqual([]);
  });

  it('роль приложения: строку не создать и не удалить, чат и имя не поменять, ссылки не видны', async () => {
    const id = await request(1001);
    await expect(
      inA((tx) =>
        tx
          .insert(contractorTelegramLinks)
          .values({ orgId: a.orgId, contractorId: cpId, chatId: 5, name: 'Сам' }),
      ),
    ).rejects.toEqual(permissionDenied);
    await expect(
      inA((tx) => tx.delete(contractorTelegramLinks).where(eq(contractorTelegramLinks.id, id))),
    ).rejects.toEqual(permissionDenied);
    await expect(
      inA((tx) =>
        tx
          .update(contractorTelegramLinks)
          .set({ chatId: 7 })
          .where(eq(contractorTelegramLinks.id, id)),
      ),
    ).rejects.toEqual(permissionDenied);
    await expect(
      inA((tx) =>
        tx
          .update(contractorTelegramLinks)
          .set({ name: 'Другой' })
          .where(eq(contractorTelegramLinks.id, id)),
      ),
    ).rejects.toEqual(permissionDenied);
    await expect(inA((tx) => tx.select().from(contractorTelegramTokens))).rejects.toEqual(
      permissionDenied,
    );
    await expect(
      db.app.db.execute(sql`select app.contractor_telegram_on(${a.orgId}, ${cpId})`),
    ).rejects.toEqual(permissionDenied);
  });
});
