import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { DEMO_PASSWORD, settledBox, signIn } from './helpers';

// Деньги: реквизиты для переводов (задача 2.18). Счета организации общие для всей демо-организации,
// а «Основной» меняется и у соседних счетов, поэтому файл *.shared.spec.ts — по одному, сначала на ПК,
// потом на телефоне. Счета организации и реквизиты Мээрим возвращаются как были.

test.describe.configure({ mode: 'serial' });

type OrgAccount = {
  id: string;
  kind: 'acc' | 'phone';
  bankCode: string | null;
  accountNo: string | null;
  bik: string | null;
  phone: string | null;
  phoneBanks: string[];
  holderName: string;
  purpose: 'both' | 'tax' | 'fee';
  mainTax: boolean;
  mainFee: boolean;
  version: number;
};

type Wallet = Omit<OrgAccount, 'bik' | 'purpose' | 'mainTax' | 'mainFee'> & {
  employeeId: string;
  isMain: boolean;
};

async function accounts(api: APIRequestContext) {
  const res = await api.get('/api/org/accounts');
  expect(res.status()).toBe(200);
  return ((await res.json()) as { items: OrgAccount[] }).items;
}

async function wallets(api: APIRequestContext) {
  const res = await api.get('/api/profile/wallets');
  expect(res.status()).toBe(200);
  return ((await res.json()) as { items: Wallet[] }).items;
}

/** Счета организации как до теста: лишние удалить, у прежних вернуть поля и «Основной». */
async function restoreAccounts(api: APIRequestContext, origin: string, before: OrgAccount[]) {
  for (const a of await accounts(api)) {
    if (before.some((b) => b.id === a.id)) continue;
    const res = await api.delete(`/api/org/accounts/${a.id}?version=${a.version}`, {
      headers: { origin },
    });
    expect(res.status(), await res.text()).toBe(200);
  }
  for (const { id, version: _old, ...fields } of before) {
    const now = (await accounts(api)).find((a) => a.id === id)!;
    const res = await api.patch(`/api/org/accounts/${id}`, {
      headers: { origin },
      data: { ...fields, version: now.version },
    });
    expect(res.status(), await res.text()).toBe(200);
  }
}

/** Свои реквизиты как до теста. */
async function restoreWallets(api: APIRequestContext, origin: string, before: Wallet[]) {
  for (const w of await wallets(api)) {
    if (before.some((b) => b.id === w.id)) continue;
    const res = await api.delete(`/api/profile/wallets/${w.id}?version=${w.version}`, {
      headers: { origin },
    });
    expect(res.status(), await res.text()).toBe(200);
  }
  for (const { id, version: _old, employeeId: _emp, ...fields } of before) {
    const now = (await wallets(api)).find((w) => w.id === id)!;
    const res = await api.patch(`/api/profile/wallets/${id}`, {
      headers: { origin },
      data: { ...fields, version: now.version },
    });
    expect(res.status(), await res.text()).toBe(200);
  }
}

/** Строка (на телефоне — карточка) маленькой таблицы с текстом. */
const row = (page: Page, text: string) =>
  page.locator('[data-mini-table] tbody tr').filter({ hasText: text });

const toast = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

