import { randomBytes } from 'node:crypto';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { search } from './admin';
import { DEMO_PASSWORD, newOrgOwner, signIn } from './helpers';
import { connectAllTypes } from './orgs';
import { asOwner, manualReport, newContractor, prepay, reportsOf, staffIds } from './reports';

// «Отчеты для сдачи»: сдача, подтверждение и карточка отчёта (задача 2.14, #70) через настоящий сайт.
// Отчёты — «Разовым отчётом» через API у своего на каждый запуск и проект (ПК и телефон) контрагента
// демо-организации: в ней сдача требует подтверждения, «Файлы в карточках» включены, Соцфонду нужен
// файл, «Сдан» с суммой — только после оплаты (задача 2.19: оплата «Оплатил контрагент сам» через API
// перед сдачей). Владелец erkin, главный бухгалтер meerim, бухгалтер alisher с областью «Свои
// контрагенты».

type Card = {
  id: string;
  version: number;
  status: string;
  mark: string | null;
  amount: number | null;
};

/** Слово из кириллицы, своё на каждый запуск: по нему поиск находит только отчёты этого теста. */
const uniqueWord = (prefix: string) =>
  `${prefix}${Array.from({ length: 6 }, () => 'абвгдежзиклмнопрстуф'[Math.floor(Math.random() * 20)]).join('')}`;

/** Дата по Бишкеку со сдвигом в днях. */
const bishkek = (shift = 0) =>
  new Date(Date.now() + 6 * 3600_000 + shift * 86_400_000).toISOString().slice(0, 10);

/** ДД.ММ.ГГГГ, как на экране. */
const ru = (iso: string) => iso.split('-').reverse().join('.');

/** Ближайший прошедший будний день: срок на выходном сервер сразу переносит на рабочий. */
function lastWorkday(): string {
  for (let i = 1; ; i++) {
    const day = new Date(`${bishkek(-i)}T00:00:00Z`).getUTCDay();
    if (day !== 0 && day !== 6) return bishkek(-i);
  }
}

async function cardOf(api: APIRequestContext, id: string): Promise<Card> {
  const res = await api.get(`/api/reports/${id}`);
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as Card;
}

/** «Отметить сданным» через API сегодняшней датой. */
async function submit(
  api: APIRequestContext,
  origin: string,
  id: string,
  data: { amount?: number; fileIds?: string[] } = {},
) {
  const { version } = await cardOf(api, id);
  const res = await api.post(`/api/reports/${id}/submit`, {
    headers: { origin },
    data: { version, date: bishkek(), ...data },
  });
  expect(res.status(), await res.text()).toBe(200);
}

/** Файл в блок «Файлы» отчёта через API, как это делает браузер: начать → PUT в хранилище → закончить. */
async function uploadToReport(api: APIRequestContext, origin: string, id: string, name: string) {
  const size = 2048;
  const start = await api.post('/api/files/uploads', {
    headers: { origin },
    data: { source: { kind: 'report', id }, name, size },
  });
  expect(start.status(), await start.text()).toBe(201);
  const ticket = (await start.json()) as {
    id: string;
    upload: { url: string; headers: Record<string, string> };
  };
  const put = await api.put(ticket.upload.url, {
    headers: ticket.upload.headers,
    data: Buffer.alloc(size, 7),
  });
  expect(put.status(), await put.text()).toBe(200);
  const done = await api.post(`/api/files/${ticket.id}/complete`, { headers: { origin } });
  expect(done.status(), await done.text()).toBe(200);
  return ticket.id;
}

/** Вкладка «Отчетов для сдачи» с общим поиском по слову теста. */
async function openTab(page: Page, isMobile: boolean, tab: string, word: string) {
  await page.goto(`/app/reports/${tab}`);
  await expect(page.locator('[data-grid]')).toBeVisible();
  await search(page, isMobile, word);
}

const row = (page: Page, id: string) => page.locator(`[data-grid] [data-id="${id}"]`);

