import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

// Оболочка рабочей страницы через настоящий сайт: меню по правам из /api/auth/me, «+ Добавить», тема.
// Экранов модулей ещё нет — вместо них заглушки. На телефоне левой панели нет (нижняя панель — #11),
// поэтому меню проверяется по ссылкам в разметке страницы. Логины и роли свои на каждый запуск.
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'demo';

const unique = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

async function signIn(api: APIRequestContext, origin: string, login: string, password: string) {
  const res = await api.post('/api/auth/login', { headers: { origin }, data: { login, password } });
  expect(res.status(), await res.text()).toBe(200);
}

/** Яркость цвета `rgb(r, g, b)` по WCAG 2.1. */
function luminance(color: string): number {
  const [r, g, b] = color.match(/[\d.]+/g)!.map(Number) as [number, number, number];
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Ссылки меню на модуль в разметке страницы (левая панель на ПК). */
const moduleLinks = (page: Page, moduleId: string) =>
  page.locator(`aside a[href^="/app/${moduleId}"]`);

test.describe('Этап 1: оболочка рабочей страницы', () => {
  test('текст «Добавить» на основной кнопке читается в светлой и тёмной теме', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    for (const theme of ['light', 'dark'] as const) {
      await page.context().addCookies([{ name: 'bh_theme', value: theme, url: origin }]);
      await page.goto('/app/reports/week');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      // На ПК — кнопка «+ Добавить», на телефоне — круглая «+» с подписью «Добавить».
      const add = page.getByRole('button', { name: 'Добавить', exact: true });
      await expect(add).toBeVisible();
      const { color, background } = await add.evaluate((el) => {
        const style = getComputedStyle(el);
        return { color: style.color, background: style.backgroundColor };
      });
      expect(background, 'фон кнопки непрозрачный').toMatch(/^rgb\(/);
      expect(
        contrast(color, background),
        `${theme}: ${color} на ${background}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('роль без права «Просматривать проекты» не видит «Проекты» в меню', async ({
    page,
    playwright,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const owner = await playwright.request.newContext({ baseURL });
    await signIn(owner, origin, 'erkin', DEMO_PASSWORD);

    // Роль — копия «Бухгалтера» (у него «Проекты» видны) без права «Просматривать проекты».
    const roles = (await (await owner.get('/api/roles')).json()) as {
      items: { id: string; name: string }[];
    };
    const accountant = roles.items.find((r) => r.name === 'Бухгалтер')!;
    const created = await owner.post('/api/roles', {
      headers: { origin },
      data: { name: unique('Без проектов'), copyFromRoleId: accountant.id },
    });
    expect(created.status(), await created.text()).toBe(201);
    const role = (await created.json()) as { id: string; version: number; permissions: string[] };
    expect(role.permissions).toContain('projView');
    const updated = await owner.patch(`/api/roles/${role.id}`, {
      headers: { origin },
      data: {
        version: role.version,
        permissions: role.permissions.filter((p) => p !== 'projView'),
      },
    });
    expect(updated.status(), await updated.text()).toBe(200);

    const login = unique('e2e-noproj');
    const hired = await owner.post('/api/staff', {
      headers: { origin },
      data: { fullName: 'Безпроектов Сквозной Тестович', login, roleId: role.id },
    });
    expect(hired.status(), await hired.text()).toBe(201);
    const { temporaryPassword } = (await hired.json()) as { temporaryPassword: string };

    // Для сравнения: владелец «Проекты» в меню видит.
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    await page.goto('/app');
    await expect(moduleLinks(page, 'projects').first()).toBeAttached();

    await page.context().clearCookies();
    await signIn(page.request, origin, login, temporaryPassword);
    const changed = await page.request.post('/api/auth/password', {
      headers: { origin },
      data: { currentPassword: temporaryPassword, newPassword: 'Свой-пароль-e2e-1' },
    });
    expect(changed.status()).toBe(200);

    await page.goto('/app');
    await expect(page).toHaveURL(/\/app\/home\/today$/);
    await expect(moduleLinks(page, 'reports').first()).toBeAttached();
    await expect(moduleLinks(page, 'projects')).toHaveCount(0);
    // Адрес модуля, набранный вручную, ведёт на первый модуль меню.
    await page.goto('/app/projects/active');
    await expect(page).toHaveURL(/\/app\/home\/today$/);
    await owner.dispose();
  });

  test('«+ Добавить» в контрагентах: три способа, «Из свидетельства и выписки» с меткой «Бета», отдельной кнопки нет', async ({
    page,
    baseURL,
  }) => {
    await signIn(page.request, new URL(baseURL!).origin, 'erkin', DEMO_PASSWORD);
    await page.goto('/app/cps');
    await expect(page).toHaveURL(/\/app\/cps\/all$/);
    await expect(page.getByRole('button', { name: 'Загрузка из Excel' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    const menu = page.getByRole('menu', { name: 'Добавить' });
    await expect(menu.getByRole('menuitem')).toHaveText([
      'Контрагент',
      'Загрузка из Excel',
      /^Из свидетельства и выписки Бета/,
    ]);

    // Выбор способа передаётся экрану модуля (пока — заглушка сообщает, что он появится с экраном).
    await menu.getByRole('menuitem', { name: 'Контрагент', exact: true }).click();
    await expect(menu).toBeHidden();
    await expect(page.getByRole('status')).toHaveText(
      '«Контрагент» появится вместе с экраном модуля.',
    );
  });

  test('тема: без выбора — как на устройстве, переключатель запоминает выбор', async ({
    page,
    baseURL,
  }) => {
    await signIn(page.request, new URL(baseURL!).origin, 'erkin', DEMO_PASSWORD);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/app/home/today');
    const frame = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const html = page.locator('html');
    await expect(html).not.toHaveAttribute('data-theme', /./);
    const darkFrame = await frame();
    expect(luminance(darkFrame)).toBeLessThan(0.05);

    await page.getByRole('button', { name: 'Переключить тему' }).click();
    await expect(html).toHaveAttribute('data-theme', 'light');
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'light');
    expect(luminance(await frame())).toBeGreaterThan(0.6);
  });
});
