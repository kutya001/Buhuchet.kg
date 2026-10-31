import { permissionCatalog, type MoneyContractor, type Tx } from '@buhuchet/db';
import {
  closesWithMonth,
  hasPermission,
  opLock,
  opRight,
  type AccessSubject,
  type FinOpKind,
  type OpLock,
  type PermissionId,
  type Translate,
  type UiTextKey,
} from '@buhuchet/domain';
import { apiFail } from '../../errors';

/*
 * Общее модуля «Финансовые операции» (задача 2.20): кто может действовать с остатком контрагента и с
 * операцией — по правам из 39 и архиву контрагента, как кнопки прототипа (contractor-card.js, вкладка
 * «Деньги»; fin-op.js `opLock`). Область «Финансовые операции» уже отсекла контрагента при поиске.
 */

/** Нет права на действие: 403, как у проверки права в начале метода. */
export function forbidden(): never {
  apiFail(403, 'forbidden', 'Нет права на это действие');
}

/**
 * «Списать в бонус» (прототип: `feat('accounts') && (archived ? can('archiveRest') : can('bonus')) &&
 * paysTo === 'emp'`): виртуальные счета включены, деньги контрагент переводит ответственному.
 */
export function canBonus(subject: AccessSubject, c: MoneyContractor, accounts: boolean): boolean {
  if (!accounts || c.paysTo !== 'emp') return false;
  return c.archived ? canArchiveRest(subject) : hasPermission(subject, 'bonus');
}

/** «Вернуть остаток» (прототип: `!archived && can('money') || archived && can('archiveRest')`). */
export function canRefund(subject: AccessSubject, c: MoneyContractor): boolean {
  return c.archived ? canArchiveRest(subject) : hasPermission(subject, 'money');
}

/**
 * Остаток архивного — с правом «Распоряжаться остатком при архивировании» и тому, кто видит деньги
 * контрагентов (строже прототипа, docs/deviations.md п. В-23): без права на деньги сумму не узнать.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#В-23
export function canArchiveRest(subject: AccessSubject): boolean {
  return (
    hasPermission(subject, 'archiveRest') &&
    (hasPermission(subject, 'finView') || hasPermission(subject, 'money'))
  );
}

/**
 * «Перевод» (прототип: `!archived && can('money') && seeAll('fin') && orgHeld > 0 && resp`): деньги
 * контрагента на счёте организации переводит тот, кто видит все финансовые операции.
 */
export function canTransfer(
  subject: AccessSubject,
  c: MoneyContractor,
  allFin: boolean,
  orgHeld: number,
): boolean {
  return (
    !c.archived &&
    hasPermission(subject, 'money') &&
    allFin &&
    orgHeld > 0 &&
    !!c.responsibleEmployeeId
  );
}

/** Почему действие с операцией нельзя: код, подстановки и текст словаря. */
export interface OpLockInfo {
  code: OpLock;
  text: string;
}

/**
 * Замок операции (прототип `opLock`): удалена, создана системой, нет права своего вида (у архивного
 * списание и возврат — с правом «Распоряжаться остатком»), контрагент в архиве, месяц оплаты, списания
 * или возврата закрыт, оплата за обслуживание — часть общего поступления (задача 2.22).
 */
export async function operationLock(
  tx: Tx,
  t: Translate,
  subject: AccessSubject,
  op: { kind: FinOpKind; deleted: boolean; monthClosed?: boolean; receiptPart?: boolean },
  c: Pick<MoneyContractor, 'archived'>,
  act: 'edit' | 'del',
): Promise<OpLockInfo | null> {
  const right = opRight(op.kind);
  const code = opLock(
    {
      kind: op.kind,
      deleted: op.deleted,
      canKind: hasPermission(subject, right),
      canArchiveRest: canArchiveRest(subject),
      canMoney: hasPermission(subject, 'money'),
      archived: c.archived,
      monthClosed: op.monthClosed ?? false,
      receiptPart: op.receiptPart ?? false,
    },
    act,
  );
  if (!code) return null;
  if (code === 'op_view_only') return viewOnlyLock(tx, t, right);
  return { code, text: t(`err.${code}` as UiTextKey) };
}

/** «Только просмотр: нужно право «…»» — с названием права из каталога. */
export async function viewOnlyLock(tx: Tx, t: Translate, right: PermissionId): Promise<OpLockInfo> {
  const catalog = await permissionCatalog(tx);
  const name = catalog.find((p) => p.id === right)?.name ?? right;
  return { code: 'op_view_only', text: t('err.op_view_only', { right: name }) };
}

/**
 * Замки строк журнала — для меню строки «Изменить», «Обратная запись», «Удалить» (прототип finActions →
 * opActs → `opLock`): как у окна операции, но без запроса на каждую строку — закрытые месяцы известны
 * заранее, текст «Только просмотр» берётся из каталога один раз. Окно и сам запрос проверяют всё ещё раз.
 */
export function journalLocks(
  tx: Tx,
  t: Translate,
  subject: AccessSubject,
  closed: ReadonlySet<string>,
) {
  const viewOnly = new Map<PermissionId, Promise<OpLockInfo>>();
  const canMoney = hasPermission(subject, 'money');
  return async (
    r: {
      src: 'op' | 'fee';
      kind: string;
      deleted: boolean;
      archived: boolean;
      receiptPart: boolean;
      date: string;
    },
    act: 'edit' | 'del',
  ): Promise<OpLockInfo | null> => {
    const fee = r.src === 'fee';
    const kind = (fee ? 'fee' : r.kind) as FinOpKind;
    const right = opRight(kind);
    const code = opLock(
      {
        kind,
        deleted: r.deleted,
        canKind: hasPermission(subject, right),
        canArchiveRest: !fee && canArchiveRest(subject),
        canMoney,
        archived: r.archived,
        monthClosed: closesWithMonth(kind) && closed.has(r.date.slice(0, 7)),
        receiptPart: r.receiptPart,
      },
      act,
    );
    if (!code) return null;
    if (code !== 'op_view_only') return { code, text: t(`err.${code}` as UiTextKey) };
    let lock = viewOnly.get(right);
    if (!lock) {
      lock = viewOnlyLock(tx, t, right);
      viewOnly.set(right, lock);
    }
    return lock;
  };
}

/** Действие с операцией запрещено замком: 403 без права, 409 — в остальных случаях. */
export function lockFail(lock: OpLockInfo): never {
  apiFail(lock.code === 'op_view_only' ? 403 : 409, lock.code, lock.text);
}
