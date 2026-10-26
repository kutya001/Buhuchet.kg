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

/** Владелец демо-организации (erkin) создаёт сотрудника с ролью «Бухгалтер» и временным паролем. */
export async function hire(api: APIRequestContext, origin: string, login: string) {
  await signIn(api, origin, 'erkin', DEMO_PASSWORD);
  const roles = (await (await api.get('/api/roles')).json()) as {
    items: { id: string; name: string }[];
  };
  const res = await api.post('/api/staff', {
    headers: { origin },
    data: {
      fullName: 'Входов Сквозной Тестович',
      login,
      roleId: roles.items.find((r) => r.name === 'Бухгалтер')!.id,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  await api.post('/api/auth/logout', { headers: { origin } });
  return (await res.json()) as { temporaryPassword: string };
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
