import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { Banks, OrgAccounts, Wallets } from '@buhuchet/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

/** Optima Bank, M-Bank, Бакай Банк, АБанк (без переводов по номеру) — коды refDB.json. */
const OPTIMA = 'БНК-14';
const MBANK = 'БНК-13';
const BAKAI = 'БНК-02';
const ABANK = 'БНК-01';

const ACCOUNT = {
  kind: 'acc',
  bankCode: OPTIMA,
  accountNo: '1091 8200 0456 7012',
  bik: '109018',
  phone: null,
  phoneBanks: [],
  holderName: 'Организация А',
  purpose: 'both',
  mainTax: false,
  mainFee: false,
};

const BY_PHONE = {
  kind: 'phone',
  bankCode: null,
  accountNo: null,
  bik: null,
  phone: '+996700901234',
  phoneBanks: [BAKAI, MBANK],
  holderName: 'Организация А',
  purpose: 'both',
  mainTax: true,
  mainFee: false,
};

const WALLET = {
  kind: 'phone',
  bankCode: null,
  accountNo: null,
  phone: '+996555123456',
  phoneBanks: [MBANK],
  holderName: 'Бухгалтер А.',
  isMain: false,
};

describe.skipIf(!databaseAvailable())('Реквизиты для переводов', () => {
  let f: Fixture;
  let owner: string;
  let ownerB: string;
  let chief: string;
  let acc: string;
  let hr: string;
  let admin: string;

  const call = (
    cookie: string,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ) => apiRequest(f.app, method, path, cookie, body);
  const errorOf = async (res: Response) =>
    ((await res.json()) as { error: { code: string; details?: unknown } }).error;
  const accounts = async (cookie = owner) =>
    OrgAccounts.parse(await (await call(cookie, 'GET', '/api/org/accounts')).json()).items;

  beforeAll(async () => {
    f = await createStaffFixture();
    await seedAllPlatformDictionaries(f.t.admin.db);
    [owner, ownerB, chief, acc, hr, admin] = await Promise.all([
      signIn(f.app, 'owner-a', TEST_PASSWORD),
      signIn(f.app, 'owner-b', TEST_PASSWORD),
      signIn(f.app, 'chief-a', TEST_PASSWORD),
      signIn(f.app, 'acc-a', TEST_PASSWORD),
      signIn(f.app, 'hr-a', TEST_PASSWORD),
      signIn(f.app, 'platform-admin', TEST_PASSWORD),
    ]);
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('«Банковские провайдеры» читает любой вошедший, без входа — 401', async () => {
    for (const cookie of [acc, admin]) {
      const res = await call(cookie, 'GET', '/api/banks');
      expect(res.status).toBe(200);
      const { items } = Banks.parse(await res.json());
      expect(items.find((b) => b.code === BAKAI)).toMatchObject({
        name: 'Бакай Банк',
        kind: 'bank',
        byPhone: true,
      });
      expect(items.find((b) => b.code === ABANK)!.byPhone).toBe(false);
      expect(items.some((b) => b.kind === 'wallet')).toBe(true);
    }
    expect((await apiRequest(f.app, 'GET', '/api/banks')).status).toBe(401);
  });

  it('счета организации: добавляет право «Настройки», видят все сотрудники, первый — основной', async () => {
    expect((await call(acc, 'POST', '/api/org/accounts', ACCOUNT)).status).toBe(403);
    expect((await call(chief, 'POST', '/api/org/accounts', ACCOUNT)).status).toBe(403);
    expect((await apiRequest(f.app, 'GET', '/api/org/accounts')).status).toBe(401);
    expect((await call(admin, 'GET', '/api/org/accounts')).status).toBe(403);
    const res = await call(owner, 'POST', '/api/org/accounts', {
      ...ACCOUNT,
      accountNo: ' 1091 8200 0456 7012 ',
      phone: '+996555123456',
      phoneBanks: [BAKAI],
    });
    expect(res.status).toBe(200);
    const { items } = OrgAccounts.parse(await res.json());
    expect(items).toEqual([
      expect.objectContaining({
        kind: 'acc',
        accountNo: '1091 8200 0456 7012',
        phone: null,
        phoneBanks: [],
        mainTax: true,
        mainFee: true,
        version: 1,
      }),
    ]);
    expect(await accounts(acc)).toEqual(items);
    // Другая организация чужих счетов не видит.
    expect(await accounts(ownerB)).toEqual([]);
  });

  it('неверный реквизит — 400 с полем: счёт 16 цифр, БИК 6 цифр, банки номера с переводами по номеру', async () => {
    const cases: [object, string, string][] = [
      [{ ...ACCOUNT, accountNo: '1091 8200 0456 701' }, 'account_no_invalid', 'accountNo'],
      [{ ...ACCOUNT, bik: '10901' }, 'bik_invalid', 'bik'],
      [{ ...ACCOUNT, bankCode: null }, 'bank_required', 'bankCode'],
      [{ ...ACCOUNT, bankCode: 'БНК-99' }, 'bank_unavailable', 'bankCode'],
      [{ ...BY_PHONE, phone: '+99670090123' }, 'invalid_phone', 'phone'],
      [{ ...BY_PHONE, phoneBanks: [] }, 'phone_banks_required', 'phoneBanks'],
      [{ ...BY_PHONE, phoneBanks: [ABANK] }, 'bank_unavailable', 'phoneBanks'],
    ];
    for (const [body, code, field] of cases) {
      const res = await call(owner, 'POST', '/api/org/accounts', body);
      expect(res.status, code).toBe(400);
      expect(await errorOf(res)).toMatchObject({ code, details: { field } });
    }
    expect(
      (await call(owner, 'POST', '/api/org/accounts', { ...ACCOUNT, kind: 'card' })).status,
    ).toBe(400);
    expect(await accounts()).toHaveLength(1);
  });

  it('новый основной для налогов снимает отметку с прежнего — в истории обоих', async () => {
    const [first] = await accounts();
    const res = await call(owner, 'POST', '/api/org/accounts', {
      ...BY_PHONE,
      phoneBanks: [MBANK, BAKAI, MBANK],
    });
    expect(res.status).toBe(200);
    const { items } = OrgAccounts.parse(await res.json());
    expect(items.map((a) => [a.kind, a.mainTax, a.mainFee])).toEqual([
      ['acc', false, true],
      ['phone', true, false],
    ]);
    // Банки номера — по порядку справочника и без повторов.
    expect(items[1]!.phoneBanks).toEqual([BAKAI, MBANK]);
    const history = await f.t.admin.db
      .select()
      .from(schema.auditLog)
      .where(
        and(eq(schema.auditLog.entity, 'org_account'), eq(schema.auditLog.entityId, first!.id)),
      );
    expect(history.map((h) => h.action)).toEqual(['create', 'update']);
    expect(history[0]!.orgId).toBe(f.a.orgId);
  });

  it('изменение: устаревшая версия — 409, чужая организация — 404; удаление основного передаёт отметку', async () => {
    const [acct, phone] = await accounts();
    const stale = await call(owner, 'PATCH', `/api/org/accounts/${acct!.id}`, {
      ...ACCOUNT,
      version: acct!.version - 1,
    });
    expect(stale.status).toBe(409);
    expect((await errorOf(stale)).code).toBe('record_changed');
    expect(
      (
        await call(ownerB, 'PATCH', `/api/org/accounts/${acct!.id}`, {
          ...ACCOUNT,
          version: acct!.version,
        })
      ).status,
    ).toBe(404);
    expect(
      (await call(acc, 'DELETE', `/api/org/accounts/${acct!.id}?version=${acct!.version}`)).status,
    ).toBe(403);

    const changed = await call(owner, 'PATCH', `/api/org/accounts/${acct!.id}`, {
      ...ACCOUNT,
      holderName: 'ОсОО «Организация А»',
      purpose: 'fee',
      version: acct!.version,
    });
    expect(changed.status).toBe(200);
    expect(OrgAccounts.parse(await changed.json()).items[0]).toMatchObject({
      holderName: 'ОсОО «Организация А»',
      purpose: 'fee',
      mainTax: false,
      mainFee: true,
    });

    const deleted = await call(
      owner,
      'DELETE',
      `/api/org/accounts/${phone!.id}?version=${phone!.version}`,
    );
    expect(deleted.status).toBe(200);
    expect(OrgAccounts.parse(await deleted.json()).items.map((a) => a.kind)).toEqual(['acc']);
    expect(
      (await call(owner, 'DELETE', `/api/org/accounts/${phone!.id}?version=${phone!.version}`))
        .status,
    ).toBe(404);
  });

  it('«Мои реквизиты»: первый — основной, «Сделать основным», удаление; администратор платформы — 403', async () => {
    const created = (await (await call(acc, 'POST', '/api/profile/wallets', WALLET)).json()) as {
      items: Record<string, unknown>[];
    };
    // Ответ — ровно поля схемы: номера сотрудника в нём нет.
    expect(Object.keys(created.items[0]!).sort()).toEqual(
      Object.keys(Wallets.shape.items.element.shape).sort(),
    );
    const first = Wallets.parse(created).items;
    expect(first.map((w) => w.isMain)).toEqual([true]);
    const second = await call(acc, 'POST', '/api/profile/wallets', {
      ...WALLET,
      kind: 'acc',
      bankCode: BAKAI,
      accountNo: '0700 123 456',
      phone: null,
      phoneBanks: [],
    });
    const items = Wallets.parse(await second.json()).items;
    expect(items.map((w) => [w.kind, w.isMain])).toEqual([
      ['phone', true],
      ['acc', false],
    ]);
    const short = await call(acc, 'POST', '/api/profile/wallets', {
      ...WALLET,
      kind: 'acc',
      bankCode: BAKAI,
      accountNo: '12345',
      phone: null,
      phoneBanks: [],
    });
    expect(short.status).toBe(400);
    expect((await errorOf(short)).code).toBe('wallet_no_invalid');

    const made = await call(acc, 'PATCH', `/api/profile/wallets/${items[1]!.id}`, {
      ...WALLET,
      kind: 'acc',
      bankCode: BAKAI,
      accountNo: '0700 123 456',
      phone: null,
      phoneBanks: [],
      isMain: true,
      version: items[1]!.version,
    });
    expect(made.status).toBe(200);
    const after = Wallets.parse(await made.json()).items;
    expect(after.map((w) => w.isMain)).toEqual([false, true]);

    // Чужой реквизит через «Мой профиль» не изменить: для другого сотрудника его нет.
    expect(
      (
        await call(chief, 'PATCH', `/api/profile/wallets/${after[0]!.id}`, {
          ...WALLET,
          version: after[0]!.version,
        })
      ).status,
    ).toBe(404);
    const removed = await call(
      acc,
      'DELETE',
      `/api/profile/wallets/${after[1]!.id}?version=${after[1]!.version}`,
    );
    expect(Wallets.parse(await removed.json()).items.map((w) => [w.kind, w.isMain])).toEqual([
      ['phone', true],
    ]);
    expect((await call(admin, 'GET', '/api/profile/wallets')).status).toBe(403);
    expect((await call(admin, 'POST', '/api/profile/wallets', WALLET)).status).toBe(403);
  });

  it('реквизиты в карточке сотрудника: сам, владелец и роль с «Учёт денег» и «Видеть все» (решение А)', async () => {
    const accId = f.people['acc-a']!.employeeId;
    const path = `/api/staff/${accId}/wallets`;
    for (const cookie of [acc, owner, chief]) {
      const res = await call(cookie, 'GET', path);
      expect(res.status).toBe(200);
      expect(Wallets.parse(await res.json()).items).toHaveLength(1);
    }
    // «Кадры»: право «Сотрудники», но без «Учёт денег» и «Видеть все».
    expect((await call(hr, 'GET', path)).status).toBe(403);
    expect(
      (await call(acc, 'GET', `/api/staff/${f.people['chief-a']!.employeeId}/wallets`)).status,
    ).toBe(403);
    expect((await call(ownerB, 'GET', path)).status).toBe(404);
    expect(
      (await call(owner, 'GET', '/api/staff/00000000-0000-4000-8000-000000000000/wallets')).status,
    ).toBe(404);
  });
});
