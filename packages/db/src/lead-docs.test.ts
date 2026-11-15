import { randomUUID } from 'node:crypto';
import { UI_TEXTS, type ListQuery } from '@buhuchet/domain';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withUserContext } from './auth';
import { withOrgContext } from './context';
import {
  adminLeadDocs,
  adminSetOrgInnForm,
  discardLeadDraft,
  dropLeadUpload,
  leadDocsReady,
  leadDocsToOrganization,
  leadDraftDocs,
  leadPurgeDone,
  leadPurgeDue,
  leadUploadOf,
  markLeadUploadRead,
  startLeadUpload,
  submitLeadDocs,
} from './lead-docs';
import {
  adminLeadById,
  adminLeadEvents,
  listAdminLeadsPage,
  setLeadStatus,
  submitLead,
  type LeadSubmission,
} from './leads';
import { createOrganization, type CreatedOrganization } from './organizations';
import { files, organizations, platformLeadDocs, platformLeads, users } from './schema';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  type TestDatabase,
} from './testing';

/*
 * Документы заявки с лендинга (доработки 14.11.2026, блок 1; миграция 0148): черновик до отправки,
 * перенос в заявку, срок хранения, удаление по сроку, «Одобрить» — в файлы организации, «ИНН и форма».
 */

const NOW = new Date('2026-11-15T04:00:00Z');
const at = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000);
const t = (key: string) => (UI_TEXTS as Record<string, { ru: string }>)[key]?.ru ?? key;
const query = (over: Partial<ListQuery> = {}): ListQuery => ({
  page: 1,
  size: 50,
  sort: { key: 'at', dir: 'desc' },
  filters: {},
  ...over,
});
const denied = expect.objectContaining({
  cause: expect.objectContaining({ message: expect.stringMatching(/permission denied/) }),
});

