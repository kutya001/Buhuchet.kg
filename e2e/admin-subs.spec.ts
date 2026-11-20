import { expect, test, type Page, type Response } from '@playwright/test';
import { E2E_SUBSCRIPTION, ownerPassword, platformAdmin, search, uniqueInn } from './admin';
import { cardTab, uniqueLogin } from './helpers';

// Админка → «Организации» → «Подписки» (доработки 20.11.2026, блок 6, пункты 2–5; прототип v153
// admin/subs-admin.js): окно подписки организации, «Изменить подписку», «Виды подписок», вкладка
// «Подписка» карточки организации и блок «Подписка» окна «Новая организация». «Цены и реквизиты» — общие
// для всей платформы, их меняет только admin-subs-prices.shared.spec.ts. Проверка чека («Подтвердить
// оплату», «Отклонить») ждёт чек владельца с экрана «Подписка» — её тест приходит с общей сборкой этапа 1.

type Created = { organization: { id: string; slug: string } };

/** Своя организация теста с подпиской «Месяц» на `seats` мест (администратор — в `page.request`). */
async function newOrg(page: Page, origin: string, name: string, seats: number) {
  const res = await page.request.post('/api/admin/organizations', {
    headers: { origin },
    data: {
      name,
      inn: uniqueInn(),
      ownerFullName: 'Подпискина Сквозная',
      ownerLogin: uniqueLogin('e2e-sub'),
      temporaryPassword: ownerPassword(),
      subscription: { ...E2E_SUBSCRIPTION, seats },
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as Created).organization;
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

    // Следующее окно — строка организации во вкладке «Подписки»: пакет 20 и «Бесплатный период до …».
    const row = await subsRow(page, isMobile, name);
    await row.click();
    const win = page.getByRole('dialog', { name: 'Подписка организации' });
    const body = win.locator(`[data-sub-body="${org.id}"]`);
    await expect(body).toContainText('Занято 0 из 20');
    await expect(body.locator('[data-sub-pays]')).toContainText('Бесплатный период до');
  });
});
