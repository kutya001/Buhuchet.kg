import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  botMessages,
  DEMO_PASSWORD,
  finger,
  hire,
  linkTelegram,
  pressStart,
  settledBox,
  signIn,
  uniqueChat,
  uniqueLogin,
} from './helpers';

// Экраны входа (задача #13) через настоящий сайт: вход, обязательная смена временного пароля,
// «Забыли пароль?» с кодом от бота-подделки (fake-telegram.ts) и «Мой профиль». Неверные пароли
// вводятся только новым сотрудникам: демо-сотрудникам закрывать вход нельзя — им пользуются все тесты.
const OWN_PASSWORD = 'Свой-пароль-e2e-1';
const LOCK_WARNING = 'После 5 неверных попыток вход блокируется на 15 минут.';

async function signInByForm(page: Page, login: string, password: string) {
  await page.getByLabel('Логин').fill(login);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await Promise.all([
    page.waitForResponse('**/api/auth/login'),
    page.getByRole('button', { name: 'Войти' }).click(),
  ]);
}

/** Новый сотрудник уже сменил временный пароль на OWN_PASSWORD; `api` вошёл им. */
async function hiredAndSignedIn(api: APIRequestContext, origin: string, prefix: string) {
  const login = uniqueLogin(prefix);
  const { temporaryPassword } = await hire(api, origin, login);
  await signIn(api, origin, login, temporaryPassword);
  const changed = await api.post('/api/auth/password', {
    headers: { origin },
    data: { currentPassword: temporaryPassword, newPassword: OWN_PASSWORD },
  });
  expect(changed.status()).toBe(200);
  return login;
}

