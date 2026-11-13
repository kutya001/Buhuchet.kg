import { expect, test, type Page } from '@playwright/test';
import {
  botAnswers,
  botSent,
  hire,
  linkTelegram,
  pressBotButton,
  settledBox,
  signIn,
  uniqueChat,
  uniqueLogin,
} from './helpers';

// Основа бота Telegram (поток Т, задача Т1; пакет заказчика 13.11.2026, прототип v89): сообщения с
// таблицами и кнопками, нажатия кнопок, код одним нажатием, «Проверить бота» и «Сообщения простым
// текстом» в «Мой профиль», «Действия из Telegram» в настройках организации. Через настоящий сайт с
// ботом-подделкой (fake-telegram.ts): она хранит вид сообщения, кнопки и скрытые ответы на нажатия.

const OWN_PASSWORD = 'Свой-пароль-e2e-1';
const TABLE_AS_TEXT = [
  '• Таблица — столбцами, как здесь',
  '• Кнопки — под сообщением',
  '• Скрытый ответ — после нажатия кнопки',
].join('\n');

/** Новый сотрудник демо-организации со своим паролем; страница входит под ним. */
async function employee(page: Page, origin: string, prefix: string, role?: string) {
  const login = uniqueLogin(prefix);
  const { temporaryPassword } = await hire(page.request, origin, login, null, role);
  await signIn(page.request, origin, login, temporaryPassword);
  const changed = await page.request.post('/api/auth/password', {
    headers: { origin },
    data: { currentPassword: temporaryPassword, newPassword: OWN_PASSWORD },
  });
  expect(changed.status(), await changed.text()).toBe(200);
  return login;
}

async function openProfile(page: Page, isMobile: boolean) {
  await page.goto('/app/home/today');
  if (isMobile) {
    await page.getByRole('button', { name: 'Меню' }).click();
    await page.getByRole('button', { name: /^Мой профиль/ }).click();
  } else {
    await page.getByRole('button', { name: 'Мой профиль' }).click();
  }
  const profile = page.getByRole('dialog', { name: 'Мой профиль' });
  await settledBox(profile);
  return profile;
}

