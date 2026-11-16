import { insertBellRows, type Tx } from '@buhuchet/db';
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
