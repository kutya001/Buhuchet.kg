import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { platformAdmin, search, uniqueInn } from './admin';
import {
  botAnswers,
  botMessages,
  botSent,
  linkTelegram,
  pressBotButton,
  sendToBot,
  showStats,
  uniqueChat,
  uniqueLogin,
} from './helpers';
import { IP_CERT, IP_CERT_INN, leadDocsDraft, leadDocsFields } from './lead-docs';

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

/**
 * Заявка гостя через методы лендинга (как форма «Оставить заявку»): ИП со свидетельством ГНС
 * (прототип v114 — документы обязательны), ИНН — свой на каждую заявку.
 */
async function sendLead(
  api: APIRequestContext,
  origin: string,
  lead: { firm: string; phone: string; note?: string; from?: string },
) {
  const from = lead.from ?? address();
  const draft = await leadDocsDraft(api, origin, from);
  return api.post('/api/leads', {
    headers: { origin, 'x-forwarded-for': from },
    data: {
      ...leadDocsFields(draft, uniqueInn()),
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
  test('(доработки 14.11.2026, блок 1) гость выбрал «ИП» и приложил свидетельство ГНС: название, ИНН и адрес подставлены с отметкой «из документов»; поправил адрес и отправил — «Заявка отправлена»; в Админке у заявки «ИП», документ и «не подключён», в окне — «Данные из документов» с файлом и «Открыть», «Одобрить» неактивна: «Заявитель ещё не подключил Telegram»; администратору — сообщение в Telegram', async ({
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
    const name = `Айгуль ${uniqueLogin('Сквозная')}`;
    const legal = 'г. Бишкек, ул. Сквозная, 7';
    const guest = await browser.newContext();
    const landing = await guest.newPage();
    await landing.setExtraHTTPHeaders({ 'x-forwarded-for': address() });
    await landing.goto('/#lead');
    const form = landing.locator('#lp-lead form');
    // «Форма организации» — первое поле (прототип v114): курсор на «ОсОО».
    const forms = form.getByRole('group', { name: 'Форма организации' });
    await expect(forms.getByRole('button', { name: 'ОсОО' })).toBeFocused();
    await forms.getByRole('button', { name: 'ИП' }).click();
    await expect(form.getByLabel('Выписка')).toHaveCount(0);
    await form.getByLabel('Свидетельство ГНС').setInputFiles(IP_CERT);
    await expect(
      form.getByText('Данные из документов подставлены в поля — проверьте и поправьте, если нужно'),
    ).toBeVisible({ timeout: 30_000 });
    const firmInput = form.getByLabel(/^Название фирмы/);
    const innInput = form.getByLabel(/^ИНН/);
    const addressInput = form.getByLabel(/^Юридический адрес/);
    await expect(innInput).toHaveValue(IP_CERT_INN);
    await expect(firmInput).not.toHaveValue('');
    await expect(addressInput).not.toHaveValue('');
    const mark = (field: string) =>
      form.locator(`label[for="${field}"]`).getByText('из документов');
    await expect(mark('lf-inn')).toBeVisible();
    await expect(mark('lf-addr')).toBeVisible();
    // Поправленное поле теряет отметку.
    await addressInput.fill(legal);
    await expect(mark('lf-addr')).toBeHidden();
    const firm = await firmInput.inputValue();

    await form.getByLabel('Имя и фамилия').fill(name);
    await form.getByLabel('Телефон').fill(uniquePhone());
    await form.getByLabel('Сколько клиентов ведёте').selectOption('21–50');
    await form.getByRole('button', { name: 'Отправить заявку' }).click();
    await expect(form.getByText('Нужно согласие на обработку персональных данных')).toBeVisible();
    await form.getByLabel(/Согласен на/).check();
    await form.getByRole('button', { name: 'Отправить заявку' }).click();
    // Без бота заявителя (поток Т) — «Спасибо! Заявка отправлена…», с ботом — «Заявка отправлена.
    // Подключите Telegram…»: общее у обоих — «Заявка отправлена».
    await expect(landing.locator('#lp-lead').getByRole('status')).toContainText(
      'Заявка отправлена',
    );
    await guest.close();

    // Сообщение администраторам платформы с привязанным Telegram (шаблон «новая заявка с сайта»):
    // заявка ставит его в очередь, отправляет задача по расписанию.
    await expect
      .poll(async () => {
        await tick(page.request);
        return (await botMessages(page.request, chat)).some((m) => m.includes(name));
      }, TG_POLL)
      .toBe(true);

    // Плитка «Заявки с сайта» на вкладке «Организации» ведёт на вкладку «Заявки».
    await page.goto('/app/orgs/list');
    const plates = page.locator('[data-plates]');
    await showStats(page);
    await plates.getByRole('button', { name: /Заявки с сайта/ }).click();
    await expect(page).toHaveURL(/\/app\/orgs\/leads$/);
    await expect(page.getByText('Заявки с лендинга buhuchet.kg.')).toBeVisible();

    const row = await leadRow(page, isMobile, name);
    await expect(row).toContainText('Новая');
    await expect(row).toContainText('ИП');
    await expect(row).toContainText('не подключён');

    // Окно заявки: «Данные из документов» — как проверил заявитель, файл с «Открыть».
    await row.click();
    const card = page.getByRole('dialog', { name: firm });
    const docs = card.locator('[data-lead-docs]');
    await expect(docs).toContainText(IP_CERT_INN);
    await expect(docs).toContainText(legal);
    await expect(docs).toContainText('Telegram заявителя');
    await expect(docs).toContainText('не подключён');
    const file = card.locator('[data-lead-doc="gns_cert"]');
    await expect(file).toContainText('Свидетельство ГНС');
    await expect(card.locator('[data-lead-docs-hint]')).toContainText('если заявку не одобрить');
    // «Открыть» — новая вкладка и ссылка на файл на 15 минут (просмотр PDF у браузера тестов может
    // стать загрузкой, поэтому проверяется ответ ссылки, а не адрес вкладки).
    const [link, tab] = await Promise.all([
      page.waitForResponse(
        (r) =>
          /\/api\/admin\/leads\/[^/]+\/docs\/[^/]+\/link$/.test(new URL(r.url()).pathname) &&
          r.request().method() === 'GET',
      ),
      page.context().waitForEvent('page'),
      file.locator('[data-lead-doc-open]').click(),
    ]);
    expect(link.status()).toBe(200);
    expect(((await link.json()) as { url: string }).url).toMatch(/^https?:\/\//);
    await tab.close();

    // «В работу», затем главная кнопка — «Одобрить»: без Telegram заявителя неактивна с причиной.
    await card.getByRole('button', { name: 'В работу' }).click();
    const approve = card.getByRole('button', { name: 'Одобрить' });
    await expect(approve).toHaveAttribute('aria-disabled', 'true');
    // Неактивная кнопка с причиной: нажатие показывает причину (Playwright такую кнопку сам не нажимает).
    await approve.click({ force: true });
    await expect(
      page.getByRole('status').filter({ hasText: 'Заявитель ещё не подключил Telegram' }),
    ).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Одобрить заявку' })).toHaveCount(0);
    // В «Ещё действия» — «Одобрить» неактивна, «Создать организацию» у заявки с документами нет.
    await card.getByRole('button', { name: 'Ещё действия' }).click();
    const more = page.getByRole('menu', { name: 'Ещё действия' });
    await expect(more.getByRole('menuitem', { name: /Одобрить/ })).toBeDisabled();
    await expect(more.getByRole('menuitem', { name: 'Создать организацию' })).toHaveCount(0);
    await page.keyboard.press('Escape');
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
    // Простым текстом — прежнее сообщение одной строкой со ссылкой; вид с заголовком, таблицей и
    // кнопками (поток Т, задача Т6) проверяет тест «идея 14» ниже.
    const plain = await page.request.put('/api/telegram/plain', {
      headers: { origin },
      data: { plain: true },
    });
    expect(plain.status(), await plain.text()).toBe(200);
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

  test('(пакет заказчика 13.11.2026, идея 14) заявка с сайта приходит администратору заголовком, таблицей и кнопками; «Взять в работу» — «В работе» с отметкой «через Telegram», второе нажатие — «Кнопка устарела»; «Отклонить» просит причину ответом и без причины заявку не меняет', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const chat = uniqueChat();
    await linkTelegram(page.request, origin, chat);
    const plain = await page.request.put('/api/telegram/plain', {
      headers: { origin },
      data: { plain: false },
    });
    expect(plain.status(), await plain.text()).toBe(200);
    const work = `ОсОО «${uniqueLogin('Кнопки')}»`;
    const refuse = `ОсОО «${uniqueLogin('Отказ')}»`;
    expect(
      (await sendLead(page.request, origin, { firm: work, phone: uniquePhone() })).status(),
    ).toBe(200);
    expect(
      (await sendLead(page.request, origin, { firm: refuse, phone: uniquePhone() })).status(),
    ).toBe(200);
    const about = async (firm: string) =>
      (await botSent(page.request, chat)).filter((m) => m.text.includes(firm));
    await expect
      .poll(async () => {
        await tick(page.request);
        return (await about(work)).length + (await about(refuse)).length;
      }, TG_POLL)
      .toBe(2);
    const [message] = await about(work);
    // Заголовок и таблица «Фирма / Контрагентов / Контакт»; кнопки — «Взять в работу» и «Отклонить»
    // (ссылка «Открыть в Админке» — только у сайта по https, у сквозного теста сайт по http).
    expect(message!.html).toContain('Новая заявка с сайта');
    expect(message!.text).toContain(`Фирма — ${work}`);
    expect(message!.text).toContain('Контрагентов — 21–50');
    expect(message!.text).toContain('Контакт — Сквозная Заявка, +996');
    expect(message!.keyboard![0]!.map((b) => b.text)).toEqual(['Взять в работу', 'Отклонить']);
    const workData = message!.keyboard![0]![0]!.callback_data!;
    const leadId = workData.split(':')[1]!;

    const pressed = await pressBotButton(page.request, chat, message!.messageId, workData);
    await expect
      .poll(async () => (await botAnswers(page.request)).find((a) => a.id === pressed)?.text)
      .toBe(`Заявка «${work}» — «В работе». Запись добавлена в историю заявки.`);
    const card = async (id: string) => {
      const res = await page.request.get(`/api/admin/leads/${id}`);
      expect(res.status(), await res.text()).toBe(200);
      return (await res.json()) as {
        status: string;
        statusHistory: { to: string; via?: string | null; reason: string | null }[];
      };
    };
    const taken = await card(leadId);
    expect(taken.status).toBe('in_progress');
    expect(taken.statusHistory.at(-1)).toMatchObject({ to: 'in_progress', via: 'telegram' });
    // Кнопка погасла; второе нажатие (другим администратором или повторно) — «Кнопка устарела».
    const again = await pressBotButton(page.request, chat, message!.messageId, workData);
    await expect
      .poll(async () => (await botAnswers(page.request)).find((a) => a.id === again)?.text)
      .toContain('Кнопка устарела');

    // «Отклонить»: бот просит причину ответом на своё сообщение; пустая причина — просьба повторить.
    const [second] = await about(refuse);
    const noData = second!.keyboard![0]![1]!.callback_data!;
    const refuseId = noData.split(':')[1]!;
    await pressBotButton(page.request, chat, second!.messageId, noData);
    const ask = async () =>
      (await about(refuse)).find((m) => m.text.includes('Напишите причину отказа'));
    await expect.poll(async () => !!(await ask())).toBe(true);
    const asked = (await ask())!;
    await sendToBot(page.request, chat, { text: '( )', replyTo: asked.messageId });
    await expect
      .poll(async () => (await botMessages(page.request, chat)).at(-1))
      .toContain('Нужна причина текстом');
    expect((await card(refuseId)).status).toBe('new');
    await sendToBot(page.request, chat, {
      text: 'Нужна программа с проводками',
      replyTo: asked.messageId,
    });
    await expect.poll(async () => (await card(refuseId)).status).toBe('rejected');
    expect((await card(refuseId)).statusHistory.at(-1)).toMatchObject({
      to: 'rejected',
      via: 'telegram',
    });
    expect((await botMessages(page.request, chat)).at(-1)).toBe(
      `Заявка «${refuse}» — «Отказ». Причина: Нужна программа с проводками. Снять отказ можно в Админке.`,
    );
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

  test('(проверка задачи #165, доработки 14.11.2026) статусы заявки: «В работу», «Отклонить» только с причиной, «Снять «Отказ»» с причиной — обратно «В работе»; у заявки с документами «Отметить «Подключена»» ведёт в «Одобрить» и без Telegram заявителя отказывает с причиной; заметка администратора — в историю; «Удалить» с подтверждением', async ({
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
    // У заявки с документами главная кнопка — «Одобрить» (прототип v114), а не «Создать организацию».
    await expect(card.getByRole('button', { name: 'Одобрить' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Создать организацию' })).toHaveCount(0);

    // «Отклонить» — только с причиной; в подсказке окна — когда удалятся файлы заявки.
    const menu = page.getByRole('menu', { name: 'Ещё действия' });
    await card.getByRole('button', { name: 'Ещё действия' }).click();
    await menu.getByRole('menuitem', { name: 'Отклонить', exact: true }).click();
    const refuse = page.getByRole('dialog', { name: 'Отклонить заявку' });
    await expect(refuse).toContainText('Файлы заявки удалятся через 7 дней.');
    await refuse.getByRole('button', { name: 'Отклонить', exact: true }).click();
    await expect(refuse).toContainText('Укажите причину отказа');
    await refuse.getByLabel('Причина отказа').fill('Нужны проводки');
    await refuse.getByRole('button', { name: 'Отклонить', exact: true }).click();
    await expect(refuse).toBeHidden();
    await expect(toast.filter({ hasText: 'Заявка отклонена' })).toBeVisible();
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

    // «Отметить «Подключена»» у заявки с документами — это «Одобрить» (прототип v114 leadStep): по свежей
    // заявке, без Telegram заявителя — уведомление с причиной, статус не меняется.
    await card.getByRole('button', { name: 'Ещё действия' }).click();
    await menu.getByRole('menuitem', { name: 'Отметить «Подключена»' }).click();
    await expect(toast.filter({ hasText: 'Заявитель ещё не подключил Telegram' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Отметить заявку «Подключена»?' })).toHaveCount(
      0,
    );
    await expect(page.getByRole('dialog', { name: 'Одобрить заявку' })).toHaveCount(0);

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
