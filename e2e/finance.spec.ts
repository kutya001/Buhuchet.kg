import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { DEMO_PASSWORD, signIn } from './helpers';
import { asOwner, manualReport, newContractor, staffIds } from './reports';

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
  // «Плата за обслуживание» в демо-организации включена: стоимость обслуживания обязательна, 0 — без
  // начислений, чтобы остаток считался только из денег на налоги.
  const cp = await newContractor(api, origin, { name, responsible: emp.id, tariffAmount: 0 });
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

/* ───────────── Модуль «Финансовые операции» (задача 2.22, #76, часть 2) ───────────── */

type JournalRow = {
  key: string;
  id: string;
  contractor: { id: string };
  deleted: boolean;
  edited: boolean;
};

/** Журнал вкладки через API: строки по контрагенту теста. */
async function journalOf(api: APIRequestContext, query: string): Promise<JournalRow[]> {
  const res = await api.get(`/api/fin/journal?size=all${query}`);
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { items: JournalRow[] }).items;
}

/** Идущий месяц по Бишкеку. */
const currentMonth = () => today().slice(0, 7);

/** «Финансовые операции» → вкладка с поиском по слову теста. */
async function openFin(page: Page, isMobile: boolean, tab: string, word: string) {
  await page.goto(`/app/fin/${tab}`);
  await expect(page.locator('[data-grid]')).toBeVisible();
  await search(page, isMobile, word);
}

