import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { ownerPassword, platformAdmin, uniqueInn } from './admin';
import { closeWindow, discardChanges, signIn, uniqueLogin } from './helpers';
import { connectAllTypes } from './orgs';
import { newContractor } from './reports';

// Места в пакете (доработки 20.11.2026, блок 3, пункт 1; этап 1, П8; прототип v152 seatOk, seatDlg,
// #im-seat) через настоящий сайт: своя организация теста, пакет на 10 мест ставит администратор платформы
// («Изменить подписку», этап 1, П3), 10 контрагентов занимают пакет. Правило и ответы 409 `no_seats` —
// тесты packages/api/src/modules/contractors/seats.test.ts и packages/domain/src/contractors/seats.test.ts.

const PACK = 10;

/** «Оплачено до» — через месяц от сегодня по Бишкеку (UTC+6). */
const paidUntil = () =>
  new Date(Date.now() + (6 * 60 + 30 * 24 * 60) * 60_000).toISOString().slice(0, 10);

/** Новая организация с пакетом на `PACK` мест; сеанс владельца — в `api`, администратора — в `admin`. */
async function orgWithPack(admin: APIRequestContext, api: APIRequestContext, origin: string) {
  await platformAdmin(admin, origin);
  const owner = uniqueLogin('e2e-seat');
  const temporary = ownerPassword();
  const created = await admin.post('/api/admin/organizations', {
    headers: { origin },
    data: {
      name: `ОсОО «${owner}»`,
      inn: uniqueInn(),
      ownerFullName: 'Пакетова Сквозная',
      ownerLogin: owner,
      temporaryPassword: temporary,
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const { organization } = (await created.json()) as { organization: { id: string } };
  const sub = await admin.put(`/api/admin/organizations/${organization.id}/subscription`, {
    headers: { origin },
    data: {
      planId: 'm1',
      seats: PACK,
      extraGb: 0,
      paidUntil: paidUntil(),
      extraDiscountPct: 0,
      free: true,
      reason: 'Сквозной тест: места в пакете',
    },
  });
  expect(sub.status(), await sub.text()).toBe(200);
  await signIn(api, origin, owner, temporary);
  const changed = await api.post('/api/auth/password', {
    headers: { origin },
    data: { currentPassword: temporary, newPassword: ownerPassword() },
  });
  expect(changed.status(), await changed.text()).toBe(200);
  await connectAllTypes(api, origin);
}

/** «+ Добавить» модуля «Контрагенты» → пункт меню. */
async function addVia(page: Page, item: 'Контрагент' | 'Загрузка из Excel') {
  await page
    .getByRole('button', { name: 'Добавить', exact: true })
    .and(page.locator('[data-add-button]'))
    .click();
  await page.getByRole('menu', { name: 'Добавить' }).getByRole('menuitem', { name: item }).click();
}

test.describe('Доработки 20.11.2026: места в пакете', () => {
  // Пакет на 10 мест ставит метод Админки «Изменить подписку» (этап 1, П3 треда сборки): его ещё нет в main,
  // поэтому в ветке потока тест ждёт; включает его общая сборка этапа 1 вместе с П3 (правило стыков).
  test.fixme(true, 'ждёт метода Админки «Изменить подписку» (этап 1, П3)');
  test('(блок 3, пункт 1) пакет 10 занят: «Новый контрагент» показывает «В пакете нет свободных мест: занято 10 из 10…» с «Расширить пакет» у владельца, загрузка из Excel недоступна целиком; после перевода одного контрагента в архив новый добавляется', async ({
    page,
    baseURL,
    playwright,
  }) => {
    const origin = new URL(baseURL!).origin;
    const admin = await playwright.request.newContext({ baseURL });
    await orgWithPack(admin, page.request, origin);
    const ids: string[] = [];
    for (let i = 0; i < PACK; i++)
      ids.push((await newContractor(page.request, origin, { tariff: false })).id);

    // «+ Добавить» → «Контрагент»: вместо формы — окно о местах (прототип seatDlg), у владельца «Расширить пакет».
    await page.goto('/app/cps/all');
    await addVia(page, 'Контрагент');
    const full = page.getByRole('dialog', { name: 'В пакете нет свободных мест' });
    await expect(full).toContainText(
      `В пакете нет свободных мест: занято ${PACK} из ${PACK}. Расширьте пакет или переведите контрагента в архив.`,
    );
    await expect(full.getByRole('button', { name: 'Расширить пакет' })).toBeVisible();
    await expect(full).not.toContainText('Обратитесь к владельцу организации');
    await expect(page.getByRole('dialog', { name: 'Новый контрагент' })).toHaveCount(0);
    await full.locator('[data-window-close]').click();
    await expect(full).toBeHidden();

    // «Загрузка из Excel»: в предпросмотре — места; новых больше свободных — «ОК, создать» недоступна.
    await addVia(page, 'Загрузка из Excel');
    const load = page.getByRole('dialog', { name: 'Загрузка контрагентов из Excel' });
    const word = uniqueLogin('Пакет');
    await load.getByLabel('Данные').fill(
      [
        [
          'Название',
          'ИНН',
          'Телефон',
          'Виды отчётов',
          'Ответственный',
          'Основной ГКЭД',
          'Режим налогообложения',
        ],
        [
          `ОсОО «${word}»`,
          `0${uniqueInn().slice(1)}`,
          '0555 123 456',
          'НДС',
          'Пакетова Сквозная',
          '69.20.0',
          'ОНР',
        ],
      ]
        .map((r) => r.join('\t'))
        .join('\n'),
    );
    await load.getByRole('button', { name: 'Показать таблицу' }).click();
    await load.getByRole('button', { name: 'Проверить' }).click();
    await expect(load.locator('[data-cp-import-row="0"]')).toContainText('готова');
    const seatLine = load.locator('[data-cp-import-seat]');
    await expect(seatLine).toHaveAttribute('data-cp-import-seat', 'over');
    await expect(seatLine).toContainText(
      'Свободных мест в пакете: 0, новых контрагентов в файле: 1. Загрузить можно, когда мест хватит на всех: расширьте пакет или переведите контрагентов в архив.',
    );
    await expect(seatLine.getByRole('button', { name: 'Расширить пакет' })).toBeVisible();
    await expect(load.getByRole('button', { name: 'ОК, создать 1' })).toBeDisabled();
    await load.locator('[data-window-close]').click();
    await discardChanges(page);
    await expect(load).toBeHidden();

    // «В архив» освобождает место: «Новый контрагент» открывает форму, новый контрагент добавляется.
    const archived = await page.request.post('/api/contractors/archive', {
      headers: { origin },
      data: { ids: [ids[0]] },
    });
    expect(archived.status(), await archived.text()).toBe(200);
    await addVia(page, 'Контрагент');
    const form = page.getByRole('dialog', { name: 'Новый контрагент' });
    await expect(form.locator('[data-cf]')).toBeVisible({ timeout: 15_000 });
    await expect(full).toHaveCount(0);
    await closeWindow(form);
    await newContractor(page.request, origin, { tariff: false });

    // Пакет снова полон: «Расширить пакет» ведёт на экран «Подписка» с окном расширения (поток И).
    await addVia(page, 'Контрагент');
    await full.getByRole('button', { name: 'Расширить пакет' }).click();
    await expect(page).toHaveURL(/\/app\/org\/sub(\?|$)/);
    await expect(full).toHaveCount(0);
    await admin.dispose();
  });
});
