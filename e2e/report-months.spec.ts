import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { asOwner, manualReport, newContractor, prepay } from './reports';

// «К сдаче и к оплате по месяцам» (доработки заказчика 13.11.2026, задача К2; прототип v90
// modules/report-months.js) через настоящий сайт: вкладка «Отчёты к сдаче» карточки контрагента и
// вкладка «По месяцам» модуля «Отчеты для сдачи». Отчёты — «Разовым отчётом» через API у своего на
// каждый запуск и проект (ПК и телефон) контрагента демо-организации; владелец — erkin.

/** Слово из кириллицы, своё на каждый запуск: по нему поиск находит только контрагента теста. */
const uniqueWord = (prefix: string) =>
  `${prefix}${Array.from({ length: 6 }, () => 'абвгдежзиклмнопрстуф'[Math.floor(Math.random() * 20)]).join('')}`;

/** Общий поиск по вкладке (на телефоне — кнопкой «Поиск» в верхней панели). */
async function search(page: Page, isMobile: boolean, text: string) {
  if (isMobile) await page.getByRole('button', { name: 'Поиск', exact: true }).click();
  await page.getByRole('searchbox').first().fill(text);
}

/** Вкладка карточки контрагента (на телефоне — из меню вкладок). */
async function toCardTab(page: Page, card: Locator, isMobile: boolean, name: RegExp) {
  if (isMobile) {
    await card.getByRole('tab', { selected: true }).click();
    await page.getByRole('menu').getByRole('menuitem', { name }).click();
  } else {
    await card.getByRole('tab', { name }).click();
  }
}

/** «Отметить сданным» через API сегодняшней датой по Бишкеку. */
async function submitReport(api: APIRequestContext, origin: string, id: string) {
  const card = await api.get(`/api/reports/${id}`);
  expect(card.status(), await card.text()).toBe(200);
  const { version } = (await card.json()) as { version: number };
  const date = new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10);
  const res = await api.post(`/api/reports/${id}/submit`, {
    headers: { origin },
    data: { version, date },
  });
  expect(res.status(), await res.text()).toBe(200);
}

/** Карточка контрагента из списка «Контрагентов» на вкладке «Отчёты к сдаче». */
async function openReportsTab(page: Page, isMobile: boolean, word: string): Promise<Locator> {
  const name = `ОсОО «${word}»`;
  await page.goto('/app/cps/all');
  await expect(page.locator('[data-grid] [data-id]').first()).toBeVisible();
  await search(page, isMobile, word);
  await page.locator('[data-grid] [data-id]').filter({ hasText: name }).first().click();
  const card = page.getByRole('dialog', { name });
  await expect(card.locator('[data-cp-card]')).toBeVisible();
  if (isMobile) {
    await card.getByRole('tab', { selected: true }).click();
    await page
      .getByRole('menu')
      .getByRole('menuitem', { name: /^Отчёты к сдаче/ })
      .click();
  } else {
    await card.getByRole('tab', { name: /^Отчёты к сдаче/ }).click();
  }
  return card;
}

const MONTHS = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
];

/** Прошлый месяц по Бишкеку (UTC+6): год и номер месяца с нуля. */
function previousMonth(): { y: number; m: number } {
  const now = new Date(Date.now() + 6 * 3_600_000);
  const m = now.getUTCMonth() - 1;
  return m < 0 ? { y: now.getUTCFullYear() - 1, m: 11 } : { y: now.getUTCFullYear(), m };
}

