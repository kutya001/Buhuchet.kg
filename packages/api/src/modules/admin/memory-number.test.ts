import { randomUUID } from 'node:crypto';
import type { MemoryStorage } from '@buhuchet/adapters';
import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import {
  AdminOrgFiles,
  AdminStorageSummary,
  AdminSubscriptionCard,
  AdminSubscriptionList,
  Contractor,
  FileItem,
  FileUploadTicket,
  OrgSubscriptionView,
} from '@buhuchet/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';

/*
 * Одно число памяти (доработки 20.11.2026, пакет 2, блок 5, пункт 2; общий план 20.11, этап 2, П1):
 * «Занято» у владельца на экране «Подписка», на вкладке «Подписки» Админки (список и окно организации)
 * и в модуле «Файлы» Админки («Хранилище» → «По организациям» и «Файлы» карточки организации) считает
 * одна функция базы `app.org_usage` — пять мест показывают одно и то же число после загрузки, файла от
 * контрагента, его решения и удаления.
 */

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;
const { contractorSentFiles } = schema;

describe.skipIf(!databaseAvailable())('Одно число памяти на трёх экранах', () => {
  let f: Fixture;
  let storage: MemoryStorage;
  let owner: string;
  let ownerB: string;
  let admin: string;
  let cpId = '';

  const call = (method: 'GET' | 'POST' | 'DELETE', path: string, cookie?: string, body?: unknown) =>
    apiRequest(f.app, method, path, cookie, body);
  const ok = async (res: Response, status = 200) => {
    expect(res.status, await res.clone().text()).toBe(status);
    return res.json();
  };

  /** «Занято» организации во всех пяти местах. */
  async function screens(orgId: string, ownerCookie: string) {
    const own = OrgSubscriptionView.parse(
      await ok(await call('GET', '/api/org/subscription', ownerCookie)),
    );
    const list = AdminSubscriptionList.parse(
      await ok(await call('GET', '/api/admin/subscriptions', admin)),
    );
    const card = AdminSubscriptionCard.parse(
      await ok(await call('GET', `/api/admin/subscriptions/${orgId}`, admin)),
    );
    const files = AdminOrgFiles.parse(
      await ok(await call('GET', `/api/admin/organizations/${orgId}/files`, admin)),
    );
    const store = AdminStorageSummary.parse(
      await ok(await call('GET', '/api/admin/files/summary', admin)),
    );
    return {
      subscription: own.usage.bytesUsed,
      subsList: list.items.find((r) => r.id === orgId)?.bytesUsed,
      subsCard: card.bytesUsed,
      orgFiles: files.usedBytes,
      storage: store.orgs.find((o) => o.orgId === orgId)?.bytes,
    };
  }

  /** Все пять мест показывают `bytes`. */
  async function expectAll(orgId: string, ownerCookie: string, bytes: number) {
    const s = await screens(orgId, ownerCookie);
    expect(s).toEqual({
      subscription: bytes,
      subsList: bytes,
      subsCard: bytes,
      orgFiles: bytes,
      storage: bytes,
    });
  }

  async function upload(name: string, size: number): Promise<FileItem> {
    const body = new Uint8Array(size).fill(7);
    const started = await call('POST', '/api/files/uploads', owner, {
      source: { kind: 'manual', id: null },
      name,
      size,
    });
    const ticket = FileUploadTicket.parse(await ok(started, 201));
    const url = new URL(ticket.upload.url);
    await storage.put(url.host + url.pathname, body, {
      contentType: ticket.upload.headers['content-type']!,
    });
    return FileItem.parse(await ok(await call('POST', `/api/files/${ticket.id}/complete`, owner)));
  }

  let base = 0;
  let baseB = 0;
  let kept: FileItem;

  beforeAll(async () => {
    f = await createStaffFixture();
    storage = f.deps.storage as MemoryStorage;
    await seedAllPlatformDictionaries(f.t.admin.db);
    owner = await signIn(f.app, 'owner-a', TEST_PASSWORD);
    ownerB = await signIn(f.app, 'owner-b', TEST_PASSWORD);
    admin = await signIn(f.app, 'platform-admin', TEST_PASSWORD);
    const cp = await call('POST', '/api/contractors', owner, {
      name: 'ОсОО «Память»',
      inn: '03744097401881',
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
    cpId = Contractor.parse(await ok(cp, 201)).id;
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('до загрузок все пять мест показывают одно число', async () => {
    const a = await screens(f.a.orgId, owner);
    base = a.subscription;
    await expectAll(f.a.orgId, owner, base);
    baseB = (await screens(f.b.orgId, ownerB)).subscription;
    await expectAll(f.b.orgId, ownerB, baseB);
  });

  it('загрузка: занятое растёт на размер файла во всех местах; чужая организация не меняется', async () => {
    kept = await upload('Договор.pdf', 1500);
    const gone = await upload('Акт.pdf', 300);
    await expectAll(f.a.orgId, owner, base + 1800);
    await expectAll(f.b.orgId, ownerB, baseB);

    // Удалённый перестаёт считаться сразу, хотя ждёт стирания сутки.
    await ok(await call('DELETE', `/api/files/${gone.id}?version=${gone.version}`, owner));
    await expectAll(f.a.orgId, owner, base + 1500);
  });

  it('файл от контрагента: новый и отклонённый считаются, принятый — уже файлом организации, один раз', async () => {
    const sent = async (name: string, size: number) => {
      const id = randomUUID();
      const storageKey = `org/${f.a.orgId}/sent/${id}`;
      await storage.put(storageKey, new Uint8Array(size).fill(1), {
        contentType: 'application/pdf',
      });
      await f.t.admin.db.insert(contractorSentFiles).values({
        id,
        orgId: f.a.orgId,
        contractorId: cpId,
        source: 'page',
        name,
        contentType: 'application/pdf',
        sizeBytes: size,
        storageKey,
        state: 'ready',
        status: 'new',
      });
      return id;
    };
    const rejected = await sent('Выписка.pdf', 700);
    const accepted = await sent('Справка.pdf', 200);
    await expectAll(f.a.orgId, owner, base + 2400);

    await ok(
      await call('POST', `/api/files/sent/${rejected}/reject`, owner, {
        version: 1,
        reason: 'Не та выписка',
      }),
    );
    await expectAll(f.a.orgId, owner, base + 2400);

    await ok(await call('POST', `/api/files/sent/${accepted}/accept`, owner, { version: 1 }));
    const [row] = await f.t.admin.db
      .select({ status: contractorSentFiles.status })
      .from(contractorSentFiles)
      .where(eq(contractorSentFiles.id, accepted));
    expect(row?.status).toBe('accepted');
    await expectAll(f.a.orgId, owner, base + 2400);
  });

  it('удаление загруженного — минус его размер во всех местах; чужая организация не менялась', async () => {
    await ok(await call('DELETE', `/api/files/${kept.id}?version=${kept.version}`, owner));
    // Остались отклонённый файл контрагента (700) и принятый — файл контрагента (200).
    await expectAll(f.a.orgId, owner, base + 900);
    await expectAll(f.b.orgId, ownerB, baseB);
  });
});