describe.skipIf(!databaseAvailable())('документы заявки с лендинга', () => {
  let db: TestDatabase;
  let adminId: string;
  let org: CreatedOrganization;
  let n = 0;

  const asAdmin = <T>(run: Parameters<typeof withUserContext<T>>[2]) =>
    withUserContext(db.app.db, adminId, run);

  const lead = (now: Date, over: Partial<LeadSubmission> = {}): LeadSubmission => {
    n += 1;
    return {
      ipSubject: `docs-ip-${n}`,
      name: 'Нурлан Касымов',
      firm: 'ИП Касымов Н.',
      phone: `+996700${String(100000 + n)}`,
      size: 'До 20',
      telegram: '',
      note: '',
      fromStand: false,
      trap: false,
      notify: null,
      now,
      ...over,
    };
  };

  /** Черновик с проверенными документами формы. */
  async function readyDraft(kinds: ('gns_cert' | 'extract' | 'minjust_cert')[], now = NOW) {
    let draft: string | null = null;
    const ids: string[] = [];
    for (const kind of kinds) {
      const id = randomUUID();
      const started = await startLeadUpload(db.app.db, {
        draft,
        id,
        kind,
        name: `${kind}.pdf`,
        size: 1000,
        now,
      });
      draft = started.draft;
      expect(await markLeadUploadRead(db.app.db, id, draft, { kind: 'ipsv', v: {} })).toBe(true);
      ids.push(id);
    }
    return { draft: draft!, ids };
  }

  /** Новая заявка ИП с документами черновика; ответ — номер заявки и документов. */
  async function docsLead(now: Date, inn = '21503198700123') {
    const { draft, ids } = await readyDraft(['gns_cert'], now);
    const saved = await submitLead(db.app.db, lead(now), (tx, r) =>
      submitLeadDocs(tx, {
        leadId: r.leadId!,
        now,
        form: 'ip',
        inn,
        okpo: '12345678',
        address: 'г. Бишкек, ул. Токтогула, 1',
        head: 'Касымов Нурлан',
        draft,
      }),
    );
    expect(saved.outcome).toBe('created');
    expect(saved.extra).toEqual({ missing: false, docs: ids, dropped: [] });
    return { leadId: saved.leadId!, docs: ids };
  }

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAccessReference(db.admin.db);
    const [admin] = await db.admin.db
      .insert(users)
      .values({ login: 'docs-platform', passwordHash: 'h', isPlatformAdmin: true })
      .returning({ id: users.id });
    adminId = admin!.id;
    org = await createOrganization(db.app.db, {
      name: 'ОсОО «Бета»',
      inn: '01811201810457',
      slug: 'beta-docs',
      owner: { fullName: 'Бекова Бермет', login: 'bekova', passwordHash: 'h' },
    });
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('черновик и документы заявки роль приложения не читает и не меняет напрямую', async () => {
    await expect(db.app.db.execute(sql`select * from platform_lead_uploads`)).rejects.toThrow();
    await expect(db.app.db.select().from(platformLeadDocs)).rejects.toEqual(denied);
  });

  it('черновик: новый номер, тот же живой, новый вместо старого, замена того же вида', async () => {
    const a = randomUUID();
    const first = await startLeadUpload(db.app.db, {
      draft: null,
      id: a,
      kind: 'extract',
      name: 'Выписка.pdf',
      size: 2048,
      now: NOW,
    });
    expect(first.replaced).toBeNull();
    // Номер черновика, которого нет, ничего не даёт: выдаётся новый.
    const foreign = randomUUID();
    const other = await startLeadUpload(db.app.db, {
      draft: foreign,
      id: randomUUID(),
      kind: 'extract',
      name: 'x.pdf',
      size: 10,
      now: NOW,
    });
    expect(other.draft).not.toBe(foreign);
    // Второй документ — в тот же живой черновик; тот же вид заменяет прежний.
    const b = randomUUID();
    const second = await startLeadUpload(db.app.db, {
      draft: first.draft,
      id: b,
      kind: 'extract',
      name: 'Выписка-2.pdf',
      size: 4096,
      now: at(1),
    });
    expect(second).toEqual({ draft: first.draft, replaced: a });
    expect(await leadUploadOf(db.app.db, a, first.draft)).toBeNull();
    expect(await leadUploadOf(db.app.db, b, other.draft)).toBeNull();
    expect(await leadUploadOf(db.app.db, b, first.draft)).toMatchObject({
      kind: 'extract',
      name: 'Выписка-2.pdf',
      sizeBytes: 4096,
      state: 'pending',
    });
    // Через сутки черновик не живой: номер новый.
    const late = await startLeadUpload(db.app.db, {
      draft: first.draft,
      id: randomUUID(),
      kind: 'minjust_cert',
      name: 'Свидетельство.pdf',
      size: 10,
      now: at(26),
    });
    expect(late.draft).not.toBe(first.draft);
  });

  it('разобранный документ — в черновике; не PDF — строка убирается', async () => {
    const id = randomUUID();
    const { draft } = await startLeadUpload(db.app.db, {
      draft: null,
      id,
      kind: 'gns_cert',
      name: 'Свидетельство.pdf',
      size: 100,
      now: NOW,
    });
    expect(await markLeadUploadRead(db.app.db, id, randomUUID(), { a: 1 })).toBe(false);
    expect(await markLeadUploadRead(db.app.db, id, draft, { kind: 'ipsv', v: { inn: '1' } })).toBe(
      true,
    );
    expect(await leadDraftDocs(db.app.db, draft, at(1))).toEqual([
      expect.objectContaining({ id, state: 'ready', doc: { kind: 'ipsv', v: { inn: '1' } } }),
    ]);
    expect(await leadDraftDocs(db.app.db, draft, at(25))).toEqual([]);
    expect(await dropLeadUpload(db.app.db, id, draft)).toBe(true);
    expect(await leadDraftDocs(db.app.db, draft, NOW)).toEqual([]);
  });

  it('заявка без всех документов формы не сохраняется; повтор с того же телефона их не получает', async () => {
    const { draft } = await readyDraft(['extract']);
    const first = lead(NOW);
    await expect(
      submitLead(db.app.db, first, async (tx, r) => {
        const out = await submitLeadDocs(tx, {
          leadId: r.leadId!,
          now: NOW,
          form: 'osoo',
          inn: '01811201810999',
          okpo: '',
          address: '',
          head: '',
          draft,
        });
        if (out.missing) throw new Error('missing');
        return out;
      }),
    ).rejects.toThrow('missing');
    const [row] = await db.admin.db
      .select({ n: sql<number>`count(*)::int` })
      .from(platformLeads)
      .where(eq(platformLeads.phone, first.phone));
    expect(row!.n).toBe(0);

    // Повтор с того же телефона: заявка — прежняя, её `created_at` раньше — документы не переносятся.
    const saved = await submitLead(db.app.db, { ...first, ipSubject: 'docs-repeat' });
    expect(saved.outcome).toBe('created');
    const { draft: d2 } = await readyDraft(['gns_cert'], at(1));
    const repeat = await submitLead(
      db.app.db,
      { ...first, ipSubject: 'docs-repeat-2', now: at(1) },
      async (tx, r) => {
        const out = await submitLeadDocs(tx, {
          leadId: r.leadId!,
          now: at(1),
          form: 'ip',
          inn: '01811201810999',
          okpo: '',
          address: '',
          head: '',
          draft: d2,
        });
        return { outcome: r.outcome, out, discarded: await discardLeadDraft(tx, d2) };
      },
    );
    expect(repeat.extra.outcome).toBe('repeat');
    expect(repeat.extra.out).toEqual({ missing: true });
    expect(repeat.extra.discarded).toHaveLength(1);
    const kept = await asAdmin((tx) => adminLeadById(tx, saved.leadId!));
    expect(kept).toMatchObject({ legalForm: null, docsCount: 0, docsState: null });
  });

  it('новая заявка с документами: данные, документы `pending`, лишний файл черновика — в удаление', async () => {
    const { draft, ids } = await readyDraft(['extract', 'minjust_cert', 'gns_cert']);
    const saved = await submitLead(db.app.db, lead(NOW), (tx, r) =>
      submitLeadDocs(tx, {
        leadId: r.leadId!,
        now: NOW,
        form: 'osoo',
        inn: '01811201810888',
        okpo: ' ',
        address: ' г. Ош ',
        head: '',
        draft,
      }),
    );
    expect(saved.extra).toEqual({
      missing: false,
      docs: expect.arrayContaining([ids[0], ids[1]]),
      dropped: [ids[2]],
    });
    expect(await leadDraftDocs(db.app.db, draft, NOW)).toEqual([]);
    const row = await asAdmin((tx) => adminLeadById(tx, saved.leadId!));
    expect(row).toMatchObject({
      legalForm: 'osoo',
      inn: '01811201810888',
      okpo: null,
      address: 'г. Ош',
      head: null,
      docsState: 'pending',
      docsCount: 2,
      docsPurgeAt: at(30 * 24),
      tgLinkedAt: null,
    });
    const docs = await asAdmin((tx) => adminLeadDocs(tx, saved.leadId!));
    expect(docs.map((d) => [d.kind, d.state, d.storageKey])).toEqual([
      ['extract', 'pending', `leads/${saved.leadId}/${ids[0]}`],
      ['minjust_cert', 'pending', `leads/${saved.leadId}/${ids[1]}`],
    ]);
    // Не администратору документов заявки не видно.
    expect(
      await withOrgContext(db.app.db, { orgId: org.orgId, userId: org.ownerUserId }, (tx) =>
        adminLeadDocs(tx, saved.leadId!),
      ),
    ).toEqual([]);
    // Скопирован один из двух — заявка ещё `pending`; оба — `ready`.
    expect(await leadDocsReady(db.app.db, saved.leadId!, [ids[0]!])).toBe('pending');
    expect(await leadDocsReady(db.app.db, saved.leadId!, [ids[1]!])).toBe('ready');
  });

  it('столбцы «Форма», «Документы» и «Telegram» вкладки «Заявки»', async () => {
    const { leadId } = await docsLead(at(2), '21503198700991');
    await db.admin.db
      .update(platformLeads)
      .set({ tgChatId: 777001, tgLinkedAt: at(3) })
      .where(eq(platformLeads.id, leadId));
    const page = await asAdmin((tx) =>
      listAdminLeadsPage(tx, query({ filters: { telegram: { type: 'enum', vals: ['on'] } } }), t),
    );
    expect(page.rows.map((x) => x.id)).toEqual([leadId]);
    const forms = await asAdmin((tx) =>
      listAdminLeadsPage(tx, query({ filters: { form: { type: 'enum', vals: ['ip'] } } }), t),
    );
    expect(forms.rows.map((x) => x.id)).toContain(leadId);
    expect(forms.rows.every((x) => x.legalForm === 'ip')).toBe(true);
    const docs = await asAdmin((tx) =>
      listAdminLeadsPage(tx, query({ filters: { docs: { type: 'text', q: 'удалены' } } }), t),
    );
    expect(docs.rows.map((x) => x.id)).not.toContain(leadId);
  });

  it('«Отказ» — срок файлов 7 дней с отказа, снят «Отказ» — снова 30 дней с отправки', async () => {
    const { leadId } = await docsLead(at(4), '21503198700992');
    const v1 = await asAdmin((tx) =>
      setLeadStatus(tx, {
        id: leadId,
        version: null,
        to: 'rejected',
        before: 'new',
        text: 'Не подходит',
        now: at(10),
      }),
    );
    expect(v1).not.toBeNull();
    expect((await asAdmin((tx) => adminLeadById(tx, leadId)))!.docsPurgeAt).toEqual(
      at(10 + 7 * 24),
    );
    await asAdmin((tx) =>
      setLeadStatus(tx, {
        id: leadId,
        version: null,
        to: 'new',
        before: null,
        rollback: true,
        text: 'Ошибка',
        now: at(11),
      }),
    );
    expect((await asAdmin((tx) => adminLeadById(tx, leadId)))!.docsPurgeAt).toEqual(
      at(4 + 30 * 24),
    );
  });

  it('удаление по сроку: черновики старше суток и документы отклонённой заявки', async () => {
    const { leadId, docs } = await docsLead(at(5), '21503198700993');
    await asAdmin((tx) =>
      setLeadStatus(tx, {
        id: leadId,
        version: null,
        to: 'rejected',
        before: 'new',
        text: 'Нет',
        now: at(6),
      }),
    );
    const stale = randomUUID();
    await startLeadUpload(db.app.db, {
      draft: null,
      id: stale,
      kind: 'gns_cert',
      name: 'old.pdf',
      size: 1,
      now: at(-30),
    });
    // Срок ещё не наступил: документы заявки не трогаются.
    const early = await leadPurgeDue(db.app.db, at(6 + 24), 100);
    expect(early).toContainEqual({ kind: 'upload', id: stale, storageKey: `leads/upload/${stale}` });
    expect(early.some((x) => x.kind === 'doc' && docs.includes(x.id))).toBe(false);
    // Строку, которую пора удалять, не удалённую из хранилища, функция не удаляет без её номера.
    const due = await leadPurgeDue(db.app.db, at(6 + 7 * 24), 100);
    const mine = due.filter((x) => x.kind === 'doc' && docs.includes(x.id));
    expect(mine.map((x) => x.storageKey)).toEqual([`leads/${leadId}/${docs[0]}`]);
    expect(
      await leadPurgeDone(
        db.app.db,
        at(6 + 7 * 24),
        due.filter((x) => x.kind === 'upload').map((x) => x.id),
        mine.map((x) => x.id),
      ),
    ).toBe(1);
    const row = await asAdmin((tx) => adminLeadById(tx, leadId));
    expect(row).toMatchObject({ docsState: null, docsPurgeAt: null, docsCount: 0, legalForm: 'ip' });
    const events = await asAdmin((tx) => adminLeadEvents(tx, leadId));
    expect(events.at(-1)).toMatchObject({ kind: 'docs', text: 'rejected', actorUserId: null });
    expect(await leadPurgeDue(db.app.db, at(6 + 7 * 24), 100)).not.toContainEqual(
      expect.objectContaining({ id: stale }),
    );
    // «Документы» заявки — «удалены».
    const gone = await asAdmin((tx) =>
      listAdminLeadsPage(tx, query({ filters: { docs: { type: 'text', q: 'удалены' } } }), t),
    );
    expect(gone.rows.map((x) => x.id)).toContain(leadId);
  });

  it('«Одобрить»: организация из заявки, владелец без пароля, документы — файлы организации', async () => {
    const { leadId, docs } = await docsLead(at(7), '21503198700994');
    await leadDocsReady(db.app.db, leadId, docs);
    const orgId = randomUUID();
    const fileId = randomUUID();
    let moved: { docId: string; storageKey: string }[] = [];
    const created = await createOrganization(db.app.db, {
      id: orgId,
      name: 'ИП Касымов Н.',
      inn: '21503198700994',
      slug: 'kasymov-docs',
      owner: {
        fullName: 'Нурлан Касымов',
        login: 'nurlan.kasymov',
        passwordHash: 'random',
        passwordless: true,
      },
      profile: { legalForm: 'ip', okpo: '12345678', address: 'г. Бишкек', head: 'Касымов Нурлан' },
      createdBy: adminId,
      lead: { id: leadId, now: at(8) },
      within: async (tx, made) => {
        moved = await leadDocsToOrganization(tx, {
          leadId,
          orgId: made.orgId,
          ownerUserId: made.ownerUserId,
          files: [{ doc: docs[0]!, file: fileId }],
        });
      },
    });
    expect(created.orgId).toBe(orgId);
    expect(moved).toEqual([{ docId: docs[0], storageKey: `leads/${leadId}/${docs[0]}` }]);
    const [o] = await db.admin.db.select().from(organizations).where(eq(organizations.id, orgId));
    expect(o).toMatchObject({
      legalForm: 'ip',
      okpo: '12345678',
      address: 'г. Бишкек',
      head: 'Касымов Нурлан',
    });
    const [owner] = await db.admin.db.select().from(users).where(eq(users.id, created.ownerUserId));
    expect(owner!.mustChangePassword).toBe(false);
    const [file] = await db.admin.db.select().from(files).where(eq(files.id, fileId));
    expect(file).toMatchObject({
      orgId,
      sourceKind: 'lead',
      sourceId: null,
      contractorId: null,
      name: 'gns_cert.pdf',
      contentType: 'application/pdf',
      state: 'ready',
      createdBy: created.ownerUserId,
      storageKey: `org/${orgId}/files/${fileId}`,
    });
    // Строки документов остаются описанием заявки, срок снят; заявка «Подключена».
    const row = await asAdmin((tx) => adminLeadById(tx, leadId));
    expect(row).toMatchObject({
      status: 'connected',
      createdOrgId: orgId,
      docsCount: 1,
      docsPurgeAt: null,
    });
    expect(await leadPurgeDue(db.app.db, at(24 * 400), 1000)).not.toContainEqual(
      expect.objectContaining({ id: docs[0] }),
    );
    // Файл — в организации: владелец его видит, чужая организация — нет.
    const own = await withOrgContext(db.app.db, { orgId, userId: created.ownerUserId }, (tx) =>
      tx.select({ id: files.id }).from(files).where(eq(files.id, fileId)),
    );
    expect(own).toHaveLength(1);
    const foreign = await withOrgContext(
      db.app.db,
      { orgId: org.orgId, userId: org.ownerUserId },
      (tx) => tx.select({ id: files.id }).from(files).where(eq(files.id, fileId)),
    );
    expect(foreign).toEqual([]);
  });

  it('документы в файлы организации переносит только администратор и только все сразу', async () => {
    const { leadId, docs } = await docsLead(at(9), '21503198700995');
    await leadDocsReady(db.app.db, leadId, docs);
    // Не все документы: организация не создаётся, заявка остаётся без организации.
    await expect(
      createOrganization(db.app.db, {
        name: 'ИП Тест',
        inn: '21503198700995',
        slug: 'docs-partial',
        owner: { fullName: 'Тест Тестов', login: 'docs.partial', passwordHash: 'h' },
        createdBy: adminId,
        lead: { id: leadId, now: at(10) },
        within: async (tx, made) => {
          await leadDocsToOrganization(tx, {
            leadId,
            orgId: made.orgId,
            ownerUserId: made.ownerUserId,
            files: [],
          });
        },
      }),
    ).rejects.toThrow();
    expect((await asAdmin((tx) => adminLeadById(tx, leadId)))!.createdOrgId).toBeNull();
    // Владелец чужой организации документов заявки не переносит.
    await expect(
      withOrgContext(db.app.db, { orgId: org.orgId, userId: org.ownerUserId }, (tx) =>
        leadDocsToOrganization(tx, {
          leadId,
          orgId: org.orgId,
          ownerUserId: org.ownerUserId,
          files: [{ doc: docs[0]!, file: randomUUID() }],
        }),
      ),
    ).rejects.toThrow();
  });

  it('«ИНН и форма» меняет только администратор платформы; владелец ИНН не меняет', async () => {
    const [before] = await db.admin.db
      .select({ version: organizations.version })
      .from(organizations)
      .where(eq(organizations.id, org.orgId));
    // Владелец: столбца ИНН роли приложения менять нельзя, функция ему ничего не меняет.
    await expect(
      withOrgContext(db.app.db, { orgId: org.orgId, userId: org.ownerUserId }, (tx) =>
        tx
          .update(organizations)
          .set({ inn: '01811201810000' })
          .where(eq(organizations.id, org.orgId)),
      ),
    ).rejects.toEqual(denied);
    expect(
      await withOrgContext(db.app.db, { orgId: org.orgId, userId: org.ownerUserId }, (tx) =>
        adminSetOrgInnForm(tx, {
          orgId: org.orgId,
          inn: '01811201810000',
          legalForm: 'osoo',
          version: before!.version,
        }),
      ),
    ).toBeNull();
    // Администратор: со сверкой версии.
    expect(
      await asAdmin((tx) =>
        adminSetOrgInnForm(tx, {
          orgId: org.orgId,
          inn: '01811201810000',
          legalForm: 'osoo',
          version: before!.version + 5,
        }),
      ),
    ).toBeNull();
    const v = await asAdmin((tx) =>
      adminSetOrgInnForm(tx, {
        orgId: org.orgId,
        inn: '01811201810000',
        legalForm: 'osoo',
        version: before!.version,
      }),
    );
    expect(v).toBe(before!.version + 1);
    const [after] = await db.admin.db
      .select({ inn: organizations.inn, legalForm: organizations.legalForm })
      .from(organizations)
      .where(and(eq(organizations.id, org.orgId)));
    expect(after).toEqual({ inn: '01811201810000', legalForm: 'osoo' });
    // ОКПО владелец меняет.
    await withOrgContext(db.app.db, { orgId: org.orgId, userId: org.ownerUserId }, (tx) =>
      tx.update(organizations).set({ okpo: '87654321' }).where(eq(organizations.id, org.orgId)),
    );
  });
});
