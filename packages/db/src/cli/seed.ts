import { loadDatabaseConfig } from '@buhuchet/adapters/config';
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
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await handle.close();
}
