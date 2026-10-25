import { parseArgs } from 'node:util';
import { loadDatabaseConfig } from '@buhuchet/adapters/config';
import { generateTemporaryPassword, hashPassword } from '@buhuchet/adapters/password';
import { slugOf, slugFree } from '@buhuchet/domain';
import { createDb } from '../client';
import { createOrganization, OrganizationInputError } from '../organizations';

// Служебная команда до появления Админки: организация и её владелец с временным паролем.
// pnpm db:create-org --name "ОсОО «Пример»" --inn 01234567890123 --owner-fio "Иванов Иван" --owner-login ivanov
const USAGE =
  'pnpm db:create-org --name "ОсОО «Пример»" --inn <14 цифр> --owner-fio "<ФИО>" --owner-login <логин> [--slug <адрес>] [--owner-phone +996…]';

const { values } = parseArgs({
  options: {
    name: { type: 'string' },
    inn: { type: 'string' },
    slug: { type: 'string' },
    'owner-fio': { type: 'string' },
    'owner-login': { type: 'string' },
    'owner-phone': { type: 'string' },
  },
});
if (!values.name || !values.inn || !values['owner-fio'] || !values['owner-login']) {
  console.error(`Не хватает параметров.\n${USAGE}`);
  process.exit(1);
}

const config = loadDatabaseConfig();
// Ролью приложения, под RLS — так же, как будет создавать организацию Админка.
const handle = createDb(config.DATABASE_URL, { max: 1, applicationName: 'buhuchet-create-org' });
const password = generateTemporaryPassword();
try {
  const org = await createOrganization(handle.db, {
    name: values.name,
    inn: values.inn.trim(),
    slug: values.slug?.trim().toLowerCase() || slugFree(slugOf(values.name), []),
    owner: {
      fullName: values['owner-fio'],
      login: values['owner-login'],
      passwordHash: await hashPassword(password),
      phone: values['owner-phone']?.trim() || null,
    },
  });
  console.log(
    [
      `Организация создана: ${org.orgId}`,
      `Роли: ${org.roles.map((r) => r.name).join(', ')}`,
      `Логин владельца: ${values['owner-login'].trim().toLowerCase()}`,
      `Временный пароль (показывается один раз, при входе его нужно сменить): ${password}`,
    ].join('\n'),
  );
} catch (error) {
  if (error instanceof OrganizationInputError) {
    console.error(
      `${error.message}.${error.field === 'slug' ? ' Укажите другой адрес: --slug <адрес>.' : ''}`,
    );
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  await handle.close();
}
