import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { orgWithTypes } from './orgs';
import { assign, newContractor } from './reports';

// Прототип v84: массовые изменения видов отчётов — галочки в списке, «Подключить», «Настроить»,
// «Отключить» (docs/deviations.md п. О-74). Своя организация теста без подключённых видов.

const row = (page: Page, code: string) => page.locator(`[data-grid] [data-id="${code}"]`);

/** Отметить вид галочкой: поиск по названию оставляет его в списке, отметки при этом сохраняются. */
async function pick(page: Page, isMobile: boolean, code: string, name: string) {
  if (isMobile && !(await page.getByRole('searchbox').first().isVisible())) {
    await page.getByRole('button', { name: 'Поиск', exact: true }).click();
  }
  await page.getByRole('searchbox').first().fill(name);
  await row(page, code)
    .getByRole('checkbox', { name: /Выбрать/ })
    .check();
}

/** Настройки организации по видам — как их отдаёт API. */
async function settings(api: APIRequestContext) {
  const res = await api.get('/api/org-report-types/settings');
  expect(res.status()).toBe(200);
  const body = (await res.json()) as {
    items: {
      code: string;
      enabled: boolean;
      remindDays: number[];
      needFile: boolean;
      needReceipt: boolean;
    }[];
  };
  return Object.fromEntries(body.items.map((s) => [s.code, s]));
}

const SOC = 'Подоходный налог и взносы в Соцфонд';

