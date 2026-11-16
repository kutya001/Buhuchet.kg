import { randomBytes } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { search } from './admin';
import { DEMO_PASSWORD, hire, pickContractor, signIn, uniqueLogin } from './helpers';

// Один файл — несколько ссылок (доработки 16.11.2026, блок 2; прототип v124 modules/files.js
// `fPickDlg`, `fPickRow`, `fUnlink`, `fGoActs`, `fDelDlg`): принятый файл контрагента прикрепляется к его
// записи ссылкой, без копии и без новой загрузки; в «Файловом менеджере» он одной строкой с обеими
// ссылками в «Источнике»; «Открепить» убирает только ссылку; удаление при ссылках — «Удалить отовсюду?».
// Права, область, «того же контрагента» и «Удалить отовсюду» на сервере — тесты API
// `packages/api/src/modules/files/links.test.ts`.

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

const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Текст с суммой: на экране пробелы в числе неразрывные — в сравнении любой пробел. */
const loose = (value: string) => new RegExp(reEsc(value).replace(/ /g, '\\s'));

/**
 * Владелец создаёт контрагента с ответственным и включает его страницу; `tariff` — ставка за обслуживание
 * в тыйынах (0 — без начислений).
 */
async function contractorWithPage(
  api: APIRequestContext,
  origin: string,
  name: string,
  responsible: string,
  tariff = 0,
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
      tariff: { amount: tariff, period: 'M' },
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  const on = await api.post(`/api/contractors/${id}/page/enable`, { headers: { origin } });
  expect(on.status(), await on.text()).toBe(200);
  const { code } = (await on.json()) as { code: string };
  return { id, inn, code, path: `/${SLUG}/inn/${inn}` };
}

/**
 * Контрагент отправил файл со своей страницы (код → начать → `PUT` в хранилище → закончить), а сотрудник
 * его «Принял» без денег — как «Принять только файл»: файл среди файлов контрагента «От контрагента».
 */
async function sentAndAccepted(
  client: APIRequestContext,
  staff: APIRequestContext,
  origin: string,
  cp: { id: string; inn: string; code: string; path: string },
  fileName: string,
): Promise<string> {
  const opened = await client.post(`/api/page/${SLUG}/${cp.inn}/code`, {
    headers: { origin },
    data: { code: cp.code },
  });
  expect(opened.status(), await opened.text()).toBe(200);
  const body = pdfBytes();
  const begun = await client.post(`${cp.path}/sent`, {
    headers: { origin },
    data: { files: [{ name: fileName, size: body.length }] },
  });
  expect(begun.status(), await begun.text()).toBe(201);
  const ticket = (await begun.json()) as {
    items: { id: string; upload: { url: string; headers: Record<string, string> } }[];
  };
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

  const list = await staff.get(`/api/contractors/${cp.id}/sent-files`, { maxRetries: 2 });
  expect(list.status(), await list.text()).toBe(200);
  const sent = ((await list.json()) as { items: { id: string; version: number }[] }).items.find(
    (x) => x.id === ticket.items[0]!.id,
  );
  expect(sent).toBeTruthy();
  const accepted = await staff.post(`/api/files/sent/${sent!.id}/accept`, {
    headers: { origin },
    data: { version: sent!.version },
  });
  expect(accepted.status(), await accepted.text()).toBe(200);
  const fileId = ((await accepted.json()) as { fileId: string | null }).fileId;
  expect(fileId).toBeTruthy();
  return fileId!;
}

/** «Файловый менеджер» → «Все файлы», общий поиск по метке; ответ поиска — до шагов в строке (№ 27). */
async function managerRow(page: Page, isMobile: boolean, tag: string, fileId: string) {
  await page.goto('/app/files/all');
  await expect(page.locator('[data-grid]')).toBeVisible();
  const found = page.waitForResponse((r) => {
    const url = new URL(r.url());
    return url.pathname === '/api/files/manager' && url.searchParams.get('q') === tag;
  });
  await search(page, isMobile, tag);
  expect((await found).status()).toBe(200);
  return page.locator(`[data-grid] [data-id="${fileId}"]`);
}

