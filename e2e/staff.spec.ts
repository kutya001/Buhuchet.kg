import { expect, test, type APIRequestContext } from '@playwright/test';

// Сотрудники и роли через настоящий сайт (Next.js → API): владелец демо-организации создаёт
// сотрудника, тот входит временным паролем и обязан его сменить; заблокированный не входит. Экранов
// ещё нет (#18) — проверяются методы API. Логины свои на каждый запуск и проект (ПК и телефон).
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'demo';

const uniqueLogin = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

async function signIn(api: APIRequestContext, origin: string, login: string, password: string) {
  const res = await api.post('/api/auth/login', { headers: { origin }, data: { login, password } });
  expect(res.status(), await res.text()).toBe(200);
  return res;
}

/** Владелец демо-организации создаёт сотрудника с ролью «Бухгалтер». */
async function hire(owner: APIRequestContext, origin: string, login: string) {
  const roles = await owner.get('/api/roles');
  expect(roles.status()).toBe(200);
  const { items } = (await roles.json()) as { items: { id: string; name: string }[] };
  const roleId = items.find((r) => r.name === 'Бухгалтер')!.id;
  const res = await owner.post('/api/staff', {
    headers: { origin },
    data: { fullName: 'Проверкин Сквозной Тестович', login, roleId },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as {
    employee: { id: string; version: number; active: boolean };
    temporaryPassword: string;
  };
}

test.describe('Этап 1: сотрудники и роли (API)', () => {
  test('владелец создаёт сотрудника с логином и временным паролем; сотрудник входит и обязан сменить пароль', async ({
    playwright,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const owner = await playwright.request.newContext({ baseURL });
    const employee = await playwright.request.newContext({ baseURL });
    await signIn(owner, origin, 'erkin', DEMO_PASSWORD);
    const login = uniqueLogin('e2e-new');
    const { temporaryPassword } = await hire(owner, origin, login);

    const first = await signIn(employee, origin, login, temporaryPassword);
    expect(await first.json()).toMatchObject({
      user: { login, mustChangePassword: true },
      employee: { roleName: 'Бухгалтер' },
    });
    const locked = await employee.get('/api/staff');
    expect(locked.status()).toBe(403);
    expect(await locked.json()).toMatchObject({ error: { code: 'password_change_required' } });

    const changed = await employee.post('/api/auth/password', {
      headers: { origin },
      data: { currentPassword: temporaryPassword, newPassword: 'Свой-пароль-e2e-1' },
    });
    expect(changed.status()).toBe(200);
    const me = await employee.get('/api/auth/me');
    expect(await me.json()).toMatchObject({ user: { login, mustChangePassword: false } });
    await owner.dispose();
    await employee.dispose();
  });

  test('заблокированный сотрудник не может войти, его сеансы закрыты', async ({
    playwright,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const owner = await playwright.request.newContext({ baseURL });
    const employee = await playwright.request.newContext({ baseURL });
    await signIn(owner, origin, 'erkin', DEMO_PASSWORD);
    const login = uniqueLogin('e2e-block');
    const created = await hire(owner, origin, login);
    await signIn(employee, origin, login, created.temporaryPassword);
    expect((await employee.get('/api/auth/me')).status()).toBe(200);

    const blocked = await owner.post(`/api/staff/${created.employee.id}/block`, {
      headers: { origin },
      data: { version: created.employee.version },
    });
    expect(blocked.status()).toBe(200);
    expect(await blocked.json()).toMatchObject({ active: false });

    expect((await employee.get('/api/auth/me')).status()).toBe(401);
    const again = await employee.post('/api/auth/login', {
      headers: { origin },
      data: { login, password: created.temporaryPassword },
    });
    expect(again.status()).toBe(403);
    expect(await again.json()).toMatchObject({ error: { code: 'employee_blocked' } });
    await owner.dispose();
    await employee.dispose();
  });
});
