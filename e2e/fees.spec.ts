import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { DEMO_PASSWORD, signIn } from './helpers';
import { asOwner, newContractor, staffIds } from './reports';

// «Контрагенты» → плата за обслуживание (задача 2.21, #77) через настоящий сайт. Демо-организация:
// «Плата за обслуживание» включена, владелец erkin видит плату и меняет журнал тарифов, бухгалтер
// alisher (роль «Бухгалтер», «Свои контрагенты») платы не видит. Контрагенты — свои на каждый запуск и
// проект (ПК и телефон), по слову в названии их находит поиск; начисление есть с месяца, когда
// контрагента завели, — с текущего.

type Fees = {
  debt: number;
  months: { month: string; charge: number; got: number; status: string }[];
  payments: { amount: number; allocation: { month: string; amount: number }[] }[];
};

/** Слово из кириллицы, своё на каждый запуск: по нему поиск находит только контрагентов теста. */
const uniqueWord = (prefix: string) =>
  `${prefix}${Array.from({ length: 6 }, () => 'абвгдежзиклмнопрстуф'[Math.floor(Math.random() * 20)]).join('')}`;

/** Идущий месяц по Бишкеку (UTC+6). */
const currentMonth = () => new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 7);

/** Сумма на экране — с неразрывными пробелами: «60 000». */
const som = (text: string) => new RegExp(`^${text.replace(/ /g, '\\s')}$`);

/** Общий поиск по вкладке (на телефоне — кнопкой «Поиск» в верхней панели). */
async function search(page: Page, isMobile: boolean, text: string) {
  if (isMobile) await page.getByRole('button', { name: 'Поиск', exact: true }).click();
  await page.getByRole('searchbox').first().fill(text);
}

const row = (page: Page, id: string) => page.locator(`[data-grid] [data-id="${id}"]`);

/** «Контрагенты» → «Все» с поиском по слову теста. */
async function openList(page: Page, isMobile: boolean, word: string) {
  await page.goto('/app/cps/all');
  await expect(page.locator('[data-grid]')).toBeVisible();
  await search(page, isMobile, word);
}

/** Карточка контрагента из списка: строка (на телефоне — плитка) по названию. */
async function openCard(page: Page, id: string, name: string): Promise<Locator> {
  await row(page, id).getByText(name, { exact: true }).click();
  const card = page.getByRole('dialog', { name });
  await expect(card.locator('[data-cp-card]')).toBeVisible();
  return card;
}

