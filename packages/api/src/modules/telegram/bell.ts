import { contractorBellStaff, insertBellRows, notifyTarget, type Tx } from '@buhuchet/db';
import { bellText, type BellKind, type BellTarget, type PermissionId } from '@buhuchet/domain';

/*
 * Колокольчик уведомлений (доработки 16.11.2026, блок 3; поток Т; прототип v122 `modules/bell.js`).
 * Стык «Положить уведомление» (/mnt/project-files/stream-t/bell-contract.md): в колокольчик попадает всё,
 * что человек получает в Telegram, по тем же правилам, получателям и настройкам профиля, — и без
 * привязанного Telegram, и при выключенных «Напоминаниях в Telegram». Одно событие — одна строка у
 * человека (ключ события), видно только то, что человек видит по правам сейчас, строки хранятся 90 дней.
 */

/** Строка колокольчика одному человеку. */
export interface BellPut {
  userId: string;
  kind: BellKind;
  event: string;
  target?: { kind: BellTarget; id: string } | null;
  contractorId?: string | null;
  need?: PermissionId | null;
  text: string;
  eventKey: string;
}

/**
 * Положить строки — в транзакции действия, только через `tx` (откатилось действие — строки нет). Повтор с
 * тем же ключом у того же человека ничего не добавляет. Возвращает, сколько строк добавлено.
 */
export async function putBell(tx: Tx, rows: readonly BellPut[], now: Date): Promise<number> {
  const seen = new Set<string>();
  const unique = rows.filter((r) => {
    const key = `${r.userId} ${r.eventKey}`;
    if (seen.has(key) || !r.text.trim()) return false;
    seen.add(key);
    return true;
  });
  return insertBellRows(
    tx,
    unique.map((r) => ({
      userId: r.userId,
      kind: r.kind,
      event: r.event,
      targetKind: r.target?.kind ?? null,
      targetId: r.target?.id ?? null,
      contractorId: r.contractorId ?? null,
      need: r.need ?? null,
      text: bellText(r.text),
      eventKey: r.eventKey,
    })),
    now,
  );
}

/**
 * Кому строка о событии контрагента (файл, «Я оплатил», «Оплатил», запрос на подключение, вопрос клиента,
 * страница закрыта): ответственному — даже без Telegram — и тому, кому ушло сообщение Telegram (первый с
 * Telegram из ответственного и владельцев, прототип `pgTgStaff`); ни у кого нет Telegram и нет
 * ответственного — первому владельцу (прототип v122 `bellCpTo`). Заблокированные и уволенные не получают.
 */
export async function bellContractorUsers(tx: Tx, contractorId: string): Promise<string[]> {
  const staff = await contractorBellStaff(tx, contractorId);
  if (!staff) return [];
  const resp = staff.responsibleId ? await notifyTarget(tx, staff.responsibleId) : null;
  const owners = [];
  for (const id of staff.ownerIds) {
    const target = await notifyTarget(tx, id);
    if (target) owners.push(target);
  }
  // Кому ушло в Telegram: ответственному с Telegram, иначе первому владельцу с Telegram.
  const tg = resp?.chatId != null ? resp : (owners.find((o) => o.chatId !== null) ?? null);
  const users = [resp?.userId, tg?.userId].filter((u): u is string => !!u);
  if (!users.length && owners[0]) users.push(owners[0].userId);
  return [...new Set(users)];
}
