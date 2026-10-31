import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { finger, settledBox } from './helpers';

// Окна и уведомления оболочки (задача #12) через настоящий сайт. Карточек записей ещё нет: окно —
// помощь «?» (статья «Базы знаний» о модуле, как kbHelp прототипа), уведомление — выбор способа
// в «+ Добавить» на экране-заглушке. Выбор «На весь экран» хранится в cookie браузера теста.
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'demo';

async function signIn(api: APIRequestContext, origin: string) {
  const res = await api.post('/api/auth/login', {
    headers: { origin },
    data: { login: 'erkin', password: DEMO_PASSWORD },
  });
  expect(res.status(), await res.text()).toBe(200);
}

const helpWindow = (page: Page) => page.getByRole('dialog', { name: 'Отчеты для сдачи' });

async function openHelp(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Помощь' }).click();
  const help = helpWindow(page);
  await expect(help).toContainText('Главный рабочий модуль');
  return help;
}

/** Совпадает ли прямоугольник с ожидаемым с точностью до пикселя. */
function expectBox(
  box: { x: number; y: number; width: number; height: number },
  want: { x: number; y: number; width: number; height: number },
) {
  for (const k of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(box[k] - want[k]), `${k}: ${box[k]} ≠ ${want[k]}`).toBeLessThanOrEqual(1);
  }
}

