import { randomBytes } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { DEMO_PASSWORD, signIn } from './helpers';
import { orgWithTypes } from './orgs';

// «Моя организация» → «Настройки» → «Внешний доступ по API» и модуль «Витрина данных» в меню
// организации (доработки 20.11.2026: Витрина данных, блок 5, пункт 9; «Как проверить…» → «Токены и
// внешний адрес», «Права и вывод»; общий план 20.11, этап 3, П2; прототип v155 `dmApiBox`,
// `dmApiMount`). Выключатель меняется только в своей организации теста: у демо-организации он недоступен,
// её учётную политику тест не трогает.

type Texts = Record<string, string>;

/** Тексты словаря интерфейса (`GET /api/l10n`): тест не копирует строки экрана. */
async function dictionary(api: APIRequestContext): Promise<Texts> {
  const res = await api.get('/api/l10n');
  expect(res.status()).toBe(200);
  return ((await res.json()) as { texts: Texts }).texts;
}

const uniqueWord = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;

/** Ссылки меню на модуль в разметке страницы (левая панель; на телефоне она скрыта, но в разметке). */
const moduleLinks = (page: Page, moduleId: string) =>
  page.locator(`aside a[href^="/app/${moduleId}"]`);

/** Ответ сохранения учётной политики — ожидание ставится до нажатия. */
const policySaved = (page: Page) =>
  page.waitForResponse(
    (r) => r.url().endsWith('/api/org/policy') && r.request().method() === 'PATCH',
  );

test.describe('Витрина данных: «Внешний доступ по API» и модуль в меню организации', () => {
  test('(Витрина данных, «Токены и внешний адрес») «Внешний доступ по API» выключен — выпуск токенов недоступен; владелец включает его в «Моя организация» — выпуск доступен; выключение при действующем токене — с вопросом, токен остановлен', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    await orgWithTypes(page.request, origin, false);
    const tx = await dictionary(page.request);

    // Сначала выключен: «API Токены» — красная строка и «Открыть настройки», выпуск — отказ.
    await page.goto('/app/dm/tok');
    const apiOff = page.getByText(tx['dm.tok.api_off']!);
    await expect(apiOff).toBeVisible();
    const refused = await page.request.post('/api/dm/tokens', {
      headers: { origin },
      data: { templateId: crypto.randomUUID(), name: uniqueWord('Токен'), term: 30 },
    });
    expect(refused.status()).toBe(403);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
      'dm_token_api_off',
    );
    await page.getByRole('button', { name: tx['dm.tok.api_off_open'] }).click();
    await expect(page).toHaveURL(/\/app\/org\/settings$/);

    const box = page.locator('[data-ext-api]');
    const toggle = box.locator('[data-ext-api-switch]').getByRole('switch');
    await expect(box).toContainText(tx['dm.api.own']!);
    await expect(toggle).not.toBeChecked();
    await expect(toggle).toBeEnabled();
    const on = policySaved(page);
    await toggle.click();
    expect((await on).status()).toBe(200);
    await expect(page.getByRole('status').filter({ hasText: tx['dm.api.on_done']! })).toBeVisible();
    await expect(toggle).toBeChecked();

    // Включён — выпуск доступен.
    const form = (await (await page.request.get('/api/dm/tokens/form')).json()) as {
      refusal: string | null;
      apiOff: boolean;
      templates: { id: string }[];
    };
    expect(form).toMatchObject({ refusal: null, apiOff: false });
    expect(form.templates.length).toBeGreaterThan(0);
    const issued = await page.request.post('/api/dm/tokens', {
      headers: { origin },
      data: { templateId: form.templates[0]!.id, name: uniqueWord('Токен'), term: 30 },
    });
    expect(issued.status(), await issued.text()).toBe(201);
    const tokenId = ((await issued.json()) as { item: { id: string } }).item.id;

    // Подпись — с числом действующих токенов; выключение спрашивает.
    await page.reload();
    await expect(box).toContainText(tx['dm.api.live']!.replace('{n}', '1'));
    await toggle.click();
    const ask = page.getByRole('dialog', { name: tx['dm.api.off_title'] });
    await expect(ask).toContainText(tx['dm.api.off_text']!.replace('{n}', '1'));
    const off = policySaved(page);
    await ask.getByRole('button', { name: tx['dm.api.off_ok'] }).click();
    expect((await off).status()).toBe(200);
    await expect(
      page.getByRole('status').filter({ hasText: tx['dm.api.off_done']! }),
    ).toBeVisible();
    await expect(toggle).not.toBeChecked();
    await expect(box).not.toContainText(tx['dm.api.live']!.replace('{n}', '1'));

    // Токен остановлен, а не отозван; «API Токены» — снова красная строка.
    const card = (await (await page.request.get(`/api/dm/tokens/${tokenId}`)).json()) as {
      state: string;
      stop: string | null;
    };
    expect(card).toMatchObject({ state: 'stopped', stop: 'api_off' });
    await page.goto('/app/dm/tok');
    await expect(apiOff).toBeVisible();
  });

  test('(Витрина данных, «Права и вывод») «Витрина данных» — в меню организации у владельца, без права «Смотреть витрину данных» модуля нет; в демо-организации выключатель недоступен', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const tx = await dictionary(page.request);

    // Владелец демо-организации: модуль в меню, выключатель — только для просмотра с пометкой демо.
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    await page.goto('/app/org/settings');
    await expect(moduleLinks(page, 'dm')).toHaveCount(1);
    const box = page.locator('[data-ext-api]');
    await expect(box).toContainText(tx['dm.api.demo']!);
    await expect(box.locator('[data-ext-api-switch]').getByRole('switch')).toBeDisabled();

    // Бухгалтер (в стандартной роли права на витрину нет): модуля нет в меню, блок — только для
    // просмотра, адрес модуля — не открывается.
    await page.goto('about:blank');
    await signIn(page.request, origin, 'alisher', DEMO_PASSWORD);
    await page.goto('/app/org/settings');
    await expect(page.locator('[data-ext-api]')).toBeVisible();
    await expect(moduleLinks(page, 'dm')).toHaveCount(0);
    await expect(
      page.locator('[data-ext-api]').locator('[data-ext-api-switch]').getByRole('switch'),
    ).toBeDisabled();
    const me = (await (await page.request.get('/api/auth/me')).json()) as { modules: string[] };
    expect(me.modules).not.toContain('dm');
  });
});
