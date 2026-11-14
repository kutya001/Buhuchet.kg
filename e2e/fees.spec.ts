import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { DEMO_PASSWORD, FAKE_TELEGRAM, pressStart, showStats, signIn, uniqueChat } from './helpers';
import { asOwner, editContractor, newContractor, staffIds } from './reports';

// «Контрагенты» → плата за обслуживание (задача 2.21, #77) через настоящий сайт. Демо-организация:
// «Плата за обслуживание» включена, владелец erkin видит плату и меняет журнал тарифов, бухгалтер
// alisher (роль «Бухгалтер», «Свои контрагенты») платы не видит. Контрагенты — свои на каждый запуск и
// проект (ПК и телефон), по слову в названии их находит поиск; начисление есть с месяца, когда
// контрагента завели, — с текущего.

type Fees = {
  debt: number;
  months: { month: string; charge: number; got: number; status: string }[];
  payments: { id: string; amount: number; allocation: { month: string; amount: number }[] }[];
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
  test('(п. 64) в меню «…» строки контрагента с начислением за обслуживание 60 000 сом «Принять оплату за обслуживание»: сумма подставлена 60 000, после сохранения начисление «Оплачено», долг 0, на вкладке «Обслуживание» — новая оплата, в «Финансовых операциях» на вкладке «Обслуживание» — её строка', async ({
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
    // Значение плашки — вместе с единицей: «0 сом».
    await expect(tab.locator('[data-plate="debt"] [data-plate-value]')).toHaveText(/^0\s*сом$/);
    await expect(tab).toContainText('Оплачено');
    await expect(tab).toContainText('Оплаты · 1');
    // Долга нет — «Напомнить в WhatsApp» нет; «Новая ставка» есть.
    await expect(tab.locator('[data-fee-tariff]')).toBeVisible();
    await expect(tab.locator('[data-fee-remind]')).toHaveCount(0);

    // «Финансовые операции» → «Обслуживание» (вторая половина п. 64, задача 2.22): строка оплаты.
    await page.goto('/app/fin/fee');
    await expect(page.locator('[data-grid]')).toBeVisible();
    await search(page, isMobile, word);
    const line = row(page, `fee:${fees.payments[0]!.id}`);
    await expect(line).toHaveCount(1);
    await expect(line).toContainText(name);
    await expect(line).toContainText('Оплата за обслуживание');
    await expect(line).toContainText(/\+60\s000,00/);
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
    // «Статистика» по умолчанию скрыта (прототип v88): плашки показать, иначе проверка пустая.
    await showStats(page);
    await expect(page.locator('[data-plate]').first()).toBeVisible();
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

  test('(проверка прототипа v86) в «Журнале тарифов» ошибочно внесённую ставку можно изменить с причиной: начисление пересчитано, у записи ярлык «изменена», правка — в истории контрагента; ставку, которая ещё не начала действовать, можно удалить', async ({
    page,
    request,
    baseURL,
    isMobile,
  }) => {
    const origin = await asOwner(request, baseURL);
    const word = uniqueWord('Ставка');
    const name = `ОсОО «${word}»`;
    const cp = await newContractor(request, origin, { name, tariffAmount: 6_000_000 });
    const month = currentMonth();
    const [y, m] = month.split('-').map(Number) as [number, number];
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    // Вторая ставка — со следующего месяца: она ещё не действует.
    const added = await request.post(`/api/contractors/${cp.id}/tariffs`, {
      headers: { origin },
      data: { amount: 7_000_000, period: 'M', from: next, note: 'Повышение' },
    });
    expect(added.status(), await added.text()).toBe(201);

    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    await openList(page, isMobile, word);
    const card = await openCard(page, cp.id, name);
    await toTab(page, card, isMobile, /Обслуживание/);
    const tab = card.locator('[data-fee-tab]');
    const journal = tab.locator('[data-fee-tariffs] li');
    await expect(journal).toHaveCount(2);

    // Первая ставка (с месяца начала обслуживания): удалить нельзя, причина обязательна.
    await tab.locator('[data-fee-tariff-edit="2026-01"]').click();
    const dialog = page.getByRole('dialog', { name: 'Изменить ставку обслуживания' });
    await expect(dialog.locator('[data-fee-tedit-amount]')).toHaveValue(som('60 000'));
    await expect(dialog.locator('[data-fee-tedit-delete]')).toHaveCount(0);
    await expect(dialog).toContainText('Начисления за месяцы этой ставки пересчитаются');
    // «Сохранить» без правок: «Изменений нет», окно закрывается, запись журнала прежняя.
    await dialog.locator('[data-fee-tedit-reason]').fill('проверка');
    await dialog.locator('[data-fee-tedit-ok]').click();
    await expect(page.getByRole('status').filter({ hasText: 'Изменений нет' })).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(tab.locator('[data-fee-tariffs]')).not.toContainText('изменена');
    await tab.locator('[data-fee-tariff-edit="2026-01"]').click();
    await expect(dialog.locator('[data-fee-tedit-reason]')).toHaveValue('');
    await dialog.locator('[data-fee-tedit-amount]').fill('50000');
    await dialog.locator('[data-fee-tedit-ok]').click();
    await expect(dialog).toContainText('Укажите причину');
    await dialog.locator('[data-fee-tedit-reason]').fill('ставку внесли с ошибкой');
    await dialog.locator('[data-fee-tedit-ok]').click();
    await expect(page.getByRole('status').filter({ hasText: 'Ставка изменена' })).toBeVisible();
    await expect(dialog).toBeHidden();

    // Журнал: новая сумма и ярлык «изменена» с причиной в подсказке; начисление месяца пересчитано.
    const edited = journal.filter({ hasText: /50\s000/ });
    await expect(edited).toHaveCount(1);
    await expect(edited.locator('[data-tag]')).toHaveText('изменена');
    await expect(edited.locator('[data-tag]')).toHaveAttribute(
      'title',
      /Причина: ставку внесли с ошибкой/,
    );
    const fees = await feesOf(request, cp.id);
    expect(fees.months.find((x) => x.month === month)).toMatchObject({ charge: 5_000_000 });

    // Ставка со следующего месяца ещё не действует: её можно удалить — тоже с причиной.
    await tab.locator(`[data-fee-tariff-edit="${next}"]`).click();
    await expect(dialog.locator('[data-fee-tedit-amount]')).toHaveValue(som('70 000'));
    await dialog.locator('[data-fee-tedit-delete]').click();
    await expect(dialog).toContainText('Укажите причину');
    await dialog.locator('[data-fee-tedit-reason]').fill('внесли по ошибке');
    await dialog.locator('[data-fee-tedit-delete]').click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Ставка удалена из журнала' }),
    ).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(journal).toHaveCount(1);

    // История контрагента: правка и удаление — с причиной.
    await toTab(page, card, isMobile, /История/);
    await expect(card).toContainText(
      /Изменена ставка обслуживания: сумма 60\s000\sсом → 50\s000\sсом\. Причина: ставку внесли с ошибкой/,
    );
    await expect(card).toContainText(
      /Удалена ставка 70\s000\sсом в месяц с .+ \(ещё не действовала\)\. Причина: внесли по ошибке/,
    );
  });

  test('(доработки 14.11.2026, блок 4, пункт 5) «Напомнить в Telegram» на вкладке «Обслуживание»: окно с получателем, текстом по шаблону и реквизитами для обслуживания; клиенту — «Оплата за обслуживание до …» с текстом сотрудника, реквизитами и «Оплатил»; отправка — в истории; второй раз за день кнопка неактивна — «Сегодня уже напоминали в ЧЧ:ММ»', async ({
    page,
    playwright,
    request,
    baseURL,
    isMobile,
  }) => {
    test.setTimeout(120_000);
    const origin = await asOwner(request, baseURL);
    const word = uniqueWord('Телеплата');
    const name = `ОсОО «${word}»`;
    const created = await newContractor(request, origin, { name, tariffAmount: 6_000_000 });
    // День оплаты — 1-е: срок идущего месяца уже наступил, долг за обслуживание — 60 000 сом.
    const cp = { ...created, ...(await editContractor(request, origin, created, { feeDay: 1 })) };
    expect((await feesOf(request, cp.id)).debt).toBe(6_000_000);

    // Клиент вводит код своей страницы и подключает Telegram, владелец подтверждает.
    const enabled = await request.post(`/api/contractors/${cp.id}/page/enable`, {
      headers: { origin },
    });
    expect(enabled.status(), await enabled.text()).toBe(200);
    const { code } = (await enabled.json()) as { code: string };
    const part = () => Math.floor(Math.random() * 256);
    const client = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { 'x-forwarded-for': `198.18.${part()}.${part()}` },
    });
    const opened = await client.post(`/api/page/buhgalter-plyus/${cp.inn}/code`, {
      headers: { origin },
      data: { code },
    });
    expect(opened.status(), await opened.text()).toBe(200);
    const link = await client.post(`/buhgalter-plyus/inn/${cp.inn}/telegram`, {
      headers: { origin },
    });
    expect(link.status(), await link.text()).toBe(200);
    const chat = uniqueChat();
    const { url } = (await link.json()) as { url: string };
    expect((await pressStart(request, url, chat)).status()).toBe(200);
    await client.dispose();
    const list = (await (await request.get(`/api/contractors/${cp.id}/page/telegram`)).json()) as {
      items: { id: string; name: string; version: number }[];
    };
    const waiting = list.items.find((i) => i.name === `@e2e_${chat}`)!;
    const approved = await request.post(`/api/contractors/${cp.id}/page/telegram/${waiting.id}`, {
      headers: { origin },
      data: { action: 'approve', version: waiting.version },
    });
    expect(approved.status(), await approved.text()).toBe(200);

    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    await openList(page, isMobile, word);
    const card = await openCard(page, cp.id, name);
    await toTab(page, card, isMobile, /Обслуживание/);
    const button = card.locator('[data-fee-tab] [data-fee-telegram]');
    const own = `Напоминаем об оплате за обслуживание, ${word}.`;

    await test.step('окно: получатель, текст по шаблону долга, реквизиты для обслуживания; поправил текст и отправил', async () => {
      await expect(button).toBeVisible();
      await expect(button).not.toHaveAttribute('aria-disabled', 'true');
      await button.click();
      const dialog = page.getByRole('dialog', { name: 'Напомнить в Telegram' });
      await expect(dialog.locator('[data-fee-telegram-to]')).toContainText(`@e2e_${chat}`);
      const text = dialog.locator('[data-fee-telegram-text]');
      await expect(text).toHaveValue(
        /^Долг за обслуживание — 60\s000\sсом \([а-я]+ \d{4}\)\. Пожалуйста, оплатите до \d\d\.\d\d\.\d{4}\.$/,
      );
      await expect(dialog.locator('[data-fee-telegram-requisite]')).toContainText(
        'Реквизиты для перевода — организации',
      );
      await expect(dialog.locator('[data-fee-telegram-requisite]')).toContainText(
        'Под сообщением — кнопки «Скопировать номер телефона» и «Оплатил».',
      );
      // Пустой текст не отправляется.
      await text.fill('  ');
      await dialog.locator('[data-fee-telegram-send]').click();
      await expect(dialog).toContainText('Введите текст сообщения');
      await text.fill(own);
      await dialog.locator('[data-fee-telegram-send]').click();
      await expect(
        page
          .getByRole('status')
          .filter({ hasText: 'Напоминание отправлено в Telegram: получателей — 1' }),
      ).toBeVisible();
      await expect(dialog).toBeHidden();
    });

    await test.step('клиенту — «Оплата за обслуживание до …» с текстом сотрудника, реквизитами и кнопками', async () => {
      const res = await request.get(`${FAKE_TELEGRAM}/messages?chat=${chat}`);
      expect(res.status()).toBe(200);
      const messages = (await res.json()) as {
        text: string;
        keyboard?: { text: string }[][];
      }[];
      const sent = messages.filter((m) => m.text.includes('Оплата за обслуживание до'));
      expect(sent).toHaveLength(1);
      expect(sent[0]!.text).toContain(name);
      expect(sent[0]!.text).toContain(own);
      expect(sent[0]!.text).toContain('Реквизиты для перевода — организации');
      expect(sent[0]!.keyboard?.flat().map((b) => b.text)).toEqual([
        'Скопировать номер телефона',
        'Оплатил',
      ]);
    });

    await test.step('второй раз за день кнопка неактивна: «Сегодня уже напоминали в ЧЧ:ММ»', async () => {
      await expect(button).toHaveAttribute('aria-disabled', 'true');
      await expect(button).toHaveAttribute('title', /^Сегодня уже напоминали в \d\d:\d\d$/);
      // Кнопка помечена недоступной, но нажимается: по нажатию — причина сообщением, окна нет.
      await button.click({ force: true });
      await expect(
        page.getByRole('status').filter({ hasText: /Сегодня уже напоминали в \d\d:\d\d/ }),
      ).toBeVisible();
      await expect(page.getByRole('dialog', { name: 'Напомнить в Telegram' })).toHaveCount(0);
    });

    await test.step('отправка — в истории контрагента', async () => {
      await toTab(page, card, isMobile, /История/);
      await expect(card).toContainText(
        /Напоминание об оплате за обслуживание отправлено в Telegram: 60\s000\sсом, получателей — 1/,
      );
    });
  });
});
