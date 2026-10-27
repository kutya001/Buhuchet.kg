import { hashPassword } from '@buhuchet/adapters/password';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminOrgSummary } from './admin-orgs';
import { withUserContext } from './auth';
import { withOrgContext } from './context';
import { createDictRequest, listDictRequests } from './dict-requests';
import { readHistory } from './history';
import { createOrganization, type CreatedOrganization } from './organizations';
import { dictChangeRequests, users } from './schema';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  type TestDatabase,
} from './testing';

const permissionDenied = expect.objectContaining({
  cause: expect.objectContaining({ code: '42501' }),
});
const violates = (constraint: string) =>
  expect.objectContaining({ cause: expect.objectContaining({ constraint_name: constraint }) });

describe.skipIf(!databaseAvailable())('«Попросить добавить»: запросы организации', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let adminId: string;
  const asOwner = <T>(org: CreatedOrganization, fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: org.orgId, userId: org.ownerUserId }, fn);

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAccessReference(db.admin.db);
    const passwordHash = await hashPassword('Bh-4821-temp');
    const [admin] = await db.admin.db
      .insert(users)
      .values({ login: 'platform', passwordHash, isPlatformAdmin: true })
      .returning({ id: users.id });
    adminId = admin!.id;
    a = await createOrganization(db.app.db, {
      name: 'ОсОО «Альфа»',
      inn: '01811201810456',
      slug: 'alfa',
      owner: { fullName: 'Асанов Асан Асанович', login: 'asanov', passwordHash },
    });
    b = await createOrganization(db.app.db, {
      name: 'ОсОО «Бета»',
      inn: '02811201810457',
      slug: 'beta',
      owner: { fullName: 'Бекова Бермет', login: 'bekova', passwordHash },
    });
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('запрос: организация и автор из контекста, статус «Новый», создание — в истории', async () => {
    const created = await asOwner(a, (tx) =>
      createDictRequest(tx, {
        dict: 'types',
        what: '  Отчёт по НДС на импорт услуг ',
        comment: '',
      }),
    );
    expect(created).toMatchObject({
      dict: 'types',
      what: 'Отчёт по НДС на импорт услуг',
      comment: '',
      status: 'new',
      answer: '',
      createdBy: 'Асан А.',
      decidedAt: null,
    });
    const [row] = await db.admin.db
      .select()
      .from(dictChangeRequests)
      .where(eq(dictChangeRequests.id, created.id));
    expect(row).toMatchObject({ orgId: a.orgId, createdBy: a.ownerUserId });
    const history = await asOwner(a, (tx) => readHistory(tx, 'dict_request', created.id));
    expect(history).toEqual([
      expect.objectContaining({
        action: 'create',
        changes: [
          { field: 'dict', to: 'types' },
          { field: 'what', to: 'Отчёт по НДС на импорт услуг' },
        ],
      }),
    ]);
  });

  it('«Мои запросы» — только своей организации, сначала новые', async () => {
    await asOwner(a, (tx) =>
      createDictRequest(tx, { dict: 'banks', what: 'Новый банк', comment: 'Для реквизитов' }),
    );
    const mine = await asOwner(a, (tx) => listDictRequests(tx));
    expect(mine.map((r) => r.what)).toEqual(['Новый банк', 'Отчёт по НДС на импорт услуг']);
    expect(await asOwner(b, (tx) => listDictRequests(tx))).toEqual([]);
  });

  it('чужая организация не видна, не создаётся; свой запрос не меняется и не удаляется', async () => {
    await expect(
      asOwner(b, (tx) =>
        tx
          .insert(dictChangeRequests)
          .values({ orgId: a.orgId, dict: 'types', what: 'Чужой', createdBy: b.ownerUserId }),
      ),
    ).rejects.toThrow(permissionDenied);
    const seenByB = await asOwner(b, (tx) => tx.select().from(dictChangeRequests));
    expect(seenByB).toEqual([]);
    await expect(
      asOwner(a, (tx) => tx.update(dictChangeRequests).set({ status: 'added' })),
    ).rejects.toThrow(permissionDenied);
    await expect(asOwner(a, (tx) => tx.delete(dictChangeRequests))).rejects.toThrow(
      permissionDenied,
    );
  });

  it('справочник — из списка, «Что добавить» не пустое', async () => {
    await expect(
      asOwner(a, (tx) =>
        createDictRequest(tx, { dict: 'roles' as 'types', what: 'Роль', comment: '' }),
      ),
    ).rejects.toThrow(violates('dict_change_requests_dict_check'));
    await expect(
      asOwner(a, (tx) => createDictRequest(tx, { dict: 'types', what: '   ', comment: '' })),
    ).rejects.toThrow(violates('dict_change_requests_what_check'));
  });

  it('плашка «Запросы на добавление» в Админке: все запросы — только администратору платформы', async () => {
    const summary = await withUserContext(db.app.db, adminId, (tx) => adminOrgSummary(tx));
    expect(summary.requests).toBe(2);
    const owner = await asOwner(a, (tx) => adminOrgSummary(tx));
    expect(owner.requests).toBe(0);
  });
});
