import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { ADMIN_PASSWORD, platformAdmin } from './admin';
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
// Тексты страницы входа — словарь refDB v59 и прототип core/login.js `LG_T` (ТЗ «Сообщения на
// странице входа», решение заказчика 26.10.2026).
const BAD_LOGIN = 'Неверный логин или пароль';
const LOCKED = 'Вход временно закрыт: слишком много неверных попыток. Попробуйте через 15 минут.';
const CODE_SENT =
  'Если к логину привязан Telegram, бот пришлёт код. Если код не пришёл, пароль сбросит владелец организации. Код действует 10 минут.';

/** Ошибка входа — общая плашка над «Войти» (прототип `#lg-msg`), а не подсказка под полем. */
const loginAlert = (page: Page) => page.locator('main form').getByRole('alert');

async function expectLoginAlert(page: Page, text: string) {
  const alert = loginAlert(page);
  await expect(alert).toHaveText(text);
  const box = (await alert.boundingBox())!;
  const password = (await page.getByLabel('Пароль', { exact: true }).boundingBox())!;
  const button = (await page.getByRole('button', { name: 'Войти' }).boundingBox())!;
  expect(box.y).toBeGreaterThan(password.y + password.height - 1);
  expect(box.y + box.height).toBeLessThanOrEqual(button.y + 1);
  await expect(page.getByLabel('Пароль', { exact: true })).not.toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(page.getByLabel('Логин')).not.toHaveAttribute('aria-invalid', 'true');
}

async function signInByForm(page: Page, login: string, password: string) {
  await page.getByLabel('Логин').fill(login);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await Promise.all([
    page.waitForResponse('**/api/auth/login'),
    page.getByRole('button', { name: 'Войти' }).click(),
  ]);
}

/** Новый сотрудник уже сменил временный пароль на OWN_PASSWORD; `api` вошёл им. */
async function hiredAndSignedIn(
  api: APIRequestContext,
  origin: string,
  prefix: string,
  phone: string | null = null,
) {
  const login = uniqueLogin(prefix);
  const { temporaryPassword } = await hire(api, origin, login, phone);
  await signIn(api, origin, login, temporaryPassword);
  const changed = await api.post('/api/auth/password', {
    headers: { origin },
    data: { currentPassword: temporaryPassword, newPassword: OWN_PASSWORD },
  });
  expect(changed.status()).toBe(200);
  return login;
}

