import { expect, test, type APIRequestContext } from '@playwright/test';
import { platformAdmin, search } from './admin';
import { linkTelegram, newOrgOwner, sendToBot, uniqueChat } from './helpers';

// Админка → «Телеграм» → «Журнал»: переписка бота в обе стороны с текстом (решение заказчика
// 17.11.2026; ТЗ «Доработки 17.11.2026», блок «Админка: запуски по расписанию и переписка бота»;
// прототип v132 admin/tg-log.js). Своя организация и свой чат на каждый тест: журнал общий для всех
// тестов, поэтому тест ищет и считает только строки своей организации.

type Texts = Record<string, string>;

/** Тексты словаря интерфейса (`GET /api/l10n`): тест не копирует строки экрана. */
async function dictionary(api: APIRequestContext): Promise<Texts> {
  const res = await api.get('/api/l10n');
  expect(res.status()).toBe(200);
  return ((await res.json()) as { texts: Texts }).texts;
}

/** Слово из кириллицы, своё на каждый запуск: по нему видно только сообщение теста. */
const uniqueWord = (prefix: string) =>
  `${prefix}${Array.from({ length: 8 }, () => 'абвгдежзиклмнопрстуф'[Math.floor(Math.random() * 20)]).join('')}`;

test.describe('Админка: журнал переписки бота', () => {
  test('(доработки 17.11.2026) полученное сообщение — «← Получено» с текстом, код — «Текст скрыт»; окно «Сообщение»; «Вся переписка» — и отправленное, и полученное одного чата', async ({
    page,
    baseURL,
    isMobile,
    playwright,
  }) => {
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const texts = await dictionary(page.request);
    const owner = await playwright.request.newContext({ baseURL });
    try {
      const login = await newOrgOwner(owner, origin);
      const chat = uniqueChat();
      await linkTelegram(owner, origin, chat);
      const word = uniqueWord('Журнал');
      const said = `Пришлю выписку завтра, ${word}`;
      await sendToBot(owner, chat, { text: said });
      // Шесть цифр — код: в журнал пишется строка без текста. Код — такой, какого нет в логине.
      // Строка и окно показывают логин и «@e2e_<чат>»: код не должен совпасть ни с тем, ни с другим.
      const code = ['482913', '739105', '264087', '915326'].find(
        (c) => !login.includes(c) && !String(chat).includes(c),
      )!;
      await sendToBot(owner, chat, { text: code });

      await page.goto('/app/tg/log');
      // Ответ журнала с этим поиском ждём до нажатий: до него на экране строки всех организаций.
      const found = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === '/api/admin/telegram/log' &&
          new URL(r.url()).searchParams.get('q') === login,
      );
      await search(page, isMobile, login);
      expect((await found).status()).toBe(200);
      const rows = page.locator('[data-grid] [data-id]');
      const got = rows.filter({ hasText: word });
      await expect(got).toHaveCount(1);
      await expect(got).toContainText(texts['tgadm.msg.in']!);
      await expect(got).toContainText(said);
      const hidden = rows.filter({ hasText: texts['tgadm.hide.code']! });
      await expect(hidden).toHaveCount(1);
      await expect(hidden).toContainText(texts['tgadm.msg.in']!);
      await expect(hidden).not.toContainText(code);

      // Полученное не повторяется: пункт виден, но недоступен с причиной.
      const menu = page.getByRole('menu', { name: 'Действия' });
      await hidden.locator('[data-row-menu]').click();
      await expect(menu.getByRole('menuitem', { name: texts['tgadm.retry']! })).toBeDisabled();
      await expect(menu).toContainText(texts['tgadm.retry.in']!);
      // Окно «Сообщение» у кода: пояснение вместо текста, самого кода нет.
      await menu.getByRole('menuitem', { name: texts['tgadm.menu.open']! }).click();
      const codeWindow = page.locator('[data-tg-message]');
      await expect(codeWindow).toContainText(texts['tgadm.hide.code']!);
      await expect(codeWindow).not.toContainText(code);
      await page
        .getByRole('dialog')
        .filter({ has: codeWindow })
        .getByRole('button', { name: 'Закрыть' })
        .last()
        .click();
      await expect(codeWindow).toHaveCount(0);

      // Нажатие на строку открывает окно «Сообщение»: текст — как в чате, со стороны собеседника.
      await got.click();
      const message = page.locator('[data-tg-message]');
      await expect(message.locator('[data-chat-me]')).toContainText(said);
      // «Вся переписка» из окна: один чат, оба направления — и то, что бот отправил, и то, что получил.
      const chatList = page.waitForResponse((r) => {
        const url = new URL(r.url());
        return url.pathname === '/api/admin/telegram/log' && url.searchParams.has('chat');
      });
      await page.locator('[data-tg-all]').click();
      expect((await chatList).status()).toBe(200);
      await expect(message).toHaveCount(0);
      await expect(page.locator('[data-tg-chat-note]')).toBeVisible();
      await expect(got).toHaveCount(1);
      await expect(hidden).toHaveCount(1);
      const linked = rows.filter({ hasText: texts['telegram.kind.linked']! });
      await expect(linked).toHaveCount(1);
      await expect(linked).toContainText(texts['tgadm.msg.out']!);
      await page.getByRole('button', { name: texts['tgadm.log.chat_reset']! }).click();
      await expect(page.locator('[data-tg-chat-note]')).toHaveCount(0);
      await expect(got).toHaveCount(1);
    } finally {
      await owner.dispose();
    }
  });
});
