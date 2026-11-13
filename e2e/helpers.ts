import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

// Общее для сквозных тестов: вход и новый сотрудник через API, бот-подделка (fake-telegram.ts),
// палец на телефоне и положение элемента после анимации.

export const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'demo';

/** Свой логин на каждый запуск и проект (ПК и телефон): неверные пароли считаются по логину. */
export const uniqueLogin = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export async function signIn(
  api: APIRequestContext,
  origin: string,
  login: string,
  password: string,
) {
  const res = await api.post('/api/auth/login', { headers: { origin }, data: { login, password } });
  expect(res.status(), await res.text()).toBe(200);
  return res;
}

/** Владелец демо-организации (erkin) создаёт сотрудника с ролью (по умолчанию «Бухгалтер») и временным паролем. */
export async function hire(
  api: APIRequestContext,
  origin: string,
  login: string,
  phone: string | null = null,
  roleName = 'Бухгалтер',
) {
  await signIn(api, origin, 'erkin', DEMO_PASSWORD);
  const roles = (await (await api.get('/api/roles?size=all')).json()) as {
    items: { id: string; name: string }[];
  };
  const res = await api.post('/api/staff', {
    headers: { origin },
    data: {
      fullName: 'Входов Сквозной Тестович',
      login,
      phone,
      roleId: roles.items.find((r) => r.name === roleName)!.id,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  await api.post('/api/auth/logout', { headers: { origin } });
  return (await res.json()) as { employee: { id: string }; temporaryPassword: string };
}

/**
 * Ответственный по умолчанию для контрагента, которого тест создаёт через API: в демо-организации —
 * главный бухгалтер meerim, в своей организации теста — первый активный сотрудник. Не первый в списке
 * (он — самый новый): им бывает только что нанятый сотрудник другого теста, у которого в карточке
 * проверяют «Закреплено контрагентов: 0».
 */
export async function defaultResponsible(api: APIRequestContext): Promise<string> {
  const res = await api.get('/api/staff?size=all');
  expect(res.status()).toBe(200);
  const { items } = (await res.json()) as {
    items: { id: string; login: string; active: boolean }[];
  };
  return (items.find((e) => e.login === 'meerim' && e.active) ?? items.find((e) => e.active))!.id;
}

/** Подделка Telegram Bot API (fake-telegram.ts): её запускает Playwright на этом компьютере. */
const FAKE_TELEGRAM = `http://127.0.0.1:${process.env.FAKE_TELEGRAM_PORT ?? 8091}`;
/** Секрет вебхука бота сайта — тот же, что в .env (по умолчанию из .env.example). */
export const WEBHOOK_SECRET =
  process.env.TELEGRAM_WEBHOOK_SECRET ?? 'local-webhook-secret-change-me';

/** Свой чат Telegram на каждый тест: сообщения бота подделка хранит по чату. */
export const uniqueChat = () => Date.now() * 1000 + Math.floor(Math.random() * 1000);

/** Что бот сайта отправил в чат. */
export async function botMessages(api: APIRequestContext, chat: number): Promise<string[]> {
  const res = await api.get(`${FAKE_TELEGRAM}/messages?chat=${chat}`);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { text: string }[]).map((m) => m.text);
}

/** Сообщение бота в чате, как его хранит подделка: текст, вид с таблицами, кнопки, номер в чате. */
export interface BotSent {
  messageId: number;
  text: string;
  /** Вид с таблицами (`sendRichMessage`); у простого сообщения нет. */
  html?: string;
  /** Ряды кнопок — как в `reply_markup.inline_keyboard` Bot API. */
  keyboard?: {
    text: string;
    callback_data?: string;
    copy_text?: { text: string };
    url?: string;
  }[][];
}

/** Что бот сайта отправил в чат — вместе с видом и кнопками (основа бота, поток Т). */
export async function botSent(api: APIRequestContext, chat: number): Promise<BotSent[]> {
  const res = await api.get(`${FAKE_TELEGRAM}/messages?chat=${chat}`);
  expect(res.status()).toBe(200);
  return (await res.json()) as BotSent[];
}

/** Скрытые ответы бота на нажатия кнопок (их видит только нажавший). */
export async function botAnswers(
  api: APIRequestContext,
): Promise<{ id: string; text: string; alert: boolean }[]> {
  const res = await api.get(`${FAKE_TELEGRAM}/answers`);
  expect(res.status()).toBe(200);
  return (await res.json()) as { id: string; text: string; alert: boolean }[];
}

/**
 * Пользователь нажал кнопку под сообщением бота в личном чате: Telegram присылает вебхуком
 * `callback_query`. Возвращает идентификатор нажатия — по нему ищется скрытый ответ (`botAnswers`).
 */
export async function pressBotButton(
  api: APIRequestContext,
  chat: number,
  messageId: number,
  data: string,
): Promise<string> {
  const id = `e2e-${chat}-${messageId}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const res = await api.post('/api/telegram/webhook', {
    headers: { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
    data: {
      // Номер обновления у каждого нажатия свой: повторную доставку Telegram шлёт с тем же номером.
      update_id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
      callback_query: {
        id,
        from: { id: chat, is_bot: false, first_name: 'Сквозной' },
        chat_instance: 'e2e',
        data,
        message: { message_id: messageId, date: 0, chat: { id: chat, type: 'private' } },
      },
    },
  });
  expect(res.status(), await res.text()).toBe(200);
  return id;
}

/** Пользователь открыл ссылку привязки в Telegram: Telegram присылает вебхуком «/start <токен>». */
export function pressStart(api: APIRequestContext, linkUrl: string, chat: number) {
  const token = new URL(linkUrl).searchParams.get('start')!;
  return api.post('/api/telegram/webhook', {
    headers: { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
    data: {
      update_id: chat,
      message: {
        text: `/start ${token}`,
        chat: { id: chat, type: 'private' },
        from: { username: `e2e_${chat}`, first_name: 'Сквозной' },
      },
    },
  });
}

/** Пользователь написал боту в личном чате (например, код подтверждения замены Telegram). */
export function tellBot(api: APIRequestContext, chat: number, text: string) {
  return api.post('/api/telegram/webhook', {
    headers: { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
    data: {
      update_id: chat + 1,
      message: {
        text,
        chat: { id: chat, type: 'private' },
        from: { username: `e2e_${chat}`, first_name: 'Сквозной' },
      },
    },
  });
}

/** Вошедший пользователь привязывает Telegram по ссылке из профиля. */
export async function linkTelegram(api: APIRequestContext, origin: string, chat: number) {
  const link = await api.post('/api/telegram/link', { headers: { origin } });
  expect(link.status(), await link.text()).toBe(200);
  const { url } = (await link.json()) as { url: string };
  expect((await pressStart(api, url, chat)).status()).toBe(200);
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Палец по экрану. `drag` — настоящие касания через протокол отладки Chromium: ведём по 12 px за кадр
 * и перед отпусканием останавливаемся (рывка нет); `holding` выполняется, пока палец ещё на экране.
 * `hold` — долгое нажатие на месте (меню записи в списке).
 * `flick` — быстрый рывок с частотой экрана
 * 120 Гц: без экрана Chromium доставляет касания протокола раз в ~50 мс, и рывок вышел бы медленным,
 * поэтому события касания создаются на странице с нужными промежутками.
 */
export async function finger(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', p?: Point) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [p] : [] });
  return {
    async drag(from: Point, to: Point, holding?: () => Promise<void>) {
      const steps = Math.max(4, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 12));
      await send('touchStart', from);
      for (let i = 1; i <= steps; i++) {
        await send('touchMove', {
          x: from.x + ((to.x - from.x) * i) / steps,
          y: from.y + ((to.y - from.y) * i) / steps,
        });
        await page.waitForTimeout(16);
      }
      await page.waitForTimeout(150);
      await holding?.();
      await send('touchEnd');
    },
    /** Долгое нажатие: палец стоит на месте `ms` миллисекунд. */
    async hold(at: Point, ms = 700) {
      await send('touchStart', at);
      await page.waitForTimeout(ms);
      await send('touchEnd');
    },
    flick: (from: Point, to: Point) =>
      page.evaluate(
        async ([a, b]) => {
          const target = document.elementFromPoint(a.x, a.y)!;
          let last = new Touch({ identifier: 1, target, clientX: a.x, clientY: a.y });
          const fire = (type: string, touches: Touch[]) =>
            target.dispatchEvent(
              new TouchEvent(type, {
                bubbles: true,
                cancelable: true,
                touches,
                targetTouches: touches,
                changedTouches: [last],
              }),
            );
          fire('touchstart', [last]);
          for (let i = 1; i <= 6; i++) {
            await new Promise((r) => setTimeout(r, 8));
            last = new Touch({
              identifier: 1,
              target,
              clientX: a.x + ((b.x - a.x) * i) / 6,
              clientY: a.y + ((b.y - a.y) * i) / 6,
            });
            fire('touchmove', [last]);
          }
          fire('touchend', []);
        },
        [from, to] as const,
      ),
  };
}

/**
 * Телефон: вид списка «Таблица». Кнопка вида называет следующий вид по кругу: у списка с «Доской»
 * после «Карточек» (вид телефона по умолчанию) идёт «Доска» и только за ней «Таблица», у списка без
 * доски — сразу «Таблица» (прототип v84, ui/grid.js).
 */
export async function phoneTableView(page: Page) {
  const board = page.getByRole('button', { name: 'Вид списка: Доска', exact: true });
  const table = page.getByRole('button', { name: 'Вид списка: Таблица', exact: true });
  await expect(board.or(table)).toBeVisible();
  if (await board.isVisible()) await board.click();
  await table.click();
}

/**
 * «Статистика» модуля по умолчанию скрыта и на ПК, и на телефоне (прототип v88, docs/deviations.md
 * п. И-1): показать плашки-итоги кнопкой, если они ещё не показаны. Выбор запоминается за
 * пользователем, поэтому показанные плашки второй раз не скрываются. Нажатие, попавшее до ответа
 * настроек вида, ответ затирает (кнопка «нажата», плашек нет) — тогда выключить и включить заново.
 */
export async function showStats(page: Page) {
  const toggle = page.locator('[data-stats-toggle]');
  const plates = page.locator('[data-plates]').first();
  await expect(toggle).toBeVisible();
  await expect(async () => {
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true', { timeout: 1_000 });
    try {
      await expect(plates).toBeVisible({ timeout: 3_000 });
    } catch (error) {
      await toggle.click();
      throw error;
    }
  }).toPass();
}

/** Положение элемента, когда анимация появления закончилась (два одинаковых замера подряд). */
export async function settledBox(locator: Locator) {
  let last = '';
  await expect
    .poll(async () => {
      const box = await locator.boundingBox();
      const now = JSON.stringify(box);
      const same = box !== null && now === last;
      last = now;
      return same;
    })
    .toBe(true);
  return (await locator.boundingBox())!;
}

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Свой ИНН (14 цифр) на каждый запуск: второй организации с тем же ИНН быть не может. */
export const uniqueInn = () =>
  `9${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 10_000)
    .toString()
    .padStart(4, '0')}`;

/**
 * Новая организация с владельцем (`pnpm db:create-org`, база сайта — та же, что в .env): владелец
 * входит в `api` и сразу меняет временный пароль. Для проверок, которым нужна организация без
 * истории действий (своя на каждый тест и проект), — демо-организацию они не трогают.
 */
export async function newOrgOwner(api: APIRequestContext, origin: string) {
  const login = uniqueLogin('e2e-org');
  const out = execFileSync(
    'pnpm',
    [
      '--silent',
      'db:create-org',
      '--name',
      `ОсОО «${login}»`,
      '--inn',
      uniqueInn(),
      '--owner-fio',
      'Новикова Сквозная',
      '--owner-login',
      login,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  const temporary = /Временный пароль[^:]*:\s*(\S+)/.exec(out)?.[1];
  expect(temporary, out).toBeTruthy();
  await signIn(api, origin, login, temporary!);
  const changed = await api.post('/api/auth/password', {
    headers: { origin },
    data: { currentPassword: temporary, newPassword: 'Свой-пароль-e2e-1' },
  });
  expect(changed.status(), await changed.text()).toBe(200);
  return login;
}

/**
 * Выбрать контрагента в поле «Контрагент» формы — общий список с поиском (доработки 13.11, задача И3;
 * прототип v93): открыть список, найти по части названия или по цифрам ИНН и нажать на первую строку.
 */
export async function pickContractor(field: Locator, query: string) {
  const page = field.page();
  await field.click();
  await page.getByRole('combobox', { name: 'Поиск контрагента по названию или ИНН' }).fill(query);
  const list = page.getByRole('listbox');
  await list.getByRole('option').first().click();
  await expect(list).toBeHidden();
}