test.describe('Этап 1: экраны входа и «Мой профиль»', () => {
  test('вход демо-сотрудником открывает рабочую страницу; неверный пароль — ошибка и предупреждение о блокировке после 5 попыток', async ({
    page,
    playwright,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const owner = await playwright.request.newContext({ baseURL });
    const login = uniqueLogin('e2e-wrong');
    const { temporaryPassword } = await hire(owner, origin, login);
    await owner.dispose();

    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible();
    const password = page.getByLabel('Пароль', { exact: true });

    await test.step('пустая форма — «Введите логин», «Введите пароль»', async () => {
      await page.getByRole('button', { name: 'Войти' }).click();
      await expect(page.getByText('Введите логин')).toBeVisible();
      await expect(page.getByText('Введите пароль')).toBeVisible();
      await expect(page.getByLabel('Логин')).toBeFocused();
    });

    await test.step('неверный пароль: одно сообщение для любого логина и предупреждение о блокировке', async () => {
      for (let i = 1; i <= 4; i++) {
        await signInByForm(page, login, `неверный-${i}`);
        await expect(page.getByText(`Неверный логин или пароль. ${LOCK_WARNING}`)).toBeVisible();
        await expect(password).toHaveAttribute('aria-invalid', 'true');
      }
      await expect(page).toHaveURL(/\/login$/);
    });

    await test.step('пятый неверный пароль закрывает вход на 15 минут — даже верным паролем', async () => {
      await signInByForm(page, login, 'неверный-5');
      const locked = page.getByText(
        /^Слишком много неверных паролей\. Вход закрыт на 15 минут, попробуйте снова после \d{2}:\d{2}\.$/,
      );
      await expect(locked).toBeVisible();
      await signInByForm(page, login, temporaryPassword);
      await expect(locked).toBeVisible();
      await expect(page).toHaveURL(/\/login$/);
    });

    await test.step('демо-сотрудник входит и видит рабочую страницу', async () => {
      await signInByForm(page, 'erkin', DEMO_PASSWORD);
      await expect(page).toHaveURL(/\/app\/home\/today$/);
      // Меню модулей: на ПК — левая панель, на телефоне — нижняя.
      await expect(
        page.getByRole('link', { name: 'Главная', exact: true }).first(),
      ).toHaveAttribute('aria-current', 'page');
    });
  });

  test('с временным паролем после входа — смена пароля, уйти с неё нельзя; после смены — предложение привязать Telegram', async ({
    page,
    playwright,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const owner = await playwright.request.newContext({ baseURL });
    const login = uniqueLogin('e2e-temp');
    const { temporaryPassword } = await hire(owner, origin, login);
    await owner.dispose();

    await page.goto('/login');
    await signInByForm(page, login, temporaryPassword);
    const title = page.getByRole('heading', { name: 'Смените временный пароль' });
    await expect(title).toBeVisible();
    // Временный пароль только что введён — второй раз его не спрашивают.
    await expect(page.getByLabel('Временный пароль')).toHaveCount(0);

    await test.step('в программу не пускает: страницы ведут обратно на смену пароля', async () => {
      for (const path of ['/app', '/app/reports/week', '/app/staff']) {
        await page.goto(path);
        await expect(page).toHaveURL(/\/login$/);
        await expect(title).toBeVisible();
      }
      const api = await page.request.get('/api/staff');
      expect(api.status()).toBe(403);
    });

    await test.step('страницу открыли заново — спрашивает временный пароль; пароли должны совпасть', async () => {
      await page.getByLabel('Временный пароль').fill(temporaryPassword);
      await page.getByLabel('Новый пароль').fill(OWN_PASSWORD);
      await page.getByLabel('Повторите пароль').fill('Другой-пароль-e2e');
      await page.getByRole('button', { name: 'Сменить пароль' }).click();
      await expect(page.getByText('Пароли не совпадают')).toBeVisible();
      await page.getByLabel('Повторите пароль').fill(OWN_PASSWORD);
      await page.getByRole('button', { name: 'Сменить пароль' }).click();
    });

    await test.step('Telegram не привязан — ссылка привязки; бот привязал чат — «Продолжить»', async () => {
      await expect(page.getByRole('heading', { name: 'Привяжите Telegram' })).toBeVisible();
      const link = page.getByRole('link', { name: /^t\.me\/.+\?start=/ });
      await expect(link).toBeVisible();
      const chat = uniqueChat();
      expect(
        (await pressStart(page.request, (await link.getAttribute('href'))!, chat)).status(),
      ).toBe(200);
      // Бот подтвердил привязку в чате (тексты бота — с логином).
      await expect
        .poll(() => botMessages(page.request, chat))
        .toEqual([expect.stringContaining(login)]);
      // Экран узнаёт о привязке, спрашивая «кто я» раз в 3 секунды.
      await expect(page.getByText('Telegram привязан')).toBeVisible({ timeout: 10_000 });
      await page.getByRole('button', { name: 'Продолжить' }).click();
      await expect(page).toHaveURL(/\/app\/home\/today$/);
    });
  });

  test('«Забыли пароль?» с кодом от бота доводит до входа с новым паролем', async ({
    page,
    playwright,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const employee = await playwright.request.newContext({ baseURL });
    const login = await hiredAndSignedIn(employee, origin, 'e2e-forgot');
    const chat = uniqueChat();
    await linkTelegram(employee, origin, chat);
    await employee.dispose();

    await page.goto('/login');
    await page.getByRole('button', { name: 'Забыли пароль?' }).click();
    await expect(page.getByRole('heading', { name: 'Восстановление пароля' })).toBeVisible();
    await page.getByLabel('Логин').fill(login);
    await page.getByRole('button', { name: 'Получить код' }).click();
    await expect(page.getByRole('heading', { name: 'Введите код' })).toBeVisible();
    await expect(page.getByText('Если к логину привязан Telegram, бот пришлёт код.')).toBeVisible();

    let code = '';
    await expect
      .poll(async () => {
        const sent = (await botMessages(page.request, chat)).find((m) => /\b\d{6}\b/.test(m));
        code = sent?.match(/\b(\d{6})\b/)?.[1] ?? '';
        return code;
      })
      .toMatch(/^\d{6}$/);

    await test.step('неверный код — «Код неверный или истёк»', async () => {
      const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
      await page.getByLabel('Код из Telegram').fill(wrong);
      await page.getByLabel('Новый пароль').fill('Новый-пароль-e2e-2');
      await page.getByLabel('Повторите пароль').fill('Новый-пароль-e2e-2');
      await page.getByRole('button', { name: 'Сменить пароль' }).click();
      await expect(page.getByText('Код неверный или истёк')).toBeVisible();
    });

    await test.step('верный код — пароль сменён, вход с новым паролем', async () => {
      await page.getByLabel('Код из Telegram').fill(code);
      await page.getByRole('button', { name: 'Сменить пароль' }).click();
      await expect(page.getByText('Пароль изменён. Войдите с новым паролем.')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible();
      await expect(page.getByLabel('Логин')).toHaveValue(login);
      await signInByForm(page, login, OWN_PASSWORD);
      await expect(page.getByText(`Неверный логин или пароль. ${LOCK_WARNING}`)).toBeVisible();
      await signInByForm(page, login, 'Новый-пароль-e2e-2');
      await expect(page).toHaveURL(/\/app\/home\/today$/);
    });
  });

  test('«Мой профиль»: данные, Telegram, тема и смена пароля; несохранённый пароль спрашивает «Закрыть без сохранения?» и «Выйти без сохранения?»', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    const login = await hiredAndSignedIn(page.request, origin, 'e2e-profile');
    await page.goto('/app/home/today');
    const profile = page.getByRole('dialog', { name: 'Мой профиль' });
    const openProfile = async () => {
      // На ПК — внизу левой панели, на телефоне — в панели «Меню».
      if (isMobile) {
        await page.getByRole('button', { name: 'Меню' }).click();
        await page.getByRole('button', { name: /^Мой профиль/ }).click();
      } else {
        await page.getByRole('button', { name: 'Мой профиль' }).click();
      }
      await settledBox(profile);
    };
    await openProfile();

    await test.step('основное: ФИО, логин, телефон, роль', async () => {
      await expect(profile).toContainText('Входов Сквозной Тестович');
      await expect(profile).toContainText(login);
      await expect(profile).toContainText('Бухгалтер');
    });

    await test.step('Telegram: привязка по ссылке и «Отвязать»', async () => {
      await expect(profile.getByText('Telegram не привязан')).toBeVisible();
      const link = profile.getByRole('link', { name: /^t\.me\/.+\?start=/ });
      const chat = uniqueChat();
      expect(
        (await pressStart(page.request, (await link.getAttribute('href'))!, chat)).status(),
      ).toBe(200);
      await expect(profile.getByText('Привязан', { exact: true })).toBeVisible({ timeout: 10_000 });
      await expect(profile).toContainText(`@e2e_${chat}`);
      await profile.getByRole('button', { name: 'Отвязать' }).click();
      await expect(page.getByText('Telegram отвязан')).toBeVisible();
      await expect(profile.getByText('Telegram не привязан')).toBeVisible();
    });

    await test.step('тема применяется сразу', async () => {
      await profile.getByLabel('Тема').selectOption('dark');
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await profile.getByLabel('Тема').selectOption('light');
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    });

    const discard = page.getByRole('dialog', { name: 'Закрыть без сохранения?' });
    await test.step('неверный текущий пароль — ошибка под полем', async () => {
      await profile.getByLabel('Текущий пароль').fill('неверный');
      await profile.getByLabel('Новый пароль').fill('Новый-пароль-e2e-3');
      await profile.getByLabel('Повторите').fill('Новый-пароль-e2e-3');
      await profile.getByRole('button', { name: 'Сменить пароль' }).click();
      await expect(profile.getByText('Текущий пароль неверный')).toBeVisible();
    });

    await test.step('«Назад» с несохранённым паролем спрашивает, «Отмена» оставляет профиль', async () => {
      await page.evaluate(() => history.back());
      await expect(discard).toBeVisible();
      await discard.getByRole('button', { name: 'Отмена' }).click();
      await expect(discard).toBeHidden();
      await expect(profile).toBeVisible();
      await expect(profile.getByLabel('Новый пароль')).toHaveValue('Новый-пароль-e2e-3');
    });

    if (isMobile) {
      await test.step('протяжка вниз с несохранённым паролем тоже спрашивает', async () => {
        const box = await settledBox(profile);
        const head = { x: box.x + box.width / 2, y: box.y + 30 };
        const swipe = await finger(page);
        await swipe.drag(head, { x: head.x, y: head.y + Math.min(box.height / 4, 160) + 30 });
        await expect(discard).toBeVisible();
        await discard.getByRole('button', { name: 'Отмена' }).click();
        await expect(profile).toBeVisible();
      });
    }

    await test.step('выход с несохранённым паролем спрашивает «Выйти без сохранения?»', async () => {
      // Кнопка выхода под окном (окно закрывает панели) — нажимаем её программно: проверяется, что
      // оболочка видит несохранённое в профиле.
      await page.locator('button', { hasText: 'Выйти из аккаунта' }).first().dispatchEvent('click');
      const ask = page.getByRole('dialog', { name: 'Выйти без сохранения?' });
      await expect(ask).toBeVisible();
      await ask.getByRole('button', { name: 'Отмена' }).click();
      await expect(ask).toBeHidden();
      await expect(page).toHaveURL(/\/app\/home\/today$/);
    });

    await test.step('верный текущий пароль — пароль сменён, форма очищена, окно закрывается сразу', async () => {
      await profile.getByLabel('Текущий пароль').fill(OWN_PASSWORD);
      await profile.getByRole('button', { name: 'Сменить пароль' }).click();
      await expect(page.getByText('Пароль изменён. Другие сеансы завершены.')).toBeVisible();
      await expect(profile.getByLabel('Новый пароль')).toHaveValue('');
      await page.evaluate(() => history.back());
      await expect(profile).toBeHidden();
      await expect(discard).toBeHidden();
      await expect(page).toHaveURL(/\/app\/home\/today$/);
      // Новый сеанс этого окна остался рабочим.
      expect((await page.request.get('/api/auth/me')).status()).toBe(200);
    });
  });
});
