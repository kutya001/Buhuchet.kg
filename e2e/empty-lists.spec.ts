import { expect, test, type Page } from '@playwright/test';
import { orgWithTypes } from './orgs';
import { newContractor } from './reports';

// Пустой список контрагентов (доработки 20.11.2026, пакет 2, этап Б, блок 2, «Приёмка на пустой
// организации»; прототип ui/empty.js `firstEmpty`, ui/grid.js `emptyadd`, modules/contractors.js `empty`):
// в организации контрагентов нет — первый вход на любой вкладке; есть (хотя бы в архиве), а вкладка
// пуста — одна «Добавить» и только на «Все»; так же у задач (`!allTasks().length`). Своя организация
// теста: общие записи демо не трогаются.

const emptyState = (page: Page) => page.locator('[data-empty-state]');

test.describe('Доработки 20.11: пустые списки контрагентов и задач', () => {
  test('(пакет 2, блок 2) пустые вкладки контрагентов: первый вход на «Должниках» — «Добавить контрагента» и «Загрузить из Excel»; при контрагенте в архиве «Все» — «Контрагентов пока нет» и одна «Добавить», «Мои контрагенты» и «Должники» — без кнопок', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    await orgWithTypes(page.request, origin, false);
    // Вкладка «Должники» есть только с функцией «Плата за обслуживание».
    const policy = (await (await page.request.get('/api/org/policy')).json()) as {
      version: number;
    };
    const fee = await page.request.patch('/api/org/policy', {
      headers: { origin },
      data: { version: policy.version, features: { fee: true } },
    });
    expect(fee.status(), await fee.text()).toBe(200);

    // Контрагентов нет совсем: первый вход и на «Должниках».
    await page.goto('/app/cps/debtors');
    await expect(emptyState(page)).toContainText('Здесь будут ваши клиенты');
    await expect(emptyState(page).getByRole('button')).toHaveText([
      'Добавить контрагента',
      'Загрузить из Excel',
    ]);

    // Один контрагент — и тот в архиве: в организации контрагенты уже есть. Плата включена — ставка
    // обязательна («0 — допустимо»): ноль, чтобы долга не было.
    const { id } = await newContractor(page.request, origin, { tariffAmount: 0 });
    const archived = await page.request.post('/api/contractors/archive', {
      headers: { origin },
      data: { ids: [id] },
    });
    expect(archived.status(), await archived.text()).toBe(200);

    await page.goto('/app/cps/mine');
    await expect(emptyState(page)).toContainText('За вами пока не закреплены контрагенты');
    await expect(emptyState(page).getByRole('button')).toHaveCount(0);

    await page.goto('/app/cps/debtors');
    await expect(emptyState(page)).toContainText('Контрагентов пока нет');
    await expect(emptyState(page)).not.toContainText('Здесь будут ваши клиенты');
    await expect(emptyState(page).getByRole('button')).toHaveCount(0);

    // «Все»: одна «Добавить» — открывает «Новый контрагент».
    await page.goto('/app/cps/all');
    await expect(emptyState(page)).toContainText('Контрагентов пока нет');
    await expect(emptyState(page).getByRole('button')).toHaveText(['Добавить']);
    await emptyState(page).getByRole('button', { name: 'Добавить' }).click();
    await expect(page.getByRole('dialog', { name: 'Новый контрагент' })).toBeVisible();
  });

  test('(пакет 2, блок 2) задач в организации нет — первый вход и на «Просроченных»', async ({
    page,
    baseURL,
  }) => {
    await orgWithTypes(page.request, new URL(baseURL!).origin, false);
    await page.goto('/app/tasks/overdue');
    await expect(emptyState(page)).toContainText('Задач пока нет. Поставьте первую');
    await expect(
      emptyState(page).getByRole('button', { name: 'Добавить', exact: true }),
    ).toBeVisible();
  });
});
