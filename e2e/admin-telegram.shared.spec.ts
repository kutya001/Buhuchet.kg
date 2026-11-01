import { expect, test, type APIRequestContext } from '@playwright/test';
import { ownerPassword, platformAdmin, search, uniqueInn } from './admin';
import { botMessages, linkTelegram, signIn, uniqueChat, uniqueLogin } from './helpers';

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
});
