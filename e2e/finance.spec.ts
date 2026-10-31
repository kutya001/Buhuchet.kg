import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { DEMO_PASSWORD, signIn } from './helpers';
import { asOwner, newContractor } from './reports';

// Остаток контрагента и счёт сотрудника (задача 2.20, #76, часть 1) через настоящий сайт. Демо-
// организация: включены «Учёт оплаты налогов» и «Виртуальные счета сотрудников»; новый контрагент
// переводит деньги на налоги ответственному — главному бухгалтеру meerim, поэтому остаток лежит на её
// счёте. Владелец erkin списывает остаток в бонус и отменяет списание. Контрагенты — свои на каждый
// запуск и проект (ПК и телефон), по слову в названии их находит поиск.

type Balance = { received: number; paid: number; available: number };
type Account = {
  rows: { contractorId: string; received: number; bonus: number; rest: number }[];
};

/** Слово из кириллицы, своё на каждый запуск: по нему поиск находит только контрагента теста. */
const uniqueWord = (prefix: string) =>
  `${prefix}${Array.from({ length: 6 }, () => 'абвгдежзиклмнопрстуф'[Math.floor(Math.random() * 20)]).join('')}`;

/** Сегодня по Бишкеку. */
const today = () => new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 10);

/** Сумма на экране — с неразрывными пробелами: «1 000». */
const som = (text: string) => new RegExp(text.replace(/ /g, '\\s'));

/** Общий поиск по вкладке (на телефоне — кнопкой «Поиск» в верхней панели). */
async function search(page: Page, isMobile: boolean, text: string) {
  if (isMobile) await page.getByRole('button', { name: 'Поиск', exact: true }).click();
  await page.getByRole('searchbox').first().fill(text);
}

/** Вкладка карточки: на телефоне — из списка под текущей вкладкой. */
async function toTab(page: Page, card: Locator, isMobile: boolean, name: RegExp) {
  if (isMobile) {
    await card.getByRole('tab', { selected: true }).click();
    await page.getByRole('menu').getByRole('menuitem', { name }).click();
  } else {
    await card.getByRole('tab', { name }).click();
  }
}

/** «Контрагенты» → «Все» → карточка контрагента теста → вкладка «Деньги». */
async function openMoney(page: Page, isMobile: boolean, word: string, id: string, name: string) {
  await page.goto('/app/cps/all');
  await expect(page.locator('[data-grid]')).toBeVisible();
  await search(page, isMobile, word);
  await page.locator(`[data-grid] [data-id="${id}"]`).getByText(name, { exact: true }).click();
  const card = page.getByRole('dialog', { name });
  await expect(card.locator('[data-cp-card]')).toBeVisible();
  await toTab(page, card, isMobile, /Деньги/);
  await expect(card.locator('[data-money-tab]')).toBeVisible();
  return card;
}

/** Плитка «Деньги контрагента» вкладки «Деньги». */
const have = (card: Locator) => card.locator('[data-plate="have"] [data-plate-value]');

/** «Поступление от контрагента» через API без детализации — аванс. */
async function receive(
  api: APIRequestContext,
  origin: string,
  contractorId: string,
  total: number,
) {
  const res = await api.post(`/api/contractors/${contractorId}/receipts`, {
    headers: { origin },
    data: { total, date: today(), rows: [] },
  });
  expect(res.status(), await res.text()).toBe(201);
}

async function balanceOf(api: APIRequestContext, contractorId: string): Promise<Balance> {
  const res = await api.get(`/api/contractors/${contractorId}/money`);
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { balance: Balance }).balance;
}

async function accountRow(api: APIRequestContext, employeeId: string, contractorId: string) {
  const res = await api.get(`/api/staff/${employeeId}/account`);
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as Account).rows.find((r) => r.contractorId === contractorId);
}

/** Главный бухгалтер meerim — ответственный новых контрагентов теста. */
async function meerim(api: APIRequestContext) {
  const res = await api.get('/api/staff?size=all');
  expect(res.status()).toBe(200);
  const { items } = (await res.json()) as {
    items: { id: string; login: string; fullName: string }[];
  };
  return items.find((e) => e.login === 'meerim')!;
}

/** Контрагент теста с авансом 1 000 сом на счёте meerim. */
async function withAdvance(api: APIRequestContext, origin: string, prefix: string) {
  const word = uniqueWord(prefix);
  const name = `ОсОО «${word}»`;
  const emp = await meerim(api);
  const cp = await newContractor(api, origin, { name, responsible: emp.id, tariff: false });
  await receive(api, origin, cp.id, 100_000);
  return { word, name, cp, emp };
}

