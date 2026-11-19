import { expect, type Locator, type Page } from '@playwright/test';
import { onPhone, phoneListMenu } from './helpers';

// Общие шаги сквозных тестов вида «Доска» (прототип v84, ui/grid.js `kanbanHtml`).

/**
 * Включить вид «Доска»: на ПК — третья кнопка переключателя; на телефоне — пункт «Доска» под «⋯»
 * над списком (прототип v139).
 */
export async function openBoard(page: Page, isMobile: boolean): Promise<Locator> {
  const grid = page.locator('[data-grid]');
  if (isMobile) await phoneListMenu(page, /^Доска/);
  else await grid.getByRole('button', { name: 'Доска', exact: true }).click();
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

/** Выбрать поле столбцов доски: «Столбцы: …» (на телефоне — «Столбцы доски» под «⋯») → пункт меню. */
export async function boardBy(page: Page, name: string) {
  if (onPhone(page)) await phoneListMenu(page, /^Столбцы доски/);
  else await page.locator('[data-grid] [data-grid-board-by]').click();
  await page.getByRole('menu').getByText(name, { exact: true }).click();
}
