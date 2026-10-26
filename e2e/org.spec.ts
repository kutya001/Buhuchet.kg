import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { DEMO_PASSWORD, signIn } from './helpers';

// «Моя организация» через настоящий сайт (Next.js → API) на демо-организации: методы API и экраны,
// которые общую запись не меняют. Сохранение адреса страницы, функций и настроек — в
// org.shared.spec.ts: те тесты идут после всех остальных и по одному.

const ORG_NAME = 'ОсОО «Бухгалтер Плюс»';

async function version(api: APIRequestContext, path: '/api/org' | '/api/org/policy') {
  const res = await api.get(path);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { version: number }).version;
}

/** Окно профиля организации: на ПК — из левой панели, на телефоне — из панели «Меню». */
async function openOrgProfile(page: Page, isMobile: boolean) {
  if (isMobile) {
    await page.getByRole('button', { name: 'Меню' }).click();
    await page.getByRole('dialog', { name: 'Меню' }).locator('[data-side-org]').click();
  } else {
    await page.getByRole('complementary', { name: 'Модули' }).locator('[data-side-org]').click();
  }
  const dialog = page.getByRole('dialog', { name: ORG_NAME });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('Этап 1: Моя организация', () => {
  test('бухгалтер видит профиль организации, но изменить не может (403)', async ({
    playwright,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const accountant = await playwright.request.newContext({ baseURL });
    await signIn(accountant, origin, 'alisher', DEMO_PASSWORD);
    const profile = await accountant.get('/api/org');
    expect(profile.status()).toBe(200);
    const body = (await profile.json()) as { name: string; slug: string; version: number };
    expect(body).toMatchObject({ name: ORG_NAME, slug: 'buhgalter-plyus' });

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
    const roles = await accountant.get('/api/org/role-options');
    expect(roles.status()).toBe(403);
    await accountant.dispose();
  });

  test('зарезервированный и неверный адрес страницы сервер отклоняет с понятной причиной', async ({
    playwright,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const owner = await playwright.request.newContext({ baseURL });
    await signIn(owner, origin, 'erkin', DEMO_PASSWORD);
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
    await owner.dispose();
  });

  test('бухгалтер видит «Мою организацию» только для просмотра: замок, без полей и кнопок сохранения', async ({
    page,
    baseURL,
  }) => {
    await signIn(page.request, new URL(baseURL!).origin, 'alisher', DEMO_PASSWORD);
    const main = page.locator('main');

    await page.goto('/app/org/main');
    await expect(
      main.getByText('Редактировать может только владелец организации.', { exact: false }),
    ).toBeVisible();
    await expect(main.getByText(ORG_NAME)).toBeVisible();
    await expect(main.getByText('01203201910123')).toBeVisible();
    await expect(main.getByRole('textbox')).toHaveCount(0);
    await expect(main.getByRole('button', { name: 'Сохранить' })).toHaveCount(0);

    await page.goto('/app/org/policy');
    await expect(main.getByText('Менять учётную политику может только владелец.')).toBeVisible();
    const switches = main.getByRole('switch');
    await expect(switches.first()).toBeVisible();
    expect(await switches.count()).toBeGreaterThan(10);
    for (const s of await switches.all()) await expect(s).toBeDisabled();
    // Дни напоминаний — без поля «+ день» и крестиков (прототип: только для чтения).
    await expect(main.locator('[data-chip]').first()).toBeVisible();
    await expect(main.getByRole('textbox', { name: 'Добавить день напоминания' })).toHaveCount(0);
    await expect(main.getByRole('button', { name: 'Убрать' })).toHaveCount(0);

    await page.goto('/app/org/settings');
    await expect(main.getByLabel('Часовой пояс')).toBeDisabled();
    await expect(main.getByLabel('Роль по умолчанию для новых сотрудников')).toHaveValue(/.+/);
    await expect(main.getByRole('button', { name: 'Сохранить настройки' })).toHaveCount(0);
  });

  test('владелец: «admin» в «Адресе страницы организации» подсвечен под полем и не сохраняется; логотип больше 2 МБ и не картинка — отказ', async ({
    page,
    baseURL,
  }) => {
    await signIn(page.request, new URL(baseURL!).origin, 'erkin', DEMO_PASSWORD);
    const before = await version(page.request, '/api/org');
    await page.goto('/app/org/main');
    const main = page.locator('main');
    const slug = main.getByLabel('Адрес страницы организации');
    await expect(slug).toHaveValue('buhgalter-plyus');

    // Причина видна сразу при вводе, сохранить нельзя: окна «Сменить адрес…» нет, запись та же.
    await slug.fill('admin');
    await expect(main.getByText('Этот адрес занят, выберите другой')).toBeVisible();
    await expect(slug).toHaveAttribute('aria-invalid', 'true');
    await main.getByRole('button', { name: 'Сохранить' }).click();
    await expect(slug).toBeFocused();
    await expect(
      page.getByRole('dialog', { name: 'Сменить адрес страницы организации?' }),
    ).toHaveCount(0);
    await slug.fill('Не адрес');
    await expect(
      main.getByText('3–30 символов: строчные латинские буквы, цифры и дефис').last(),
    ).toBeVisible();
    await slug.fill('buhgalter-plyus');
    await expect(slug).not.toHaveAttribute('aria-invalid');

    const logo = main.getByLabel('Логотип');
    await logo.setInputFiles({
      name: 'big.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(2 * 1024 * 1024 + 1),
    });
    await expect(main.getByText('Файл больше 2 МБ')).toBeVisible();
    await logo.setInputFiles({ name: 'logo.gif', mimeType: 'image/gif', buffer: Buffer.alloc(10) });
    await expect(main.getByText('Логотип — картинка PNG или JPG')).toBeVisible();
    await main.getByRole('button', { name: 'Сохранить' }).click();
    await expect(logo).toBeFocused();
    expect(await version(page.request, '/api/org')).toBe(before);
  });

  test('профиль организации открывается из левой панели (на телефоне — из «Меню»); «Редактировать» ведёт на «Основное»', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    await page.goto('/app/reports/week');
    const dialog = await openOrgProfile(page, isMobile);
    await expect(dialog).toContainText('Профиль организации · только просмотр');
    await expect(dialog).toContainText('01203201910123');
    await expect(dialog).toContainText('buhgalter-plyus');
    await expect(dialog).toContainText('На платформе с');
    await dialog.getByRole('button', { name: 'Редактировать' }).click();
    await expect(page).toHaveURL(/\/app\/org\/main$/);
    await expect(dialog).toBeHidden();
    await expect(page.locator('main').getByLabel('Название')).toHaveValue(ORG_NAME);

    // Без права «Настройки и учётная политика» — только «Закрыть».
    await page.goto('about:blank');
    await signIn(page.request, origin, 'alisher', DEMO_PASSWORD);
    await page.goto('/app/reports/week');
    const view = await openOrgProfile(page, isMobile);
    await expect(view.getByRole('button', { name: 'Редактировать' })).toHaveCount(0);
    await view.getByRole('button', { name: 'Закрыть', exact: true }).last().click();
    await expect(view).toBeHidden();
    await expect(page).toHaveURL(/\/app\/reports\/week$/);
  });
});
