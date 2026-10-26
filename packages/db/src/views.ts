import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from './client';
import { viewSettings } from './schema';

/**
 * Настройки вида списков пользователя (ТЗ «Списки записей» → «Настройки вида»): только свои строки
 * в своей организации (RLS по `app.user_id` и `app.org_id`), поэтому вызывать в `withOrgContext` с
 * пользователем, у администратора платформы — в `withUserContext`. Содержимое проверяет схема
 * `ViewSettings` в API.
 */

/** Все сохранённые настройки вида пользователя: ключ списка → настройки. */
export async function listViewSettings(tx: Tx): Promise<Record<string, Record<string, unknown>>> {
  const rows = await tx
    .select({ gridKey: viewSettings.gridKey, settings: viewSettings.settings })
    .from(viewSettings);
  return Object.fromEntries(rows.map((r) => [r.gridKey, r.settings]));
}

/** Сохранить вид списка: строка пользователя для списка создаётся или заменяется целиком. */
export async function saveViewSettings(
  tx: Tx,
  gridKey: string,
  settings: Record<string, unknown>,
): Promise<void> {
  await tx
    .insert(viewSettings)
    .values({
      userId: sql`app.current_user_id()`,
      orgId: sql`app.current_org_id()`,
      gridKey,
      settings,
    })
    .onConflictDoUpdate({
      target: [viewSettings.userId, viewSettings.gridKey],
      set: { settings, updatedAt: sql`now()` },
    });
}

/** «Сбросить вид»: настройки списка удаляются, список показывается по умолчанию. */
export async function resetViewSettings(tx: Tx, gridKey: string): Promise<void> {
  await tx
    .delete(viewSettings)
    .where(
      and(eq(viewSettings.gridKey, gridKey), eq(viewSettings.userId, sql`app.current_user_id()`)),
    );
}