test.describe('Доработки 13.11.2026, К2: отчёты и налоги по месяцам', () => {
  test('(доработки 13.11.2026, К2) в карточке контрагента «Отчёты к сдаче» — по месяцам: что сдать и что оплатить, суммы и сроки; статус и сумма видны сразу; «Уплатить» — только неоплаченное; «Списком» запоминается', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = await asOwner(page.request, baseURL);
    const word = uniqueWord('Помесячно');
    const cp = await newContractor(page.request, origin, { name: `ОсОО «${word}»` });
    const report = (reportTypeCode: string, month: string) =>
      manualReport(page.request, origin, {
        contractorId: cp.id,
        reportTypeCode,
        month,
        due: '2030-01-15',
      });
    const nds = await report('nds', '2026-09-01');
    const t1 = await report('t1m', '2026-09-01');
    const pat = await report('pat', '2026-08-01');
    // Июль закрыт: единственный отчёт месяца сдан, платить по нему нечего.
    const t1Jul = await report('t1m', '2026-07-01');
    await submitReport(page.request, origin, t1Jul);

    const card = await openReportsTab(page, isMobile, word);
    const months = card.locator('[data-contractor-months]');
    const sep = months.locator('[data-report-month="2026-09"]');
    const aug = months.locator('[data-report-month="2026-08"]');
    const jul = months.locator('[data-report-month="2026-07"]');
    const closed = months.locator('[data-months-closed]');
    const row = (id: string) => months.locator(`[data-mini-row="${id}"]`);
    const menu = page.getByRole('menu', { name: 'Действия' });

    await test.step('по умолчанию — «По месяцам»: месяцы от старых к новым, у каждого — что сдать и что оплатить', async () => {
      await expect(card.locator('[data-reports-mode] [data-mode="months"]')).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(sep.locator('[data-month-title]')).toHaveText('За сентябрь 2026');
      await expect(aug.locator('[data-month-title]')).toHaveText('За август 2026');
      // Сентябрь: НДС и 1-Т сдать, по НДС — уплатить, сумма ещё не указана.
      await expect(sep.locator('[data-month-pill="submitted"]')).toHaveText('сдано 0 из 2');
      await expect(sep.locator('[data-month-pill="no_amount"]')).toHaveText('без суммы 1');
      // Сроки месяца: оплата НДС — по правилу вида, сдача — 15.01.2030.
      await expect(sep.locator('[data-month-sum]')).toContainText(/сроки \d\d\.\d\d–15\.01\.2030/);
      await expect(row(nds)).toContainText('Сдача + уплата');
      await expect(row(nds)).toContainText('15.01.2030');
      await expect(row(nds)).toContainText('не указана');
      await expect(row(t1)).toContainText('Сдача');
      // Август: патент — только уплата, сдавать нечего.
      await expect(aug.locator('[data-month-pill="submitted"]')).toHaveCount(0);
      await expect(aug.locator('[data-month-pill="no_amount"]')).toHaveText('без суммы 1');
      await expect(row(pat)).toContainText('Уплата');
      const ids = await months
        .locator('[data-report-month]')
        .evaluateAll((els) => els.map((el) => el.getAttribute('data-report-month')));
      expect(ids.indexOf('2026-08')).toBeLessThan(ids.indexOf('2026-09'));
      // Закрытый месяц скрыт, пока не отмечена галочка «Закрытые месяцы».
      await expect(jul).toHaveCount(0);
      await expect(months.getByText('Закрытые месяцы · 1')).toBeVisible();
      await expect(closed).not.toBeChecked();
    });

    await test.step('«⋯» → «Взять в работу» и «Указать сумму»: статус и сумма сразу в строке и в итоге месяца', async () => {
      await row(nds).locator('[data-row-menu]').click();
      await menu.getByRole('menuitem', { name: 'Взять в работу' }).click();
      await expect(row(nds)).toContainText('В работе');
      await row(nds).locator('[data-row-menu]').click();
      await menu.getByRole('menuitem', { name: 'Указать сумму' }).click();
      const dialog = page.getByRole('dialog', { name: 'Сумма к уплате' });
      await dialog.locator('[data-report-amount]').fill('5 000');
      await dialog.locator('[data-report-ok]').click();
      await expect(dialog).toBeHidden();
      await expect(row(nds)).toContainText(/5\s000/);
      await expect(sep.locator('[data-month-pill="amount"]')).toContainText(/к уплате 5\s000,00/);
      await expect(sep.locator('[data-month-pill="no_amount"]')).toHaveCount(0);
      // Сверху — сколько осталось оплатить по всем месяцам, под отчётами месяца — «Итого за месяц».
      await expect(months.locator('[data-months-left]')).toHaveText(
        /Осталось оплатить:\s*5\s000\sсом/,
      );
      const total = sep.locator('[data-mini-total]');
      await expect(total).toContainText('Итого за месяц');
      await expect(total).toContainText(/5\s000,00/);
      await expect(total).toContainText(/осталось 5\s000,00/);
    });

    await test.step('«Уплатить» — только то, что нужно оплатить; «Сдать» — что нужно сдать', async () => {
      await months.locator('[data-months-quick] [data-quick="pay"]').click();
      await expect(row(nds)).toBeVisible();
      await expect(row(pat)).toBeVisible();
      await expect(row(t1)).toHaveCount(0);
      await months.locator('[data-months-quick] [data-quick="sub"]').click();
      await expect(row(t1)).toBeVisible();
      await expect(row(pat)).toHaveCount(0);
      await months.locator('[data-months-quick] [data-quick="all"]').click();
      await expect(row(pat)).toBeVisible();
    });

    await test.step('«Закрытые месяцы» показывает закрытый июль свёрнутым; выбор живёт, пока карточка открыта', async () => {
      await closed.check();
      await expect(jul).toHaveAttribute('data-month-state', 'done');
      await expect(jul.locator('[data-month-pill="submitted"]')).toHaveText('сдано 1 из 1');
      await expect(row(t1Jul)).toHaveCount(0);
      await months.locator('[data-months-quick] [data-quick="pay"]').click();
      await expect(row(t1)).toHaveCount(0);
      // Ушли на другую вкладку карточки и вернулись — «Уплатить» всё ещё выбрано.
      await toCardTab(page, card, isMobile, /^История/);
      await expect(months).toHaveCount(0);
      await toCardTab(page, card, isMobile, /^Отчёты к сдаче/);
      await expect(months.locator('[data-months-quick] [data-quick="pay"]')).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(row(t1)).toHaveCount(0);
      await months.locator('[data-months-quick] [data-quick="all"]').click();
      await expect(closed).toBeChecked();
      await expect(jul).toBeVisible();
    });

    await test.step('месяц сворачивается; строка открывает карточку отчёта', async () => {
      await aug.locator('[data-month-toggle]').click();
      await expect(row(pat)).toHaveCount(0);
      await expect(aug.locator('[data-month-sum]')).toBeVisible();
      await aug.locator('[data-month-toggle]').click();
      await expect(row(pat)).toBeVisible();
      await row(t1).locator('td').first().click();
      const reportCard = page.locator(`[data-report-card="${t1}"]`);
      await expect(reportCard).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(reportCard).toBeHidden();
    });

    await test.step('«Списком» — прежний общий список; выбор запоминает браузер', async () => {
      await card.locator('[data-reports-mode] [data-mode="list"]').click();
      await expect(months).toHaveCount(0);
      await expect(card.locator(`[data-grid] [data-id="${nds}"]`)).toBeVisible();
      await page.reload();
      const again = await openReportsTab(page, isMobile, word);
      await expect(again.locator(`[data-grid] [data-id="${nds}"]`)).toBeVisible();
      await again.locator('[data-reports-mode] [data-mode="months"]').click();
      await expect(again.locator('[data-report-month="2026-09"]')).toBeVisible();
    });
  });

  test('(доработки 13.11.2026, К2) «Отчеты для сдачи» → «По месяцам»: по умолчанию прошлый месяц, стрелки листают месяцы; итог месяца, отчёты по контрагентам; «Уплатить» — только то, что нужно оплатить', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = await asOwner(page.request, baseURL);
    const word = uniqueWord('Замесяц');
    const cp = await newContractor(page.request, origin, { name: `ОсОО «${word}»` });
    const report = (reportTypeCode: string) =>
      manualReport(page.request, origin, {
        contractorId: cp.id,
        reportTypeCode,
        month: '2026-09-01',
        due: '2030-01-15',
      });
    const nds = await report('nds');
    const t1 = await report('t1m');

    await page.goto('/app/reports/months');
    const title = page.locator('[data-months-title]');
    const prev = previousMonth();
    await expect(title).toHaveText(`За ${MONTHS[prev.m]} ${prev.y}`);
    // Месяц, отчёты за который сдаются сейчас, — без кнопки возврата.
    await expect(page.locator('[data-months-move="0"]')).toHaveCount(0);

    // Листаем к сентябрю 2026.
    const steps = (2026 - prev.y) * 12 + (8 - prev.m);
    for (let i = 0; i < Math.abs(steps); i += 1) {
      await page.locator(`[data-months-move="${steps < 0 ? -1 : 1}"]`).click();
    }
    await expect(title).toHaveText('За сентябрь 2026');

    const grid = page.locator('[data-months-grid="2026-09"]');
    await expect(grid.locator('[data-id]').first()).toBeVisible();
    // Итог месяца по всем контрагентам: сколько контрагентов, сколько сдано, сроки.
    const total = page.locator('[data-months-total]');
    await expect(total).toContainText(/\d+ контрагент/);
    await expect(total.locator('[data-month-pill="submitted"]')).toContainText(/сдано \d+ из \d+/);

    await search(page, isMobile, word);
    const row = (id: string) => grid.locator(`[data-id="${id}"]`);
    await expect(grid.locator('[data-id]')).toHaveCount(2);
    await expect(row(nds)).toBeVisible();
    await expect(row(t1)).toBeVisible();
    // По умолчанию — группы по контрагенту.
    await expect(grid).toContainText(`ОсОО «${word}»`);

    // «Уплатить»: по 1-Т платить нечего.
    await page.locator('[data-report-quick] [data-quick="pay"]').click();
    await expect(grid.locator('[data-id]')).toHaveCount(1);
    await expect(row(nds)).toBeVisible();
    await page.locator('[data-report-quick] [data-quick="all"]').click();
    await expect(grid.locator('[data-id]')).toHaveCount(2);

    if (steps !== 0) {
      await page.locator('[data-months-move="0"]').click();
      await expect(title).toHaveText(`За ${MONTHS[prev.m]} ${prev.y}`);
    }
  });
});

