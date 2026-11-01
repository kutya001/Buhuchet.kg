import { hashPassword } from '@buhuchet/adapters/password';
import {
  fillTemplate,
  isValidLogin,
  normalizeLogin,
  TELEGRAM_TEMPLATE_DEFAULTS,
} from '@buhuchet/domain';
import { and, eq, sql } from 'drizzle-orm';
import { clearLoginAttempts } from '../auth';
import type { Db } from '../client';
import { sessions, telegramLinks, telegramOutbox, users } from '../schema';
import { messageTemplates } from '../telegram';

/** Кто сбросил пароль — в сообщении бота «Пароль … сброшен … Сбросил: {кто}». */
const RESET_BY = 'ручной запуск «Migrate test» в GitHub';

export interface PlatformAdminSeed {
  login: string;
  /** Временный пароль: при первом входе его нужно сменить. */
  password: string;
  /**
   * Сбросить пароль уже созданного администратора на этот временный (`pnpm db:seed
   * --reset-admin-password`; на стенде — ручной запуск «Migrate test» с отметкой «Сбросить пароль
   * администратора»). Без отметки уже созданного администратора наполнение не трогает.
   */
  resetPassword?: boolean;
}

export interface PlatformAdminReport {
  login: string;
  created: boolean;
  /** Пароль уже созданного администратора сброшен на временный. */
  reset?: true;
}

/**
 * Администратор платформы из настроек наполнения (PLATFORM_ADMIN_LOGIN и PLATFORM_ADMIN_PASSWORD):
 * создаётся, если его ещё нет, с временным паролем. Уже созданного не трогает, даже с --update:
 * пароль, который он сменил, повторное наполнение не возвращает. Логин, занятый сотрудником
 * организации, останавливает наполнение.
 *
 * Забытый пароль восстанавливается только явной отметкой `resetPassword`: пароль снова временный из
 * настроек (при входе сайт попросит задать свой), все сеансы администратора завершены, коды сброса
 * отозваны, блокировка входа после неверных паролей снята; если у администратора привязан Telegram,
 * бот сообщает о сбросе (ТЗ: о каждой смене пароля) — сообщение ставится в очередь отправки, его
 * отправляет задача `telegram.send` сайта (у наполнения нет бота). Другой администратор платформы чужой
 * пароль не сбрасывает (Админка сбрасывает только пароли пользователей организаций), а на рабочем
 * сайте PLATFORM_ADMIN_* не задаются (`loadConfig`), поэтому сброс возможен только на стенде и
 * локально. Кто и когда запускал сброс — в журнале GitHub Actions.
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
  if (!admin.resetPassword) return { login, created: false };
  const [reset] = await db
    .update(users)
    .set({
      passwordHash: await hashPassword(admin.password),
      mustChangePassword: true,
      version: sql`${users.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(and(sql`lower(${users.login}::text) = ${login}`, eq(users.isPlatformAdmin, true)))
    .returning({ id: users.id });
  if (!reset) throw new Error(`PLATFORM_ADMIN_LOGIN: администратор ${login} не найден`);
  await db.delete(sessions).where(eq(sessions.userId, reset.id));
  await db.execute(sql`select app.auth_reset_revoke(${reset.id})`);
  await clearLoginAttempts(db, login);
  const [link] = await db
    .select({ chatId: telegramLinks.chatId })
    .from(telegramLinks)
    .where(eq(telegramLinks.userId, reset.id));
  if (link) {
    const templates = await messageTemplates(db);
    await db.insert(telegramOutbox).values({
      orgId: null,
      userId: reset.id,
      chatId: link.chatId,
      kind: 'pass_reset',
      text: fillTemplate(templates.tgPassReset ?? TELEGRAM_TEMPLATE_DEFAULTS.tgPassReset, {
        логин: login,
        кто: RESET_BY,
      }),
    });
  }
  return { login, created: false, reset: true };
}
