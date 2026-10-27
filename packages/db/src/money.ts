import {
  orgAccountMains,
  RecordChangedError,
  RecordNotFoundError,
  walletMains,
  type AccountPurpose,
  type HistoryChange,
  type RequisiteKind,
} from '@buhuchet/domain';
import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import type { Tx } from './client';
import { updateWithHistory, writeHistory } from './history';
import { employeeWallets, orgAccounts } from './schema';

/*
 * Реквизиты для переводов (задача 2.18): счета организации и реквизиты сотрудников. «Основной» —
 * по одному (у организации — для налогов и для обслуживания, у сотрудника — один): после добавления,
 * изменения и удаления отметки приводит правило домена (`orgAccountMains`, `walletMains`), а база не
 * даёт двух основных (частичные уникальные индексы). Изменения пишутся по реквизиту в историю, в том
 * числе снятая или поставленная отметка «Основной» у соседних реквизитов.
 */

/** Поля реквизита, которые задаёт форма (у сотрудника БИКа нет — null). */
export interface RequisiteFields {
  kind: RequisiteKind;
  bankCode: string | null;
  accountNo: string | null;
  bik: string | null;
  phone: string | null;
  phoneBanks: string[];
  holderName: string;
}

export interface OrgAccountInput extends RequisiteFields {
  purpose: AccountPurpose;
  mainTax: boolean;
  mainFee: boolean;
}

export interface OrgAccountRecord extends OrgAccountInput {
  id: string;
  version: number;
}

export interface WalletInput extends Omit<RequisiteFields, 'bik'> {
  isMain: boolean;
}

export interface WalletRecord extends WalletInput {
  id: string;
  employeeId: string;
  version: number;
}

/** Номер записи, которую правят, и её версия, которую видел пользователь. */
export interface VersionedTarget {
  id: string;
  version: number;
}

const accountFields = {
  id: orgAccounts.id,
  kind: orgAccounts.kind,
  bankCode: orgAccounts.bankCode,
  accountNo: orgAccounts.accountNo,
  bik: orgAccounts.bik,
  phone: orgAccounts.phone,
  phoneBanks: orgAccounts.phoneBanks,
  holderName: orgAccounts.holderName,
  purpose: orgAccounts.purpose,
  mainTax: orgAccounts.mainTax,
  mainFee: orgAccounts.mainFee,
  version: orgAccounts.version,
};