test.describe('Доработки 13.11. Т1: основа бота Telegram', () => {
  test('(пакет заказчика 13.11.2026) «Проверить бота»: бот присылает сообщение с таблицей и кнопкой, нажатие кнопки — скрытый ответ; «Сообщения простым текстом» — то же сообщение без таблицы, кнопка остаётся', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await employee(page, origin, 'e2e-bot');
    const chat = uniqueChat();
    await linkTelegram(page.request, origin, chat);
    const before = (await botSent(page.request, chat)).length;

    const profile = await openProfile(page, isMobile);
    const box = profile.locator('[data-profile-telegram]');
    await expect(box).toContainText(`@e2e_${chat}`);
    await box.getByRole('button', { name: 'Проверить бота' }).click();
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: `Бот прислал проверочное сообщение в @e2e_${chat}` }),
    ).toBeVisible();

    // Сообщение с таблицей: заголовок, текст, таблица столбцами и кнопка под сообщением.
    await expect.poll(async () => (await botSent(page.request, chat)).length).toBe(before + 1);
    const rich = (await botSent(page.request, chat)).at(-1)!;
    expect(rich.html).toContain('<table');
    expect(rich.text).toContain('Проверка бота');
    expect(rich.text).toContain('Таблица — столбцами, как здесь');
    expect(rich.keyboard).toEqual([[{ text: 'Проверить кнопки', callback_data: 'test' }]]);

    // Нажатие кнопки: скрытый ответ только нажавшему, кнопка остаётся активной.
    const pressId = await pressBotButton(page.request, chat, rich.messageId, 'test');
    await expect
      .poll(async () => (await botAnswers(page.request)).find((a) => a.id === pressId))
      .toEqual({
        id: pressId,
        text: 'Кнопки работают. Этот ответ видите только вы.',
        alert: false,
      });
    // Кнопки, которой в сообщении не было, бот не принимает: «Кнопка устарела» окном.
    const fakeId = await pressBotButton(page.request, chat, rich.messageId, 'delete:1');
    await expect
      .poll(async () => (await botAnswers(page.request)).find((a) => a.id === fakeId))
      .toMatchObject({ alert: true, text: expect.stringContaining('Кнопка устарела') });

    // «Сообщения простым текстом»: сохраняется сразу, следующее сообщение — без таблицы, с кнопкой.
    const plain = box.locator('[data-telegram-plain]');
    await expect(plain).toContainText('Сообщения простым текстом');
    await expect(plain).toContainText('Кнопки под сообщениями останутся.');
    await plain.getByRole('switch').click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Бот будет присылать простой текст' }),
    ).toBeVisible();
    await box.getByRole('button', { name: 'Проверить бота' }).click();
    await expect.poll(async () => (await botSent(page.request, chat)).length).toBe(before + 2);
    const text = (await botSent(page.request, chat)).at(-1)!;
    expect(text.html).toBeUndefined();
    expect(text.text).toContain(`Проверка бота\n`);
    expect(text.text).toContain(TABLE_AS_TEXT);
    expect(text.keyboard).toEqual([[{ text: 'Проверить кнопки', callback_data: 'test' }]]);

    // Выбор запомнен: после перезагрузки переключатель включён; выключили — снова таблицы.
    const again = await openProfile(page, isMobile);
    const switchAgain = again.locator('[data-telegram-plain]').getByRole('switch');
    await expect(switchAgain).toBeChecked();
    await switchAgain.click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Бот будет присылать таблицы' }),
    ).toBeVisible();
    const me = (await (await page.request.get('/api/auth/me')).json()) as {
      telegram: { plain: boolean };
    };
    expect(me.telegram.plain).toBe(false);
  });

  test('(пакет заказчика 13.11.2026) код из Telegram копируется одним нажатием: сообщение начинается с кода, под ним кнопка «Скопировать код»', async ({
    request,
    baseURL,
    playwright,
  }) => {
    const origin = new URL(baseURL!).origin;
    const login = uniqueLogin('e2e-code');
    const { temporaryPassword } = await hire(request, origin, login);
    await signIn(request, origin, login, temporaryPassword);
    const changed = await request.post('/api/auth/password', {
      headers: { origin },
      data: { currentPassword: temporaryPassword, newPassword: OWN_PASSWORD },
    });
    expect(changed.status(), await changed.text()).toBe(200);
    const chat = uniqueChat();
    await linkTelegram(request, origin, chat);
    const before = (await botSent(request, chat)).length;

    // «Забыли пароль?» — без входа: код приходит в привязанный Telegram.
    const guest = await playwright.request.newContext({ baseURL });
    const reset = await guest.post('/api/auth/password-reset', {
      headers: { origin },
      data: { login },
    });
    expect(reset.status()).toBe(200);
    await expect.poll(async () => (await botSent(request, chat)).length).toBe(before + 1);
    const message = (await botSent(request, chat)).at(-1)!;
    const code = /^(\d{6}) — код для восстановления пароля/.exec(message.text)?.[1];
    expect(code, message.text).toBeTruthy();
    expect(message.keyboard).toEqual([[{ text: 'Скопировать код', copy_text: { text: code } }]]);
    await guest.dispose();
  });

  test('(пакет заказчика 13.11.2026) «Действия из Telegram» в настройках организации видит сотрудник с правом просмотра, но меняет только владелец', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    await employee(page, origin, 'e2e-act', 'Главный бухгалтер');
    await page.goto('/app/org/settings');
    const row = page.locator('[data-telegram-actions]');
    await expect(row).toContainText('Действия из Telegram');
    await expect(row).toContainText('Деньги и удаление — только на сайте.');
    await expect(row).toContainText('Меняет только владелец организации.');
    await expect(row.getByRole('switch')).toBeDisabled();
    // И мимо экрана — отказ сервера.
    const policy = (await (await page.request.get('/api/org/policy')).json()) as {
      version: number;
    };
    const denied = await page.request.patch('/api/org/policy', {
      headers: { origin },
      data: { version: policy.version, telegramActions: false },
    });
    expect(denied.status()).toBe(403);
  });
});
