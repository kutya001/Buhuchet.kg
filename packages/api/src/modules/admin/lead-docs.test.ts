import { createHash } from 'node:crypto';
import { fixedClock, type MemoryStorage } from '@buhuchet/adapters';
import { createFakeDocumentReader, type DocumentText } from '@buhuchet/adapters/documents';
import { releaseRateLimit, schema, storageRetryAdd, submitLead, takeRateLimit } from '@buhuchet/db';
import { databaseAvailable } from '@buhuchet/db/testing';
import {
  formatText,
  LEAD_DOC_MAX_BYTES,
  LEAD_DRAFT_HOURS,
  LEAD_READ_LIMIT,
  LEAD_UPLOAD_MESSAGES,
  pageIpSubject,
  UI_TEXTS,
} from '@buhuchet/domain';
import {
  AdminLeadCard,
  AdminOrgCard,
  ApiError,
  FileLink,
  LeadApproved,
  LeadDocsRead,
  LeadUploadTicket,
  OrgInnFormSaved,
} from '@buhuchet/shared';
import { and, eq, like, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import {
  apiRequest,
  createStaffFixture,
  leadDocDraft,
  signIn,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from '../../testing';
import fixture from '../contractors/__fixtures__/regdocs-docs.json';
import { retryStorageDeletes, STORAGE_RETRY_STUCK_ATTEMPTS } from '../files/storage-retry';
import { purgeLeadDocs } from './lead-purge';
import {
  LEAD_READ_ALL_RATE_LIMIT,
  LEAD_READ_RATE_LIMIT,
  LEAD_UPLOAD_ALL_RATE_LIMIT,
} from './lead-uploads';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

// Регистрация организации по выписке и свидетельству (доработки 14.11.2026, блок 1; прототип v114
// modules/lead-docs.js). Документы — синтетические свидетельство ИП, выписка и свидетельство Минюста
// вымышленных организаций (те же, что у «Из свидетельства и выписки»); чтение PDF — подделка по
// содержимому файла. Telegram заявителя (поток Т) здесь ставится прямо в базе.
describe.skipIf(!databaseAvailable())('Регистрация организации по документам', () => {
  let f: Fixture;
  let app: ReturnType<typeof createApp>;
  let storage: MemoryStorage;
  let admin: string;
  let owner: string;
  let n = 0;
  let chat = 7_100_000;

  const text = (name: keyof typeof fixture.docs): DocumentText => ({
    title: '',
    ...(fixture.docs[name] as Omit<DocumentText, 'ocr' | 'title'>),
    ocr: false,
  });
  const reader = createFakeDocumentReader({
    '%PDF-ipsv': { ok: true, doc: text('ipsv') },
    '%PDF-vyp': { ok: true, doc: text('vyp') },
    '%PDF-svid': { ok: true, doc: text('svid') },
    '%PDF-other': { ok: true, doc: text('vypOther') },
    '%PDF-scan': { ok: false, error: 'no_text' },
  });

  const failure = async (res: Response) => ApiError.parse(await res.json()).error;
  /** Оповещения администратору платформы вида `key` (ключ очереди `alert:<key>:<момент>`). */
  const alertsOf = (key: string) =>
    f.t.admin.db
      .select({ id: schema.telegramOutbox.id, text: schema.telegramOutbox.text })
      .from(schema.telegramOutbox)
      .where(like(schema.telegramOutbox.dedupeKey, `alert:${key}:%`));
  const dropAlerts = (key: string) =>
    f.t.admin.db
      .delete(schema.telegramOutbox)
      .where(like(schema.telegramOutbox.dedupeKey, `alert:${key}:%`));
  /** Сдвинуть момент постановки оповещений вида `key` на `hours` часов назад (предел — по часам базы). */
  const ageAlerts = (key: string, hours: number) =>
    f.t.admin.db
      .update(schema.telegramOutbox)
      .set({ createdAt: sql`clock_timestamp() - make_interval(hours => ${hours})` })
      .where(like(schema.telegramOutbox.dedupeKey, `alert:${key}:%`));
  const guest = (path: string, body: unknown, ip: string) =>
    app.request(path, {
      method: 'POST',
      headers: { origin: TEST_ORIGIN, 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify(body),
    });
  const get = (path: string, cookie = admin) =>
    app.request(path, {
      method: 'GET',
      headers: { origin: TEST_ORIGIN, cookie, 'sec-fetch-site': 'same-origin' },
    });
  const post = (path: string, body: unknown, cookie = admin) =>
    apiRequest(app, 'POST', path, cookie, body);
  const put = (path: string, body: unknown, cookie = admin) =>
    apiRequest(app, 'PUT', path, cookie, body);
  const leadRow = async (id: string) =>
    (
      await f.t.admin.db.select().from(schema.platformLeads).where(eq(schema.platformLeads.id, id))
    )[0]!;
  const leadDocs = (leadId: string) =>
    f.t.admin.db
      .select()
      .from(schema.platformLeadDocs)
      .where(eq(schema.platformLeadDocs.leadId, leadId));
  const card = async (id: string) => {
    const res = await get(`/api/admin/leads/${id}`);
    expect(res.status, await res.clone().text()).toBe(200);
    return AdminLeadCard.parse(await res.json());
  };

  /** Заявка с документами ИП с лендинга: свой телефон и адрес. */
  const ipLead = async (over: Record<string, unknown> = {}, content = '%PDF-ipsv') => {
    n += 1;
    const { draft } = await leadDocDraft(app, storage, [{ kind: 'gns_cert', content }]);
    const phone = `+996700${String(300000 + n)}`;
    const res = await guest(
      '/api/leads',
      {
        name: 'Азамат Токтогулов',
        firm: `ИП Токтогулов ${n}`,
        phone,
        size: '21–50',
        telegram: '',
        note: '',
        consent: true,
        website: '',
        form: 'ip',
        inn: `215031990${String(10000 + n)}`,
        okpo: '31415926',
        address: 'Бишкек г., улица Киевская, дом 15',
        head: 'Токтогулов Азамат Бакытович',
        draft,
        ...over,
      },
      `198.18.0.${n}`,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const [row] = await f.t.admin.db
      .select()
      .from(schema.platformLeads)
      .where(eq(schema.platformLeads.phone, phone));
    return row!;
  };
  /** Заявитель подключил Telegram (поток Т: «Старт» по ссылке заявки). */
  const tgLinked = async (id: string) => {
    chat += 1;
    await f.t.admin.db
      .update(schema.platformLeads)
      .set({ tgChatId: chat, tgLinkedAt: new Date('2026-10-18T02:30:00Z') })
      .where(eq(schema.platformLeads.id, id));
  };

  beforeAll(async () => {
    f = await createStaffFixture();
    storage = f.deps.storage as MemoryStorage;
    app = createApp({ ...f.deps, documents: reader });
    admin = await signIn(app, 'platform-admin', TEST_PASSWORD);
    owner = await signIn(app, 'owner-a', TEST_PASSWORD);
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  describe('документы формы', () => {
    it('начать загрузку, положить PDF по ссылке, прочитать: данные для полей, текст документа не хранится', async () => {
      const { draft, ids, read } = await leadDocDraft(app, storage, [
        { kind: 'gns_cert', content: '%PDF-ipsv', name: 'svidetelstvo.pdf' },
      ]);
      expect(read.status, await read.clone().text()).toBe(200);
      expect(read.headers.get('cache-control')).toBe('no-store');
      const body = LeadDocsRead.parse(await read.json());
      expect(body.found).toBe('found');
      expect(body.values.inn).toBe('21503199000123');
      expect(body.values.okpo).toBe('31415926');
      expect(body.values.head).toContain('Токтогулов Азамат');
      expect(body.docs).toEqual([{ id: ids[0], kind: 'gns_cert', name: 'svidetelstvo.pdf' }]);
      const [row] = await f.t.admin.db
        .select()
        .from(schema.platformLeadUploads)
        .where(eq(schema.platformLeadUploads.draftId, draft));
      expect(row).toMatchObject({ state: 'ready', kind: 'gns_cert' });
      expect(JSON.stringify(row)).not.toContain('Киевская улица Первомайский');
      expect(JSON.stringify((row as { doc?: unknown }).doc ?? {})).not.toContain('"text":"У');
    });

    it('скан без текста — документ остаётся, поля пустые («ничего не нашли»); новый файл того же вида заменяет прежний', async () => {
      const first = await leadDocDraft(app, storage, [{ kind: 'gns_cert', content: '%PDF-scan' }]);
      expect(LeadDocsRead.parse(await first.read.json()).found).toBe('none');
      const again = await leadDocDraft(
        app,
        storage,
        [{ kind: 'gns_cert', content: '%PDF-ipsv' }],
        first.draft,
      );
      const body = LeadDocsRead.parse(await again.read.json());
      expect(body.found).toBe('found');
      expect(body.docs.map((d) => d.id)).toEqual(again.ids);
      // Прежний файл того же вида удалён из хранилища.
      expect(storage.files.has(`leads/upload/${first.ids[0]}`)).toBe(false);
    });

    it('выписка и свидетельство разных организаций — «документы разных организаций»', async () => {
      const { read } = await leadDocDraft(app, storage, [
        { kind: 'extract', content: '%PDF-vyp' },
        { kind: 'minjust_cert', content: '%PDF-other' },
      ]);
      expect(LeadDocsRead.parse(await read.json()).found).toBe('diff');
    });

    it('не PDF по содержимому — «Только PDF»: загрузка и файл убраны; больше 20 МБ — отказ до ссылки', async () => {
      const { draft, ids, read } = await leadDocDraft(app, storage, [
        { kind: 'gns_cert', content: 'MZ это не PDF', name: 'scan.pdf' },
      ]);
      expect(read.status).toBe(400);
      expect(await failure(read)).toMatchObject({ code: 'lead_doc_pdf', message: 'Только PDF' });
      expect(storage.files.has(`leads/upload/${ids[0]}`)).toBe(false);
      // Строка остаётся отметкой `gone` — задача по сроку удалит и файл, положенный по старой ссылке.
      expect(
        await f.t.admin.db
          .select({ state: schema.platformLeadUploads.state, doc: schema.platformLeadUploads.doc })
          .from(schema.platformLeadUploads)
          .where(eq(schema.platformLeadUploads.draftId, draft)),
      ).toEqual([{ state: 'gone', doc: null }]);
      const big = await guest(
        '/api/leads/uploads',
        { draft: null, kind: 'gns_cert', name: 'big.pdf', size: LEAD_DOC_MAX_BYTES + 1 },
        '198.18.1.1',
      );
      expect(big.status).toBe(400);
      expect(JSON.stringify(await big.json())).toContain('land.e.big');
    });

    it('файл не дошёл до хранилища или другого размера — 409; загрузка чужого черновика — 404', async () => {
      const ip = '198.18.1.2';
      const start = async () => {
        const res = await guest(
          '/api/leads/uploads',
          { draft: null, kind: 'gns_cert', name: 'a.pdf', size: 9 },
          ip,
        );
        expect(res.status).toBe(201);
        return LeadUploadTicket.parse(await res.json());
      };
      const missing = await start();
      const r1 = await guest(`/api/leads/uploads/${missing.id}/read`, { draft: missing.draft }, ip);
      expect(r1.status).toBe(409);
      expect((await failure(r1)).code).toBe('lead_upload_missing');

      const short = await start();
      await storage.put(`leads/upload/${short.id}`, new TextEncoder().encode('%PDF-ip'), {
        contentType: 'application/pdf',
      });
      const r2 = await guest(`/api/leads/uploads/${short.id}/read`, { draft: short.draft }, ip);
      expect(r2.status).toBe(409);

      const other = await start();
      const r3 = await guest(`/api/leads/uploads/${other.id}/read`, { draft: missing.draft }, ip);
      expect(r3.status).toBe(404);
    });

    it('пределы: одиннадцатая загрузка с адреса за час — 429', async () => {
      const ip = '198.18.1.3';
      for (let i = 0; i < 10; i++) {
        const res = await guest(
          '/api/leads/uploads',
          { draft: null, kind: 'gns_cert', name: `${i}.pdf`, size: 10 },
          ip,
        );
        expect(res.status).toBe(201);
      }
      const over = await guest(
        '/api/leads/uploads',
        { draft: null, kind: 'gns_cert', name: 'x.pdf', size: 10 },
        ip,
      );
      expect(over.status).toBe(429);
      expect(await failure(over)).toMatchObject({
        code: 'lead_upload_limit',
        message: LEAD_UPLOAD_MESSAGES.lead_upload_limit,
      });
    });

    it('файл в хранилище больше 20 МБ, хотя заявлен меньше, — «Файл больше 20 МБ»: загрузка и файл убраны', async () => {
      const ip = '198.18.1.4';
      const res = await guest(
        '/api/leads/uploads',
        { draft: null, kind: 'gns_cert', name: 'big.pdf', size: 1000 },
        ip,
      );
      expect(res.status).toBe(201);
      const ticket = LeadUploadTicket.parse(await res.json());
      const key = `leads/upload/${ticket.id}`;
      const bytes = new Uint8Array(LEAD_DOC_MAX_BYTES + 1);
      bytes.set(new TextEncoder().encode('%PDF-ipsv'));
      await storage.put(key, bytes, { contentType: 'application/pdf' });
      const read = await guest(`/api/leads/uploads/${ticket.id}/read`, { draft: ticket.draft }, ip);
      expect(read.status).toBe(400);
      expect(await failure(read)).toMatchObject({
        code: 'lead_doc_big',
        message: 'Файл больше 20 МБ',
      });
      expect(storage.files.has(key)).toBe(false);
    });

    it('чтения: пока читается прежнее — «Документ ещё читается»; больше 20 за час с адреса — 429', async () => {
      const ip = '198.18.1.5';
      const started = await guest(
        '/api/leads/uploads',
        { draft: null, kind: 'gns_cert', name: 'a.pdf', size: 9 },
        ip,
      );
      const ticket = LeadUploadTicket.parse(await started.json());
      await storage.put(`leads/upload/${ticket.id}`, new TextEncoder().encode('%PDF-scan'), {
        contentType: 'application/pdf',
      });
      const read = () => guest(`/api/leads/uploads/${ticket.id}/read`, { draft: ticket.draft }, ip);
      // Чтение с того же адреса уже идёт (аренда предела занята).
      const subject = createHash('sha256')
        .update(`lead:${pageIpSubject(ip)}`, 'utf8')
        .digest('hex');
      const held = await takeRateLimit(f.deps.db, LEAD_READ_RATE_LIMIT, subject);
      if (!held.ok) throw new Error('предел чтения занят');
      const busy = await read();
      expect(busy.status).toBe(429);
      expect(await failure(busy)).toMatchObject({
        code: 'lead_read_busy',
        message: LEAD_UPLOAD_MESSAGES.lead_read_busy,
      });
      await releaseRateLimit(f.deps.db, LEAD_READ_RATE_LIMIT, subject, held.ticket);
      // Занятое чтение — в счёте за час: ещё LEAD_READ_LIMIT − 1.
      for (let i = 1; i < LEAD_READ_LIMIT; i++) {
        const res = await read();
        expect([i, res.status]).toEqual([i, 200]);
      }
      const over = await read();
      expect(over.status).toBe(429);
      expect(await failure(over)).toMatchObject({
        code: 'lead_read_limit',
        message: LEAD_UPLOAD_MESSAGES.lead_read_limit,
      });
    });

    // ОТКЛОНЕНИЕ: docs/deviations.md#И-10
    it('имя документа: без «.pdf» на конце — с «.pdf»; со знаками смены направления, «/», «\\» или точкой в конце — «Только PDF» до ссылки', async () => {
      const ip = '198.18.1.6';
      for (const name of ['Выписка\u202Efdp.bat', 'Выписка.pdf.', 'папка/a.pdf', 'a\\b.pdf']) {
        const res = await guest(
          '/api/leads/uploads',
          { draft: null, kind: 'gns_cert', name, size: 9 },
          ip,
        );
        expect([name, res.status]).toEqual([name, 400]);
        expect(await failure(res)).toMatchObject({ code: 'lead_doc_pdf', message: 'Только PDF' });
      }
      const names = async (name: string) => {
        const { read } = await leadDocDraft(app, storage, [
          { kind: 'gns_cert', content: '%PDF-ipsv', name },
        ]);
        return LeadDocsRead.parse(await read.json()).docs.map((d) => d.name);
      };
      // «%PDF-» в начале .bat не делает его документом: имя — с «.pdf», скачивается как PDF.
      expect(await names('Выписка.bat')).toEqual(['Выписка.bat.pdf']);
      expect(await names('свидетельство')).toEqual(['свидетельство.pdf']);
      expect(await names('СВИДЕТЕЛЬСТВО.PDF')).toEqual(['СВИДЕТЕЛЬСТВО.PDF']);
      const long = `${'я'.repeat(252)}.x`;
      const [kept] = await names(long);
      expect(kept!.length).toBe(255);
      expect(kept!.endsWith('.pdf')).toBe(true);
    });

    // ОТКЛОНЕНИЕ: docs/deviations.md#И-10
    it('прочитанный документ второй раз не разбирается: повтор отвечает по сохранённому разбору', async () => {
      const { draft, ids, read } = await leadDocDraft(app, storage, [
        { kind: 'gns_cert', content: '%PDF-ipsv' },
      ]);
      expect(LeadDocsRead.parse(await read.json()).found).toBe('found');
      const calls = reader.calls;
      // Файл подменили по ещё живой ссылке — повтор чтения его не скачивает и не разбирает.
      await storage.put(`leads/upload/${ids[0]}`, new TextEncoder().encode('%PDF-other'), {
        contentType: 'application/pdf',
      });
      const again = await guest(`/api/leads/uploads/${ids[0]}/read`, { draft }, '198.18.1.7');
      expect(again.status, await again.clone().text()).toBe(200);
      const body = LeadDocsRead.parse(await again.json());
      expect(body.found).toBe('found');
      expect(body.values.inn).toBe('21503199000123');
      expect(reader.calls).toBe(calls);
    });
  });

  describe('отправка заявки с документами', () => {
    it('форма и данные из документов — в заявке, документы — под ключами заявки, черновик убран', async () => {
      const lead = await ipLead();
      expect(lead).toMatchObject({
        legalForm: 'ip',
        okpo: '31415926',
        address: 'Бишкек г., улица Киевская, дом 15',
        head: 'Токтогулов Азамат Бакытович',
        docsState: 'ready',
      });
      expect(lead.inn).toMatch(/^[0-9]{14}$/);
      // Срок хранения — 30 дней после отправки (прототип v114 LEAD_KEEP).
      expect(lead.docsPurgeAt!.getTime() - lead.createdAt.getTime()).toBe(30 * 86_400_000);
      const docs = await leadDocs(lead.id);
      expect(docs).toEqual([
        expect.objectContaining({
          kind: 'gns_cert',
          state: 'ready',
          storageKey: `leads/${lead.id}/${docs[0]!.id}`,
        }),
      ]);
      expect(storage.files.has(docs[0]!.storageKey)).toBe(true);
      expect([...storage.files.keys()].some((k) => k === `leads/upload/${docs[0]!.id}`)).toBe(
        false,
      );
    });

    it('без нужного документа — ошибка под полем документа, заявка не создаётся', async () => {
      const { draft } = await leadDocDraft(app, storage, [
        { kind: 'extract', content: '%PDF-vyp' },
      ]);
      const before = (await f.t.admin.db.select().from(schema.platformLeads)).length;
      const res = await guest(
        '/api/leads',
        {
          name: 'Нурлан Асанов',
          firm: 'ОсОО «Тестовая бухгалтерия»',
          phone: '+996700399001',
          size: '21–50',
          telegram: '',
          note: '',
          consent: true,
          website: '',
          form: 'osoo',
          inn: '01811201810456',
          okpo: '',
          address: '',
          head: '',
          draft,
        },
        '198.18.2.1',
      );
      expect(res.status).toBe(400);
      const body = await failure(res);
      expect(body.code).toBe('validation_failed');
      expect(JSON.stringify(body.details)).toContain('minjust_cert');
      expect(JSON.stringify(body.details)).toContain('land.e.doc.mj');
      expect((await f.t.admin.db.select().from(schema.platformLeads)).length).toBe(before);
    });

    it('файл документа не перенёсся под ключ заявки — документ «переносится», «Одобрить» неактивна с причиной', async () => {
      n += 1;
      const { draft, ids } = await leadDocDraft(app, storage, [
        { kind: 'gns_cert', content: '%PDF-ipsv' },
      ]);
      // Файл пропал из хранилища до переноса (сбой хранилища): заявка всё равно сохранена.
      await storage.delete(`leads/upload/${ids[0]}`);
      const phone = `+996700${String(300000 + n)}`;
      const res = await guest(
        '/api/leads',
        {
          name: 'Азамат Токтогулов',
          firm: `ИП Токтогулов ${n}`,
          phone,
          size: '21–50',
          telegram: '',
          note: '',
          consent: true,
          website: '',
          form: 'ip',
          inn: `215031990${String(10000 + n)}`,
          okpo: '',
          address: '',
          head: '',
          draft,
        },
        `198.18.0.${n}`,
      );
      expect(res.status).toBe(200);
      const [lead] = await f.t.admin.db
        .select()
        .from(schema.platformLeads)
        .where(eq(schema.platformLeads.phone, phone));
      expect(lead).toMatchObject({ docsState: 'pending' });
      expect(await leadDocs(lead!.id)).toEqual([expect.objectContaining({ state: 'pending' })]);
      await tgLinked(lead!.id);
      expect((await card(lead!.id)).approve?.refusal).toBe('lead_docs_pending');
    });

    it('повтор с того же телефона документов не получает: файлы черновика удалены (п. И-9)', async () => {
      const lead = await ipLead();
      const { draft, ids } = await leadDocDraft(app, storage, [
        { kind: 'gns_cert', content: '%PDF-ipsv' },
      ]);
      const res = await guest(
        '/api/leads',
        {
          name: lead.name,
          firm: lead.firm,
          phone: lead.phone,
          size: '21–50',
          telegram: '',
          note: 'Ещё раз',
          consent: true,
          website: '',
          form: 'ip',
          inn: lead.inn,
          okpo: '',
          address: '',
          head: '',
          draft,
        },
        '198.18.2.2',
      );
      expect(res.status).toBe(200);
      expect(await leadDocs(lead.id)).toHaveLength(1);
      expect(storage.files.has(`leads/upload/${ids[0]}`)).toBe(false);
    });
  });

  describe('«Одобрить» в Админке', () => {
    it('неактивна с причиной, пока заявитель не подключил Telegram; затем — организация, владелец без временного пароля и файлы заявки', async () => {
      const lead = await ipLead();
      const before = await card(lead.id);
      expect(before.legalForm).toBe('ip');
      expect(before.docFiles).toEqual([
        expect.objectContaining({ kind: 'gns_cert', pending: false }),
      ]);
      expect(before.approve).toMatchObject({
        refusal: 'lead_no_telegram',
        message: 'Заявитель ещё не подключил Telegram',
        login: 'azamat.toktogulov',
      });
      const early = await post(`/api/admin/leads/${lead.id}/approve`, {
        login: 'azamat.toktogulov',
        version: before.version,
      });
      expect(early.status).toBe(409);
      expect((await failure(early)).code).toBe('lead_no_telegram');

      await tgLinked(lead.id);
      const ready = await card(lead.id);
      expect(ready.approve).toMatchObject({ refusal: null, message: null });

      // Логин занят — ошибка под полем, ничего не создано, копии файлов убраны.
      const keysBefore = [...storage.files.keys()].filter((k) => k.startsWith('org/')).length;
      const taken = await post(`/api/admin/leads/${lead.id}/approve`, {
        login: 'owner-a',
        version: ready.version,
      });
      expect(taken.status).toBe(400);
      expect(await failure(taken)).toMatchObject({ code: 'login_taken' });
      expect([...storage.files.keys()].filter((k) => k.startsWith('org/')).length).toBe(keysBefore);
      expect((await leadRow(lead.id)).createdOrgId).toBeNull();

      const badLogin = await post(`/api/admin/leads/${lead.id}/approve`, {
        login: 'аз',
        version: ready.version,
      });
      expect(badLogin.status).toBe(400);
      expect((await failure(badLogin)).code).toBe('invalid_login');

      const stale = await post(`/api/admin/leads/${lead.id}/approve`, {
        login: 'azamat.toktogulov',
        version: ready.version - 1,
      });
      expect(stale.status).toBe(409);
      expect((await failure(stale)).code).toBe('record_changed');

      const res = await post(`/api/admin/leads/${lead.id}/approve`, {
        login: ' Azamat.Toktogulov ',
        version: ready.version,
      });
      expect(res.status, await res.clone().text()).toBe(201);
      const done = LeadApproved.parse(await res.json());
      const [org] = await f.t.admin.db
        .select()
        .from(schema.organizations)
        .where(eq(schema.organizations.id, done.orgId));
      expect(org).toMatchObject({
        name: lead.firm,
        inn: lead.inn,
        legalForm: 'ip',
        okpo: '31415926',
        address: 'Бишкек г., улица Киевская, дом 15',
        head: 'Токтогулов Азамат Бакытович',
      });
      const [user] = await f.t.admin.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, done.ownerUserId));
      expect(user).toMatchObject({ login: 'azamat.toktogulov', mustChangePassword: false });
      // «Одобрить» подписку не ставит (прототип ldApproveDlg; доработки 20.11.2026, блок 6, пункт 4):
      // у организации «Нет подписки», её ставит «Изменить подписку».
      expect(
        await f.t.admin.db
          .select()
          .from(schema.orgSubscriptions)
          .where(eq(schema.orgSubscriptions.orgId, done.orgId)),
      ).toEqual([]);
      // Файлы заявки — в «Файловом менеджере» организации с источником «Заявка на подключение».
      const files = await f.t.admin.db
        .select()
        .from(schema.files)
        .where(and(eq(schema.files.orgId, done.orgId), eq(schema.files.sourceKind, 'lead')));
      expect(files).toEqual([
        expect.objectContaining({
          state: 'ready',
          storageKey: `org/${done.orgId}/files/${files[0]!.id}`,
        }),
      ]);
      expect(storage.files.has(files[0]!.storageKey)).toBe(true);
      // Файлы заявки удалены из хранилища, строки остаются описанием заявки.
      const docs = await leadDocs(lead.id);
      expect(docs).toHaveLength(1);
      expect(storage.files.has(docs[0]!.storageKey)).toBe(false);
      const after = await leadRow(lead.id);
      expect(after).toMatchObject({
        status: 'connected',
        createdOrgId: done.orgId,
        docsPurgeAt: null,
      });

      // Второй раз — «По заявке уже создана организация»; ссылки на файл заявки больше нет.
      const again = await post(`/api/admin/leads/${lead.id}/approve`, {
        login: 'azamat.t2',
        version: after.version,
      });
      expect(again.status).toBe(409);
      expect((await failure(again)).code).toBe('lead_org_exists');
      expect((await get(`/api/admin/leads/${lead.id}/docs/${docs[0]!.id}/link`)).status).toBe(404);

      // Карточка организации в Админке: форма, ОКПО и документы заявки.
      const orgCard = await get(`/api/admin/organizations/${done.orgId}/card`);
      expect(orgCard.status, await orgCard.clone().text()).toBe(200);
      const oc = AdminOrgCard.parse(await orgCard.json());
      expect(oc.profile).toMatchObject({ legalForm: 'ip', okpo: '31415926' });
      expect(oc.org.legalForm).toBe('ip');
      expect(oc.leadFiles).toEqual([
        {
          kind: 'gns_cert',
          name: 'gns_cert.pdf',
          bytes: '%PDF-ipsv'.length,
          at: expect.stringMatching(/^2026-/),
        },
      ]);
    });

    it('организация с тем же ИНН уже есть — неактивна с причиной; отклонённая — «сначала снимите «Отказ»»', async () => {
      const lead = await ipLead({ inn: '01811201810456' });
      await tgLinked(lead.id);
      const c = await card(lead.id);
      expect(c.approve).toMatchObject({
        refusal: 'lead_inn_taken',
        message: 'Организация с ИНН 01811201810456 уже есть на платформе: «Организация А»',
      });
      const res = await post(`/api/admin/leads/${lead.id}/approve`, {
        login: 'azamat.inn',
        version: c.version,
      });
      expect(res.status).toBe(409);
      expect((await failure(res)).code).toBe('lead_inn_taken');

      const other = await ipLead();
      await tgLinked(other.id);
      const o = await card(other.id);
      const rejected = await post(`/api/admin/leads/${other.id}/status`, {
        to: 'rejected',
        version: o.version,
        reason: 'Не наш клиент',
      });
      expect(rejected.status, await rejected.clone().text()).toBe(200);
      const r = await card(other.id);
      expect(r.approve?.refusal).toBe('lead_rejected');
      // Отказ: файлы удалятся через 7 дней.
      expect(new Date(r.docsPurgeAt!).getTime() - f.deps.clock.now().getTime()).toBeLessThanOrEqual(
        7 * 86_400_000,
      );
    });

    it('заявка без документов — «Одобрить» нет; заявка с документами не создаётся «Создать организацию»', async () => {
      n += 1;
      const plain = await submitLead(f.t.app.db, {
        ipSubject: `doc-test-${n}`,
        name: 'Айгуль Садыкова',
        firm: 'ОсОО «Без документов»',
        phone: '+996700398001',
        size: '21–50',
        telegram: '',
        note: '',
        fromStand: false,
        trap: false,
        notify: null,
        now: new Date('2026-10-18T02:00:00Z'),
      });
      const c = await card(plain.leadId!);
      expect(c.legalForm).toBeNull();
      expect(c.approve).toBeNull();
      const res = await post(`/api/admin/leads/${plain.leadId}/approve`, {
        login: 'aigul.s',
        version: c.version,
      });
      expect(res.status).toBe(409);
      expect((await failure(res)).code).toBe('lead_no_docs');

      const docsLead = await ipLead();
      const created = await post('/api/admin/organizations', {
        name: docsLead.firm,
        inn: docsLead.inn,
        ownerFullName: docsLead.name,
        ownerLogin: 'docs.lead.owner',
        temporaryPassword: 'Временный-пароль-1',
        leadId: docsLead.id,
      });
      expect(created.status).toBe(409);
      expect((await failure(created)).code).toBe('lead_has_docs');
    });

    it('файл заявки — ссылка на 15 минут только администратору платформы', async () => {
      const lead = await ipLead();
      const [doc] = await leadDocs(lead.id);
      const res = await get(`/api/admin/leads/${lead.id}/docs/${doc!.id}/link`);
      expect(res.status, await res.clone().text()).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(FileLink.parse(await res.json()).url).toContain(
        encodeURIComponent(doc!.storageKey).slice(0, 5),
      );
      expect((await get(`/api/admin/leads/${lead.id}/docs/${doc!.id}/link`, owner)).status).toBe(
        403,
      );
      expect(
        (await post(`/api/admin/leads/${lead.id}/approve`, { login: 'x.y.z', version: 1 }, owner))
          .status,
      ).toBe(403);
      // Документ другой заявки по номеру этой — нет.
      const other = await ipLead();
      expect((await get(`/api/admin/leads/${other.id}/docs/${doc!.id}/link`)).status).toBe(404);
    });
  });

  describe('«ИНН и форма» организации', () => {
    const orgVersion = async (id: string) =>
      (
        await f.t.admin.db
          .select()
          .from(schema.organizations)
          .where(eq(schema.organizations.id, id))
      )[0]!.version;

    it('меняет только администратор платформы: с историей; без изменений — «Изменений нет»; занятый ИНН и старая версия — отказ', async () => {
      const orgId = f.b.orgId;
      const version = await orgVersion(orgId);
      const path = `/api/admin/organizations/${orgId}/inn-form`;
      expect(
        (await put(path, { inn: '21811201810999', legalForm: 'osoo', version }, owner)).status,
      ).toBe(403);
      const res = await put(path, { inn: '21811201810999', legalForm: 'osoo', version });
      expect(res.status, await res.clone().text()).toBe(200);
      const saved = OrgInnFormSaved.parse(await res.json());
      expect(saved).toEqual({ changed: true, version: version + 1 });
      const [org] = await f.t.admin.db
        .select()
        .from(schema.organizations)
        .where(eq(schema.organizations.id, orgId));
      expect(org).toMatchObject({ inn: '21811201810999', legalForm: 'osoo' });
      const history = await f.t.admin.db
        .select()
        .from(schema.auditLog)
        .where(and(eq(schema.auditLog.orgId, orgId), eq(schema.auditLog.entity, 'organization')));
      expect(
        history
          .at(-1)
          ?.changes.map((c) => c.field)
          .sort(),
      ).toEqual(['inn', 'legalForm']);

      const same = await put(path, {
        inn: '21811201810999',
        legalForm: 'osoo',
        version: saved.version,
      });
      expect(OrgInnFormSaved.parse(await same.json())).toEqual({
        changed: false,
        version: saved.version,
      });

      const taken = await put(path, {
        inn: '01811201810456',
        legalForm: 'osoo',
        version: saved.version,
      });
      expect(taken.status).toBe(400);
      expect(await failure(taken)).toMatchObject({
        code: 'inn_taken',
        message: 'Организация с таким ИНН уже есть',
      });

      const stale = await put(path, { inn: '21811201810998', legalForm: 'ip', version });
      expect(stale.status).toBe(409);
      expect((await failure(stale)).code).toBe('record_changed');

      const invalid = await put(path, { inn: '123', legalForm: 'ip', version: saved.version });
      expect(invalid.status).toBe(400);
    });
  });

  describe('удаление файлов заявок по сроку', () => {
    it('срок наступил — файлы удалены из хранилища, у заявки «файлы удалены» и запись истории; повтор ничего не меняет', async () => {
      const lead = await ipLead();
      await tgLinked(lead.id);
      const [doc] = await leadDocs(lead.id);
      // Черновик, который не стал заявкой.
      const left = await leadDocDraft(app, storage, [{ kind: 'gns_cert', content: '%PDF-scan' }]);
      await f.t.admin.db
        .update(schema.platformLeads)
        .set({ docsPurgeAt: new Date('2026-10-18T02:00:00Z') })
        .where(eq(schema.platformLeads.id, lead.id));
      const ctx = { ...f.deps, clock: fixedClock('2026-10-20T03:00:00Z') };
      expect(await purgeLeadDocs(ctx)).toBeGreaterThan(0);
      expect(storage.files.has(doc!.storageKey)).toBe(false);
      expect(storage.files.has(`leads/upload/${left.ids[0]}`)).toBe(false);
      const c = await card(lead.id);
      expect(c.docsGoneAt).not.toBeNull();
      expect(c.docs).toBe(0);
      expect(c.approve?.refusal).toBe('lead_docs_gone');
      expect(c.history.some((h) => h.kind === 'docs')).toBe(true);
      expect(await purgeLeadDocs(ctx)).toBe(0);
    });

    it('файл, положенный по старой ссылке после замены, «Только PDF» и отправки заявки, удаляется через сутки (п. И-9)', async () => {
      const bytes = new TextEncoder().encode('%PDF-late');
      const first = await leadDocDraft(app, storage, [{ kind: 'gns_cert', content: '%PDF-scan' }]);
      await leadDocDraft(app, storage, [{ kind: 'gns_cert', content: '%PDF-scan' }], first.draft);
      const notPdf = await leadDocDraft(app, storage, [{ kind: 'gns_cert', content: 'MZ не PDF' }]);
      const lead = await ipLead();
      const [doc] = await leadDocs(lead.id);
      const late = [first.ids[0]!, notPdf.ids[0]!, doc!.id].map((id) => `leads/upload/${id}`);
      for (const key of late) {
        expect(storage.files.has(key)).toBe(false);
        await storage.put(key, bytes, { contentType: 'application/pdf' });
      }
      const now = f.deps.clock.now().getTime();
      const after = (hours: number) => ({
        ...f.deps,
        clock: fixedClock(new Date(now + hours * 3_600_000).toISOString()),
      });
      // Пока ссылка на загрузку могла действовать (до срока черновика), файлы не трогаются.
      await purgeLeadDocs(after(LEAD_DRAFT_HOURS - 1));
      expect(late.filter((key) => storage.files.has(key))).toEqual(late);
      await purgeLeadDocs(after(LEAD_DRAFT_HOURS + 1));
      expect(late.filter((key) => storage.files.has(key))).toEqual([]);
      expect(storage.files.has(doc!.storageKey)).toBe(true);
    });
  });

  // ОТКЛОНЕНИЕ: docs/deviations.md#И-10
  describe('повторное удаление файлов из хранилища', () => {
    const retries = () =>
      f.t.admin.db
        .select({
          key: schema.storageDeleteRetries.key,
          attempts: schema.storageDeleteRetries.attempts,
        })
        .from(schema.storageDeleteRetries);
    /** Хранилище, в котором удаление не удаётся (S3 недоступно), пока `down`. */
    const flaky = () => {
      const state = { down: true };
      const s = Object.create(storage) as MemoryStorage;
      s.delete = async (key: string) => {
        if (state.down) throw new Error('S3 недоступно');
        return storage.delete(key);
      };
      return { storage: s, state };
    };

    it('«Одобрить», когда хранилище не удаляет: копия заявки — на повторное удаление, задача удаляет её, а файл организации, который ещё нужен, не трогает', async () => {
      const lead = await ipLead();
      await tgLinked(lead.id);
      const ready = await card(lead.id);
      const s = flaky();
      const flakyApp = createApp({ ...f.deps, storage: s.storage, documents: reader });
      const res = await apiRequest(flakyApp, 'POST', `/api/admin/leads/${lead.id}/approve`, admin, {
        login: `ip.retry.${lead.id.slice(0, 8)}`,
        version: ready.version,
      });
      expect(res.status, await res.clone().text()).toBe(201);
      const done = LeadApproved.parse(await res.json());
      const [doc] = await leadDocs(lead.id);
      const [file] = await f.t.admin.db
        .select()
        .from(schema.files)
        .where(eq(schema.files.orgId, done.orgId));
      try {
        // Строка документа остаётся описанием заявки, но файл уже у организации — на повтор.
        expect(await retries()).toEqual([{ key: doc!.storageKey, attempts: 0 }]);
        // Ключ живого файла организации (например, ответ на «Одобрить» потерялся) задача не удаляет.
        await storageRetryAdd(f.deps.db, [file!.storageKey]);
        s.state.down = false;
        expect(await retryStorageDeletes({ ...f.deps, storage: s.storage })).toBe(1);
        expect(storage.files.has(doc!.storageKey)).toBe(false);
        expect(storage.files.has(file!.storageKey)).toBe(true);
        expect(await retries()).toEqual([]);
      } finally {
        await f.t.admin.db.delete(schema.storageDeleteRetries);
      }
    });

    it('«Удалить» заявку, когда хранилище недоступно: файлы — на повторное удаление, задача удаляет их, когда хранилище снова работает', async () => {
      const lead = await ipLead();
      const docs = await leadDocs(lead.id);
      const [doc] = docs;
      await storage.put(doc!.storageKey, new TextEncoder().encode('%PDF-ipsv'), {
        contentType: 'application/pdf',
      });
      const s = flaky();
      const flakyApp = createApp({ ...f.deps, storage: s.storage, documents: reader });
      try {
        const res = await apiRequest(flakyApp, 'DELETE', `/api/admin/leads/${lead.id}`, admin);
        expect(res.status, await res.clone().text()).toBe(200);
        // Заявка стёрта, файл остался — его ключ запомнен.
        expect(await leadDocs(lead.id)).toEqual([]);
        expect(storage.files.has(doc!.storageKey)).toBe(true);
        expect(await retries()).toEqual([{ key: doc!.storageKey, attempts: 0 }]);
        const job = { ...f.deps, storage: s.storage };
        // Хранилище ещё недоступно: попытка засчитана, ключ остаётся.
        expect(await retryStorageDeletes(job)).toBe(0);
        expect(await retries()).toEqual([{ key: doc!.storageKey, attempts: 1 }]);
        // Повтор раньше чем через 50 минут ключ не трогает.
        s.state.down = false;
        expect(await retryStorageDeletes(job)).toBe(0);
        expect(storage.files.has(doc!.storageKey)).toBe(true);
        const later = {
          ...job,
          clock: fixedClock(new Date(f.deps.clock.now().getTime() + 3600_000).toISOString()),
        };
        expect(await retryStorageDeletes(later)).toBe(1);
        expect(storage.files.has(doc!.storageKey)).toBe(false);
        expect(await retries()).toEqual([]);
      } finally {
        await f.t.admin.db.delete(schema.storageDeleteRetries);
      }
    });

    it('сутки не удаётся удалить — оповещение администратору платформы, не чаще раза в сутки', async () => {
      const [adminUser] = await f.t.admin.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.login, 'platform-admin'));
      await f.t.admin.db
        .insert(schema.telegramLinks)
        .values({ userId: adminUser!.id, orgId: null, chatId: 7_199_001 });
      const key = 'leads/upload/00000000-0000-4000-8000-000000000001';
      const s = flaky();
      /** Запуск задачи через `hours` часов: повтор — не раньше чем через 50 минут после прошлого. */
      const runAt = (hours: number) =>
        retryStorageDeletes({
          ...f.deps,
          storage: s.storage,
          clock: fixedClock(
            new Date(f.deps.clock.now().getTime() + hours * 3600_000).toISOString(),
          ),
        });
      try {
        await storageRetryAdd(f.deps.db, [key]);
        await f.t.admin.db
          .update(schema.storageDeleteRetries)
          .set({ attempts: STORAGE_RETRY_STUCK_ATTEMPTS - 1 });
        await runAt(0);
        const sent = await alertsOf('storage-retry');
        expect(sent).toHaveLength(1);
        expect(sent[0]!.text).toContain(formatText(UI_TEXTS['alert.storage_retry']!.ru, { n: 1 }));
        // Через час и спустя 23 часа после первого — без нового оповещения, спустя 25 часов — новое.
        await runAt(1);
        expect(await alertsOf('storage-retry')).toHaveLength(1);
        await ageAlerts('storage-retry', 23);
        await runAt(2);
        expect(await alertsOf('storage-retry')).toHaveLength(1);
        await ageAlerts('storage-retry', 25);
        await runAt(3);
        expect(await alertsOf('storage-retry')).toHaveLength(2);
      } finally {
        await dropAlerts('storage-retry');
        await f.t.admin.db.delete(schema.storageDeleteRetries);
        await f.t.admin.db
          .delete(schema.telegramLinks)
          .where(eq(schema.telegramLinks.userId, adminUser!.id));
      }
    });
  });

  // Последним в файле: предел платформы на час общий для всех тестов файла.
  describe('предел загрузок на всю платформу', () => {
    // ОТКЛОНЕНИЕ: docs/deviations.md#И-10
    it('больше 300 загрузок за час со всех адресов — 429 и с нового адреса; администратору платформы — оповещение', async () => {
      const [adminUser] = await f.t.admin.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.login, 'platform-admin'));
      await f.t.admin.db
        .insert(schema.telegramLinks)
        .values({ userId: adminUser!.id, orgId: null, chatId: 7_199_003 });
      try {
        let taken = 0;
        while ((await takeRateLimit(f.deps.db, LEAD_UPLOAD_ALL_RATE_LIMIT, 'all')).ok) {
          taken += 1;
          expect(taken).toBeLessThanOrEqual(LEAD_UPLOAD_ALL_RATE_LIMIT.max);
        }
        const res = await guest(
          '/api/leads/uploads',
          { draft: null, kind: 'gns_cert', name: 'a.pdf', size: 10 },
          '198.18.9.1',
        );
        expect(res.status).toBe(429);
        expect((await failure(res)).code).toBe('lead_upload_limit');
        const sent = await alertsOf('lead-uploads');
        expect(sent).toHaveLength(1);
        expect(sent[0]!.text).toContain(
          formatText(UI_TEXTS['alert.lead_uploads']!.ru, {
            max: LEAD_UPLOAD_ALL_RATE_LIMIT.max,
            readMax: LEAD_READ_ALL_RATE_LIMIT.max,
          }),
        );
        // Второй отказ в тот же час — без нового оповещения.
        const again = await guest(
          '/api/leads/uploads',
          { draft: null, kind: 'gns_cert', name: 'a.pdf', size: 10 },
          '198.18.9.3',
        );
        expect(again.status).toBe(429);
        expect(await alertsOf('lead-uploads')).toHaveLength(1);
      } finally {
        await f.t.admin.db
          .delete(schema.rateLimits)
          .where(eq(schema.rateLimits.kind, LEAD_UPLOAD_ALL_RATE_LIMIT.kind));
        // Оповещение не чаще раза в час — по записям очереди: следующий тест ждёт своё.
        await dropAlerts('lead-uploads');
        await f.t.admin.db
          .delete(schema.telegramLinks)
          .where(eq(schema.telegramLinks.userId, adminUser!.id));
      }
    });

    // ОТКЛОНЕНИЕ: docs/deviations.md#И-10
    it('больше 300 разборов за час со всех адресов — 429; о сработавшем общем пределе — оповещение администратору платформы', async () => {
      const [adminUser] = await f.t.admin.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.login, 'platform-admin'));
      await f.t.admin.db
        .insert(schema.telegramLinks)
        .values({ userId: adminUser!.id, orgId: null, chatId: 7_199_002 });
      const ip = '198.18.9.2';
      try {
        const started = await guest(
          '/api/leads/uploads',
          { draft: null, kind: 'gns_cert', name: 'a.pdf', size: 9 },
          ip,
        );
        expect(started.status).toBe(201);
        const ticket = LeadUploadTicket.parse(await started.json());
        await storage.put(`leads/upload/${ticket.id}`, new TextEncoder().encode('%PDF-ipsv'), {
          contentType: 'application/pdf',
        });
        let taken = 0;
        while ((await takeRateLimit(f.deps.db, LEAD_READ_ALL_RATE_LIMIT, 'all')).ok) {
          taken += 1;
          expect(taken).toBeLessThanOrEqual(LEAD_READ_ALL_RATE_LIMIT.max);
        }
        const calls = reader.calls;
        // Не PDF общий предел не тратит и упирается не в него: «Только PDF».
        const other = await guest(
          '/api/leads/uploads',
          { draft: ticket.draft, kind: 'extract', name: 'b.pdf', size: 4 },
          ip,
        );
        expect(other.status).toBe(201);
        const otherTicket = LeadUploadTicket.parse(await other.json());
        await storage.put(`leads/upload/${otherTicket.id}`, new TextEncoder().encode('MZ!!'), {
          contentType: 'application/pdf',
        });
        const notPdf = await guest(
          `/api/leads/uploads/${otherTicket.id}/read`,
          { draft: ticket.draft },
          ip,
        );
        expect(notPdf.status).toBe(400);
        expect((await failure(notPdf)).code).toBe('lead_doc_pdf');
        const res = await guest(
          `/api/leads/uploads/${ticket.id}/read`,
          { draft: ticket.draft },
          ip,
        );
        expect(res.status).toBe(429);
        expect((await failure(res)).code).toBe('lead_read_limit');
        expect(reader.calls).toBe(calls);
        expect(await alertsOf('lead-uploads')).toHaveLength(1);
      } finally {
        await f.t.admin.db
          .delete(schema.rateLimits)
          .where(eq(schema.rateLimits.kind, LEAD_READ_ALL_RATE_LIMIT.kind));
        await dropAlerts('lead-uploads');
        await f.t.admin.db
          .delete(schema.telegramLinks)
          .where(eq(schema.telegramLinks.userId, adminUser!.id));
      }
    });
  });
});
