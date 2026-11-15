import { randomUUID } from 'node:crypto';
import { RecordChangedError, RecordNotFoundError } from '@buhuchet/domain';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext } from './context';
import { enableContractorPage } from './contractor-page';
import { createContractor, type ContractorFields } from './contractors';
import { deleteContractorFiles } from './files';
import { createOrganization, type CreatedOrganization } from './organizations';
import { auditLog, contractorPages, contractorSentFiles, files, orgSettings } from './schema';
import {
  acceptSentFile,
  contractorDocumentNames,
  dropPendingSentFiles,
  dropSentFiles,
  getSentFile,
  insertPendingSentFiles,
  keptSentFiles,
  listContractorSentFiles,
  listSentFilesPage,
  listSentFileValues,
  markSentFilesReady,
  pendingSentFiles,
  rejectSentFile,
  SentFileDecidedError,
  sentFilesLastDay,
  sentFilesNewCount,
  sentUploadState,
  staleSentFiles,
  type NewSentFile,
} from './sent-files';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  seedAllPlatformDictionaries,
  type TestDatabase,
} from './testing';
import { contractorScope } from './contractors';

/*
 * «Отправленные файлы» (доработки 14.11.2026, блок 2): загрузка без входа, решение сотрудника,
 * удаление через 30 дней, вкладка Файлового менеджера и изоляция организаций.
 */

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

const query = (over: Record<string, unknown> = {}) => ({
  sort: { key: 'ord', dir: 'desc' as const },
  page: 1,
  size: 50 as const,
  filters: {},
  ...over,
});

