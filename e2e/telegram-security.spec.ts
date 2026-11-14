import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { platformAdmin, search } from './admin';
import {
  botAnswers,
  botSent,
  hire,
  linkTelegram,
  pressBotButton,
  signIn,
  uniqueChat,
  uniqueLogin,
  type BotSent,
} from './helpers';
import { orgWithTypes } from './orgs';

// «Это не я» под сообщениями бота о безопасности (поток Т, задача Т4; пакет заказчика 13.11.2026,
// идея 9; прототип v101 modules/tg-security.js) через настоящий сайт с ботом-подделкой
// (fake-telegram.ts): кнопка под «Пароль изменён» и «Telegram отвязан», нажатие завершает сеансы и
// закрывает вход, текст страницы входа, сообщение владельцу, карточка пользователя в Админке. Срок
// кнопки (24 часа), «Привязан другой Telegram», владелец и администратор платформы, блокировки —
// `packages/api/src/modules/telegram/security.test.ts` (там часы стоят).

const OWN_PASSWORD = 'Свой-пароль-e2e-1';
const NEXT_PASSWORD = 'Другой-пароль-e2e-2';
const NOT_ME = 'Это не я';

/** Сообщение чата с кнопкой «Это не я» и данные её нажатия. */
async function withNotMe(api: APIRequestContext, chat: number) {
  let found: { message: BotSent; data: string } | null = null;
  await expect
    .poll(async () => {
      for (const message of await botSent(api, chat)) {
        const button = (message.keyboard ?? []).flat().find((b) => b.text === NOT_ME);
        if (button?.callback_data) found = { message, data: button.callback_data };
      }
      return Boolean(found);
    })
    .toBe(true);
  return found!;
}

/** Нажать кнопку и дождаться ответа бота на нажатие; текст скрытого ответа (пусто — его нет). */
async function press(api: APIRequestContext, chat: number, message: BotSent, data: string) {
  const id = await pressBotButton(api, chat, message.messageId, data);
  await expect.poll(async () => (await botAnswers(api)).some((a) => a.id === id)).toBe(true);
  return (await botAnswers(api)).find((a) => a.id === id)!.text ?? '';
}

const lastText = async (api: APIRequestContext, chat: number) =>
  (await botSent(api, chat)).at(-1)?.text ?? '';

/** Сотрудник входит с временным паролем, ставит свой и привязывает Telegram. */
async function settle(
  api: APIRequestContext,
  origin: string,
  login: string,
  temporaryPassword: string,
  chat: number,
) {
  await signIn(api, origin, login, temporaryPassword);
  const changed = await api.post('/api/auth/password', {
    headers: { origin },
    data: { currentPassword: temporaryPassword, newPassword: OWN_PASSWORD },
  });
  expect(changed.status(), await changed.text()).toBe(200);
  await linkTelegram(api, origin, chat);
}

async function signInByForm(page: Page, login: string, password: string) {
  await page.getByLabel('Логин').fill(login);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await Promise.all([
    page.waitForResponse('**/api/auth/login'),
    page.getByRole('button', { name: 'Войти' }).click(),
  ]);
}

