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
const handle = createDb(config.DATABASE_ADMIN_URL, { max: 1, applicationName: 'buhuchet-seed' });
try {
  const result = await seedAll(handle.db, {
    update: args.has('--update'),
    demo,
    demoPassword: config.DEMO_PASSWORD ?? null,
    platformAdmin:
      config.PLATFORM_ADMIN_LOGIN && config.PLATFORM_ADMIN_PASSWORD
        ? { login: config.PLATFORM_ADMIN_LOGIN, password: config.PLATFORM_ADMIN_PASSWORD }
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
