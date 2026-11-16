import type { FakeTelegram, MemoryStorage } from '@buhuchet/adapters';
import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { UI_TEXTS } from '@buhuchet/domain';
import {
  ApiError,
  Contractor,
  ContractorPage,
  FileLink,
  FileManagerList,
  PageSentDone,
  PageSentTicket,
  PublicPage,
  SentFileCount,
  SentFileItem,
  SentFileList,
  SentFileListPage,
  SentUploadState,
} from '@buhuchet/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  apiRequest,
  createStaffFixture,
  linkTelegram,
  signIn,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from '../../testing';
import { createApp } from '../../app';
import { addSentFiles, SentFilesRefused } from './sent-add';
import { purgeSentFiles } from './sent-purge';
import { retryStorageDeletes } from './storage-retry';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

const { auditLog, contractorSentFiles, files, orgSettings } = schema;

const CHAT_ACC = 7101;
const CHAT_OWNER = 7102;
/** Telegram клиента, подключённый к контрагенту ответственного бухгалтера. */
const CLIENT_CHAT = 9101;

/** Содержимое по типу: PDF, картинка JPEG, программа Windows и веб-страница. */
const enc = (s: string) => new TextEncoder().encode(s);
const PDF = (tail = 'документ') => enc(`%PDF-1.7\n${tail}`);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0]);
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]);
const HTML = enc('<!DOCTYPE html><html><script>alert(1)</script></html>');