test.describe('Доработки 13.11. Т4: «Это не я» под сообщениями бота о безопасности', () => {
  test('(пакет заказчика 13.11.2026, идея 9) «Пароль изменён»: под сообщением кнопка «Это не я»; нажатие завершает все сеансы и закрывает вход — на странице входа свой текст, владельцу приходит сообщение; новый пароль от владельца открывает вход', async ({
    request,
    page,
    baseURL,
    playwright,
  }) => {
    const origin = new URL(baseURL!).origin;
    // Своя организация: владелец с Telegram и бухгалтер.
    await orgWithTypes(request, origin, false);
    const ownerChat = uniqueChat();
    await linkTelegram(request, origin, ownerChat);
    const roles = (await (await request.get('/api/roles?size=all')).json()) as {
      items: { id: string; name: string }[];
    };
    const login = uniqueLogin('e2e-notme');
    const hired = await request.post('/api/staff', {
      headers: { origin },
      data: {
        fullName: 'Неяев Сквозной Тестович',
        login,
        phone: null,
        roleId: roles.items.find((r) => r.name === 'Бухгалтер')!.id,
      },
    });
    expect(hired.status(), await hired.text()).toBe(201);
    const { employee, temporaryPassword } = (await hired.json()) as {
      employee: { id: string };
      temporaryPassword: string;
    };
    const staff = await playwright.request.newContext({ baseURL });
    const chat = uniqueChat();
    await settle(staff, origin, login, temporaryPassword, chat);

    // Пароль сменили: бот сообщает в привязанный чат, под сообщением — кнопка.
    const changed = await staff.post('/api/auth/password', {
      headers: { origin },
      data: { currentPassword: OWN_PASSWORD, newPassword: NEXT_PASSWORD },
    });
    expect(changed.status(), await changed.text()).toBe(200);
    const { message, data } = await withNotMe(staff, chat);
    expect(message.text).toContain(`🔑 Пароль учётной записи ${login} изменён сегодня в `);
    expect(message.text).toContain('Если это вы, ничего делать не нужно.');
    expect(data).toMatch(/^notMe:pass\.\d+$/);
    expect((await staff.get('/api/auth/me')).status()).toBe(200);

    // «Это не я»: сеансы завершены, вход закрыт, ответ бота остаётся в переписке, кнопка гаснет.
    expect(await press(staff, chat, message, data)).toBe('');
    await expect
      .poll(() => lastText(staff, chat))
      .toBe(
        `🔒 Все сеансы учётной записи ${login} завершены, вход закрыт. Новый пароль выдаст владелец организации.`,
      );
    expect((await staff.get('/api/auth/me')).status()).toBe(401);
    await expect
      .poll(
        async () =>
          (await botSent(staff, chat)).find((m) => m.messageId === message.messageId)
            ?.keyboard?.[0]?.[0]?.text,
      )
      .toBe('✓ Вход закрыт');
    expect(await press(staff, chat, message, data)).toContain('Кнопка устарела');
    // Владельцу организации — что случилось и что сделать.
    await expect
      .poll(() => lastText(request, ownerChat))
      .toContain(
        `🔒 Сотрудник ${login} нажал «Это не я» под сообщением бота «пароль изменён»: все его сеансы завершены, вход закрыт.`,
      );

    // Страница входа: с верным паролем — свой текст; «Забыли пароль?» кода не присылает.
    await page.goto('/login');
    await signInByForm(page, login, NEXT_PASSWORD);
    await expect(page.locator('main form').getByRole('alert')).toHaveText(
      'Вход закрыт кнопкой «Это не я» в Telegram. Обратитесь к владельцу организации — он выдаст новый пароль.',
    );
    await expect(page).toHaveURL(/\/login$/);
    const before = (await botSent(staff, chat)).length;
    const forgot = await staff.post('/api/auth/password-reset', {
      headers: { origin },
      data: { login },
    });
    expect(forgot.status(), await forgot.text()).toBe(200);
    expect(await botSent(staff, chat)).toHaveLength(before);

    // Новый пароль от владельца открывает вход.
    const reset = await request.post(`/api/staff/${employee.id}/password-reset`, {
      headers: { origin },
      data: {},
    });
    expect(reset.status(), await reset.text()).toBe(200);
    const fresh = (await reset.json()) as { temporaryPassword: string };
    await signIn(staff, origin, login, fresh.temporaryPassword);
    await staff.dispose();
  });

  test('(пакет заказчика 13.11.2026, идея 9) «Telegram отвязан»: сообщение с кнопкой приходит в отвязанный чат; после нажатия в карточке пользователя Админки — «Вход закрыт: «Это не я» из Telegram», причина в «Сеансах» и запись в «Истории»', async ({
    page,
    baseURL,
    isMobile,
    playwright,
  }) => {
    const origin = new URL(baseURL!).origin;
    const login = uniqueLogin('e2e-notme');
    const hr = await playwright.request.newContext({ baseURL });
    const { temporaryPassword } = await hire(hr, origin, login);
    await hr.dispose();
    const staff = await playwright.request.newContext({ baseURL });
    const chat = uniqueChat();
    await settle(staff, origin, login, temporaryPassword, chat);

    // «Отвязать»: бот пишет в отвязанный чат, кнопка действует и там.
    const unlinked = await staff.delete('/api/telegram/link', { headers: { origin } });
    expect(unlinked.status(), await unlinked.text()).toBe(200);
    const { message, data } = await withNotMe(staff, chat);
    expect(message.text).toContain(`Telegram отвязан от учётной записи ${login}`);
    expect(message.text).toContain('Если это сделали не вы, нажмите «Это не я».');
    expect(data).toMatch(/^notMe:unlink\.\d+$/);
    expect(await press(staff, chat, message, data)).toBe('');
    await expect
      .poll(() => lastText(staff, chat))
      .toContain(`🔒 Все сеансы учётной записи ${login} завершены, вход закрыт.`);
    expect((await staff.get('/api/auth/me')).status()).toBe(401);
    await staff.dispose();

    // Админка → «Учётные записи» → карточка пользователя.
    await platformAdmin(page.request, origin);
    await page.goto('/app/accounts');
    await expect(page.locator('[data-grid] [data-id]').first()).toBeVisible();
    await search(page, isMobile, login);
    const row = page.locator('[data-grid] [data-id]').filter({ hasText: login });
    await expect(row).toHaveCount(1);
    await row.getByText('Входов Сквозной Тестович').click();
    const card = page.getByRole('dialog', { name: 'Входов Сквозной Тестович' });
    await expect(card.locator('[data-account-states]')).toContainText(
      'Вход закрыт: «Это не я» из Telegram',
    );
    const openTab = async (name: string) => {
      if (isMobile) {
        await card.getByRole('tab', { selected: true }).click();
        await page.getByRole('menu').getByRole('menuitem', { name }).click();
      } else {
        await card.getByRole('tab', { name }).click();
      }
      await expect(card.getByRole('tab', { selected: true })).toContainText(name);
    };
    await openTab('Сеансы');
    await expect(card.locator('[data-account-sessions="0"]')).toBeVisible();
    await expect(card).toContainText('Завершён: «Это не я» из Telegram');
    await openTab('История');
    await expect(card).toContainText(
      'Вход закрыт кнопкой «Это не я» под сообщением бота «Telegram отвязан», завершено сеансов: 1',
    );
  });
});
