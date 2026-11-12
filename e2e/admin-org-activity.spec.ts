import { expect, test } from '@playwright/test';
import { ownerPassword, platformAdmin, search, uniqueInn } from './admin';
import { signIn, uniqueLogin } from './helpers';
import { newContractor } from './reports';

// Админка → «Организации» → «Активность» (прототип v84, modules/activity.js — `renderOrgAct`) через
// настоящий сайт. Администратор и организация — свои на каждый тест и проект (ПК и телефон).

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

const PATHS = [
  '/api/admin/org-activity/summary?k=m&off=0',
  '/api/admin/org-activity?k=m&off=0',
  '/api/admin/org-activity/values?k=m&off=0&col=st',
  '/api/admin/org-activity/export?k=m&off=0&cols=name,n',
];

test.describe('Админка: «Активность» организаций', () => {
  test('(проверка прототипа v84) администратор видит числа организаций за период: плашки, столбики, список; строка открывает карточку организации, блокировка из неё сразу видна в списке; сотруднику организации данные не отдаются', async ({
    page,
    baseURL,
    isMobile,
    playwright,
  }) => {
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    // Новая организация: владелец входит и заводит контрагента — вход, действие и новый контрагент.
    const owner = uniqueLogin('e2e-oa');
    const name = `ОсОО «${owner}»`;
    const temporary = ownerPassword();
    const created = await page.request.post('/api/admin/organizations', {
      headers: { origin },
      data: {
        name,
        inn: uniqueInn(),
        ownerFullName: 'Активнова Сквозная',
        ownerLogin: owner,
        temporaryPassword: temporary,
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const ownerApi = await playwright.request.newContext({ baseURL });
    await signIn(ownerApi, origin, owner, temporary);
    const changed = await ownerApi.post('/api/auth/password', {
      headers: { origin },
      data: { currentPassword: temporary, newPassword: ownerPassword() },
    });
    expect(changed.status(), await changed.text()).toBe(200);
    const contractor = `ИП Активность ${uniqueLogin('c')}`;
    await newContractor(ownerApi, origin, { name: contractor, tariff: false });
    // Сотруднику организации (даже владельцу) методы Админки не отвечают.
    for (const path of PATHS) expect((await ownerApi.get(path)).status(), path).toBe(403);
    await ownerApi.dispose();

    await page.goto('/app/orgs/act');
    const screen = page.locator('[data-orgs-activity]');
    const label = screen.locator('[data-activity-label]');
    const today = bishkekDay();
    await expect(label).toHaveText(`${MONTHS[Number(today.slice(3, 5)) - 1]} ${today.slice(6)}`);
    await expect(screen.locator('[data-activity-chart]')).toBeVisible();
    const rows = screen.locator('[data-grid] [data-id]');
    await expect(rows.first()).toBeVisible();

    // Плашки: на телефоне «Статистика» по умолчанию скрыта.
    if (isMobile && (await screen.locator('[data-plates]').count()) === 0)
      await page.getByRole('button', { name: 'Статистика', exact: true }).click();
    const withActivity = screen.locator('[data-plate="o1"]');
    await expect(withActivity).toContainText('Организаций с активностью');
    await expect(withActivity).toContainText('из ');
    // Значение плашки без подписи единицы («22 из 31» → 22) и пробелов между разрядами.
    const number = async (id: string) =>
      parseInt(
        (await screen.locator(`[data-plate="${id}"] [data-plate-value]`).innerText()).replace(
          /\s/g,
          '',
        ),
        10,
      );
    expect(await number('o1')).toBeGreaterThanOrEqual(1);
    expect(await number('o2')).toBeGreaterThanOrEqual(1);
    expect(await number('o3')).toBeGreaterThanOrEqual(1);
    expect(await number('o4')).toBeGreaterThanOrEqual(1);
    await expect(screen.locator('[data-plate="o5"]')).toContainText('новых контрагентов:');

    // Список: организация с сегодняшней активностью; ни сотрудников, ни контрагентов в нём нет.
    await search(page, isMobile, name);
    const row = rows.filter({ hasText: name });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Активна');
    await expect(row).toContainText(today);
    await expect(screen).not.toContainText(contractor);
    await expect(screen).not.toContainText('Активнова Сквозная');

    // «День»: сегодня, графика нет; «Раньше» — вчера организации ещё не было; «К текущему» возвращает.
    await screen.getByRole('button', { name: 'День', exact: true }).click();
    await expect(label).toContainText(today);
    await expect(screen.locator('[data-activity-chart]')).toHaveCount(0);
    await expect(screen.locator('[data-activity-move="1"]')).toBeDisabled();
    await screen.locator('[data-activity-move="-1"]').click();
    await expect(label).toContainText(bishkekDay(-1));
    await expect(row).toContainText('не было');
    await screen.getByRole('button', { name: 'К текущему', exact: true }).click();
    await expect(label).toContainText(today);
    await expect(row).toContainText(today);

    // Пункт меню строки «Открыть карточку» и нажатие на строку открывают карточку организации.
    await row.locator('[data-row-menu]').click();
    await page
      .getByRole('menu', { name: 'Действия' })
      .getByRole('menuitem', { name: 'Открыть карточку' })
      .click();
    const card = page.getByRole('dialog').filter({ hasText: name });
    await expect(card).toBeVisible();
    await expect(card).toContainText('Активнова Сквозная');
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();
    await row.click();
    await expect(card).toBeVisible();

    // «Заблокировать» в шапке карточки: строка списка под ней сразу «Заблокирована».
    await card.locator('[data-org-action="block"]').click();
    const ask = page.getByRole('dialog', { name: `Заблокировать ${name}?` });
    await ask.getByRole('button', { name: 'Заблокировать' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Организация заблокирована' }),
    ).toBeVisible();
    await expect(row).toContainText('Заблокирована');
  });
});