/** «Источник» в окне файла: строка «Источник» — значение, как его видит пользователь. */
async function windowSource(page: Page, fileName: string) {
  const window = page.getByRole('dialog', { name: fileName });
  await expect(window).toBeVisible();
  return window;
}

const ddmmyyyy = (iso: string) => iso.split('-').reverse().join('.');

test.describe('Доработки 16.11, блок 2: один файл — несколько ссылок', () => {
  test.beforeEach(async ({ page }) => {
    const part = () => Math.floor(Math.random() * 256);
    await page.setExtraHTTPHeaders({ 'x-forwarded-for': `198.18.${part()}.${part()}` });
  });

  test('(приёмка 16.11, сценарии 3–5) принятая от контрагента сверка прикрепляется к поступлению через «Из файлов контрагента»: в «Файловом менеджере» одна строка, «Источник» — «От контрагента · Поступление …»; «Открепить» оставляет файл у контрагента; удаление при ссылке спрашивает «Удалить отовсюду?»', async ({
    page,
    request,
    playwright,
    baseURL,
    isMobile,
  }) => {
    // Длинный сценарий: отправка со страницы, окно денег, Файловый менеджер, окно поступления, удаление.
    test.slow();
    const origin = new URL(baseURL!).origin;
    const texts = await dictionary(request);
    const staffApi = await playwright.request.newContext({ baseURL });
    const { employee } = await hire(staffApi, origin, uniqueLogin('e2e-links'));
    await staffApi.dispose();
    const tag = uniqueTag();
    const name = `ОсОО «Сверка ${tag}»`;
    const cp = await contractorWithPage(request, origin, name, employee.id);
    const fileName = `акт-сверки-${tag}.pdf`;
    const part = () => Math.floor(Math.random() * 256);
    const client = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { 'x-forwarded-for': `198.18.${part()}.${part()}` },
    });
    const fileId = await sentAndAccepted(client, request, origin, cp, fileName);
    await client.dispose();
    const fromCp = text(texts, 'files.src.sent');

    // Бухгалтер: «Финансовые операции» → «+ Добавить» → «Поступление» этого контрагента; сверку — из
    // его файлов, без новой загрузки (прототип v124 `fPickRow`).
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    await page.goto('/app/fin');
    await expect(page.locator('[data-grid]')).toBeVisible();
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    await page
      .getByRole('menu', { name: 'Добавить' })
      .getByRole('menuitem', { name: 'Поступление' })
      .click();
    const receipt = page.getByRole('dialog', { name: text(texts, 'money.in.title') });
    // Окно дочитывает данные первого контрагента и рисуется заново — список открываем после этого.
    await expect(receipt.getByRole('button', { name: text(texts, 'money.in.ok') })).toBeEnabled();
    // Выбранный контрагент — окно дочитывает его данные и рисуется заново (№ 28): сумму вводим после.
    const formRead = page.waitForResponse(
      (r) => new URL(r.url()).pathname === `/api/contractors/${cp.id}/receipt-form`,
    );
    await pickContractor(receipt.locator('[data-receipt-contractor]'), tag);
    expect((await formRead).status()).toBe(200);
    await expect(receipt.locator('[data-receipt-contractor]')).toContainText(name);
    await expect(receipt.locator('[data-link-pick]')).toBeVisible();
    await receipt.locator('[data-receipt-total]').fill('1000');
    await expect(receipt.locator('[data-receipt-total]')).toHaveValue(/1\s?000|1000/);
    await receipt.locator('[data-link-pick]').click();
    const pick = page.getByRole('dialog', { name: text(texts, 'files.pick.title') });
    await expect(pick.locator('[data-file-pick-dialog]')).toBeVisible();
    await expect(pick.getByText(text(texts, 'files.pick.hint'))).toBeVisible();
    const pickRow = pick.locator(`[data-file-pick-row="${fileName}"]`);
    // Откуда файл — «От контрагента»; чужих файлов в окне нет.
    await expect(pickRow).toContainText(fromCp);
    await expect(pick.locator('[data-file-pick-row]')).toHaveCount(1);
    await pickRow.click();
    await expect(pick.locator('[data-file-pick-ok]')).toHaveText(
      text(texts, 'files.pick.ok_n', { n: 1 }),
    );
    await pick.locator('[data-file-pick-ok]').click();
    await expect(pick).toBeHidden();
    await expect(receipt.locator(`[data-link-picked="${fileName}"]`)).toBeVisible();
    const date = await receipt.locator('[data-receipt-date]').inputValue();
    const saved = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        new URL(r.url()).pathname === `/api/contractors/${cp.id}/receipts`,
    );
    const linked = page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/files/links',
    );
    // Новой загрузки нет: только ссылка.
    const uploads: string[] = [];
    const onUpload = (r: { method(): string; url(): string }) => {
      if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/files/uploads')
        uploads.push(r.url());
    };
    page.on('request', onUpload);
    await receipt.getByRole('button', { name: text(texts, 'money.in.ok') }).click();
    const savedRes = await saved;
    expect(savedRes.status(), await savedRes.text()).toBe(201);
    const receiptId = ((await savedRes.json()) as { id: string }).id;
    const linkedRes = await linked;
    expect(linkedRes.status(), await linkedRes.text()).toBe(200);
    expect(linkedRes.request().postDataJSON()).toEqual({
      kind: 'receipt',
      id: receiptId,
      fileIds: [fileId],
    });
    await expect(receipt).toBeHidden();
    await expect(
      page.getByRole('status').filter({ hasText: text(texts, 'money.in.done') }),
    ).toBeVisible();
    page.off('request', onUpload);
    expect(uploads).toEqual([]);

    // «Файловый менеджер»: одна строка, «Источник» — обе ссылки (прототип v124 `o.src`).
    const receiptLabel = text(texts, 'files.link.src.receipt', {
      date: ddmmyyyy(date),
      amount: '1 000 сом',
    });
    const both = loose(`${fromCp} · ${receiptLabel}`);
    const row = await managerRow(page, isMobile, tag, fileId);
    await expect(page.locator('[data-grid] [data-id]').filter({ hasText: fileName })).toHaveCount(
      1,
    );
    await row.getByText(fileName, { exact: true }).click();
    const window = await windowSource(page, fileName);
    await expect(window.locator('[data-file-window-src]')).toHaveText(both);
    // Запись в «Источнике» — ссылка на её окно (прототип v124 `data-fol`).
    await window.locator(`[data-file-link-open="receipt:${receiptId}"]`).click();
    await expect(window).toBeHidden();
    await expect(page.locator(`[data-fin-op-window="${receiptId}"]`)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator(`[data-fin-op-window="${receiptId}"]`)).toBeHidden();

    // Меню «…»: «Перейти к источнику» по каждой ссылке (прототип v124 `fGoActs`).
    const toReceipt = text(texts, 'files.act.source_to', {
      name: text(texts, 'files.link.nm.receipt', { date: ddmmyyyy(date) }),
    });
    await row.locator('[data-row-menu]').click();
    const menu = page.getByRole('menu', { name: 'Действия' });
    await expect(
      menu.getByRole('menuitem', { name: text(texts, 'files.act.source_cp') }),
    ).toBeVisible();
    await menu.getByRole('menuitem', { name: toReceipt }).click();
    const op = page.locator(`[data-fin-op-window="${receiptId}"]`);
    await expect(op).toBeVisible();
    // Строка блока «Файлы», не строка «Истории изменений» с тем же названием.
    const inOp = op.locator('[data-file-row]').filter({ hasText: fileName });
    await expect(inOp).toContainText(text(texts, 'files.link.also_cp'));

    // «Открепить»: без подтверждения, файл ушёл из поступления, но остался у контрагента.
    await inOp
      .locator('[data-file-unlink]')
      .and(
        page.getByRole('button', {
          name: text(texts, 'files.link.unlink_aria', { name: fileName }),
        }),
      )
      .click();
    await expect(
      page.getByRole('status').filter({ hasText: text(texts, 'files.link.unlinked') }),
    ).toBeVisible();
    await expect(inOp).toHaveCount(0);
    const afterUnlink = await request.get(`/api/files?kind=receipt&id=${receiptId}`, {
      maxRetries: 2,
    });
    expect(((await afterUnlink.json()) as { items: unknown[] }).items).toEqual([]);
    const still = await request.get(`/api/files/${fileId}/link`, { maxRetries: 2 });
    expect(still.status()).toBe(200);
    // «Открепить» — в истории поступления (`file_delete` со ссылкой, прототип v124 `fUnlink`).
    const opRes = await request.get(`/api/money-operations/${receiptId}`, { maxRetries: 2 });
    expect(opRes.status(), await opRes.text()).toBe(200);
    const opHistory = (
      (await opRes.json()) as {
        history: { action: string; changes: { field: string }[] }[];
      }
    ).history;
    expect(
      opHistory.some(
        (h) => h.action === 'file_delete' && h.changes.some((c) => c.field === 'link'),
      ),
    ).toBe(true);

    // Снова из файлов контрагента — уже в окне поступления: ссылка ставится сразу.
    await op.locator('[data-file-pick]').click();
    await expect(pick.locator('[data-file-pick-dialog]')).toBeVisible();
    await pick.locator(`[data-file-pick-row="${fileName}"]`).click();
    await pick.locator('[data-file-pick-ok]').click();
    await expect(
      page.getByRole('status').filter({ hasText: text(texts, 'files.link.linked_one') }),
    ).toBeVisible();
    await expect(inOp).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(op).toBeHidden();

    // Файл у контрагента: «Перейти к источнику: файлы контрагента» — его вкладка «Файлы» с «также у
    // поступления от …»; удаление в окне файла при ссылке — «Удалить отовсюду?» со списком записей.
    await row.locator('[data-row-menu]').click();
    await menu.getByRole('menuitem', { name: text(texts, 'files.act.source_cp') }).click();
    const card = page.getByRole('dialog', { name });
    const cpFiles = card.locator('[data-cp-files]');
    await expect(cpFiles).toBeVisible();
    const cpRow = cpFiles.locator(`[data-mini-row="${fileId}"]`);
    await expect(cpRow.locator('[data-file-also]')).toHaveText(
      loose(
        text(texts, 'files.pick.also', {
          list: text(texts, 'files.link.gen.receipt', { date: ddmmyyyy(date) }),
        }),
      ),
    );
    await cpRow.getByText(fileName, { exact: true }).click();
    const cpWindow = page.getByRole('dialog', { name: fileName });
    await expect(cpWindow.locator('[data-file-window-delete]')).toHaveText(
      text(texts, 'files.act.delete_all'),
    );
    await cpWindow.locator('[data-file-window-delete]').click();
    const confirm = page.getByRole('dialog', {
      name: text(texts, 'files.delete.title', { name: fileName }),
    });
    const listed = text(texts, 'files.link.nm.receipt', { date: ddmmyyyy(date) });
    await expect(confirm).toContainText(
      text(texts, 'files.delete.linked', {
        list: listed.charAt(0).toLowerCase() + listed.slice(1),
      }),
    );
    await confirm.getByRole('button', { name: text(texts, 'files.act.delete_all') }).click();
    await expect(
      page.getByRole('status').filter({ hasText: text(texts, 'files.deleted_all') }),
    ).toBeVisible();
    await expect(cpRow).toHaveCount(0);
    await expect(card.locator('[data-cp-files]')).not.toContainText(fileName);
    const gone = await request.get(`/api/files?kind=receipt&id=${receiptId}`, { maxRetries: 2 });
    expect(((await gone.json()) as { items: unknown[] }).items).toEqual([]);
    expect((await request.get(`/api/files/${fileId}/link`, { maxRetries: 2 })).status()).toBe(404);
  });
  test('(приёмка 16.11, путь «акт → оплата за обслуживание») принятая накладная прикрепляется к «Принять оплату за обслуживание» через «Из файлов контрагента»: после сохранения — ссылка на оплату, в «Источнике» «Файлового менеджера» — «Оплата за обслуживание …»', async ({
    page,
    request,
    playwright,
    baseURL,
    isMobile,
  }) => {
    test.slow();
    const origin = new URL(baseURL!).origin;
    const texts = await dictionary(request);
    const staffApi = await playwright.request.newContext({ baseURL });
    const { employee } = await hire(staffApi, origin, uniqueLogin('e2e-links-fee'));
    await staffApi.dispose();
    const tag = uniqueTag();
    const name = `ОсОО «Накладная ${tag}»`;
    // Ставка 60 000 сом с текущего месяца: в окне оплаты сумма подставлена.
    const cp = await contractorWithPage(request, origin, name, employee.id, 6_000_000);
    const fileName = `накладная-${tag}.pdf`;
    const part = () => Math.floor(Math.random() * 256);
    const client = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { 'x-forwarded-for': `198.18.${part()}.${part()}` },
    });
    const fileId = await sentAndAccepted(client, request, origin, cp, fileName);
    await client.dispose();

    // «Контрагенты» → «…» строки → «Принять оплату за обслуживание»; ответ поиска — до шагов в строке.
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    await page.goto('/app/cps/all');
    await expect(page.locator('[data-grid]')).toBeVisible();
    const found = page.waitForResponse((r) => {
      const url = new URL(r.url());
      return url.pathname === '/api/contractors' && url.searchParams.get('q') === tag;
    });
    await search(page, isMobile, tag);
    expect((await found).status()).toBe(200);
    const cpRow = page.locator(`[data-grid] [data-id="${cp.id}"]`);
    await expect(cpRow).toHaveCount(1);
    await cpRow.locator('[data-row-menu]').click();
    const title = text(texts, 'fee.pay.title');
    await page
      .getByRole('menu', { name: 'Действия' })
      .getByRole('menuitem', { name: new RegExp(reEsc(title)) })
      .click();
    const dialog = page.getByRole('dialog', { name: title });
    await expect(dialog.locator('[data-fee-pay-sum]')).toHaveValue(loose('60 000'));
    const date = await dialog.locator('[data-fee-pay-date]').inputValue();

    await dialog.locator('[data-link-pick]').click();
    const pick = page.getByRole('dialog', { name: text(texts, 'files.pick.title') });
    await expect(pick.locator('[data-file-pick-dialog]')).toBeVisible();
    await pick.locator(`[data-file-pick-row="${fileName}"]`).click();
    await pick.locator('[data-file-pick-ok]').click();
    await expect(pick).toBeHidden();
    await expect(dialog.locator(`[data-link-picked="${fileName}"]`)).toBeVisible();

    const linked = page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/files/links',
    );
    await dialog.locator('[data-fee-ok]').click();
    const linkedRes = await linked;
    expect(linkedRes.status(), await linkedRes.text()).toBe(200);
    const body = linkedRes.request().postDataJSON() as { kind: string; fileIds: string[] };
    expect(body).toMatchObject({ kind: 'fee_payment', fileIds: [fileId] });
    await expect(dialog).toBeHidden();

    // Файл один, у него ссылка на эту оплату; в окне файла «Источник» — «От контрагента · Оплата за
    // обслуживание …».
    const filters = JSON.stringify({ cp: { type: 'enum', vals: [cp.id] } });
    const listed = await request.get(
      `/api/files/manager?size=all&filters=${encodeURIComponent(filters)}`,
      { maxRetries: 2 },
    );
    expect(listed.status(), await listed.text()).toBe(200);
    const rows = (
      (await listed.json()) as { items: { id: string; links: { kind: string; id: string }[] }[] }
    ).items;
    expect(rows.map((r) => [r.id, r.links.map((l) => [l.kind, l.id])])).toEqual([
      [fileId, [['fee_payment', (body as { id?: string }).id]]],
    ]);
    const row = await managerRow(page, isMobile, tag, fileId);
    await row.getByText(fileName, { exact: true }).click();
    const window = await windowSource(page, fileName);
    await expect(window.locator('[data-file-window-src]')).toHaveText(
      loose(
        `${text(texts, 'files.src.sent')} · ${text(texts, 'files.link.src.fee_payment', {
          date: ddmmyyyy(date),
          amount: '60 000 сом',
        })}`,
      ),
    );
  });
});
