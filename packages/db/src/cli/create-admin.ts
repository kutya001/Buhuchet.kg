import { parseArgs } from 'node:util';
import { loadDatabaseConfig } from '@buhuchet/adapters/config';
import { generateTemporaryPassword, hashPassword } from '@buhuchet/adapters/password';
import { isValidLogin, normalizeLogin } from '@buhuchet/domain';
import { createDb } from '../client';
import { users } from '../schema';

// Служебная команда до появления Админки: учётная запись администратора платформы с временным паролем.
// Администратор не принадлежит организации, поэтому запись создаёт владелец схемы (DATABASE_ADMIN_URL).
const { values } = parseArgs({ options: { login: { type: 'string' } } });
const login = normalizeLogin(values.login ?? '');
if (!isValidLogin(login)) {
  console.error(
    'Укажите логин: pnpm db:create-admin --login <логин> (латиница, цифры, точка, дефис; от 3 символов).',
  );
  process.exit(1);
}

const config = loadDatabaseConfig();
if (!config.DATABASE_ADMIN_URL) {
  console.error('Нужен DATABASE_ADMIN_URL (владелец схемы).');
  process.exit(1);
}
const handle = createDb(config.DATABASE_ADMIN_URL, {
  max: 1,
  applicationName: 'buhuchet-create-admin',
});
const password = generateTemporaryPassword();
try {
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
} finally {
  await handle.close();
}
