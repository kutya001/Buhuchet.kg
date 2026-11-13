import { expect, test, type APIRequestContext } from '@playwright/test';
import { ownerPassword, platformAdmin, search, uniqueInn } from './admin';
import {
  botMessages,
  botSent,
  hire,
  linkTelegram,
  signIn,
  uniqueChat,
  uniqueLogin,
} from './helpers';

// Админка → «Телеграм» (задача 2.41; ТЗ «Админка» → «Модуль Телеграмм»; прототип admin/telegram.js)
// через настоящий сайт с ботом-подделкой (fake-telegram.ts). Рассылка — только своей организации теста:
// объявление «всем» дошло бы до чатов других тестов. Файл — *.shared: состояние вебхука у подделки
// общее, ПК и телефон не должны менять его одновременно. Очередь отправляет расписание
// (/api/cron/tick, как Vercel); задача отправки запускается раз в минуту, поэтому ждём опросом.

const CRON_SECRET = process.env.CRON_SECRET ?? 'local-cron-secret-change-me';
const FAKE_TELEGRAM = `http://127.0.0.1:${process.env.FAKE_TELEGRAM_PORT ?? 8091}`;
const POLL = { timeout: 120_000, intervals: [2_000, 5_000, 10_000] };

async function tick(api: APIRequestContext) {
  const res = await api.post('/api/cron/tick', {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
  expect(res.status(), await res.text()).toBe(200);
}

/** Что ответит getWebhookInfo подделки: адрес и последняя ошибка доставки (время — сейчас). */
async function fakeWebhook(api: APIRequestContext, url: string, error = '') {
  const res = await api.post(`${FAKE_TELEGRAM}/webhook-info`, { data: { url, error } });
  expect(res.status()).toBe(200);
}

interface LogRow {
  id: string;
  kind: string;
  status: string;
  error: string | null;
}

/** Журнал одной организации через API Админки (фильтр «Организация»). */
async function orgLog(api: APIRequestContext, orgId: string): Promise<LogRow[]> {
  const filters = JSON.stringify({ org: { type: 'enum', vals: [orgId] } });
  const res = await api.get(
    `/api/admin/telegram/log?size=all&filters=${encodeURIComponent(filters)}`,
  );
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { items: LogRow[] }).items;
}

test.describe('Этап 2: Админка → «Телеграм»', () => {
  test('(проверка задачи #97) рассылка одной организации уходит очередью; не доставленное отвязавшему Telegram — «Ошибка» с «Повторить отправку»; у отправленного повтор недоступен с причиной', async ({
    page,
    baseURL,
    isMobile,
    playwright,
  }) => {
    test.setTimeout(300_000);
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const ownerLogin = uniqueLogin('e2e-tg');
    const orgName = `ОсОО «${ownerLogin}»`;
    const temporary = ownerPassword();
    const created = await page.request.post('/api/admin/organizations', {
      headers: { origin },
      data: {
        name: orgName,
        inn: uniqueInn(),
        ownerFullName: 'Телеграмова Сквозная',
        ownerLogin,
        temporaryPassword: temporary,
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const orgId = ((await created.json()) as { organization: { id: string } }).organization.id;
    const owner = await playwright.request.newContext({ baseURL });
    await signIn(owner, origin, ownerLogin, temporary);
    const changed = await owner.post('/api/auth/password', {
      headers: { origin },
      data: { currentPassword: temporary, newPassword: ownerPassword() },
    });
    expect(changed.status(), await changed.text()).toBe(200);
    const chat = uniqueChat();
    await linkTelegram(owner, origin, chat);

    // «+ Добавить» → «Объявление» открывает «Рассылку».
    await page.goto('/app/tg/log');
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/tg\/cast$/);
    // «Введите текст» — без запроса; одной организации — «В очереди: 1 сообщение», поле очищается.
    await page.getByRole('button', { name: 'Поставить в очередь' }).click();
    await expect(page.getByText('Введите текст')).toBeVisible();
    await page.locator('[data-tg-cast-to]').selectOption({ label: orgName });
    const first = `Плановые работы ${ownerLogin}`;
    await page.locator('[data-tg-cast-text]').fill(first);
    await page.getByRole('button', { name: 'Поставить в очередь' }).click();
    await expect(page.getByText('В очереди: 1 сообщение')).toBeVisible();
    await expect(page.locator('[data-tg-cast-text]')).toHaveValue('');
    const delivered = async () => {
      await tick(page.request);
      return (await botMessages(page.request, chat)).filter((m) => m === first);
    };
    await expect.poll(delivered, POLL).toHaveLength(1);

    // Второе объявление ждёт в очереди, а получатель тем временем отвязал Telegram: в прежний чат оно
    // не уходит — «Ошибка» с пояснением.
    const second = `Второе объявление ${ownerLogin}`;
    const cast = await page.request.post('/api/admin/telegram/broadcast', {
      headers: { origin },
      data: { org: orgId, text: second },
    });
    expect(cast.status(), await cast.text()).toBe(200);
    const unlinked = await owner.delete('/api/telegram/link', { headers: { origin } });
    expect(unlinked.status()).toBe(200);
    const failed = async () => {
      await tick(page.request);
      return (await orgLog(page.request, orgId)).filter(
        (r) => r.kind === 'broadcast' && r.status === 'error',
      ).length;
    };
    await expect.poll(failed, POLL).toBe(1);
    expect(await botMessages(page.request, chat)).not.toContain(second);

    // Журнал всех организаций: поиск по организации теста.
    await page.goto('/app/tg/log');
    await search(page, isMobile, ownerLogin);
    const rows = page.locator('[data-grid] [data-id]');
    const sent = rows.filter({ hasText: 'Объявление' }).filter({ hasText: 'Отправлено' });
    // На телефоне у плиток подпись «Ошибка» есть у всех — ищем по пояснению.
    const error = rows.filter({ hasText: 'Получатель отвязал или сменил Telegram' });
    await expect(sent).toHaveCount(1);
    await expect(error).toHaveCount(1);
    await expect(error).toContainText('Объявление');
    await expect(rows.filter({ hasText: 'Telegram привязан' })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'Telegram отвязан' })).toHaveCount(1);
    await expect(sent).toContainText(orgName);

    const menu = page.getByRole('menu', { name: 'Действия' });
    await sent.locator('[data-row-menu]').click();
    await expect(menu.getByRole('menuitem', { name: 'Повторить отправку' })).toBeDisabled();
    await expect(menu).toContainText('Повтор доступен только для ошибок');
    await page.keyboard.press('Escape');
    await error.locator('[data-row-menu]').click();
    await menu.getByRole('menuitem', { name: 'Повторить отправку' }).click();
    await expect(page.getByText('Сообщение снова в очереди')).toBeVisible();
    // Строка снова «Ожидает» (следующий запуск очереди снова не отправит её в прежний чат).
    await expect(error).toHaveCount(0);
    await owner.dispose();
  });

  test('(проверка задачи #97) «Бот платформы»: «Работает», последняя ошибка Telegram после «Проверить вебхук», снова работает; «Заменить токен» — пояснение без токена', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const bot = (await (await page.request.get('/api/admin/telegram/bot')).json()) as {
      url: string;
    };
    expect(bot.url).toMatch(/\/api\/telegram\/webhook$/);
    await fakeWebhook(page.request, bot.url);

    await page.goto('/app/tg/bot');
    await expect(page.getByText(bot.url)).toBeVisible();
    await expect(page.getByText('Работает', { exact: true })).toBeVisible();
    await expect(page.getByText(/^сегодня в \d\d:\d\d$/)).toBeVisible();

    const error = 'Wrong response from the webhook: 502 Bad Gateway';
    await fakeWebhook(page.request, bot.url, error);
    await page.getByRole('button', { name: 'Проверить вебхук' }).click();
    await expect(page.getByText(/^Вебхук не работает · проверено \d\d:\d\d$/)).toBeVisible();
    await expect(page.locator('[data-tg-problem]')).toContainText(
      `Последняя ошибка Telegram: ${error}`,
    );
    await expect(page.getByText('Ошибка', { exact: true })).toBeVisible();

    await fakeWebhook(page.request, bot.url);
    await page.getByRole('button', { name: 'Проверить вебхук' }).click();
    await expect(page.getByText(/^Вебхук снова работает · проверено \d\d:\d\d$/)).toBeVisible();
    await expect(page.locator('[data-tg-problem]')).toHaveCount(0);

    await page.getByRole('button', { name: 'Заменить токен' }).click();
    const dialog = page.getByRole('dialog', { name: 'Как заменить токен бота' });
    await expect(dialog).toContainText('Environment Variables');
    await expect(dialog).toContainText('Ввести или посмотреть токен в Админке нельзя');
    await expect(dialog.locator('input, textarea')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Понятно' }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('(пакет заказчика 13.11.2026) «Вид сообщений и кнопки»: примеры сообщений с кодом и таблицей; таблицы выключены — «Проверить бота» приходит простым текстом с кнопкой, включены — снова таблицей', async ({
    page,
    baseURL,
    playwright,
  }) => {
    const origin = new URL(baseURL!).origin;
    // Сотрудник демо-организации с привязанным Telegram: ему бот присылает проверочное сообщение.
    const staff = await playwright.request.newContext({ baseURL });
    const login = uniqueLogin('e2e-view');
    const { temporaryPassword } = await hire(staff, origin, login);
    await signIn(staff, origin, login, temporaryPassword);
    const changed = await staff.post('/api/auth/password', {
      headers: { origin },
      data: { currentPassword: temporaryPassword, newPassword: ownerPassword() },
    });
    expect(changed.status(), await changed.text()).toBe(200);
    const chat = uniqueChat();
    await linkTelegram(staff, origin, chat);
    const testBot = async () => {
      const before = (await botSent(staff, chat)).length;
      const res = await staff.post('/api/telegram/test', { headers: { origin } });
      expect(res.status(), await res.text()).toBe(200);
      await expect.poll(async () => (await botSent(staff, chat)).length).toBe(before + 1);
      return (await botSent(staff, chat)).at(-1)!;
    };

    await platformAdmin(page.request, origin);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    try {
      await page.goto('/app/tg/bot');
      const view = page.locator('[data-tg-view]');
      await expect(view).toContainText('Вид сообщений и кнопки');
      await expect(view).toContainText('скрытый ответ, виден только нажавшему');
      await expect(view).toContainText('бот сразу отправляет то же сообщение простым текстом');
      const rich = view.locator('[data-tg-rich]').getByRole('switch');
      await expect(rich).toBeChecked();

      // Примеры: код подтверждения с кнопкой копирования и сообщение с таблицей и кнопкой.
      await view.getByRole('button', { name: 'Показать примеры сообщений' }).click();
      const dialog = page.getByRole('dialog', { name: 'Вид сообщений бота' });
      const chatBox = dialog.locator('[data-bot-chat]');
      await expect(chatBox.locator('[data-chat-code]')).toHaveText('482913');
      // Код копируется и нажатием на него в тексте, и кнопкой под сообщением.
      const copied = page.getByRole('status').filter({ hasText: 'Код скопирован' });
      await chatBox.locator('[data-chat-code]').click();
      await expect(copied).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('482913');
      await page.evaluate(() => navigator.clipboard.writeText(''));
      await chatBox.getByRole('button', { name: 'Скопировать код' }).click();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('482913');
      await expect(chatBox.locator('table')).toContainText('Что проверяем');
      await chatBox.getByRole('button', { name: 'Проверить кнопки' }).click();
      await expect(chatBox.locator('[data-chat-hidden]')).toContainText('Видно только вам');
      await expect(chatBox.locator('[data-chat-hidden]')).toContainText('Кнопки работают');
      // Запасной простой текст: таблицы нет, строки — списком, кнопки на месте.
      await dialog.locator('[data-chat-plain]').getByRole('switch').click();
      await expect(chatBox.locator('table')).toHaveCount(0);
      await expect(chatBox).toContainText('• Таблица — столбцами, как здесь');
      await expect(chatBox.getByRole('button', { name: 'Проверить кнопки' })).toBeVisible();
      await dialog.getByRole('button', { name: 'Готово' }).click();
      await expect(dialog).toHaveCount(0);

      // Таблицы выключены для всех: сообщение уходит простым текстом, кнопка остаётся.
      await rich.click();
      await expect(
        page.getByRole('status').filter({ hasText: 'Бот присылает простой текст' }),
      ).toBeVisible();
      const plain = await testBot();
      expect(plain.html).toBeUndefined();
      expect(plain.text).toContain('• Таблица — столбцами, как здесь');
      expect(plain.keyboard).toEqual([[{ text: 'Проверить кнопки', callback_data: 'test' }]]);
      // Примеры при выключенных таблицах сразу открываются простым текстом, с пояснением.
      await view.getByRole('button', { name: 'Показать примеры сообщений' }).click();
      await expect(dialog.locator('[data-chat-plain]').getByRole('switch')).toBeChecked();
      await expect(dialog.locator('[data-chat-plain]')).toContainText(
        'сейчас так получают все — таблицы выключены в Админке',
      );
      await expect(chatBox.locator('table')).toHaveCount(0);
      await expect(chatBox).toContainText('• Таблица — столбцами, как здесь');
      await dialog.getByRole('button', { name: 'Готово' }).click();
      await expect(dialog).toHaveCount(0);

      // Выбор сохранён; включили обратно — снова сообщение с таблицей.
      await page.reload();
      await expect(rich).not.toBeChecked();
      await rich.click();
      await expect(
        page.getByRole('status').filter({ hasText: 'Бот присылает таблицы' }),
      ).toBeVisible();
      const tables = await testBot();
      expect(tables.html).toContain('<table');
    } finally {
      const back = await page.request.put('/api/admin/telegram/bot/view', {
        headers: { origin },
        data: { rich: true },
      });
      expect(back.status(), await back.text()).toBe(200);
      await staff.dispose();
    }
  });
});
