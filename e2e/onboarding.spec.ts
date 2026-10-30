import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { newOrgOwner } from './helpers';

// Первый запуск организации: приветствие, опросник владельца, «Выбор налогов» (задача 2.33). Каждый
// тест — со своей новой организацией (`newOrgOwner`: у неё есть приветствие, демо-организация не
// меняется). Приветствие открывается только сразу после входа через страницу входа.

const PASSWORD = 'Свой-пароль-e2e-1';

/** Выйти из сеанса API и войти через страницу входа: после неё открывается приветствие. */
async function logIn(page: Page, origin: string, login: string) {
  await page.request.post('/api/auth/logout', { headers: { origin } });
  await page.goto('/login');
  await page.getByLabel('Логин').fill(login);
  await page.getByLabel('Пароль', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForURL(/\/app\//);
}

const welcome = (page: Page) => page.getByRole('dialog', { name: 'Приветствие' });

/** «Далее» до экрана; на каждом шаге — «N из M». */
async function next(page: Page, label = 'Далее') {
  await welcome(page).getByRole('button', { name: label, exact: true }).click();
}

const moduleLinks = (page: Page, moduleId: string) =>
  page.locator(`aside a[href^="/app/${moduleId}"]`);

type Settings = { items: { code: string; enabled: boolean; remindDays: number[] }[] };

async function connected(api: APIRequestContext) {
  const res = await api.get('/api/org-report-types/settings');
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as Settings).items.filter((x) => x.enabled);
}

async function stepDone(api: APIRequestContext, id: string) {
  const res = await api.get('/api/kb/me');
  expect(res.status(), await res.text()).toBe(200);
  const me = (await res.json()) as {
    lessons: { steps: { id: string; done: { how: string } | null }[] }[];
  };
  return me.lessons.flatMap((l) => l.steps).find((s) => s.id === id)?.done ?? null;
}

test.describe('Этап 2: приветствие и опросник', () => {
  // Новая организация (`pnpm db:create-org`) и вход через страницу входа — несколько раз за тест.
  test.describe.configure({ timeout: 120_000 });

  test('(п. 47) владелец новой организации видит приветствие из 6 экранов; «Нет» на проекты и показатели, «Да» на деньги — после «Применить» в меню «Финансовые операции», нет «Проектов» и «Показателей», в истории «по опроснику»', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const login = await newOrgOwner(page.request, origin);
    await logIn(page, origin, login);

    const w = welcome(page);
    await expect(w).toBeVisible();
    await expect(w).toContainText('1 из 6');
    await expect(w.getByRole('heading', { name: 'Добро пожаловать в Buhuchet.kg' })).toBeVisible();
    // Вместо «Что нового»: в этот вход его нет.
    await expect(page.locator('[data-whats-new]')).toHaveCount(0);
    await expect(w.getByRole('button', { name: 'Позже' })).toBeVisible();

    await next(page);
    await expect(w).toContainText('2 из 6');
    await expect(w.getByRole('heading', { name: 'Модули программы' })).toBeVisible();
    await expect(w.locator('[data-welcome-mod="reports"]')).toContainText('Включён всегда');
    await expect(w.locator('[data-welcome-mod="projects"]')).toContainText('Можно включить');
    await expect(w.locator('[data-welcome-mod="tasks"]')).toContainText(
      'Включён · можно выключить',
    );

    await next(page);
    await expect(w).toContainText('3 из 6');
    // «Позже» — только до опросника.
    await expect(w.getByRole('button', { name: 'Позже' })).toHaveCount(0);
    const answer = async (id: string, value: 'Да' | 'Нет') =>
      w
        .locator(`[data-quiz-question="${id}"]`)
        .getByRole('button', { name: value, exact: true })
        .click();
    await answer('q-proj', 'Нет');
    await answer('q-kpi', 'Нет');
    await answer('q-money', 'Да');
    // При «Да» на деньги появляется подвопрос о виртуальных счетах.
    await expect(w.locator('[data-quiz-question="q-acc"]')).toBeVisible();

    await next(page, 'Далее: что будет включено');
    await expect(w).toContainText('4 из 6');
    const on = w.locator('[data-plan-on]');
    await expect(on).toContainText('Учёт оплаты налогов');
    await expect(on).toContainText('Финансовые операции по контрагентам');
    const off = w.locator('[data-plan-off]');
    await expect(off).toContainText('Проекты контрагентов');
    await expect(off).toContainText('Показатели контрагентов');
    await w.getByRole('button', { name: 'Применить' }).click();

    await expect(w).toContainText('5 из 6');
    await expect(w.getByRole('heading', { name: 'С чего начать' })).toBeVisible();
    await expect(w.locator('[data-welcome-step]')).toHaveCount(3);
    await next(page, 'Далее: выбор налогов');
    await expect(w).toContainText('6 из 6');
    await expect(w.getByRole('heading', { name: 'Выбор налогов' })).toBeVisible();
    await w.getByRole('button', { name: 'Пропустить' }).click();
    await expect(w).toHaveCount(0);

    await expect(moduleLinks(page, 'fin').first()).toBeAttached();
    await expect(moduleLinks(page, 'projects')).toHaveCount(0);
    await expect(moduleLinks(page, 'kpi')).toHaveCount(0);

    await page.goto('/app/org/policy');
    const main = page.locator('main');
    await expect(main.getByText(/Учётная политика по опроснику: включены/)).toContainText(
      '«Учёт оплаты налогов», «Финансовые операции по контрагентам»',
    );

    // «Пройти опросник заново»: ответы — по текущей политике, без изменений ничего не меняется.
    await main.getByRole('button', { name: 'Пройти опросник заново' }).click();
    await expect(w).toContainText('1 из 2');
    await expect(w.getByRole('heading', { name: 'Опросник учётной политики' })).toBeVisible();
    await expect(
      w.locator('[data-quiz-question="q-money"]').getByRole('button', { name: 'Да', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await next(page, 'Далее: что будет включено');
    await w.getByRole('button', { name: 'Применить' }).click();
    await expect(w).toHaveCount(0);
    await expect(page.getByText('Изменений нет: учётная политика не изменилась')).toBeVisible();
    await expect(
      main.getByText('Учётная политика по опроснику (пройден заново): без изменений'),
    ).toBeVisible();

    // Опросник пройден: при следующем входе приветствие не открывается.
    await logIn(page, origin, login);
    await expect(page.locator('main')).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(w).toHaveCount(0);

    // «База знаний» → «Мой уровень» → «Приветствие и обзор модулей»: три экрана, без опросника.
    await page.goto('/app/kb/level');
    await page.getByRole('button', { name: 'Открыть', exact: true }).click();
    await expect(w).toContainText('1 из 3');
    await expect(w.getByRole('button', { name: 'Позже' })).toHaveCount(0);
    await next(page);
    await next(page);
    await expect(w.getByRole('button', { name: 'Осмотреться самому' })).toBeVisible();
    await w.getByRole('button', { name: 'Начать обучение' }).click();
    await expect(page).toHaveURL(/\/app\/kb\/lessons/);
    await expect(w).toHaveCount(0);
  });

  test('(п. 50) «Отметить основные», группа «Статистика» и «Подключить и начать обучение» — виды подключены с напоминаниями за 7 и 3 дня, шаг «Подключить виды отчётов» засчитан; «Пропустить» ничего не подключает', async ({
    page,
    playwright,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const login = await newOrgOwner(page.request, origin);
    await logIn(page, origin, login);
    const w = welcome(page);
    await expect(w).toContainText('1 из 6');
    await next(page);
    await next(page);
    await next(page, 'Далее: что будет включено');
    await w.getByRole('button', { name: 'Применить' }).click();
    await next(page, 'Далее: выбор налогов');

    // Изначально ничего не отмечено, кнопки «Подключить…» недоступны.
    await expect(w.locator('[data-welcome-taxes]')).toContainText('Выбрано: 0');
    const learn = w.getByRole('button', { name: 'Подключить и начать обучение' });
    await expect(learn).toBeDisabled();
    await w.getByRole('button', { name: 'Отметить основные' }).click();
    await expect(
      page.getByText('Отмечены основные: ОНР, единый налог, ЕНД и STI-161'),
    ).toBeVisible();
    const stat = w.locator('[data-tx-group="stat"]');
    await stat.getByLabel('Выбрать всю группу').check();
    await expect(stat.locator('[data-tx-count]')).toContainText(/Выбрано (\d+) из \1/);
    const picked = Number((await w.locator('[data-welcome-taxes] b').textContent())?.trim() ?? '0');
    expect(picked).toBeGreaterThan(4);
    await learn.click();

    await expect(page).toHaveURL(/\/app\/kb\/lessons/);
    await expect(page.getByText(`Подключено видов отчётов: ${picked}`)).toBeVisible();
    const types = await connected(page.request);
    expect(types).toHaveLength(picked);
    expect(types.map((x) => x.code)).toEqual(expect.arrayContaining(['endo', 'soc']));
    for (const x of types) expect(x.remindDays).toEqual([7, 3]);
    await expect.poll(() => stepDone(page.request, 'types')).not.toBeNull();

    // Другая новая организация: «Пропустить» — ничего не подключено.
    const other = await playwright.request.newContext({ baseURL });
    const second = await newOrgOwner(other, origin);
    await other.dispose();
    await logIn(page, origin, second);
    await expect(w).toContainText('1 из 6');
    await next(page);
    await next(page);
    await next(page, 'Далее: что будет включено');
    await w.getByRole('button', { name: 'Применить' }).click();
    await next(page, 'Далее: выбор налогов');
    await w.getByRole('button', { name: 'Пропустить' }).click();
    await expect(w).toHaveCount(0);
    await expect(
      page.getByText(
        'Налоги можно выбрать позже: «Справочники» → «Виды отчётов» → «Подключить из каталога»',
      ),
    ).toBeVisible();
    expect(await connected(page.request)).toEqual([]);
  });

  test('«Позже» откладывает опросник; сотрудник при первом входе видит три экрана без опросника, при втором — ничего', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const owner = await newOrgOwner(page.request, origin);
    const roles = (await (await page.request.get('/api/roles?size=all')).json()) as {
      items: { id: string; name: string }[];
    };
    const staffLogin = `${owner}-acc`;
    const hired = await page.request.post('/api/staff', {
      headers: { origin },
      data: {
        fullName: 'Сотрудникова Сквозная Тестовна',
        login: staffLogin,
        roleId: roles.items.find((r) => r.name === 'Бухгалтер')!.id,
      },
    });
    expect(hired.status(), await hired.text()).toBe(201);
    const { temporaryPassword } = (await hired.json()) as { temporaryPassword: string };

    await logIn(page, origin, owner);
    const w = welcome(page);
    await expect(w).toContainText('1 из 6');
    await w.getByRole('button', { name: 'Позже' }).click();
    await expect(w).toHaveCount(0);
    await expect(
      page.getByText('Опросник можно пройти позже: «Моя организация» → «Учётная политика»'),
    ).toBeVisible();
    // Опросник отложен: при следующем входе приветствие само не открывается.
    await logIn(page, origin, owner);
    await page.waitForTimeout(1000);
    await expect(w).toHaveCount(0);
    await page.goto('/app/org/policy');
    await expect(
      page.locator('main').getByRole('button', { name: 'Пройти опросник' }),
    ).toBeVisible();

    // Сотрудник: сменил временный пароль и входит через страницу входа.
    await page.request.post('/api/auth/logout', { headers: { origin } });
    await page.request.post('/api/auth/login', {
      headers: { origin },
      data: { login: staffLogin, password: temporaryPassword },
    });
    const changed = await page.request.post('/api/auth/password', {
      headers: { origin },
      data: { currentPassword: temporaryPassword, newPassword: PASSWORD },
    });
    expect(changed.status(), await changed.text()).toBe(200);
    await logIn(page, origin, staffLogin);
    await expect(w).toContainText('1 из 3');
    await expect(w.getByRole('button', { name: 'Позже' })).toHaveCount(0);
    await next(page);
    await expect(w.getByRole('heading', { name: 'Модули программы' })).toBeVisible();
    // Только свои модули и без отметок «Включён всегда» / «Можно включить».
    await expect(w.locator('[data-welcome-mod="reports"]')).toBeVisible();
    await expect(w.locator('[data-welcome-mod="projects"]')).toHaveCount(0);
    await expect(w).not.toContainText('Включён всегда');
    await next(page);
    await expect(w.getByRole('heading', { name: 'С чего начать' })).toBeVisible();
    await w.getByRole('button', { name: 'Осмотреться самому' }).click();
    await expect(w).toHaveCount(0);
    await expect(page).toHaveURL(/\/app\/home/);

    await logIn(page, origin, staffLogin);
    await page.waitForTimeout(1000);
    await expect(w).toHaveCount(0);
  });
});
