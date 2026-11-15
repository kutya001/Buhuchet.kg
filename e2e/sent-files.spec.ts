import { randomBytes } from 'node:crypto';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { search } from './admin';
import {
  botMessages,
  DEMO_PASSWORD,
  hire,
  linkTelegram,
  showStats,
  signIn,
  uniqueChat,
  uniqueLogin,
} from './helpers';

// Файлы от контрагентов (доработки 14.11.2026, блок 2; прототип v112 modules/cp-sent.js): контрагент
// отправляет файлы со своей страницы, ответственному — сообщение в Telegram, в карточке — раздел
// «Отправленные файлы», в «Файловом менеджере» — вкладка «Файлы от контрагентов»; «Принять» и
// «Отклонить» с причиной, которую контрагент видит на своей странице. Удаление через 30 дней —
// задача по расписанию (тесты API `packages/api/src/modules/files/sent.test.ts`).

/** Адрес демо-организации «Бухгалтер Плюс». */
const SLUG = 'buhgalter-plyus';

const uniqueTag = () => `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;

const freshInn = () =>
  `07${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10_000)
    .toString()
    .padStart(4, '0')}`;

/** Настоящий PDF по содержимому: сервер проверяет начало файла, а не расширение. */
const pdfBytes = () =>
  Buffer.from(
    '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n',
    'latin1',
  );

type Texts = Record<string, string>;

/** Тексты словаря интерфейса (`GET /api/l10n`): тесты не копируют длинные строки. */
async function dictionary(api: APIRequestContext): Promise<Texts> {
  const res = await api.get('/api/l10n');
  expect(res.status()).toBe(200);
  return ((await res.json()) as { texts: Texts }).texts;
}

/** Текст словаря с подстановками `{имя}`. */
function text(texts: Texts, key: string, values: Record<string, string | number> = {}) {
  const raw = texts[key];
  expect(raw, key).toBeTruthy();
  return Object.entries(values).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), raw!);
}

/** «Удалится через 30 дней» в день отправки (или 29, если между шагами наступила полночь). */
const leftText = (texts: Texts) =>
  new RegExp(
    [30, 29]
      .map((n) => text(texts, 'files.sent.left.many', { n }))
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|'),
  );

/** Новый сотрудник со своим паролем и привязанным Telegram — ответственный контрагента. */
async function staffWithTelegram(
  api: APIRequestContext,
  origin: string,
): Promise<{ id: string; chat: number }> {
  const login = uniqueLogin('e2e-sent');
  const { employee, temporaryPassword } = await hire(api, origin, login);
  await signIn(api, origin, login, temporaryPassword);
  const passwordSet = await api.post('/api/auth/password', {
    headers: { origin },
    data: { currentPassword: temporaryPassword, newPassword: 'Свой-пароль-e2e-1' },
  });
  expect(passwordSet.status()).toBe(200);
  const chat = uniqueChat();
  await linkTelegram(api, origin, chat);
  return { id: employee.id, chat };
}

/** Владелец создаёт контрагента с ответственным и включает его страницу. */
async function enabledPage(
  api: APIRequestContext,
  origin: string,
  name: string,
  responsible: string,
) {
  await signIn(api, origin, 'erkin', DEMO_PASSWORD);
  const inn = freshInn();
  const created = await api.post('/api/contractors', {
    headers: { origin },
    data: {
      name,
      inn,
      phone: '+996505890076',
      kind: 'regular',
      formCode: 'ФС-01',
      regimeCode: 'РЕЖ-01',
      gked: '46.34.0',
      startDate: '2026-10-01',
      responsibleEmployeeId: responsible,
      tariff: { amount: 0, period: 'M' },
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  const on = await api.post(`/api/contractors/${id}/page/enable`, { headers: { origin } });
  expect(on.status(), await on.text()).toBe(200);
  const { code } = (await on.json()) as { code: string };
  return { id, inn, code, path: `/${SLUG}/inn/${inn}` };
}

/** Клиент вводит код страницы и открывает раздел «Файлы» (на телефоне он свёрнут). */
async function openFilesSection(
  page: Page,
  cp: { path: string; code: string | null },
  name: string,
  isMobile: boolean,
): Promise<Locator> {
  await page.goto(cp.path);
  if (cp.code) {
    // «Открыть» доступна, когда React подхватил страницу: раньше поле заполнять нельзя (№ 41).
    await expect(page.getByRole('button', { name: 'Открыть' })).toBeEnabled();
    await page.getByLabel('Код доступа').fill(cp.code);
    await page.getByRole('button', { name: 'Открыть' }).click();
  }
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  const section = page.locator('[data-sec="files"]');
  if (isMobile) {
    await expect(section).toHaveAttribute('data-folded', '');
    // Свёрнуто видно уже в HTML сервера; нажатие работает, когда React узнал телефон (№ 41).
    await expect(section.locator('[data-pub-toggle]')).toHaveAttribute('aria-expanded', 'false');
    await section.locator('[data-pub-toggle]').click();
  }
  await expect(section.locator('[data-pub-sent]')).toBeVisible();
  return section;
}

/** Карточка контрагента на вкладке «Файлы». */
async function openCardFiles(page: Page, name: string, tag: string, isMobile: boolean) {
  await page.goto('/app/cps/all');
  const rows = page.locator('[data-grid] [data-id]');
  await expect(rows.first()).toBeVisible();
  await search(page, isMobile, tag);
  await rows.filter({ hasText: name }).first().getByText(name, { exact: true }).click();
  const card = page.getByRole('dialog', { name });
  await expect(card.locator('[data-cp-card]')).toBeVisible();
  if (isMobile) {
    await card.getByRole('tab', { selected: true }).click();
    await page
      .getByRole('menu')
      .getByRole('menuitem', { name: /^Файлы/ })
      .click();
  } else {
    await card.getByRole('tab', { name: /^Файлы/ }).click();
  }
  await expect(card.locator('[data-cp-files]')).toBeVisible();
  return card;
}

test.describe('Доработки 14.11, блок 2: файлы от контрагентов', () => {
  test.beforeEach(async ({ page }) => {
    const part = () => Math.floor(Math.random() * 256);
    await page.setExtraHTTPHeaders({ 'x-forwarded-for': `198.18.${part()}.${part()}` });
  });

  test('(приёмка блока 2) контрагент отправил файл со страницы: в карточке в «Отправленных файлах» строка «Новый», ответственному пришло сообщение; «Отклонить» с причиной — контрагент видит причину', async ({
    page,
    request,
    playwright,
    baseURL,
    isMobile,
  }) => {
    // Длинный сценарий: новый сотрудник с Telegram, два входа, карточка и страница контрагента.
    test.slow();
    const origin = new URL(baseURL!).origin;
    const texts = await dictionary(request);
    // Ответственный — новый сотрудник с Telegram (демо-сотрудникам Telegram не привязывается).
    const staffApi = await playwright.request.newContext({ baseURL });
    const staff = await staffWithTelegram(staffApi, origin);
    await staffApi.dispose();

    const tag = uniqueTag();
    const name = `ОсОО «Файлы ${tag}»`;
    const cp = await enabledPage(request, origin, name, staff.id);
    const fileName = `выписка-${tag}.pdf`;
    const comment = `Выписка за октябрь ${tag}`;

    // Клиент: «Отправить файл» в разделе «Файлы» своей страницы.
    const section = await openFilesSection(page, cp, name, isMobile);
    await expect(section.getByText(text(texts, 'pub.sent.hint'))).toBeVisible();
    // Подвал страницы, где можно отправлять файлы, — свой (прототип v112).
    await expect(page.locator('footer')).toHaveText(text(texts, 'pub.foot.upload'));
    await section.locator('[data-pub-up]').click();
    const send = page.getByRole('dialog', { name: text(texts, 'pub.sent.send') });
    await expect(send.getByText(text(texts, 'pub.sent.dlg.files_hint'))).toBeVisible();
    await send
      .locator('[data-pub-up-files]')
      .setInputFiles({ name: fileName, mimeType: 'application/pdf', buffer: pdfBytes() });
    await send.locator('[data-pub-up-note]').fill(comment);
    await send.locator('[data-pub-up-ok]').click();
    await expect(send).toBeHidden();
    await expect(
      page.getByRole('status').filter({ hasText: text(texts, 'pub.sent.done.one') }),
    ).toBeVisible();

    // «Отправленные вами»: файл «Новый», комментарий и «Удалится через 30 дней».
    const mine = section.locator('[data-pub-sent-row]').filter({ hasText: fileName });
    await expect(mine).toHaveAttribute('data-pub-sent-row', 'new');
    await expect(mine).toContainText(text(texts, 'files.sent.st.new'));
    await expect(mine).toContainText(comment);
    await expect(mine).toContainText(leftText(texts));
    // Ничего не прокручивается вбок (на телефоне — тоже).
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(wide).toBe(false);

    // Ответственному — сообщение в Telegram: контрагент и имя файла.
    const notice = text(texts, 'files.sent.tg.one', { contractor: name, names: fileName });
    await expect
      .poll(async () => (await botMessages(request, staff.chat)).some((m) => m.includes(notice)))
      .toBe(true);

    // Бухгалтер: карточка → «Файлы» → «Отправленные файлы», строка «Новый».
    await page.goto('about:blank');
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    const card = await openCardFiles(page, name, tag, isMobile);
    const box = card.locator('[data-cp-sent]');
    await expect(box.getByText(text(texts, 'files.sent.title')).first()).toBeVisible();
    await expect(box.locator('[data-cp-sent-new]')).toHaveText('1');
    const row = box.locator('[data-mini-row]').filter({ hasText: fileName });
    await expect(row).toContainText(text(texts, 'files.sent.st.new'));
    await expect(row).toContainText(text(texts, 'files.sent.src.page'));
    await expect(row).toContainText(comment);

    // «Отклонить» с причиной: причина обязательна.
    await row.locator('[data-sent-reject]').click();
    const reject = page.getByRole('dialog', { name: text(texts, 'files.sent.reject.title') });
    await expect(reject.getByText(text(texts, 'files.sent.reject.hint'))).toBeVisible();
    const reason = `Не тот месяц, пришлите за ноябрь ${tag}`;
    await reject.locator('[data-sent-reason-input]').fill(reason);
    await reject.locator('[data-sent-reject-ok]').click();
    await expect(reject).toBeHidden();
    await expect(
      page.getByRole('status').filter({ hasText: text(texts, 'files.sent.rejected') }),
    ).toBeVisible();
    await expect(row).toContainText(text(texts, 'files.sent.st.rejected'));
    await expect(row.locator('[data-sent-reason]')).toHaveText(reason);
    await expect(row.locator('[data-sent-reject]')).toHaveCount(0);
    await expect(box.locator('[data-cp-sent-new]')).toHaveCount(0);
    const cardWide = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(cardWide).toBe(false);

    // Отправка и отказ — в истории контрагента: отправка от имени контрагента, отказ — бухгалтера.
    // Чтение после долгих шагов в браузере — с повтором (docs/typical-mistakes.md № 26).
    const history = (await (
      await request.get(`/api/contractors/${cp.id}/history`, { maxRetries: 2 })
    ).json()) as {
      items: { entity: string; action: string; actor: string | null }[];
    };
    const sent = history.items.filter((h) => h.entity === 'sent_file');
    expect(sent.map((h) => h.action).sort()).toEqual(['sent_file_reject', 'sent_file_send']);
    expect(sent.find((h) => h.action === 'sent_file_send')!.actor).toBeNull();
    expect(sent.find((h) => h.action === 'sent_file_reject')!.actor).toBeTruthy();

    // Клиент снова открывает страницу: файл «Отклонён» и причина.
    await page.goto('about:blank');
    const again = await openFilesSection(page, { ...cp, code: null }, name, isMobile);
    const rejected = again.locator('[data-pub-sent-row]').filter({ hasText: fileName });
    await expect(rejected).toHaveAttribute('data-pub-sent-row', 'rejected');
    await expect(rejected).toContainText(text(texts, 'files.sent.st.rejected'));
    await expect(rejected.locator('[data-pub-sent-reason]')).toHaveText(
      text(texts, 'pub.sent.reason', { reason }),
    );
    await expect(rejected).toContainText(leftText(texts));
  });

  test('(проверка блока 2) «Файлы от контрагентов» в «Файловом менеджере»: «Принять» — файл среди файлов контрагента с источником «От контрагента»; отправка — только со своей страницы', async ({
    page,
    request,
    playwright,
    baseURL,
    isMobile,
  }) => {
    // Длинный сценарий: новый сотрудник, отправка по шагам, окно файла, карточка и страница контрагента.
    test.slow();
    const origin = new URL(baseURL!).origin;
    const texts = await dictionary(request);
    const staffApi = await playwright.request.newContext({ baseURL });
    const { employee } = await hire(staffApi, origin, uniqueLogin('e2e-sent'));
    await staffApi.dispose();
    const tag = uniqueTag();
    const name = `ОсОО «Принятые ${tag}»`;
    const cp = await enabledPage(request, origin, name, employee.id);
    const fileName = `акт-сверки-${tag}.pdf`;
    const body = pdfBytes();
    const start = { files: [{ name: fileName, size: body.length }] };

    // Без введённого кода отправить нельзя — ответ как у несуществующей страницы; с чужого сайта — 403.
    const stranger = await playwright.request.newContext({ baseURL });
    for (const address of [`${cp.path}/sent`, `/api/page/${SLUG}/${cp.inn}/sent`]) {
      const refused = await stranger.post(address, { headers: { origin }, data: start });
      expect(refused.status(), address).toBe(404);
    }
    const foreign = await stranger.post(`${cp.path}/sent`, {
      headers: { origin: 'https://evil.example' },
      data: start,
    });
    expect(foreign.status()).toBe(403);
    // Тело больше 64 КБ сайт не дочитывает.
    const huge = await stranger.post(`${cp.path}/sent`, {
      headers: { origin, 'content-type': 'application/json' },
      data: JSON.stringify({ files: [{ name: 'x'.repeat(70_000), size: 1 }] }),
    });
    expect(huge.status()).toBe(400);
    await stranger.dispose();

    // Браузер клиента: код введён, файл отправлен (начать → PUT в хранилище → закончить).
    const part = () => Math.floor(Math.random() * 256);
    const client = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { 'x-forwarded-for': `198.18.${part()}.${part()}` },
    });
    const opened = await client.post(`/api/page/${SLUG}/${cp.inn}/code`, {
      headers: { origin },
      data: { code: cp.code },
    });
    expect(opened.status(), await opened.text()).toBe(200);
    const begun = await client.post(`${cp.path}/sent`, { headers: { origin }, data: start });
    expect(begun.status(), await begun.text()).toBe(201);
    const ticket = (await begun.json()) as {
      items: { id: string; upload: { url: string; headers: Record<string, string> } }[];
    };
    expect(ticket.items).toHaveLength(1);
    const put = await client.put(ticket.items[0]!.upload.url, {
      headers: ticket.items[0]!.upload.headers,
      data: body,
    });
    expect(put.status(), await put.text()).toBe(200);
    const done = await client.post(`${cp.path}/sent/complete`, {
      headers: { origin },
      data: { ids: ticket.items.map((i) => i.id) },
    });
    expect(done.status(), await done.text()).toBe(200);
    expect(await done.json()).toEqual({ sent: 1 });
    await client.dispose();

    // Бухгалтер: «Файловый менеджер» открывается на «Все файлы» — со «Статистикой», как раньше.
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    await page.goto('/app/files');
    await expect(page).toHaveURL(/\/app\/files\/all$/);
    if (!isMobile) await showStats(page);
    // «Файлы от контрагентов», своя строка «Новый».
    await page.goto('/app/files/sent');
    const grid = page.locator('[data-files-sent] [data-grid]');
    await expect(grid).toBeVisible();
    // Ответ поиска — до нажатия в строке: иначе он приходит после «Принять» со старым статусом
    // (docs/typical-mistakes.md № 27).
    const found = page.waitForResponse((r) => {
      const url = new URL(r.url());
      return url.pathname === '/api/files/sent' && url.searchParams.get('q') === tag;
    });
    await search(page, isMobile, tag);
    expect((await found).status()).toBe(200);
    const line = grid.locator(`[data-id="${ticket.items[0]!.id}"]`);
    await expect(line).toContainText(name);
    await expect(line).toContainText(text(texts, 'files.sent.st.new'));

    // Окно файла: «Принять».
    await line.getByText(fileName, { exact: true }).click();
    const window = page.getByRole('dialog', { name: fileName });
    await expect(
      window.getByText(
        text(texts, 'files.sent.view.sub', { src: text(texts, 'files.sent.src.page') }),
      ),
    ).toBeVisible();
    await window.locator('[data-sent-window-accept]').click();
    await expect(
      page.getByRole('status').filter({ hasText: text(texts, 'files.sent.accepted') }),
    ).toBeVisible();
    await expect(line).toContainText(text(texts, 'files.sent.st.accepted'));

    // Принятый файл — среди файлов контрагента с источником «От контрагента».
    const card = await openCardFiles(page, name, tag, isMobile);
    const documents = card.locator(
      `[data-cp-files] table[aria-label="${text(texts, 'cp.card.tab.files')}"] [data-mini-row]`,
    );
    await expect(documents.filter({ hasText: fileName })).toContainText(
      text(texts, 'files.src.sent'),
    );
    const sentRow = card.locator('[data-cp-sent] [data-mini-row]').filter({ hasText: fileName });
    await expect(sentRow).toContainText(text(texts, 'files.sent.st.accepted'));

    // На странице клиента: «Принят», без срока удаления.
    await page.goto('about:blank');
    await page.context().clearCookies();
    const section = await openFilesSection(page, cp, name, isMobile);
    const mine = section.locator('[data-pub-sent-row]').filter({ hasText: fileName });
    await expect(mine).toHaveAttribute('data-pub-sent-row', 'accepted');
    await expect(mine).not.toContainText(leftText(texts));
  });
});