describe.skipIf(!databaseAvailable())(
  'Файлы от контрагентов: API (доработки 14.11, блок 2)',
  () => {
    let f: Fixture;
    let tg: FakeTelegram;
    let storage: MemoryStorage;
    let owner: string;
    let chief: string;
    let acc: string;
    let senior: string;
    let ownerB: string;
    let accB: string;
    /** Контрагент бухгалтера acc-a, контрагент главного бухгалтера и контрагент организации Б. */
    let cpAcc: Contractor;
    let cpChief: Contractor;
    let cpB: Contractor;
    let grantAcc: string;
    let grantChief: string;
    let grantB: string;

    const employee = (login: string) => f.people[login]!.employeeId;
    const call = (method: 'GET' | 'POST', path: string, cookie?: string, body?: unknown) =>
      apiRequest(f.app, method, path, cookie, body);
    const failure = async (res: Response) => ApiError.parse(await res.json()).error;
    const features = (orgId: string, value: Record<string, boolean>) =>
      f.t.admin.db.update(orgSettings).set({ features: value }).where(eq(orgSettings.orgId, orgId));
    const contractor = async (cookie: string, name: string, inn: string, responsible: string) => {
      const res = await call('POST', '/api/contractors', cookie, {
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
        tariff: { amount: 0, period: 'M' },
      });
      expect(res.status, await res.clone().text()).toBe(201);
      return Contractor.parse(await res.json());
    };
    /** Включить страницу и ввести код в «браузере»: cookie страницы. */
    const openPage = async (cookie: string, cp: Contractor, slug: string) => {
      const on = await call('POST', `/api/contractors/${cp.id}/page/enable`, cookie);
      expect(on.status, await on.clone().text()).toBe(200);
      const { code } = ContractorPage.parse(await on.json());
      const res = await f.app.request(`/api/page/${slug}/${cp.inn}/code`, {
        method: 'POST',
        headers: { origin: TEST_ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      expect(res.status, await res.clone().text()).toBe(200);
      return (res.headers.get('set-cookie') ?? '').split(';')[0]!;
    };
    const pagePost = (path: string, grant: string | undefined, body: unknown) =>
      f.app.request(path, {
        method: 'POST',
        headers: {
          origin: TEST_ORIGIN,
          'content-type': 'application/json',
          ...(grant ? { cookie: grant } : {}),
        },
        body: JSON.stringify(body),
      });
    type Pick = { name: string; body: Uint8Array; size?: number };
    /** Начать отправку со страницы. */
    const start = (
      slug: string,
      cp: Contractor,
      grant: string | undefined,
      list: Pick[],
      comment?: string,
    ) =>
      pagePost(`/api/page/${slug}/${cp.inn}/sent`, grant, {
        files: list.map((x) => ({ name: x.name, size: x.size ?? x.body.length })),
        ...(comment === undefined ? {} : { comment }),
      });
    /** Положить файлы в хранилище по ссылкам и закончить отправку. */
    const finish = async (
      slug: string,
      cp: Contractor,
      grant: string,
      res: Response,
      list: Pick[],
    ) => {
      expect(res.status, await res.clone().text()).toBe(201);
      const ticket = PageSentTicket.parse(await res.json());
      for (const [i, item] of ticket.items.entries()) {
        const url = new URL(item.upload.url);
        await storage.put(url.host + url.pathname, list[i]!.body, {
          contentType: item.upload.headers['content-type']!,
        });
      }
      return {
        ids: ticket.items.map((x) => x.id),
        res: await pagePost(`/api/page/${slug}/${cp.inn}/sent/complete`, grant, {
          ids: ticket.items.map((x) => x.id),
        }),
      };
    };
    /** Отправить со страницы целиком и убедиться, что принято. */
    const send = async (
      slug: string,
      cp: Contractor,
      grant: string,
      list: Pick[],
      comment?: string,
    ) => {
      const done = await finish(slug, cp, grant, await start(slug, cp, grant, list, comment), list);
      expect(done.res.status, await done.res.clone().text()).toBe(200);
      expect(PageSentDone.parse(await done.res.json()).sent).toBe(list.length);
      return done.ids;
    };
    const cardList = async (cookie: string, cp: Contractor) => {
      const res = await call('GET', `/api/contractors/${cp.id}/sent-files`, cookie);
      expect(res.status, await res.clone().text()).toBe(200);
      return SentFileList.parse(await res.json());
    };
    const publicPage = async (slug: string, cp: Contractor, grant: string) => {
      const res = await f.app.request(`/api/page/${slug}/${cp.inn}`, {
        headers: { cookie: grant },
      });
      const body = PublicPage.parse(await res.json());
      if (body.state !== 'open') throw new Error(`страница: ${body.state}`);
      return body.page;
    };
    const history = (contractorId: string) =>
      f.t.admin.db
        .select({
          action: auditLog.action,
          changes: auditLog.changes,
          reason: auditLog.reason,
          userId: auditLog.actorUserId,
        })
        .from(auditLog)
        .where(and(eq(auditLog.contractorId, contractorId), eq(auditLog.entity, 'sent_file')))
        .orderBy(asc(auditLog.at), asc(auditLog.id));
    const keyOf = async (id: string) =>
      (
        await f.t.admin.db
          .select({ key: contractorSentFiles.storageKey })
          .from(contractorSentFiles)
          .where(eq(contractorSentFiles.id, id))
      )[0]?.key;
    const decide = (cookie: string, id: string, action: 'accept' | 'reject', body: object) =>
      call('POST', `/api/files/sent/${id}/${action}`, cookie, body);
    const versionOf = async (cookie: string, cp: Contractor, id: string) =>
      (await cardList(cookie, cp)).items.find((x) => x.id === id)!.version;
    /** Убрать отправленные файлы и пределы частоты — тест начинает с пустого списка. */
    const wipe = async () => {
      await f.t.admin.db.delete(contractorSentFiles);
      await f.t.admin.db.execute(sql`delete from rate_limits where kind like 'cp_sent%'`);
      await f.t.admin.db.update(orgSettings).set({ cpFilesUpload: true });
      await f.t.admin.db.update(schema.contractorPages).set({ filesUpload: true });
      tg.sent.length = 0;
    };

    beforeAll(async () => {
      f = await createStaffFixture();
      await seedAllPlatformDictionaries(f.t.admin.db);
      tg = f.deps.telegram as FakeTelegram;
      storage = f.deps.storage as MemoryStorage;
      const on = { cppage: true, files: true, telegram: true, fee: true };
      await features(f.a.orgId, on);
      await features(f.b.orgId, on);
      owner = await signIn(f.app, 'owner-a', TEST_PASSWORD);
      chief = await signIn(f.app, 'chief-a', TEST_PASSWORD);
      acc = await signIn(f.app, 'acc-a', TEST_PASSWORD);
      senior = await signIn(f.app, 'senior-a', TEST_PASSWORD);
      ownerB = await signIn(f.app, 'owner-b', TEST_PASSWORD);
      accB = await signIn(f.app, 'acc-b', TEST_PASSWORD);
      cpAcc = await contractor(owner, 'ОсОО «Ала-Тоо Трейд»', '03744097401851', employee('acc-a'));
      cpChief = await contractor(
        owner,
        'ОсОО «Нарын Строй»',
        '02510199910105',
        employee('chief-a'),
      );
      cpB = await contractor(ownerB, 'ОсОО «Ош Сервис»', '02711198410102', employee('acc-b'));
      grantAcc = await openPage(owner, cpAcc, 'org-a');
      grantChief = await openPage(owner, cpChief, 'org-a');
      grantB = await openPage(ownerB, cpB, 'org-b');
      await linkTelegram(f.app, acc, CHAT_ACC, 'acc_a');
      await linkTelegram(f.app, owner, CHAT_OWNER, 'owner_a');
      // Telegram клиента, подключённый к контрагенту: файлы из него принимает «Добавить отправленный
      // файл» (подключение по ссылке — тесты потока К).
      await f.t.admin.db.insert(schema.contractorTelegramLinks).values({
        orgId: f.a.orgId,
        contractorId: cpAcc.id,
        chatId: CLIENT_CHAT,
        name: 'Айнура',
        status: 'on',
        decidedAt: new Date('2026-10-18T03:00:00Z'),
      });
    });

    afterAll(async () => {
      await f?.t.drop();
    });

    beforeEach(async () => {
      await wipe();
    });

    it('приёмка: контрагент отправил файл со страницы — в карточке строка «Новый», ответственному пришло сообщение', async () => {
      tg.sent.length = 0;
      const ids = await send(
        'org-a',
        cpAcc,
        grantAcc,
        [
          { name: 'Выписка_октябрь.pdf', body: PDF() },
          { name: 'Чек.jpg', body: JPEG },
        ],
        '  Выписка   за октябрь ',
      );
      const list = await cardList(acc, cpAcc);
      expect(list.newCount).toBe(2);
      expect(list.items.map((x) => [x.name, x.status, x.source, x.comment, x.daysLeft])).toEqual(
        expect.arrayContaining([
          ['Выписка_октябрь.pdf', 'new', 'page', 'Выписка за октябрь', 30],
          ['Чек.jpg', 'new', 'page', 'Выписка за октябрь', 30],
        ]),
      );
      expect(list.items.every((x) => x.canDecide && x.contractor.id === cpAcc.id)).toBe(true);
      // Сообщение — одно на отправку, ответственному (acc-a), со ссылкой на вкладку.
      const toAcc = tg.sent.filter((m) => m.chatId === CHAT_ACC);
      expect(toAcc).toHaveLength(1);
      expect(toAcc[0]!.text).toContain('Новые файлы от контрагента: 2');
      expect(toAcc[0]!.text).toContain('Выписка_октябрь.pdf, Чек.jpg');
      expect(toAcc[0]!.text).toContain('/app/files/sent');
      expect(tg.sent.filter((m) => m.chatId === CHAT_OWNER)).toHaveLength(0);
      // История контрагента: «Контрагент отправил со страницы файлы» — без автора.
      const h = await history(cpAcc.id);
      expect(h.at(-1)).toMatchObject({ action: 'sent_file_send', userId: null });
      expect(h.at(-1)!.changes).toEqual(
        expect.arrayContaining([
          { field: 'files', to: ['Выписка_октябрь.pdf', 'Чек.jpg'] },
          { field: 'source', to: 'page' },
          { field: 'comment', to: 'Выписка за октябрь' },
        ]),
      );
      // Страница: «Отправить файл» и «Отправленные вами».
      const page = await publicPage('org-a', cpAcc, grantAcc);
      expect(page.sent?.upload).toBe(true);
      expect(page.sent?.items.map((x) => [x.name, x.status, x.daysLeft, x.telegram])).toEqual(
        expect.arrayContaining([
          ['Выписка_октябрь.pdf', 'new', 30, false],
          ['Чек.jpg', 'new', 30, false],
        ]),
      );
      expect(ids).toHaveLength(2);
    });

    it('без ответственного в Telegram сообщение уходит первому владельцу с Telegram', async () => {
      await send('org-a', cpChief, grantChief, [{ name: 'Акт.pdf', body: PDF() }]);
      const msgs = tg.sent.filter((m) => m.chatId === CHAT_OWNER);
      expect(msgs).toHaveLength(1);
      expect(msgs[0]!.text).toContain('Новый файл от контрагента');
      expect(msgs[0]!.text).toContain('Акт.pdf');
    });

    it('приёмка: «Отклонить» с причиной — контрагент видит причину на странице', async () => {
      const [id] = await send('org-a', cpAcc, grantAcc, [{ name: 'Счёт.pdf', body: PDF() }]);
      const version = await versionOf(acc, cpAcc, id!);
      // Пустая и длинная причина — отказ, файл остаётся «Новым».
      const empty = await decide(acc, id!, 'reject', { version, reason: '   ' });
      expect(empty.status).toBe(400);
      expect((await failure(empty)).code).toBe('sent_reason_empty');
      const long = await decide(acc, id!, 'reject', { version, reason: 'я'.repeat(301) });
      expect((await failure(long)).code).toBe('sent_reason_long');
      const stale = await decide(acc, id!, 'reject', {
        version: version + 5,
        reason: 'Не тот месяц',
      });
      expect(stale.status).toBe(409);
      expect((await failure(stale)).code).toBe('record_changed');

      const res = await decide(acc, id!, 'reject', {
        version,
        reason: 'Это счёт за сентябрь,\n пришлите за октябрь',
      });
      expect(res.status, await res.clone().text()).toBe(200);
      const item = SentFileItem.parse(await res.json());
      expect(item).toMatchObject({
        status: 'rejected',
        rejectReason: 'Это счёт за сентябрь, пришлите за октябрь',
        decidedBy: 'acc-a',
      });
      const page = await publicPage('org-a', cpAcc, grantAcc);
      expect(page.sent?.items.find((x) => x.id === id)).toMatchObject({
        status: 'rejected',
        reason: 'Это счёт за сентябрь, пришлите за октябрь',
        daysLeft: 30,
      });
      // Второе решение — «Файл уже принят или отклонён».
      const again = await decide(chief, id!, 'accept', { version: item.version });
      expect(again.status).toBe(409);
      expect((await failure(again)).code).toBe('sent_decided');
      expect((await history(cpAcc.id)).at(-1)).toMatchObject({
        action: 'sent_file_reject',
        reason: 'Это счёт за сентябрь, пришлите за октябрь',
        userId: f.people['acc-a']!.userId,
      });
    });

    it('«Принять»: файл среди файлов контрагента «От контрагента», занятое имя — «Имя (2)», отправленный объект удалён', async () => {
      const [first, second] = await send('org-a', cpAcc, grantAcc, [
        { name: 'Договор.pdf', body: PDF('один') },
        { name: 'договор.PDF', body: PDF('два') },
      ]);
      const sentKey = await keyOf(first!);
      const one = await decide(chief, first!, 'accept', {
        version: await versionOf(chief, cpAcc, first!),
      });
      expect(one.status, await one.clone().text()).toBe(200);
      const accepted = SentFileItem.parse(await one.json());
      expect(accepted).toMatchObject({ status: 'accepted', daysLeft: null, decidedBy: 'chief-a' });
      expect(accepted.fileId).not.toBeNull();
      expect(storage.files.has(sentKey!)).toBe(false);
      const two = await decide(chief, second!, 'accept', {
        version: await versionOf(chief, cpAcc, second!),
      });
      expect(two.status).toBe(200);

      // Файлы контрагента: вид «Контрагент», источник «От контрагента»; второй — «договор (2).PDF».
      const res = await call(
        'GET',
        `/api/files/manager?size=all&filters=${encodeURIComponent(
          JSON.stringify({ cp: { type: 'enum', vals: [cpAcc.id] } }),
        )}`,
        acc,
      );
      expect(res.status).toBe(200);
      const fm = FileManagerList.parse(await res.json());
      expect(fm.items.map((x) => [x.name, x.kind, x.source]).sort()).toEqual([
        ['Договор.pdf', 'contractor', 'От контрагента'],
        ['договор (2).PDF', 'contractor', 'От контрагента'],
      ]);
      const saved = await f.t.admin.db
        .select({ key: files.storageKey, kind: files.sourceKind })
        .from(files)
        .where(eq(files.id, accepted.fileId!));
      expect(saved[0]!.kind).toBe('sent_file');
      expect(new TextDecoder().decode(storage.files.get(saved[0]!.key)!.body)).toContain('один');
      // Ссылка на принятый — на файл контрагента.
      const link = await call('GET', `/api/files/sent/${first}/link?download=1`, acc);
      expect(link.status).toBe(200);
      expect(FileLink.parse(await link.json()).url).toContain(saved[0]!.key);
      // «Скачать» окна просмотра (блок 5 пакета 16.11): тот же файл переходом, вложением.
      const go = await call('GET', `/api/files/sent/${first}/download`, acc);
      expect(go.status).toBe(302);
      expect(go.headers.get('location')).toContain(saved[0]!.key);
      expect(go.headers.get('location')).not.toContain('inline');
      // Окно просмотра читает и не картинку, и не PDF — ссылкой-вложением; в окне браузера — только
      // картинку и PDF (400, как раньше).
      const other = (
        await send('org-a', cpAcc, grantAcc, [
          { name: 'Сверка.txt', body: enc('Акт сверки за октябрь') },
        ])
      )[0]!;
      const otherLink = await call('GET', `/api/files/sent/${other}/link?download=1`, acc);
      expect(otherLink.status).toBe(200);
      expect(FileLink.parse(await otherLink.json()).url).toContain(`/sent/${other}`);
      expect((await call('GET', `/api/files/sent/${other}/link`, acc)).status).toBe(400);
      expect((await call('GET', `/api/files/sent/${other}/download`, acc)).status).toBe(302);
      expect((await call('GET', '/api/files/sent/not-an-id/download', acc)).status).toBe(400);
      const h = await history(cpAcc.id);
      expect(h.filter((x) => x.action === 'sent_file_accept').map((x) => x.changes)).toEqual([
        [{ field: 'file', to: 'Договор.pdf' }],
        [
          { field: 'file', to: 'договор.PDF' },
          { field: 'savedAs', to: 'договор (2).PDF' },
        ],
      ]);
      // Страница контрагента: принятый — «Принят», без «Удалится».
      const page = await publicPage('org-a', cpAcc, grantAcc);
      expect(page.sent?.items.find((x) => x.id === first)).toMatchObject({
        status: 'accepted',
        daysLeft: null,
      });
    });

    it('тип файла — по содержимому: программа под «.pdf» и веб-страница не принимаются, отправка целиком отменена', async () => {
      const list = [
        { name: 'Выписка.pdf', body: PDF() },
        { name: 'Счёт.pdf', body: EXE },
        { name: 'readme.txt', body: HTML },
      ];
      const done = await finish(
        'org-a',
        cpAcc,
        grantAcc,
        await start('org-a', cpAcc, grantAcc, list),
        list,
      );
      expect(done.res.status).toBe(400);
      const err = await failure(done.res);
      expect(err.code).toBe('sent_forbidden');
      expect(err.message).toContain('Счёт.pdf, readme.txt');
      // Ни одного файла — и хорошего тоже: загрузки остались незаконченными (их удалит задача), в
      // хранилище нет ни файлов, ни загрузок, ни проверочных копий.
      const rows = await f.t.admin.db
        .select()
        .from(contractorSentFiles)
        .where(eq(contractorSentFiles.contractorId, cpAcc.id));
      expect(rows.map((r) => r.state)).toEqual(['pending', 'pending', 'pending']);
      expect((await cardList(acc, cpAcc)).items).toEqual([]);
      for (const id of done.ids) {
        expect([...storage.files.keys()].some((k) => k.includes(`/sent/${id}`))).toBe(false);
      }
      // Не тот размер, что заявлен, — «файл не дошёл».
      const short = [{ name: 'Акт.pdf', body: PDF(), size: 999 }];
      const bad = await finish(
        'org-a',
        cpAcc,
        grantAcc,
        await start('org-a', cpAcc, grantAcc, short),
        short,
      );
      expect(bad.res.status).toBe(409);
      expect((await failure(bad.res)).code).toBe('file_not_uploaded');
      // Не положил файл в хранилище — тоже.
      const started = await start('org-a', cpAcc, grantAcc, [{ name: 'Нет.pdf', body: PDF() }]);
      const ticket = PageSentTicket.parse(await started.json());
      const none = await pagePost('/api/page/org-a/' + cpAcc.inn + '/sent/complete', grantAcc, {
        ids: ticket.items.map((x) => x.id),
      });
      expect(none.status).toBe(409);
    });

    it('ссылка на хранилище — только на загрузку: файл, положенный по ней после проверки, не подменяет принятый', async () => {
      const [id] = await send('org-a', cpAcc, grantAcc, [{ name: 'Договор.pdf', body: PDF('v1') }]);
      const key = (await keyOf(id!))!;
      expect(storage.files.has(`${key}.up`)).toBe(false);
      expect([...storage.files.keys()].filter((k) => k.startsWith(`${key}.`))).toEqual([]);
      // Ссылка ещё действует: по ней кладут программу — она ложится рядом, а не в файл.
      await storage.put(`${key}.up`, EXE, { contentType: 'application/pdf' });
      expect(new TextDecoder().decode(storage.files.get(key)!.body)).toBe('%PDF-1.7\nv1');
      // Повторно закончить нельзя: загрузка уже закончена.
      const again = await pagePost(`/api/page/org-a/${cpAcc.inn}/sent/complete`, grantAcc, {
        ids: [id],
      });
      expect(again.status).toBe(404);
      // «Принять» копирует проверенный файл и убирает загрузку.
      const ok = await decide(acc, id!, 'accept', { version: await versionOf(acc, cpAcc, id!) });
      expect(ok.status, await ok.clone().text()).toBe(200);
      const [accepted] = await f.t.admin.db
        .select({ key: files.storageKey })
        .from(files)
        .where(eq(files.id, SentFileItem.parse(await ok.json()).fileId!));
      expect(new TextDecoder().decode(storage.files.get(accepted!.key)!.body)).toBe('%PDF-1.7\nv1');
      expect(storage.files.has(key)).toBe(false);
      expect(storage.files.has(`${key}.up`)).toBe(false);
    });

    it('проверочная копия одного файла упала — уборка ждёт остальные копии: ни загрузок, ни проверочных копий не остаётся', async () => {
      const list = [
        { name: 'Первый.pdf', body: PDF('1') },
        { name: 'Второй.pdf', body: PDF('2') },
      ];
      const started = await start('org-a', cpAcc, grantAcc, list);
      const copy = storage.copy;
      let checks = 0;
      let firstFailed = () => {};
      const failed = new Promise<void>((r) => (firstFailed = r));
      let secondDone = () => {};
      const second = new Promise<void>((r) => (secondDone = r));
      // Первая проверочная копия падает, вторая кладётся позже этого отказа.
      storage.copy = async (from, to) => {
        if (!to.includes('.chk-')) return copy(from, to);
        checks += 1;
        if (checks === 1) {
          firstFailed();
          throw new Error('хранилище недоступно');
        }
        // Копия уже идёт (источник прочитан) и ляжет, даже если загрузку тем временем удалили.
        const source = storage.files.get(from);
        await failed;
        await new Promise((r) => setTimeout(r, 20));
        try {
          if (!source) return copy(from, to);
          await storage.put(to, source.body, { contentType: source.contentType });
          return true;
        } finally {
          secondDone();
        }
      };
      let ids: string[] | undefined;
      try {
        const done = await finish('org-a', cpAcc, grantAcc, started, list);
        ids = done.ids;
        expect(done.res.status).toBe(500);
        await second;
      } finally {
        storage.copy = copy;
      }
      expect(checks).toBe(2);
      const keys = (await Promise.all((ids ?? []).map(keyOf))).map((k) => k!);
      expect(keys).toHaveLength(2);
      const left = [...storage.files.keys()].filter((x) => keys.some((k) => x.startsWith(k)));
      expect(left).toEqual([]);
    });

    /** Начатая отправка одного файла, уже положенного по ссылке: ключ файла и «закончить». */
    const prepared = async (name: string) => {
      const res = await start('org-a', cpAcc, grantAcc, [{ name, body: PDF(name) }]);
      expect(res.status, await res.clone().text()).toBe(201);
      const [item] = PageSentTicket.parse(await res.json()).items;
      const url = new URL(item!.upload.url);
      await storage.put(url.host + url.pathname, PDF(name), {
        contentType: item!.upload.headers['content-type']!,
      });
      return {
        id: item!.id,
        key: (await keyOf(item!.id))!,
        complete: () =>
          pagePost(`/api/page/org-a/${cpAcc.inn}/sent/complete`, grantAcc, { ids: [item!.id] }),
      };
    };
    /**
     * Первый «закончить» держится перед тем, как положит проверенную копию под ключ файла (загрузка
     * и его проверочная копия ещё на месте); остальные проходят. `run` получает его и `release`.
     */
    const withHeldCopy = async (
      p: Awaited<ReturnType<typeof prepared>>,
      run: (first: Promise<Response>, release: () => void) => Promise<void>,
    ) => {
      const copy = storage.copy;
      let release = () => {};
      const gate = new Promise<void>((r) => (release = r));
      let reached = () => {};
      const atGate = new Promise<void>((r) => (reached = r));
      let held = false;
      storage.copy = async (from, to) => {
        if (to === p.key && !held) {
          held = true;
          reached();
          await gate;
        }
        return copy(from, to);
      };
      const first = Promise.resolve(p.complete());
      try {
        await Promise.race([
          atGate,
          first.then((r) => {
            throw new Error(`«закончить» ответил ${r.status} раньше копии файла`);
          }),
        ]);
        await run(first, release);
      } finally {
        storage.copy = copy;
        release();
        await first.catch(() => undefined);
      }
    };
    const pageUpload = (on: boolean) =>
      f.t.admin.db
        .update(schema.contractorPages)
        .set({ filesUpload: on })
        .where(eq(schema.contractorPages.contractorId, cpAcc.id));
    const rowOf = async (id: string) =>
      (
        await f.t.admin.db
          .select({ state: contractorSentFiles.state })
          .from(contractorSentFiles)
          .where(eq(contractorSentFiles.id, id))
      )[0];
    /** Объекты хранилища файла: сам файл и всё рядом с ним (загрузка, проверочные копии). */
    const objectsOf = (key: string) =>
      [...storage.files.keys()].filter((k) => k === key || k.startsWith(`${key}.`));

    /** Через 30 минут задача удаляет незаконченную строку вместе с файлом. */
    const purgeLater = async (id: string) => {
      await f.t.admin.db
        .update(contractorSentFiles)
        .set({ createdAt: sql`now() - interval '31 minutes'` })
        .where(eq(contractorSentFiles.id, id));
      expect(await purgeSentFiles(f.deps)).toBe(1);
      expect(await rowOf(id)).toBeUndefined();
    };

    // ОТКЛОНЕНИЕ: docs/deviations.md#И-10
    it('отправку выключили, пока файл копировался: «sent_off», строка с файлом — незаконченная до задачи по сроку', async () => {
      const before = (await history(cpAcc.id)).length;
      const p = await prepared('Договор.pdf');
      await withHeldCopy(p, async (first, release) => {
        await pageUpload(false);
        release();
        const res = await first;
        expect(res.status).toBe(409);
        expect((await failure(res)).code).toBe('sent_off');
      });
      // Файл никому не виден и не «Новый»: в карточке пусто, сообщения и истории нет.
      expect((await rowOf(p.id))?.state).toBe('pending');
      expect((await cardList(acc, cpAcc)).items).toEqual([]);
      expect(tg.sent.filter((m) => m.chatId === CHAT_ACC)).toEqual([]);
      expect(await history(cpAcc.id)).toHaveLength(before);
      // По ещё живой ссылке загрузку кладут заново — задача удалит её вместе со строкой и файлом.
      await storage.put(`${p.key}.up`, PDF('снова'), { contentType: 'application/pdf' });
      expect(objectsOf(p.key).sort()).toEqual([p.key, `${p.key}.up`]);
      await purgeLater(p.id);
      expect(objectsOf(p.key)).toEqual([]);
    });

    // ОТКЛОНЕНИЕ: docs/deviations.md#И-10
    it('сбой транзакции «закончить»: строка остаётся незаконченной вместе с файлом — их удалит задача по сроку', async () => {
      const p = await prepared('Справка.pdf');
      // Запись истории отправки падает — транзакция «закончить» откатывается целиком.
      await f.t.admin.db.execute(sql`
        create function public.test_sent_history_fail() returns trigger language plpgsql as $$
        begin
          if new.entity = 'sent_file' then raise exception 'сбой записи истории'; end if;
          return new;
        end $$`);
      await f.t.admin.db.execute(
        sql`create trigger test_sent_history_fail before insert on audit_log for each row execute function public.test_sent_history_fail()`,
      );
      try {
        expect((await p.complete()).status).toBe(500);
      } finally {
        await f.t.admin.db.execute(sql`drop trigger test_sent_history_fail on audit_log`);
        await f.t.admin.db.execute(sql`drop function public.test_sent_history_fail()`);
      }
      expect((await rowOf(p.id))?.state).toBe('pending');
      expect(objectsOf(p.key)).toEqual([p.key]);
      expect(tg.sent.filter((m) => m.chatId === CHAT_ACC)).toEqual([]);
      await purgeLater(p.id);
      expect(objectsOf(p.key)).toEqual([]);
    });

    // ОТКЛОНЕНИЕ: docs/deviations.md#И-10
    it('ту же отправку закончил другой запрос того же браузера — отказ первого не удаляет его файл', async () => {
      const sends = async () =>
        (await history(cpAcc.id)).filter((h) => h.action === 'sent_file_send').length;
      const sendsBefore = await sends();
      // Второй закончил, потом отправку выключили: первый — «sent_off», файл второго на месте.
      const off = await prepared('Акт.pdf');
      await withHeldCopy(off, async (first, release) => {
        const second = await off.complete();
        expect(second.status, await second.clone().text()).toBe(200);
        await pageUpload(false);
        release();
        const res = await first;
        expect(res.status).toBe(409);
        expect((await failure(res)).code).toBe('sent_off');
      });
      expect(objectsOf(off.key)).toEqual([off.key]);
      expect((await rowOf(off.id))?.state).toBe('ready');
      await pageUpload(true);

      // Оба при включённой отправке: первый — «нет такой записи», файл второго на месте.
      const both = await prepared('Счёт.pdf');
      await withHeldCopy(both, async (first, release) => {
        const second = await both.complete();
        expect(second.status, await second.clone().text()).toBe(200);
        release();
        expect((await first).status).toBe(404);
      });
      expect(objectsOf(both.key)).toEqual([both.key]);
      expect((await rowOf(both.id))?.state).toBe('ready');
      expect(new TextDecoder().decode(storage.files.get(both.key)!.body)).toBe(
        '%PDF-1.7\nСчёт.pdf',
      );
      // Каждая отправка — «Новая» и одно сообщение ответственному.
      expect((await cardList(acc, cpAcc)).items.map((x) => [x.name, x.status])).toEqual(
        expect.arrayContaining([
          ['Акт.pdf', 'new'],
          ['Счёт.pdf', 'new'],
        ]),
      );
      expect(tg.sent.filter((m) => m.chatId === CHAT_ACC)).toHaveLength(2);
      expect(await sends()).toBe(sendsBefore + 2);

      // Пока первый держался, второй закончил, а сотрудник принял файл: «Принять» убрал отправленный
      // объект, первый положил его заново — 404, и положенное им убрано (принятый задача не удаляет).
      const taken = await prepared('Платёжка.pdf');
      await withHeldCopy(taken, async (first, release) => {
        const second = await taken.complete();
        expect(second.status, await second.clone().text()).toBe(200);
        const ok = await decide(acc, taken.id, 'accept', {
          version: await versionOf(acc, cpAcc, taken.id),
        });
        expect(ok.status, await ok.clone().text()).toBe(200);
        expect(storage.files.has(taken.key)).toBe(false);
        release();
        expect((await first).status).toBe(404);
      });
      expect(objectsOf(taken.key)).toEqual([]);

      // Строку, пока первый держался, удалила задача по сроку: первый положил файл, строки нет —
      // 404, и положенный им файл убран (он ничей).
      const gone = await prepared('Выписка.pdf');
      await withHeldCopy(gone, async (first, release) => {
        await f.t.admin.db.delete(contractorSentFiles).where(eq(contractorSentFiles.id, gone.id));
        release();
        expect((await first).status).toBe(404);
      });
      expect(objectsOf(gone.key)).toEqual([]);
    });

    it('незаконченная загрузка занимает место в пределе за сутки, пока задача не удалила её через 30 минут вместе с файлами', async () => {
      const ten = (p: string) =>
        Array.from({ length: 10 }, (_, i) => ({ name: `${p}${i}.pdf`, body: PDF() }));
      // Начали и бросили: файлы положены, «закончить» не было.
      const res = await start('org-a', cpAcc, grantAcc, ten('a'));
      expect(res.status).toBe(201);
      const ticket = PageSentTicket.parse(await res.json());
      for (const item of ticket.items) {
        const url = new URL(item.upload.url);
        await storage.put(url.host + url.pathname, PDF(), { contentType: 'application/pdf' });
      }
      await send('org-a', cpAcc, grantAcc, ten('b'));
      const full = await start('org-a', cpAcc, grantAcc, [{ name: 'c.pdf', body: PDF() }]);
      expect(full.status).toBe(429);
      expect((await failure(full)).code).toBe('sent_day_limit');
      // Молодую загрузку задача не трогает.
      expect(await purgeSentFiles(f.deps)).toBe(0);
      const abandoned = ticket.items.map((x) => x.id);
      await f.t.admin.db
        .update(contractorSentFiles)
        .set({ createdAt: sql`now() - interval '31 minutes'` })
        .where(inArray(contractorSentFiles.id, abandoned));
      expect(await purgeSentFiles(f.deps)).toBe(10);
      for (const id of abandoned) {
        expect([...storage.files.keys()].some((k) => k.includes(`/sent/${id}`))).toBe(false);
      }
      // Брошенная загрузка — не отправка: в истории её нет, место в пределе освободилось.
      expect((await history(cpAcc.id)).filter((h) => h.action === 'sent_file_purge')).toEqual([]);
      await send('org-a', cpAcc, grantAcc, [{ name: 'c.pdf', body: PDF() }]);
    });

    it('без входа — 401, неверные данные — 400 по схеме', async () => {
      const [id] = await send('org-a', cpAcc, grantAcc, [{ name: 'Акт.pdf', body: PDF() }]);
      for (const [method, path] of [
        ['GET', '/api/files/sent'],
        ['GET', '/api/files/sent/values?col=st'],
        ['GET', '/api/files/sent/count'],
        ['GET', `/api/files/sent/${id}/link`],
        ['GET', `/api/files/sent/${id}/download`],
        ['POST', `/api/files/sent/${id}/accept`],
        ['POST', `/api/files/sent/${id}/reject`],
        ['GET', `/api/contractors/${cpAcc.id}/sent-files`],
        ['GET', `/api/contractors/${cpAcc.id}/page/sent-upload`],
        ['POST', `/api/contractors/${cpAcc.id}/page/sent-upload`],
      ] as const) {
        const res = await call(
          method,
          path,
          undefined,
          method === 'POST' ? { version: 1 } : undefined,
        );
        expect(res.status, `${method} ${path}`).toBe(401);
      }
      for (const [path, body] of [
        [`/api/files/sent/${id}/accept`, {}],
        [`/api/files/sent/${id}/reject`, { reason: 'Не тот месяц' }],
        ['/api/files/sent/не-номер/accept', { version: 1 }],
      ] as const) {
        const res = await call('POST', path, acc, body);
        expect(res.status, path).toBe(400);
        expect((await failure(res)).code, path).toBe('validation_failed');
      }
      for (const [path, body] of [
        [`/api/page/org-a/${cpAcc.inn}/sent/complete`, {}],
        [`/api/page/org-a/${cpAcc.inn}/sent/complete`, { ids: ['не-номер'] }],
        [`/api/page/org-a/${cpAcc.inn}/sent`, { files: [{ name: 'a.pdf' }] }],
      ] as const) {
        const res = await pagePost(path, grantAcc, body);
        expect(res.status, path).toBe(400);
        expect((await failure(res)).code, path).toBe('validation_failed');
      }
    });

    it('проверки до загрузки: ни одного, больше 10, больше 20 МБ, запрещённое расширение', async () => {
      const codeOf = async (list: Pick[]) => {
        const res = await start('org-a', cpAcc, grantAcc, list);
        return [res.status, (await failure(res)).code];
      };
      expect(await codeOf([])).toEqual([400, 'sent_none']);
      expect(
        await codeOf(Array.from({ length: 11 }, (_, i) => ({ name: `f${i}.pdf`, body: PDF() }))),
      ).toEqual([400, 'sent_too_many']);
      expect(await codeOf([{ name: 'big.pdf', body: PDF(), size: 21 * 1024 * 1024 }])).toEqual([
        400,
        'sent_too_large',
      ]);
      expect(await codeOf([{ name: 'setup.exe', body: EXE }])).toEqual([400, 'sent_forbidden']);
      expect(await codeOf([{ name: 'page.html', body: HTML }])).toEqual([400, 'sent_forbidden']);
      // Документ с макросами от контрагента не принимается (п. И-10).
      expect(await codeOf([{ name: 'Расчёт.xlsm', body: PDF() }])).toEqual([400, 'sent_forbidden']);
    });

    it('не больше 20 файлов в сутки от контрагента — со страницы и из Telegram вместе', async () => {
      await send(
        'org-a',
        cpAcc,
        grantAcc,
        Array.from({ length: 10 }, (_, i) => ({ name: `a${i}.pdf`, body: PDF() })),
      );
      await addSentFiles(f.deps, {
        orgId: f.a.orgId,
        contractorId: cpAcc.id,
        source: 'telegram',
        senderName: 'Айнура',
        tgChatId: CLIENT_CHAT,
        files: Array.from({ length: 8 }, (_, i) => ({ name: `t${i}.pdf`, bytes: PDF() })),
      });
      const left = await start(
        'org-a',
        cpAcc,
        grantAcc,
        Array.from({ length: 3 }, (_, i) => ({ name: `b${i}.pdf`, body: PDF() })),
      );
      expect(left.status).toBe(429);
      const err = await failure(left);
      expect(err).toMatchObject({ code: 'sent_day_left' });
      expect(err.message).toContain('Сегодня осталось: 2');
      await send('org-a', cpAcc, grantAcc, [
        { name: 'c1.pdf', body: PDF() },
        { name: 'c2.pdf', body: PDF() },
      ]);
      const none = await start('org-a', cpAcc, grantAcc, [{ name: 'd.pdf', body: PDF() }]);
      expect(none.status).toBe(429);
      expect((await failure(none)).code).toBe('sent_day_limit');
    });

    it('«Добавить отправленный файл» для Telegram: тип по содержимому, источник и имя отправителя, сообщение ответственному', async () => {
      await expect(
        addSentFiles(f.deps, {
          orgId: f.a.orgId,
          contractorId: cpAcc.id,
          source: 'telegram',
          tgChatId: CLIENT_CHAT,
          files: [{ name: 'фото.jpg', bytes: EXE }],
        }),
      ).rejects.toBeInstanceOf(SentFilesRefused);
      const { ids } = await addSentFiles(f.deps, {
        orgId: f.a.orgId,
        contractorId: cpAcc.id,
        source: 'telegram',
        senderName: '  Айнура Турдубаева ',
        tgChatId: CLIENT_CHAT,
        comment: 'Табель за октябрь',
        files: [{ name: 'Табель.jpg', bytes: JPEG }],
      });
      const item = (await cardList(acc, cpAcc)).items.find((x) => x.id === ids[0]);
      expect(item).toMatchObject({
        source: 'telegram',
        senderName: 'Айнура Турдубаева',
        comment: 'Табель за октябрь',
        status: 'new',
      });
      expect(tg.sent.filter((m) => m.chatId === CHAT_ACC)).toHaveLength(1);
      // История: имя в Telegram — для строки «Контрагент отправил через Telegram («<имя>») файл»
      // (прототип v115 pgFileIn); на странице контрагента — «· из Telegram» (pubSentHtml).
      expect((await history(cpAcc.id)).at(-1)!.changes).toEqual(
        expect.arrayContaining([
          { field: 'source', to: 'telegram' },
          { field: 'sender', to: 'Айнура Турдубаева' },
        ]),
      );
      const page = await publicPage('org-a', cpAcc, grantAcc);
      expect(page.sent?.items.find((x) => x.id === ids[0])).toMatchObject({ telegram: true });
      // Отправка выключена у контрагента — отказ `sent_off`.
      await f.t.admin.db
        .update(schema.contractorPages)
        .set({ filesUpload: false })
        .where(eq(schema.contractorPages.contractorId, cpAcc.id));
      await expect(
        addSentFiles(f.deps, {
          orgId: f.a.orgId,
          contractorId: cpAcc.id,
          source: 'telegram',
          tgChatId: CLIENT_CHAT,
          files: [{ name: 'a.pdf', bytes: PDF() }],
        }),
      ).rejects.toMatchObject({ refusal: { code: 'sent_off' } });
    });

    // ОТКЛОНЕНИЕ: docs/deviations.md#И-10
    it('из Telegram — только из чата, подключённого к этому контрагенту сейчас: чужой и отключённый чат — «не принимает файлы»', async () => {
      const add = (chatId: number) =>
        addSentFiles(f.deps, {
          orgId: f.a.orgId,
          contractorId: cpAcc.id,
          source: 'telegram',
          tgChatId: chatId,
          files: [{ name: 'Акт.pdf', bytes: PDF() }],
        });
      const keys = () => [...storage.files.keys()].filter((k) => k.includes('/sent/')).sort();
      const before = keys();
      await expect(add(9199)).rejects.toMatchObject({ refusal: { code: 'sent_off' } });
      // Сотрудник отключил Telegram клиента, пока файл скачивался.
      await f.t.admin.db
        .update(schema.contractorTelegramLinks)
        .set({ status: 'off' })
        .where(eq(schema.contractorTelegramLinks.chatId, CLIENT_CHAT));
      try {
        await expect(add(CLIENT_CHAT)).rejects.toMatchObject({ refusal: { code: 'sent_off' } });
      } finally {
        await f.t.admin.db
          .update(schema.contractorTelegramLinks)
          .set({ status: 'on' })
          .where(eq(schema.contractorTelegramLinks.chatId, CLIENT_CHAT));
      }
      expect((await cardList(acc, cpAcc)).items).toEqual([]);
      expect(keys()).toEqual(before);
      const { ids } = await add(CLIENT_CHAT);
      expect(ids).toHaveLength(1);
    });

    // ОТКЛОНЕНИЕ: docs/deviations.md#И-10
    describe('повторное удаление из хранилища', () => {
      const retries = async () =>
        (
          await f.t.admin.db
            .select({ key: schema.storageDeleteRetries.key })
            .from(schema.storageDeleteRetries)
        )
          .map((r) => r.key)
          .sort();
      /** Хранилище, в котором удаление не удаётся (S3 недоступно). */
      const noDelete = () => {
        const s = Object.create(storage) as MemoryStorage;
        s.delete = async () => {
          throw new Error('S3 недоступно');
        };
        return s;
      };

      it('«Принять», когда хранилище не удаляет: загрузка — на повторное удаление, задача удаляет её, а копию в файлах контрагента не трогает', async () => {
        const [id] = await send('org-a', cpAcc, grantAcc, [
          { name: 'Акт сверки.pdf', body: PDF() },
        ]);
        const key = (await keyOf(id!))!;
        const flakyApp = createApp({ ...f.deps, storage: noDelete() });
        try {
          const ok = await apiRequest(flakyApp, 'POST', `/api/files/sent/${id}/accept`, acc, {
            version: await versionOf(acc, cpAcc, id!),
          });
          expect(ok.status, await ok.clone().text()).toBe(200);
          const [copy] = await f.t.admin.db
            .select({ key: files.storageKey })
            .from(files)
            .where(eq(files.id, SentFileItem.parse(await ok.json()).fileId!));
          expect(storage.files.has(key)).toBe(true);
          expect(await retries()).toEqual([key, `${key}.up`].sort());
          // Ключ копии (её строка жива) на повтор попасть может — задача его не удалит.
          await f.t.admin.db.insert(schema.storageDeleteRetries).values({ key: copy!.key });
          expect(await retryStorageDeletes(f.deps)).toBe(2);
          expect(storage.files.has(key)).toBe(false);
          expect(storage.files.has(copy!.key)).toBe(true);
          expect(await retries()).toEqual([]);
        } finally {
          await f.t.admin.db.delete(schema.storageDeleteRetries);
        }
      });

      it('«Отправить файл» со страницы, когда хранилище не удаляет: загрузка и проверочная копия — на повторное удаление, файл остаётся', async () => {
        const del = storage.delete;
        try {
          storage.delete = async () => {
            throw new Error('S3 недоступно');
          };
          let key: string;
          try {
            const [id] = await send('org-a', cpAcc, grantAcc, [
              { name: 'Счёт со страницы.pdf', body: PDF('page') },
            ]);
            key = (await keyOf(id!))!;
            const left = await retries();
            expect(left).toHaveLength(2);
            expect(left).toContain(`${key}.up`);
            expect(left.some((k) => k.startsWith(`${key}.chk-`))).toBe(true);
          } finally {
            storage.delete = del;
          }
          expect(await retryStorageDeletes(f.deps)).toBe(2);
          expect(storage.files.has(`${key}.up`)).toBe(false);
          expect([...storage.files.keys()].some((k) => k.startsWith(`${key}.chk-`))).toBe(false);
          expect(storage.files.has(key)).toBe(true);
          expect(await retries()).toEqual([]);
        } finally {
          storage.delete = del;
          await f.t.admin.db.delete(schema.storageDeleteRetries);
        }
      });

      it('«Добавить отправленный файл» не удался, и хранилище не удаляет: положенный файл — на повторное удаление', async () => {
        const s = noDelete();
        let puts = 0;
        s.put = async (...args: Parameters<typeof storage.put>) => {
          puts += 1;
          if (puts > 1) throw new Error('S3 недоступно');
          return storage.put(...args);
        };
        const before = [...storage.files.keys()];
        try {
          await expect(
            addSentFiles(
              { ...f.deps, storage: s },
              {
                orgId: f.a.orgId,
                contractorId: cpAcc.id,
                source: 'telegram',
                tgChatId: CLIENT_CHAT,
                files: [
                  { name: 'Акт.pdf', bytes: PDF() },
                  { name: 'Счёт.pdf', bytes: PDF() },
                ],
              },
            ),
          ).rejects.toThrow('S3 недоступно');
          const left = [...storage.files.keys()].filter((k) => !before.includes(k));
          expect(left).toHaveLength(1);
          expect(await retries()).toHaveLength(2);
          expect(await retries()).toContain(left[0]);
          expect(await retryStorageDeletes(f.deps)).toBe(2);
          expect(storage.files.has(left[0]!)).toBe(false);
          expect((await cardList(acc, cpAcc)).items).toEqual([]);
        } finally {
          await f.t.admin.db.delete(schema.storageDeleteRetries);
        }
      });
    });

    // ОТКЛОНЕНИЕ: docs/deviations.md#И-10
    it('из Telegram: подключение отключили, пока файл шёл в хранилище, — файл не записан и удалён', async () => {
      const keys = () => [...storage.files.keys()].filter((k) => k.includes('/sent/')).sort();
      const before = keys();
      const link = eq(schema.contractorTelegramLinks.chatId, CLIENT_CHAT);
      const racing = Object.create(storage) as typeof storage;
      racing.put = async (...args: Parameters<typeof storage.put>) => {
        await f.t.admin.db
          .update(schema.contractorTelegramLinks)
          .set({ status: 'off' })
          .where(link);
        return storage.put(...args);
      };
      try {
        await expect(
          addSentFiles(
            { ...f.deps, storage: racing },
            {
              orgId: f.a.orgId,
              contractorId: cpAcc.id,
              source: 'telegram',
              tgChatId: CLIENT_CHAT,
              files: [{ name: 'Акт.pdf', bytes: PDF() }],
            },
          ),
        ).rejects.toMatchObject({ refusal: { code: 'sent_off' } });
      } finally {
        await f.t.admin.db.update(schema.contractorTelegramLinks).set({ status: 'on' }).where(link);
      }
      expect((await cardList(acc, cpAcc)).items).toEqual([]);
      expect(keys()).toEqual(before);
    });

    // ОТКЛОНЕНИЕ: docs/deviations.md#И-10
    it('имена файлов в Telegram — только тому, кто видит файлы: ответственный без «Просматривать файлы» получает текст прототипа без имён', async () => {
      const role = f.templateRole(f.a, 'acc');
      const [had] = await f.t.admin.db
        .select()
        .from(schema.rolePermissions)
        .where(
          and(
            eq(schema.rolePermissions.roleId, role),
            eq(schema.rolePermissions.permissionId, 'filesView'),
          ),
        );
      expect(had).toBeDefined();
      await f.t.admin.db
        .delete(schema.rolePermissions)
        .where(
          and(
            eq(schema.rolePermissions.roleId, role),
            eq(schema.rolePermissions.permissionId, 'filesView'),
          ),
        );
      const n0 = tg.sent.length;
      try {
        await send('org-a', cpAcc, grantAcc, [{ name: 'Выписка_ноябрь.pdf', body: PDF() }]);
        const sent = tg.sent.slice(n0);
        expect(sent.filter((m) => m.chatId === CHAT_OWNER)).toEqual([]);
        const toAcc = sent.filter((m) => m.chatId === CHAT_ACC);
        expect(toAcc).toHaveLength(1);
        expect(toAcc[0]!.text).toContain(UI_TEXTS['files.sent.tg.one.bare']!.ru);
        expect(toAcc[0]!.text).not.toContain('Выписка_ноябрь');
        expect(toAcc[0]!.text).not.toContain(cpAcc.name);
        expect(toAcc[0]!.text).not.toContain('/files');
      } finally {
        await f.t.admin.db.insert(schema.rolePermissions).values(had!);
      }
    });

    it('галочки «Контрагент может отправлять файлы»: учётная политика и карточка; без права — нельзя', async () => {
      const state = async (cookie: string) => {
        const res = await call('GET', `/api/contractors/${cpAcc.id}/page/sent-upload`, cookie);
        expect(res.status, await res.clone().text()).toBe(200);
        return SentUploadState.parse(await res.json());
      };
      const before = await state(owner);
      expect(before).toMatchObject({ shown: true, on: true, orgOn: true, manage: null });
      // Бухгалтер без права «Управлять страницей контрагента» видит, но не меняет.
      expect((await state(acc)).manage).toBe('page_manage_right');
      const denied = await call('POST', `/api/contractors/${cpAcc.id}/page/sent-upload`, acc, {
        on: false,
        version: before.version,
      });
      expect(denied.status).toBe(403);
      // Владелец выключает у контрагента — страница без кнопки, отправка — «sent_off».
      const off = await call('POST', `/api/contractors/${cpAcc.id}/page/sent-upload`, owner, {
        on: false,
        version: before.version,
      });
      expect(off.status, await off.clone().text()).toBe(200);
      expect(SentUploadState.parse(await off.json()).on).toBe(false);
      expect((await publicPage('org-a', cpAcc, grantAcc)).sent).toBeNull();
      const refused = await start('org-a', cpAcc, grantAcc, [{ name: 'a.pdf', body: PDF() }]);
      expect(refused.status).toBe(409);
      expect((await failure(refused)).code).toBe('sent_off');
      const changes = await f.t.admin.db
        .select({ changes: auditLog.changes })
        .from(auditLog)
        .where(and(eq(auditLog.contractorId, cpAcc.id), eq(auditLog.entity, 'contractor_page')))
        .orderBy(asc(auditLog.at), asc(auditLog.id));
      expect(changes.at(-1)!.changes).toEqual([{ field: 'filesUpload', from: true, to: false }]);

      // Учётная политика: выключено для всех — галочка карточки не меняется.
      const policy = await call('GET', '/api/org/policy', owner);
      const { version } = (await policy.json()) as { version: number };
      const pol = await apiRequest(f.app, 'PATCH', '/api/org/policy', owner, {
        version,
        cpFilesUpload: false,
      });
      expect(pol.status, await pol.clone().text()).toBe(200);
      expect(((await pol.json()) as { cpFilesUpload: boolean }).cpFilesUpload).toBe(false);
      const st = await state(owner);
      expect(st.orgOn).toBe(false);
      const blocked = await call('POST', `/api/contractors/${cpAcc.id}/page/sent-upload`, owner, {
        on: true,
        version: st.version,
      });
      expect(blocked.status).toBe(409);
      expect((await failure(blocked)).code).toBe('sent_upload_org_off');
      const chiefStart = await start('org-a', cpChief, grantChief, [
        { name: 'a.pdf', body: PDF() },
      ]);
      expect((await failure(chiefStart)).code).toBe('sent_off');
    });

    it('страница без кода этого браузера — «Страница недоступна»; чужие номера не заканчиваются', async () => {
      const none = await start('org-a', cpAcc, undefined, [{ name: 'a.pdf', body: PDF() }]);
      expect(none.status).toBe(404);
      expect((await failure(none)).code).toBe('page_unavailable');
      // Cookie другой страницы под этим адресом — не тот контрагент.
      const other = await start('org-a', cpAcc, grantChief, [{ name: 'a.pdf', body: PDF() }]);
      expect(other.status).toBe(404);
      const res = await start('org-a', cpAcc, grantAcc, [{ name: 'a.pdf', body: PDF() }]);
      const ticket = PageSentTicket.parse(await res.json());
      const stolen = await pagePost(`/api/page/org-a/${cpChief.inn}/sent/complete`, grantChief, {
        ids: ticket.items.map((x) => x.id),
      });
      expect(stolen.status).toBe(404);
      expect((await failure(stolen)).code).toBe('not_found');
      const foreign = await pagePost(`/api/page/org-b/${cpB.inn}/sent/complete`, grantB, {
        ids: ticket.items.map((x) => x.id),
      });
      expect(foreign.status).toBe(404);
    });

    it('права и область: без «Просматривать файлы» — 403, «Свои» — только свои контрагенты, решать — с «Загружать файлы»', async () => {
      const [id] = await send('org-a', cpChief, grantChief, [{ name: 'Акт.pdf', body: PDF() }]);
      expect((await call('GET', `/api/contractors/${cpChief.id}/sent-files`, senior)).status).toBe(
        403,
      );
      expect((await call('GET', '/api/files/sent', senior)).status).toBe(403);
      expect(
        SentFileCount.parse(await (await call('GET', '/api/files/sent/count', senior)).json())
          .count,
      ).toBeNull();
      // acc-a видит только своих контрагентов (область «Свои» группы «Файловый менеджер»).
      const own = await call('GET', `/api/contractors/${cpChief.id}/sent-files`, acc);
      expect(own.status).toBe(404);
      const version = await versionOf(chief, cpChief, id!);
      expect((await decide(acc, id!, 'accept', { version })).status).toBe(404);
      expect((await call('GET', `/api/files/sent/${id}/link?download=1`, acc)).status).toBe(404);
      expect((await call('GET', `/api/files/sent/${id}/download`, acc)).status).toBe(404);
      expect((await call('GET', `/api/files/sent/${id}/download`, senior)).status).toBe(403);
      expect((await decide(senior, id!, 'reject', { version, reason: 'нет' })).status).toBe(403);
      const tab = SentFileListPage.parse(
        await (await call('GET', '/api/files/sent?size=all&sort=ord.desc', acc)).json(),
      );
      expect(tab.items.some((x) => x.id === id)).toBe(false);
      const all = SentFileListPage.parse(
        await (await call('GET', '/api/files/sent?size=all&sort=ord.desc', chief)).json(),
      );
      expect(all.items.find((x) => x.id === id)).toMatchObject({
        status: 'new',
        responsible: 'chief-a',
        contractor: { id: cpChief.id },
      });
      expect(
        SentFileCount.parse(await (await call('GET', '/api/files/sent/count', chief)).json()).count,
      ).toBe(1);
      expect(
        SentFileCount.parse(await (await call('GET', '/api/files/sent/count', acc)).json()).count,
      ).toBe(0);
    });

    it('чужая организация не видна: файл организации А для сотрудников Б — 404', async () => {
      const [id] = await send('org-a', cpAcc, grantAcc, [{ name: 'Акт.pdf', body: PDF() }]);
      const version = await versionOf(acc, cpAcc, id!);
      for (const cookie of [ownerB, accB]) {
        expect((await call('GET', `/api/contractors/${cpAcc.id}/sent-files`, cookie)).status).toBe(
          404,
        );
        expect((await decide(cookie, id!, 'accept', { version })).status).toBe(404);
        expect((await decide(cookie, id!, 'reject', { version, reason: 'нет' })).status).toBe(404);
        expect((await call('GET', `/api/files/sent/${id}/link?download=1`, cookie)).status).toBe(
          404,
        );
        expect((await call('GET', `/api/files/sent/${id}/download`, cookie)).status).toBe(404);
        const tab = SentFileListPage.parse(
          await (await call('GET', '/api/files/sent?size=all&sort=ord.desc', cookie)).json(),
        );
        expect(tab.items).toHaveLength(0);
      }
      const rows = await f.t.app.db.execute(
        sql`select count(*)::int as n from contractor_sent_files`,
      );
      expect(rows).toBeDefined();
    });

    it('вкладка без «Страницы контрагента по ссылке» — 403 `cppage_off`, счётчик — null; «Файлы в карточках» выключены — 403', async () => {
      await features(f.a.orgId, { files: true, telegram: true });
      try {
        const res = await call('GET', '/api/files/sent', chief);
        expect(res.status).toBe(403);
        expect((await failure(res)).code).toBe('cppage_off');
        expect(
          SentFileCount.parse(await (await call('GET', '/api/files/sent/count', chief)).json())
            .count,
        ).toBeNull();
        await features(f.a.orgId, { cppage: true, telegram: true });
        const off = await call('GET', `/api/contractors/${cpAcc.id}/sent-files`, chief);
        expect(off.status).toBe(403);
        expect((await failure(off)).code).toBe('files_off');
      } finally {
        await features(f.a.orgId, { cppage: true, files: true, telegram: true });
      }
    });

    it('приёмка: непринятый файл через 30 дней удалён вместе с файлом в хранилище; принятый и 29-дневный остаются', async () => {
      const [oldNew, oldRej, young, kept] = await send('org-a', cpAcc, grantAcc, [
        { name: 'Старый.pdf', body: PDF() },
        { name: 'Отклонённый.pdf', body: PDF() },
        { name: 'Молодой.pdf', body: PDF() },
        { name: 'Принятый.pdf', body: PDF() },
      ]);
      const rej = await decide(acc, oldRej!, 'reject', {
        version: await versionOf(acc, cpAcc, oldRej!),
        reason: 'Не тот месяц',
      });
      expect(rej.status).toBe(200);
      const ok = await decide(acc, kept!, 'accept', {
        version: await versionOf(acc, cpAcc, kept!),
      });
      expect(ok.status).toBe(200);
      const back = (id: string, days: number) =>
        f.t.admin.db
          .update(contractorSentFiles)
          .set({ createdAt: sql`now() - make_interval(days => ${days})` })
          .where(eq(contractorSentFiles.id, id));
      await back(oldNew!, 30);
      await back(oldRej!, 31);
      await back(young!, 29);
      await back(kept!, 40);
      const keys = { oldNew: await keyOf(oldNew!), oldRej: await keyOf(oldRej!) };
      expect((await cardList(acc, cpAcc)).items.find((x) => x.id === oldNew)?.daysLeft).toBe(0);

      expect(await purgeSentFiles(f.deps)).toBe(2);
      const left = (await cardList(acc, cpAcc)).items.map((x) => x.id);
      expect(left).toEqual(expect.arrayContaining([young, kept]));
      expect(left).not.toContain(oldNew);
      expect(left).not.toContain(oldRej);
      expect(storage.files.has(keys.oldNew!)).toBe(false);
      expect(storage.files.has(keys.oldRej!)).toBe(false);
      const purged = (await history(cpAcc.id)).filter((h) => h.action === 'sent_file_purge');
      expect(purged.map((h) => [h.changes, h.userId])).toEqual(
        expect.arrayContaining([
          [[{ field: 'file', to: 'Старый.pdf' }], null],
          [[{ field: 'file', to: 'Отклонённый.pdf' }], null],
        ]),
      );
      // Повтор ничего не удаляет.
      expect(await purgeSentFiles(f.deps)).toBe(0);
    });

    it('список вкладки: значения столбца и выгрузка в Excel', async () => {
      await send('org-a', cpAcc, grantAcc, [{ name: 'Акт.pdf', body: PDF() }]);
      const values = await call('GET', '/api/files/sent/values?col=st', chief);
      expect(values.status, await values.clone().text()).toBe(200);
      const xlsx = await call('GET', '/api/files/sent/export?sort=ord.desc&cols=name,cp,st', chief);
      expect(xlsx.status, await xlsx.clone().text()).toBe(200);
      expect(xlsx.headers.get('content-type')).toContain('spreadsheetml');
    });
  },
);
