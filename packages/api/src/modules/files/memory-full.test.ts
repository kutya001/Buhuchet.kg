import { randomUUID } from 'node:crypto';
import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { FILE_MAX_BYTES } from '@buhuchet/domain';
import { ApiError, Contractor, ContractorPage } from '@buhuchet/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_ORIGIN, TEST_PASSWORD } from '../../testing';
import { addSentFiles, SentFilesRefused } from './sent-add';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

const MB = 1024 * 1024;
const PDF = new TextEncoder().encode('%PDF-1.7\nчек');
const FULL_TEXT =
  'Память организации заполнена: занято 0,1 из 0,1 ГБ. Купите память или удалите лишние файлы.';

// Память организации заполнена — новые файлы не загружаются (доработки 20.11.2026, блок 2, пункт 5;
// прототип subMemFullDlg): загрузка, замена файла, «Из свидетельства и выписки», файлы от контрагента со
// страницы и из Telegram. Предел в тесте — 100 МБ (включено 100 МБ на организацию, 0 за место), занято
// пятью файлами по 20 МБ — ровно 100 МБ.
describe.skipIf(!databaseAvailable())(
  'память организации заполнена: загрузка не начинается',
  () => {
    let f: Fixture;
    let owner: string;
    let acc: string;
    let ownerB: string;
    let cp: Contractor;
    let grant = '';
    const filler: string[] = [];

    const call = (method: 'GET' | 'POST', path: string, cookie: string, body?: unknown) =>
      apiRequest(f.app, method, path, cookie, body);
    const failure = async (res: Response) => ApiError.parse(await res.json()).error;
    const startUpload = (cookie: string, name = 'Акт.pdf') =>
      call('POST', '/api/files/uploads', cookie, {
        source: { kind: 'manual', id: null },
        name,
        size: 5,
      });
    const pendingOf = (orgId: string) =>
      f.t.admin.db
        .select({ id: schema.files.id })
        .from(schema.files)
        .where(and(eq(schema.files.orgId, orgId), eq(schema.files.state, 'pending')));
    /** Размер первого файла-заполнителя: меньше — память уже не заполнена. */
    const fillerSize = (sizeBytes: number) =>
      f.t.admin.db.update(schema.files).set({ sizeBytes }).where(eq(schema.files.id, filler[0]!));

    beforeAll(async () => {
      f = await createStaffFixture();
      await seedAllPlatformDictionaries(f.t.admin.db);
      const on = { cppage: true, files: true };
      for (const orgId of [f.a.orgId, f.b.orgId]) {
        await f.t.admin.db
          .update(schema.orgSettings)
          .set({ features: on })
          .where(eq(schema.orgSettings.orgId, orgId));
      }
      [owner, acc, ownerB] = await Promise.all([
        signIn(f.app, 'owner-a', TEST_PASSWORD),
        signIn(f.app, 'acc-a', TEST_PASSWORD),
        signIn(f.app, 'owner-b', TEST_PASSWORD),
      ]);
      const res = await call('POST', '/api/contractors', owner, {
        name: 'ОсОО «Память»',
        inn: '03744097401861',
        phone: '+996505890076',
        kind: 'regular',
        formCode: 'ФС-01',
        regimeCode: 'РЕЖ-01',
        gked: '46.34.0',
        gkedExtra: [],
        bases: [],
        startDate: '2024-07-16',
        responsibleEmployeeId: f.people['acc-a']!.employeeId,
      });
      expect(res.status, await res.clone().text()).toBe(201);
      cp = Contractor.parse(await res.json());
      const page = await call('POST', `/api/contractors/${cp.id}/page/enable`, owner);
      expect(page.status, await page.clone().text()).toBe(200);
      const code = await f.app.request(`/api/page/org-a/${cp.inn}/code`, {
        method: 'POST',
        headers: { origin: TEST_ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ code: ContractorPage.parse(await page.json()).code }),
      });
      expect(code.status, await code.clone().text()).toBe(200);
      grant = (code.headers.get('set-cookie') ?? '').split(';')[0]!;

      // Предел — 100 МБ у каждой организации; у организации А занято ровно столько.
      await f.t.admin.db.update(schema.subscriptionSettings).set({ baseMb: 100, seatMb: 0 });
      for (let i = 0; i < 5; i += 1) {
        const id = randomUUID();
        filler.push(id);
        await f.t.admin.db.insert(schema.files).values({
          id,
          orgId: f.a.orgId,
          sourceKind: 'manual',
          name: `Архив ${i + 1}.pdf`,
          contentType: 'application/pdf',
          sizeBytes: FILE_MAX_BYTES,
          storageKey: `org/${f.a.orgId}/files/${id}`,
          state: 'ready',
          createdBy: f.a.ownerUserId,
        });
      }
    });

    afterAll(async () => {
      await f?.t.drop();
    });

    it('«Загрузить файл»: 409 mem_full с занятым и пределом, загрузка не заведена; у другой организации — можно', async () => {
      for (const cookie of [owner, acc]) {
        const res = await startUpload(cookie);
        expect(res.status).toBe(409);
        expect(await failure(res)).toEqual({
          code: 'mem_full',
          message: FULL_TEXT,
          details: { used: '0,1', limit: '0,1', usedBytes: 100 * MB, limitBytes: 100 * MB },
        });
      }
      expect(await pendingOf(f.a.orgId)).toEqual([]);
      expect((await startUpload(ownerB)).status).toBe(201);
    });

    it('просмотр и скачивание остаются; занято меньше предела — загрузка снова идёт', async () => {
      const link = await call('GET', `/api/files/${filler[1]}/link`, owner);
      expect(link.status, await link.clone().text()).toBe(200);
      await fillerSize(FILE_MAX_BYTES - 1);
      try {
        expect((await startUpload(acc)).status).toBe(201);
      } finally {
        await fillerSize(FILE_MAX_BYTES);
      }
    });

    it('замена файла и «Из свидетельства и выписки» — тоже 409 mem_full', async () => {
      const pending = (await pendingOf(f.a.orgId)).length;
      const replace = await call('POST', `/api/files/${filler[2]}/replacement`, owner, {
        name: 'Новый.pdf',
        size: 5,
      });
      expect(replace.status).toBe(409);
      expect((await failure(replace)).code).toBe('mem_full');
      const regdocs = await call('POST', '/api/contractors/regdocs/uploads', owner, {
        name: 'Свидетельство.pdf',
        size: 5,
      });
      expect(regdocs.status).toBe(409);
      expect((await failure(regdocs)).message).toBe(FULL_TEXT);
      expect(await pendingOf(f.a.orgId)).toHaveLength(pending);
    });

    it('файл от контрагента со страницы и из Telegram: «Сейчас файл отправить нельзя. Сообщите вашему бухгалтеру»', async () => {
      const page = await f.app.request(`/api/page/org-a/${cp.inn}/sent`, {
        method: 'POST',
        headers: { origin: TEST_ORIGIN, 'content-type': 'application/json', cookie: grant },
        body: JSON.stringify({ files: [{ name: 'Счёт.pdf', size: PDF.length }] }),
      });
      expect(page.status).toBe(409);
      expect(await failure(page)).toMatchObject({
        code: 'sent_mem_full',
        message: 'Сейчас файл отправить нельзя. Сообщите вашему бухгалтеру',
      });
      const telegram = addSentFiles(f.deps, {
        orgId: f.a.orgId,
        contractorId: cp.id,
        source: 'telegram',
        senderName: 'Айнура',
        tgChatId: 9301,
        files: [{ name: 'Счёт.pdf', bytes: PDF }],
      });
      await expect(telegram).rejects.toBeInstanceOf(SentFilesRefused);
      await expect(telegram).rejects.toMatchObject({ refusal: { code: 'sent_mem_full' } });
      expect(
        await f.t.admin.db
          .select({ id: schema.contractorSentFiles.id })
          .from(schema.contractorSentFiles)
          .where(eq(schema.contractorSentFiles.contractorId, cp.id)),
      ).toEqual([]);
    });

    it('демо-организация — без предела памяти', async () => {
      await f.t.admin.db
        .update(schema.organizations)
        .set({ isDemo: true })
        .where(eq(schema.organizations.id, f.a.orgId));
      try {
        expect((await startUpload(owner)).status).toBe(201);
      } finally {
        await f.t.admin.db
          .update(schema.organizations)
          .set({ isDemo: false })
          .where(eq(schema.organizations.id, f.a.orgId));
      }
    });
  },
);