test.describe('Этап 2. Деньги: реквизиты организации и сотрудников', () => {
  test('(п. 67) владелец добавляет счёт «Перевод по номеру телефона» 0555 123 456 (M-Bank, Бакай Банк), отмечает основным для налогов, меняет и удаляет', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    const before = await accounts(page.request);
    try {
      await page.goto('/app/org/main');
      await page.getByRole('button', { name: 'Добавить счёт' }).click();
      const dialog = page.getByRole('dialog', { name: 'Счёт организации' });
      await settledBox(dialog);
      // Получатель по умолчанию — название организации; вид — плашками.
      await expect(dialog.getByLabel('Получатель')).toHaveValue('ОсОО «Бухгалтер Плюс»');
      await dialog.getByRole('button', { name: 'Перевод по номеру телефона' }).click();
      await dialog.getByRole('button', { name: 'Добавить', exact: true }).click();
      await expect(dialog).toContainText('Введите номер полностью: 9 цифр после кода страны');
      await expect(dialog).toContainText('Отметьте хотя бы один банк или кошелёк');

      await dialog.getByLabel('Номер телефона').fill('555123456');
      await dialog.getByRole('checkbox', { name: 'M-Bank' }).check();
      await dialog.getByRole('checkbox', { name: 'Бакай Банк' }).check();
      // В списке банков номера — только провайдеры с переводами по номеру телефона.
      await expect(dialog.getByRole('checkbox', { name: 'Банк Азии' })).toHaveCount(0);
      await dialog.getByRole('switch', { name: /Основной для налогов/ }).check();
      await dialog.getByRole('button', { name: 'Добавить', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(toast(page, 'Счёт добавлен')).toBeVisible();

      // Новый счёт — основной для налогов; у прежнего основного отметка снята. Банки номера — по
      // порядку справочника.
      const added = row(page, '0555 123 456');
      await expect(added).toContainText('Перевод по номеру телефона');
      await expect(added).toContainText('Бакай Банк, M-Bank');
      await expect(added).toContainText('Налоги и обслуживание');
      await expect(added).toContainText('Основной для налогов');
      await expect(row(page, 'Optima Bank')).not.toContainText('Основной для налогов');

      await added.getByRole('button', { name: 'Изменить счёт' }).click();
      const edit = page.getByRole('dialog', { name: 'Изменить счёт организации' });
      await settledBox(edit);
      await expect(edit.getByLabel('Номер телефона')).toHaveValue('555 123 456');
      await edit.getByLabel('Получатель').fill('Садыков Э.');
      await edit.getByRole('button', { name: 'Сохранить' }).click();
      await expect(edit).toBeHidden();
      await expect(toast(page, 'Счёт изменён')).toBeVisible();
      await expect(row(page, '0555 123 456')).toContainText('Садыков Э.');

      await row(page, '0555 123 456').getByRole('button', { name: 'Удалить счёт' }).click();
      const confirm = page.getByRole('dialog', { name: /Удалить счёт/ });
      await confirm.getByRole('button', { name: 'Удалить' }).click();
      await expect(toast(page, 'Счёт удалён')).toBeVisible();
      await expect(row(page, '0555 123 456')).toHaveCount(0);
    } finally {
      await restoreAccounts(page.request, origin, before);
    }
  });

  test('без права «Настройки и учётная политика» счета организации видны только для просмотра', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    await signIn(page.request, origin, 'meerim', DEMO_PASSWORD);
    await page.goto('/app/org/main');
    await expect(row(page, 'Optima Bank')).toContainText('Основной для налогов');
    await expect(page.getByRole('button', { name: 'Добавить счёт' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Изменить счёт' })).toHaveCount(0);
    // Сервер тоже не даёт: у главного бухгалтера нет права «Настройки и учётная политика».
    const res = await page.request.post('/api/org/accounts', {
      headers: { origin },
      data: {
        kind: 'phone',
        bankCode: null,
        accountNo: null,
        bik: null,
        phone: '+996555123456',
        phoneBanks: ['БНК-13'],
        holderName: '',
        purpose: 'both',
        mainTax: false,
        mainFee: false,
      },
    });
    expect(res.status()).toBe(403);
  });

  test('«Мои реквизиты для переводов»: сотрудник добавляет перевод по номеру и делает его основным; владелец видит реквизиты в карточке сотрудника, бухгалтер без права «Деньги» по всем — нет', async ({
    page,
    browser,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await signIn(page.request, origin, 'meerim', DEMO_PASSWORD);
    const me = (await (await page.request.get('/api/auth/me')).json()) as {
      employee: { id: string; fullName: string };
    };
    const before = await wallets(page.request);
    try {
      await page.goto('/app/home/today');
      if (isMobile) {
        await page.getByRole('button', { name: 'Меню' }).click();
        await page.getByRole('button', { name: /^Мой профиль/ }).click();
      } else {
        await page.getByRole('button', { name: 'Мой профиль' }).click();
      }
      const profile = page.getByRole('dialog', { name: 'Мой профиль' });
      await settledBox(profile);
      await expect(row(page, 'Optima Bank')).toContainText('Основной');

      await profile.getByRole('button', { name: 'Добавить', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Новый реквизит' });
      await settledBox(dialog);
      await expect(dialog.getByLabel('Имя получателя')).toHaveValue('Мээрим К.');
      await dialog.getByRole('button', { name: 'Перевод по номеру телефона' }).click();
      await dialog.getByLabel('Номер телефона').fill('700330441');
      await dialog.getByRole('checkbox', { name: 'О!Деньги' }).check();
      await dialog.getByRole('button', { name: 'Добавить', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(toast(page, 'Реквизит добавлен')).toBeVisible();

      // Второй реквизит — не основной; «Сделать основным» переносит отметку.
      const added = row(page, '0700 330 441');
      await expect(added).toContainText('О!Деньги');
      await added.getByRole('button', { name: 'Сделать основным' }).click();
      await expect(added).toContainText('Основной');
      await expect(
        row(page, 'Optima Bank').getByRole('button', { name: 'Сделать основным' }),
      ).toBeVisible();

      // Владелец видит реквизиты Мээрим в её карточке.
      const owner = await browser.newContext({ baseURL });
      const ownerPage = await owner.newPage();
      await signIn(ownerPage.request, origin, 'erkin', DEMO_PASSWORD);
      const seen = await ownerPage.request.get(`/api/staff/${me.employee.id}/wallets`);
      expect(seen.status()).toBe(200);
      expect(JSON.stringify(await seen.json())).toContain('+996700330441');
      await ownerPage.goto('/app/staff/list');
      await ownerPage
        .locator('[data-grid] [data-id]')
        .filter({ hasText: me.employee.fullName })
        .getByText(me.employee.fullName)
        .click();
      const card = ownerPage.getByRole('dialog', { name: me.employee.fullName });
      await expect(card).toContainText('Реквизиты для переводов');
      await expect(card).toContainText('0700 330 441');
      await owner.close();

      // Бухгалтеру без права «Деньги» по всем контрагентам чужие реквизиты не отдаются.
      const colleague = await browser.newContext({ baseURL });
      await signIn(colleague.request, origin, 'alisher', DEMO_PASSWORD);
      expect((await colleague.request.get(`/api/staff/${me.employee.id}/wallets`)).status()).toBe(
        403,
      );
      await colleague.close();

      await added.getByRole('button', { name: 'Удалить реквизит' }).click();
      await page
        .getByRole('dialog', { name: 'Удалить реквизит?' })
        .getByRole('button', { name: 'Удалить' })
        .click();
      await expect(toast(page, 'Реквизит удалён')).toBeVisible();
      await expect(row(page, '0700 330 441')).toHaveCount(0);
    } finally {
      await restoreWallets(page.request, origin, before);
    }
  });
});
