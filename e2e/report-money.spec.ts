import { randomBytes } from 'node:crypto';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { search } from './admin';
import { DEMO_PASSWORD, signIn } from './helpers';
import { asOwner, manualReport, newContractor } from './reports';

// «Отчеты для сдачи»: деньги по отчётам — поступления и оплата налога (задача 2.19, #75) через
// настоящий сайт. Отчёты — «Разовым отчётом» через API у своего на каждый запуск и проект (ПК и телефон)
// контрагента демо-организации: в ней включены «Учёт оплаты налогов» и «Сдача отчёта только после
// оплаты», сдача требует подтверждения. Владелец erkin; ответственный новых контрагентов — главный
// бухгалтер meerim (деньги контрагента — на его счёте).

type Card = {
  id: string;
  version: number;
  status: string;
  amount: number | null;
  received: number;
  paid: number;
  selfPaid: number;
};

type Balance = { received: number; paid: number; selfPaid: number; available: number };

/** Слово из кириллицы, своё на каждый запуск: по нему поиск находит только отчёты этого теста. */
const uniqueWord = (prefix: string) =>
  `${prefix}${Array.from({ length: 6 }, () => 'абвгдежзиклмнопрстуф'[Math.floor(Math.random() * 20)]).join('')}`;

/** Сегодня по Бишкеку. */
const today = () => new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 10);

/** Сумма на экране: «5 000 сом» с неразрывными пробелами. */
const som = (text: string) => new RegExp(text.replace(/ /g, '\\s'));

async function cardOf(api: APIRequestContext, id: string): Promise<Card> {
  const res = await api.get(`/api/reports/${id}`);
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as Card;
}

/** «Баланс по контрагенту»: получено, оплачено, доступно. */
async function balanceOf(api: APIRequestContext, contractorId: string): Promise<Balance> {
  const res = await api.get(`/api/contractors/${contractorId}/money`);
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { balance: Balance }).balance;
}

/** «Указать сумму» через API. */
async function setAmount(api: APIRequestContext, origin: string, id: string, amount: number) {
  const res = await api.post(`/api/reports/${id}/amount`, {
    headers: { origin },
    data: { version: (await cardOf(api, id)).version, amount },
  });
  expect(res.status(), await res.text()).toBe(200);
}

/** «Поступление от контрагента» через API: общая сумма и детализация по отчётам (без неё — аванс). */
async function receive(
  api: APIRequestContext,
  origin: string,
  contractorId: string,
  total: number,
  rows: { reportId: string; amount: number }[] = [],
) {
  const res = await api.post(`/api/contractors/${contractorId}/receipts`, {
    headers: { origin },
    data: { total, date: today(), rows },
  });
  expect(res.status(), await res.text()).toBe(201);
}

/** «Отчеты для сдачи» → «Все» с общим поиском по слову теста. */
async function openList(page: Page, isMobile: boolean, word: string) {
  await page.goto('/app/reports/all');
  await expect(page.locator('[data-grid]')).toBeVisible();
  await search(page, isMobile, word);
}

const row = (page: Page, id: string) => page.locator(`[data-grid] [data-id="${id}"]`);

/** Касание строки или плитки открывает карточку отчёта (окно с названием вида). */
async function openCard(page: Page, id: string, text: string, typeName: string): Promise<Locator> {
  await expect(row(page, id)).toHaveCount(1);
  await row(page, id).getByText(text).first().click();
  const card = page.getByRole('dialog', { name: typeName });
  await expect(
    card.locator(`[data-report-card="${id}"] [data-status-scale]`).first(),
  ).toBeVisible();
  return card;
}

/** Ячейка блока сумм карточки по подписи («К уплате», «Получено от контрагента», …). */
const sum = (card: Locator, label: string) =>
  card.locator('[data-report-sums] > div').filter({ hasText: label });

/** Текст ячейки столбца `key` в строке таблицы (по порядку заголовков). */
const cellText = (page: Page, id: string, key: string) =>
  page.locator('[data-grid]').evaluate(
    (el, [rowId, col]) => {
      const heads = Array.from(el.querySelectorAll('thead tr:first-child th'));
      const i = heads.findIndex((th) => th.getAttribute('data-column') === col);
      const r = el.querySelector(`tbody tr[data-id="${rowId}"]`);
      return i < 0 || !r ? null : (r.children[i]?.textContent ?? null);
    },
    [id, key] as const,
  );