test.describe('Этап 2: остаток контрагента и счёт сотрудника', () => {
  test('(проверка задачи #76) «Списать в бонус» 300 из 1 000 сом: остаток контрагента — 700, на вкладке «Счёт» ответственного по контрагенту — бонус 300 и остаток 700', async ({
    page,
    request,
    baseURL,
    isMobile,
  }) => {
    const origin = await asOwner(request, baseURL);
    const { word, name, cp, emp } = await withAdvance(request, origin, 'Бонус');

    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    const card = await openMoney(page, isMobile, word, cp.id, name);
    await expect(have(card)).toHaveText(som('1 000'));
    await card.locator('[data-fin-action="bonus"]').click();
    const dialog = page.getByRole('dialog', { name: 'Списать остаток в бонус' });
    // Сумма подставлена — весь свободный остаток; причина — «Остаток после оплаты налогов».
    await expect(dialog.locator('[data-fin-amount]')).toHaveValue(som('1 000'));
    await expect(dialog.locator('[data-fin-note]')).toHaveValue('Остаток после оплаты налогов');
    await dialog.locator('[data-fin-amount]').fill('300');
    await dialog.locator('[data-fin-ok]').click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'Списано в бонус' })).toBeVisible();
    await expect(have(card)).toHaveText(som('700'));
    expect(await balanceOf(request, cp.id)).toMatchObject({ received: 100_000, available: 70_000 });

    // Счёт ответственного: по контрагенту поступило 1 000, бонус 300, остаток 700.
    expect(await accountRow(request, emp.id, cp.id)).toMatchObject({
      received: 100_000,
      bonus: 30_000,
      rest: 70_000,
    });
    await page.goto('/app/staff/list');
    await expect(page.locator('[data-grid]')).toBeVisible();
    await search(page, isMobile, emp.fullName);
    await page
      .locator('[data-grid] [data-id]')
      .filter({ hasText: emp.fullName })
      .getByText(emp.fullName)
      .first()
      .click();
    const staff = page.getByRole('dialog', { name: emp.fullName });
    await toTab(page, staff, isMobile, /Счёт/);
    const account = staff.locator(`[data-employee-account="${emp.id}"]`);
    await expect(account).toBeVisible();
    const line = account.locator('[data-mini-table] tbody tr').filter({ hasText: name });
    await expect(line).toHaveCount(1);
    await expect(line.locator('td[data-label="Бонус"]')).toHaveText(som('300'));
    await expect(line.locator('td[data-label="Остаток"]')).toHaveText(som('700'));
  });

  test('(проверка задачи #76) «Отменить списание» в окне операции возвращает остаток: снова 1 000 сом, бонуса на счёте ответственного нет', async ({
    page,
    request,
    baseURL,
    isMobile,
  }) => {
    const origin = await asOwner(request, baseURL);
    const { word, name, cp, emp } = await withAdvance(request, origin, 'Отмена');
    const res = await request.post(`/api/contractors/${cp.id}/write-offs`, {
      headers: { origin },
      data: { kind: 'bonus', amount: 30_000, date: today(), note: 'Остаток после оплаты налогов' },
    });
    expect(res.status(), await res.text()).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(await balanceOf(request, cp.id)).toMatchObject({ available: 70_000 });

    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    const card = await openMoney(page, isMobile, word, cp.id, name);
    await expect(have(card)).toHaveText(som('700'));
    // Строка операции открывает её окно; «Удалить» у списания — «Отменить списание в бонус?».
    await card
      .locator(`[data-mini-table] tr[data-open]`)
      .filter({ hasText: 'Списание в бонус' })
      .click();
    const op = page.getByRole('dialog', { name: som('Списание в бонус 300 сом') });
    await expect(op.locator(`[data-fin-op-window="${id}"]`)).toBeVisible();
    await op.locator('[data-fin-action="delete"]').click();
    const ask = page.getByRole('dialog', { name: 'Отменить списание в бонус?' });
    await ask.locator('[data-fin-ok]').click();
    // Без причины не отменяется.
    await expect(ask).toContainText('Укажите причину');
    await ask.locator('[data-fin-reason]').fill('списали по ошибке');
    await ask.getByRole('button', { name: 'Отменить списание' }).click();
    await expect(ask).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'Списание отменено' })).toBeVisible();
    // Окно операции остаётся открытым: запись помечена «Удалена», в истории — отмена с причиной.
    await expect(op).toContainText('Удалена');
    await expect(op).toContainText(
      som('Списание отменено: списание в бонус на 300 сом от .*Причина: списали по ошибке'),
    );
    await op.getByRole('button', { name: 'Готово', exact: true }).click();
    await expect(op).toBeHidden();
    await expect(have(card)).toHaveText(som('1 000'));
    expect(await balanceOf(request, cp.id)).toMatchObject({ available: 100_000 });
    expect(await accountRow(request, emp.id, cp.id)).toMatchObject({ bonus: 0, rest: 100_000 });
  });
});
