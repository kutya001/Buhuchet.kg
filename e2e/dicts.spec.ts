import { expect, test, type Page } from '@playwright/test';
import { DEMO_PASSWORD, signIn } from './helpers';

// «Справочники» → «Виды отчётов» (задача 2.02, #58): список видов каталога платформы глазами
// организации и форма просмотра вида. Здесь только просмотр; подключение и настройки, которые меняют
// демо-организацию, — в dicts.shared.spec.ts.

/** Общий поиск по вкладке (на телефоне — кнопкой «Поиск» в верхней панели). */
async function search(page: Page, isMobile: boolean, text: string) {
  if (isMobile) await page.getByRole('button', { name: 'Поиск', exact: true }).click();
  await page.getByRole('searchbox').first().fill(text);
}

test.describe('Этап 2: справочники — виды отчётов', () => {
  test('(п. 35) в «Виды отчётов» открыли НДС: описание, блок «Налог: НДС на облагаемые поставки» с разделами и «Сверить», внизу «Настройки организации» с напоминаниями', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    await signIn(page.request, new URL(baseURL!).origin, 'erkin', DEMO_PASSWORD);
    await page.goto('/app/dicts/types');
    await expect(page.getByText('Каталог видов отчётов один на всю платформу')).toBeVisible();
    await search(page, isMobile, 'НДС');
    const row = page.locator('[data-grid] [data-id="nds"]');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Сдача + уплата');
    await row.getByText('НДС', { exact: true }).first().click();

    const view = page.getByRole('dialog', { name: 'НДС' });
    await expect(view).toContainText('STI-062 · ГНС · до 25-го числа месяца после отчётного');
    // Описание отчёта простым языком и «Что это за отчёт».
    await expect(view).toContainText('Что это за отчёт');
    await expect(view).toContainText('Налог на добавленную стоимость с продаж товаров');
    // Один налог — раскрытым блоком «Налог: …» со всеми разделами формы просмотра налога.
    const tax = view.locator('details[data-tax]');
    await expect(tax).toHaveCount(1);
    await expect(tax).toHaveAttribute('open', '');
    await expect(tax.locator('summary')).toContainText('Налог: НДС на облагаемые поставки');
    for (const section of [
      'Что это',
      'Кто платит и с чего',
      'Ставки',
      'Сроки',
      'Связи',
      'Важно знать',
      'Статья НК',
    ]) {
      await expect(tax.getByRole('heading', { name: section, exact: true })).toBeVisible();
    }
    await expect(tax).toContainText('Сверить:');
    // Последним блоком — «Настройки организации» с днями напоминаний и «в день срока — всегда».
    const settings = view.locator('[data-type-settings]');
    await settings.scrollIntoViewIfNeeded();
    await expect(settings).toContainText('Настройки организации');
    await expect(settings).toContainText('Напоминать до срока, за дней');
    await expect(settings.locator('[data-chip]').first()).toBeVisible();
    await expect(settings).toContainText('в день срока — всегда');
    await expect(settings).toContainText('Квитанция о приёме обязательна');
    await view.getByRole('button', { name: 'Отмена' }).click();
    await expect(view).toBeHidden();
  });

  test('без права «Вести справочники организации» список и форма вида — только для просмотра', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    // Демо-бухгалтер (роль «Бухгалтер»): права на справочники нет.
    await signIn(page.request, new URL(baseURL!).origin, 'aigerim', DEMO_PASSWORD);
    await page.goto('/app/dicts/types');
    await search(page, isMobile, 'НДС');
    const row = page.locator('[data-grid] [data-id="nds"]');
    await expect(row.getByRole('switch').first()).toBeDisabled();
    await row.getByText('НДС', { exact: true }).first().click();
    const view = page.getByRole('dialog', { name: 'НДС' });
    await expect(view.locator('[data-type-settings]')).toContainText('Настройки организации');
    await expect(view.getByRole('button', { name: 'Сохранить' })).toHaveCount(0);
    await expect(view.getByPlaceholder('+ день')).toHaveCount(0);
    await view.getByRole('button', { name: 'Закрыть' }).last().click();
    await expect(view).toBeHidden();
  });
});
