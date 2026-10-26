import { expect, test, type APIRequestContext } from '@playwright/test';

// «Моя организация» через настоящий сайт (Next.js → API) на демо-организации. Экранов ещё нет (#19) —
// проверяются методы API. Правки общей демо-организации (адрес страницы, функции) — только в проекте
// «desktop» и по очереди: иначе проекты ПК и телефона меняли бы одну запись одновременно; методы API
// для ПК и телефона одни и те же. Всё изменённое возвращается как было.
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'demo';

test.describe.configure({ mode: 'serial' });

async function signIn(api: APIRequestContext, origin: string, login: string) {
  const res = await api.post('/api/auth/login', {
    headers: { origin },
    data: { login, password: DEMO_PASSWORD },
  });
  expect(res.status(), await res.text()).toBe(200);
}

async function version(api: APIRequestContext, path: '/api/org' | '/api/org/policy') {
  const res = await api.get(path);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { version: number }).version;
}

test.describe('Этап 1: Моя организация (API)', () => {
  test('бухгалтер видит профиль организации, но изменить не может (403)', async ({
    playwright,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const accountant = await playwright.request.newContext({ baseURL });
    await signIn(accountant, origin, 'alisher');
    const profile = await accountant.get('/api/org');
    expect(profile.status()).toBe(200);
    const body = (await profile.json()) as { name: string; slug: string; version: number };
    expect(body).toMatchObject({ name: 'ОсОО «Бухгалтер Плюс»', slug: 'buhgalter-plyus' });

    const patch = await accountant.patch('/api/org', {
      headers: { origin },
      data: { version: body.version, name: 'Взлом' },
    });
    expect(patch.status()).toBe(403);
    expect(await patch.json()).toMatchObject({ error: { code: 'forbidden' } });
    const policy = await accountant.patch('/api/org/policy', {
      headers: { origin },
      data: { version: await version(accountant, '/api/org/policy'), features: { tasks: false } },
    });
    expect(policy.status()).toBe(403);
    await accountant.dispose();
  });

  test('владелец вводит зарезервированный адрес страницы — отказ с понятной причиной; свободный сохраняется', async ({
    playwright,
    baseURL,
  }, testInfo) => {
    const origin = new URL(baseURL!).origin;
    const owner = await playwright.request.newContext({ baseURL });
    await signIn(owner, origin, 'erkin');
    const save = async (slug: string) =>
      owner.patch('/api/org', {
        headers: { origin },
        data: { version: await version(owner, '/api/org'), slug },
      });

    for (const word of ['admin', 'api', 'login']) {
      const res = await save(word);
      expect(res.status(), word).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: 'slug_reserved', message: 'Этот адрес занят, выберите другой' },
      });
    }
    const bad = await save('Не адрес');
    expect(await bad.json()).toMatchObject({
      error: {
        code: 'slug_invalid',
        message: '3–30 символов: строчные латинские буквы, цифры и дефис',
      },
    });

    test.skip(testInfo.project.name !== 'desktop', 'правка общей записи — один раз, в проекте ПК');
    const free = `e2e-${Date.now().toString(36)}`;
    try {
      const res = await save(free);
      expect(res.status()).toBe(200);
      expect(await res.json()).toMatchObject({ slug: free });
      const me = await owner.get('/api/auth/me');
      expect(await me.json()).toMatchObject({ organization: { slug: free } });
    } finally {
      expect((await save('buhgalter-plyus')).status()).toBe(200);
    }
    await owner.dispose();
  });

  test('выключенный в учётной политике модуль пропадает из списка модулей меню', async ({
    playwright,
    baseURL,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'правка общей записи — один раз, в проекте ПК');
    const origin = new URL(baseURL!).origin;
    const owner = await playwright.request.newContext({ baseURL });
    const accountant = await playwright.request.newContext({ baseURL });
    await signIn(owner, origin, 'erkin');
    await signIn(accountant, origin, 'alisher');
    const modules = async () =>
      ((await (await accountant.get('/api/auth/me')).json()) as { modules: string[] }).modules;
    const setProjects = async (on: boolean) => {
      const res = await owner.patch('/api/org/policy', {
        headers: { origin },
        data: { version: await version(owner, '/api/org/policy'), features: { projects: on } },
      });
      expect(res.status(), await res.text()).toBe(200);
    };

    expect(await modules()).toContain('projects');
    try {
      await setProjects(false);
      const after = await modules();
      expect(after).not.toContain('projects');
      expect(after).toEqual(expect.arrayContaining(['home', 'cps', 'reports', 'org']));
      const history = await accountant.get('/api/org/policy/history');
      expect(
        ((await history.json()) as { items: { changes: { field: string }[] }[] }).items[0],
      ).toMatchObject({
        changes: [expect.objectContaining({ field: 'features' })],
      });
    } finally {
      await setProjects(true);
    }
    expect(await modules()).toContain('projects');
    await owner.dispose();
    await accountant.dispose();
  });
});
