import { expect, test, type Locator, type Page } from '@playwright/test';
import { signIn, uniqueLogin } from './helpers';
import { orgWithTypes } from './orgs';
import { newContractor } from './reports';

// «Главная» → «Активность» (прототип v84, modules/activity.js) через настоящий сайт. Своя организация
// на каждый тест и проект (ПК и телефон): входы и действия демо-организации меняют другие тесты.

const MONTHS = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
];

/** День по Бишкеку со сдвигом в днях: «ДД.ММ.ГГГГ». */
function bishkekDay(shift = 0): string {
  const iso = new Date(Date.now() + 6 * 3600_000 + shift * 86_400_000).toISOString().slice(0, 10);
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

/** На телефоне «Статистика» по умолчанию скрыта — показать плашки. */
async function showStats(page: Page, screen: Locator, isMobile: boolean) {
  await expect(screen.locator('[data-activity-chart]')).toBeVisible();
  await expect(screen.locator('[data-grid] [data-id]').first()).toBeVisible();
  if (isMobile && (await screen.locator('[data-plates]').count()) === 0)
    await page.getByRole('button', { name: 'Статистика', exact: true }).click();
  await expect(screen.locator('[data-plates]')).toBeVisible();
}

/** Вкладка окна: на телефоне — список вкладок. */
async function toTab(page: Page, card: Locator, isMobile: boolean, name: RegExp) {
  if (isMobile) {
    await card.getByRole('tab', { selected: true }).click();
    await page.getByRole('menu').getByRole('menuitem', { name }).click();
  } else {
    await card.getByRole('tab', { name }).click();
  }
}

/** Владелец своей организации нанимает сотрудника с ролью; ответ — временный пароль. */
async function hireHere(page: Page, origin: string, login: string, roleName: string) {
  const roles = (await (await page.request.get('/api/roles?size=all')).json()) as {
    items: { id: string; name: string }[];
  };
  const res = await page.request.post('/api/staff', {
    headers: { origin },
    data: {
      fullName: 'Тихонов Сквозной Тестович',
      login,
      phone: null,
      roleId: roles.items.find((r) => r.name === roleName)!.id,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { temporaryPassword: string }).temporaryPassword;
}

test.describe('«Главная» → «Активность»', () => {
  test('(проверка прототипа v84) за месяц видно, кто работал: входы и действия владельца, у нового сотрудника — «не было»; «День» и «Раньше» листают период; окно сотрудника показывает дни и его контрагентов', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await orgWithTypes(page.request, origin, false);
    const name = `ИП Активность ${uniqueLogin('a')}`;
    await newContractor(page.request, origin, { name, tariff: false });
    await hireHere(page, origin, uniqueLogin('e2e-act'), 'Бухгалтер');

    await page.goto('/app/home/act');
    const screen = page.locator('[data-home-activity]');
    const label = screen.locator('[data-activity-label]');
    const today = bishkekDay();
    await expect(label).toHaveText(`${MONTHS[Number(today.slice(3, 5)) - 1]} ${today.slice(6)}`);

    // Плашки: работал один из двух, входы и действия владельца посчитаны.
    await showStats(page, screen, isMobile);
    const worked = screen.locator('[data-plate="a1"]');
    await expect(worked.locator('[data-plate-value]')).toContainText('1');
    await expect(worked).toContainText('из 2');
    const number = async (id: string) =>
      Number((await screen.locator(`[data-plate="${id}"] [data-plate-value]`).innerText()).trim());
    expect(await number('a2')).toBeGreaterThanOrEqual(1);
    expect(await number('a3')).toBeGreaterThanOrEqual(2);
    await expect(screen.locator('[data-plate="a4"]')).toContainText('все в срок');
    await expect(screen.locator('[data-activity-chart]')).toBeVisible();

    // Список: владелец с активностью — первым (по числу действий), новый сотрудник — «не было».
    const rows = screen.locator('[data-grid] [data-id]');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('Подборова Сквозная');
    await expect(rows.nth(0)).toContainText(today);
    await expect(rows.nth(1)).toContainText('Тихонов Сквозной Тестович');
    await expect(rows.nth(1)).toContainText('не было');

    // «День»: сегодня, графика нет; «Раньше» — вчера без активности; «К текущему» возвращает.
    await screen.getByRole('button', { name: 'День', exact: true }).click();
    await expect(label).toContainText(today);
    await expect(screen.locator('[data-activity-chart]')).toHaveCount(0);
    await expect(screen.locator('[data-activity-move="1"]')).toBeDisabled();
    await screen.locator('[data-activity-move="-1"]').click();
    await expect(label).toContainText(bishkekDay(-1));
    await expect(worked.locator('[data-plate-value]')).toContainText('0');
    await expect(rows.filter({ hasText: 'Подборова Сквозная' })).toContainText('не было');
    await screen.getByRole('button', { name: 'К текущему', exact: true }).click();
    await expect(label).toContainText(today);
    await expect(worked.locator('[data-plate-value]')).toContainText('1');

    // Окно сотрудника: день с первым входом и его контрагент; строка открывает карточку контрагента.
    await rows.filter({ hasText: 'Подборова Сквозная' }).click();
    const card = page.getByRole('dialog').filter({ hasText: 'Активность ·' });
    await expect(card).toContainText('Подборова Сквозная');
    await expect(card.locator('[data-mini-table]')).toContainText(today);
    await toTab(page, card, isMobile, /По контрагентам/);
    await expect(card.locator('[data-mini-table]')).toContainText(name);
    await expect(card.locator('[data-mini-table]')).not.toContainText('Прочие контрагенты');
    await card.locator('[data-mini-table]').getByText(name).click();
    await expect(page.getByRole('dialog').filter({ hasText: 'ИНН' }).last()).toContainText(name);
  });

  test('(проверка прототипа v84) без права «Смотреть аналитику по сотрудникам» вкладки «Активность» нет и данные не отдаются', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    await orgWithTypes(page.request, origin, false);
    const login = uniqueLogin('e2e-act');
    const temporary = await hireHere(page, origin, login, 'Бухгалтер');
    const staff = (await (await page.request.get('/api/staff?size=all')).json()) as {
      items: { id: string }[];
    };
    await page.request.post('/api/auth/logout', { headers: { origin } });
    await signIn(page.request, origin, login, temporary);
    const changed = await page.request.post('/api/auth/password', {
      headers: { origin },
      data: { currentPassword: temporary, newPassword: 'Свой-пароль-e2e-1' },
    });
    expect(changed.status(), await changed.text()).toBe(200);

    for (const path of [
      '/api/home/activity/summary?k=m&off=0',
      '/api/home/activity?k=m&off=0',
      '/api/home/activity/values?k=m&off=0&col=role',
      '/api/home/activity/export?k=m&off=0&cols=fio',
      `/api/home/activity/employees/${staff.items[0]!.id}?k=m&off=0`,
    ])
      expect((await page.request.get(path)).status(), path).toBe(403);

    await page.goto('/app/home/act');
    await expect(page.locator('[data-home-summary]')).toBeVisible();
    await expect(page.locator('[data-home-activity]')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Активность', exact: true })).toHaveCount(0);
  });
});