/** Касание строки или плитки открывает карточку отчёта (окно с названием вида). */
async function openCard(page: Page, id: string, text: string, typeName: string): Promise<Locator> {
  await expect(row(page, id)).toHaveCount(1);
  await row(page, id).getByText(text).first().click();
  const card = page.getByRole('dialog', { name: typeName });
  // С «Учётом оплаты налогов» у вида с суммой две шкалы — «Сдача» и «Оплата» (задача 2.19).
  await expect(
    card.locator(`[data-report-card="${id}"] [data-status-scale]`).first(),
  ).toBeVisible();
  return card;
}

/** Шкала «Сдача» карточки: с «Учётом оплаты налогов» рядом ещё шкала «Оплата» (задача 2.19). */
const SUBMIT_SCALE = 'ol[data-status-scale][aria-label="Сдача"]';

/** Шаг шкалы «Сдача» по названию. */
const step = (card: Locator, name: string) =>
  card.locator(`${SUBMIT_SCALE} > li`).filter({ hasText: name });

/** Шкала стоит на шаге: у его кнопки `aria-current="step"`. */
const current = (card: Locator, name: string) =>
  expect(step(card, name).locator('button')).toHaveAttribute('aria-current', 'step');

test.describe('Этап 2: отчёты — сдача, подтверждение и карточка', () => {
  test('(п. 2, п. 10) у компании А Соцфонд, налог у источника (ГНС) и НДС за 09.2026 сданы с суммами 2 500, 3 000 и 5 000 сом: список с фильтром «компания А, 09.2026» показывает итог 10 500 сом; изменения статуса и суммы — в истории с автором и временем; массовая сдача пропускает отчёт без обязательного файла', async ({
    page,
    request,
    baseURL,
    isMobile,
  }) => {
    const origin = await asOwner(request, baseURL);
    const word = uniqueWord('Итоги');
    const name = `ОсОО «${word}»`;
    const cp = await newContractor(request, origin, { name });
    const report = (reportTypeCode: string) =>
      manualReport(request, origin, {
        contractorId: cp.id,
        reportTypeCode,
        month: '2026-09-01',
        due: '2030-01-15',
      });
    const soc = await report('soc');
    const pni = await report('pni');
    const nds = await report('nds');
    // «Сдача только после оплаты»: Соцфонд и налог у источника оплачены заранее.
    await prepay(request, origin, soc, 250_000);
    await prepay(request, origin, pni, 300_000);

    // Массово одной датой: Соцфонду нужен файл — он пропущен, налог у источника сдан со своей суммой.
    const batch = await request.post('/api/reports/submit', {
      headers: { origin },
      data: {
        date: bishkek(),
        items: [
          { id: soc, version: (await cardOf(request, soc)).version, amount: 250_000 },
          { id: pni, version: (await cardOf(request, pni)).version, amount: 300_000 },
        ],
      },
    });
    expect(batch.status(), await batch.text()).toBe(200);
    expect(await batch.json()).toEqual({ done: 1, skippedFile: 1, skipped: 0, skippedPay: 0 });
    expect((await cardOf(request, soc)).status).toBe('todo');
    const file = await uploadToReport(request, origin, soc, `соцфонд-${word}.pdf`);
    await submit(request, origin, soc, { amount: 250_000, fileIds: [file] });
    // Сумму НДС сначала указали (4 000), потом при сдаче исправили на 5 000.
    const amount = await request.post(`/api/reports/${nds}/amount`, {
      headers: { origin },
      data: { version: (await cardOf(request, nds)).version, amount: 400_000 },
    });
    expect(amount.status(), await amount.text()).toBe(200);
    // Оплачено 4 000 из указанных — «Сдан» с исправленной суммой 5 000 можно поставить.
    await prepay(request, origin, nds, 400_000);

    // Фильтр «компания А, 09.2026»: итог по столбцу «Сумма к уплате».
    const filters = encodeURIComponent(
      JSON.stringify({
        inn: { type: 'text', q: cp.inn },
        period: { type: 'enum', vals: ['2026-09-01'] },
      }),
    );
    const total = async () => {
      const res = await request.get(`/api/reports?size=all&tab=all&filters=${filters}`);
      expect(res.status()).toBe(200);
      return ((await res.json()) as { totals: { amount?: number } }).totals.amount;
    };
    expect(await total()).toBe(950_000);

    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    await openTab(page, isMobile, 'all', word);
    await expect(page.locator('[data-grid] [data-id]')).toHaveCount(3);
    const card = await openCard(page, nds, name, 'НДС');
    await card.locator('[data-report-button="submit"]').click();
    const dialog = page.getByRole('dialog', { name: 'Отметить отчёт сданным' });
    await expect(dialog.locator('[data-report-date]')).toHaveValue(bishkek());
    await expect(dialog.locator('[data-report-amount]')).toHaveValue(/^4\s000$/);
    await dialog.locator('[data-report-amount]').fill('5 000');
    await dialog.locator('[data-report-ok]').click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole('status').filter({ hasText: 'ждёт подтверждения' }).first(),
    ).toBeVisible();

    // История изменений: каждое изменение суммы и статуса — с автором и временем.
    const history = card.getByRole('list', { name: 'История изменений' });
    const entry = (text: RegExp) =>
      history.locator('[data-timeline-item]').filter({ hasText: text });
    await expect(entry(/Сумма к уплате: не указана → 4\s000\sсом/)).toContainText('Эркин С.');
    await expect(
      entry(new RegExp(`Дата сдачи: — → ${ru(bishkek()).replace(/\./g, '\\.')}`)),
    ).toContainText(/Сумма к уплате: 4\s000\sсом → 5\s000\sсом/);
    await expect(entry(/Дата сдачи/)).toContainText(/\d\d:\d\d/);
    await expect(entry(/Дата сдачи/)).toContainText('Эркин С.');
    const statuses = card.locator('[data-status-history] tbody > tr');
    await expect(statuses.filter({ hasText: 'Сдан' })).toContainText('Эркин С.');
    await expect(card).toContainText(/5\s000\sсом/);
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();

    expect(await total()).toBe(1_050_000);
    const grid = page.locator('[data-grid]');
    await expect(grid).toContainText('Итого по фильтру · 3');
    await expect(grid).toContainText(/10\s500,00/);
  });

  test('(п. 3) у статистического отчёта поля суммы нет ни в карточке, ни в «Отметить сданным», ни в меню', async ({
    page,
    request,
    baseURL,
    isMobile,
  }) => {
    const origin = await asOwner(request, baseURL);
    const word = uniqueWord('Статистика');
    const name = `ОсОО «${word}»`;
    const cp = await newContractor(request, origin, { name });
    const t1 = await manualReport(request, origin, {
      contractorId: cp.id,
      reportTypeCode: 't1m',
      month: '2026-09-01',
      due: '2030-01-15',
    });

    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    await openTab(page, isMobile, 'all', word);
    const card = await openCard(page, t1, name, 'Форма 1-Т — отчёт по труду, месячный');
    await expect(card).toContainText('у этого вида отчёта суммы нет');
    await card.locator('[data-report-more]').click();
    const menu = page.getByRole('menu', { name: 'Ещё действия' });
    await expect(menu.getByRole('menuitem', { name: 'Изменить срок' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Указать сумму' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);

    await card.locator('[data-report-button="submit"]').click();
    const dialog = page.getByRole('dialog', { name: 'Отметить отчёт сданным' });
    await expect(dialog.locator('[data-report-date]')).toBeVisible();
    await expect(dialog.locator('[data-report-amount]')).toHaveCount(0);
    await expect(dialog.locator('[data-report-lines]')).toHaveCount(0);
    await dialog.locator('[data-report-ok]').click();
    await expect(dialog).toBeHidden();
    await current(card, 'Сдан');
    expect((await cardOf(request, t1)).amount).toBeNull();
  });

  test('(п. 4, п. 62) бухгалтер отметил просроченный НДС «Сдан»: отчёт ушёл из «Просрочено» и «На неделе», у шага «Сдан» — «Ждёт подтверждения», шага «Принят» нет, отчёт в «Ожидают подтверждения»; главный бухгалтер подтвердил — «Подтверждено» с его именем и датой; «На исправление» без причины невозможно, с причиной — «Требует исправления»; свой сданный отчёт не подтверждается', async ({
    page,
    request,
    baseURL,
    isMobile,
  }) => {
    test.slow();
    const origin = await asOwner(request, baseURL);
    const ids = await staffIds(request);
    const word = uniqueWord('Подтверждение');
    const name = `ОсОО «${word}»`;
    const cp = await newContractor(request, origin, { name, responsible: ids.alisher });
    const due = lastWorkday();
    const report = (month: string, d = due) =>
      manualReport(request, origin, {
        contractorId: cp.id,
        reportTypeCode: 'nds',
        month,
        due: d,
      });
    const nds = await report('2026-09-01');
    const toFix = await report('2026-08-01', '2030-01-15');
    const own = await report('2026-07-01', '2030-01-15');
    // «Сдача только после оплаты»: налог оплачен полностью — после «Сдан» отчёт не просрочен и по оплате.
    await prepay(request, origin, nds, 1_200_000);
    await prepay(request, origin, toFix, 100_000);
    await prepay(request, origin, own, 100_000);

    // Бухгалтер: отчёт со сроком в прошлом и статусом «К сдаче» — во вкладке «Просрочено».
    await signIn(page.request, origin, 'alisher', DEMO_PASSWORD);
    await openTab(page, isMobile, 'overdue', word);
    const card = await openCard(page, nds, name, 'НДС');
    await expect(card.locator('[data-report-button="confirm"]')).toHaveCount(0);
    await card.locator('[data-report-button="submit"]').click();
    const dialog = page.getByRole('dialog', { name: 'Отметить отчёт сданным' });
    await dialog.locator('[data-report-amount]').fill('12 000');
    await dialog.locator('[data-report-ok]').click();
    await expect(dialog).toBeHidden();
    await expect(step(card, 'Сдан')).toContainText('Ждёт подтверждения');
    await expect(card.locator(SUBMIT_SCALE)).not.toContainText('Принят');
    // Без права «Подтверждать сдачу» — ни «Подтвердить», ни «На исправление».
    await expect(card.locator('[data-report-button]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();
    await expect(row(page, nds)).toHaveCount(0);
    await openTab(page, isMobile, 'week', word);
    await expect(page.locator('[data-grid] [data-id]')).toHaveCount(0);
    await openTab(page, isMobile, 'waiting', word);
    await expect(row(page, nds)).toHaveCount(1);
    await submit(page.request, origin, toFix, { amount: 100_000 });
    await page.request.post('/api/auth/logout', { headers: { origin } });

    // Главный бухгалтер: «Подтвердить» — «Подтверждено» с его именем и датой.
    await signIn(page.request, origin, 'meerim', DEMO_PASSWORD);
    await openTab(page, isMobile, 'waiting', word);
    const waiting = await openCard(page, nds, name, 'НДС');
    await expect(waiting.locator('[data-report-button="fix"]')).toBeVisible();
    await waiting.locator('[data-report-button="confirm"]').click();
    const confirm = page.getByRole('dialog', { name: 'Подтвердить сдачу отчёта' });
    await expect(confirm).toContainText('Алишер Т.');
    await confirm.locator('[data-report-ok]').click();
    await expect(confirm).toBeHidden();
    await expect(step(waiting, 'Сдан')).toContainText('Подтвердил Мээрим К.');
    await expect(waiting).toContainText(
      new RegExp(`Подтверждено · Мээрим К\\., ${ru(bishkek()).replace(/\./g, '\\.')}`),
    );
    expect(await cardOf(page.request, nds)).toMatchObject({
      status: 'submitted',
      mark: 'confirmed',
    });
    await page.keyboard.press('Escape');
    await expect(waiting).toBeHidden();

    // «На исправление»: без причины окно не закрывается, с причиной — «Требует исправления».
    const back = await openCard(page, toFix, name, 'НДС');
    await back.locator('[data-report-button="fix"]').click();
    const fix = page.getByRole('dialog', { name: 'Вернуть на исправление' });
    await fix.locator('[data-report-ok]').click();
    await expect(fix).toContainText('Укажите, что исправить: без причины вернуть нельзя');
    await expect(fix).toBeVisible();
    await fix.getByLabel(/^Что исправить/).fill('Не тот период в декларации');
    await fix.locator('[data-report-ok]').click();
    await expect(fix).toBeHidden();
    await current(back, 'Требует исправления');
    await expect(back).toContainText('Не тот период в декларации');
    expect((await cardOf(page.request, toFix)).status).toBe('needs_fix');
    await page.keyboard.press('Escape');
    await expect(back).toBeHidden();

    // Свой сданный отчёт с правом подтверждать — не подтвердить: ни кнопкой, ни запросом.
    await submit(page.request, origin, own, { amount: 100_000 });
    await openTab(page, isMobile, 'waiting', word);
    const mine = await openCard(page, own, name, 'НДС');
    await expect(mine.locator('[data-report-button="confirm"]')).toHaveCount(0);
    await expect(mine).toContainText('Свой сданный отчёт подтвердить нельзя');
    const refused = await page.request.post(`/api/reports/${own}/confirm`, {
      headers: { origin },
      data: { version: (await cardOf(page.request, own)).version },
    });
    expect(refused.status()).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: 'report_confirm_own' } });
  });

  test('(п. 61) контрагенту на едином налоге с ГКЭД услуг 69.20 подставлена ставка «ЕНС-04 · 4 % безнал + 6 % нал»; при «Сдан» выручка 300 000 сом безнал и 200 000 сом нал — строки налога 12 000 и 12 000 сом, сумма к уплате 24 000 сом', async ({
    page,
    request,
    baseURL,
    isMobile,
  }) => {
    const origin = await asOwner(request, baseURL);
    const ids = await staffIds(request);
    const word = uniqueWord('Единый');
    const name = `ОсОО «${word}»`;
    const inn = `07${Date.now().toString().slice(-8)}${String(Math.floor(Math.random() * 10_000)).padStart(4, '0')}`;
    // Новый контрагент на едином налоге (РЕЖ-03) с ЕН квартальным: ставку подставляет сервер по ГКЭД.
    const created = await request.post('/api/contractors', {
      headers: { origin },
      data: {
        name,
        inn,
        phone: '+996505890076',
        kind: 'regular',
        formCode: 'ФС-01',
        regimeCode: 'РЕЖ-03',
        gked: '69.20.0',
        startDate: '2026-10-01',
        responsibleEmployeeId: ids.erkin,
        tariff: { amount: 1_000_000, period: 'M' },
        reports: [{ code: 'enq' }],
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const enq = (await reportsOf(request, inn)).find(
      (r) => r.type.code === 'enq' && r.periodStart === '2026-10-01',
    );
    expect(enq).toBeTruthy();

    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    await openTab(page, isMobile, 'all', word);
    const card = await openCard(page, enq!.id, name, 'Единый налог, квартальный');
    await expect(card).toContainText('ЕНС-04 · 4 % безнал + 6 % нал');
    await card.locator('[data-report-button="submit"]').click();
    const dialog = page.getByRole('dialog', { name: 'Отметить отчёт сданным' });
    const lines = dialog.locator('[data-report-lines]');
    await lines.getByLabel('Выручка: Безналичная выручка, 4 %').fill('300 000');
    await lines.getByLabel('Выручка: Наличная выручка, 6 %').fill('200 000');
    await expect(lines.getByLabel('Налог: Безналичная выручка, 4 %')).toHaveValue(/^12\s000$/);
    await expect(lines.getByLabel('Налог: Наличная выручка, 6 %')).toHaveValue(/^12\s000$/);
    await expect(dialog.locator('[data-report-amount]')).toHaveValue(/^24\s000$/);
    await dialog.locator('[data-report-ok]').click();
    await expect(dialog).toBeHidden();
    await expect(card).toContainText(/24\s000\sсом/);
    await expect(card).toContainText(/выручка 300\s000\sсом · налог 12\s000\sсом/);
    await expect(card).toContainText(/выручка 200\s000\sсом · налог 12\s000\sсом/);
    expect((await cardOf(request, enq!.id)).amount).toBe(2_400_000);
  });

  test('(п. 33, карточка отчёта) на телефоне в карточке отчёта шкала — шаги столбиком с датами справа, «История статусов» — записи одна под другой; ничего не обрезано и не прокручивается вбок', async ({
    page,
    request,
    baseURL,
    isMobile,
  }) => {
    const origin = await asOwner(request, baseURL);
    const word = uniqueWord('Телефон');
    const name = `ОсОО «${word}»`;
    const cp = await newContractor(request, origin, { name });
    const nds = await manualReport(request, origin, {
      contractorId: cp.id,
      reportTypeCode: 'nds',
      month: '2026-09-01',
      due: '2030-01-15',
    });
    const started = await request.post(`/api/reports/${nds}/start`, {
      headers: { origin },
      data: { version: (await cardOf(request, nds)).version },
    });
    expect(started.status(), await started.text()).toBe(200);

    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    await openTab(page, isMobile, 'all', word);
    const card = await openCard(page, nds, name, 'НДС');
    const steps = card.locator(`${SUBMIT_SCALE} > li > button`);
    await expect(steps.first()).toBeVisible();
    // Первая «История статусов» — шкалы «Сдача»; вторая — «Оплата» (задача 2.19).
    const history = card.locator('[data-status-history]').first();
    const rows = history.locator('tbody > tr');
    await expect(rows).toHaveCount(2);
    const boxes = await Promise.all([0, 1].map(async (i) => (await steps.nth(i).boundingBox())!));
    if (isMobile) {
      expect(Math.abs(boxes[1]!.x - boxes[0]!.x)).toBeLessThanOrEqual(1);
      expect(boxes[1]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height - 1);
      const date = steps.nth(1).locator('small', { hasText: /^\d\d\.\d\d\.\d{4} \d\d:\d\d$/ });
      const at = (await date.boundingBox())!;
      expect(at.x).toBeGreaterThan(boxes[1]!.x + boxes[1]!.width / 2);
      await expect(history.locator('thead')).toBeHidden();
      const [first, second] = await Promise.all([
        rows.nth(0).boundingBox(),
        rows.nth(1).boundingBox(),
      ]);
      expect(second!.y).toBeGreaterThanOrEqual(first!.y + first!.height - 1);
    } else {
      expect(boxes[1]!.x).toBeGreaterThan(boxes[0]!.x + boxes[0]!.width);
    }
    const overflow = await card.evaluate((dialog) => {
      const edge = dialog.getBoundingClientRect().right + 1;
      return [...dialog.querySelectorAll('[data-report-card] *')]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.right > edge;
        })
        .map((el) => `${el.tagName} ${(el.textContent ?? '').slice(0, 40)}`);
    });
    expect(overflow).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(0);
  });

  test('(проверка задачи #85) файл, приложенный к отчёту в окне «Отметить сданным», виден в «Файловом менеджере» с источником «Отчёт …»; «Перейти к источнику» открывает карточку отчёта', async ({
    page,
    request,
    baseURL,
    isMobile,
  }) => {
    const origin = await asOwner(request, baseURL);
    const word = uniqueWord('Файл');
    const name = `ОсОО «${word}»`;
    const cp = await newContractor(request, origin, { name });
    const nds = await manualReport(request, origin, {
      contractorId: cp.id,
      reportTypeCode: 'nds',
      month: '2026-09-01',
      due: '2030-01-15',
    });
    const file = `декларация-${Date.now().toString(36)}${randomBytes(3).toString('hex')}.pdf`;

    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    await openTab(page, isMobile, 'all', word);
    const card = await openCard(page, nds, name, 'НДС');
    await card.locator('[data-report-button="submit"]').click();
    const dialog = page.getByRole('dialog', { name: 'Отметить отчёт сданным' });
    await dialog.locator('[data-report-files]').setInputFiles({
      name: file,
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n%%EOF\n'),
    });
    await dialog.locator('[data-report-amount]').fill('0');
    await dialog.locator('[data-report-ok]').click();
    await expect(dialog).toBeHidden();
    await expect(card).toContainText(file);
    await expect(
      card
        .getByRole('list', { name: 'История изменений' })
        .locator('[data-timeline-item]')
        .filter({ hasText: `Прикреплены файлы: ${file}` }),
    ).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();

    await page.goto('/app/files');
    await expect(page.locator('[data-grid]')).toBeVisible();
    await search(page, isMobile, file);
    const files = page.locator('[data-grid] [data-id]');
    await expect(files).toHaveCount(1);
    // На ПК — столбец «Источник»; на телефоне откуда и источник — в окне файла.
    if (!isMobile) await expect(files).toContainText('НДС · 09.2026');
    await files.getByText(file, { exact: true }).click();
    const window = page.getByRole('dialog', { name: file });
    await expect(window).toContainText('Отчёт · НДС · 09.2026');
    await window.getByRole('button', { name: 'Перейти к источнику' }).click();
    await expect(
      page.getByRole('dialog', { name: 'НДС' }).locator(`[data-report-card="${nds}"]`),
    ).toBeVisible();
  });

  // Своя новая организация: выключение подтверждения меняет учётную политику, а у демо-организации
  // она общая для всех проверок.
  test('(задача 2.14) выключение «Сдача отчётов требует подтверждения» спрашивает «Выключить подтверждение сдачи?» с числом ждущих отчётов; после «Выключить» отчёт подтверждён, в истории учётной политики — «считаются подтверждёнными: 1»', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const origin = new URL(baseURL!).origin;
    await newOrgOwner(page.request, origin);
    await connectAllTypes(page.request, origin);
    const cp = await newContractor(page.request, origin, { tariff: false });
    const id = await manualReport(page.request, origin, {
      contractorId: cp.id,
      reportTypeCode: 'nds',
      month: '2026-09-01',
      due: '2030-01-15',
    });
    await submit(page.request, origin, id, { amount: 100_000 });
    expect((await cardOf(page.request, id)).mark).toBe('waiting');

    await page.goto('/app/org/policy');
    await page.locator('[data-report-confirm] input[type=checkbox]').click();
    const dialog = page.getByRole('dialog', { name: 'Выключить подтверждение сдачи?' });
    await expect(dialog).toContainText(
      '1 отчёт ждёт подтверждения: они будут считаться подтверждёнными, в истории статусов появится запись «Подтверждение выключено в учётной политике».',
    );
    // «Отмена» — ничего не меняется.
    await dialog.getByRole('button', { name: 'Отмена' }).click();
    await expect(page.locator('[data-report-confirm] input[type=checkbox]')).toBeChecked();
    expect((await cardOf(page.request, id)).mark).toBe('waiting');

    await page.locator('[data-report-confirm] input[type=checkbox]').click();
    await dialog.getByRole('button', { name: 'Выключить' }).click();
    await expect(page.getByText('«Сдан» теперь окончательная отметка')).toBeVisible();
    await expect(
      page.getByText(
        'Сдача отчётов требует подтверждения: выключено; считаются подтверждёнными: 1',
      ),
    ).toBeVisible();
    // Подтверждение выключено — отметки на шаге «Сдан» больше нет, отчёт подтверждён с причиной.
    const after = (await cardOf(page.request, id)) as Card & {
      confirmedAt: string | null;
      confirmNote: string | null;
    };
    expect(after.mark).toBeNull();
    expect(after.confirmedAt).not.toBeNull();
    expect(after.confirmNote).toBe('Подтверждение выключено в учётной политике');
  });
});
