import type { MemoryStorage } from '@buhuchet/adapters';
import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import {
  ApiError,
  Contractor,
  FileLinkable,
  FileLinkAdded,
  FileList,
  FileManagerList,
  FileUploadTicket,
} from '@buhuchet/shared';
import { and, asc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

/*
 * Один файл — несколько ссылок (доработки 16.11.2026, блок 2, этап 1; прототип v124): «Из файлов
 * контрагента», «Открепить», «Удалить отовсюду», «Источник» с записями, файл оплаты за обслуживание —
 * только тому, кто видит плату. Сценарии 2–5 приёмки «Доработки 16.11.2026» на уровне API.
 */
describe.skipIf(!databaseAvailable())('Ссылки файлов контрагента: методы API', () => {
  let f: Fixture;
  let owner: string;
  let chief: string;
  let acc: string;
  let senior: string;
  let accB: string;
  /** Контрагент бухгалтера (область «Свои») и главного бухгалтера (бухгалтеру не виден). */
  let cpAcc: Contractor;
  let cpOther: Contractor;
  let act: string;
  let otherFile: string;
  let receipt: string;
  let otherReceipt: string;
  let fee: string;

  const employee = (login: string) => f.people[login]!.employeeId;
  const call = (method: 'GET' | 'POST' | 'DELETE', path: string, cookie?: string, body?: unknown) =>
    apiRequest(f.app, method, path, cookie, body);
  const failure = async (res: Response) => ApiError.parse(await res.json()).error;
  const ON = { files: true, taxpay: true, fee: true };
  const features = (value: Record<string, boolean>, orgId = f.a.orgId) =>
    f.t.admin.db
      .update(schema.orgSettings)
      .set({ features: value })
      .where(eq(schema.orgSettings.orgId, orgId));
  const contractor = async (name: string, inn: string, responsible: string) => {
    const res = await call('POST', '/api/contractors', owner, {
      name,
      inn,
      phone: '+996505890076',
      kind: 'regular',
      formCode: 'ФС-01',
      regimeCode: 'РЕЖ-01',
      gked: '46.34.0',
      gkedExtra: [],
      bases: [],
      startDate: '2024-07-16',
      responsibleEmployeeId: responsible,
    });
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
    return Contractor.parse(await res.json());
  };
  const upload = async (cookie: string, body: Record<string, unknown>) => {
    const started = await call('POST', '/api/files/uploads', cookie, { size: 5, ...body });
    expect(started.status, JSON.stringify(await started.clone().json())).toBe(201);
    const ticket = FileUploadTicket.parse(await started.json());
    const [row] = await f.t.admin.db
      .select({ key: schema.files.storageKey, type: schema.files.contentType })
      .from(schema.files)
      .where(eq(schema.files.id, ticket.id));
    await (f.deps.storage as MemoryStorage).put(row!.key, new Uint8Array(5), {
      contentType: row!.type,
    });
    const done = await call('POST', `/api/files/${ticket.id}/complete`, cookie);
    expect(done.status, JSON.stringify(await done.clone().json())).toBe(200);
    return ticket.id;
  };
  const operation = async (cp: string, amount: number, total: number, opDate = '2026-11-10') => {
    const [row] = await f.t.admin.db
      .insert(schema.moneyOperations)
      .values({
        orgId: f.a.orgId,
        contractorId: cp,
        kind: 'in',
        amount,
        total,
        opDate,
        holderKind: 'org',
      })
      .returning({ id: schema.moneyOperations.id });
    return row!.id;
  };
  const linkable = (cookie: string, kind: string, id: string) =>
    call('GET', `/api/files/linkable?kind=${kind}&id=${id}`, cookie);
  const link = (cookie: string, kind: string, id: string, fileIds: string[]) =>
    call('POST', '/api/files/links', cookie, { kind, id, fileIds });
  const unlink = (cookie: string, fileId: string, kind: string, sourceId: string) =>
    call('DELETE', `/api/files/${fileId}/links?kind=${kind}&sourceId=${sourceId}`, cookie);
  const recordFiles = async (cookie: string, kind: string, id: string) => {
    const res = await call('GET', `/api/files?kind=${kind}&id=${id}`, cookie);
    expect(res.status, await res.clone().text()).toBe(200);
    return FileList.parse(await res.json());
  };
  const managerRow = async (cookie: string, fileId: string) => {
    const res = await call('GET', '/api/files/manager?size=all', cookie);
    expect(res.status, await res.clone().text()).toBe(200);
    return FileManagerList.parse(await res.json()).items.find((r) => r.id === fileId);
  };
  const history = (entityId: string, action: string) =>
    f.t.admin.db
      .select({ entity: schema.auditLog.entity, changes: schema.auditLog.changes })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.entityId, entityId), eq(schema.auditLog.action, action)))
      .orderBy(asc(schema.auditLog.id));

  beforeAll(async () => {
    f = await createStaffFixture();
    await seedAllPlatformDictionaries(f.t.admin.db);
    // Контрагенты — до «Платы за обслуживание»: с ней карточка требует ставку.
    await features({ files: true, taxpay: true });
    await features(ON, f.b.orgId);
    [owner, chief, acc, senior, accB] = await Promise.all([
      signIn(f.app, 'owner-a', TEST_PASSWORD),
      signIn(f.app, 'chief-a', TEST_PASSWORD),
      signIn(f.app, 'acc-a', TEST_PASSWORD),
      signIn(f.app, 'senior-a', TEST_PASSWORD),
      signIn(f.app, 'acc-b', TEST_PASSWORD),
    ]);
    cpAcc = await contractor('ОсОО «Ала-Тоо Трейд»', '03744097401861', employee('acc-a'));
    cpOther = await contractor('ИП Садыков', '03744097401862', employee('chief-a'));
    await features(ON);
    const MANUAL = { kind: 'manual', id: null };
    act = await upload(owner, {
      source: MANUAL,
      name: 'Акт сверки.pdf',
      contractorId: cpAcc.id,
      note: 'От контрагента по почте',
    });
    otherFile = await upload(owner, {
      source: MANUAL,
      name: 'Договор Садыкова.pdf',
      contractorId: cpOther.id,
    });
    receipt = await operation(cpAcc.id, 100_000, 150_000);
    otherReceipt = await operation(cpOther.id, 100_000, 100_000);
    const [row] = await f.t.admin.db
      .insert(schema.feePayments)
      .values({
        orgId: f.a.orgId,
        contractorId: cpAcc.id,
        amount: 50_000,
        paidOn: '2026-11-11',
        toKind: 'org',
      })
      .returning({ id: schema.feePayments.id });
    fee = row!.id;
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('приёмка (сценарий 3): «Из файлов контрагента» — акт сверки прикреплён к поступлению ссылкой, одна строка в «Файловом менеджере», в «Источнике» — и поступление', async () => {
    const before = (f.deps.storage as MemoryStorage).files.size;
    const pick = await linkable(acc, 'receipt', receipt);
    expect(pick.status, await pick.clone().text()).toBe(200);
    const body = FileLinkable.parse(await pick.json());
    expect(body.contractor).toEqual({ id: cpAcc.id, name: cpAcc.name });
    expect(body.items.map((x) => [x.name, x.kind, x.note])).toEqual([
      ['Акт сверки.pdf', 'manual', 'От контрагента по почте'],
    ]);
    expect(body.allLinked).toBe(false);

    const res = await link(acc, 'receipt', receipt, [act]);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(FileLinkAdded.parse(await res.json()).added).toEqual([
      { id: act, name: 'Акт сверки.pdf' },
    ]);
    // Ещё раз — уже прикреплён: ничего нового, в истории одна запись.
    expect(FileLinkAdded.parse(await (await link(acc, 'receipt', receipt, [act])).json())).toEqual({
      added: [],
    });
    // В записи — строка со ссылкой: «Открепить» вместо «Удалить», «Из файлов контрагента» есть.
    const list = await recordFiles(acc, 'receipt', receipt);
    expect(list.canLink).toBe(true);
    expect(list.items).toEqual([
      expect.objectContaining({
        id: act,
        name: 'Акт сверки.pdf',
        linked: true,
        canUnlink: true,
        canDelete: false,
        canEdit: true,
      }),
    ]);
    // Уже прикреплённый в окне не предлагается.
    const again = FileLinkable.parse(await (await linkable(acc, 'receipt', receipt)).json());
    expect(again).toMatchObject({ items: [], allLinked: true });
    // Без копии: объектов в хранилище столько же, строка файла одна.
    expect((f.deps.storage as MemoryStorage).files.size).toBe(before);
    const rows = await f.t.admin.db
      .select({ id: schema.files.id })
      .from(schema.files)
      .where(eq(schema.files.contractorId, cpAcc.id));
    expect(rows).toHaveLength(1);
    // История поступления — «Прикреплён из файлов контрагента».
    expect(await history(receipt, 'file_attach')).toEqual([
      {
        entity: 'money_operation',
        changes: [
          { field: 'file', to: 'Акт сверки.pdf' },
          { field: 'link', to: true },
        ],
      },
    ]);
    // «Источник»: поступление с датой и суммой; сумму с обслуживанием видит только тот, кто видит плату.
    const forAcc = await managerRow(acc, act);
    expect(forAcc).toMatchObject({ kind: 'manual', hiddenLinks: 0 });
    expect(forAcc!.links).toEqual([
      {
        kind: 'receipt',
        id: receipt,
        parentId: null,
        date: '2026-11-10',
        amount: 100_000,
        name: null,
        op: 'in',
        report: null,
      },
    ]);
    expect((await managerRow(owner, act))!.links[0]!.amount).toBe(150_000);
  });

  it('права, область и чужая организация: без входа 401, без «Загружать файлы» 403, чужой контрагент и чужая организация 404, файл другого контрагента и файл записи — 404', async () => {
    expect((await link(undefined as unknown as string, 'receipt', receipt, [act])).status).toBe(
      401,
    );
    expect((await link(senior, 'receipt', receipt, [act])).status).toBe(403);
    expect((await linkable(senior, 'receipt', receipt)).status).toBe(403);
    // Бухгалтер со «Свои» не видит поступление контрагента главного бухгалтера.
    expect((await link(acc, 'receipt', otherReceipt, [otherFile])).status).toBe(404);
    expect((await linkable(acc, 'receipt', otherReceipt)).status).toBe(404);
    expect((await unlink(acc, otherFile, 'receipt', otherReceipt)).status).toBe(404);
    // Чужая организация: ни окна, ни ссылки, ни «Открепить».
    expect((await linkable(accB, 'receipt', receipt)).status).toBe(404);
    expect((await link(accB, 'receipt', receipt, [act])).status).toBe(404);
    const ownerB = await signIn(f.app, 'owner-b', TEST_PASSWORD);
    expect((await linkable(ownerB, 'receipt', receipt)).status).toBe(404);
    expect((await link(ownerB, 'receipt', receipt, [act])).status).toBe(404);
    expect((await unlink(ownerB, act, 'receipt', receipt)).status).toBe(404);
    // Файл другого контрагента, несуществующий файл и файл самой записи ссылкой не прикрепляются.
    expect((await link(owner, 'receipt', receipt, [otherFile])).status).toBe(404);
    expect((await link(owner, 'receipt', receipt, [randomUUID()])).status).toBe(404);
    const own = await upload(owner, {
      source: { kind: 'receipt', id: receipt },
      name: 'Скрин.png',
    });
    expect((await link(owner, 'receipt', otherReceipt, [own])).status).toBe(404);
    const res = await link(owner, 'receipt', otherReceipt, [act]);
    expect(res.status).toBe(404);
    expect((await failure(res)).code).toBe('not_found');
    // У задач ссылок нет; неизвестный вид — 404.
    expect((await link(owner, 'task', randomUUID(), [act])).status).toBe(404);
    expect((await link(owner, 'nope', randomUUID(), [act])).status).toBe(404);
    // Неверные данные — 400 по схеме.
    expect((await link(owner, 'receipt', receipt, [])).status).toBe(400);
    expect((await call('POST', '/api/files/links', owner, { kind: 'receipt' })).status).toBe(400);
    // «Файлы в карточках» выключены — 403.
    await features({ ...ON, files: false });
    try {
      expect((await link(owner, 'receipt', receipt, [act])).status).toBe(403);
      expect((await unlink(owner, act, 'receipt', receipt)).status).toBe(403);
    } finally {
      await features(ON);
    }
    // Ссылка, которой нет, не открепляется; запись не тронута.
    expect((await unlink(owner, act, 'receipt', otherReceipt)).status).toBe(404);
    expect((await recordFiles(owner, 'receipt', receipt)).items.map((x) => x.id)).toContain(act);
    // Файлы самой записи — без «Открепить».
    const mine = (await recordFiles(owner, 'receipt', receipt)).items.find((x) => x.id === own)!;
    expect(mine).toMatchObject({ linked: false, canUnlink: false });
  });

  it('форма новой записи: окно по контрагенту (kind=contractor) — все его файлы в области «Файлового менеджера»; чужой контрагент и чужая организация — 404', async () => {
    const res = await linkable(acc, 'contractor', cpAcc.id);
    expect(res.status, await res.clone().text()).toBe(200);
    const body = FileLinkable.parse(await res.json());
    expect(body.contractor).toEqual({ id: cpAcc.id, name: cpAcc.name });
    // Записи ещё нет: уже прикреплённые к другим записям файлы тоже предлагаются — с «также у …».
    expect(body.items.find((x) => x.id === act)?.links.map((l) => l.kind)).toEqual(['receipt']);
    expect((await linkable(acc, 'contractor', cpOther.id)).status).toBe(404);
    expect((await linkable(acc, 'contractor', randomUUID())).status).toBe(404);
    expect((await linkable(accB, 'contractor', cpAcc.id)).status).toBe(404);
    expect((await linkable(senior, 'contractor', cpAcc.id)).status).toBe(403);
  });

  it('приёмка (сценарий 4): «Открепить» — ссылка убрана, файл остался у контрагента, в истории записи «Откреплён файл»', async () => {
    const res = await unlink(acc, act, 'receipt', receipt);
    expect(res.status, await res.clone().text()).toBe(200);
    const list = await recordFiles(acc, 'receipt', receipt);
    expect(list.items.map((x) => x.id)).not.toContain(act);
    const row = await managerRow(acc, act);
    expect(row).toMatchObject({ links: [], hiddenLinks: 0 });
    expect(await history(receipt, 'file_delete')).toEqual([
      {
        entity: 'money_operation',
        changes: [
          { field: 'file', from: 'Акт сверки.pdf' },
          { field: 'link', to: true },
        ],
      },
    ]);
    expect((await unlink(acc, act, 'receipt', receipt)).status).toBe(404);
  });

  it('файл, прикреплённый к оплате за обслуживание, — только тому, кто видит плату: в списке, окне выбора, ссылке на скачивание и записи', async () => {
    const res = await link(chief, 'fee_payment', fee, [act]);
    expect(res.status, await res.clone().text()).toBe(200);
    // Главный бухгалтер видит и файл, и ссылку на оплату.
    const forChief = await managerRow(chief, act);
    expect(forChief!.links.map((l) => [l.kind, l.date, l.amount])).toEqual([
      ['fee_payment', '2026-11-11', 50_000],
    ]);
    // Бухгалтер без права «Видеть плату за обслуживание» файла не видит нигде.
    expect(await managerRow(acc, act)).toBeUndefined();
    expect((await call('GET', `/api/files/${act}/link`, acc)).status).toBe(404);
    const pick = FileLinkable.parse(await (await linkable(acc, 'receipt', receipt)).json());
    expect(pick.items.map((x) => x.id)).not.toContain(act);
    expect((await link(acc, 'receipt', receipt, [act])).status).toBe(404);
    // Владелец прикрепляет его и к поступлению — бухгалтер не видит его и там.
    expect((await link(owner, 'receipt', receipt, [act])).status).toBe(200);
    expect((await recordFiles(acc, 'receipt', receipt)).items.map((x) => x.id)).not.toContain(act);
    expect((await unlink(acc, act, 'receipt', receipt)).status).toBe(404);
    // Плата выключена в учётной политике — файл не виден и главному бухгалтеру.
    await features({ ...ON, fee: false });
    try {
      expect(await managerRow(chief, act)).toBeUndefined();
    } finally {
      await features(ON);
    }
    expect((await unlink(owner, act, 'fee_payment', fee)).status).toBe(200);
    expect((await managerRow(acc, act))!.links.map((l) => l.kind)).toEqual(['receipt']);
  });

  it('повтор ссылки её не задваивает; ссылка отменённой записи денег остаётся в базе, но не видна и в «ещё N записей» не считается', async () => {
    const extra = await operation(cpAcc.id, 20_000, 20_000, '2026-11-13');
    const first = await link(owner, 'receipt', extra, [act]);
    expect(first.status, await first.clone().text()).toBe(200);
    expect(FileLinkAdded.parse(await first.json()).added.map((x) => x.id)).toEqual([act]);
    const again = await link(owner, 'receipt', extra, [act]);
    expect(again.status, await again.clone().text()).toBe(200);
    expect(FileLinkAdded.parse(await again.json()).added).toEqual([]);
    expect(
      (await recordFiles(owner, 'receipt', extra)).items.filter((x) => x.id === act),
    ).toHaveLength(1);
    expect((await managerRow(owner, act))!.links.map((l) => l.id)).toContain(extra);
    // Запись денег отменили («Удалить» в «Финансовых операциях»): файл остаётся у контрагента.
    await f.t.admin.db
      .update(schema.moneyOperations)
      .set({
        cancelledAt: new Date(),
        cancelledBy: f.people['chief-a']!.userId,
        cancelReason: 'Ошибочная запись',
      })
      .where(eq(schema.moneyOperations.id, extra));
    const row = await managerRow(owner, act);
    expect(row!.links.map((l) => l.id)).not.toContain(extra);
    expect(row!.hiddenLinks).toBe(0);
    const kept = await f.t.admin.db
      .select({ id: schema.fileLinks.sourceId })
      .from(schema.fileLinks)
      .where(and(eq(schema.fileLinks.fileId, act), eq(schema.fileLinks.sourceId, extra)));
    expect(kept).toEqual([{ id: extra }]);
  });

  it('приёмка (сценарий 5): «Удалить отовсюду» — файл пропал из всех записей, в истории каждой «Удалён файл», и тех, которых удаляющему не видно', async () => {
    // Поступление только за обслуживание бухгалтеру не видно: в «Источнике» — «ещё 1 запись».
    const feeOnly = await operation(cpAcc.id, 0, 30_000, '2026-11-12');
    expect((await link(owner, 'receipt', feeOnly, [act])).status).toBe(200);
    const row = await managerRow(acc, act);
    expect(row!.links.map((l) => l.id)).toEqual([receipt]);
    expect(row!.hiddenLinks).toBe(1);
    expect((await managerRow(owner, act))!.hiddenLinks).toBe(0);
    const del = await call('DELETE', `/api/files/${act}?version=${row!.version}`, owner);
    expect(del.status, await del.clone().text()).toBe(200);
    expect((await recordFiles(owner, 'receipt', receipt)).items.map((x) => x.id)).not.toContain(
      act,
    );
    expect(await managerRow(owner, act)).toBeUndefined();
    const links = await f.t.admin.db
      .select()
      .from(schema.fileLinks)
      .where(eq(schema.fileLinks.fileId, act));
    expect(links).toEqual([]);
    for (const id of [receipt, feeOnly]) {
      expect((await history(id, 'file_delete')).at(-1)).toEqual({
        entity: 'money_operation',
        changes: [
          { field: 'file', from: 'Акт сверки.pdf' },
          { field: 'linked', to: true },
        ],
      });
    }
  });
});