test.describe('Этап 2: финансовые операции по контрагентам', () => {
  test('(п. 46) роль с областью «Свои» видит в журнале «Финансовые операции» операции только своих контрагентов', async ({
    page,
    request,
    baseURL,
    isMobile,
  }) => {
    const origin = await asOwner(request, baseURL);
    const staff = await staffIds(request);
    const word = uniqueWord('Своиоп');
    // Свой контрагент бухгалтера alisher («Свои контрагенты») и чужой — у главного бухгалтера.
    const own = await newContractor(request, origin, {
      name: `ОсОО «${word} свой»`,
      responsible: staff.alisher!,
      tariffAmount: 0,
    });
    const other = await newContractor(request, origin, {
      name: `ОсОО «${word} чужой»`,
      responsible: staff.meerim!,
      tariffAmount: 0,
    });
    await receive(request, origin, own.id, 100_000);
    await receive(request, origin, other.id, 200_000);
    // Владелец видит обе операции.
    const all = (await journalOf(request, '')).map((r) => r.contractor.id);
    expect(all).toEqual(expect.arrayContaining([own.id, other.id]));

    await signIn(page.request, origin, 'alisher', DEMO_PASSWORD);
    const mine = (await journalOf(page.request, '')).map((r) => r.contractor.id);
    expect(mine).toContain(own.id);
    expect(mine).not.toContain(other.id);
    await openFin(page, isMobile, 'all', word);
    const grid = page.locator('[data-grid]');
    await expect(grid.getByText(`ОсОО «${word} свой»`).first()).toBeVisible();
    await expect(grid.getByText(`ОсОО «${word} чужой»`)).toHaveCount(0);
  });

  test('(п. 65) оплата за обслуживание в «Финансовых операциях»: окно оплаты, без причины сумма не меняется, с причиной — долг пересчитан, в истории прежняя и новая сумма; «Удалить» убирает из итогов, видна с «Показать удалённые»', async ({
    page,
    request,
    baseURL,
    isMobile,
  }) => {
    const origin = await asOwner(request, baseURL);
    const word = uniqueWord('Обсфин');
    const name = `ОсОО «${word}»`;
    const cp = await newContractor(request, origin, { name, tariffAmount: 5_000_000 });
    const month = currentMonth();
    const form = (await (
      await request.get(`/api/contractors/${cp.id}/fee-payment-form`)
    ).json()) as { to: { key: string }[] };
    const paid = await request.post(`/api/contractors/${cp.id}/fee-payments`, {
      headers: { origin },
      data: {
        amount: 3_000_000,
        date: today(),
        to: form.to[0]!.key,
        allocation: [{ month, amount: 3_000_000 }],
      },
    });
    expect(paid.status(), await paid.text()).toBe(201);
    const { id } = (await paid.json()) as { id: string };
    // Недоплата за месяц: «Долг» нового контрагента начнётся только со сроком оплаты (он — в
    // следующем месяце, `feeDue`), поэтому пересчёт сверяем по начислению месяца.
    const debtOf = async () => {
      const fees = (await (await request.get(`/api/contractors/${cp.id}/fees`)).json()) as {
        months: { month: string; charge: number; got: number }[];
      };
      const row = fees.months.find((m) => m.month === month)!;
      return row.charge - row.got;
    };
    expect(await debtOf()).toBe(2_000_000);

    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    await openFin(page, isMobile, 'fee', word);
    const line = page.locator(`[data-grid] [data-id="fee:${id}"]`);
    await expect(line).toHaveCount(1);
    await line.getByText(name).first().click();
    await expect(
      page.getByRole('dialog', { name: som('Оплата за обслуживание 30 000 сом') }),
    ).toBeVisible();
    // Окно — по оплате, а не по заголовку: после «Изменить» в заголовке новая сумма.
    const win = page
      .getByRole('dialog')
      .filter({ has: page.locator(`[data-fee-payment-window="${id}"]`) });
    await expect(win).toHaveCount(1);

    // «Изменить»: сумма 20 000 без причины не сохраняется.
    await win.locator('[data-fin-action="edit"]').click();
    const edit = page.getByRole('dialog', { name: 'Изменить оплату за обслуживание' });
    await edit.locator('[data-fee-pay-sum]').fill('20000');
    await edit.locator(`[data-fee-pay-row="${month}"]`).fill('20000');
    await edit.locator('[data-fee-ok]').click();
    await expect(edit).toContainText('Укажите причину: меняются сумма');
    await expect(edit).toBeVisible();
    expect(await debtOf()).toBe(2_000_000);
    // С причиной — сохраняется: долг пересчитан, в истории окна — было → стало.
    await edit.locator('[data-fee-pay-reason]').fill('ошибка в сумме');
    await edit.locator('[data-fee-ok]').click();
    await expect(edit).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'Оплата изменена' })).toBeVisible();
    expect(await debtOf()).toBe(3_000_000);
    await expect(
      page.getByRole('dialog', { name: som('Оплата за обслуживание 20 000 сом') }),
    ).toBeVisible();
    await expect(win).toContainText('Изменена');
    await expect(win).toContainText(
      som('Изменено: сумма 30 000,00 → 20 000,00 сом; месяцы .*Причина: ошибка в сумме'),
    );

    // «Удалить» с причиной: из журнала и итогов уходит, с «Показать удалённые» — видна.
    await win.locator('[data-fin-action="delete"]').click();
    const del = page.getByRole('dialog', { name: 'Удалить операцию?' });
    await del.locator('[data-fin-reason]').fill('дубль');
    await del.getByRole('button', { name: 'Удалить' }).click();
    await expect(del).toBeHidden();
    await expect(win).toContainText('Удалена');
    await win.getByRole('button', { name: 'Готово', exact: true }).click();
    await expect(win).toBeHidden();
    expect(await debtOf()).toBe(5_000_000);
    await expect(line).toHaveCount(0);
    expect((await journalOf(request, '&tab=fee')).map((r) => r.id)).not.toContain(id);
    await page.locator('[data-fin-deleted]').check();
    await expect(line).toHaveCount(1);
    await expect(line).toContainText('удалена');
    const deleted = await journalOf(request, '&tab=fee&deleted=1');
    expect(deleted.find((r) => r.id === id)).toMatchObject({ deleted: true, edited: true });
  });

  test('(п. 66) поступление 15 000, из него на налоги потрачено 10 000: «Изменить поступление» не даёт сделать меньше 10 000 и называет оплаты налога', async ({
    page,
    request,
    baseURL,
    isMobile,
  }) => {
    const origin = await asOwner(request, baseURL);
    const word = uniqueWord('Поступ');
    const name = `ОсОО «${word}»`;
    const emp = await meerim(request);
    const cp = await newContractor(request, origin, { name, responsible: emp.id, tariffAmount: 0 });
    const nds = await manualReport(request, origin, {
      contractorId: cp.id,
      reportTypeCode: 'nds',
      month: '2026-09-01',
      due: '2030-01-15',
    });
    const card = async () =>
      (await (await request.get(`/api/reports/${nds}`)).json()) as { version: number };
    const amount = await request.post(`/api/reports/${nds}/amount`, {
      headers: { origin },
      data: { version: (await card()).version, amount: 1_000_000 },
    });
    expect(amount.status(), await amount.text()).toBe(200);
    const got = await request.post(`/api/contractors/${cp.id}/receipts`, {
      headers: { origin },
      data: { total: 1_500_000, date: today(), rows: [{ reportId: nds, amount: 1_000_000 }] },
    });
    expect(got.status(), await got.text()).toBe(201);
    const { id } = (await got.json()) as { id: string };
    const pay = await request.post(`/api/reports/${nds}/payments`, {
      headers: { origin },
      data: { version: (await card()).version, amount: 1_000_000, date: today(), self: false },
    });
    expect(pay.status(), await pay.text()).toBe(200);

    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    await openFin(page, isMobile, 'journal', word);
    const line = page.locator(`[data-grid] [data-id="${id}"]`);
    await expect(line).toHaveCount(1);
    // «Изменение» по умолчанию скрыт, как `SHOW` прототипа: включаем в «Столбцах».
    await page.getByRole('button', { name: /^Столбцы/ }).click();
    const panel = page.getByRole('dialog', { name: 'Столбцы' });
    await panel.getByRole('checkbox', { name: 'Изменение' }).check();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(line).toContainText(som('не меньше 10 000'));
    await line.getByText(name).first().click();
    const win = page.getByRole('dialog', { name: som('Поступление 15 000 сом') });
    await win.locator('[data-fin-action="edit"]').click();
    const edit = page.getByRole('dialog', { name: 'Изменить поступление' });
    // Окно называет оплату налога, из-за которой меньше нельзя.
    await expect(edit).toContainText(som('на налоги уже потрачено 10 000'));
    await expect(edit.getByRole('table', { name: 'Оплата налога' })).toContainText('НДС');
    // 9 000 без детализации: на налоги останется меньше потраченного — не сохраняется.
    await edit.locator('[data-receipt-total]').fill('9000');
    await edit.locator(`[data-receipt-row="${nds}"]`).fill('0');
    await edit.locator('[data-receipt-reason]').fill('ошибка');
    await edit.locator('[data-money-ok]').click();
    await expect(edit).toContainText('столько должно остаться на налоги');
    await expect(edit).toBeVisible();
    expect(await balanceOf(request, cp.id)).toMatchObject({ received: 1_500_000 });
  });
});