/** Названия вкладок карточки (на телефоне — пункты списка под текущей вкладкой). */
async function tabNames(page: Page, card: Locator, isMobile: boolean): Promise<string[]> {
  if (!isMobile) return card.getByRole('tab').allInnerTexts();
  await card.getByRole('tab', { selected: true }).click();
  const names = await page.getByRole('menu').getByRole('menuitem').allInnerTexts();
  await page.keyboard.press('Escape');
  return names;
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

async function feesOf(api: APIRequestContext, id: string): Promise<Fees> {
  const res = await api.get(`/api/contractors/${id}/fees`);
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as Fees;
}

test.describe('Этап 2: плата за обслуживание', () => {
  test('(п. 64) в меню «…» строки контрагента с начислением за обслуживание 60 000 сом «Принять оплату за обслуживание»: сумма подставлена 60 000, после сохранения начисление «Оплачено», долг 0, на вкладке «Обслуживание» — новая оплата', async ({
    page,
    request,
    baseURL,
    isMobile,
  }) => {
    const origin = await asOwner(request, baseURL);
    const word = uniqueWord('Плата');
    const name = `ОсОО «${word}»`;
    const cp = await newContractor(request, origin, { name, tariffAmount: 6_000_000 });
    const month = currentMonth();

    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    await openList(page, isMobile, word);
    await expect(row(page, cp.id)).toHaveCount(1);
    await row(page, cp.id).locator('[data-row-menu]').click();
    const menu = page.getByRole('menu', { name: 'Действия' });
    await menu.getByRole('menuitem', { name: /Принять оплату за обслуживание/ }).click();

    const dialog = page.getByRole('dialog', { name: 'Принять оплату за обслуживание' });
    await expect(dialog.locator('[data-fee-pay-sum]')).toHaveValue(som('60 000'));
    // Сумма сама распределена на неоплаченный месяц: «Станет» — «оплачено», «сходится».
    await expect(dialog.locator(`[data-fee-pay-row="${month}"]`)).toHaveValue(som('60 000'));
    await expect(dialog.locator('[data-fee-pay-line]')).toContainText('сходится');
    await dialog.locator('[data-fee-ok]').click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Оплата за обслуживание принята' }),
    ).toBeVisible();
    await expect(dialog).toBeHidden();

    const fees = await feesOf(request, cp.id);
    expect(fees.debt).toBe(0);
    expect(fees.months.find((m) => m.month === month)).toMatchObject({
      charge: 6_000_000,
      got: 6_000_000,
      status: 'paid',
    });
    expect(fees.payments).toEqual([
      expect.objectContaining({ amount: 6_000_000, allocation: [{ month, amount: 6_000_000 }] }),
    ]);

    // Карточка → «Обслуживание»: долг 0, начисление «Оплачено», оплата в «Оплаты · 1».
    const card = await openCard(page, cp.id, name);
    await toTab(page, card, isMobile, /Обслуживание/);
    const tab = card.locator('[data-fee-tab]');
    await expect(tab.locator('[data-plate="debt"] [data-plate-value]')).toHaveText(som('0'));
    await expect(tab).toContainText('Оплачено');
    await expect(tab).toContainText('Оплаты · 1');
    // Долга нет — «Напомнить в WhatsApp» нет; «Новая ставка» есть.
    await expect(tab.locator('[data-fee-tariff]')).toBeVisible();
    await expect(tab.locator('[data-fee-remind]')).toHaveCount(0);
  });

  test('(п. 7, плата за обслуживание) плата ведётся отдельно от налогов, и обычный бухгалтер её не видит: нет вкладки «Обслуживание», плашки «Должники», долга в строке списка и записей об оплате в истории; API отвечает 403', async ({
    page,
    request,
    baseURL,
    isMobile,
  }) => {
    const origin = await asOwner(request, baseURL);
    const staff = await staffIds(request);
    const word = uniqueWord('Обслуж');
    const name = `ОсОО «${word}»`;
    const cp = await newContractor(request, origin, { name, responsible: staff.alisher! });
    // Владелец принимает оплату 5 000 сом: часть начисления, на налоги контрагента она не попадает.
    const form = (await (
      await request.get(`/api/contractors/${cp.id}/fee-payment-form`)
    ).json()) as { to: { key: string }[] };
    const paid = await request.post(`/api/contractors/${cp.id}/fee-payments`, {
      headers: { origin },
      data: {
        amount: 500_000,
        date: new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10),
        to: form.to[0]!.key,
        allocation: [{ month: currentMonth(), amount: 500_000 }],
      },
    });
    expect(paid.status(), await paid.text()).toBe(201);
    const money = (await (await request.get(`/api/contractors/${cp.id}/money`)).json()) as {
      balance: { received: number };
    };
    expect(money.balance.received).toBe(0);

    // Владелец видит вкладку «Обслуживание» и оплату в истории.
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    await openList(page, isMobile, word);
    let card = await openCard(page, cp.id, name);
    expect(await tabNames(page, card, isMobile)).toEqual(
      expect.arrayContaining([expect.stringMatching(/Обслуживание/)]),
    );
    await toTab(page, card, isMobile, /История/);
    await expect(card).toContainText('Оплата за обслуживание');
    await card.getByRole('button', { name: 'Готово' }).click();

    // Бухгалтер alisher: ответы API — 403, в строке списка долга нет.
    await signIn(page.request, origin, 'alisher', DEMO_PASSWORD);
    const api = page.request;
    expect((await api.get(`/api/contractors/${cp.id}/fees`)).status()).toBe(403);
    expect((await api.get(`/api/contractors/${cp.id}/fee-payment-form`)).status()).toBe(403);
    expect((await api.get(`/api/contractors/${cp.id}/fee-reminder`)).status()).toBe(403);
    // Вкладка «Должники» без права «Видеть плату» пуста, даже если должники есть.
    const debtors = await api.get('/api/contractors?tab=debtors&size=all');
    expect(debtors.status(), await debtors.text()).toBe(200);
    expect(((await debtors.json()) as { items: unknown[] }).items).toEqual([]);
    const list = (await (await api.get('/api/contractors?size=all')).json()) as {
      items: { id: string; feeDebt: number | null; feeCharged: boolean | null; tariff: unknown }[];
    };
    expect(list.items.find((r) => r.id === cp.id)).toMatchObject({
      feeDebt: null,
      feeCharged: null,
      tariff: null,
    });
    const summary = (await (await api.get('/api/contractors/summary')).json()) as {
      debtors: unknown;
    };
    expect(summary.debtors).toBeNull();

    // На экране: ни плашки «Должники», ни вкладки «Обслуживание», ни строки об оплате в истории.
    await openList(page, isMobile, word);
    await expect(page.locator('[data-plate="deb"]')).toHaveCount(0);
    card = await openCard(page, cp.id, name);
    const names = await tabNames(page, card, isMobile);
    expect(names.some((n) => /Деньги/.test(n))).toBe(true);
    expect(names.some((n) => /Обслуживание/.test(n))).toBe(false);
    await toTab(page, card, isMobile, /История/);
    await expect(card.locator('[data-timeline-item]').first()).toBeVisible();
    await expect(card).not.toContainText('Оплата за обслуживание');
    await expect(card).not.toContainText('Ставка обслуживания');
  });
});
