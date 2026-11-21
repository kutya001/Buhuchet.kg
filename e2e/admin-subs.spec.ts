import { randomBytes } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page, type Response } from '@playwright/test';
import {
  ADMIN_PASSWORD,
  E2E_SUBSCRIPTION,
  ownerPassword,
  platformAdmin,
  search,
  uniqueInn,
} from './admin';
import { cardTab, signIn, uniqueLogin } from './helpers';

// Админка → «Организации» → «Подписки» (доработки 20.11.2026, блок 6, пункты 2–5; прототип v153
// admin/subs-admin.js): окно подписки организации, «Изменить подписку», «Виды подписок», вкладка
// «Подписка» карточки организации и блок «Подписка» окна «Новая организация». «Цены и реквизиты» — общие
// для всей платформы, их меняет только admin-subs-prices.shared.spec.ts. Проверка чека («Подтвердить
// оплату», «Отклонить») — с чеком, который владелец прикрепил на экране «Подписка» (поток И, общая сборка
// этапа 1).

type Created = { organization: { id: string; slug: string } };

/**
 * Своя организация теста с оплаченной подпиской «Месяц» на `seats` мест (администратор — в `page.request`):
 * не бесплатный период — иначе «Вид подписки» в строке — «Бесплатный период».
 */
async function newOrg(page: Page, origin: string, name: string, seats: number) {
  const ownerLogin = uniqueLogin('e2e-sub');
  const temporaryPassword = ownerPassword();
  const res = await page.request.post('/api/admin/organizations', {
    headers: { origin },
    data: {
      name,
      inn: uniqueInn(),
      ownerFullName: 'Подпискина Сквозная',
      ownerLogin,
      temporaryPassword,
      subscription: { ...E2E_SUBSCRIPTION, seats, free: false },
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return { ...((await res.json()) as Created).organization, ownerLogin, temporaryPassword };
}

/** Тексты словаря интерфейса (`GET /api/l10n`): тест не копирует строки экрана владельца. */
async function dictionary(api: APIRequestContext): Promise<Record<string, string>> {
  const res = await api.get('/api/l10n');
  expect(res.status()).toBe(200);
  return ((await res.json()) as { texts: Record<string, string> }).texts;
}

/** Чек PDF: тип проверяется по содержимому — первые байты «%PDF-». */
const PDF = Buffer.from('%PDF-1.4\n% e2e\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

/**
 * Владелец на экране «Подписка» (поток И): «Продлить» («Прикрепить другой чек» — `again`) на «3 месяца»
 * с чеком PDF → «Отправить на проверку». Отвечает номером оплаты.
 */
async function ownerSendsReceipt(page: Page, receipt: string, again = false): Promise<string> {
  await page.goto('/app/org/sub');
  const screen = page.locator('[data-sub-screen="own"]');
  await screen.locator(again ? '[data-sub-again-open]' : '[data-sub-pay-open="renew"]').click();
  const form = page.locator('[data-sub-pay="renew"]');
  await form.locator('[data-sub-kind="m3"]').click();
  await expect(form.locator('[data-sub-kind="m3"]')).toHaveAttribute('aria-checked', 'true');
  await form
    .locator('[data-sub-drop] input[type="file"]')
    .setInputFiles({ name: receipt, mimeType: 'application/pdf', buffer: PDF });
  await expect(form.locator('[data-sub-file]')).toContainText(receipt);
  const sent = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      new URL(r.url()).pathname === '/api/org/subscription/payments/complete',
  );
  await page.locator('[data-sub-pay-send]').click();
  const res = await sent;
  expect(res.status()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** Смена входа — после ухода со страницы (e2e-test: открытая страница не шлёт запросов чужим входом). */
async function switchTo(page: Page, origin: string, login: string, password: string) {
  await page.goto('about:blank');
  await page.request.post('/api/auth/logout', { headers: { origin } });
  await signIn(page.request, origin, login, password);
}

const subsListWith = (q: string) => (r: Response) => {
  const url = new URL(r.url());
  return url.pathname === '/api/admin/subscriptions' && url.searchParams.get('q') === q && r.ok();
};

/** Своя строка списка «Организации» вкладки «Подписки» — после ответа поиска (typical-mistakes № 27). */
async function subsRow(page: Page, isMobile: boolean, name: string) {
  await page.goto('/app/orgs/subs');
  const grid = page.locator('[data-subs-orgs] [data-grid]');
  await expect(grid.locator('[data-id]').first()).toBeVisible();
  const found = page.waitForResponse(subsListWith(name));
  await search(page, isMobile, name);
  await found;
  const row = grid.locator('[data-id]').filter({ hasText: name });
  await expect(row).toHaveCount(1);
  return row;
}

test.describe('Админка → «Подписки»', () => {
  test('(доработки 20.11.2026, блок 6, пункты 3–4; прототип v153) строка открывает окно подписки; «Изменить подписку» без причины не сохраняется, «Дополнительная скидка» — при пакете больше 150; изменение — в истории подписки и организации', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const name = `ОсОО «${uniqueLogin('Подписка')}»`;
    const org = await newOrg(page, origin, name, 150);

    const row = await subsRow(page, isMobile, name);
    await expect(row).toContainText('Месяц');
    await row.click();
    const win = page.getByRole('dialog', { name: 'Подписка организации' });
    await expect(win.locator(`[data-sub-body="${org.id}"]`)).toBeVisible();
    await expect(win).toContainText(name);

    // «Изменить подписку»: при пакете 150 дополнительная скидка недоступна, при 160 — доступна.
    await win.locator('[data-sub-edit]').click();
    const edit = page.getByRole('dialog', { name: 'Изменить подписку' });
    const form = edit.locator(`[data-sub-edit-form="${org.id}"]`);
    await expect(form).toBeVisible();
    const pack = form.getByLabel(/^Пакет, мест/);
    const extra = form.getByLabel('Дополнительная скидка, %', { exact: true });
    await expect(pack).toHaveValue('150');
    await expect(extra).toBeDisabled();
    await pack.fill('160');
    await expect(extra).toBeEnabled();
    await extra.fill('5');

    // Без причины — ошибка под полем, окно открыто, подписка не изменилась.
    const ok = edit.locator('[data-sub-edit-ok]');
    await ok.click();
    await expect(form).toContainText('Укажите причину');
    await expect(edit).toBeVisible();

    const reason = `Оплата наличными ${uniqueLogin('e2e')}`;
    await form.getByLabel(/^Причина изменения/).fill(reason);
    const saved = page.waitForResponse(
      (r) =>
        r.request().method() === 'PUT' &&
        new URL(r.url()).pathname === `/api/admin/subscriptions/${org.id}`,
    );
    await ok.click();
    expect((await saved).status()).toBe(200);
    await expect(edit).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'Подписка изменена' })).toBeVisible();
    const hist = win.locator('[data-sub-hist]');
    await expect(hist).toContainText('Пакет: 150 → 160');
    await expect(hist).toContainText(`Причина: ${reason}`);

    // Карточка организации: состояние подписки в шапке открывает вкладку «Подписка», изменение — в «Истории».
    await page.goto(`/app/orgs#orgs/${org.slug}`);
    const card = page.getByRole('dialog').filter({ has: page.locator('[data-org-card]') });
    await expect(card).toContainText(name);
    await card.locator('[data-org-states] [data-org-sub]').click();
    await expect(card.getByRole('tab', { selected: true })).toContainText('Подписка');
    await expect(card.locator(`[data-sub-body="${org.id}"]`)).toContainText('Месяц');
    await cardTab(page, card, isMobile, 'История');
    await expect(card).toContainText('Пакет: 150 → 160');
    await expect(card).toContainText(`Причина: ${reason}`);
  });

  test('(доработки 20.11.2026, блок 6, пункт 5; прототип v153) «Виды подписок»: новый вид со скидкой и преимуществами — в списке с ценой; «Выключить», «Удалить» с подтверждением', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const kind = `24 месяца ${uniqueLogin('e2e')}`;

    await page.goto('/app/orgs/subs');
    // Переключатель — после того, как страница ожила: список уже пришёл (typical-mistakes № 41).
    await expect(page.locator('[data-subs-orgs] [data-grid] [data-id]').first()).toBeVisible();
    await page
      .locator('[data-subs-part]')
      .getByRole('button', { name: 'Виды подписок', exact: true })
      .click();
    const part = page.locator('[data-subs-kinds]');
    await expect(part.locator('[data-grid] [data-id]').first()).toBeVisible();
    await part.locator('[data-sub-kind-add]').click();
    const dialog = page.getByRole('dialog', { name: 'Новый вид подписки' });
    const form = dialog.locator('[data-sub-kind-form]');
    await form.getByLabel(/^Название/).fill(kind);
    await form.getByLabel(/^Срок, месяцев/).fill('24');
    await form.getByLabel(/^Скидка, %/).fill('25');
    await form
      .getByLabel('Преимущества', { exact: true })
      .fill('Скидка 25 %\nПриоритетная поддержка');
    await dialog.locator('[data-sub-kind-ok]').click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole('status').filter({ hasText: 'Вид подписки добавлен' }),
    ).toBeVisible();
    await expect(part.locator('[data-sub-cfg-hist]')).toContainText(
      `Виды подписок: добавлен «${kind}» — 24 мес., скидка 25 %`,
    );

    // Своя строка — поиском по названию (список видов фильтруется в браузере).
    await search(page, isMobile, kind);
    const row = part.locator('[data-grid] [data-id]').filter({ hasText: kind });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Да');

    const menu = page.getByRole('menu', { name: 'Действия' });
    await row.locator('[data-row-menu]').click();
    await menu.getByRole('menuitem', { name: 'Выключить' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Вид выключен: новые оплаты по нему недоступны' }),
    ).toBeVisible();
    await expect(row).toContainText('Нет');
    await expect(part.locator('[data-sub-cfg-hist]')).toContainText(`«${kind}» — выключен`);

    await row.locator('[data-row-menu]').click();
    await menu.getByRole('menuitem', { name: 'Удалить' }).click();
    const ask = page.getByRole('dialog', { name: `Удалить вид «${kind}»?` });
    await ask.getByRole('button', { name: 'Удалить' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Вид удалён' })).toBeVisible();
    await expect(row).toHaveCount(0);
    await expect(part.locator('[data-sub-cfg-hist]')).toContainText(
      `Виды подписок: «${kind}» удалён`,
    );
  });

  test('(доработки 20.11.2026, блок 6, пункт 4; прототип v153) «Новая организация»: блок «Подписка» свёрнут; «Поставить подписку сразу» проверяет поля и ставит бесплатный период', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    await page.goto('/app/orgs');
    await expect(page.locator('[data-grid] [data-id]').first()).toBeVisible();

    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    const form = page.getByRole('dialog', { name: 'Новая организация' });
    const name = `ОсОО «${uniqueLogin('Сразу')}»`;
    const inn = uniqueInn();
    await form.getByLabel('Название').fill(name);
    await form.getByLabel('ИНН').fill(inn);
    await form.getByLabel('ФИО владельца').fill('Подпискин Сквозной');
    await form.getByLabel('Логин владельца').fill(uniqueLogin('e2e-sub'));

    const block = form.locator('[data-new-org-sub]');
    await expect(block).not.toHaveAttribute('open');
    await block.locator('summary').click();
    await block.locator('[data-new-org-sub-on]').check();
    await expect(block.locator('[data-new-org-sub-free]')).toBeChecked();

    // Неверный пакет — ошибка под полем, организация не создана.
    const pack = block.getByLabel(/^Пакет, мест/);
    await pack.fill('15');
    const create = form.getByRole('button', { name: 'Создать' });
    await create.click();
    await expect(block).toContainText('Пакет — число мест с шагом 10');
    await expect(form).toBeVisible();

    await pack.fill('20');
    const created = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/admin/organizations',
    );
    await create.click();
    expect((await created).status()).toBe(201);
    await expect(form).toBeHidden();

    // Подписка поставлена: пакет 20 и строка «Бесплатный период» в «Истории оплат».
    const orgs = (await (
      await page.request.get('/api/admin/organizations?size=all', { maxRetries: 2 })
    ).json()) as { items: { id: string; inn: string | null }[] };
    const org = orgs.items.find((o) => o.inn === inn)!;
    expect(org).toBeTruthy();
    const sub = (await (
      await page.request.get(`/api/admin/subscriptions/${org.id}`, { maxRetries: 2 })
    ).json()) as {
      sub: { seats: number } | null;
      payments: { kind: string }[];
    };
    expect(sub.sub?.seats).toBe(20);
    expect(sub.payments.map((p) => p.kind)).toEqual(['free']);

    // Следующее окно — строка организации во вкладке «Подписки»: пакет 20 и «Бесплатный период» в
    // «Истории оплат» экрана «Подписка» (в окне — экран владельца без кнопок оплаты).
    const row = await subsRow(page, isMobile, name);
    await row.click();
    const win = page.getByRole('dialog', { name: 'Подписка организации' });
    const body = win.locator(`[data-sub-body="${org.id}"]`);
    await expect(body).toContainText('Занято 0 из 20');
    await expect(body.locator('[data-sub-screen="admin"] [data-sub-pays]')).toContainText(
      'Бесплатный период',
    );
  });

  test('(доработки 20.11.2026, блок 6, пункт 3; блок 5; прототип v153–v154) чек владельца: в окне подписки — первым, открывается в окне просмотра файлов; «Отклонить» с причиной — владелец видит причину и прикрепляет другой чек; «Подтвердить оплату» — подписка продлена, у владельца — «Оплата подтверждена» в колокольчике', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    // Длинный сценарий: свой администратор, шесть смен входа, два чека через окно оплаты.
    test.slow();
    const origin = new URL(baseURL!).origin;
    const admin = await platformAdmin(page.request, origin);
    const name = `ОсОО «${uniqueLogin('Чек')}»`;
    const org = await newOrg(page, origin, name, 10);

    // Владелец задаёт свой пароль и отправляет чек на экране «Подписка».
    const ownPassword = 'Свой-пароль-e2e-1';
    await switchTo(page, origin, org.ownerLogin, org.temporaryPassword);
    const changed = await page.request.post('/api/auth/password', {
      headers: { origin },
      data: { currentPassword: org.temporaryPassword, newPassword: ownPassword },
    });
    expect(changed.status(), await changed.text()).toBe(200);
    const texts = await dictionary(page.request);
    const first = `чек-${randomBytes(3).toString('hex')}.pdf`;
    const firstId = await ownerSendsReceipt(page, first);

    // Администратор: колокольчик «Новый чек на проверку» открывает окно организации и тогда, когда
    // выбраны «Виды подписок» (прототип `subBellGo` → `subOrgWin`).
    await switchTo(page, origin, admin, ADMIN_PASSWORD);
    await page.goto('/app/orgs/subs');
    await expect(page.locator('[data-subs-orgs] [data-grid] [data-id]').first()).toBeVisible();
    await page
      .locator('[data-subs-part]')
      .getByRole('button', { name: 'Виды подписок', exact: true })
      .click();
    await expect(page.locator('[data-subs-kinds]')).toBeVisible();
    await page.locator('[data-bell]').click();
    await page.locator('[data-bell-panel] [data-bell-row]').filter({ hasText: name }).click();
    const linked = page.getByRole('dialog', { name: 'Подписка организации' });
    await expect(linked.locator(`[data-sub-body="${org.id}"]`)).toBeVisible();
    await expect(page.locator('[data-subs-part]')).toHaveAttribute('data-subs-part', 'orgs');
    await page.keyboard.press('Escape');
    await expect(linked).toBeHidden();

    // Чек на проверке — первым в окне, открывается в окне просмотра файлов.
    const win = async () => {
      const row = await subsRow(page, isMobile, name);
      await row.click();
      const dialog = page.getByRole('dialog', { name: 'Подписка организации' });
      await expect(dialog.locator(`[data-sub-body="${org.id}"]`)).toBeVisible();
      return dialog;
    };
    let dialog = await win();
    const wait = dialog.locator(`[data-sub-wait="${firstId}"]`);
    await expect(wait).toBeVisible();
    await expect(dialog.locator('[data-sub-wait], [data-sub-screen]').first()).toHaveAttribute(
      'data-sub-wait',
      firstId,
    );
    await wait.locator(`[data-sub-receipt="${firstId}"]`).click();
    const viewer = page.getByRole('dialog', { name: first });
    await expect(viewer.locator(`[data-file-viewer="${firstId}"]`)).toBeVisible();
    // Окно прочитало чек по ссылке Админки «Файлы» (`/api/admin/files/receipt/{id}/link`).
    await expect(viewer.locator('[data-fv="pdf"] iframe')).toHaveAttribute('src', /^blob:/);
    await page.keyboard.press('Escape');
    await expect(viewer).toBeHidden();

    // «Отклонить» без причины не уходит; с причиной — «Чек отклонён, владельцы получили сообщение».
    await wait.locator(`[data-sub-reject="${firstId}"]`).click();
    const reject = page.getByRole('dialog', { name: 'Отклонить чек' });
    await reject.locator('[data-sub-rej-ok]').click();
    await expect(reject).toContainText('Укажите причину');
    const reason = `Сумма в чеке не та ${randomBytes(2).toString('hex')}`;
    await reject.getByLabel('Причина').fill(reason);
    await reject.locator('[data-sub-rej-ok]').click();
    await expect(page.getByRole('status').filter({ hasText: 'Чек отклонён' })).toBeVisible();
    await expect(dialog.locator(`[data-sub-wait="${firstId}"]`)).toHaveCount(0);

    // Владелец видит причину и прикрепляет другой чек.
    await switchTo(page, origin, org.ownerLogin, ownPassword);
    await page.goto('/app/org/sub');
    await expect(page.locator('[data-sub-screen="own"] [data-sub-again]')).toContainText(reason);
    const second = `чек-${randomBytes(3).toString('hex')}.pdf`;
    const secondId = await ownerSendsReceipt(page, second, true);
    expect(secondId).not.toBe(firstId);

    // Администратор: «Подтвердить оплату» — подписка продлена на 3 месяца.
    await switchTo(page, origin, admin, ADMIN_PASSWORD);
    dialog = await win();
    await dialog.locator(`[data-sub-confirm="${secondId}"]`).click();
    const confirm = page.getByRole('dialog', { name: 'Подтвердить оплату' });
    const decided = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        new URL(r.url()).pathname === `/api/admin/subscriptions/payments/${secondId}/confirm`,
    );
    await confirm.locator('[data-sub-ok]').click();
    expect((await decided).status()).toBe(200);
    await expect(page.getByRole('status').filter({ hasText: 'Оплата подтверждена' })).toBeVisible();
    await expect(dialog.locator('[data-sub-wait]')).toHaveCount(0);
    const card = (await (
      await page.request.get(`/api/admin/subscriptions/${org.id}`, { maxRetries: 2 })
    ).json()) as {
      sub: { planId: string; paidUntil: string } | null;
      payments: { id: string; status: string }[];
    };
    expect(card.sub?.planId).toBe('m3');
    expect(card.payments.find((p) => p.id === secondId)?.status).toBe('confirmed');
    expect(card.payments.find((p) => p.id === firstId)?.status).toBe('rejected');

    // Владелец: в колокольчике — «Чек отклонён» и «Оплата подтверждена» (Telegram у него не привязан).
    await switchTo(page, origin, org.ownerLogin, ownPassword);
    const bell = (await (await page.request.get('/api/bell', { maxRetries: 2 })).json()) as {
      items: { event: string; text: string }[];
    };
    const subRows = bell.items.filter((x) => x.event === 'sub').map((x) => x.text);
    expect(subRows.some((x) => x.includes(reason))).toBe(true);
    // «Оплата подтверждена» — с новым «Оплачено до» (шаблон `tgSubPaid` можно менять, дата — нет).
    const until = card.sub!.paidUntil.split('-').reverse().join('.');
    expect(subRows.some((x) => x.includes(until) && !x.includes(reason))).toBe(true);
    await page.goto('/app/org/sub');
    await expect(page.locator('[data-sub-screen="own"] [data-sub-top]')).toContainText(
      texts['sub.st.active']!,
    );
  });
});
