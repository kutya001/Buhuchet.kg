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
// - Без --password-from-env (запуск вручную) пароль придумывается и показывается один раз; занятый
//   логин — ошибка.
// - С --password-from-env (первый администратор рабочего сайта при выпуске, release-production.yml:
//   журнал GitHub Actions открыт) пароль берётся из ADMIN_TEMP_PASSWORD; без него команда падает, а не
//   придумывает и печатает пароль. Ни пароль, ни логин не печатаются (GitHub скрывает в журнале только
//   точное значение секрета, а логин здесь уже приведён к нижнему регистру). Уже созданного
//   администратора команда не трогает (повторный выпуск с отметкой — не ошибка и пароль не меняет),
//   логин сотрудника организации — ошибка.
const { values } = parseArgs({
  options: { login: { type: 'string' }, 'password-from-env': { type: 'boolean' } },
});
const fromEnv = values['password-from-env'] === true;
const login = normalizeLogin(values.login ?? '');
if (!isValidLogin(login)) {
  console.error(
    'Укажите логин: pnpm db:create-admin --login <логин> (латиница, цифры, точка, дефис; от 3 символов).',
  );
  process.exit(1);
}

const config = loadDatabaseConfig();
const { ADMIN_TEMP_PASSWORD: givenPassword } = loadAdminPasswordConfig();
if (fromEnv && !givenPassword) {
  console.error(
    'С --password-from-env нужен ADMIN_TEMP_PASSWORD (временный пароль администратора).',
  );
  process.exit(1);
}
if (!config.DATABASE_ADMIN_URL) {
  console.error('Нужен DATABASE_ADMIN_URL (владелец схемы).');
  process.exit(1);
}
const handle = createDb(config.DATABASE_ADMIN_URL, {
  max: 1,
  applicationName: 'buhuchet-create-admin',
  caCert: config.DATABASE_CA_CERT,
});
try {
  if (fromEnv && givenPassword) {
    const report = await seedPlatformAdmin(handle.db, { login, password: givenPassword });
    console.log(
      report.created
        ? 'Администратор платформы создан. Временный пароль — из ADMIN_TEMP_PASSWORD, при входе его нужно сменить.'
        : 'Администратор платформы с этим логином уже есть — не изменён.',
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
  // С --password-from-env логин в журнал тоже не попадает.
  const details = JSON.stringify(serializeError(error), null, 2);
  console.error(
    `Не удалось создать администратора:\n${fromEnv ? details.replaceAll(login, '<логин>') : details}`,
  );
  process.exitCode = 1;
} finally {
  await handle.close();
}
