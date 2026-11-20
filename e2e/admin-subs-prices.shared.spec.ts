import { expect, test } from '@playwright/test';
import { platformAdmin } from './admin';

// «Цены и реквизиты» вкладки «Подписки» Админки (доработки 20.11.2026, блок 6, пункт 6; прототип v153
// `subPricesPart`): общие для всей платформы — поэтому в *.shared (идут после остальных и по одному);
// тест меняет цену за контрагента и в конце возвращает прежние значения.

type Settings = { version: number; seatPrice: number } & Record<string, unknown>;

test('(доработки 20.11.2026, блок 6, пункт 6; прототип v153) «Цены и реквизиты»: пустое обязательное поле не сохраняется; новая цена за контрагента — в истории и в ценах видов подписок', async ({
  page,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  await platformAdmin(page.request, origin);
  const read = async () =>
    (await (await page.request.get('/api/admin/subscription-settings')).json()) as Settings;
  const before = await read();
  // Цена — тыйыны в запросе, сомы на экране.
  const next = before.seatPrice === 11_000 ? 12_000 : 11_000;
  const som = String(next / 100);
  try {
    await page.goto('/app/orgs/subs');
    // Переключатель — после того, как страница ожила: список уже пришёл (typical-mistakes № 41).
    await expect(page.locator('[data-subs-orgs] [data-grid] [data-id]').first()).toBeVisible();
    await page
      .locator('[data-subs-part]')
      .getByRole('button', { name: 'Цены и реквизиты', exact: true })
      .click();
    const part = page.locator('[data-subs-prices]');
    await expect(part.locator('[data-sub-purpose-example]')).toContainText('01234567890123');

    // Пустой «Банк»: «Исправьте отмеченные поля», ошибка и фокус — на поле, ничего не сохранено.
    const bank = part.locator('[data-sub-req="bank"]');
    const bankWas = await bank.inputValue();
    await bank.fill('');
    const ok = part.locator('[data-sub-prices-ok]');
    await ok.click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Исправьте отмеченные поля' }),
    ).toBeVisible();
    await expect(bank).toHaveAttribute('aria-invalid', 'true');
    await expect(bank).toBeFocused();
    expect((await read()).version).toBe(before.version);
    await bank.fill(bankWas);

    await part.locator('[data-sub-price="seatPrice"]').fill(som);
    const saved = page.waitForResponse(
      (r) =>
        r.request().method() === 'PUT' &&
        new URL(r.url()).pathname === '/api/admin/subscription-settings',
    );
    await ok.click();
    expect((await saved).status()).toBe(200);
    await expect(
      page.getByRole('status').filter({ hasText: 'Цены и реквизиты сохранены' }),
    ).toBeVisible();
    await expect(part.locator('[data-sub-cfg-hist]')).toContainText(
      `Цена за контрагента в месяц, сом: ${before.seatPrice / 100} → ${som}`,
    );

    // «Виды подписок»: «Месяц» без скидки за срок — по новой цене.
    await page
      .locator('[data-subs-part]')
      .getByRole('button', { name: 'Виды подписок', exact: true })
      .click();
    await expect(page.locator('[data-subs-kinds] [data-grid] [data-id="m1"]')).toContainText(
      `${som},00`,
    );
  } finally {
    const now = await read();
    if (now.seatPrice !== before.seatPrice) {
      const back = await page.request.put('/api/admin/subscription-settings', {
        headers: { origin },
        data: { ...before, history: undefined, version: now.version },
      });
      expect(back.status(), await back.text()).toBe(200);
    }
  }
});
