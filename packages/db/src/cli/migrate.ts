import { loadDatabaseConfig } from '@buhuchet/adapters/config';
import { ensureAppLoginRole, runMigrations } from '../migrate';

const config = loadDatabaseConfig();
if (!config.DATABASE_ADMIN_URL) {
  console.error('Для миграций нужен DATABASE_ADMIN_URL (владелец схемы).');
  process.exit(1);
}
await runMigrations(config.DATABASE_ADMIN_URL);
const role = await ensureAppLoginRole(config.DATABASE_ADMIN_URL, config.DATABASE_URL);
console.log(`Миграции применены; роль приложения «${role}» готова.`);