test.describe('Этап 1: экраны входа и «Мой профиль»', () => {
  test('(прототип v82) глаз в поле пароля: показывает и скрывает пароль, фокус и набранное остаются', async ({
    page,
  }) => {
    await page.goto('/login');
    const password = page.getByLabel('Пароль', { exact: true });
    await password.fill('Bh-4821-temp');
    await expect(password).toHaveAttribute('type', 'password');
    const show = page.getByRole('button', { name: 'Показать пароль' });
    await expect(show).toHaveAttribute('aria-pressed', 'false');
    await show.click();
    await expect(password).toHaveAttribute('type', 'text');
    await expect(password).toBeFocused();
    await expect(password).toHaveValue('Bh-4821-temp');
    const hide = page.getByRole('button', { name: 'Скрыть пароль' });
    await expect(hide).toHaveAttribute('aria-pressed', 'true');
    await hide.click();
    await expect(password).toHaveAttribute('type', 'password');
  });

  test('вход демо-сотрудником открывает рабочую страницу; неверный пароль — «Неверный логин или пароль» плашкой над «Войти», пятый подряд закрывает вход на 15 минут', async ({
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

    await test.step('пустая форма — «Введите логин», «Введите пароль» под полями', async () => {
      await page.getByRole('button', { name: 'Войти' }).click();
      await expect(page.getByText('Введите логин')).toBeVisible();
      await expect(page.getByText('Введите пароль')).toBeVisible();
      await expect(page.getByLabel('Логин')).toBeFocused();
    });

    await test.step('неверный пароль: «Неверный логин или пароль» без предупреждения о попытках', async () => {
      for (let i = 1; i <= 4; i++) {
        await signInByForm(page, login, `неверный-${i}`);
        await expectLoginAlert(page, BAD_LOGIN);
      }
      await expect(page).toHaveURL(/\/login$/);
    });

    await test.step('логина нет на платформе — то же сообщение', async () => {
      await signInByForm(page, uniqueLogin('e2e-nobody'), 'неверный');
      await expectLoginAlert(page, BAD_LOGIN);
    });

    await test.step('после ошибки «Войти» с пустым паролем — плашка гаснет, «Введите пароль» под полем', async () => {
      await page.getByLabel('Пароль', { exact: true }).fill('');
      await page.getByRole('button', { name: 'Войти' }).click();
      await expect(page.getByText('Введите пароль')).toBeVisible();
      await expect(loginAlert(page)).toHaveCount(0);
    });

    await test.step('пятый неверный пароль закрывает вход на 15 минут — даже верным паролем', async () => {
      await signInByForm(page, login, 'неверный-5');
      await expectLoginAlert(page, LOCKED);
      await signInByForm(page, login, temporaryPassword);
      await expectLoginAlert(page, LOCKED);
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

  test('несуществующий логин и неверный пароль — одно «Неверный логин или пароль»; заблокированный сотрудник видит «Учётная запись заблокирована…» только после верного пароля', async ({
    page,
    playwright,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const owner = await playwright.request.newContext({ baseURL });
    const login = uniqueLogin('e2e-blocked');
    const hired = (await hire(owner, origin, login)) as {
      temporaryPassword: string;
      employee: { id: string; version: number };
    };
    await signIn(owner, origin, 'erkin', DEMO_PASSWORD);
    const blocked = await owner.post(`/api/staff/${hired.employee.id}/block`, {
      headers: { origin },
      data: { version: hired.employee.version },
    });
    expect(blocked.status(), await blocked.text()).toBe(200);
    await owner.dispose();

    await page.goto('/login');
    await test.step('логина нет — «Неверный логин или пароль»', async () => {
      await signInByForm(page, uniqueLogin('e2e-nobody'), 'неверный');
      await expectLoginAlert(page, BAD_LOGIN);
    });

    await test.step('заблокированный сотрудник с неверным паролем — то же сообщение, о блокировке ни слова', async () => {
      await signInByForm(page, login, 'неверный');
      await expectLoginAlert(page, BAD_LOGIN);
    });

    await test.step('с верным паролем — «Учётная запись заблокирована. Обратитесь к владельцу организации.»', async () => {
      await signInByForm(page, login, hired.temporaryPassword);
      await expectLoginAlert(
        page,
        'Учётная запись заблокирована. Обратитесь к владельцу организации.',
      );
      await expect(page).toHaveURL(/\/login$/);
    });
  });

  test('(прототип v76) у демо-сотрудника Жылдыз вход закрыт после 10 неверных паролей подряд: с верным паролем — «Вход заблокирован: 10 неверных паролей подряд…»', async ({
    page,
  }) => {
    // Блокировку ставит наполнение демо-организации, как в demoDB v76. Неверных паролей Жылдыз тест не
    // вводит: их считает предел по логину, а десять подряд за прогон не набрать (docs/deviations.md п. О-51).
    await page.goto('/login');
    await signInByForm(page, 'jyldyz', DEMO_PASSWORD);
    await expectLoginAlert(
      page,
      'Вход заблокирован: 10 неверных паролей подряд. Обратитесь к владельцу организации — он выдаст новый пароль.',
    );
    await expect(page).toHaveURL(/\/login$/);
  });

  test('(прототип v76) администратор платформы на своём компьютере и в тестах входит без кода из Telegram: после верного пароля сразу Админка', async ({
    page,
    playwright,
    baseURL,
  }) => {
    // Код из Telegram нужен только на стенде и рабочем сайте; его шаг проверяют тесты API
    // (docs/deviations.md п. О-13 и О-51).
    const origin = new URL(baseURL!).origin;
    const api = await playwright.request.newContext({ baseURL });
    const admin = await platformAdmin(api, origin);
    await api.dispose();
    await page.goto('/login');
    await signInByForm(page, admin, ADMIN_PASSWORD);
    // Первый модуль Админки — «Учётные записи»: его нет ни у кого, кроме администратора платформы.
    await expect(page).toHaveURL(/\/app\/accounts(\/|$)/);
    await expect(page.getByText('Код для входа в Админку')).toHaveCount(0);
    await expect(page.getByText('Привяжите Telegram')).toHaveCount(0);
  });

  test('(прототип v76) на стенде администратор платформы входит с кодом из Telegram: без Telegram — «Привяжите Telegram» со ссылкой; после верного пароля — «Код для входа в Админку», неверный код — ошибка, верный — Админка', async ({
    page,
    playwright,
    baseURL,
  }) => {
    // Кода для входа в Админку на своём компьютере и в тестах нет (docs/deviations.md п. О-13):
    // ответы стенда подставлены, как их отдаёт сервер (admin-code.test.ts), а сеанс в конце — настоящий.
    const origin = new URL(baseURL!).origin;
    const api = await playwright.request.newContext({ baseURL });
    const admin = await platformAdmin(api, origin);
    await api.dispose();
    const link = 'https://t.me/buhuchet_e2e_bot?start=e2e-admin-link';
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    let logins = 0;
    await page.route('**/api/auth/login', (route) =>
      ++logins === 1
        ? route.fulfill({
            status: 403,
            json: {
              error: {
                code: 'telegram_required',
                message: 'Для входа в Админку нужен Telegram',
                details: { url: link, expiresAt },
              },
            },
          })
        : route.fulfill({
            status: 202,
            json: { secondFactor: 'telegram', challenge: 'e2e-challenge', expiresAt },
          }),
    );
    let codes = 0;
    await page.route('**/api/auth/login/code', async (route) => {
      if (++codes === 1) {
        return route.fulfill({
          status: 400,
          json: {
            error: {
              code: 'admin_code_invalid',
              message: 'Код неверный',
              details: { attempts: 5 },
            },
          },
        });
      }
      // Верный код: настоящий вход тем же паролем (без кода на своём компьютере) ставит сеанс в браузер.
      const signed = await page.request.post('/api/auth/login', {
        headers: { origin },
        data: { login: admin, password: ADMIN_PASSWORD },
      });
      expect(signed.status(), await signed.text()).toBe(200);
      return route.fulfill({ status: 200, json: await signed.json() });
    });

    await page.goto('/login');
    await signInByForm(page, admin, ADMIN_PASSWORD);
    await expect(page.getByRole('heading', { name: 'Привяжите Telegram' })).toBeVisible();
    await expect(
      page.getByText(
        'Чтобы войти в Админку, нужен код из Telegram. Откройте ссылку в Telegram и нажмите «Старт» — бот привяжет чат. Затем войдите снова.',
      ),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: link.replace('https://', '') })).toHaveAttribute(
      'href',
      link,
    );
    await page.getByRole('button', { name: 'Telegram привязан — войти' }).click();

    await expect(page.getByLabel('Логин')).toHaveValue(admin);
    await signInByForm(page, admin, ADMIN_PASSWORD);
    await expect(page.getByRole('heading', { name: 'Код для входа в Админку' })).toBeVisible();
    await expect(
      page.getByText('Бот прислал код в ваш Telegram. Код действует 5 минут.'),
    ).toBeVisible();
    const code = page.getByLabel('Код из Telegram');
    await code.fill('000000');
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(
      page.getByText('Код неверный или истёк. После 5 неверных кодов войдите заново.'),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);

    await code.fill('731604');
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page).toHaveURL(/\/app\/accounts(\/|$)/);
    expect(codes).toBe(2);
  });

  test('с временным паролем после входа — смена пароля, уйти с неё нельзя, тот же пароль не принимается; после смены — предложение привязать Telegram', async ({
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
        // Страница входа помнит, куда вернуться после смены пароля (задача #165); /app — без адреса.
        const back = path === '/app' ? '' : `\\?next=${encodeURIComponent(path)}`;
        await expect(page).toHaveURL(new RegExp(`/login${back}$`));
        await expect(title).toBeVisible();
      }
      const api = await page.request.get('/api/staff');
      expect(api.status()).toBe(403);
    });

    await test.step('страницу открыли заново — спрашивает временный пароль; новый не равен временному, пароли должны совпасть', async () => {
      await page.getByLabel('Временный пароль').fill(temporaryPassword);
      // Тот же пароль не принимается (решение заказчика 27.10.2026, docs/deviations.md п. 41).
      await page.getByLabel('Новый пароль').fill(temporaryPassword);
      await page.getByLabel('Повторите пароль').fill(temporaryPassword);
      await page.getByRole('button', { name: 'Сменить пароль' }).click();
      await expect(page.getByText('Новый пароль совпадает с текущим')).toBeVisible();
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
    await expect(page.getByText(CODE_SENT, { exact: true })).toBeVisible();

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
      await expectLoginAlert(page, BAD_LOGIN);
      await signInByForm(page, login, 'Новый-пароль-e2e-2');
      await expect(page).toHaveURL(/\/app\/home\/today$/);
    });
  });

  test('«Забыли пароль?» с несуществующим логином и с логином без Telegram — тот же ответ и тот же экран ввода кода, что с привязанным Telegram; имени Telegram нет', async ({
    page,
    playwright,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const linked = await playwright.request.newContext({ baseURL });
    const withTelegram = await hiredAndSignedIn(linked, origin, 'e2e-forgot-tg');
    const chat = uniqueChat();
    await linkTelegram(linked, origin, chat);
    await linked.dispose();
    const plain = await playwright.request.newContext({ baseURL });
    const withoutTelegram = await hiredAndSignedIn(plain, origin, 'e2e-forgot-notg');
    await plain.dispose();

    const answers: string[] = [];
    for (const login of [uniqueLogin('e2e-nobody'), withoutTelegram, withTelegram]) {
      await test.step(`логин ${login}`, async () => {
        await page.goto('/login');
        await page.getByRole('button', { name: 'Забыли пароль?' }).click();
        await expect(page.getByRole('heading', { name: 'Восстановление пароля' })).toBeVisible();
        await expect(page.getByText('Введите логин и нажмите «Получить код».')).toBeVisible();
        await page.getByLabel('Логин').fill(login);
        await page.getByRole('button', { name: 'Получить код' }).click();

        await expect(page.getByRole('heading', { name: 'Введите код' })).toBeVisible();
        const note = page.getByText(CODE_SENT, { exact: true });
        await expect(note).toBeVisible();
        answers.push((await page.locator('main').innerText()).replace(login, '<логин>'));
        // Имени Telegram (у бота-подделки — @e2e_<чат>) на экране нет.
        await expect(page.locator('main')).not.toContainText('@');
        for (const label of ['Код из Telegram', 'Новый пароль', 'Повторите пароль']) {
          await expect(page.getByLabel(label)).toBeVisible();
        }

        await page.getByRole('button', { name: 'Вернуться ко входу' }).click();
        await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible();
        await expect(page.getByLabel('Логин')).toHaveValue(login);
      });
    }
    expect(new Set(answers).size).toBe(1);
    // Код ушёл только в привязанный Telegram.
    await expect
      .poll(async () => (await botMessages(page.request, chat)).some((m) => /\b\d{6}\b/.test(m)))
      .toBe(true);
  });

  test('«Мой профиль»: данные, Telegram, тема и смена пароля; несохранённый пароль спрашивает «Закрыть без сохранения?» и «Выйти без сохранения?»', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    const login = await hiredAndSignedIn(page.request, origin, 'e2e-profile', '+996555100200');
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
      await expect(profile).toContainText('+996 555 100 200');
      await expect(profile).toContainText('Бухгалтер');
    });

    if (isMobile) {
      await test.step('до 600 px два коротких значения подряд — в строку, длинные — во всю ширину', async () => {
        const item = (label: string) => profile.locator('dl > div', { hasText: label });
        // Логин e2e длинный — во всю ширину; телефон и роль короткие — по два в строку.
        await expect(item('Логин')).toHaveAttribute('data-pack', 'full');
        await expect(item('Телефон')).toHaveAttribute('data-pack', 'half');
        await expect(item('Роль')).toHaveAttribute('data-pack', 'half');
        const phone = (await item('Телефон').boundingBox())!;
        const role = (await item('Роль').boundingBox())!;
        expect(Math.abs(phone.y - role.y)).toBeLessThanOrEqual(1);
        expect(role.x).toBeGreaterThan(phone.x + phone.width);
        // Поля пароля длинные — во всю ширину; пустая ячейка между ними скрыта.
        const current = profile.locator('[data-pack]', { has: page.getByLabel('Текущий пароль') });
        await expect(current).toHaveAttribute('data-pack', 'full');
        await expect(profile.locator('[data-pack=hidden]')).toHaveCount(1);
      });
    }

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
      // Прежний Telegram (прототип v77): другой чат бот привяжет только по коду, который пришлёт туда.
      await expect(profile.locator('[data-telegram-previous]')).toHaveText(
        `Прежний Telegram @e2e_${chat}: другой чат бот привяжет только по коду, который пришлёт туда.`,
      );
    });

    await test.step('тема применяется сразу', async () => {
      await profile.getByLabel('Тема').selectOption('dark');
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await profile.getByLabel('Тема').selectOption('light');
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    });

    const discard = page.getByRole('dialog', { name: 'Закрыть без сохранения?' });
    await test.step('новый пароль, равный текущему, — ошибка под полем «Новый пароль»', async () => {
      // Решение заказчика 27.10.2026, docs/deviations.md п. 41.
      await profile.getByLabel('Текущий пароль').fill(OWN_PASSWORD);
      await profile.getByLabel('Новый пароль').fill(OWN_PASSWORD);
      await profile.getByLabel('Повторите').fill(OWN_PASSWORD);
      await profile.getByRole('button', { name: 'Сменить пароль' }).click();
      await expect(profile.getByText('Новый пароль совпадает с текущим')).toBeVisible();
    });

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
