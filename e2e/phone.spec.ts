import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { finger, settledBox } from './helpers';

// Оболочка на телефоне (задачи #11 и #12): нижняя панель, панель «Меню» с «Другими модулями», протяжка
// вниз панели и окна, листание вкладок свайпом, «Назад» телефона. Касания — настоящие события касания через
// протокол отладки Chromium, с паузами между движениями пальца: так правила жестов видят и
// расстояние, и скорость.
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'demo';
const BOTTOM = ['home', 'cps', 'reports', 'tasks'];

async function signIn(api: APIRequestContext, origin: string) {
  const res = await api.post('/api/auth/login', {
    headers: { origin },
    data: { login: 'erkin', password: DEMO_PASSWORD },
  });
  expect(res.status(), await res.text()).toBe(200);
}

const bottomNav = (page: Page) => page.getByRole('navigation', { name: 'Модули' });
const sheet = (page: Page) => page.getByRole('dialog', { name: 'Меню' });

test.describe('Этап 1: оболочка на телефоне', () => {
  test('на 390 px внизу ровно 4 модуля, «≡ Другие модули» — остальные доступные модули', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await signIn(page.request, origin);
    const me = (await (await page.request.get('/api/auth/me')).json()) as { modules: string[] };
    await page.goto('/app/reports/week');

    if (!isMobile) {
      // На ПК нижней панели нет: все модули — в левой панели, «Меню» скрывает её.
      await expect(bottomNav(page)).toBeHidden();
      await expect(page.getByRole('complementary', { name: 'Модули' })).toBeVisible();
      await page.getByRole('button', { name: 'Меню' }).click();
      await expect(sheet(page)).toBeHidden();
      await expect(page.getByRole('complementary', { name: 'Модули' })).toBeHidden();
      await page.getByRole('button', { name: 'Меню' }).click();
      return;
    }

    const nav = bottomNav(page);
    await expect(nav.getByRole('link')).toHaveText(['Главная', 'Контрагенты', 'Отчёты', 'Задачи']);
    await expect(nav.getByRole('link', { name: 'Отчёты' })).toHaveAttribute('aria-current', 'page');
    // Левой панели на телефоне нет.
    await expect(page.getByRole('complementary', { name: 'Модули' })).toBeHidden();

    await page.getByRole('button', { name: 'Меню' }).click();
    const menu = sheet(page);
    await expect(menu).toBeVisible();
    const other = menu.getByRole('navigation', { name: 'Другие модули' }).getByRole('link');
    const hrefs = await other.evaluateAll((links) => links.map((a) => a.getAttribute('href')!));
    expect(hrefs.map((h) => h.split('/')[2])).toEqual(
      me.modules.filter((m) => !BOTTOM.includes(m)),
    );
    await expect(menu.getByRole('button', { name: 'Выйти из аккаунта' })).toBeVisible();

    // Выбор модуля закрывает панель; «Назад» после него — на прежнюю страницу, а не к панели.
    await other.filter({ hasText: 'Сотрудники' }).click();
    await expect(page).toHaveURL(/\/app\/staff\//);
    await expect(menu).toBeHidden();
    await expect(nav.getByRole('link', { name: 'Отчёты' })).not.toHaveAttribute('aria-current');
    await page.evaluate(() => history.back());
    await expect(page).toHaveURL(/\/app\/reports\/week$/);
    await expect(menu).toBeHidden();
  });

  test('на телефоне форма закрывается протяжкой вниз или рывком, вкладка переключается протяжкой на треть ширины или рывком, недотянутый жест возвращается', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    test.skip(!isMobile, 'Жесты — только на касание; на ПК окна и вкладки закрываются нажатием.');
    await signIn(page.request, new URL(baseURL!).origin);
    await page.goto('/app/home/today');
    await bottomNav(page).getByRole('link', { name: 'Отчёты' }).click();
    await expect(page).toHaveURL(/\/app\/reports\/week$/);
    const swipe = await finger(page);
    const menu = sheet(page);
    const openMenu = async () => {
      await page.getByRole('button', { name: 'Меню' }).click();
      await expect(menu).toHaveAttribute('data-open', 'true');
      // Панель выехала до конца.
      await expect
        .poll(() => menu.evaluate((el) => getComputedStyle(el).translate))
        .toMatch(/^(none|0px( 0px)?)$/);
      const box = (await menu.boundingBox())!;
      return { x: box.x + box.width / 2, y: box.y + 8, height: box.height };
    };

    const handle = await openMenu();
    await test.step('панель «Меню»: короткая медленная протяжка вниз — возвращается на место', async () => {
      await swipe.drag(handle, { x: handle.x, y: handle.y + 40 });
      await page.waitForTimeout(400);
      await expect(menu).toBeVisible();
      expect((await menu.boundingBox())!.y).toBeCloseTo(handle.y - 8, 0);
    });

    await test.step('протяжка вниз дальше четверти высоты — закрывается', async () => {
      const dy = Math.min(handle.height / 4, 160) + 30;
      await swipe.drag(handle, { x: handle.x, y: handle.y + dy });
      await expect(menu).toBeHidden();
      await expect(page).toHaveURL(/\/app\/reports\/week$/);
    });

    await test.step('короткий рывок вниз — закрывается', async () => {
      const handle = await openMenu();
      await swipe.flick(handle, { x: handle.x, y: handle.y + 80 });
      await expect(menu).toBeHidden();
    });

    await test.step('окно («?»): короткая протяжка за шапку — возвращается, дальше четверти высоты — закрывается, рывок вниз — закрывается', async () => {
      const help = page.getByRole('dialog', { name: 'Отчеты для сдачи' });
      const openHelp = async () => {
        await page.getByRole('button', { name: 'Помощь' }).click();
        const box = await settledBox(help);
        // Шторка снизу во всю ширину.
        expect(box.width).toBeCloseTo(390, 0);
        expect(box.y + box.height).toBeCloseTo(844, 0);
        return { x: box.x + box.width / 2, y: box.y + 30, top: box.y, height: box.height };
      };
      const head = await openHelp();
      const threshold = Math.min(head.height / 4, 160);
      // Пока окно тянут, светлеет только фон за ним, само окно остаётся непрозрачным.
      await swipe.drag(head, { x: head.x, y: head.y + threshold / 2 }, async () => {
        const seen = await help.evaluate((el) => {
          // Видимая прозрачность — с учётом всех родителей.
          let windowOpacity = 1;
          for (let n: Element | null = el; n; n = n.parentElement) {
            windowOpacity *= Number(getComputedStyle(n).opacity);
          }
          const covers = document.querySelectorAll('.bg-cover');
          const cover = covers[covers.length - 1]!;
          return { windowOpacity, coverOpacity: Number(getComputedStyle(cover).opacity) };
        });
        expect(seen.windowOpacity).toBe(1);
        expect(seen.coverOpacity).toBeLessThan(1);
      });
      await page.waitForTimeout(400);
      await expect(help).toBeVisible();
      expect((await help.boundingBox())!.y).toBeCloseTo(head.top, 0);
      await swipe.drag(head, { x: head.x, y: head.y + threshold + 30 });
      await expect(help).toBeHidden();
      await expect(page).toHaveURL(/\/app\/reports\/week$/);
      const again = await openHelp();
      await swipe.flick(again, { x: again.x, y: again.y + 80 });
      await expect(help).toBeHidden();
    });

    const pane = (await page.locator('main').boundingBox())!;
    const y = pane.y + pane.height * 0.6;
    const left = { x: pane.x + pane.width * 0.85, y };
    const right = { x: pane.x + pane.width * 0.15, y };
    const tab = (name: string) => page.getByRole('tab', { name, exact: true });

    await test.step('вкладки: медленно на 60 px — страница возвращается, вкладка та же', async () => {
      await swipe.drag(left, { x: left.x - 60, y });
      await page.waitForTimeout(400);
      await expect(page).toHaveURL(/\/app\/reports\/week$/);
      await expect(tab('На неделе')).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('main')).not.toHaveAttribute('data-paging');
    });

    await test.step('протяжка влево дальше трети ширины — следующая вкладка', async () => {
      await swipe.drag(left, { x: left.x - pane.width / 3 - 40, y });
      await expect(page).toHaveURL(/\/app\/reports\/overdue$/);
      await expect(tab('Просрочено')).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('main')).not.toHaveAttribute('data-paging');
    });

    await test.step('у левого края экрана и на ряду вкладок свайп не листает', async () => {
      await swipe.flick({ x: 12, y }, { x: 300, y });
      const row = (await page.getByRole('tablist').boundingBox())!;
      const onRow = { x: row.x + row.width * 0.8, y: row.y + row.height / 2 };
      await swipe.drag(onRow, { x: onRow.x - 200, y: onRow.y });
      await page.waitForTimeout(400);
      await expect(page).toHaveURL(/\/app\/reports\/overdue$/);
    });

    await test.step('рывок вправо — предыдущая вкладка', async () => {
      await swipe.flick(right, { x: right.x + 80, y });
      await expect(page).toHaveURL(/\/app\/reports\/week$/);
    });

    await test.step('с первой вкладки вправо — не переходит по кругу', async () => {
      await swipe.drag(right, { x: right.x + pane.width / 2, y });
      await page.waitForTimeout(400);
      await expect(page).toHaveURL(/\/app\/reports\/week$/);
    });

    await test.step('касание вне панели, Esc и «Назад» телефона — закрывают, страница та же', async () => {
      await openMenu();
      await page.touchscreen.tap(200, 40);
      await expect(menu).toBeHidden();
      await openMenu();
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      await openMenu();
      await page.evaluate(() => history.back());
      await expect(menu).toBeHidden();
      await expect(page).toHaveURL(/\/app\/reports\/week$/);
    });

    await test.step('при открытом меню «+» свайп по нему не листает вкладки; «Назад» закрывает окошко и уходит со страницы', async () => {
      await page.getByRole('button', { name: 'Добавить', exact: true }).click();
      const add = page.getByRole('menu', { name: 'Добавить' });
      await expect(add).toBeVisible();
      const box = (await add.boundingBox())!;
      const from = { x: box.x + box.width - 12, y: box.y + box.height / 2 };
      await swipe.drag(from, { x: from.x - pane.width / 2, y: from.y });
      await page.waitForTimeout(400);
      await expect(page).toHaveURL(/\/app\/reports\/week$/);
      await expect(add).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(add).toBeHidden();
      // Окошко «ⓘ» в верхней панели: заглушки в истории у него нет, «Назад» закрывает его и уходит на
      // прежнюю страницу (заглушка панели «Меню» уже снята, вкладки после свайпа историю не копят).
      await page.getByRole('button', { name: 'Описание модуля' }).click();
      const info = page.getByRole('dialog', { name: 'Описание модуля' });
      await expect(info).toBeVisible();
      await page.evaluate(() => history.back());
      await expect(page).toHaveURL(/\/app\/home\/today$/);
      await expect(info).toBeHidden();
    });
  });

  test('на телефоне вкладки окна (карточка сотрудника) листаются протяжкой по содержимому на треть ширины или рывком, недотянутая протяжка возвращается', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    test.skip(!isMobile, 'Жесты — только на касание; на ПК вкладки переключаются нажатием.');
    await signIn(page.request, new URL(baseURL!).origin);
    const swipe = await finger(page);
    const me = (await (await page.request.get('/api/auth/me')).json()) as {
      employee: { fullName: string };
    };
    const name = me.employee.fullName;
    await page.goto('/app/staff/list');
    await page.getByRole('button', { name: 'Поиск', exact: true }).click();
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
    // Точки на содержимом карточки: высота шторки зависит от вкладки, поэтому замер — перед жестом.
    const at = async (part: number) => {
      const box = await settledBox(card);
      return { x: box.x + box.width * part, y: box.y + box.height * 0.6, width: box.width };
    };
    let from = await at(0.85);
    await swipe.drag(from, { x: from.x - 60, y: from.y });
    await page.waitForTimeout(400);
    await expect(current).toContainText('Основное');
    from = await at(0.85);
    await swipe.drag(from, { x: from.x - from.width / 3 - 40, y: from.y });
    await expect(current).toContainText('Контрагенты');
    await expect(card).toContainText('Нет закреплённых контрагентов');
    from = await at(0.15);
    await swipe.flick(from, { x: from.x + 80, y: from.y });
    await expect(current).toContainText('Основное');
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();
    await expect(page).toHaveURL(/\/app\/staff\/list$/);
  });

  test('телефон: поиск раскрывается значком, при открытой клавиатуре нет нижней панели и «+»', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    test.skip(!isMobile, 'Поиск значком и экранная клавиатура — только на телефоне.');
    await signIn(page.request, new URL(baseURL!).origin);
    await page.goto('/app/cps/all');
    const search = page.getByRole('searchbox', { name: 'Поиск по текущей вкладке' });
    const add = page.getByRole('button', { name: 'Добавить', exact: true });
    await expect(search).toBeHidden();
    await expect(add).toBeVisible();

    await page.getByRole('button', { name: 'Поиск', exact: true }).click();
    await expect(search).toBeFocused();
    await expect(page.getByRole('button', { name: 'Меню' })).toBeHidden();
    await expect(bottomNav(page)).toBeHidden();
    await expect(add).toBeHidden();

    // Пустое поле при уходе фокуса сворачивается, нижняя панель возвращается.
    await search.blur();
    await expect(search).toBeHidden();
    await expect(bottomNav(page)).toBeVisible();
    await expect(add).toBeVisible();
  });
});
