import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import {
  botMessages,
  finger,
  hire,
  linkTelegram,
  pressStart,
  settledBox,
  signIn,
  uniqueChat,
  uniqueLogin,
  WEBHOOK_SECRET,
} from './helpers';
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

  /** Адрес демо-организации «Бухгалтер Плюс» (страницы контрагентов). */
  const SLUG = 'buhgalter-plyus';
  /** Подделка Telegram Bot API (fake-telegram.ts). */
  const FAKE_TELEGRAM = `http://127.0.0.1:${process.env.FAKE_TELEGRAM_PORT ?? 8091}`;

  interface BotSent {
    messageId: number;
    text: string;
    keyboard?: { text: string; callback_data?: string; copy_text?: { text: string } }[][];
  }
  /** Сообщения бота в чате вместе с кнопками и номером сообщения. */
  async function chatMessages(api: APIRequestContext, chat: number): Promise<BotSent[]> {
    const res = await api.get(`${FAKE_TELEGRAM}/messages?chat=${chat}`);
    expect(res.status()).toBe(200);
    return (await res.json()) as BotSent[];
  }
  /** Клиент нажал кнопку под сообщением бота: Telegram присылает вебхуком `callback_query`. */
  function pressButton(api: APIRequestContext, chat: number, messageId: number, data: string) {
    return api.post('/api/telegram/webhook', {
      headers: { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
      data: {
        update_id: Date.now(),
        callback_query: {
          id: `e2e-${chat}-${Date.now()}`,
          from: { id: chat, is_bot: false, first_name: 'Сквозной' },
          chat_instance: 'e2e',
          data,
          message: { message_id: messageId, date: 0, chat: { id: chat, type: 'private' } },
        },
      },
    });
  }
  /** Клиент ответил на сообщение бота текстом. */
  function replyToBot(api: APIRequestContext, chat: number, replyTo: number, text: string) {
    return api.post('/api/telegram/webhook', {
      headers: { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
      data: {
        update_id: Date.now(),
        message: {
          message_id: Date.now() % 1_000_000,
          date: 0,
          text,
          chat: { id: chat, type: 'private' },
          from: { id: chat, username: `e2e_${chat}`, first_name: 'Сквозной' },
          reply_to_message: { message_id: replyTo },
        },
      },
    });
  }

  test('(доработки 13.11.2026, К4) «Отправить в Telegram»: клиент с подключённым Telegram получает «К оплате» с налогами месяца и кнопками; «Оплатил» и «Вопрос бухгалтеру» доходят до ответственного бухгалтера, его ответ на вопрос из Telegram — до клиента; всё пишется в историю контрагента', async ({
    page,
    playwright,
    baseURL,
    isMobile,
  }) => {
    test.setTimeout(150_000);
    const origin = new URL(baseURL!).origin;
    // Ответственный — новый сотрудник с Telegram (демо-сотрудникам Telegram не привязывается).
    const staff = await playwright.request.newContext({ baseURL });
    const login = uniqueLogin('e2e-cp-pay');
    const { employee, temporaryPassword } = await hire(staff, origin, login);
    await signIn(staff, origin, login, temporaryPassword);
    const passwordSet = await staff.post('/api/auth/password', {
      headers: { origin },
      data: { currentPassword: temporaryPassword, newPassword: 'Свой-пароль-e2e-1' },
    });
    expect(passwordSet.status()).toBe(200);
    const staffChat = uniqueChat();
    await linkTelegram(staff, origin, staffChat);
    await staff.dispose();

    await asOwner(page.request, baseURL);
    const word = uniqueWord('Телеоплата');
    const name = `ОсОО «${word}»`;
    const cp = await newContractor(page.request, origin, { name, responsible: employee.id });
    const report = (reportTypeCode: string) =>
      manualReport(page.request, origin, {
        contractorId: cp.id,
        reportTypeCode,
        month: '2026-09-01',
        due: '2030-01-15',
      });
    const nds = await report('nds');
    const pat = await report('pat');
    await prepay(page.request, origin, nds, 500_000, 120_000);
    await setAmount(page.request, origin, pat, 87_050);

    // Клиент вводит код своей страницы, подключает Telegram, владелец подтверждает.
    const enabled = await page.request.post(`/api/contractors/${cp.id}/page/enable`, {
      headers: { origin },
    });
    expect(enabled.status(), await enabled.text()).toBe(200);
    const { code } = (await enabled.json()) as { code: string };
    const part = () => Math.floor(Math.random() * 256);
    const client = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { 'x-forwarded-for': `198.18.${part()}.${part()}` },
    });
    const opened = await client.post(`/api/page/${SLUG}/${cp.inn}/code`, {
      headers: { origin },
      data: { code },
    });
    expect(opened.status(), await opened.text()).toBe(200);
    const link = await client.post(`/${SLUG}/inn/${cp.inn}/telegram`, { headers: { origin } });
    expect(link.status(), await link.text()).toBe(200);
    const clientChat = uniqueChat();
    const telegramName = `@e2e_${clientChat}`;
    const { url } = (await link.json()) as { url: string };
    expect((await pressStart(page.request, url, clientChat)).status()).toBe(200);
    await client.dispose();

    const card = await openReportsTab(page, isMobile, word);
    const block = card.locator('[data-contractor-months] [data-month-pay="2026-09"]');
    const send = block.locator('[data-month-pay-send]');

    await test.step('пока Telegram не подтверждён — кнопка говорит, что мешает', async () => {
      await expect(send).toHaveAttribute('aria-disabled', 'true');
      await expect(send).toHaveAttribute('title', /Контрагент не подключил Telegram/);
      // Кнопка помечена недоступной, но нажимается: по нажатию — причина сообщением.
      await send.click({ force: true });
      await expect(
        page.getByRole('status').filter({ hasText: 'Контрагент не подключил Telegram' }),
      ).toBeVisible();
    });

    const list = (await (
      await page.request.get(`/api/contractors/${cp.id}/page/telegram`)
    ).json()) as { items: { id: string; name: string; version: number }[] };
    const waiting = list.items.find((i) => i.name === telegramName)!;
    const approved = await page.request.post(
      `/api/contractors/${cp.id}/page/telegram/${waiting.id}`,
      { headers: { origin }, data: { action: 'approve', version: waiting.version } },
    );
    expect(approved.status(), await approved.text()).toBe(200);

    await test.step('«Отправить в Telegram»: вопрос с суммой, сроком и числом получателей; клиенту — сообщение с таблицей и кнопками', async () => {
      await page.reload();
      const again = await openReportsTab(page, isMobile, word);
      const button = again.locator('[data-month-pay="2026-09"] [data-month-pay-send]');
      await expect(button).toBeEnabled();
      await expect(button).not.toHaveAttribute('aria-disabled', 'true');
      await button.click();
      const confirm = page.getByRole('dialog', { name: 'Отправить «К оплате» в Telegram?' });
      await expect(confirm).toContainText(
        /Клиент получит в Telegram налоги за сентябрь 2026: 4\s670,50\sсом до \d\d\.\d\d\.\d{4}\. Получателей: 1\./,
      );
      await confirm.getByRole('button', { name: 'Отправить' }).click();
      await expect(
        page
          .getByRole('status')
          .filter({ hasText: '«К оплате» отправлено в Telegram: получателей — 1' }),
      ).toBeVisible();
      // Ничего не прокручивается вбок (на телефоне — тоже).
      const wide = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(wide).toBe(false);
    });

    let payMessage: BotSent;
    await test.step('сообщение клиенту: заголовок со сроком, контрагент, налоги с остатками, итог; кнопки «Оплатил» и «Вопрос бухгалтеру»', async () => {
      await expect
        .poll(async () => (await chatMessages(page.request, clientChat)).at(-1)?.text ?? '')
        .toContain('Налоги к оплате до');
      payMessage = (await chatMessages(page.request, clientChat)).at(-1)!;
      expect(payMessage.text).toContain(name);
      expect(payMessage.text).toMatch(/Налоги за сентябрь 2026: к оплате 4\s670,50\sсом до/);
      expect(payMessage.text).toMatch(/3\s800,00/);
      expect(payMessage.text).toContain('870,50');
      expect(payMessage.text).toMatch(/Итого — 4\s670,50/);
      const buttons = (payMessage.keyboard ?? []).flat();
      expect(buttons.map((b) => b.text)).toEqual(
        expect.arrayContaining(['Оплатил', 'Вопрос бухгалтеру']),
      );
      expect(buttons.find((b) => b.text === 'Оплатил')!.callback_data).toBe('cpPaid:2026-09');
    });

    await test.step('«Оплатил»: клиенту — «Спасибо», кнопка гаснет, бухгалтеру — сообщение', async () => {
      const res = await pressButton(
        page.request,
        clientChat,
        payMessage.messageId,
        'cpPaid:2026-09',
      );
      expect(res.status()).toBe(200);
      await expect
        .poll(async () => (await botMessages(page.request, staffChat)).at(-1) ?? '')
        .toMatch(
          new RegExp(
            `${word}.*контрагент сообщил об оплате налогов за сентябрь 2026 — 4\\s670,50\\sсом \\(«${telegramName}»\\)\\. Проверьте поступление\\.`,
          ),
        );
      const after = (await chatMessages(page.request, clientChat)).find(
        (m) => m.messageId === payMessage.messageId,
      )!;
      expect((after.keyboard ?? []).flat().map((b) => b.text)).toContain('✓ Сообщили бухгалтеру');
      // Нажатие с подделанным месяцем ничего не меняет.
      expect(
        (
          await pressButton(page.request, clientChat, payMessage.messageId, 'cpPaid:2026-08')
        ).status(),
      ).toBe(200);
    });

    await test.step('«Вопрос бухгалтеру»: бот просит написать вопрос, вопрос уходит бухгалтеру', async () => {
      expect(
        (
          await pressButton(page.request, clientChat, payMessage.messageId, 'cpAsk:2026-09')
        ).status(),
      ).toBe(200);
      await expect
        .poll(async () => (await chatMessages(page.request, clientChat)).at(-1)?.text ?? '')
        .toBe('Напишите ваш вопрос ответом на это сообщение — я передам его вашему бухгалтеру.');
      const ask = (await chatMessages(page.request, clientChat)).at(-1)!;
      expect(
        (
          await replyToBot(page.request, clientChat, ask.messageId, 'Можно оплатить частями?')
        ).status(),
      ).toBe(200);
      await expect
        .poll(async () => (await botMessages(page.request, clientChat)).at(-1) ?? '')
        .toBe('Вопрос передан вашему бухгалтеру. Ответ придёт сюда.');
      await expect
        .poll(async () => (await botMessages(page.request, staffChat)).at(-1) ?? '')
        .toContain(
          `${name}: вопрос от «${telegramName}». Можно оплатить частями? Ответьте на это сообщение — ответ уйдёт клиенту.`,
        );
    });

    await test.step('бухгалтер отвечает на вопрос в Telegram: ответ приходит клиенту, бухгалтеру — «Ответ отправлен»', async () => {
      const question = (await chatMessages(page.request, staffChat)).at(-1)!;
      expect(
        (
          await replyToBot(page.request, staffChat, question.messageId, 'Да, можно двумя частями')
        ).status(),
      ).toBe(200);
      await expect
        .poll(async () => (await botMessages(page.request, clientChat)).at(-1) ?? '')
        .toMatch(/^Ответ бухгалтера\n.+: Да, можно двумя частями$/);
      await expect
        .poll(async () => (await botMessages(page.request, staffChat)).at(-1) ?? '')
        .toBe('Ответ отправлен клиенту в Telegram.');
    });

    await test.step('история контрагента: отправка, «оплатил», вопрос и ответ', async () => {
      await page.reload();
      const again = await openReportsTab(page, isMobile, word);
      await toCardTab(page, again, isMobile, /^История/);
      await expect(
        again.getByText(
          /«К оплате» за сентябрь 2026 отправлено в Telegram: 4\s670,50\sсом, получателей — 1/,
        ),
      ).toBeVisible();
      await expect(
        again.getByText(
          new RegExp(
            `Контрагент сообщил в Telegram об оплате налогов за сентябрь 2026: 4\\s670,50\\sсом \\(«${telegramName}»\\)`,
          ),
        ),
      ).toBeVisible();
      await expect(
        again.getByText(
          `Вопрос бухгалтеру из Telegram («${telegramName}»): Можно оплатить частями?`,
        ),
      ).toBeVisible();
      await expect(
        again.getByText(
          `Ответ контрагенту в Telegram («${telegramName}»): Да, можно двумя частями`,
        ),
      ).toBeVisible();
      // Подделанное нажатие второй записи об оплате не добавило.
      const history = (await (
        await page.request.get(`/api/contractors/${cp.id}/history`)
      ).json()) as { items: { action: string }[] };
      expect(history.items.filter((h) => h.action === 'page_tg_paid')).toHaveLength(1);
    });
  });
});

