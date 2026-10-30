import { expect, type APIRequestContext } from '@playwright/test';
import { ownerPassword, platformAdmin, uniqueInn } from './admin';
import { signIn, uniqueLogin } from './helpers';

// Своя организация теста: создаёт администратор платформы, владелец входит и меняет временный пароль;
// подключён весь каталог видов отчётов — «Рекомендуемые» и отчёты не зависят от того, что подключила
// демо-организация, а её общие записи тест не меняет (задачи 2.07, 2.09).

/** Новая организация со всеми видами каталога (`connect`); сеанс владельца — в `api`. */
export async function orgWithTypes(api: APIRequestContext, origin: string, connect = true) {
  await platformAdmin(api, origin);
  const owner = uniqueLogin('e2e-pick');
  const temporary = ownerPassword();
  const created = await api.post('/api/admin/organizations', {
    headers: { origin },
    data: {
      name: `ОсОО «${owner}»`,
      inn: uniqueInn(),
      ownerFullName: 'Подборова Сквозная',
      ownerLogin: owner,
      temporaryPassword: temporary,
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  await signIn(api, origin, owner, temporary);
  const changed = await api.post('/api/auth/password', {
    headers: { origin },
    data: { currentPassword: temporary, newPassword: ownerPassword() },
  });
  expect(changed.status(), await changed.text()).toBe(200);
  if (connect) await connectAllTypes(api, origin);
}

/** Владелец подключает весь каталог видов отчётов своей организации. */
export async function connectAllTypes(api: APIRequestContext, origin: string) {
  const types = (await (await api.get('/api/report-types')).json()) as {
    items: { code: string }[];
  };
  const connected = await api.post('/api/org-report-types/connect', {
    headers: { origin },
    data: { connect: types.items.map((x) => x.code), disconnect: [] },
  });
  expect(connected.status(), await connected.text()).toBe(200);
}
