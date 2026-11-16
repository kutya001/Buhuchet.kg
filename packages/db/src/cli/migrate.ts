import { loadDatabaseConfig } from '@buhuchet/adapters/config';
import { ensureAppLoginRole, runMigrations } from '../migrate';

const config = loadDatabaseConfig();
if (!config.DATABASE_ADMIN_URL) {
  console.error('Для миграций нужен DATABASE_ADMIN_URL (владелец схемы).');
  process.exit(1);
}
// Сообщения миграций (итоги переноса данных) — в журнал задания «Migrate test» и выпуска.
await runMigrations(config.DATABASE_ADMIN_URL, config.DATABASE_CA_CERT, (line) =>
  console.log(line),
);
const role = await ensureAppLoginRole(
  config.DATABASE_ADMIN_URL,
  config.DATABASE_URL,
  config.DATABASE_CA_CERT,
);
console.log(`Миграции применены; роль приложения «${role}» готова.`);
