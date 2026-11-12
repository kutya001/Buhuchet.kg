import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { ownerPassword } from './admin';
import { newOrgOwner, phoneTableView, settledBox, signIn, uniqueInn, uniqueLogin } from './helpers';

// «Отображаемое имя» сотрудника (решение заказчика 06.11.2026, прототип v74): поле в «Новом
// сотруднике» заполняется по ФИО, сотрудник меняет имя сам в «Мой профиль», новое имя видно в списках
// и фильтрах, полное ФИО — в карточке сотрудника. Своя организация на каждый тест и проект: в
// демо-организации «Мээрим К.» уже есть. Правила (2–40 знаков, повтор, история) — тесты
// `packages/api/src/modules/staff/staff.test.ts`.

const FULL_NAME = 'Кадырова Мээрим Асановна';

/** Владелец включает функцию учётной политики. */
async function enable(api: APIRequestContext, origin: string, feature: 'tasks') {
  const policy = (await (await api.get('/api/org/policy')).json()) as { version: number };
  const res = await api.patch('/api/org/policy', {
    headers: { origin },
    data: { version: policy.version, features: { [feature]: true } },
  });
  expect(res.status(), await res.text()).toBe(200);
}

/** Владелец закрепляет за сотрудником контрагента и ставит ему задачу. */
async function giveWork(api: APIRequestContext, origin: string, employeeId: string, word: string) {
  const contractor = await api.post('/api/contractors', {
    headers: { origin },
    data: {
      name: `ОсОО «${word}»`,
      inn: `0${uniqueInn().slice(1)}`,
      phone: '+996505890076',
      kind: 'regular',
      formCode: 'ФС-01',
      regimeCode: 'РЕЖ-01',
      gked: '46.34.0',
      startDate: '2026-01-01',
      responsibleEmployeeId: employeeId,
    },
  });
  expect(contractor.status(), await contractor.text()).toBe(201);
  const options = (await (await api.get('/api/tasks/form-options')).json()) as {
    categories: { code: string }[];
  };
  const task = await api.post('/api/tasks', {
    headers: { origin },
    data: {
      title: `Сверить акты ${word}`,
      description: '',
      categoryCode: options.categories[0]!.code,
      contractorId: null,
      executorEmployeeId: employeeId,
      term: 'day',
      dueDate: '2099-12-30',
      needFile: false,
      confirm: false,
    },
  });
  expect(task.status(), await task.text()).toBe(201);
  return {
    contractorId: ((await contractor.json()) as { id: string }).id,
    taskId: ((await task.json()) as { id: string }).id,
  };
}

/** Строка списка вкладки; на телефоне — в виде «Таблица», где видны столбцы. */
async function listRow(page: Page, isMobile: boolean, path: string, id: string) {
  await page.goto(path);
  const grid = page.locator('[data-grid]');
  await expect(grid.locator('[data-id]').first()).toBeVisible();
  if (isMobile) await phoneTableView(page);
  return grid.locator(`[data-id="${id}"]`);
}

