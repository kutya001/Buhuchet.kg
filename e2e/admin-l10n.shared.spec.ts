import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { platformAdmin, search } from './admin';
import { DEMO_PASSWORD, signIn } from './helpers';

// Админка → «Локализация» (ТЗ «Админка» → «Модуль Локализация»; прототип admin/l10n.js): языки на
// плашках, словарь текстов интерфейса с поиском и правка русского текста без изменения кода. Словарь
// общий для всего сайта, поэтому файл — *.shared.spec.ts: правка не попадает в чужие проверки, а
// прежний текст возвращается в конце теста.

type UiText = { key: string; text: string; version: number };

const NOTE_KEY = 'locale.note';

/** Текст словаря через API администратора: ключ, текст, версия. */
async function uiText(api: APIRequestContext, key: string): Promise<UiText> {
  const res = await api.get(`/api/admin/ui-texts/${key}`);
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as UiText;
}

/** Вернуть прежний текст словаря, если тест его поменял. */
async function restore(api: APIRequestContext, origin: string, before: UiText) {
  const now = await uiText(api, before.key);
  if (now.text === before.text) return;
  const res = await api.put(`/api/admin/ui-texts/${before.key}`, {
    headers: { origin },
    data: { text: before.text, version: now.version },
  });
  expect(res.status(), await res.text()).toBe(200);
}

/** Окно «Текст интерфейса» строки словаря: поиск по ключу и нажатие на строку. */
async function openText(page: Page, isMobile: boolean, key: string) {
  await expect(page.locator('[data-grid] [data-id]').first()).toBeVisible();
  await search(page, isMobile, key);
  const row = page.locator(`[data-grid] [data-id="${key}"]`);
  await expect(row).toHaveCount(1);
  await row.click();
  const dialog = page.getByRole('dialog', { name: 'Текст интерфейса' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(key);
  return dialog;
}

test.describe('Админка: Локализация', () => {
  test('(проверка задачи #96) «Русский — 100 %», словарь с поиском; изменённый текст сразу виден на экране без изменения кода', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const before = await uiText(page.request, NOTE_KEY);
    const changed = `Тексты правятся здесь, без выпуска новой версии (${isMobile ? 'телефон' : 'ПК'}).`;

    try {
      await page.goto('/app/l10n');
      const plates = page.locator('[data-plates]');
      // «Статистика» по умолчанию: на ПК показана, на телефоне скрыта (ТЗ «Статистика модуля»).
      if (isMobile) {
        await expect(plates).toHaveCount(0);
        await page.getByRole('button', { name: 'Статистика' }).click();
      }
      const ru = plates.locator('[data-plate="ru"]');
      await expect(ru).toContainText('Русский');
      await expect(ru).toContainText('100 %');
      await expect(ru).toContainText('язык по умолчанию · включён');
      // Добавление языка заложено, но пока недоступно.
      await expect(plates.locator('[data-plate="add"]')).toBeDisabled();
      await expect(plates.locator('[data-plate="add"]')).toContainText('Добавить язык');
      // Заметка — над списком (тот же текст может быть и в строке словаря).
      await expect(
        page.getByText(before.text).and(page.locator(':not([data-grid] *)')),
      ).toBeVisible();

      const dialog = await openText(page, isMobile, NOTE_KEY);
      await expect(dialog.getByLabel('Русский')).toHaveValue(before.text);
      await expect(dialog).toContainText('Изменение применится без изменения кода');
      await dialog.getByLabel('Русский').fill(changed);
      await dialog.getByRole('button', { name: 'Сохранить' }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByText('Текст сохранён')).toBeVisible();

      // Новый текст — сразу на экране: в заметке над списком (не в строке словаря), прежнего нет.
      await expect(page.getByText(changed).and(page.locator(':not([data-grid] *)'))).toBeVisible();
      await expect(page.getByText(before.text)).toHaveCount(0);
      // И в словаре сайта.
      const dictionary = (await (await page.request.get('/api/l10n')).json()) as {
        texts: Record<string, string>;
      };
      expect(dictionary.texts[NOTE_KEY]).toBe(changed);
      // «Изменил» — администратор платформы, в «Изменено» — время правки.
      const row = page.locator(`[data-grid] [data-id="${NOTE_KEY}"]`);
      await expect(row).toContainText(changed);
      const saved = await uiText(page.request, NOTE_KEY);
      expect(saved).toMatchObject({ text: changed, version: before.version + 1 });
    } finally {
      await restore(page.request, origin, before);
    }
  });

  test('(проверка задачи #96) подстановки {…} остаются: без {n} текст не сохраняется; сотрудник организации словарь не меняет', async ({
    page,
    baseURL,
    isMobile,
    playwright,
  }) => {
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const before = await uiText(page.request, 'locale.count.many');
    expect(before.text).toContain('{n}');

    await page.goto('/app/l10n');
    const dialog = await openText(page, isMobile, 'locale.count.many');
    const field = dialog.getByLabel('Русский');
    await field.fill('много строк');
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(
      dialog.getByText('Подстановки в тексте должны остаться прежними: {n}'),
    ).toBeVisible();
    await expect(field).toBeFocused();
    await field.fill('   ');
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(dialog.getByText('Введите текст')).toBeVisible();
    await dialog.getByRole('button', { name: 'Отмена' }).click();
    await expect(dialog).toBeHidden();
    expect(await uiText(page.request, 'locale.count.many')).toEqual(before);

    // Организации и обычные сотрудники в модуле ничего не меняют (ТЗ): владельцу демо-организации
    // сервер отказывает и в списке, и в правке.
    const owner = await playwright.request.newContext({ baseURL });
    try {
      await signIn(owner, origin, 'erkin', DEMO_PASSWORD);
      expect((await owner.get('/api/admin/ui-texts')).status()).toBe(403);
      const put = await owner.put('/api/admin/ui-texts/locale.count.many', {
        headers: { origin },
        data: { text: 'Взлом {n}', version: before.version },
      });
      expect(put.status()).toBe(403);
    } finally {
      await owner.dispose();
    }
    expect(await uiText(page.request, 'locale.count.many')).toEqual(before);
  });
});
