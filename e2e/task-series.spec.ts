import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { DEMO_PASSWORD, expandCard, signIn } from './helpers';

// Повторяющиеся задачи (доработки 28.11.2026, блоки 2–4; прототип v168 modules/task-series.js) через
// настоящий сайт: окно «Повтор» в форме задачи, значок ↻ и столбец «Повтор» в списке, строка «Повтор» в
// карточке («Все задачи серии», «Остановить повтор», «Возобновить»), вопрос «Только эту задачу / Эту и
// следующие» при правке и отмене, вкладка «Повторы». Ставит серии главный бухгалтер демо-организации
// (meerim, право «Ставить задачи»); каждая серия — со своим названием, по нему она находится поиском, общие
// записи не трогаются. Ночной запуск (следующая задача после срока, пропуск, остановка без человека,
// «Повтор закончился») — тесты API с подставными часами: `packages/api/src/modules/tasks/series.test.ts`.

const uniqueTitle = (text: string) =>
  `${text} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Понедельник далеко впереди: задачи серии не просрочены и не мешают чужим спискам «на сегодня». */
const START = '2099-11-02';

/** Общий поиск по вкладке (на телефоне — кнопкой «Поиск» в верхней панели). */
async function search(page: Page, isMobile: boolean, text: string) {
  if (isMobile) await page.getByRole('button', { name: 'Поиск', exact: true }).click();
  await page.getByRole('searchbox').first().fill(text);
}

const toast = (page: Page, text: string | RegExp) =>
  expect(page.getByRole('status').filter({ hasText: text })).toBeVisible();

async function apiAs(
  playwright: { request: { newContext: (o: { baseURL?: string }) => Promise<APIRequestContext> } },
  baseURL: string,
  login: string,
) {
  const api = await playwright.request.newContext({ baseURL });
  await signIn(api, new URL(baseURL).origin, login, DEMO_PASSWORD);
  return api;
}

interface FormOptions {
  categories: { code: string; name: string }[];
  executors: { id: string; shortName: string }[];
}

/** Главный бухгалтер ставит задачу с повтором «каждую неделю по понедельникам» через API. */
async function createSeriesTask(chief: APIRequestContext, origin: string, title: string) {
  const options = (await (await chief.get('/api/tasks/form-options')).json()) as FormOptions;
  const res = await chief.post('/api/tasks', {
    headers: { origin },
    data: {
      title,
      description: '',
      categoryCode: options.categories[0]!.code,
      contractorId: null,
      executorEmployeeId: options.executors.find((e) => e.shortName === 'Алишер Т.')!.id,
      term: 'day',
      dueDate: START,
      needFile: false,
      confirm: false,
      repeat: { every: 1, unit: 'week', weekDays: [0], end: { kind: 'never' } },
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { id: string };
}

/** Строка вкладки по названию → карточка задачи. */
async function openCard(page: Page, isMobile: boolean, tab: string, title: string) {
  await page.goto(`/app/tasks/${tab}`);
  await expect(page.locator('[data-grid]')).toBeVisible();
  await search(page, isMobile, title);
  const row = page.locator('[data-grid] [data-id]').filter({ hasText: title });
  await expect(row).toHaveCount(1);
  await row.getByText(title, { exact: true }).click();
  const card = page.getByRole('dialog', { name: title });
  await expect(card.locator('[data-task-card]')).toBeVisible();
  return { row, card };
}

/** Пункт «Действия» карточки задачи. */
async function cardAction(page: Page, card: Locator, name: string) {
  await card.locator('[data-task-more]').click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

test.describe('Доработки 28.11: повторяющиеся задачи', () => {
  test('(блок 2, блок 4) главный бухгалтер ставит задачу с повтором: окно «Повтор», значок ↻ в списке, строка «Повтор» в карточке, «Все задачи серии», запись «Повтор настроен» и строка во вкладке «Повторы»', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const title = uniqueTitle('Разобрать почту');
    await signIn(page.request, new URL(baseURL!).origin, 'meerim', DEMO_PASSWORD);
    await page.goto('/app/tasks/byme');
    await expect(page.locator('[data-grid]')).toBeVisible();
    await page.getByRole('button', { name: 'Добавить', exact: true }).first().click();
    const form = page.getByRole('dialog', { name: 'Новая задача' });
    await form.getByLabel(/^Название/).fill(title);
    await form.getByLabel(/^Исполнитель/).selectOption({ label: 'Алишер Т.' });
    await form.getByLabel(/^Дата/).fill(START);
    const repeat = form.locator('button[data-task-repeat]');
    await expect(repeat).toHaveText('Не повторять');

    // Окно «Повтор»: по умолчанию — каждую неделю в день начала (прототип `tsDlg`).
    await repeat.click();
    const dlg = page.getByRole('dialog', { name: 'Повтор' });
    await expect(dlg.locator('[data-series-unit]')).toHaveValue('week');
    await expect(dlg.locator('[data-series-day="0"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(dlg.locator('[data-series-start]')).toHaveValue(START);
    await dlg.locator('[data-series-day="3"]').click();
    await dlg.locator('[data-series-end="count"]').check();
    await dlg.locator('[data-series-end-count]').fill('3');
    await expect(dlg.locator('[data-series-preview]')).toHaveText(
      'Каждую неделю: пн, чт · 3 повтора',
    );
    await dlg.locator('[data-series-done]').click();
    await expect(dlg).toBeHidden();
    await expect(repeat).toHaveText('Каждую неделю: пн, чт · 3 повтора');
    await form.getByRole('button', { name: 'Поставить задачу' }).click();
    await expect(form).toBeHidden();
    await toast(page, 'Задача с повтором поставлена: Алишер Т.');

    // Список: значок ↻ с правилом в подсказке перед названием.
    await search(page, isMobile, title);
    const row = page.locator('[data-grid] [data-id]').filter({ hasText: title });
    await expect(row).toHaveCount(1);
    await expect(row.locator('[data-series-icon]')).toHaveAttribute(
      'title',
      'Повтор: Каждую неделю: пн, чт · 3 повтора',
    );

    // Карточка: строка «Повтор» с правилом и следующей датой, «Все задачи серии · 1».
    await row.getByText(title, { exact: true }).click();
    const card = page.getByRole('dialog', { name: title });
    const line = card.locator('[data-task-series="active"]');
    await expect(line).toContainText('Повтор: Каждую неделю: пн, чт · 3 повтора');
    await expect(line).toContainText('следующая 05.11.2099');
    await line.locator('[data-series-all]').click();
    const all = page.getByRole('dialog', { name: 'Все задачи серии' });
    await expect(all).toContainText(`${title} · Каждую неделю: пн, чт · 3 повтора`);
    await expect(all.locator('[data-series-task]')).toHaveCount(1);
    await expect(all.locator('[data-series-task]')).toContainText('02.11.2099');
    await page.keyboard.press('Escape');
    await expect(all).toBeHidden();
    await expandCard(card);
    await expect(card.locator('details[data-task-history]')).toContainText(
      'Повтор настроен: Каждую неделю: пн, чт · 3 повтора',
    );
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();

    // Вкладка «Повторы»: строка серии — «Действует», окончание «3 повтора», «Следующая» — ближайшая открытая
    // задача серии (прототип `tsNear`), а не дата, которую поставит ночной запуск.
    await page.goto('/app/tasks/series');
    await expect(page.locator('[data-series-list] [data-grid]')).toBeVisible();
    await search(page, isMobile, title);
    const series = page.locator('[data-grid] [data-id]').filter({ hasText: title });
    await expect(series).toHaveCount(1);
    await expect(series.locator('[data-series-state="active"]')).toContainText('Действует');
    await expect(series).toContainText('3 повтора');
    await expect(series).toContainText('02.11.2099');
  });

  test('(блок 3) «Остановить повтор» и «Возобновить» в карточке; «Изменить» задачу серии спрашивает «Только эту задачу / Эту и следующие»; «Отменить задачу» с «Эту и следующие» останавливает повтор', async ({
    page,
    playwright,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    const title = uniqueTitle('Сверка выписки');
    const chief = await apiAs(playwright, baseURL!, 'meerim');
    await createSeriesTask(chief, origin, title);
    await chief.dispose();

    await signIn(page.request, origin, 'meerim', DEMO_PASSWORD);
    let { card } = await openCard(page, isMobile, 'byme', title);
    const line = card.locator('[data-task-series]');
    await expect(line).toHaveAttribute('data-task-series', 'active');

    // «Остановить повтор» — после вопроса; строка — «остановлен», вместо кнопки — «Возобновить».
    await line.locator('[data-series-stop]').click();
    const ask = page.getByRole('dialog', { name: 'Остановить повтор?' });
    await ask.getByRole('button', { name: 'Остановить повтор' }).click();
    await toast(page, 'Повтор остановлен');
    await expect(line).toHaveAttribute('data-task-series', 'stopped');
    await expect(line).toContainText('остановлен');
    await line.locator('[data-series-resume]').click();
    await toast(page, /^Повтор возобновлён/);
    await expect(line).toHaveAttribute('data-task-series', 'active');

    // «Изменить»: правило не меняли — «Только эту задачу» доступна; «Эту и следующие» — для всей серии.
    await cardAction(page, card, 'Изменить');
    const form = page.getByRole('dialog', { name: 'Изменить задачу' });
    await form.getByLabel(/^Название/).fill(`${title} и остатков`);
    await form.getByRole('button', { name: 'Сохранить' }).click();
    const scope = page.getByRole('dialog', { name: 'Изменить задачу серии' });
    await expect(scope.locator('[data-series-scope-pick="one"]')).toBeEnabled();
    await scope.locator('[data-series-scope-pick="next"]').check();
    await scope.locator('[data-series-scope-ok]').click();
    await toast(page, 'Сохранено: эта и следующие задачи серии');
    await expect(form).toBeHidden();
    await page.keyboard.press('Escape');

    // «Отменить задачу» → «Эту и следующие»: задача отменена, повтор остановлен.
    ({ card } = await openCard(page, isMobile, 'byme', `${title} и остатков`));
    await cardAction(page, card, 'Отменить задачу');
    const cancel = page.getByRole('dialog', { name: 'Отменить задачу серии?' });
    await cancel.locator('[data-series-scope-pick="next"]').check();
    await cancel.locator('[data-series-scope-ok]').click();
    await toast(page, 'Задача отменена, повтор остановлен');

    // Вкладка «Повторы»: серия остановлена, в меню строки — «Возобновить», «Остановить повтор» нет.
    await page.goto('/app/tasks/series');
    await expect(page.locator('[data-series-list] [data-grid]')).toBeVisible();
    await search(page, isMobile, title);
    const row = page.locator('[data-grid] [data-id]').filter({ hasText: title });
    await expect(row.locator('[data-series-state="stopped"]')).toContainText('Остановлена');
  });

  test('(блок 4) вкладку «Повторы» и методы серий видят только те, кто ставит задачи: у бухгалтера вкладки нет, список — 403', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    await signIn(page.request, origin, 'alisher', DEMO_PASSWORD);
    expect((await page.request.get('/api/task-series')).status()).toBe(403);
    await page.goto('/app/tasks/mine');
    await expect(page.locator('[data-grid]')).toBeVisible();
    await expect(page.getByRole('tab', { name: /^Мои/ }).first()).toBeVisible();
    await expect(page.getByRole('tab', { name: /^Повторы/ })).toHaveCount(0);
  });
});