test.describe('Этап 3: отображаемое имя сотрудника (прототип v74)', () => {
  test('(прототип v74) владелец создал сотрудника Кадырову Мээрим Асановну: «Отображаемое имя» заполнено «Мээрим К.»; сотрудник в «Мой профиль» сменил его на «Мээрим» — в списке контрагентов, задачах и фильтре «Ответственный» теперь «Мээрим», в карточке сотрудника полное ФИО', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    const ownerLogin = await newOrgOwner(page.request, origin);
    await enable(page.request, origin, 'tasks');

    // «Новый сотрудник»: имя заполняется по ФИО.
    await page.goto('/app/staff/list');
    await expect(page.locator('[data-grid] [data-id]').first()).toBeVisible();
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    await page
      .getByRole('menu', { name: 'Добавить' })
      .getByRole('menuitem', { name: 'Сотрудник' })
      .click();
    const form = page.getByRole('dialog', { name: 'Новый сотрудник' });
    const short = form.getByLabel('Отображаемое имя');
    await expect(short).toHaveAttribute('placeholder', 'Заполнится по ФИО');
    await expect(form).toContainText(
      'Как сотрудник называется в программе: в списках, задачах, истории. Пустое поле — имя и первая буква фамилии',
    );
    await form.getByLabel('ФИО').fill(FULL_NAME);
    await expect(short).toHaveValue('Мээрим К.');
    // Очистили поле и ушли из него — снова имя по ФИО.
    await short.fill('');
    await form.getByLabel('Логин').click();
    await expect(short).toHaveValue('Мээрим К.');
    const login = uniqueLogin('e2e-short');
    await form.getByLabel('Логин').fill(login);
    const temporary = await form.getByLabel('Временный пароль').inputValue();
    await form.getByRole('button', { name: 'Создать' }).click();
    await expect(form).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'Сотрудник создан' })).toBeVisible();

    const staff = (await (await page.request.get('/api/staff?size=all')).json()) as {
      items: { id: string; fullName: string; shortName: string }[];
    };
    const meerim = staff.items.find((e) => e.fullName === FULL_NAME)!;
    expect(meerim.shortName).toBe('Мээрим К.');
    const word = `Акты-${Date.now().toString(36)}`;
    const { contractorId, taskId } = await giveWork(page.request, origin, meerim.id, word);

    // Сотрудник входит и в «Мой профиль» меняет имя на «Мээрим».
    await page.request.post('/api/auth/logout', { headers: { origin } });
    await signIn(page.request, origin, login, temporary);
    const own = ownerPassword();
    const changed = await page.request.post('/api/auth/password', {
      headers: { origin },
      data: { currentPassword: temporary, newPassword: own },
    });
    expect(changed.status(), await changed.text()).toBe(200);
    await page.goto('/app/home/today');
    if (isMobile) {
      await page.getByRole('button', { name: 'Меню' }).click();
      await page.getByRole('button', { name: /^Мой профиль/ }).click();
    } else {
      await page.getByRole('button', { name: 'Мой профиль' }).click();
    }
    const profile = page.getByRole('dialog', { name: 'Мой профиль' });
    await settledBox(profile);
    const row = profile.locator('[data-profile-short]');
    await expect(row.locator('span').first()).toHaveText('Мээрим К.');
    await row.getByRole('button', { name: 'Изменить' }).click();
    const dialog = page.getByRole('dialog', { name: 'Отображаемое имя' });
    await expect(dialog).toContainText(FULL_NAME);
    const field = dialog.getByLabel('Отображаемое имя');
    await expect(field).toHaveValue('Мээрим К.');
    await field.fill('М');
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(dialog).toContainText('От 2 до 40 знаков');
    await field.fill('Мээрим');
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole('status').filter({ hasText: 'Отображаемое имя сохранено' }),
    ).toBeVisible();
    await expect(row.locator('span').first()).toHaveText('Мээрим');
    await expect(profile).toContainText(FULL_NAME);
    await profile.getByRole('button', { name: 'Готово' }).click();
    await expect(profile).toBeHidden();

    // Владелец: в списках и фильтре — «Мээрим», в карточке сотрудника — полное ФИО.
    await page.request.post('/api/auth/logout', { headers: { origin } });
    await signIn(page.request, origin, ownerLogin, 'Свой-пароль-e2e-1');

    const cpRow = await listRow(page, isMobile, '/app/cps/all', contractorId);
    await expect(cpRow).toContainText('Мээрим');
    await expect(cpRow).not.toContainText('Мээрим К.');
    await page
      .locator('[data-grid]')
      .getByRole('button', { name: 'Фильтр: Ответственный' })
      .click();
    const filter = page.getByRole('dialog', { name: 'Ответственный' });
    // Значения фильтра: подписи без счётчиков; у владельца новой организации один контрагент.
    await expect(filter.locator('[data-filter-values] label span.truncate')).toHaveText(['Мээрим']);

    const taskRow = await listRow(page, isMobile, '/app/tasks/all', taskId);
    await expect(taskRow).toContainText('Мээрим');
    await expect(taskRow).not.toContainText('Мээрим К.');

    const staffRow = await listRow(page, isMobile, '/app/staff/list', meerim.id);
    await expect(staffRow).toContainText(FULL_NAME);
    await staffRow.getByText(FULL_NAME).click();
    const card = page.getByRole('dialog', { name: FULL_NAME });
    await expect(card).toBeVisible();
  });
});
