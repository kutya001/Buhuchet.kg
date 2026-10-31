import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { platformAdmin, search } from './admin';

// Админка → «Справочники платформы»: вкладка «ГКЭД» (задача 2.38; прототип admin/gked-admin.js) и
// «Отметить сверку с ГНС» у отмеченных видов отчётов (задача 2.37, часть 3; прототип markGns).
// Справочники общие для всей платформы, поэтому файл — *.shared.spec.ts; добавленный код в конце
// удаляется.

type Gked = { code: string; name: string; version: number; parentCode: string | null };

async function gkedItems(api: APIRequestContext): Promise<Gked[]> {
  const res = await api.get('/api/admin/platform-gked/items');
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { items: Gked[] }).items;
}

/** Удалить код, если тест его оставил (упал посередине). */
async function cleanup(api: APIRequestContext, origin: string, code: string) {
  const x = (await gkedItems(api)).find((v) => v.code === code);
  if (!x) return;
  await api.delete(`/api/admin/platform-dicts/gked/${encodeURIComponent(code)}`, {
    headers: { origin },
    params: { version: x.version },
  });
}

/** Сегодня по Бишкеку — «ДД.ММ.ГГГГ». */
function todayRu(): string {
  const d = new Date(Date.now() + 6 * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

/** Строка дерева ГКЭД по коду. */
const treeRow = (page: Page, code: string) => page.locator(`[data-gked-row="${code}"]`);

test.describe('Админка: ГКЭД и сверка с ГНС', () => {
  test('(проверка задачи #94) новый код ГКЭД появляется в дереве под своим кодом верхнего уровня, ищется по коду и удаляется, пока не используется', async ({
    page,
    baseURL,
  }, testInfo) => {
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    // Свой код на каждый проект: в базе стенда тесты идут по очереди.
    const code = testInfo.project.name.startsWith('mobile') ? '69.20.7' : '69.20.6';
    const name = `Проверка кода ${testInfo.project.name} ${Date.now()}`;
    await cleanup(page.request, origin, code);

    try {
      await page.goto('/app/pdicts/gked');
      const search = page.getByRole('textbox', { name: 'Поиск по ГКЭД' });
      await expect(search).toBeVisible();
      // Группы кодов — над деревом, у каждой «Изменить».
      await expect(page.getByText('Группы кодов', { exact: false }).first()).toBeVisible();

      // «+ Добавить» → «Код ГКЭД»: без кода и названия — ошибки под полями.
      await page.getByRole('button', { name: 'Добавить', exact: true }).click();
      await page
        .getByRole('menu', { name: 'Добавить' })
        .getByRole('menuitem', { name: 'Код ГКЭД' })
        .click();
      const dialog = page.getByRole('dialog', { name: 'Новый код ГКЭД' });
      await dialog.getByRole('button', { name: 'Сохранить' }).click();
      await expect(dialog).toContainText('Введите код');
      await expect(dialog).toContainText('Укажите код верхнего уровня');

      await dialog.getByLabel(/^Код/).fill(code);
      await dialog.getByLabel('Название').fill(name);
      await dialog.getByLabel('Входит в (код верхнего уровня)').fill('69.20');
      await expect(dialog).toContainText('Деятельность в области бухгалтерского учета и аудита');
      await dialog.getByRole('button', { name: 'Сохранить' }).click();
      await expect(dialog).toBeHidden();
      expect((await gkedItems(page.request)).find((x) => x.code === code)).toMatchObject({
        name,
        parentCode: '69.20',
      });

      // Поиск по коду — совпадение с путём.
      await search.fill(code);
      const found = treeRow(page, code);
      await expect(found).toContainText(name);
      await expect(found).toContainText('69.20');

      // Удалить — новый код нигде не указан и без вложенных.
      await found.locator('[data-row-menu]').click();
      await page
        .getByRole('menu', { name: 'Действия' })
        .getByRole('menuitem', { name: 'Удалить' })
        .click();
      await page
        .getByRole('dialog', { name: `Удалить код ${code}?` })
        .getByRole('button', { name: 'Удалить' })
        .click();
      await expect(found).toBeHidden();
      expect((await gkedItems(page.request)).some((x) => x.code === code)).toBe(false);

      // «Список» запоминается: после перезагрузки вкладка открывается списком.
      await search.fill('');
      await page
        .getByRole('group', { name: 'Вид' })
        .getByRole('button', { name: 'Список' })
        .click();
      await expect(page.locator('[data-grid]')).toBeVisible();
      await page.reload();
      await expect(page.locator('[data-grid]')).toBeVisible();
      await page
        .getByRole('group', { name: 'Вид' })
        .getByRole('button', { name: 'Дерево' })
        .click();
      await expect(page.locator('[data-gked-tree]')).toBeVisible();
    } finally {
      await cleanup(page.request, origin, code);
    }
  });

  test('(проверка задачи #93) «Отметить сверку с ГНС» у отмеченных видов: в меню строки — «Последняя: сегодня»', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    await page.goto('/app/pdicts/types');
    await search(page, isMobile, 'НДС');
    const row = page.locator('[data-grid] [data-id="nds"]');
    await expect(row).toBeVisible();
    await row.getByRole('checkbox').check();
    const bar = page.locator('[data-grid-bulk]');
    await expect(bar).toContainText('Выбрано: 1');
    await bar.getByRole('button', { name: 'Отметить сверку с ГНС' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Отмечена сверка с ГНС: 1' }),
    ).toBeVisible();

    // Список обновляется после уведомления: меню, открытое раньше, показывает прежнюю дату —
    // открываем заново, пока не придёт новая.
    const item = page
      .getByRole('menu', { name: 'Действия' })
      .getByRole('menuitem', { name: /Отметить сверку с ГНС/ });
    await expect(async () => {
      await row.locator('[data-row-menu]').click();
      try {
        await expect(item).toContainText(`Последняя: ${todayRu()}`, { timeout: 1000 });
      } finally {
        await page.keyboard.press('Escape');
      }
    }).toPass();
  });
});
