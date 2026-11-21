import { randomBytes } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from '@playwright/test';
import { platformAdmin } from './admin';
import { DEMO_PASSWORD, signIn, stillElement } from './helpers';
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
  test('(Витрина данных, «Токены и внешний адрес») «Внешний доступ по API» выключен — выпуск токенов недоступен; владелец включает его в «Моя организация» — выпуск доступен; выключение при действующем токене — с вопросом, токен остановлен; после включения снова отвечает; строка колокольчика «Создан API-токен» открывает окно токена', async ({
    page,
    baseURL,
    playwright,
  }) => {
    // Длинный сценарий: своя организация (вход администратора, создание, смена пароля), шесть
    // переходов по страницам и три обращения к внешнему адресу.
    test.slow();
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
      templates: { id: string; code: string }[];
    };
    expect(form).toMatchObject({ refusal: null, apiOff: false });
    expect(form.templates.length).toBeGreaterThan(0);
    // Готовый шаблон «Контрагенты» — без параметров и функций учётной политики.
    const template = form.templates.find((x) => x.code === 'contractors')!;
    expect(template, 'готовый шаблон «contractors»').toBeTruthy();
    const tokenName = uniqueWord('Токен');
    const issued = await page.request.post('/api/dm/tokens', {
      headers: { origin },
      data: { templateId: template.id, name: tokenName, term: 30 },
    });
    expect(issued.status(), await issued.text()).toBe(201);
    const { token, item } = (await issued.json()) as { token: string; item: { id: string } };
    const tokenId = item.id;
    // Внешняя программа — без cookie входа, токен в заголовке.
    const ext = await playwright.request.newContext({ baseURL });
    // У внешнего адреса одно место на всю платформу (`DM_EXT_RUNS_PLATFORM`): занято запросом другого
    // теста — 429 после ожидания очереди, тогда спрашиваем снова; любой другой ответ — итог.
    const askExt = async () => {
      let res!: APIResponse;
      await expect
        .poll(
          async () => {
            res = await ext.get(`/api/ext/v1/${template.code}`, {
              headers: { authorization: `Bearer ${token}` },
            });
            return res.status();
          },
          { timeout: 20_000 },
        )
        .not.toBe(429);
      return res;
    };
    const tokenState = async () =>
      (await (await page.request.get(`/api/dm/tokens/${tokenId}`)).json()) as {
        state: string;
        stop: string | null;
      };
    try {
      const answered = await askExt();
      expect(answered.status(), await answered.text()).toBe(200);

      // Токен выпущен мимо экрана, страница не перезагружалась: число действующих токенов
      // перечитывается в момент нажатия — выключение спрашивает с «1».
      await toggle.click();
      const ask = page.getByRole('dialog', { name: tx['dm.api.off_title'] });
      await expect(ask).toContainText(tx['dm.api.off_text']!.replace('{n}', '1'));
      await page.keyboard.press('Escape');
      await expect(ask).toBeHidden();
      await expect(toggle).toBeChecked();
      // Подпись — с тем же числом; второе нажатие — снова вопрос, «Выключить».
      await expect(box).toContainText(tx['dm.api.live']!.replace('{n}', '1'));
      await toggle.click();
      await expect(ask).toContainText(tx['dm.api.off_text']!.replace('{n}', '1'));
      const offButton = ask.getByRole('button', { name: tx['dm.api.off_ok'] });
      // На телефоне окно въезжает шторкой: нажатие по движущейся кнопке теряется (№ 34).
      await stillElement(offButton);
      const off = policySaved(page);
      await offButton.click();
      expect((await off).status()).toBe(200);
      await expect(
        page.getByRole('status').filter({ hasText: tx['dm.api.off_done']! }),
      ).toBeVisible();
      await expect(toggle).not.toBeChecked();
      await expect(box).not.toContainText(tx['dm.api.live']!.replace('{n}', '1'));

      // Токен остановлен, а не отозван: внешний адрес — «Доступ остановлен»; «API Токены» — снова
      // красная строка.
      expect(await tokenState()).toMatchObject({ state: 'stopped', stop: 'api_off' });
      const stopped = await askExt();
      expect(stopped.status()).toBe(403);
      expect(
        ((await stopped.json()) as { error: { code: string; message: string } }).error,
      ).toMatchObject({
        code: 'dm_ext_stopped',
        message: tx['err.dm_ext_stopped'],
      });
      await page.goto('/app/dm/tok');
      await expect(apiOff).toBeVisible();

      // Владелец включает снова — тот же токен «Действует» и отвечает.
      await page.getByRole('button', { name: tx['dm.tok.api_off_open'] }).click();
      await expect(page).toHaveURL(/\/app\/org\/settings$/);
      await expect(toggle).not.toBeChecked();
      const again = policySaved(page);
      await toggle.click();
      expect((await again).status()).toBe(200);
      await expect(toggle).toBeChecked();
      expect(await tokenState()).toMatchObject({ state: 'active', stop: null });
      const back = await askExt();
      expect(back.status(), await back.text()).toBe(200);

      // Строка колокольчика владельца «Создан API-токен» (этап 3, П5) — окно этого токена на вкладке
      // «API Токены»: модуль «Витрина данных» теперь в меню организации (этап 3, П2).
      const seen = page.waitForResponse(
        (r) => new URL(r.url()).pathname === '/api/bell/seen' && r.request().method() === 'POST',
      );
      await page.locator('[data-bell]').click();
      const panel = page.locator('[data-bell-panel]');
      await expect(panel).toBeVisible();
      expect((await seen).status()).toBe(200);
      const row = panel.locator('[data-bell-row]').filter({ hasText: tokenName });
      await expect(row).toHaveCount(1);
      // На телефоне панель въезжает шторкой (№ 34).
      await stillElement(row);
      await row.click();
      await expect(panel).toBeHidden();
      await expect(page).toHaveURL(/\/app\/dm\/tok/);
      const card = page.getByRole('dialog', { name: tokenName });
      await expect(card.locator('[data-dm-card]')).toBeVisible();
      await expect(page).not.toHaveURL(/[?&]tok=/);
    } finally {
      await ext.dispose();
    }
  });

  test('(Витрина данных, «Админка») «Отозвать» в Админке останавливает токен организации: внешний адрес — «Токен не подходит или истёк», владельцу — строка колокольчика «API-токен отозван» (отозвал: Администратор платформы), она открывает окно токена «Отозван»', async ({
    page,
    baseURL,
    browser,
    playwright,
  }) => {
    // Длинный сценарий: своя организация (вход администратора, создание, смена пароля), второй браузер
    // администратора платформы и обращение к внешнему адресу.
    test.slow();
    const origin = new URL(baseURL!).origin;
    await orgWithTypes(page.request, origin, false);
    const tx = await dictionary(page.request);

    // Владелец своей организации: «Внешний доступ по API» включён, токен выпущен (экраны выпуска
    // проверяет первый тест файла).
    const policy = (await (await page.request.get('/api/org/policy')).json()) as {
      version: number;
    };
    const on = await page.request.patch('/api/org/policy', {
      headers: { origin },
      data: { version: policy.version, extApi: true },
    });
    expect(on.status(), await on.text()).toBe(200);
    const form = (await (await page.request.get('/api/dm/tokens/form')).json()) as {
      templates: { id: string; code: string }[];
    };
    const template = form.templates.find((x) => x.code === 'contractors')!;
    expect(template, 'готовый шаблон «contractors»').toBeTruthy();
    const tokenName = uniqueWord('Отзыв');
    const issued = await page.request.post('/api/dm/tokens', {
      headers: { origin },
      data: { templateId: template.id, name: tokenName, term: 30 },
    });
    expect(issued.status(), await issued.text()).toBe(201);
    const { token, item } = (await issued.json()) as { token: string; item: { id: string } };

    const admin = await browser.newContext({ baseURL });
    const ext = await playwright.request.newContext({ baseURL });
    try {
      // Администратор платформы — своим браузером: окно токена организации по ссылке `?tok=`,
      // «Отозвать» и подтверждение.
      const adminPage = await admin.newPage();
      await platformAdmin(adminPage.request, origin);
      await adminPage.goto(`/app/dm/tok?tok=${item.id}`);
      const adminCard = adminPage.getByRole('dialog', { name: tokenName });
      await expect(adminCard.locator('[data-dm-card]')).toBeVisible();
      // Окно Админки — того же проекта: на телефоне окно токена и подтверждение въезжают шторкой (№ 34).
      const revoke = adminCard.locator('[data-dm-card-revoke]');
      await stillElement(revoke);
      await revoke.click();
      const confirm = adminPage.getByRole('dialog', { name: tx['dm.tok.revoke.title']! });
      await expect(confirm).toContainText(tokenName);
      const confirmOk = confirm.getByRole('button', { name: tx['dm.tok.revoke.ok']! });
      await stillElement(confirmOk);
      const revoked = adminPage.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === `/api/admin/dm/tokens/${item.id}/revoke` &&
          r.request().method() === 'POST',
      );
      await confirmOk.click();
      expect((await revoked).status()).toBe(200);
      await adminPage.close();

      // Внешний адрес — «Токен не подходит или истёк» (одно место на платформу: 429 — спросить снова).
      let res!: APIResponse;
      await expect
        .poll(
          async () => {
            res = await ext.get(`/api/ext/v1/${template.code}`, {
              headers: { authorization: `Bearer ${token}` },
            });
            return res.status();
          },
          { timeout: 20_000 },
        )
        .not.toBe(429);
      expect(res.status(), await res.text()).toBe(401);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('dm_ext_token');

      // Владелец: своя строка «отозван» — с «Администратор платформы» (у строки «создан» — имя
      // владельца); нажатие открывает окно токена «Отозван» и убирает номер из адреса.
      await page.goto('/app/dm/tok');
      const seen = page.waitForResponse(
        (r) => new URL(r.url()).pathname === '/api/bell/seen' && r.request().method() === 'POST',
      );
      await page.locator('[data-bell]').click();
      const panel = page.locator('[data-bell-panel]');
      await expect(panel).toBeVisible();
      expect((await seen).status()).toBe(200);
      const row = panel
        .locator('[data-bell-row]')
        .filter({ hasText: tokenName })
        .filter({ hasText: tx['dm.tok.who_admin']! });
      await expect(row).toHaveCount(1);
      // На телефоне панель въезжает шторкой (№ 34).
      await stillElement(row);
      await row.click();
      await expect(panel).toBeHidden();
      const card = page.getByRole('dialog', { name: tokenName });
      await expect(card.locator('[data-dm-card]')).toBeVisible();
      await expect(card).toContainText(tx['dm.tok.state.revoked']!);
      await expect(card).toContainText(tx['dm.tok.who_admin']!);
      await expect(page).not.toHaveURL(/[?&]tok=/);
    } finally {
      await admin.close();
      await ext.dispose();
    }
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

    // Бухгалтер (в стандартной роли права на витрину нет): модуля нет в меню и в «кто я», блок —
    // только для просмотра (отказ методов витрины без права — тесты API `datamart/output.test.ts`).
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
