import { loadDatabaseConfig } from '@buhuchet/adapters/config';
import { serializeError } from '@buhuchet/adapters/logger';
import { createDb } from '../client';
import { seedAll } from '../seed';

const args = new Set(process.argv.slice(2));
const config = loadDatabaseConfig();
if (!config.DATABASE_ADMIN_URL) {
  console.error('Для наполнения нужен DATABASE_ADMIN_URL (владелец схемы).');
  process.exit(1);
}
// Демо-организация — локально, в тестах и на стенде; на рабочем сайте — никогда.
const demo = config.APP_ENV !== 'production' && !args.has('--no-demo');
// Сброс забытого пароля администратора платформы на временный из PLATFORM_ADMIN_PASSWORD — только
// явно (на стенде — ручной запуск «Migrate test» с отметкой); без настроек администратора — ошибка.
const resetAdminPassword = args.has('--reset-admin-password');
if (resetAdminPassword && !(config.PLATFORM_ADMIN_LOGIN && config.PLATFORM_ADMIN_PASSWORD)) {
  console.error(
    'Для --reset-admin-password нужны PLATFORM_ADMIN_LOGIN и PLATFORM_ADMIN_PASSWORD (на стенде — секреты TEST_ADMIN_LOGIN и TEST_ADMIN_PASSWORD).',
  );
  process.exit(1);
}
const handle = createDb(config.DATABASE_ADMIN_URL, {
  max: 1,
  applicationName: 'buhuchet-seed',
  caCert: config.DATABASE_CA_CERT,
});
try {
  const result = await seedAll(handle.db, {
    update: args.has('--update'),
    demo,
    demoPassword: config.DEMO_PASSWORD ?? null,
    platformAdmin:
      config.PLATFORM_ADMIN_LOGIN && config.PLATFORM_ADMIN_PASSWORD
        ? {
            login: config.PLATFORM_ADMIN_LOGIN,
            password: config.PLATFORM_ADMIN_PASSWORD,
            resetPassword: resetAdminPassword,
          }
        : null,
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  // Текст ошибки запроса Drizzle содержит значения параметров (хеши паролей) — печатаем без них.
  console.error(`Наполнение не удалось:\n${JSON.stringify(serializeError(error), null, 2)}`);
  process.exitCode = 1;
} finally {
  await handle.close();
}
