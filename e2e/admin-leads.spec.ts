import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { platformAdmin, search, uniqueInn } from './admin';
import { botMessages, linkTelegram, showStats, uniqueChat, uniqueLogin } from './helpers';

const CRON_SECRET = process.env.CRON_SECRET ?? 'local-cron-secret-change-me';
/** Сообщение администраторам платформы уходит из очереди задачей «telegram.send» раз в минуту. */
const TG_POLL = { timeout: 120_000, intervals: [2_000, 5_000, 10_000] };

/** Вызов расписания, как Vercel (/api/cron/tick): разбирает очередь Telegram, если подошла минута. */
async function tick(api: APIRequestContext) {
  const res = await api.post('/api/cron/tick', {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
  expect(res.status(), await res.text()).toBe(200);
}

// Админка → «Организации» → «Заявки» (задача #165, часть 2; ТЗ «Админка» → «Вкладка «Заявки»»,
// «Лендинг» → «Форма «Оставить заявку»»; прототип admin/leads.js): заявка гостя с лендинга, список,
// окно заявки, статусы, «Создать организацию» по заявке.

/** Свой адрес на каждую заявку: с одного адреса — не больше 3 заявок в час (как в landing.spec.ts). */
const address = () =>
  `198.18.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;

/** Свой номер на каждый запуск: 9 цифр после кода страны. */
const uniquePhone = () =>
  `7${String(Date.now()).slice(-5)}${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;

/** Заявка гостя через метод лендинга (как форма «Оставить заявку»). */
async function sendLead(
  api: APIRequestContext,
  origin: string,
  lead: { firm: string; phone: string; note?: string; from?: string },
) {
  return api.post('/api/leads', {
    headers: { origin, 'x-forwarded-for': lead.from ?? address() },
    data: {
      name: 'Сквозная Заявка',
      firm: lead.firm,
      phone: `+996${lead.phone}`,
      size: '21–50',
      telegram: '@e2e_lead',
      note: lead.note ?? '',
      consent: true,
      website: '',
    },
  });
}

/** Строка заявки на вкладке «Заявки» по названию фирмы. */
async function leadRow(page: Page, isMobile: boolean, firm: string) {
  await page.goto('/app/orgs/leads');
  await expect(page.locator('[data-grid] [data-id]').first()).toBeVisible();
  await search(page, isMobile, firm);
  const row = page.locator('[data-grid] [data-id]').filter({ hasText: firm });
  await expect(row).toHaveCount(1);
  return row;
}

test.describe('Этап 3: заявки с сайта в Админке (задача #165)', () => {
  test('(лендинг, заявка) без галочки согласия — «Нужно согласие…», с галочкой — «Спасибо!»; в Админке на вкладке «Заявки» строка «Новая», администратору — сообщение в Telegram; «Создать организацию» — форма с названием и ФИО из заявки, после сохранения заявка «Подключена»', async ({
    page,
    browser,
    baseURL,
    isMobile,
  }) => {
    // Ждём отправку очереди Telegram (до минуты) — см. TG_POLL.
    test.setTimeout(180_000);
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const chat = uniqueChat();
    await linkTelegram(page.request, origin, chat);

    // Гость — в своём браузере, без входа.
    const firm = `ОсОО «${uniqueLogin('Заявка')}»`;
    const guest = await browser.newContext();
    const landing = await guest.newPage();
    await landing.setExtraHTTPHeaders({ 'x-forwarded-for': address() });
    await landing.goto('/#lead');
    const form = landing.locator('#lp-lead form');
    await form.getByLabel('Имя и фамилия').fill('Айгуль Сквозная');
    await form.getByLabel('Название фирмы').fill(firm);
    await form.getByLabel('Телефон').fill(uniquePhone());
    await form.getByLabel('Сколько клиентов ведёте').selectOption('21–50');
    await form.getByRole('button', { name: 'Отправить заявку' }).click();
    await expect(form.getByText('Нужно согласие на обработку персональных данных')).toBeVisible();
    await form.getByLabel(/Согласен на/).check();
    await form.getByRole('button', { name: 'Отправить заявку' }).click();
    await expect(landing.locator('#lp-lead').getByRole('status')).toContainText(
      'Спасибо! Заявка отправлена.',
    );
    await guest.close();

    // Сообщение администраторам платформы с привязанным Telegram (шаблон «новая заявка с сайта»):
    // заявка ставит его в очередь, отправляет задача по расписанию.
    await expect
      .poll(async () => {
        await tick(page.request);
        return (await botMessages(page.request, chat)).some((m) => m.includes(firm));
      }, TG_POLL)
      .toBe(true);

    // Плитка «Заявки с сайта» на вкладке «Организации» ведёт на вкладку «Заявки».
    await page.goto('/app/orgs/list');
    const plates = page.locator('[data-plates]');
    await showStats(page);
    await plates.getByRole('button', { name: /Заявки с сайта/ }).click();
    await expect(page).toHaveURL(/\/app\/orgs\/leads$/);
    await expect(page.getByText('Заявки с лендинга buhuchet.kg.')).toBeVisible();

    const row = await leadRow(page, isMobile, firm);
    await expect(row).toContainText('Новая');
    await expect(row).toContainText('Айгуль Сквозная');

    // «Создать организацию» в меню строки: название фирмы и ФИО — из заявки.
    await row.locator('[data-row-menu]').click();
    await page
      .getByRole('menu', { name: 'Действия' })
      .getByRole('menuitem', { name: 'Создать организацию' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Новая организация' });
    await expect(dialog).toContainText('по заявке с сайта от');
    await expect(dialog.getByLabel('Название')).toHaveValue(firm);
    await expect(dialog.getByLabel('ФИО владельца')).toHaveValue('Айгуль Сквозная');
    await dialog.getByLabel('ИНН').fill(uniqueInn());
    await dialog.getByLabel('Логин владельца').fill(uniqueLogin('e2e-lead'));
    await dialog.getByRole('button', { name: 'Создать' }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'Организация и владелец созданы, заявка «Подключена»' }),
    ).toBeVisible();
    await expect(row).toContainText('Подключена');
    await expect(row.locator('[data-lead-org]')).toHaveText(firm);

    // В окне заявки: «Подключена» с организацией не откатывается — пункт неактивен с причиной.
    await row.click();
    const card = page.getByRole('dialog', { name: firm });
    await expect(card).toContainText('По заявке создана организация');
    await expect(card).toContainText(`Статус: Новая → Подключена, создана организация «${firm}»`);
    await card.getByRole('button', { name: 'Ещё действия' }).click();
    const more = page.getByRole('menu', { name: 'Ещё действия' });
    await expect(more.getByRole('menuitem', { name: 'Откатить в «—»' })).toBeDisabled();
    await expect(more.getByRole('menuitem', { name: 'Создать организацию' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Организация в окне заявки открывает «Организации» с карточкой этой организации (прототип v83);
    // в карточке — ссылка на заявку, по которой организация создана.
    await card.locator('[data-lead-org]').click();
    await expect(page).toHaveURL(/\/app\/orgs(\/list)?$/);
    const orgCard = page.locator('[data-org-card]');
    await expect(orgCard.locator('[data-org-states]')).toHaveText('Активна');
    await expect(orgCard.locator('[data-org-lead]')).toContainText(firm);
    await orgCard.locator('[data-org-lead]').click();
    await expect(
      page.getByRole('dialog', { name: firm }).filter({ hasText: 'По заявке создана организация' }),
    ).toBeVisible();
  });

  test('(прототип v74) гость отправил заявку: администратору с привязанным Telegram пришло «📩 Новая заявка с сайта: …» со ссылкой на «Заявки», повторная с того же телефона — «🔁 Повторная заявка с сайта»; в журнале «Телеграм» записи «Заявка с сайта» со статусом «Отправлено»', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    // Ждём отправку очереди Telegram (до минуты) — см. TG_POLL.
    test.setTimeout(180_000);
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const chat = uniqueChat();
    await linkTelegram(page.request, origin, chat);
    // Сквозные тесты идут не на стенде: пометку «🧪 Тестовый стенд», ссылку стенда и «Тестовый стенд»
    // в журнале проверяют тесты API и базы (docs/deviations.md п. О-6).

    const firm = `ОсОО «${uniqueLogin('Уведомление')}»`;
    const phone = uniquePhone();
    expect((await sendLead(page.request, origin, { firm, phone })).status()).toBe(200);
    expect((await sendLead(page.request, origin, { firm, phone, note: 'Ещё раз' })).status()).toBe(
      200,
    );
    const about = async () =>
      (await botMessages(page.request, chat)).filter((m) => m.includes(firm));
    await expect
      .poll(async () => {
        await tick(page.request);
        return (await about()).length;
      }, TG_POLL)
      .toBe(2);
    const [created, repeated] = [
      (await about()).find((m) => m.includes('📩'))!,
      (await about()).find((m) => m.includes('🔁'))!,
    ];
    const link = `${origin}/app/orgs/leads`;
    expect(created.startsWith(`📩 Новая заявка с сайта: ${firm}, Сквозная Заявка, +996`)).toBe(
      true,
    );
    expect(created).toContain('клиентов: 21–50');
    expect(created.endsWith(`Открыть: ${link}`)).toBe(true);
    expect(repeated.startsWith(`🔁 Повторная заявка с сайта: ${firm}, Сквозная Заявка`)).toBe(true);
    expect(repeated.endsWith(`Открыть: ${link}`)).toBe(true);

    // Ссылка из сообщения открывает вкладку «Заявки» Админки.
    await page.goto(link);
    await expect(page).toHaveURL(/\/app\/orgs\/leads$/);
    await expect(page.getByText('О каждой новой и повторной заявке бот сразу пишет')).toBeVisible();

    // Журнал «Телеграм»: обе отправки — «Заявка с сайта», «Отправлено». О заявке пишут каждому
    // администратору с привязанным Telegram, а соседние тесты заявок идут в это же время, поэтому
    // у этого чата могут быть и записи о чужих заявках: своих — не меньше двух (ровно две о своей
    // фирме проверены выше по сообщениям бота).
    await page.goto('/app/tg/log');
    await expect(page.locator('[data-grid] [data-id]').first()).toBeVisible();
    await search(page, isMobile, `e2e_${chat}`);
    // Поиск применился: в списке остались записи только этого получателя.
    const all = page.locator('[data-grid] [data-id]');
    await expect(all.filter({ hasNotText: `e2e_${chat}` })).toHaveCount(0);
    const rows = all.filter({ hasText: 'Заявка с сайта' }).filter({ hasText: 'Отправлено' });
    await expect.poll(() => rows.count()).toBeGreaterThanOrEqual(2);
    // «Организация» (на телефоне карточка её не показывает) — «Платформа» у каждой такой записи.
    if (!isMobile) {
      await expect(rows.filter({ hasText: 'Платформа' })).toHaveCount(await rows.count());
    }
  });

  test('(лендинг, повтор) четвёртая заявка за час с одного адреса не принимается — «Слишком много заявок…»; повторная заявка с тем же телефоном не создаёт вторую строку: комментарий дописан', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const from = address();
    const firm = `ОсОО «${uniqueLogin('Повтор')}»`;
    const phone = uniquePhone();
    expect((await sendLead(page.request, origin, { firm, phone, from })).status()).toBe(200);
    const again = await sendLead(page.request, origin, { firm, phone, from, note: 'Перезвоните' });
    expect(again.status()).toBe(200);
    const other = { firm: `ОсОО «${uniqueLogin('Третья')}»`, phone: uniquePhone(), from };
    expect((await sendLead(page.request, origin, other)).status()).toBe(200);
    const fourth = await sendLead(page.request, origin, {
      firm: `ОсОО «${uniqueLogin('Четвёртая')}»`,
      phone: uniquePhone(),
      from,
    });
    expect(fourth.status()).toBe(429);
    expect(await fourth.json()).toMatchObject({
      error: { code: 'lead_limited', message: expect.stringContaining('Слишком много заявок') },
    });

    const row = await leadRow(page, isMobile, firm);
    await expect(row).toContainText('Перезвоните');
    await row.click();
    const card = page.getByRole('dialog', { name: firm });
    await expect(card).toContainText('Повторная заявка с того же телефона: комментарий дописан');
  });

  test('(проверка задачи #165) статусы заявки: «В работу», «Отказ» только с причиной, «Снять «Отказ»» с причиной — обратно «В работе», «Отметить «Подключена»» с подтверждением; заметка администратора — в историю; «Удалить» с подтверждением', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const firm = `ОсОО «${uniqueLogin('Статусы')}»`;
    expect((await sendLead(page.request, origin, { firm, phone: uniquePhone() })).status()).toBe(
      200,
    );
    const toast = page.getByRole('status');
    const row = await leadRow(page, isMobile, firm);
    await row.click();
    const card = page.getByRole('dialog', { name: firm });
    await expect(card).toContainText('Сквозная Заявка · заявка с сайта от');
    await expect(card).toContainText('Видит только администратор платформы');

    // Главная кнопка новой заявки — «В работу».
    await card.getByRole('button', { name: 'В работу' }).click();
    await expect(toast.filter({ hasText: 'Заявка: В работе' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Создать организацию' })).toBeVisible();

    // «Отказ» — только с причиной.
    const menu = page.getByRole('menu', { name: 'Ещё действия' });
    await card.getByRole('button', { name: 'Ещё действия' }).click();
    await menu.getByRole('menuitem', { name: 'Отказ', exact: true }).click();
    const refuse = page.getByRole('dialog', { name: 'Отказ по заявке' });
    await refuse.getByRole('button', { name: 'Отказ', exact: true }).click();
    await expect(refuse).toContainText('Укажите причину отказа');
    await refuse.getByLabel('Причина отказа').fill('Нужны проводки');
    await refuse.getByRole('button', { name: 'Отказ', exact: true }).click();
    await expect(refuse).toBeHidden();
    await expect(toast.filter({ hasText: 'Заявка: отказ' })).toBeVisible();
    await expect(card).toContainText('Отказ — шкала не ведётся');
    await expect(card).toContainText('Статус: В работе → Отказ (Нужны проводки)');

    // «Снять «Отказ»» — откат с причиной в статус до отказа.
    await card.getByRole('button', { name: 'Снять «Отказ»' }).click();
    const back = page.getByRole('dialog', { name: 'Откатить: «Отказ» → «В работе»' });
    await expect(back).toContainText('Отметка «Отказ» будет снята: заявка вернётся в «В работе».');
    await back.getByLabel('Причина отката').fill('Передумали');
    await back.getByRole('button', { name: 'Откатить' }).click();
    await expect(back).toBeHidden();
    await expect(card).toContainText('Статус: Отказ → В работе (откат: Передумали)');

    // «Отметить «Подключена»» — после вопроса.
    await card.getByRole('button', { name: 'Ещё действия' }).click();
    await menu.getByRole('menuitem', { name: 'Отметить «Подключена»' }).click();
    const ask = page.getByRole('dialog', { name: 'Отметить заявку «Подключена»?' });
    await expect(ask).toContainText(`${firm}: клиент подключён.`);
    await ask.getByRole('button', { name: 'Подключена' }).click();
    await expect(toast.filter({ hasText: 'Заявка «Подключена»' })).toBeVisible();

    // Заметка администратора: без изменений — «Изменений нет», иначе — запись в историю.
    await card.getByRole('button', { name: 'Сохранить заметку' }).click();
    await expect(toast.filter({ hasText: 'Изменений нет' })).toBeVisible();
    await card.getByLabel('Заметка администратора').fill('Показ в понедельник');
    await card.getByRole('button', { name: 'Сохранить заметку' }).click();
    await expect(toast.filter({ hasText: 'Заметка сохранена' })).toBeVisible();
    await expect(card).toContainText('Заметка администратора изменена');

    // «Удалить» — после вопроса; окно заявки закрывается, строки нет.
    await card.getByRole('button', { name: 'Ещё действия' }).click();
    await menu.getByRole('menuitem', { name: 'Удалить' }).click();
    const del = page.getByRole('dialog', { name: 'Удалить заявку?' });
    await expect(del).toContainText('Имя и телефон будут стёрты.');
    await del.getByRole('button', { name: 'Удалить' }).click();
    await expect(toast.filter({ hasText: 'Заявка удалена' })).toBeVisible();
    await expect(card).toBeHidden();
    await expect(page.locator('[data-grid] [data-id]').filter({ hasText: firm })).toHaveCount(0);
  });
});
