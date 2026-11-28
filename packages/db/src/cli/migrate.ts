import { loadDatabaseConfig } from '@buhuchet/adapters/config';
import {
  appPasswordDiffersMessage,
  appPasswordPlan,
  appPasswordState,
  ensureAppLoginRole,
  roleFromUrl,
  runMigrations,
} from '../migrate';

const config = loadDatabaseConfig();
if (!config.DATABASE_ADMIN_URL) {
  console.error('Для миграций нужен DATABASE_ADMIN_URL (владелец схемы).');
  process.exit(1);
}
// Пароль роли приложения — до миграций (docs/decisions.md п. О-71): разошёлся с базой — стоп, если
// смену не просили явно (`--change-app-password`, отметка выпуска «Сменить пароль роли сайта»).
const changePassword = process.argv.includes('--change-app-password');
const plan = appPasswordPlan(
  changePassword
    ? 'change'
    : await appPasswordState(
        config.DATABASE_ADMIN_URL,
        config.DATABASE_URL,
        config.DATABASE_CA_CERT,
      ),
);
if (plan === 'stop') {
  console.error(appPasswordDiffersMessage(roleFromUrl(config.DATABASE_URL)));
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
  { keepPassword: plan === 'keep' },
);
console.log(
  changePassword
    ? `Миграции применены; пароль роли приложения «${role}» поставлен из DATABASE_URL — тот же адрес нужен в DATABASE_URL сайта (Vercel → Redeploy).`
    : `Миграции применены; роль приложения «${role}» готова.`,
);
