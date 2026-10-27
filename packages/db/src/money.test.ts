import { hashPassword } from '@buhuchet/adapters/password';
import { RecordChangedError, RecordNotFoundError } from '@buhuchet/domain';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext } from './context';
import { readHistory } from './history';
import {
  deleteEmployeeWallet,
  deleteOrgAccount,
  listEmployeeWallets,
  listOrgAccounts,
  saveEmployeeWallet,
  saveOrgAccount,
  type OrgAccountInput,
  type WalletInput,
} from './money';
import { createOrganization, type CreatedOrganization } from './organizations';
import { listBanks } from './platform-dicts';
import { banks, employees, employeeWallets, orgAccounts } from './schema';
import { createEmployee } from './staff';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  type TestDatabase,
} from './testing';

const permissionDenied = expect.objectContaining({
  cause: expect.objectContaining({ code: '42501' }),
});

const ACCOUNT: OrgAccountInput = {
  kind: 'acc',
  bankCode: 'БНК-14',
  accountNo: '1091 8200 0456 7012',
  bik: '109018',
  phone: null,
  phoneBanks: [],
  holderName: 'ОсОО «Альфа»',
  purpose: 'both',
  mainTax: true,
  mainFee: true,
};

const BY_PHONE: OrgAccountInput = {
  kind: 'phone',
  bankCode: null,
  accountNo: null,
  bik: null,
  phone: '+996700901234',
  phoneBanks: ['БНК-13', 'БНК-02'],
  holderName: 'ОсОО «Альфа»',
  purpose: 'both',
  mainTax: false,
  mainFee: false,
};

const WALLET: WalletInput = {
  kind: 'phone',
  bankCode: null,
  accountNo: null,
  phone: '+996555123456',
  phoneBanks: ['БНК-13'],
  holderName: 'Асанов А.',
  isMain: true,
};

