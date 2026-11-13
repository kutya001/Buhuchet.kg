import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

// Оболочка рабочей страницы через настоящий сайт: меню по правам из /api/auth/me, «+ Добавить», тема.
// Экранов модулей ещё нет — вместо них заглушки. Меню по правам проверяется по ссылкам левой панели
// в разметке страницы (на телефоне она скрыта; нижняя панель и «Другие модули» — e2e/phone.spec.ts).
// Логины и роли свои на каждый запуск.
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
    const roles = (await (await owner.get('/api/roles?size=all')).json()) as {
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

    // Уходим со страницы владельца: её проверка входа после сброса cookie увела бы на /login.
    await page.goto('about:blank');
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

    // Выбор способа передаётся экрану модуля: «Контрагент» открывает форму создания (2.09), «Загрузка
    // из Excel» — окно загрузки (2.16).
    await menu.getByRole('menuitem', { name: 'Контрагент', exact: true }).click();
    await expect(menu).toBeHidden();
    const form = page.getByRole('dialog', { name: 'Новый контрагент' });
    await expect(form).toBeVisible();
    await form.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await expect(form).toBeHidden();
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    await menu.getByRole('menuitem', { name: 'Загрузка из Excel', exact: true }).click();
    await expect(
      page.getByRole('dialog', { name: 'Загрузка контрагентов из Excel' }),
    ).toBeVisible();
  });

  test('тема: без выбора — светлая и при тёмной теме устройства (прототип v88), смена — волной, при «Уменьшить движение» — сразу, переключатель запоминает выбор', async ({
    page,
    baseURL,
  }) => {
    await signIn(page.request, new URL(baseURL!).origin, 'erkin', DEMO_PASSWORD);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/app/home/today');
    const frame = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const html = page.locator('html');
    await expect(html).not.toHaveAttribute('data-theme', /./);
    expect(luminance(await frame())).toBeGreaterThan(0.6);

    // Смена темы идёт волной: на время волны у страницы отметка data-wave, после — отметки нет.
    const watch = () =>
      page.evaluate(() => {
        const seen: string[] = [];
        const root = document.documentElement;
        new MutationObserver(() => {
          if (root.dataset.wave) seen.push(root.dataset.wave);
        }).observe(root, { attributes: true, attributeFilter: ['data-wave'] });
        (window as unknown as { __waves: string[] }).__waves = seen;
      });
    const waves = () => page.evaluate(() => (window as unknown as { __waves: string[] }).__waves);
    await watch();
    await page.getByRole('button', { name: 'Переключить тему' }).click();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(html).not.toHaveAttribute('data-wave', /./);
    expect(await waves()).toHaveLength(1);
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    expect(luminance(await frame())).toBeLessThan(0.05);

    // «Уменьшить движение» — тема меняется сразу, без волны.
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await watch();
    await page.getByRole('button', { name: 'Переключить тему' }).click();
    await expect(html).toHaveAttribute('data-theme', 'light');
    expect(luminance(await frame())).toBeGreaterThan(0.6);
    expect(await waves()).toEqual([]);
  });

  test('верхняя и левая панели: «ⓘ», «?», поиск по вкладке, время по Бишкеку, свёрнутая панель и раскрытые ветки', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    await signIn(page.request, new URL(baseURL!).origin, 'erkin', DEMO_PASSWORD);
    // Часы показывают время Бишкека и на устройстве в другом поясе.
    await page.clock.setFixedTime(new Date('2026-10-26T18:30:00Z'));
    await page.goto('/app/reports/week');

    const clock = page.locator('header [title$=", Бишкек"]');
    await expect(clock).toHaveAttribute('title', '27.10.2026 00:30, Бишкек');
    // Уже 768 px — только ЧЧ:ММ.
    await expect
      .poll(() => clock.innerText())
      .toMatch(isMobile ? /^00:30$/ : /^27\.10\.2026\s*00:30$/);

    // «ⓘ»: на ПК — при наведении, на телефоне — по нажатию.
    const info = page.getByRole('button', { name: 'Описание модуля' });
    const infoBox = page.getByRole('dialog', { name: 'Описание модуля' });
    if (isMobile) await info.click();
    else await info.hover();
    await expect(infoBox).toContainText('Отчёты создаются автоматически по назначениям');
    if (isMobile) await page.keyboard.press('Escape');
    else await page.mouse.move(640, 600);
    await expect(infoBox).toBeHidden();

    // «?»: окно «Базы знаний» о модуле — описание и «Открыть Базу знаний».
    await page.getByRole('button', { name: 'Помощь' }).click();
    const help = page.getByRole('dialog', { name: 'Отчеты для сдачи' });
    await expect(help).toContainText('Главный рабочий модуль');
    await help.getByRole('link', { name: 'Открыть Базу знаний' }).click();
    await expect(page).toHaveURL(/\/app\/kb\/level$/);

    // Поиск по текущей вкладке очищается при смене вкладки; на телефоне поле раскрывает значок.
    await page.goto('/app/reports/week');
    if (isMobile) await page.getByRole('button', { name: 'Поиск', exact: true }).click();
    const search = page.getByRole('searchbox', { name: 'Поиск по текущей вкладке' });
    await search.fill('НДС');
    await page.getByRole('tab', { name: 'Просрочено' }).click();
    await expect(page).toHaveURL(/\/app\/reports\/overdue$/);
    await expect(search).toHaveValue('');

    if (isMobile) return; // Левой панели и дерева модулей на телефоне нет.

    // Кнопка панели сворачивает её до значков (прототип v85, docs/deviations.md п. О-76), раскрытая
    // ветка дерева — запоминаются.
    const side = page.getByRole('complementary', { name: 'Модули' });
    await page.getByRole('button', { name: 'Раскрыть вкладки: Отчеты для сдачи' }).click();
    await expect(side.getByRole('link', { name: 'Кто что сдаёт' })).toBeVisible();
    await page.getByRole('button', { name: 'Свернуть панель до значков' }).click();
    await expect(side.getByRole('link', { name: 'Кто что сдаёт' })).toBeHidden();
    await page.reload();
    await expect(side.getByRole('link', { name: 'Кто что сдаёт' })).toBeHidden();
    await page.getByRole('button', { name: 'Развернуть панель модулей' }).click();
    await expect(side.getByRole('link', { name: 'Кто что сдаёт' })).toBeVisible();
  });

  test('(прототип v85) кнопка панели на ПК сворачивает её до полоски значков 60 px, «На всю ширину» снимает предел 1640 px; выбор запоминается, на телефоне этих кнопок нет', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    await signIn(page.request, new URL(baseURL!).origin, 'erkin', DEMO_PASSWORD);
    await page.goto('/app/reports/week');
    const collapse = page.getByRole('button', { name: 'Свернуть панель до значков' });
    const widen = page.getByRole('button', { name: 'На всю ширину экрана' });
    if (isMobile) {
      // На телефоне — прежняя кнопка «Меню» (панель снизу), кнопки ширины нет.
      await expect(page.getByRole('button', { name: 'Меню', exact: true })).toBeVisible();
      await expect(collapse).toBeHidden();
      await expect(widen).toBeHidden();
      return;
    }

    const side = page.getByRole('complementary', { name: 'Модули' });
    const widthOf = (selector: string) =>
      page.evaluate(
        (s) => Math.round(document.querySelector(s)!.getBoundingClientRect().width),
        selector,
      );
    await expect(collapse).toHaveAttribute('aria-expanded', 'true');
    await expect(side.getByText('Buhuchet.kg')).toBeVisible();
    await expect.poll(() => widthOf('aside')).toBe(276);

    // Свёрнутая панель: полоска 60 px со значками, названий и стрелок нет, счётчик остаётся.
    await collapse.click();
    const expand = page.getByRole('button', { name: 'Развернуть панель модулей' });
    await expect(expand).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(() => widthOf('aside')).toBe(60);
    await expect(side).toBeVisible();
    await expect(side.getByText('Buhuchet.kg')).toBeHidden();
    await expect(
      page.getByRole('button', { name: /^(Раскрыть|Свернуть) вкладки: Отчеты для сдачи/ }),
    ).toBeHidden();
    // Значок модуля — ссылка с названием в подсказке: открывает модуль, панель остаётся свёрнутой.
    const contractors = side.getByRole('link', { name: /^Контрагенты/ });
    await expect(contractors).toHaveAttribute('title', 'Контрагенты');
    await contractors.click();
    await expect(page).toHaveURL(/\/app\/cps\//);
    await expect.poll(() => widthOf('aside')).toBe(60);
    await page.reload();
    await expect(expand).toBeVisible();
    await expect.poll(() => widthOf('aside')).toBe(60);
    // Организация и кнопки внизу — значками: «Выйти из аккаунта» по-прежнему доступна.
    await expect(side.getByRole('button', { name: 'Выйти из аккаунта' })).toBeVisible();
    await expand.click();
    await expect.poll(() => widthOf('aside')).toBe(276);
    await expect(side.getByText('Buhuchet.kg')).toBeVisible();

    // «На всю ширину»: на широком окне страница модуля ограничена 1640 px, кнопка снимает предел.
    await page.setViewportSize({ width: 2200, height: 900 });
    await expect.poll(() => widthOf('main > div')).toBe(1640);
    await expect(widen).toHaveAttribute('aria-pressed', 'false');
    await widen.click();
    const narrow = page.getByRole('button', { name: 'Обычная ширина: содержимое по центру' });
    await expect(narrow).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => widthOf('main > div')).toBeGreaterThan(1800);
    await page.reload();
    await expect(narrow).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => widthOf('main > div')).toBeGreaterThan(1800);
    await narrow.click();
    await expect(widen).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => widthOf('main > div')).toBe(1640);
  });

  test('без входа, с временным паролем и после выхода страницы за входом ведут на страницу входа', async ({
    page,
    playwright,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    // Страница входа помнит, куда вернуться после входа (задача #165).
    await page.goto('/app/reports/week');
    await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Freports%2Fweek$/);

    const owner = await playwright.request.newContext({ baseURL });
    await signIn(owner, origin, 'erkin', DEMO_PASSWORD);
    const roles = (await (await owner.get('/api/roles?size=all')).json()) as {
      items: { id: string; name: string }[];
    };
    const login = unique('e2e-shell');
    const hired = await owner.post('/api/staff', {
      headers: { origin },
      data: {
        fullName: 'Оболочкин Сквозной Тестович',
        login,
        roleId: roles.items.find((r) => r.name === 'Бухгалтер')!.id,
      },
    });
    expect(hired.status(), await hired.text()).toBe(201);
    const { temporaryPassword } = (await hired.json()) as { temporaryPassword: string };
    await owner.dispose();

    // Временный пароль не сменён — в программу не пускает.
    await signIn(page.request, origin, login, temporaryPassword);
    await page.goto('/app');
    await expect(page).toHaveURL(/\/login$/);

    const changed = await page.request.post('/api/auth/password', {
      headers: { origin },
      data: { currentPassword: temporaryPassword, newPassword: 'Свой-пароль-e2e-1' },
    });
    expect(changed.status()).toBe(200);
    await page.goto('/app');
    await expect(page).toHaveURL(/\/app\/home\/today$/);

    // «Выйти из аккаунта» — внизу левой панели на ПК, на телефоне — в панели «Меню».
    if (isMobile) await page.getByRole('button', { name: 'Меню' }).click();
    await page.getByRole('button', { name: 'Выйти из аккаунта' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/app/home/today');
    await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fhome%2Ftoday$/);
  });
});
