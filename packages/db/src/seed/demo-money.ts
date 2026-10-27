import { z } from 'zod';
import type { Db } from '../client';
import { banks, employeeWallets, orgAccounts } from '../schema';
import { demoId } from './demo';

/*
 * Реквизиты демо-организации (задача 2.18): счета организации (`organization.accounts` в demoDB.json)
 * и реквизиты сотрудников (`employees[].wallets`). В прототипе банки — названиями, в базе — кодами
 * справочника «Банковские провайдеры». Повторный запуск досоздаёт только недостающее.
 */

const Phone = z.object({ cc: z.string(), digits: z.string() });

const DemoAccount = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('acc'),
    bank: z.string(),
    acc: z.string(),
    bik: z.string(),
    name: z.string().default(''),
    use: z.enum(['both', 'tax', 'fee']).default('both'),
    mainTax: z.boolean().default(false),
    mainFee: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal('phone'),
    phone: Phone,
    banks: z.array(z.string()).min(1),
    name: z.string().default(''),
    use: z.enum(['both', 'tax', 'fee']).default('both'),
    mainTax: z.boolean().default(false),
    mainFee: z.boolean().default(false),
  }),
]);

const DemoWallet = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('acc'),
    prov: z.string(),
    num: z.string(),
    name: z.string().default(''),
    main: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal('phone'),
    phone: Phone,
    banks: z.array(z.string()).min(1),
    name: z.string().default(''),
    main: z.boolean().default(false),
  }),
]);

const DemoMoneyFile = z.object({
  organization: z.object({ accounts: z.array(DemoAccount).default([]) }),
  employees: z.array(z.object({ id: z.string(), wallets: z.array(DemoWallet).default([]) })),
});

/** Порядок в таблицах — порядок добавления: у демо-реквизитов — по порядку demoDB.json. */
const SEEDED_AT = Date.parse('2026-01-15T09:00:00+06:00');
const createdAt = (i: number) => new Date(SEEDED_AT + i * 60_000);

export async function seedDemoMoney(db: Db, file: unknown, orgId: string): Promise<void> {
  const demo = DemoMoneyFile.parse(file);
  const bankList = await db.select({ code: banks.code, name: banks.name }).from(banks);
  const codeOf = new Map(bankList.map((b) => [b.name, b.code]));
  const bank = (name: string) => {
    const code = codeOf.get(name);
    if (!code) throw new Error(`demoDB.json: банка «${name}» нет в справочнике`);
    return code;
  };

  const accounts = demo.organization.accounts.map((a, i) => ({
    id: demoId('requisite', `org:${i}`),
    orgId,
    kind: a.kind,
    ...(a.kind === 'acc'
      ? { bankCode: bank(a.bank), accountNo: a.acc, bik: a.bik }
      : { phone: `+${a.phone.digits}`, phoneBanks: a.banks.map(bank) }),
    holderName: a.name,
    purpose: a.use,
    mainTax: a.mainTax,
    mainFee: a.mainFee,
    createdAt: createdAt(i),
    updatedAt: createdAt(i),
  }));
  if (accounts.length > 0) await db.insert(orgAccounts).values(accounts).onConflictDoNothing();

  const wallets = demo.employees.flatMap((e) =>
    e.wallets.map((w, i) => ({
      id: demoId('requisite', `${e.id}:${i}`),
      orgId,
      employeeId: demoId('employee', e.id),
      kind: w.kind,
      ...(w.kind === 'acc'
        ? { bankCode: bank(w.prov), accountNo: w.num }
        : { phone: `+${w.phone.digits}`, phoneBanks: w.banks.map(bank) }),
      holderName: w.name,
      isMain: w.main,
      createdBy: demoId('user', e.id),
      updatedBy: demoId('user', e.id),
      createdAt: createdAt(i),
      updatedAt: createdAt(i),
    })),
  );
  if (wallets.length > 0) await db.insert(employeeWallets).values(wallets).onConflictDoNothing();
}