describe.skipIf(!databaseAvailable())('Отправленные файлы контрагента', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let cpA = '';
  let cpA2 = '';
  let cpB = '';
  const inA = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: a.orgId, userId: a.ownerUserId }, fn);
  const inB = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: b.orgId, userId: b.ownerUserId }, fn);
  /** Страница контрагента и бот: контекст организации без пользователя. */
  const asGuest = <T>(orgId: string, fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId, userId: null }, fn);

  const newSent = (orgId: string, contractorId: string, name = 'Акт.pdf'): NewSentFile => {
    const id = randomUUID();
    return {
      id,
      contractorId,
      source: 'page',
      comment: 'Акт сверки',
      name,
      contentType: 'application/pdf',
      sizeBytes: 1200,
      storageKey: `org/${orgId}/sent/${id}`,
    };
  };

  /** Отправить файл со страницы: начатая загрузка, затем «загружен». */
  const send = async (orgId: string, contractorId: string, name?: string) => {
    const row = newSent(orgId, contractorId, name);
    await asGuest(orgId, async (tx) => {
      await insertPendingSentFiles(tx, [row]);
      await markSentFilesReady(tx, [row.id]);
    });
    return row;
  };

  const acceptedFile = (orgId: string, contractorId: string, sentId: string, name: string) => {
    const id = randomUUID();
    return {
      id,
      sourceKind: 'sent_file',
      sourceId: sentId,
      contractorId,
      name,
      contentType: 'application/pdf',
      sizeBytes: 1200,
      storageKey: `org/${orgId}/files/${id}`,
    };
  };

  /** Сдвинуть отправку в прошлое (задача по расписанию смотрит на дату отправки). */
  const backdate = (id: string, days: number) =>
    db.admin.db
      .update(contractorSentFiles)
      .set({ createdAt: sql`now() - make_interval(days => ${days})` })
      .where(eq(contractorSentFiles.id, id));

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAccessReference(db.admin.db);
    await seedAllPlatformDictionaries(db.admin.db);
    const owner = (login: string) => ({ fullName: 'Владелец Первый', login, passwordHash: 'x' });
    a = await createOrganization(db.app.db, {
      name: 'Организация А',
      inn: '01811201810456',
      slug: 'sent-a',
      owner: owner('sent-owner-a'),
    });
    b = await createOrganization(db.app.db, {
      name: 'Организация Б',
      inn: '02811201810457',
      slug: 'sent-b',
      owner: owner('sent-owner-b'),
    });
    cpA = await inA((tx) =>
      createContractor(tx, a.orgId, contractor('03807819461915', 'ОсОО «А»'), null),
    );
    cpA2 = await inA((tx) =>
      createContractor(tx, a.orgId, contractor('03807819461917', 'ОсОО «А-2»'), null),
    );
    cpB = await inB((tx) =>
      createContractor(tx, b.orgId, contractor('03807819461916', 'ОсОО «Б»'), null),
    );
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('можно ли отправлять: страница, раздел «Файлы», галочки политики и контрагента', async () => {
    const state = () => inA((tx) => sentUploadState(tx, cpA));
    // Страница не включалась, функция «Страница контрагента» выключена.
    expect(await state()).toMatchObject({
      pageOpen: false,
      orgUpload: true,
      contractorUpload: true,
    });
    await db.admin.db
      .update(orgSettings)
      .set({ features: sql`${orgSettings.features} || '{"cppage": true}'::jsonb` })
      .where(eq(orgSettings.orgId, a.orgId));
    await inA((tx) => enableContractorPage(tx, cpA, '123456'));
    const on = await state();
    expect(on).toMatchObject({ pageOpen: true, orgUpload: true, contractorUpload: true });
    expect(on?.sections).toContain('files');
    await inA((tx) =>
      tx.update(orgSettings).set({ cpFilesUpload: false }).where(eq(orgSettings.orgId, a.orgId)),
    );
    await inA((tx) =>
      tx
        .update(contractorPages)
        .set({ filesUpload: false })
        .where(eq(contractorPages.contractorId, cpA)),
    );
    expect(await state()).toMatchObject({ orgUpload: false, contractorUpload: false });
    await inA((tx) =>
      tx.update(orgSettings).set({ cpFilesUpload: true }).where(eq(orgSettings.orgId, a.orgId)),
    );
    // Чужой контрагент не виден.
    expect(await inB((tx) => sentUploadState(tx, cpA))).toBeNull();
  });

  it('страница загружает файл: начатая загрузка, «Новый», счёт за сутки; чужая организация не видит', async () => {
    const row = newSent(a.orgId, cpA, 'Выписка.pdf');
    await asGuest(a.orgId, (tx) => insertPendingSentFiles(tx, [row]));
    expect(await inA((tx) => sentFilesLastDay(tx, cpA))).toBe(1);
    // Начатая загрузка в списке не видна; закончить можно только у своего контрагента и только
    // загрузку со страницы (из Telegram её заканчивает сервер).
    expect(await inA((tx) => listContractorSentFiles(tx, cpA))).toEqual([]);
    expect(await asGuest(a.orgId, (tx) => pendingSentFiles(tx, cpA2, [row.id]))).toEqual([]);
    const fromTg = {
      ...newSent(a.orgId, cpA, 'Чек.jpg'),
      source: 'telegram' as const,
      tgChatId: 501,
    };
    await asGuest(a.orgId, (tx) => insertPendingSentFiles(tx, [fromTg]));
    expect(await asGuest(a.orgId, (tx) => pendingSentFiles(tx, cpA, [fromTg.id]))).toEqual([]);
    await asGuest(a.orgId, (tx) => dropPendingSentFiles(tx, [fromTg.id]));
    // Закончить можно только в первые 20 минут: позже загрузку удалит задача по расписанию.
    const late = newSent(a.orgId, cpA, 'Поздно.pdf');
    await asGuest(a.orgId, (tx) => insertPendingSentFiles(tx, [late]));
    await db.admin.db
      .update(contractorSentFiles)
      .set({ createdAt: sql`now() - interval '21 minutes'` })
      .where(eq(contractorSentFiles.id, late.id));
    expect(await asGuest(a.orgId, (tx) => pendingSentFiles(tx, cpA, [late.id]))).toEqual([]);
    // Брошенная загрузка занимает место в пределе за сутки, пока её не удалили.
    expect(await inA((tx) => sentFilesLastDay(tx, cpA))).toBe(2);
    await asGuest(a.orgId, (tx) => dropPendingSentFiles(tx, [late.id]));
    const [pending] = await asGuest(a.orgId, (tx) => pendingSentFiles(tx, cpA, [row.id]));
    expect(pending).toMatchObject({ id: row.id, state: 'pending', status: 'new' });
    await asGuest(a.orgId, (tx) => markSentFilesReady(tx, [row.id]));
    const [ready] = await inA((tx) => listContractorSentFiles(tx, cpA));
    expect(ready).toMatchObject({
      id: row.id,
      source: 'page',
      comment: 'Акт сверки',
      state: 'ready',
      status: 'new',
      decidedBy: null,
      fileId: null,
      sizeBytes: 1200,
    });
    expect(ready!.sentDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Загруженный повторно не «заканчивается».
    await expect(asGuest(a.orgId, (tx) => markSentFilesReady(tx, [row.id]))).rejects.toThrow(
      RecordNotFoundError,
    );
    // Чужая организация: не видит, не читает по номеру, не считает, не стирает.
    expect(await inB((tx) => getSentFile(tx, row.id))).toBeNull();
    expect(await inB((tx) => listContractorSentFiles(tx, cpA))).toEqual([]);
    expect(await inB((tx) => sentFilesLastDay(tx, cpA))).toBe(0);
    expect(await inB((tx) => sentFilesNewCount(tx, undefined))).toBe(0);
    await inB((tx) => dropPendingSentFiles(tx, [row.id]));
    expect(await inA((tx) => getSentFile(tx, row.id))).not.toBeNull();
    // Загрузку в чужую организацию не вставить: ключ хранилища — своей организации, контрагент — чужой.
    await expect(
      asGuest(b.orgId, (tx) => insertPendingSentFiles(tx, [newSent(b.orgId, cpA)])),
    ).rejects.toThrow();
  });

  it('незаконченная загрузка стирается; загруженный файл — нет', async () => {
    const row = newSent(a.orgId, cpA2);
    await asGuest(a.orgId, (tx) => insertPendingSentFiles(tx, [row]));
    await asGuest(a.orgId, (tx) => dropPendingSentFiles(tx, [row.id]));
    expect(await inA((tx) => getSentFile(tx, row.id))).toBeNull();
    const done = await send(a.orgId, cpA2);
    await asGuest(a.orgId, (tx) => dropPendingSentFiles(tx, [done.id]));
    expect(await inA((tx) => getSentFile(tx, done.id))).not.toBeNull();
  });

  it('после отказа «закончить»: «Новые» остаются, незаконченные стираются только с `erase`; чужая организация не трогается', async () => {
    const done = await send(a.orgId, cpA2);
    const left = newSent(a.orgId, cpA2);
    await asGuest(a.orgId, (tx) => insertPendingSentFiles(tx, [left]));
    const ids = [done.id, left.id];
    // Без `erase` (сбой транзакции «закончить») незаконченная остаётся — её удалит задача.
    const kept = await asGuest(a.orgId, (tx) => keptSentFiles(tx, ids, { erase: false }));
    expect([...kept].sort()).toEqual([...ids].sort());
    expect(await inA((tx) => getSentFile(tx, left.id))).not.toBeNull();
    // Чужая организация ничего не видит и не стирает.
    expect(await inB((tx) => keptSentFiles(tx, ids, { erase: true }))).toEqual(new Set());
    expect(await inA((tx) => getSentFile(tx, left.id))).not.toBeNull();
    // С `erase` незаконченная стёрта, «Новая» — на месте.
    const erased = await asGuest(a.orgId, (tx) => keptSentFiles(tx, ids, { erase: true }));
    expect([...erased]).toEqual([done.id]);
    expect(await inA((tx) => getSentFile(tx, left.id))).toBeNull();
    expect(await inA((tx) => getSentFile(tx, done.id))).not.toBeNull();
    // Стёртую уже никто не закончит.
    await expect(asGuest(a.orgId, (tx) => markSentFilesReady(tx, [left.id]))).rejects.toThrow(
      RecordNotFoundError,
    );
  });

  it('«Принять»: файл контрагента с источником «От контрагента», решение от своего имени, один раз', async () => {
    const sent = await send(a.orgId, cpA, 'Договор.pdf');
    const current = (await inA((tx) => getSentFile(tx, sent.id)))!;
    const file = acceptedFile(a.orgId, cpA, sent.id, 'Договор.pdf');
    // Устаревшая версия — «запись изменена».
    await expect(
      inA((tx) => acceptSentFile(tx, { id: sent.id, version: current.version - 1, file })),
    ).rejects.toThrow(RecordChangedError);
    // Без пользователя (страница, бот) решить нельзя: решение — только от своего имени.
    await expect(
      asGuest(a.orgId, (tx) => acceptSentFile(tx, { id: sent.id, version: current.version, file })),
    ).rejects.toThrow();
    await inA((tx) => acceptSentFile(tx, { id: sent.id, version: current.version, file }));
    const after = (await inA((tx) => getSentFile(tx, sent.id)))!;
    expect(after).toMatchObject({
      status: 'accepted',
      fileId: file.id,
      decidedBy: a.ownerUserId,
      decidedByName: 'Первый В.',
      fileStorageKey: file.storageKey,
    });
    const [row] = await inA((tx) => tx.select().from(files).where(eq(files.id, file.id)));
    expect(row).toMatchObject({
      sourceKind: 'sent_file',
      sourceId: sent.id,
      contractorId: cpA,
      state: 'ready',
      createdBy: a.ownerUserId,
    });
    expect(await inA((tx) => contractorDocumentNames(tx, cpA))).toContain('Договор.pdf');
    // Второе решение — «уже принят или отклонён».
    await expect(
      inA((tx) =>
        rejectSentFile(tx, { id: sent.id, version: after.version, reason: 'Не тот месяц' }),
      ),
    ).rejects.toThrow(SentFileDecidedError);
    // Принятый не меняется и напрямую.
    await inA((tx) =>
      tx
        .update(contractorSentFiles)
        .set({ status: 'rejected', rejectReason: 'x' })
        .where(eq(contractorSentFiles.id, sent.id)),
    );
    expect((await inA((tx) => getSentFile(tx, sent.id)))!.status).toBe('accepted');
  });

  it('«Отклонить» с причиной: контрагент видит причину; чужая организация решить не может', async () => {
    const sent = await send(a.orgId, cpA, 'Скан.jpg');
    const current = (await inA((tx) => getSentFile(tx, sent.id)))!;
    await expect(
      inB((tx) =>
        rejectSentFile(tx, { id: sent.id, version: current.version, reason: 'Не тот месяц' }),
      ),
    ).rejects.toThrow(RecordNotFoundError);
    await inA((tx) =>
      rejectSentFile(tx, { id: sent.id, version: current.version, reason: 'Не тот месяц' }),
    );
    const seen = await asGuest(a.orgId, (tx) => listContractorSentFiles(tx, cpA));
    expect(seen.find((x) => x.id === sent.id)).toMatchObject({
      status: 'rejected',
      rejectReason: 'Не тот месяц',
      decidedBy: a.ownerUserId,
    });
  });

  it('вкладка Файлового менеджера: «Новый» выше, область «Свои», дни до удаления, значения фильтра', async () => {
    const today = new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 10);
    const old = await send(a.orgId, cpA2, 'Старый.pdf');
    await backdate(old.id, 10);
    const page = await inA((tx) =>
      listSentFilesPage(tx, query(), { t: (k) => k, scope: undefined, today }),
    );
    expect(page.rows.length).toBeGreaterThanOrEqual(3);
    const statuses = page.rows.map((r) => r.status);
    // Сначала все «Новый», потом решённые.
    expect(statuses.indexOf('new')).toBe(0);
    expect(statuses.lastIndexOf('new')).toBeLessThan(
      statuses.findIndex((s) => s !== 'new') === -1
        ? Infinity
        : statuses.findIndex((s) => s !== 'new'),
    );
    const oldRow = page.rows.find((r) => r.id === old.id)!;
    expect(oldRow.contractor.name).toBe('ОсОО «А-2»');
    const left = await inA((tx) =>
      listSentFilesPage(tx, query({ filters: { left: { type: 'num', from: 20, to: 20 } } }), {
        t: (k) => k,
        scope: undefined,
        today,
      }),
    );
    expect(left.rows.map((r) => r.id)).toEqual([old.id]);
    // Принятый в «Удалится через» пуст.
    const accepted = page.rows.find((r) => r.status === 'accepted');
    expect(accepted).toBeDefined();
    const values = await inA((tx) =>
      listSentFileValues(tx, 'st', { t: (k) => k, scope: undefined, today }),
    );
    expect(values.items.map((v) => v.value).sort()).toEqual(['accepted', 'new', 'rejected']);
    // Область «Свои»: у сотрудника нет контрагентов — ничего не видно, счётчик 0.
    const own = contractorScope(randomUUID());
    expect(
      (await inA((tx) => listSentFilesPage(tx, query(), { t: (k) => k, scope: own, today }))).rows,
    ).toEqual([]);
    expect(await inA((tx) => sentFilesNewCount(tx, own))).toBe(0);
    expect(await inA((tx) => sentFilesNewCount(tx, undefined))).toBeGreaterThanOrEqual(2);
    // Чужая организация вкладку пустой.
    expect(
      (await inB((tx) => listSentFilesPage(tx, query(), { t: (k) => k, scope: undefined, today })))
        .rows,
    ).toEqual([]);
  });

  it('удаление через 30 дней: непринятые отправленные 30 дней назад и раньше, зависшие загрузки; принятые — никогда', async () => {
    const fresh = await send(a.orgId, cpA2, 'Свежий.pdf');
    const old = await send(a.orgId, cpA2, 'Давний.pdf');
    await backdate(old.id, 31);
    const rejected = await send(a.orgId, cpA2, 'Отказ.pdf');
    const r = (await inA((tx) => getSentFile(tx, rejected.id)))!;
    await inA((tx) => rejectSentFile(tx, { id: r.id, version: r.version, reason: 'Нечитаемо' }));
    await backdate(rejected.id, 40);
    const took = await send(a.orgId, cpA2, 'Принят.pdf');
    const t = (await inA((tx) => getSentFile(tx, took.id)))!;
    await inA((tx) =>
      acceptSentFile(tx, {
        id: t.id,
        version: t.version,
        file: acceptedFile(a.orgId, cpA2, t.id, 'Принят.pdf'),
      }),
    );
    await backdate(took.id, 90);
    const hung = newSent(a.orgId, cpA2, 'Завис.pdf');
    await asGuest(a.orgId, (tx) => insertPendingSentFiles(tx, [hung]));
    await backdate(hung.id, 2);
    const upTo = new Date(Date.now() + 6 * 3600_000 - 30 * 86_400_000).toISOString().slice(0, 10);
    const job = { orgId: a.orgId, userId: null, kind: 'job' as const };
    const stale = await withOrgContext(db.app.db, job, (tx) =>
      staleSentFiles(tx, { upTo, pendingBefore: new Date(Date.now() - 86_400_000), limit: 100 }),
    );
    const ids = stale.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining([old.id, rejected.id, hung.id]));
    expect(ids).not.toContain(fresh.id);
    expect(ids).not.toContain(took.id);
    // Чужая организация чужие строки не удаляет.
    expect(await inB((tx) => dropSentFiles(tx, stale))).toBe(0);
    // Строка, которая сменила состояние после выборки, не удаляется.
    const changed = stale.map((s) => (s.id === hung.id ? { ...s, state: 'ready' as const } : s));
    expect(
      await withOrgContext(db.app.db, job, (tx) =>
        dropSentFiles(
          tx,
          changed.filter((s) => s.id === hung.id),
        ),
      ),
    ).toBe(0);
    expect(await withOrgContext(db.app.db, job, (tx) => dropSentFiles(tx, stale))).toBe(3);
    expect(await inA((tx) => getSentFile(tx, old.id))).toBeNull();
    expect(await inA((tx) => getSentFile(tx, took.id))).not.toBeNull();
    // История — у загруженных, от имени системы; у зависшей загрузки истории нет.
    const history = await inA((tx) =>
      tx
        .select({ id: auditLog.entityId, actor: auditLog.actorUserId, action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.action, 'sent_file_purge')),
    );
    expect(history.map((h) => h.id).sort()).toEqual([old.id, rejected.id].sort());
    expect(history.every((h) => h.actor === null && h.action === 'sent_file_purge')).toBe(true);
  });

  it('удаление контрагента отдаёт и ключи отправленных им файлов', async () => {
    const sent = await send(b.orgId, cpB, 'Б.pdf');
    const keys = await inB((tx) => deleteContractorFiles(tx, cpB));
    expect(keys).toContain(sent.storageKey);
    // И ключ загрузки со страницы: по ссылке её могли положить и после проверки.
    expect(keys).toContain(`${sent.storageKey}.up`);
    // Чужие ключи не попадают.
    expect(await inB((tx) => deleteContractorFiles(tx, cpA))).toEqual([]);
  });
});