test('(проверка прототипа v84) в «Видах отчётов» отметили несколько видов галочками: «Подключить» подключает все, «Настроить» меняет файл при сдаче, квитанцию и дни напоминаний у всех сразу (виду «только оплата» файл не ставится), «Отключить» оставляет подключённым вид, назначенный действующим контрагентам', async ({
  page,
  baseURL,
  isMobile,
}) => {
  // Длинный сценарий: все три действия и их отказы на одной организации.
  test.slow();
  const origin = new URL(baseURL!).origin;
  await orgWithTypes(page.request, origin, false);
  await page.goto('/app/dicts/types');
  await expect(page.locator('[data-grid] [data-id]').first()).toBeVisible();

  // «Подключить»: два вида сразу.
  await pick(page, isMobile, 'soc', SOC);
  await pick(page, isMobile, 'pat', 'Патент');
  await expect(page.getByText('Выбрано: 2')).toBeVisible();
  await page.getByRole('button', { name: 'Подключить', exact: true }).click();
  await expect(page.getByText('Подключено видов: 2')).toBeVisible();
  await expect(page.getByText('Выбрано: 2')).toHaveCount(0);
  expect(await settings(page.request)).toMatchObject({
    soc: { enabled: true, remindDays: [7, 3], needFile: false, needReceipt: false },
    pat: { enabled: true },
  });

  // Соцфонд назначен действующему контрагенту.
  const cp = await newContractor(page.request, origin, { tariff: false });
  await assign(page.request, origin, {
    contractorId: cp.id,
    reportTypeCode: 'soc',
    fromMonth: '2026-10-01',
  });

  // «Настроить»: подключённый вид, вид «только оплата» и неподключённый.
  await pick(page, isMobile, 'soc', SOC);
  await pick(page, isMobile, 'pat', 'Патент');
  await pick(page, isMobile, 'bal', 'Бухгалтерский баланс');
  await page.getByRole('button', { name: 'Настроить', exact: true }).click();
  const dlg = page.getByRole('dialog', { name: 'Настроить виды отчётов: 3' });
  await expect(dlg).toContainText('Соцфонд, Патент, Баланс');
  await expect(dlg).toContainText('У видов «только оплата» (1) не меняется');
  await expect(dlg).toContainText('У каждого вида останутся свои дни напоминаний.');
  const connect = dlg.getByRole('switch', { name: /Подключить неподключённые виды: 1/ });
  await expect(connect).toBeChecked();
  // Всё «Не менять», а подключать не просили — менять нечего.
  await connect.click();
  await dlg.locator('[data-types-bulk-apply]').click();
  await expect(page.getByText('Ничего не выбрано для изменения')).toBeVisible();
  await connect.click();
  await dlg.locator('[data-types-bulk="file"]').selectOption({ label: 'Обязательно' });
  await dlg.locator('[data-types-bulk="receipt"]').selectOption({ label: 'Обязательно' });
  // «Задать заново» начинается с дней учётной политики; «в день срока — всегда».
  await dlg.locator('[data-types-bulk="days"]').selectOption({ label: 'Задать заново' });
  const days = dlg.locator('[data-types-bulk-days]');
  await expect(days).toContainText('7 дней');
  await expect(days).toContainText('3 дня');
  await expect(days).toContainText('в день срока — всегда');
  const day = dlg.locator('[data-types-bulk="day"]');
  await day.fill('99');
  await day.press('Enter');
  await expect(dlg).toContainText('Число дней — от 1 до 60');
  await day.fill('10');
  await day.press('Enter');
  await expect(days).toContainText('10 дней');
  await days.locator('[data-chip="3"]').getByRole('button', { name: 'Убрать' }).click();
  await expect(days).not.toContainText('3 дня');
  await dlg.locator('[data-types-bulk-apply]').click();
  await expect(page.getByText('Изменено видов: 3 из 3')).toBeVisible();
  await expect(dlg).toBeHidden();
  expect(await settings(page.request)).toMatchObject({
    soc: { enabled: true, needFile: true, needReceipt: true, remindDays: [10, 7] },
    // «Только оплата»: файл при сдаче не ставится.
    pat: { enabled: true, needFile: false, needReceipt: true, remindDays: [10, 7] },
    // Неподключённый вид подключён сразу с настройками.
    bal: { enabled: true, needFile: true, needReceipt: true, remindDays: [10, 7] },
  });

  // То же самое ещё раз — «Изменений нет».
  await pick(page, isMobile, 'soc', SOC);
  await page.getByRole('button', { name: 'Настроить', exact: true }).click();
  const again = page.getByRole('dialog', { name: 'Настроить виды отчётов: 1' });
  await again.locator('[data-types-bulk="receipt"]').selectOption({ label: 'Обязательно' });
  await again.locator('[data-types-bulk-apply]').click();
  await expect(
    page.getByText('Изменений нет: у выбранных видов уже такие настройки'),
  ).toBeVisible();

  // «Отключить»: назначенный контрагенту Соцфонд остаётся подключённым, «Патент» отключается.
  await pick(page, isMobile, 'soc', SOC);
  await pick(page, isMobile, 'pat', 'Патент');
  await page.getByRole('button', { name: 'Отключить', exact: true }).click();
  const off = page.getByRole('dialog', { name: 'Отключить 1 вид отчётов?' });
  await expect(off).toContainText(
    'Отключённые виды нельзя назначать контрагентам; настройки сохранятся. Останутся подключёнными, потому что назначены контрагентам: Соцфонд.',
  );
  await off.getByRole('button', { name: 'Отключить', exact: true }).click();
  await expect(page.getByText('Отключено видов: 1, не отключено: 1')).toBeVisible();
  expect(await settings(page.request)).toMatchObject({
    soc: { enabled: true },
    pat: { enabled: false, needReceipt: true, remindDays: [10, 7] },
  });

  // Один назначенный вид — окно не открывается.
  await pick(page, isMobile, 'soc', SOC);
  await page.getByRole('button', { name: 'Отключить', exact: true }).click();
  await expect(
    page.getByText('Отключить нельзя: вид назначен действующим контрагентам'),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Отметки остались. Выбраны только подключённые — подключать нечего.
  await pick(page, isMobile, 'bal', 'Бухгалтерский баланс');
  await expect(page.getByText('Выбрано: 2')).toBeVisible();
  await page.getByRole('button', { name: 'Подключить', exact: true }).click();
  await expect(page.getByText('Все выбранные виды уже подключены')).toBeVisible();

  // «Баланс» назначили контрагенту уже после отметки: действие берёт виды, какие они сейчас.
  await assign(page.request, origin, {
    contractorId: cp.id,
    reportTypeCode: 'bal',
    fromMonth: '2026-10-01',
  });
  await page.getByRole('button', { name: 'Отключить', exact: true }).click();
  await expect(
    page.getByText('Отключить нельзя: все выбранные виды назначены действующим контрагентам'),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Среди выбранных — только отключённый вид.
  await page.getByRole('button', { name: 'Снять выбор', exact: true }).click();
  await expect(page.getByText('Выбрано: 2')).toHaveCount(0);
  await pick(page, isMobile, 'pat', 'Патент');
  await page.getByRole('button', { name: 'Отключить', exact: true }).click();
  await expect(page.getByText('Среди выбранных нет подключённых видов')).toBeVisible();
  expect(await settings(page.request)).toMatchObject({
    soc: { enabled: true },
    bal: { enabled: true },
    pat: { enabled: false },
  });
});
