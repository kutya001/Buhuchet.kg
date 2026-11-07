import { ACCOUNT_LOCK_FAILURES } from '@buhuchet/domain';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../client';
import { auditLog, users } from '../schema';
import type { DemoIdOf } from './demo';

const Stamp = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
/** «2026-11-06 22:41» — момент по Бишкеку, как `_ca` и `_ua` записей прототипа. */
const stampOf = (value: string) => new Date(`${value.replace(' ', 'T')}:00+06:00`);

/**
 * Блокировка входа демо-сотрудника (прототип v76, demoDB.json: `employees[].pwBad`, `pwLocked` и
 * запись истории «Вход заблокирован: 10 неверных паролей подряд» от имени системы).
 */
const DemoLocks = z.object({
  employees: z.array(
    z.object({
      id: z.string(),
      pwBad: z.number().int().min(0).optional(),
      pwLocked: Stamp.nullable().optional(),
    }),
  ),
});

/**
 * Демо-сотрудник с закрытым входом (прототип v76: у jyldyz — 10 неверных паролей подряд): счёт и момент
 * блокировки, запись в истории учётной записи от имени системы — как пишет вход (`login_lock`,
 * миграция 0095). Сообщений в Telegram наполнение не шлёт. Только один раз: у учётной записи, которую
 * ещё не блокировали (нет ни блокировки, ни записи о ней), — снятую владельцем блокировку повторное
 * наполнение (`--update`) не возвращает.
 */
export async function seedDemoLoginLocks(
  db: Db,
  file: unknown,
  ids: { orgId: string; demoId: DemoIdOf },
): Promise<number> {
  const locked = DemoLocks.parse(file).employees.flatMap((e) =>
    e.pwLocked
      ? [
          {
            userId: ids.demoId('user', e.id),
            failures: e.pwBad ?? ACCOUNT_LOCK_FAILURES,
            at: stampOf(e.pwLocked),
          },
        ]
      : [],
  );
  if (locked.length === 0) return 0;
  const before = await db
    .select({ userId: auditLog.entityId })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.orgId, ids.orgId),
        eq(auditLog.entity, 'user'),
        eq(auditLog.action, 'login_lock'),
        inArray(
          auditLog.entityId,
          locked.map((l) => l.userId),
        ),
      ),
    );
  const done = new Set(before.map((r) => r.userId));
  let count = 0;
  for (const l of locked) {
    if (done.has(l.userId)) continue;
    const updated = await db
      .update(users)
      .set({ loginFailures: l.failures, loginLockedAt: l.at })
      .where(and(eq(users.id, l.userId), eq(users.orgId, ids.orgId), isNull(users.loginLockedAt)))
      .returning({ id: users.id });
    if (updated.length === 0) continue;
    await db.insert(auditLog).values({
      orgId: ids.orgId,
      entity: 'user',
      entityId: l.userId,
      action: 'login_lock',
      changes: [],
      actorUserId: null,
      at: l.at,
    });
    count += 1;
  }
  return count;
}
