import { expect, test } from '@playwright/test';
import { ownerPassword, platformAdmin, search, uniqueInn } from './admin';
import { signIn, uniqueLogin } from './helpers';

// «ИНН и форма» организации (доработки 14.11.2026, блок 1, пункт 4; прототип v114 ldInnFormDlg):
// меняет только администратор платформы — из меню строки «Организаций» или карточки; владелец в
// «Моя организация» видит форму и ИНН только для чтения и меняет ОКПО. Организация — своя у теста.

test.describe('Доработки 14.11.2026, блок 1: «ИНН и форма» организации', () => {
  test('(доработки 14.11.2026, блок 1, пункт 4) администратор платформы меняет форму и ИНН из меню строки «Организаций»: без формы — «Выберите форму», ИНН другой организации — под полем, без изменений — «Изменений нет», сохранённое — в «Истории» карточки; владелец в «Моя организация» видит форму и ИНН только для чтения с подсказкой «Изменить может администратор платформы» и сам меняет ОКПО', async ({
    page,
    browser,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const demo = (
      (await (await page.request.get('/api/admin/organizations?size=all')).json()) as {
        items: { inn: string | null; isDemo: boolean }[];
      }
    ).items.find((o) => o.isDemo)!;
    const owner = uniqueLogin('e2e-inn');
    const temporary = ownerPassword();
    const name = `ОсОО «${uniqueLogin('ИНН')}»`;
    const inn = uniqueInn();
    const created = await page.request.post('/api/admin/organizations', {
      headers: { origin },
      data: {
        name,
        inn,
        ownerFullName: 'Иннова Сквозная',
        ownerLogin: owner,
        temporaryPassword: temporary,
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const toast = page.getByRole('status');

    await page.goto('/app/orgs');
    const rows = page.locator('[data-grid] [data-id]');
    await expect(rows.first()).toBeVisible();
    await search(page, isMobile, name);
    const row = rows.filter({ hasText: name });
    await expect(row).toHaveCount(1);
    const openInnForm = async () => {
      await row.locator('[data-row-menu]').click();
      await page
        .getByRole('menu', { name: 'Действия' })
        .getByRole('menuitem', { name: 'ИНН и форма' })
        .click();
      const dialog = page.getByRole('dialog', { name: 'ИНН и форма организации' });
      await expect(dialog).toContainText('Владелец организации эти поля не меняет');
      return dialog;
    };

    // Форма у организации, созданной без заявки, не задана — «Выберите форму».
    let dialog = await openInnForm();
    const formField = dialog.getByLabel('Форма');
    const innField = dialog.getByLabel('ИНН', { exact: true });
    await expect(innField).toHaveValue(inn);
    await expect(formField).toHaveValue('');
    const save = dialog.getByRole('button', { name: 'Сохранить' });
    await save.click();
    await expect(dialog).toContainText('Выберите форму');

    // ИНН другой организации — ошибка под полем, окно не закрывается.
    await formField.selectOption({ label: 'ИП' });
    await innField.fill(demo.inn!);
    await save.click();
    await expect(dialog).toContainText('Организация с таким ИНН уже есть');
    await expect(innField).toHaveAttribute('aria-invalid', 'true');

    const next = uniqueInn();
    await innField.fill(next);
    // После сохранения список перечитывается: окно из строки открывается по новой версии.
    await Promise.all([
      page.waitForResponse(
        (r) => /\/api\/admin\/organizations\?/.test(r.url()) && r.request().method() === 'GET',
      ),
      save.click(),
    ]);
    await expect(dialog).toBeHidden();
    await expect(toast.filter({ hasText: 'Сохранено' })).toBeVisible();

    // Повторно, ничего не меняя, — «Изменений нет».
    dialog = await openInnForm();
    await expect(dialog.getByLabel('ИНН', { exact: true })).toHaveValue(next);
    await expect(dialog.getByLabel('Форма')).toHaveValue('ip');
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(dialog).toBeHidden();
    await expect(toast.filter({ hasText: 'Изменений нет' })).toBeVisible();

    // Карточка: форма и ИНН в «Основном», изменение — в «Истории» («было → стало»).
    await row.getByText(name).click();
    const card = page.getByRole('dialog', { name });
    await expect(card).toContainText(next);
    await expect(card.getByRole('definition').filter({ hasText: /^ИП$/ })).toBeVisible();
    if (isMobile) {
      await card.getByRole('tab', { selected: true }).click();
      await page.getByRole('menu').getByRole('menuitem', { name: 'История' }).click();
    } else {
      await card.getByRole('tab', { name: 'История' }).click();
    }
    await expect(card.getByRole('list', { name: 'История' })).toContainText(
      `ИНН: ${inn} → ${next}; Форма: ИП`,
    );
    await page.keyboard.press('Escape');

    // Владелец — в своём браузере: форма и ИНН только для чтения, ОКПО меняет сам.
    const ownerContext = await browser.newContext();
    try {
      await signIn(ownerContext.request, origin, owner, temporary);
      const changed = await ownerContext.request.post('/api/auth/password', {
        headers: { origin },
        data: { currentPassword: temporary, newPassword: ownerPassword() },
      });
      expect(changed.status(), await changed.text()).toBe(200);
      const own = await ownerContext.newPage();
      await own.goto('/app/org/main');
      const main = own.locator('main');
      const ownInn = main.getByLabel('ИНН', { exact: true });
      await expect(ownInn).toHaveValue(next);
      await expect(ownInn).toHaveAttribute('readonly', '');
      const ownForm = main.getByLabel('Форма', { exact: true });
      await expect(ownForm).toHaveValue('ip');
      await expect(ownForm).toBeDisabled();
      await expect(main.getByText('Изменить может администратор платформы').first()).toBeVisible();

      const okpo = main.getByLabel('ОКПО', { exact: true });
      await okpo.fill('1234567');
      await main.getByRole('button', { name: 'Сохранить' }).click();
      await expect(main.getByText('Код ОКПО — 8 цифр')).toBeVisible();
      await okpo.fill('12345678');
      await main.getByRole('button', { name: 'Сохранить' }).click();
      await expect(own.getByRole('status').filter({ hasText: 'Сохранено' })).toBeVisible();
      const profile = (await (await ownerContext.request.get('/api/org')).json()) as {
        inn: string | null;
        okpo: string | null;
        legalForm: string | null;
      };
      expect(profile).toMatchObject({ inn: next, okpo: '12345678', legalForm: 'ip' });
    } finally {
      await ownerContext.close();
    }
  });
});