test.describe('Этап 2: деньги по отчётам — поступления и оплата налога', () => {
  test('(п. 69) суммы идут столбцами «К уплате», «Получено от контрагента», «Оплачено в бюджет»; у НДС с суммой 5 000 сом без оплаты «Отметить сданным» неактивна с причиной «Сначала оплатите налог…»; после оплаты 3 000 сом отчёт отмечается «Сдан»; статистический отчёт отмечается «Сдан» сразу', async ({
    page,
    request,
    baseURL,
    isMobile,
  }) => {
    const origin = await asOwner(request, baseURL);
    const word = uniqueWord('Оплата');
    const name = `ОсОО «${word}»`;
    const cp = await newContractor(request, origin, { name });
    const report = (reportTypeCode: string) =>
      manualReport(request, origin, {
        contractorId: cp.id,
        reportTypeCode,
        month: '2026-09-01',
        due: '2030-01-15',
      });
    const nds = await report('nds');
    const t1 = await report('t1m');
    await setAmount(request, origin, nds, 500_000);

    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    await openList(page, isMobile, word);
    await expect(page.locator('[data-grid] [data-id]')).toHaveCount(2);
    if (isMobile) {
      // На плитке суммы — одной строкой в том же порядке.
      const line = row(page, nds).locator('[data-tile-line]');
      await expect(line).toContainText(/К уплате\s*5\s000.*Получено\s*0.*Оплачено\s*0/);
    } else {
      const heads = await page
        .locator('[data-grid] thead tr:first-child th')
        .evaluateAll((ths) => ths.map((th) => th.getAttribute('data-column')));
      const at = (key: string) => heads.indexOf(key);
      expect(at('amount')).toBeGreaterThan(-1);
      expect(at('received')).toBe(at('amount') + 1);
      expect(at('paid')).toBe(at('amount') + 2);
      const grid = page.locator('[data-grid]');
      await expect(grid.locator('th[data-column="amount"]')).toContainText('К уплате');
      await expect(grid.locator('th[data-column="received"]')).toContainText(
        'Получено от контрагента',
      );
      await expect(grid.locator('th[data-column="paid"]')).toContainText('Оплачено в бюджет');
      expect(await cellText(page, nds, 'amount')).toMatch(/5\s000/);
      expect(await cellText(page, nds, 'paid')).toMatch(/^0/);
    }

    const card = await openCard(page, nds, name, 'НДС');
    const why = som('Сначала оплатите налог: к уплате 5 000 сом, оплачено 0 сом');
    await expect(card.locator('[data-report-button="submit"]')).toBeDisabled();
    await expect(card.locator('[data-report-button="submit"]')).toHaveAttribute('title', why);
    await expect(card.locator('[data-pay-first]')).toContainText(why);
    // Шаг «Сдан» на шкале закрыт с той же причиной, под шкалой — подсказка (прототип scaleFull).
    const scale = card.locator('[data-status-scale]').first();
    await expect(
      scale.locator('button[aria-disabled="true"]').filter({ hasText: 'Сдан' }),
    ).toHaveAttribute('title', why);
    await expect(card.getByText(som('«Сдан»: Сначала оплатите налог')).first()).toBeVisible();

    // «Отметить оплаченным»: денег контрагента нет — «Оплатил контрагент сам» уже включён.
    await card.locator('[data-report-button="pay"]').click();
    const pay = page.getByRole('dialog', { name: 'Оплата налога в бюджет' });
    await expect(pay.locator('[data-payment-self] input')).toBeChecked();
    await pay.locator('[data-payment-amount]').fill('3 000');
    await pay.locator('[data-money-ok]').click();
    await expect(pay).toBeHidden();
    await expect(sum(card, 'Оплачено в бюджет')).toContainText(som('3 000 сом'));
    expect((await cardOf(request, nds)).paid).toBe(300_000);

    // Частичная оплата — «Сдан» можно поставить.
    await expect(card.locator('[data-report-button="submit"]')).toBeEnabled();
    await card.locator('[data-report-button="submit"]').click();
    const submit = page.getByRole('dialog', { name: 'Отметить отчёт сданным' });
    await expect(submit.locator('[data-report-amount]')).toHaveValue(/^5\s000$/);
    await submit.locator('[data-report-ok]').click();
    await expect(submit).toBeHidden();
    expect((await cardOf(request, nds)).status).toBe('submitted');
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();

    // Статистический отчёт: платить нечего — «Сдан» сразу.
    const stat = await openCard(page, t1, name, 'Форма 1-Т — отчёт по труду, месячный');
    await expect(stat.locator('[data-report-sums]')).toHaveCount(0);
    await expect(stat.locator('[data-report-button="submit"]')).toBeEnabled();
    await stat.locator('[data-report-button="submit"]').click();
    const dialog = page.getByRole('dialog', { name: 'Отметить отчёт сданным' });
    await dialog.locator('[data-report-ok]').click();
    await expect(dialog).toBeHidden();
    expect((await cardOf(request, t1)).status).toBe('submitted');
  });

  test('(п. 72) у ЕН за III кв. 2026 ещё нет суммы: «Отметить сданным» открывает окно «Сдан»; ввели 4 000 сом и приложили файл — сумма и файл сохранены, отчёт не отмечен «Сдан», в истории запись «(сдача — после оплаты)»', async ({
    page,
    request,
    baseURL,
    isMobile,
  }) => {
    const origin = await asOwner(request, baseURL);
    const word = uniqueWord('Квартал');
    const name = `ОсОО «${word}»`;
    const cp = await newContractor(request, origin, { name });
    const en = await manualReport(request, origin, {
      contractorId: cp.id,
      reportTypeCode: 'enq',
      month: '2026-07-01',
      due: '2030-01-15',
    });
    const file = `единый-налог-${Date.now().toString(36)}${randomBytes(3).toString('hex')}.pdf`;

    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    await openList(page, isMobile, word);
    const card = await openCard(page, en, name, 'Единый налог, квартальный');
    await expect(card.locator('[data-pay-first]')).toHaveCount(0);
    await card.locator('[data-report-button="submit"]').click();
    const dialog = page.getByRole('dialog', { name: 'Отметить отчёт сданным' });
    await dialog.locator('[data-report-amount]').fill('4 000');
    await dialog.locator('[data-report-files]').setInputFiles({
      name: file,
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n%%EOF\n'),
    });
    await dialog.locator('[data-report-ok]').click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'Сумма сохранена' })).toBeVisible();

    expect(await cardOf(request, en)).toMatchObject({ status: 'todo', amount: 400_000 });
    await expect(card).toContainText(file);
    await expect(sum(card, 'К уплате')).toContainText(som('4 000 сом'));
    await expect(card.locator('[data-report-button="submit"]')).toBeDisabled();
    await expect(card.locator('[data-pay-first]')).toContainText(
      som('Сначала оплатите налог: к уплате 4 000 сом, оплачено 0 сом'),
    );
    const entry = card
      .getByRole('list', { name: 'История изменений' })
      .locator('[data-timeline-item]')
      .filter({ hasText: '(сдача — после оплаты)' });
    await expect(entry).toHaveCount(1);
    await expect(entry).toContainText(som('Сумма к уплате: не указана → 4 000 сом'));
    await expect(entry).toContainText(file);
  });

  test('(п. 73) у контрагента на налоги 1 000 сом, а к уплате 5 000 сом: в окне «Отметить оплаченным» «Оплатил контрагент сам» уже включён; после сохранения «Оплачено в бюджет» — 5 000 сом, а «Получено от контрагента» и остаток контрагента не изменились', async ({
    page,
    request,
    baseURL,
    isMobile,
  }) => {
    const origin = await asOwner(request, baseURL);
    const word = uniqueWord('Напрямую');
    const name = `ОсОО «${word}»`;
    const cp = await newContractor(request, origin, { name });
    const nds = await manualReport(request, origin, {
      contractorId: cp.id,
      reportTypeCode: 'nds',
      month: '2026-09-01',
      due: '2030-01-15',
    });
    await setAmount(request, origin, nds, 500_000);
    // 1 000 сом на налоги — аванс без детализации.
    await receive(request, origin, cp.id, 100_000);
    const before = await balanceOf(request, cp.id);
    expect(before).toMatchObject({ received: 100_000, paid: 0, available: 100_000 });

    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    await openList(page, isMobile, word);
    const card = await openCard(page, nds, name, 'НДС');
    await card.locator('[data-report-button="pay"]').click();
    const pay = page.getByRole('dialog', { name: 'Оплата налога в бюджет' });
    await expect(pay).toContainText(som('1 000 сом'));
    await expect(pay.locator('[data-payment-self] input')).toBeChecked();
    await expect(pay.locator('[data-payment-amount]')).toHaveValue(/^5\s000$/);
    await pay.locator('[data-money-ok]').click();
    await expect(pay).toBeHidden();
    await expect(
      page.getByRole('status').filter({ hasText: 'Оплата контрагентом напрямую отмечена' }),
    ).toBeVisible();
    await expect(sum(card, 'Оплачено в бюджет')).toContainText(som('5 000 сом'));
    await expect(sum(card, 'Оплачено в бюджет')).toContainText(
      som('оплатил контрагент сам: 5 000 сом'),
    );
    expect(await cardOf(request, nds)).toMatchObject({ paid: 500_000, selfPaid: 500_000 });
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();

    // «Баланс по контрагенту»: получено и остаток на счёте прежние — оплата не из денег контрагента.
    expect(await balanceOf(request, cp.id)).toMatchObject({
      received: before.received,
      paid: 500_000,
      selfPaid: 500_000,
      available: before.available,
    });
    await page.goto('/app/cps/all');
    await expect(page.locator('[data-grid] [data-id]').first()).toBeVisible();
    await search(page, isMobile, word);
    await page
      .locator('[data-grid] [data-id]')
      .filter({ hasText: name })
      .first()
      .getByText(name, { exact: true })
      .click();
    const cpCard = page.getByRole('dialog', { name });
    const balance = cpCard.locator('[data-money-balance]');
    const value = (label: string) =>
      balance.locator('dl > div').filter({ hasText: label }).locator('[data-kv-value]');
    await expect(value('Получено от контрагента')).toHaveText(som('^1 000 сом$'));
    await expect(value('Остаток на счёте')).toHaveText(som('^1 000 сом$'));
    await expect(value('Оплачено в бюджет')).toContainText(
      som('5 000 сом.*из них контрагент оплатил сам: 5 000 сом'),
    );
  });

  test('(п. 7, налоги) по отчёту видно, сколько денег на налог пришло от контрагента и сколько оплачено в бюджет: в списке и в карточке отчёта', async ({
    page,
    request,
    baseURL,
    isMobile,
  }) => {
    const origin = await asOwner(request, baseURL);
    const word = uniqueWord('Поступление');
    const name = `ОсОО «${word}»`;
    const cp = await newContractor(request, origin, { name });
    const nds = await manualReport(request, origin, {
      contractorId: cp.id,
      reportTypeCode: 'nds',
      month: '2026-09-01',
      due: '2030-01-15',
    });
    await setAmount(request, origin, nds, 500_000);
    // Контрагент перевёл 5 000 сом за этот НДС; из них 2 000 сом оплачено в бюджет.
    await receive(request, origin, cp.id, 500_000, [{ reportId: nds, amount: 500_000 }]);
    const { version } = await cardOf(request, nds);
    const paid = await request.post(`/api/reports/${nds}/payments`, {
      headers: { origin },
      data: { version, amount: 200_000, date: today(), self: false },
    });
    expect(paid.status(), await paid.text()).toBe(200);
    expect(await cardOf(request, nds)).toMatchObject({ received: 500_000, paid: 200_000 });

    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    await openList(page, isMobile, word);
    if (isMobile) {
      await expect(row(page, nds).locator('[data-tile-line]')).toContainText(
        /К уплате\s*5\s000.*Получено\s*5\s000.*Оплачено\s*2\s000/,
      );
    } else {
      expect(await cellText(page, nds, 'received')).toMatch(/5\s000/);
      expect(await cellText(page, nds, 'paid')).toMatch(/2\s000/);
    }
    const card = await openCard(page, nds, name, 'НДС');
    await expect(sum(card, 'К уплате')).toContainText(som('5 000 сом'));
    await expect(sum(card, 'Получено от контрагента')).toContainText(som('5 000 сом'));
    await expect(sum(card, 'Получено от контрагента')).toContainText('получено полностью');
    await expect(sum(card, 'Оплачено в бюджет')).toContainText(som('2 000 сом'));
    await expect(sum(card, 'Осталось оплатить')).toContainText(som('3 000 сом'));
  });
});
