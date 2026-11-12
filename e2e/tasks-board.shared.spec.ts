import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { DEMO_PASSWORD, signIn } from './helpers';

// Вид «Доска» списка (прототип v84, ui/grid.js `kanbanHtml`; доска задач — modules/tasks.js
// `taskKanban`) через настоящий сайт. Вид списка хранится у пользователя, поэтому файл
// *.shared.spec.ts: идёт после остальных тестов и по одному (playwright.config.ts) — другим тестам
// бухгалтера Алишера доска вместо таблицы не достанется; в конце вид списка сбрасывается.

const GRID_KEY = 'tasks.mine';

const uniqueTitle = (text: string) =>
  `${text} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

interface FormOptions {
  categories: { code: string; name: string }[];
  executors: { id: string; shortName: string }[];
}

/** Главный бухгалтер ставит задачу через API: исполнитель — Алишер Т., с подтверждением. */
async function createTask(chief: APIRequestContext, origin: string, title: string) {
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
      dueDate: '2099-12-30',
      needFile: false,
      confirm: true,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { id: string };
}

const resetView = (api: APIRequestContext, origin: string) =>
  api.delete(`/api/view-settings/${GRID_KEY}`, { headers: { origin } });

/**
 * Перенос карточки в столбец: на ПК — перетаскиванием, на телефоне — пунктом меню карточки
 * «Перенести в столбец…» (перетаскивания на телефоне нет).
 */
async function move(page: Page, isMobile: boolean, card: Locator, column: Locator, name: string) {
  if (!isMobile) {
    // Перетаскивание начинается там, где нажата кнопка мыши: сначала сдвинуть карточку, и только
    // потом доска прокручивается к столбцу (`dragTo` прокручивает до начала перетаскивания).
    await card.hover();
    await page.mouse.down();
    const box = (await card.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2 + 10, { steps: 3 });
    await column.hover();
    return page.mouse.up();
  }
  await card.getByRole('button', { name: 'Действия' }).click();
  await page.getByRole('menuitem', { name: 'Перенести в столбец…' }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

test.describe('Этап 3: вид «Доска» в задачах', () => {
  test('(проверка прототипа v84) «Доска» задач: столбцы статусов с числом записей; перенос карточки в «В работе» берёт задачу в работу, в «Выполнена» — открывает окно «Задача выполнена»; недопустимый перенос — отказ с причиной; «Столбцы: Исполнитель» раскладывает по сотрудникам', async ({
    page,
    playwright,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    const title = uniqueTitle('Сверить акт с банком');
    const chief = await playwright.request.newContext({ baseURL });
    await signIn(chief, origin, 'meerim', DEMO_PASSWORD);
    const { id } = await createTask(chief, origin, title);
    await chief.dispose();

    await signIn(page.request, origin, 'alisher', DEMO_PASSWORD);
    await resetView(page.request, origin);
    try {
      await page.goto('/app/tasks/mine');
      const grid = page.locator('[data-grid]');
      await expect(grid.locator(`[data-id="${id}"]`)).toBeVisible();

      // Вид «Доска»: на ПК — третья кнопка переключателя, на телефоне — кнопка вида по кругу.
      if (isMobile) await grid.getByRole('button', { name: 'Вид списка: Доска' }).click();
      else await grid.getByRole('button', { name: 'Доска', exact: true }).click();
      const board = grid.locator('[data-grid-board]');
      await expect(board).toBeVisible();
      const column = (key: string) => board.locator(`[data-board-column="${key}"]`);
      const cardOf = `[data-board-card][data-id="${id}"]`;
      const card = board.locator(cardOf);
      /** Столбец, в котором сейчас карточка задачи. */
      const own = board.locator('[data-board-column]').filter({ has: page.locator(cardOf) });

      // Столбцы статусов видны и пустыми; в шапке — число записей; группировки на доске нет.
      for (const [key, name] of [
        ['todo', 'К выполнению'],
        ['in_progress', 'В работе'],
        ['on_confirm', 'На подтверждении'],
        ['done', 'Выполнена'],
      ] as const) {
        await expect(column(key).locator('header')).toContainText(name);
        await expect(column(key).locator('[data-board-count]')).toHaveText(/^\d+$/);
      }
      await expect(grid.locator('[data-grid-board-by]')).toBeVisible();
      await expect(grid.locator('[data-grid-group-button]')).toHaveCount(0);
      await expect(grid.locator('[data-grid-footer]')).toContainText(
        /Столбцов: \d+ · записей: \d+/,
      );
      await expect(grid.locator('[data-board-tip]')).toHaveText(
        isMobile ? 'Перенос — в меню карточки «⋯»' : 'Карточку можно перетащить в другой столбец',
      );
      await expect(column('todo').locator(cardOf)).toBeVisible();
      await expect(card).toContainText(title);

      // «В работе»: то же, что «Взять в работу» в меню.
      await move(page, isMobile, card, column('in_progress'), 'В работе');
      await expect(page.getByRole('status').filter({ hasText: 'Задача в работе' })).toBeVisible();
      await expect(column('in_progress').locator(cardOf)).toBeVisible();

      // «Выполнена»: окно «Задача выполнена»; с подтверждением задача уходит в «На подтверждении».
      await move(page, isMobile, card, column('done'), 'Выполнена');
      const done = page.getByRole('dialog', { name: 'Задача выполнена' });
      await done.getByRole('button', { name: 'Выполнена' }).click();
      await expect(done).toBeHidden();
      await expect(column('on_confirm').locator(cardOf)).toBeVisible();

      // Недопустимый перенос — уведомление с причиной, карточка остаётся на месте.
      await move(page, isMobile, card, column('todo'), 'К выполнению');
      await expect(
        page.getByRole('status').filter({
          hasText: 'Из «На подтверждении» в «К выполнению» задачу перевести нельзя',
        }),
      ).toBeVisible();
      await expect(column('on_confirm').locator(cardOf)).toBeVisible();

      // «Столбцы: Исполнитель»: та же доска по сотрудникам; выбор запоминается.
      await grid.locator('[data-grid-board-by]').click();
      await page.getByRole('menu').getByText('Исполнитель', { exact: true }).click();
      await expect(own.locator('header')).toContainText('Алишер Т.');
      await page.reload();
      await expect(own.locator('header')).toContainText('Алишер Т.');

      // Нажатие на карточку открывает карточку задачи.
      await card.getByText(title, { exact: true }).click();
      await expect(page.getByRole('dialog', { name: title })).toBeVisible();
    } finally {
      await resetView(page.request, origin);
    }
  });
});