const walletFields = {
  id: employeeWallets.id,
  employeeId: employeeWallets.employeeId,
  kind: employeeWallets.kind,
  bankCode: employeeWallets.bankCode,
  accountNo: employeeWallets.accountNo,
  phone: employeeWallets.phone,
  phoneBanks: employeeWallets.phoneBanks,
  holderName: employeeWallets.holderName,
  isMain: employeeWallets.isMain,
  version: employeeWallets.version,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Одна правка реквизитов владельца (организации или сотрудника) за раз: «Основной» зависит от
 * соседних реквизитов, а новые строки блокировкой строк не закрыть.
 */
async function lockOwner(tx: Tx, key: SQL): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

/** Запись из списка по номеру и версии: нет — «не найдена», другая версия — «изменена». */
function pick<T extends { id: string; version: number }>(
  rows: readonly T[],
  target: VersionedTarget,
  entity: 'org_account' | 'employee_wallet',
): T {
  const row = UUID_RE.test(target.id) ? rows.find((r) => r.id === target.id) : undefined;
  if (!row) throw new RecordNotFoundError(entity, target.id);
  if (row.version !== target.version) throw new RecordChangedError(entity, target.id, row.version);
  return row;
}

/** Снятые отметки: было true, стало false (пишутся в историю вместе с правкой записи). */
function lostFlags<T>(before: T, after: T, keys: readonly (keyof T & string)[]): HistoryChange[] {
  return keys.flatMap((k) =>
    before[k] === true && after[k] === false ? [{ field: k, from: true, to: false }] : [],
  );
}

/** Поля счёта из записи или тела запроса — явным списком: лишнее в правку не попадает. */
const accountInputOf = (x: OrgAccountInput): OrgAccountInput => ({
  kind: x.kind,
  bankCode: x.bankCode,
  accountNo: x.accountNo,
  bik: x.bik,
  phone: x.phone,
  phoneBanks: x.phoneBanks,
  holderName: x.holderName,
  purpose: x.purpose,
  mainTax: x.mainTax,
  mainFee: x.mainFee,
});

const walletInputOf = (x: WalletInput): WalletInput => ({
  kind: x.kind,
  bankCode: x.bankCode,
  accountNo: x.accountNo,
  phone: x.phone,
  phoneBanks: x.phoneBanks,
  holderName: x.holderName,
  isMain: x.isMain,
});

/** Значения новой записи для истории «создан». */
const createdChanges = (values: object): HistoryChange[] =>
  Object.entries(values).map(([field, to]) => ({ field, to: to as HistoryChange['to'] }));

/** Значения удалённой записи для истории «удалён». */
const deletedChanges = (values: object): HistoryChange[] =>
  Object.entries(values).map(([field, from]) => ({ field, from: from as HistoryChange['from'] }));

/** Счета организации по порядку добавления. */
export function listOrgAccounts(tx: Tx): Promise<OrgAccountRecord[]> {
  return tx
    .select(accountFields)
    .from(orgAccounts)
    .orderBy(asc(orgAccounts.createdAt), asc(orgAccounts.id));
}

async function lockOrgAccounts(tx: Tx): Promise<OrgAccountRecord[]> {
  await lockOwner(tx, sql`'org_accounts:' || app.current_org_id()::text`);
  return tx
    .select(accountFields)
    .from(orgAccounts)
    .orderBy(asc(orgAccounts.createdAt), asc(orgAccounts.id))
    .for('update');
}

/**
 * Привести «Основной» счетов к `mains`: сначала снимаются отметки (иначе уникальный индекс не даст
 * поставить новую), затем записи меняются с версией и историей. `own` — сохраняемый счёт и его поля.
 */
async function applyAccountMains(
  tx: Tx,
  before: readonly OrgAccountRecord[],
  mains: ReadonlyMap<string, { mainTax: boolean; mainFee: boolean }>,
  own?: { id: string; fields: OrgAccountInput },
): Promise<void> {
  const lost = new Map<string, HistoryChange[]>();
  for (const a of before) {
    const m = mains.get(a.id);
    if (!m) continue;
    const changes = lostFlags(a, { ...a, ...m }, ['mainTax', 'mainFee']);
    if (changes.length === 0) continue;
    lost.set(a.id, changes);
    await tx
      .update(orgAccounts)
      .set({ mainTax: a.mainTax && m.mainTax, mainFee: a.mainFee && m.mainFee })
      .where(eq(orgAccounts.id, a.id));
  }
  for (const a of before) {
    const m = mains.get(a.id);
    if (!m) continue;
    const isOwn = own?.id === a.id;
    if (!isOwn && m.mainTax === a.mainTax && m.mainFee === a.mainFee) continue;
    const fields = accountInputOf(isOwn ? own.fields : a);
    await updateWithHistory(tx, {
      table: orgAccounts,
      entity: 'org_account',
      id: a.id,
      version: a.version,
      patch: { ...fields, ...m },
      changes: lost.get(a.id) ?? [],
    });
  }
}

/**
 * Добавить (`target` — null) или изменить счёт организации. «Основной» у остальных счетов меняется по
 * правилу `orgAccountMains`. Возвращает номер счёта.
 */
export async function saveOrgAccount(
  tx: Tx,
  target: VersionedTarget | null,
  input: OrgAccountInput,
): Promise<string> {
  const before = await lockOrgAccounts(tx);
  if (target) pick(before, target, 'org_account');
  const NEW = '';
  const ownId = target?.id ?? NEW;
  const list = target
    ? before.map((a) => (a.id === ownId ? { ...a, ...input } : a))
    : [...before, { ...input, id: NEW, version: 1 }];
  const mains = new Map(
    orgAccountMains(list, ownId).map((a) => [a.id, { mainTax: a.mainTax, mainFee: a.mainFee }]),
  );
  if (target) {
    await applyAccountMains(tx, before, mains, { id: ownId, fields: input });
    return ownId;
  }
  await applyAccountMains(tx, before, mains);
  const values = { ...accountInputOf(input), ...mains.get(NEW)! };
  const [row] = await tx
    .insert(orgAccounts)
    .values({
      ...values,
      orgId: sql`app.current_org_id()`,
      createdBy: sql`app.current_user_id()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .returning({ id: orgAccounts.id });
  await writeHistory(tx, {
    entity: 'org_account',
    entityId: row!.id,
    action: 'create',
    changes: createdChanges(values),
  });
  return row!.id;
}

/**
 * Удалить счёт организации. Прошлые поступления не меняются: они хранят свои реквизиты. Если удалён
 * основной — основным становится первый подходящий.
 */
export async function deleteOrgAccount(tx: Tx, target: VersionedTarget): Promise<void> {
  const before = await lockOrgAccounts(tx);
  const row = pick(before, target, 'org_account');
  await tx.delete(orgAccounts).where(eq(orgAccounts.id, row.id));
  const { id } = row;
  await writeHistory(tx, {
    entity: 'org_account',
    entityId: id,
    action: 'delete',
    changes: deletedChanges(accountInputOf(row)),
  });
  const rest = before.filter((a) => a.id !== id);
  const mains = new Map(
    orgAccountMains(rest).map((a) => [a.id, { mainTax: a.mainTax, mainFee: a.mainFee }]),
  );
  await applyAccountMains(tx, rest, mains);
}

/** Реквизиты сотрудника по порядку добавления. */
export function listEmployeeWallets(tx: Tx, employeeId: string): Promise<WalletRecord[]> {
  if (!UUID_RE.test(employeeId)) return Promise.resolve([]);
  return tx
    .select(walletFields)
    .from(employeeWallets)
    .where(eq(employeeWallets.employeeId, employeeId))
    .orderBy(asc(employeeWallets.createdAt), asc(employeeWallets.id));
}

async function lockWallets(tx: Tx, employeeId: string): Promise<WalletRecord[]> {
  await lockOwner(tx, sql`${`employee_wallets:${employeeId}`}`);
  return tx
    .select(walletFields)
    .from(employeeWallets)
    .where(eq(employeeWallets.employeeId, employeeId))
    .orderBy(asc(employeeWallets.createdAt), asc(employeeWallets.id))
    .for('update');
}

/** Привести «Основной» реквизитов сотрудника к `mains` (как `applyAccountMains`). */
async function applyWalletMains(
  tx: Tx,
  before: readonly WalletRecord[],
  mains: ReadonlyMap<string, boolean>,
  own?: { id: string; fields: WalletInput },
): Promise<void> {
  const lost = new Map<string, HistoryChange[]>();
  for (const w of before) {
    const isMain = mains.get(w.id);
    if (isMain === undefined || !w.isMain || isMain) continue;
    lost.set(w.id, [{ field: 'isMain', from: true, to: false }]);
    await tx.update(employeeWallets).set({ isMain: false }).where(eq(employeeWallets.id, w.id));
  }
  for (const w of before) {
    const isMain = mains.get(w.id);
    if (isMain === undefined) continue;
    const isOwn = own?.id === w.id;
    if (!isOwn && isMain === w.isMain) continue;
    const fields = walletInputOf(isOwn ? own.fields : w);
    await updateWithHistory(tx, {
      table: employeeWallets,
      entity: 'employee_wallet',
      id: w.id,
      version: w.version,
      patch: { ...fields, isMain },
      changes: lost.get(w.id) ?? [],
      where: eq(employeeWallets.employeeId, w.employeeId),
    });
  }
}

/**
 * Добавить или изменить реквизит сотрудника (только свой — RLS `employee_wallets_*_own`). «Основной»
 * у остальных реквизитов меняется по правилу `walletMains`. Возвращает номер реквизита.
 */
export async function saveEmployeeWallet(
  tx: Tx,
  employeeId: string,
  target: VersionedTarget | null,
  input: WalletInput,
): Promise<string> {
  const before = await lockWallets(tx, employeeId);
  if (target) pick(before, target, 'employee_wallet');
  const NEW = '';
  const ownId = target?.id ?? NEW;
  const list = target
    ? before.map((w) => (w.id === ownId ? { ...w, ...input } : w))
    : [...before, { ...input, id: NEW, employeeId, version: 1 }];
  const mains = new Map(walletMains(list, ownId).map((w) => [w.id, w.isMain]));
  if (target) {
    await applyWalletMains(tx, before, mains, { id: ownId, fields: input });
    return ownId;
  }
  await applyWalletMains(tx, before, mains);
  const values = { ...walletInputOf(input), isMain: mains.get(NEW)! };
  const [row] = await tx
    .insert(employeeWallets)
    .values({
      ...values,
      employeeId,
      orgId: sql`app.current_org_id()`,
      createdBy: sql`app.current_user_id()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .returning({ id: employeeWallets.id });
  await writeHistory(tx, {
    entity: 'employee_wallet',
    entityId: row!.id,
    action: 'create',
    changes: createdChanges(values),
  });
  return row!.id;
}

/** Удалить реквизит сотрудника; если он был основным — основным становится первый. */
export async function deleteEmployeeWallet(
  tx: Tx,
  employeeId: string,
  target: VersionedTarget,
): Promise<void> {
  const before = await lockWallets(tx, employeeId);
  const row = pick(before, target, 'employee_wallet');
  const deleted = await tx
    .delete(employeeWallets)
    .where(and(eq(employeeWallets.id, row.id), eq(employeeWallets.employeeId, employeeId)))
    .returning({ id: employeeWallets.id });
  // Чужой реквизит RLS удалить не даёт: для пользователя его нет.
  if (deleted.length === 0) throw new RecordNotFoundError('employee_wallet', row.id);
  const { id } = row;
  await writeHistory(tx, {
    entity: 'employee_wallet',
    entityId: id,
    action: 'delete',
    changes: deletedChanges(walletInputOf(row)),
  });
  const rest = before.filter((w) => w.id !== id);
  await applyWalletMains(tx, rest, new Map(walletMains(rest).map((w) => [w.id, w.isMain])));
}