describe.skipIf(!databaseAvailable())('Реквизиты для переводов', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let clerk: { employeeId: string; userId: string };
  const inOrg = <T>(
    org: CreatedOrganization,
    fn: Parameters<typeof withOrgContext<T>>[2],
    userId = org.ownerUserId,
  ) => withOrgContext(db.app.db, { orgId: org.orgId, userId }, fn);
  const mains = async (org: CreatedOrganization) =>
    (await inOrg(org, (tx) => listOrgAccounts(tx))).map((x) => [x.kind, x.mainTax, x.mainFee]);

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAccessReference(db.admin.db);
    await db.admin.db.insert(banks).values([
      { code: 'БНК-02', name: 'Бакай Банк', kind: 'bank', byPhone: true, sortOrder: 1 },
      { code: 'БНК-13', name: 'M-Bank', kind: 'bank', byPhone: true, sortOrder: 2 },
      { code: 'БНК-14', name: 'Optima Bank', kind: 'bank', byPhone: true, sortOrder: 3 },
      { code: 'БНК-30', name: 'Закрытый', kind: 'bank', active: false, sortOrder: 4 },
    ]);
    const passwordHash = await hashPassword('Bh-4821-temp');
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
    const role = a.roles.find((r) => !r.isOwner)!;
    const employeeId = await inOrg(a, (tx) =>
      createEmployee(tx, {
        fullName: 'Токтогулов Алишер',
        shortName: 'Алишер Т.',
        login: 'alisher',
        passwordHash,
        phone: null,
        role,
      }),
    );
    const [row] = await db.admin.db
      .select({ userId: employees.userId })
      .from(employees)
      .where(eq(employees.id, employeeId));
    clerk = { employeeId, userId: row!.userId };
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('«Банковские провайдеры»: по порядку справочника, отключённые — только по запросу', async () => {
    const active = await inOrg(a, (tx) => listBanks(tx));
    expect(active.map((x) => x.code)).toEqual(['БНК-02', 'БНК-13', 'БНК-14']);
    const all = await inOrg(a, (tx) => listBanks(tx, { all: true }));
    expect(all.at(-1)).toMatchObject({ code: 'БНК-30', active: false });
    // Справочник платформы приложение только читает.
    await expect(
      inOrg(a, (tx) =>
        tx.insert(banks).values({ code: 'X', name: 'X', kind: 'bank', sortOrder: 9 }),
      ),
    ).rejects.toThrow();
  });

  it('первый счёт — основной для налогов и обслуживания; новый основной снимает отметку с прежнего', async () => {
    const first = await inOrg(a, (tx) =>
      saveOrgAccount(tx, null, { ...ACCOUNT, mainTax: false, mainFee: false }),
    );
    expect(await mains(a)).toEqual([['acc', true, true]]);
    const second = await inOrg(a, (tx) => saveOrgAccount(tx, null, { ...BY_PHONE, mainTax: true }));
    expect(await mains(a)).toEqual([
      ['acc', false, true],
      ['phone', true, false],
    ]);
    // Снятая отметка — в истории прежнего основного, версия выросла.
    const history = await inOrg(a, (tx) => readHistory(tx, 'org_account', first));
    expect(history.map((h) => h.action)).toEqual(['create', 'update']);
    expect(history[1]!.changes).toEqual([{ field: 'mainTax', from: true, to: false }]);
    const created = await inOrg(a, (tx) => readHistory(tx, 'org_account', second));
    expect(created[0]!.changes).toContainEqual({ field: 'phone', to: '+996700901234' });
  });

  it('смена назначения: счёт «Обслуживание» не основной для налогов — основным становится первый подходящий', async () => {
    const [acc, phone] = await inOrg(a, (tx) => listOrgAccounts(tx));
    await inOrg(a, (tx) =>
      saveOrgAccount(
        tx,
        { id: phone!.id, version: phone!.version },
        {
          ...BY_PHONE,
          purpose: 'fee',
          mainTax: true,
          mainFee: true,
        },
      ),
    );
    expect(await mains(a)).toEqual([
      ['acc', true, false],
      ['phone', false, true],
    ]);
    const after = await inOrg(a, (tx) => listOrgAccounts(tx));
    expect(after[0]!.version).toBe(acc!.version + 1);
  });

  it('устаревшая версия — «изменена другим пользователем», чужая или несуществующая запись — «не найдена»', async () => {
    const [acc] = await inOrg(a, (tx) => listOrgAccounts(tx));
    await expect(
      inOrg(a, (tx) => saveOrgAccount(tx, { id: acc!.id, version: acc!.version - 1 }, ACCOUNT)),
    ).rejects.toBeInstanceOf(RecordChangedError);
    await expect(
      inOrg(b, (tx) => saveOrgAccount(tx, { id: acc!.id, version: acc!.version }, ACCOUNT)),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(
      inOrg(b, (tx) => deleteOrgAccount(tx, { id: acc!.id, version: acc!.version })),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(
      inOrg(a, (tx) => deleteOrgAccount(tx, { id: 'нет', version: 1 })),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
  });

  it('удаление основного: основным становится первый подходящий, удаление — в истории', async () => {
    const [acc] = await inOrg(a, (tx) => listOrgAccounts(tx));
    await inOrg(a, (tx) => deleteOrgAccount(tx, { id: acc!.id, version: acc!.version }));
    // Остался счёт «Обслуживание»: для налогов основного нет — подходящих счетов нет.
    expect(await mains(a)).toEqual([['phone', false, true]]);
    const history = await inOrg(a, (tx) => readHistory(tx, 'org_account', acc!.id));
    expect(history.at(-1)).toMatchObject({ action: 'delete' });
    expect(history.at(-1)!.changes).toContainEqual({ field: 'bankCode', from: 'БНК-14' });
  });

  it('счета организации не видны и не пишутся из другой организации и без контекста', async () => {
    expect(await inOrg(b, (tx) => listOrgAccounts(tx))).toEqual([]);
    await expect(
      inOrg(b, (tx) =>
        tx
          .insert(orgAccounts)
          .values({ ...ACCOUNT, orgId: a.orgId, mainTax: false, mainFee: false }),
      ),
    ).rejects.toThrow();
    expect(await db.app.db.select().from(orgAccounts)).toEqual([]);
  });

  it('база не даёт двух основных и неполный реквизит', async () => {
    await expect(
      inOrg(b, async (tx) => {
        await tx.insert(orgAccounts).values({ ...ACCOUNT, orgId: b.orgId });
        await tx.insert(orgAccounts).values({ ...ACCOUNT, orgId: b.orgId });
      }),
    ).rejects.toThrow();
    await expect(
      inOrg(b, (tx) => tx.insert(orgAccounts).values({ ...ACCOUNT, orgId: b.orgId, bik: '12345' })),
    ).rejects.toThrow();
    await expect(
      inOrg(b, (tx) =>
        tx.insert(orgAccounts).values({ ...BY_PHONE, orgId: b.orgId, phoneBanks: [] }),
      ),
    ).rejects.toThrow();
  });

  it('реквизиты сотрудника: первый — основной, «Сделать основным» переносит отметку, удаление основного — первый', async () => {
    const as = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) => inOrg(a, fn, clerk.userId);
    const w1 = await as((tx) =>
      saveEmployeeWallet(tx, clerk.employeeId, null, { ...WALLET, isMain: false }),
    );
    const w2 = await as((tx) =>
      saveEmployeeWallet(tx, clerk.employeeId, null, {
        ...WALLET,
        kind: 'acc',
        bankCode: 'БНК-02',
        accountNo: '0700 123 456',
        phone: null,
        phoneBanks: [],
        isMain: false,
      }),
    );
    const list = () => as((tx) => listEmployeeWallets(tx, clerk.employeeId));
    expect((await list()).map((w) => [w.id, w.isMain])).toEqual([
      [w1, true],
      [w2, false],
    ]);
    const second = (await list())[1]!;
    await as((tx) =>
      saveEmployeeWallet(
        tx,
        clerk.employeeId,
        { id: w2, version: second.version },
        {
          ...second,
          isMain: true,
        },
      ),
    );
    expect((await list()).map((w) => w.isMain)).toEqual([false, true]);
    const history = await as((tx) => readHistory(tx, 'employee_wallet', w1));
    expect(history.at(-1)!.changes).toEqual([{ field: 'isMain', from: true, to: false }]);
    const main = (await list())[1]!;
    await as((tx) => deleteEmployeeWallet(tx, clerk.employeeId, { id: w2, version: main.version }));
    expect((await list()).map((w) => [w.id, w.isMain])).toEqual([[w1, true]]);
  });

  it('реквизиты сотрудника видит организация, а меняет только сам сотрудник (RLS)', async () => {
    const own = await inOrg(a, (tx) => listEmployeeWallets(tx, clerk.employeeId));
    expect(own).toHaveLength(1);
    // Владелец читает, но не пишет чужие реквизиты.
    await expect(
      inOrg(a, (tx) => saveEmployeeWallet(tx, clerk.employeeId, null, WALLET)),
    ).rejects.toEqual(permissionDenied);
    await expect(
      inOrg(a, (tx) =>
        deleteEmployeeWallet(tx, clerk.employeeId, { id: own[0]!.id, version: own[0]!.version }),
      ),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
    const updated = await inOrg(a, (tx) =>
      tx.update(employeeWallets).set({ holderName: 'Чужой' }).returning({ id: employeeWallets.id }),
    );
    expect(updated).toEqual([]);
    // Другая организация не видит.
    expect(await inOrg(b, (tx) => listEmployeeWallets(tx, clerk.employeeId))).toEqual([]);
    await expect(
      inOrg(b, (tx) =>
        tx
          .insert(employeeWallets)
          .values({ ...WALLET, orgId: a.orgId, employeeId: clerk.employeeId }),
      ),
    ).rejects.toEqual(permissionDenied);
  });
});
