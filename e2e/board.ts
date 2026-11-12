import { expect, type Locator, type Page } from '@playwright/test';

// Общие шаги сквозных тестов вида «Доска» (прототип v84, ui/grid.js `kanbanHtml`).

/**
 * Включить вид «Доска»: на ПК — третья кнопка переключателя; на телефоне кнопка вида называет
 * следующий вид по кругу, после «Карточек» (вид телефона по умолчанию) — «Доска».
 */
export async function openBoard(page: Page, isMobile: boolean): Promise<Locator> {
  const grid = page.locator('[data-grid]');
  const name = isMobile ? 'Вид списка: Доска' : 'Доска';
  await grid.getByRole('button', { name, exact: true }).click();
  const board = grid.locator('[data-grid-board]');
  await expect(board).toBeVisible();
  return board;
}

/**
 * Перенос карточки в столбец: на ПК — перетаскиванием, на телефоне — пунктом меню карточки
 * «Перенести в столбец…» (перетаскивания на телефоне нет).
 */
export async function moveCard(
  page: Page,
  isMobile: boolean,
  card: Locator,
  column: Locator,
  name: string,
) {
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

/** Выбрать поле столбцов доски: «Столбцы: …» → пункт меню. */
export async function boardBy(page: Page, name: string) {
  await page.locator('[data-grid] [data-grid-board-by]').click();
  await page.getByRole('menu').getByText(name, { exact: true }).click();
}
