import { expect, test, type APIRequestContext } from '@playwright/test';
import { botSent, FAKE_TELEGRAM, uniqueChat, WEBHOOK_SECRET } from './helpers';
import { orgWithTypes } from './orgs';

// Общий рабочий чат фирмы (поток Т, задача Т8; пакет заказчика 13.11.2026, идея 11; прототип v105
// modules/tg-group.js) через настоящий сайт с ботом-подделкой (fake-telegram.ts): «Моя организация» →
// «Настройки» → «Общий чат фирмы в Telegram», подключение одноразовой ссылкой (бот добавлен в группу —
// Telegram присылает «/start@бот g_<ключ>»), «Сводка дня в группу», «Отключить группу». Сводка дня и
// «Мои» скрытым сообщением (по расписанию и по нажатию в группе), отказы, «бота удалили», новый номер
// группы и изоляция организаций — `packages/api/src/modules/telegram/group.test.ts`.

/** Учётная политика своей организации: только переданные поля. */
async function policy(api: APIRequestContext, origin: string, patch: Record<string, unknown>) {
  const current = (await (await api.get('/api/org/policy')).json()) as { version: number };
  const res = await api.patch('/api/org/policy', {
    headers: { origin },
    data: { version: current.version, ...patch },
  });
  expect(res.status(), await res.text()).toBe(200);
}

/** Бота добавили в группу по ссылке: Telegram присылает в группу «/start@бот <ключ>». */
async function botAdded(api: APIRequestContext, url: string, group: number, title: string) {
  const link = new URL(url);
  const bot = link.pathname.slice(1);
  const payload = link.searchParams.get('startgroup')!;
  const res = await api.post('/api/telegram/webhook', {
    headers: { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
    data: {
      update_id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
      message: {
        message_id: 1,
        date: 0,
        text: `/start@${bot} ${payload}`,
        chat: { id: group, type: 'supergroup', title },
        from: { id: uniqueChat(), is_bot: false, first_name: 'Сквозной' },
      },
    },
  });
  expect(res.status(), await res.text()).toBe(200);
}

test.describe('Доработки 13.11. Т8: общий чат фирмы', () => {
  test('(пакет заказчика 13.11.2026, идея 11) владелец подключает рабочую группу одноразовой ссылкой — бот пишет в группе, в «Настройках» видно группу; «Сводка дня в группу» выключается; «Отключить группу» — бот пишет, что отключён, и выходит', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const origin = new URL(baseURL!).origin;
    await orgWithTypes(page.request, origin, false);
    await policy(page.request, origin, { features: { telegram: true } });
    const group = -uniqueChat();
    const title = `Бухгалтерия ${Date.now().toString(36)}`;

    await page.goto('/app/org/settings');
    const box = page.locator('[data-tggrp]');
    await expect(box).toContainText('Группа не подключена.');
    await box.locator('[data-tggrp-link]').click();
    const dialog = page.locator('[data-tggrp-dialog]');
    await expect(dialog).toContainText('Ссылка одноразовая и действует до');
    const url = (await dialog.locator('[data-tggrp-url]').innerText()).trim();
    expect(url).toMatch(/^https:\/\/t\.me\/\w+\?startgroup=g_[A-Za-z0-9_-]{43}$/);

    // Бота добавили в группу — окно закрывается само, в блоке название группы.
    await botAdded(page.request, url, group, title);
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expect(box.locator('[data-tggrp-title]')).toHaveText(title);
    await expect(box).toContainText('Подключена');
    await expect
      .poll(async () => (await botSent(page.request, group)).map((m) => m.text)[0])
      .toContain(`Бот подключён к группе «${title}»`);
    // Та же ссылка второй раз не подключает другую группу.
    const other = -uniqueChat();
    await botAdded(page.request, url, other, 'Чужая');
    await expect
      .poll(async () => (await botSent(page.request, other)).map((m) => m.text)[0])
      .toContain('Ссылка для подключения группы устарела или уже использована.');

    // «Сводка дня в группу» — выключить.
    await box.locator('[data-tggrp-summary] input[role="switch"]').click();
    await expect(page.getByText('Сводка дня выключена')).toBeVisible();
    const state = (await (await page.request.get('/api/telegram/group')).json()) as {
      group: { summary: boolean };
    };
    expect(state.group.summary).toBe(false);

    // «Отключить группу»: подтверждение, бот пишет в группе и выходит из неё.
    await box.locator('[data-tggrp-off]').click();
    await page.getByRole('button', { name: 'Отключить', exact: true }).click();
    await expect(box).toContainText('Группа не подключена.');
    await expect
      .poll(async () => (await botSent(page.request, group)).at(-1)?.text)
      .toBe('Бот отключён от этой группы: сводки сюда больше не придут.');
    const left = (await (await page.request.get(`${FAKE_TELEGRAM}/left`)).json()) as string[];
    expect(left).toContain(String(group));
  });
});
