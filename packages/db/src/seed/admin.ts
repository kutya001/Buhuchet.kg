import { hashPassword } from '@buhuchet/adapters/password';
import { isValidLogin, normalizeLogin } from '@buhuchet/domain';
import { sql } from 'drizzle-orm';
import type { Db } from '../client';
import { users } from '../schema';

export interface PlatformAdminSeed {
  login: string;
  /** Временный пароль: при первом входе его нужно сменить. */
  password: string;
}

export interface PlatformAdminReport {
  login: string;
  created: boolean;
}

/**
 * Администратор платформы из настроек наполнения (PLATFORM_ADMIN_LOGIN и PLATFORM_ADMIN_PASSWORD):
 * создаётся, если его ещё нет, с временным паролем. Уже созданного не трогает, даже с --update:
 * пароль, который он сменил, повторное наполнение не возвращает. Логин, занятый сотрудником
 * организации, останавливает наполнение.
 */
export async function seedPlatformAdmin(
  db: Db,
  admin: PlatformAdminSeed,
): Promise<PlatformAdminReport> {
  const login = normalizeLogin(admin.login);
  if (!isValidLogin(login)) throw new Error('PLATFORM_ADMIN_LOGIN: неверный логин');
  const created = await db
    .insert(users)
    .values({
      login,
      passwordHash: await hashPassword(admin.password),
      isPlatformAdmin: true,
      mustChangePassword: true,
    })
    .onConflictDoNothing({ target: users.login })
    .returning({ id: users.id });
  if (created.length > 0) return { login, created: true };
  const [existing] = await db
    .select({ isPlatformAdmin: users.isPlatformAdmin })
    .from(users)
    .where(sql`lower(${users.login}::text) = ${login}`);
  if (!existing?.isPlatformAdmin) {
    throw new Error(
      `PLATFORM_ADMIN_LOGIN: логин ${login} занят сотрудником организации — укажите другой`,
    );
  }
  return { login, created: false };
}
