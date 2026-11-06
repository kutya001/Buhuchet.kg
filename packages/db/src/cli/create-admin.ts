import { parseArgs } from 'node:util';
import { loadAdminPasswordConfig, loadDatabaseConfig } from '@buhuchet/adapters/config';
import { serializeError } from '@buhuchet/adapters/logger';
import { generateTemporaryPassword, hashPassword } from '@buhuchet/adapters/password';
import { isValidLogin, normalizeLogin } from '@buhuchet/domain';
import { createDb } from '../client';
import { users } from '../schema';
import { seedPlatformAdmin } from '../seed/admin';

// Служебная команда: учётная запись администратора платформы с временным паролем (при входе его нужно
// сменить). Администратор не принадлежит организации, поэтому запись создаёт владелец схемы
// (DATABASE_ADMIN_URL).
// - Без ADMIN_TEMP_PASSWORD (запуск вручную) пароль придумывается и показывается один раз; занятый
//   логин — ошибка.
// - С ADMIN_TEMP_PASSWORD (первый администратор рабочего сайта при выпуске, release-production.yml:
//   журнал GitHub Actions открыт) пароль берётся из настройки и не печатается; уже созданного
//   администратора команда не трогает (повторный выпуск с отметкой — не ошибка и пароль не меняет),
//   логин сотрудника организации — ошибка.
const { values } = parseArgs({ options: { login: { type: 'string' } } });
const login = normalizeLogin(values.login ?? '');
if (!isValidLogin(login)) {
  console.error(
    'Укажите логин: pnpm db:create-admin --login <логин> (латиница, цифры, точка, дефис; от 3 символов).',
  );
  process.exit(1);
}

const config = loadDatabaseConfig();
const { ADMIN_TEMP_PASSWORD: givenPassword } = loadAdminPasswordConfig();
if (!config.DATABASE_ADMIN_URL) {
  console.error('Нужен DATABASE_ADMIN_URL (владелец схемы).');
  process.exit(1);
}
const handle = createDb(config.DATABASE_ADMIN_URL, {
  max: 1,
  applicationName: 'buhuchet-create-admin',
});
try {
  if (givenPassword) {
    const report = await seedPlatformAdmin(handle.db, { login, password: givenPassword });
    console.log(
      report.created
        ? `Администратор платформы создан: ${login}. Временный пароль — из ADMIN_TEMP_PASSWORD, при входе его нужно сменить.`
        : `Администратор платформы ${login} уже есть — не изменён.`,
    );
  } else {
    const password = generateTemporaryPassword();
    const created = await handle.db
      .insert(users)
      .values({
        login,
        passwordHash: await hashPassword(password),
        isPlatformAdmin: true,
        mustChangePassword: true,
      })
      .onConflictDoNothing({ target: users.login })
      .returning({ id: users.id });
    if (created.length === 0) {
      console.error(`Логин ${login} уже занят.`);
      process.exitCode = 1;
    } else {
      console.log(
        `Администратор платформы создан: ${login}\nВременный пароль (показывается один раз, при входе его нужно сменить): ${password}`,
      );
    }
  }
} catch (error) {
  // Текст ошибки запроса Drizzle содержит значения параметров (хеш пароля) — печатаем без них.
  console.error(
    `Не удалось создать администратора:\n${JSON.stringify(serializeError(error), null, 2)}`,
  );
  process.exitCode = 1;
} finally {
  await handle.close();
}