test.describe('Этап 1: окна и уведомления', () => {
  test('окно по «На весь экран» занимает всё окно браузера, следующее окно тоже развёрнуто, пока его не свернуть', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    await signIn(page.request, new URL(baseURL!).origin);
    await page.goto('/app/reports/week');
    const view = page.viewportSize()!;
    // Размер окна меряется, пока не совпадёт с ожидаемым (`toPass`): на медленной машине CI два
    // одинаковых замера подряд могут прийтись на окно, которое ещё не начало переключаться.
    // Обычное окно: на ПК — по центру и уже окна браузера (статья «Базы знаний» — 1 100 px), на
    // телефоне — шторка снизу во всю ширину, не до верха экрана.
    const normal = async (help: Locator) => {
      await expect(help.getByRole('button', { name: 'На весь экран' })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
      await expect(async () => {
        const box = await settledBox(help);
        if (isMobile) {
          expect(box.width).toBeCloseTo(view.width, 0);
          expect(box.y + box.height).toBeCloseTo(view.height, 0);
          expect(box.y).toBeGreaterThan(24);
        } else {
          expect(box.width).toBeCloseTo(Math.min(1100, view.width - 24), 0);
          expect(box.x + box.width / 2).toBeCloseTo(view.width / 2, 0);
        }
      }).toPass();
    };
    // Развёрнутое: на ПК — всё окно браузера с отступом 12 px, на телефоне — весь экран.
    const maximized = async (help: Locator) => {
      const inset = isMobile ? 0 : 12;
      await expect(help.getByRole('button', { name: 'Свернуть окно' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(async () =>
        expectBox(await settledBox(help), {
          x: inset,
          y: inset,
          width: view.width - inset * 2,
          height: view.height - inset * 2,
        }),
      ).toPass();
    };

    let help = await openHelp(page);
    await expect(help).toContainText('База знаний');
    await normal(help);
    const maxButton = help.getByRole('button', { name: 'На весь экран' });
    await expect(maxButton).toHaveAttribute('aria-pressed', 'false');
    if (!isMobile) {
      await expect(maxButton).toHaveAttribute('title', 'На весь экран (двойной клик по заголовку)');
    }
    await maxButton.click();
    await maximized(help);
    // Нижняя строка с кнопками — внизу развёрнутого окна.
    const close = help.getByRole('button', { name: 'Закрыть', exact: true }).last();
    const closeBox = (await close.boundingBox())!;
    expect(closeBox.y + closeBox.height).toBeGreaterThan(view.height - 70);

    await test.step('следующее окно открывается развёрнутым, и после перезагрузки страницы тоже', async () => {
      await help.getByRole('button', { name: 'Закрыть' }).first().click();
      await expect(help).toBeHidden();
      help = await openHelp(page);
      await maximized(help);
      await page.reload();
      help = await openHelp(page);
      await maximized(help);
    });

    await test.step('«Свернуть окно» — окно снова обычное, следующее тоже', async () => {
      await help.getByRole('button', { name: 'Свернуть окно' }).click();
      await normal(help);
      await page.keyboard.press('Escape');
      await expect(help).toBeHidden();
      help = await openHelp(page);
      await normal(help);
    });

    if (isMobile) return; // Двойного клика на телефоне нет.
    await test.step('на ПК двойной клик по шапке разворачивает и сворачивает окно', async () => {
      await help.getByRole('heading', { name: 'Отчеты для сдачи' }).dblclick();
      await maximized(help);
      await help.getByRole('heading', { name: 'Отчеты для сдачи' }).dblclick();
      await normal(help);
    });
  });

  test('карточка сотрудника по «На весь экран»: на ПК таблица на вкладке шире, на телефоне развёрнутая карточка листается свайпом по вкладкам и закрывается свайпом вниз', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    await signIn(page.request, new URL(baseURL!).origin);
    const me = (await (await page.request.get('/api/auth/me')).json()) as {
      employee: { fullName: string };
    };
    const name = me.employee.fullName;
    await page.goto('/app/staff/list');
    if (isMobile) await page.getByRole('button', { name: 'Поиск', exact: true }).click();
    await page.getByRole('searchbox').first().fill(name);
    await page
      .locator('[data-grid] [data-id]')
      .filter({ hasText: name })
      .first()
      .getByText(name, { exact: true })
      .click();
    const card = page.getByRole('dialog', { name });
    const current = card.getByRole('tab', { selected: true });
    await expect(current).toContainText('Основное');
    const view = page.viewportSize()!;

    if (!isMobile) {
      // Таблица закреплённых контрагентов растягивается на всю ширину развёрнутой карточки.
      await card.getByRole('tab', { name: 'Контрагенты' }).click();
      const table = card.getByRole('table', { name: 'Контрагенты' });
      await expect(table).toBeVisible();
      const before = (await settledBox(card)).width;
      const narrow = (await table.boundingBox())!.width;
      await card.getByRole('button', { name: 'На весь экран' }).click();
      // Окно развёрнуто — кнопка сменилась; только потом ждём, пока оно встанет на место.
      await expect(card.getByRole('button', { name: 'Свернуть окно' })).toBeVisible();
      expectBox(await settledBox(card), {
        x: 12,
        y: 12,
        width: view.width - 24,
        height: view.height - 24,
      });
      const wide = (await table.boundingBox())!.width;
      expect(wide - narrow).toBeGreaterThanOrEqual(view.width - 24 - before - 2);
      await card.getByRole('button', { name: 'Свернуть окно' }).click();
      await expect.poll(async () => (await table.boundingBox())!.width).toBeCloseTo(narrow, 0);
      return;
    }

    await card.getByRole('button', { name: 'На весь экран' }).click();
    const box = await settledBox(card);
    expectBox(box, { x: 0, y: 0, width: view.width, height: view.height });
    const swipe = await finger(page);
    const y = box.y + box.height * 0.6;
    const left = { x: box.x + box.width * 0.85, y };
    const right = { x: box.x + box.width * 0.15, y };

    await test.step('протяжка влево дальше трети ширины — вкладка «Контрагенты»', async () => {
      await swipe.drag(left, { x: left.x - box.width / 3 - 40, y });
      await expect(current).toContainText('Контрагенты');
      await expect(card).toContainText('Закреплено контрагентов:');
      // Развёрнутой карточка и осталась.
      expectBox(await settledBox(card), { x: 0, y: 0, width: view.width, height: view.height });
    });

    await test.step('рывок вправо — снова «Основное»', async () => {
      await swipe.flick(right, { x: right.x + 80, y });
      await expect(current).toContainText('Основное');
      await expect(card).toContainText('Последний вход');
    });

    await test.step('протяжка вниз за шапку — карточка закрывается, страница та же', async () => {
      const head = { x: box.x + box.width / 2, y: box.y + 30 };
      await swipe.drag(head, { x: head.x, y: head.y + Math.min(box.height / 4, 160) + 30 });
      await expect(card).toBeHidden();
      await expect(page).toHaveURL(/\/app\/staff\/list$/);
    });
  });

  test('окно закрывается крестиком, Esc, касанием фона и «Назад» на той же странице; фокус не уходит под окно', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    await signIn(page.request, new URL(baseURL!).origin);
    await page.goto('/app/home/today');
    await page.goto('/app/reports/week');
    const helpButton = page.getByRole('button', { name: 'Помощь' });

    let help = await openHelp(page);
    // Фокус — в окне; Tab и Shift+Tab ходят только по кнопкам окна.
    const focusInside = () =>
      page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
    expect(await focusInside()).toBe(true);
    for (const key of ['Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab']) {
      await page.keyboard.press(key);
      expect(await focusInside(), key).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(help).toBeHidden();
    // После закрытия фокус — снова на «?».
    await expect(helpButton).toBeFocused();

    help = await openHelp(page);
    await help.getByRole('button', { name: 'Закрыть' }).first().click();
    await expect(help).toBeHidden();

    help = await openHelp(page);
    await help.getByRole('button', { name: 'Закрыть', exact: true }).last().click();
    await expect(help).toBeHidden();

    // Касание фона вокруг окна (на телефоне — над шторкой).
    help = await openHelp(page);
    await settledBox(help);
    if (isMobile) await page.touchscreen.tap(200, 40);
    else await page.mouse.click(30, 30);
    await expect(help).toBeHidden();

    // «Назад» закрывает окно, страница остаётся; следующее «Назад» уходит на прежнюю страницу.
    help = await openHelp(page);
    await page.evaluate(() => history.back());
    await expect(help).toBeHidden();
    await expect(page).toHaveURL(/\/app\/reports\/week$/);
    await page.evaluate(() => history.back());
    await expect(page).toHaveURL(/\/app\/home\/today$/);

    // «Открыть Базу знаний» из окна: окно закрывается, «Назад» возвращает к модулю, а не к окну.
    await page.goto('/app/reports/week');
    help = await openHelp(page);
    await help.getByRole('link', { name: 'Открыть Базу знаний' }).click();
    await expect(page).toHaveURL(/\/app\/kb\/level$/);
    await expect(help).toBeHidden();
    await page.evaluate(() => history.back());
    await expect(page).toHaveURL(/\/app\/reports\/week$/);
    await expect(helpWindow(page)).toBeHidden();
  });

  test('уведомления внизу экрана стоят столбиком и исчезают сами через 3 секунды; на ПК — крестик, на телефоне — свайп вбок', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    await signIn(page.request, new URL(baseURL!).origin);
    await page.goto('/app/cps/all');
    const view = page.viewportSize()!;
    const add = async (name: string) => {
      await page.getByRole('button', { name: 'Добавить', exact: true }).click();
      await page.getByRole('menu', { name: 'Добавить' }).getByRole('menuitem', { name }).click();
    };
    const toasts = page.getByRole('status');

    // «Контрагент» открывает форму (2.09); уведомление пока дают способы без своего окна.
    await add('Загрузка из Excel');
    const first = toasts.filter({
      hasText: '«Загрузка из Excel» появится вместе с экраном модуля.',
    });
    const box = await settledBox(first);
    // По центру внизу экрана; на телефоне — над нижней панелью.
    expect(box.x + box.width / 2).toBeCloseTo(view.width / 2, 0);
    expect(view.height - (box.y + box.height)).toBeCloseTo(isMobile ? 84 : 22, 0);
    if (!isMobile) {
      // Второе уведомление встаёт под первым. На телефоне уведомление закрывает часть круглой «+»
      // (как в прототипе), поэтому второе там вызывается, когда первое уже исчезло.
      await add('Из свидетельства и выписки');
      const second = toasts.filter({ hasText: '«Из свидетельства и выписки»' });
      await expect(toasts).toHaveCount(2);
      const below = await settledBox(second);
      expect(below.y).toBeGreaterThan((await settledBox(first)).y + box.height - 1);
      expect(view.height - (below.y + below.height)).toBeCloseTo(22, 0);
    }

    await test.step('исчезают сами примерно через 3 секунды', async () => {
      await expect(toasts).toHaveCount(0, { timeout: 6000 });
      await add('Загрузка из Excel');
      await expect(first).toBeVisible();
      await page.waitForTimeout(2400);
      await expect(first).toBeVisible();
      await expect(toasts).toHaveCount(0, { timeout: 2000 });
    });

    const close = page.getByRole('button', { name: 'Закрыть уведомление' });
    if (!isMobile) {
      await test.step('на ПК крестик «Закрыть» убирает уведомление сразу', async () => {
        await add('Загрузка из Excel');
        await expect(close).toHaveAttribute('title', 'Закрыть');
        await close.click();
        await expect(toasts).toHaveCount(0, { timeout: 1000 });
      });
      return;
    }

    await test.step('на телефоне крестика нет; короткий свайп — возвращается, на треть ширины — уходит, вкладка та же', async () => {
      const swipe = await finger(page);
      await add('Загрузка из Excel');
      await expect(close).toBeHidden();
      const toast = await settledBox(first);
      const from = { x: toast.x + toast.width / 2, y: toast.y + toast.height / 2 };
      await swipe.drag(from, { x: from.x - 20, y: from.y });
      await page.waitForTimeout(300);
      await expect(first).toBeVisible();
      expect((await first.boundingBox())!.x).toBeCloseTo(toast.x, 0);
      await swipe.drag(from, { x: from.x - toast.width / 3 - 30, y: from.y });
      await expect(toasts).toHaveCount(0, { timeout: 1000 });
      await expect(page).toHaveURL(/\/app\/cps\/all$/);
    });
  });
});
