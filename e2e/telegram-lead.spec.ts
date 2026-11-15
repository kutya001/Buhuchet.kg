import { expect, test, type APIRequestContext } from '@playwright/test';
import { botMessages, sendToBot, uniqueChat } from './helpers';

// Telegram заявителя и пароль по ссылке (поток Т, доработки 14.11.2026, блок 1, пункты 2–3; прототип
// v113 modules/tg-lead.js) через настоящий сайт с ботом-подделкой (fake-telegram.ts). Здесь — то, что
// не зависит от формы лендинга и «Одобрить» потока И: «Старт» по устаревшей ссылке заявителя и
// страница «Задать пароль» по ссылке, которой нет. Весь путь «заявка → Старт → Одобрить → Задать
// пароль → вход», отказ и «Отправить новую ссылку для пароля» — в общей сборке этапа 2 вместе с частью
// потока И; правила ссылок — packages/api/src/modules/telegram/lead-link.test.ts и
// packages/db/src/lead-telegram.test.ts.

type Texts = Record<string, string>;

/** Тексты словаря интерфейса (`GET /api/l10n`): тесты не копируют длинные строки. */
async function dictionary(api: APIRequestContext): Promise<Texts> {
  const res = await api.get('/api/l10n');
  expect(res.status()).toBe(200);
  return ((await res.json()) as { texts: Texts }).texts;
}

/** Текст словаря с подстановками `{имя}`. */
function text(texts: Texts, key: string, values: Record<string, string | number> = {}) {
  const raw = texts[key];
  expect(raw, key).toBeTruthy();
  return Object.entries(values).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), raw!);
}

/** Ключ ссылки, которой нет в базе: 43 знака base64url, как у настоящей. */
const unknownKey = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`.padEnd(43, 'q').slice(0, 43);

test('(доработки 14.11.2026, блок 1) «Старт» по устаревшей или чужой ссылке заявителя — бот отвечает «Ссылка устарела или уже использована» и просит отправить заявку ещё раз', async ({
  request,
}) => {
  const chat = uniqueChat();
  await sendToBot(request, chat, { text: `/start l_${unknownKey()}` });
  await expect
    .poll(() => botMessages(request, chat))
    .toEqual([expect.stringContaining('buhuchet.kg')]);
  const [reply] = await botMessages(request, chat);
  expect(reply).toContain('Ссылка устарела');
});

test('(доработки 14.11.2026, блок 1) Страница «Задать пароль» по ссылке, которой нет, — «Ссылка устарела», срок 7 дней и «Ко входу»; адрес не уходит в Referer и не индексируется', async ({
  page,
}) => {
  const texts = await dictionary(page.request);
  const title = page.getByRole('heading', { name: text(texts, 'setpass.invalid.title') });
  const res = await page.goto(`/setpass/${unknownKey()}`);
  expect(res?.headers()['referrer-policy']).toBe('no-referrer');
  expect(res?.headers()['x-robots-tag']).toBe('noindex, nofollow');
  await expect(title).toBeVisible();
  await expect(page.getByText(text(texts, 'setpass.invalid.text', { days: 7 }))).toBeVisible();
  await expect(page.getByLabel(texts['auth.new_password']!)).toHaveCount(0);

  // Ключ не того вида — то же, без запроса к API.
  await page.goto('/setpass/not-a-key');
  await expect(title).toBeVisible();
  await page.getByRole('link', { name: text(texts, 'setpass.to_login') }).click();
  await expect(page).toHaveURL(/\/login$/);
});