test.describe('Доработки 14.11.2026, блок 5: «Принять деньги» по месяцам и меню строки', () => {
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

  test('(доработки 14.11.2026, блок 5) «Принять деньги за весь период» и за месяц: форма поступления с отчётами месяцев от старых к новым, правка суммы пересчитывает распределение; после приёма кнопки говорят, что деньги уже получены; правая кнопка мыши и долгое нажатие на строке — меню действий', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    // Два окна поступления, запись поступления и меню строки в одном тесте: дольше обычного.
    test.setTimeout(120_000);
    const origin = await asOwner(page.request, baseURL);
    const word = uniqueWord('Принять');
    const cp = await newContractor(page.request, origin, { name: `ОсОО «${word}»` });
    const report = (reportTypeCode: string, month: string) =>
      manualReport(page.request, origin, {
        contractorId: cp.id,
        reportTypeCode,
        month,
        due: '2030-01-15',
      });
    // Сентябрь: НДС — 3 800, патент — 870,50. Октябрь: патент — 300.
    // Август: сумма патента не указана — неоплаченного нет, период он не запирает.
    const nds = await report('nds', '2026-09-01');
    const patSep = await report('pat', '2026-09-01');
    const patOct = await report('pat', '2026-10-01');
    await report('pat', '2026-08-01');
    await setAmount(page.request, origin, nds, 380_000);
    await setAmount(page.request, origin, patSep, 87_050);
    await setAmount(page.request, origin, patOct, 30_000);

    const card = await openReportsTab(page, isMobile, word);
    const months = card.locator('[data-contractor-months]');
    const all = months.locator('[data-months-bar] [data-months-receive="all"]');
    const sepBtn = months.locator('[data-month-pay="2026-09"] [data-months-receive="2026-09"]');
    const receipt = page.getByRole('dialog', { name: 'Поступление от контрагента' });
    const line = (id: string) => receipt.locator(`[data-receipt-row="${id}"]`);
    const menu = page.getByRole('menu', { name: 'Действия' });
    const row = (id: string) => months.locator(`[data-mini-row="${id}"]`);

    await test.step('кнопки: за весь период — над месяцами, за месяц — в «К оплате клиенту»; у августа без суммы кнопки нет', async () => {
      await expect(all).toHaveText('Принять деньги за весь период');
      await expect(all).not.toHaveAttribute('aria-disabled', 'true');
      await expect(sepBtn).toHaveText('Принять деньги');
      await expect(months.locator('[data-months-receive="2026-08"]')).toHaveCount(0);
    });

    await test.step('за месяц: форма с отчётами сентября на то, что ещё не получено', async () => {
      await sepBtn.click();
      await expect(receipt.locator('[data-receipt-list-note]')).toContainText(
        'Деньги за сентябрь 2026.',
      );
      await expect(receipt.locator('[data-receipt-total]')).toHaveValue(/^4\s670,50$/);
      await expect(line(nds)).toHaveValue(/^3\s800$/);
      await expect(line(patSep)).toHaveValue('870,50');
      await expect(line(patOct)).toHaveValue('');
      await receipt.getByRole('button', { name: 'Отмена' }).click();
      await expect(receipt).toBeHidden();
    });

    await test.step('за весь период: сентябрь и октябрь; меньшая сумма закрывает старый месяц первым', async () => {
      await all.click();
      await expect(receipt.locator('[data-receipt-list-note]')).toContainText(
        'Деньги за весь период: сентябрь 2026, октябрь 2026.',
      );
      await expect(receipt.locator('[data-receipt-total]')).toHaveValue(/^4\s970,50$/);
      await expect(line(patOct)).toHaveValue('300');
      await receipt.locator('[data-receipt-total]').fill('4670,50');
      await expect(line(nds)).toHaveValue(/^3\s800$/);
      await expect(line(patSep)).toHaveValue('870,50');
      await expect(line(patOct)).toHaveValue('');
      await receipt.locator('[data-receipt-total]').fill('4970,50');
      await expect(line(patOct)).toHaveValue('300');
      await receipt.getByRole('button', { name: 'Записать поступление' }).click();
      await expect(receipt).toBeHidden();
      await expect(page.getByText('Поступление записано')).toBeVisible();
    });

    await test.step('деньги получены — кнопки заперты и называют причину', async () => {
      await expect(all).toHaveAttribute('aria-disabled', 'true');
      await expect(all).toHaveAttribute('title', /всех месяцев уже получены от контрагента/);
      // Кнопка помечена недоступной, но нажимается: по нажатию — причина сообщением.
      await all.click({ force: true });
      await expect(
        page.getByRole('status').filter({ hasText: /всех месяцев уже получены от контрагента/ }),
      ).toBeVisible();
      await expect(receipt).toBeHidden();
      await expect(sepBtn).toHaveAttribute('title', /этого месяца уже получены от контрагента/);
    });

    await test.step('правая кнопка мыши (на телефоне — долгое нажатие) по строке — то же меню, что «⋯»; карточка отчёта не открывается', async () => {
      if (isMobile) {
        // Палец касается точки на экране: строку сначала прокрутить в видимую часть карточки.
        await row(nds).locator('td').first().scrollIntoViewIfNeeded();
        const box = await settledBox(row(nds).locator('td').first());
        await (await finger(page)).hold({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
      } else {
        await row(nds).locator('td').first().click({ button: 'right' });
      }
      await menu.getByRole('menuitem', { name: 'Взять в работу' }).click();
      await expect(row(nds)).toContainText('В работе');
      // Открыта только карточка контрагента: карточка отчёта после меню не открылась.
      await expect(page.getByRole('dialog')).toHaveCount(1);
    });
  });
});
