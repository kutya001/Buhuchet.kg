import { expect, test, type Page } from '@playwright/test';
import { DEMO_PASSWORD, signIn } from './helpers';

// «Справочники» → «Справочники платформы» (задача 2.03, #59): плитки по группам, окно справочника с
// поиском и описанием значения, «Поиск по всем значениям», «Попросить добавить» и «Мои запросы».

/** Общий поиск по вкладке (на телефоне — кнопкой «Поиск» в верхней панели). */
async function search(page: Page, isMobile: boolean, text: string) {
  if (isMobile) await page.getByRole('button', { name: 'Поиск', exact: true }).click();
  await page.getByRole('searchbox').first().fill(text);
}

async function openTab(page: Page, baseURL: string | undefined, login = 'erkin') {
  await signIn(page.request, new URL(baseURL!).origin, login, DEMO_PASSWORD);
  await page.goto('/app/dicts/platform');
  await expect(page.getByText('Эти списки ведёт только администратор платформы')).toBeVisible();
}

test.describe('Этап 2: справочники платформы для организации', () => {
  test('(п. 36) на вкладке «Справочники платформы» справочники разбиты на группы с заголовками; плитка «Органы» открывает окно с пояснением и столбцом «Что это и что туда сдают»', async ({
    page,
    baseURL,
  }) => {
    await openTab(page, baseURL);
    for (const group of [
      'Налоги и отчёты',
      'Режимы, льготы и статусы',
      'Классификаторы',
      'Органы и банки',
      'Работа системы',
    ]) {
      await expect(page.getByRole('heading', { name: new RegExp(`^${group}`) })).toBeVisible();
    }
    // Служебных справочников администратора у организации нет.
    await expect(page.locator('[data-dict-tile]', { hasText: 'Шаблоны ролей' })).toHaveCount(0);

    const tile = page.locator('[data-dict-tile="organs"]');
    await expect(tile).toContainText('Органы');
    await tile.click();
    const win = page.getByRole('dialog', { name: 'Органы' });
    await expect(win).toContainText('Органы и банки · справочник платформы');
    await expect(win).toContainText('Госорганы и получатели отчётов и платежей.');
    await expect(win).toContainText('Где используется:');
    await expect(
      win.getByRole('columnheader', { name: /Что это и что туда сдают/ }),
    ).toBeAttached();
    const gns = win.locator('[data-grid] [data-id]').filter({ hasText: 'налоговая служба' });
    await expect(gns).toHaveCount(1);

    // Строка органа — окно значения с пояснением и видами отчётов органа.
    await gns.getByText('ГНС', { exact: true }).click();
    const value = page.getByRole('dialog', { name: 'ГНС' });
    await expect(value).toContainText('Органы · справочник платформы');
    await expect(value).toContainText('Что это и что туда сдают');
    await expect(value).toContainText('НДС');
    await value.getByRole('button', { name: 'Закрыть' }).last().click();
    await expect(value).toBeHidden();

    // Поиск в окне — свой: общий поиск под окном недоступен.
    await win.getByRole('searchbox', { name: 'Найти значение' }).fill('Нацстат');
    await expect(win.locator('[data-grid] [data-id]')).toHaveCount(1);
    await win.getByRole('button', { name: 'Закрыть' }).last().click();
    await expect(win).toBeHidden();
  });

  test('плитка «Виды отчётов» ведёт на свою вкладку; «Статусы» — по шкале отчёта; строка ставки ЕН открывает описание', async ({
    page,
    baseURL,
  }) => {
    await openTab(page, baseURL);
    await page.locator('[data-dict-tile="statuses"]').click();
    const statuses = page.getByRole('dialog', { name: 'Статусы' });
    await expect(statuses.locator('[data-grid] [data-id]').first()).toContainText('К сдаче');
    await expect(statuses.locator('[data-grid] [data-id]')).toHaveCount(7);
    await statuses.getByRole('button', { name: 'Закрыть' }).last().click();
    await expect(statuses).toBeHidden();

    await page.locator('[data-dict-tile="en_rates"]').click();
    const rates = page.getByRole('dialog', { name: 'Ставки единого налога' });
    await rates.locator('[data-grid] [data-id="ЕНС-01"]').getByText('ЕНС-01').click();
    const rate = page.getByRole('dialog', { name: /^ЕНС-01 · / });
    await expect(rate).toContainText('Когда применяется');
    await expect(rate).toContainText('Строки суммы в отчёте');
    await expect(rate).toContainText('ст. 423');
    await rate.getByRole('button', { name: 'Закрыть' }).last().click();
    await rates.getByRole('button', { name: 'Закрыть' }).last().click();
    await expect(rates).toBeHidden();

    await page.locator('[data-dict-tile="types"]').click();
    await expect(page).toHaveURL(/\/app\/dicts\/types$/);
    await expect(page.getByText('Каталог видов отчётов один на всю платформу')).toBeVisible();
  });

  test('«Поиск по всем значениям»: справочник и значение по общему поиску', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    await openTab(page, baseURL);
    await search(page, isMobile, 'Нооруз');
    const row = page
      .locator('[data-grid] [data-id]')
      .filter({ hasText: 'Производственный календарь' });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('— Нооруз');
  });

  test('«Попросить добавить»: пустое «Что добавить» — ошибка; запрос виден в «Моих запросах» со статусом «Новый»', async ({
    page,
    baseURL,
  }, testInfo) => {
    // Демо-бухгалтер без права на справочники тоже может попросить.
    await openTab(page, baseURL, 'aigerim');
    const what = `Отчёт по НДС на импорт услуг ${testInfo.project.name} ${Date.now()}`;
    // Без права на справочники в «+ Добавить» один способ — «Попросить добавить»: окно открывается сразу.
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Попросить добавить' });
    await expect(dialog).toContainText('Запрос уйдёт администратору платформы');
    await expect(dialog.getByLabel('Справочник')).toHaveValue('types');
    await dialog.getByRole('button', { name: 'Отправить запрос' }).click();
    await expect(dialog).toContainText('Опишите, что добавить');
    await dialog.getByLabel('Справочник').selectOption({ label: 'Банковские провайдеры' });
    await dialog.getByLabel('Что добавить').fill(what);
    await dialog.getByLabel('Комментарий').fill('Нужен для реквизитов');
    await dialog.getByRole('button', { name: 'Отправить запрос' }).click();
    await expect(page.getByText('Запрос отправлен администратору платформы')).toBeVisible();
    await expect(dialog).toBeHidden();

    await page.getByRole('button', { name: 'Мои запросы' }).click();
    const mine = page.getByRole('dialog', { name: 'Мои запросы' });
    const row = mine.locator('[data-mini-table] tr').filter({ hasText: what });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Банковские провайдеры');
    await expect(row).toContainText('Нужен для реквизитов');
    await expect(row).toContainText('Новый');
    await mine.getByRole('button', { name: 'Закрыть' }).last().click();
    await expect(mine).toBeHidden();
  });
});
