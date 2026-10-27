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

  test('строка налога открывает форму налога; строки режима, формы, льготы и основания — окно значения; строки ГКЭД, УГНС и календаря — ничего', async ({
    page,
    baseURL,
  }) => {
    await openTab(page, baseURL);
    const opens = [
      {
        tile: 'taxes',
        tab: 'Налоги и ставки',
        code: 'НАЛ-03',
        title: 'Налог на прибыль',
        texts: ['НАЛ-03 · Общегосударственные налоги', 'Кто платит и с чего'],
      },
      {
        tile: 'regimes',
        tab: 'Режимы',
        code: 'РЕЖ-01',
        title: 'ОНР',
        texts: ['Режимы · справочник платформы', 'Для бухгалтера'],
      },
      {
        tile: 'forms',
        tab: 'Формы',
        code: 'ФС-01',
        title: 'ОсОО',
        texts: ['Формы · справочник платформы', 'Считается', 'организация'],
      },
      {
        tile: 'benefits',
        tab: 'Льготы и статусы',
        code: 'ЛЬГ-30',
        title: 'Крупный налогоплательщик',
        texts: ['Меняет сроки'],
      },
      {
        tile: 'bases',
        tab: 'Основания для отчётов',
        code: 'employees',
        title: 'Есть наёмные сотрудники',
        texts: ['Виды отчётов'],
      },
    ];
    for (const x of opens) {
      await page.locator(`[data-dict-tile="${x.tile}"]`).click();
      const win = page.getByRole('dialog', { name: x.tab, exact: true });
      await win.getByRole('searchbox', { name: 'Найти значение' }).fill(x.title);
      await win.locator(`[data-grid] [data-id="${x.code}"]`).getByText(x.title).first().click();
      const value = page.getByRole('dialog', { name: x.title, exact: true });
      for (const text of x.texts) await expect(value).toContainText(text);
      await value.getByRole('button', { name: 'Закрыть' }).last().click();
      await expect(value).toBeHidden();
      await win.getByRole('button', { name: 'Закрыть' }).last().click();
      await expect(win).toBeHidden();
    }

    // У ГКЭД, УГНС и календаря строка ничего не открывает (прототип: `open: null`).
    for (const x of [
      { tile: 'gked', tab: 'ГКЭД' },
      { tile: 'ugns', tab: 'УГНС' },
      { tile: 'calendar', tab: 'Календарь' },
    ]) {
      await page.locator(`[data-dict-tile="${x.tile}"]`).click();
      const win = page.getByRole('dialog', { name: x.tab, exact: true });
      const row = win.locator('[data-grid] [data-id]').first();
      await expect(row).toBeVisible();
      await row.click();
      await expect(page.getByRole('dialog')).toHaveCount(1);
      await win.getByRole('button', { name: 'Закрыть' }).last().click();
      await expect(win).toBeHidden();
    }
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

  test('«Попросить добавить»: пустое «Что добавить» — ошибка; ссылка в уведомлении открывает «Мои запросы», запрос там со статусом «Новый», строка открывает его целиком', async ({
    page,
    baseURL,
  }, testInfo) => {
    // Демо-бухгалтер без права на справочники тоже может попросить и посмотреть свои запросы.
    await openTab(page, baseURL, 'aigerim');
    const what = `Отчёт по НДС на импорт услуг ${testInfo.project.name} ${Date.now()}`;
    const add = async (item: string) => {
      await page.getByRole('button', { name: 'Добавить', exact: true }).click();
      await page
        .getByRole('menu', { name: 'Добавить' })
        .getByRole('menuitem', { name: item })
        .click();
    };
    await add('Попросить добавить');
    const dialog = page.getByRole('dialog', { name: 'Попросить добавить' });
    await expect(dialog).toContainText('Запрос уйдёт администратору платформы');
    await expect(dialog.getByLabel('Справочник')).toHaveValue('types');
    await dialog.getByRole('button', { name: 'Отправить запрос' }).click();
    await expect(dialog).toContainText('Опишите, что добавить');
    await dialog.getByLabel('Справочник').selectOption({ label: 'Банковские провайдеры' });
    await dialog.getByLabel('Что добавить').fill(what);
    await dialog.getByLabel('Комментарий').fill('Нужен для реквизитов');
    await dialog.getByRole('button', { name: 'Отправить запрос' }).click();
    const toast = page
      .getByRole('status')
      .filter({ hasText: 'Запрос отправлен администратору платформы' });
    await expect(toast).toBeVisible();
    await expect(dialog).toBeHidden();

    await toast.getByRole('button', { name: 'Мои запросы' }).click();
    const mine = page.getByRole('dialog', { name: 'Мои запросы' });
    const row = mine.locator('[data-mini-table] tr').filter({ hasText: what });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Банковские провайдеры');
    await expect(row).toContainText('Нужен для реквизитов');
    await expect(row).toContainText('Новый');
    await row.click();
    const view = page.getByRole('dialog', { name: what });
    await expect(view).toContainText('Ответа пока нет');
    await view.getByRole('button', { name: 'Готово' }).click();
    await mine.getByRole('button', { name: 'Готово' }).click();
    await expect(mine).toBeHidden();

    // «Мои запросы» есть и в «+ Добавить».
    await add('Мои запросы');
    await expect(mine.locator('[data-mini-table] tr').filter({ hasText: what })).toHaveCount(1);
  });
});