// «К оплате клиенту» (доработки 13.11.2026, задача К4; прототип v94 modules/cp-telegram.js: rmToPay,
// rmPayHtml, rmPayMount): блок под месяцем в карточке контрагента и «Скопировать для клиента».
test.describe('Доработки 13.11.2026, К4: «К оплате клиенту» в карточке контрагента', () => {
  /** «Указать сумму» через API. */
  async function setAmount(api: APIRequestContext, origin: string, id: string, amount: number) {
    const card = await api.get(`/api/reports/${id}`);
    expect(card.status(), await card.text()).toBe(200);
    const { version } = (await card.json()) as { version: number };
    const res = await api.post(`/api/reports/${id}/amount`, {
      headers: { origin },
      data: { version, amount },
    });
    expect(res.status(), await res.text()).toBe(200);
  }

  test('(доработки 13.11.2026, К4) под месяцем в карточке контрагента — «К оплате клиенту»: неоплаченные налоги месяца, итог и ближайший срок; «Скопировать для клиента» кладёт текст в буфер и пишет в историю; всё оплачено — блока нет', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    test.setTimeout(120_000);
    const origin = await asOwner(page.request, baseURL);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    const word = uniqueWord('Коплате');
    const name = `ОсОО «${word}»`;
    const cp = await newContractor(page.request, origin, { name });
    const report = (reportTypeCode: string, month: string) =>
      manualReport(page.request, origin, {
        contractorId: cp.id,
        reportTypeCode,
        month,
        due: '2030-01-15',
      });
    // Сентябрь: НДС оплачен частично, патент не оплачен, 1-Т только сдаётся. Август: сумма не указана.
    const nds = await report('nds', '2026-09-01');
    const pat = await report('pat', '2026-09-01');
    await report('t1m', '2026-09-01');
    await report('pat', '2026-08-01');
    await prepay(page.request, origin, nds, 500_000, 120_000);
    await setAmount(page.request, origin, pat, 87_050);

    const card = await openReportsTab(page, isMobile, word);
    const months = card.locator('[data-contractor-months]');
    const block = months.locator('[data-month-pay="2026-09"]');
    const copy = block.locator('[data-month-pay-copy]');

    await test.step('блок под сентябрём: итог неоплаченного, срок и налоги с остатками; где суммы нет — блока нет', async () => {
      await expect(block).toContainText('К оплате клиенту');
      await expect(block.locator('[data-month-pay-total]')).toHaveText(/^4\s670,50\sсом$/);
      await expect(block).toContainText(/до \d\d\.\d\d\.\d{4}/);
      const list = block.locator('[data-month-pay-list]');
      await expect(list).toContainText(/3\s800,00/);
      await expect(list).toContainText('870,50');
      // В августе сумма патента не указана — платить пока нечего.
      await expect(months.locator('[data-report-month="2026-08"]')).toBeVisible();
      await expect(months.locator('[data-month-pay="2026-08"]')).toHaveCount(0);
      // Блок — по всем налогам месяца, какая бы плашка ни была выбрана.
      await months.locator('[data-months-quick] [data-quick="sub"]').click();
      await expect(block.locator('[data-month-pay-total]')).toHaveText(/^4\s670,50\sсом$/);
      await months.locator('[data-months-quick] [data-quick="all"]').click();
    });

    await test.step('«Скопировать для клиента»: текст по шаблону — в буфере, запись — в истории контрагента', async () => {
      await expect(copy).toBeEnabled();
      await copy.click();
      await expect(page.getByText('Текст для клиента скопирован')).toBeVisible();
      const text = await page.evaluate(() => navigator.clipboard.readText());
      expect(text).toContain(`Уважаемые ${name}! Налоги к оплате за сентябрь 2026: `);
      expect(text).toMatch(/Итого — 4\s670,50\sсом\. Просим перечислить до \d\d\.\d\d\.\d{4} на: /);
      expect(text).toMatch(/3\s800\sсом \(до \d\d\.\d\d\.\d{4}\)/);
      await toCardTab(page, card, isMobile, /^История/);
      await expect(
        card.getByText(/Скопирован текст «К оплате» за сентябрь 2026: 4\s670,50\sсом/),
      ).toBeVisible();
    });

    await test.step('налоги оплачены — блока «К оплате клиенту» нет', async () => {
      await prepay(page.request, origin, nds, 500_000, 380_000);
      await prepay(page.request, origin, pat, 87_050);
      await page.reload();
      const again = await openReportsTab(page, isMobile, word);
      await expect(again.locator('[data-report-month="2026-09"]')).toBeVisible();
      await expect(again.locator('[data-month-pay]')).toHaveCount(0);
    });
  });
});
