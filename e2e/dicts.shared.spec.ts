import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { DEMO_PASSWORD, signIn } from './helpers';

// «Справочники» → «Виды отчётов» (задача 2.02, #58): подключение из каталога («Выбор налогов»),
// переключатели в строке и «Настройки организации» в форме вида. Меняют виды отчётов демо-организации,
// поэтому файл *.shared.spec.ts идёт после остальных тестов и по одному (playwright.config.ts); всё
// изменённое возвращается как было.

test.describe.configure({ mode: 'serial' });

type Setting = {
  code: string;
  enabled: boolean;
  remindDays: number[];
  needFile: boolean;
  needReceipt: boolean;
  version: number;
};

async function settings(api: APIRequestContext) {
  const res = await api.get('/api/org-report-types/settings');
  expect(res.status()).toBe(200);
  return (await res.json()) as { items: Setting[]; remindDays: number[] };
}

const setting = async (api: APIRequestContext, code: string) =>
  (await settings(api)).items.find((s) => s.code === code);

/** Вернуть вид как был: подключён ли, дни, файл и квитанция. */
async function restore(
  api: APIRequestContext,
  origin: string,
  before: Setting | undefined,
  code: string,
) {
  const now = await setting(api, code);
  if (!now) return;
  const data = before?.enabled
    ? {
        enabled: before.enabled,
        remindDays: before.remindDays,
        needFile: before.needFile,
        needReceipt: before.needReceipt,
      }
    : { enabled: false };
  const res = await api.put(`/api/org-report-types/${code}`, {
    headers: { origin },
    data: { ...data, version: now.version },
  });
  expect(res.status(), await res.text()).toBe(200);
}

/** Общий поиск по вкладке (на телефоне — кнопкой «Поиск» в верхней панели). */
async function search(page: Page, isMobile: boolean, text: string) {
  if (isMobile) await page.getByRole('button', { name: 'Поиск', exact: true }).click();
  await page.getByRole('searchbox').first().fill(text);
}

/** «Подключить из каталога»: на ПК — отдельная кнопка рядом с «+ Добавить», на телефоне — в меню «+». */
async function openCatalog(page: Page, isMobile: boolean) {
  if (!isMobile) {
    await page.getByRole('button', { name: 'Подключить из каталога' }).first().click();
    return;
  }
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page
    .getByRole('menu', { name: 'Добавить' })
    .getByRole('menuitem', { name: 'Подключить из каталога' })
    .click();
}

test.describe('Этап 2: справочники — подключение видов отчётов', () => {
  test('«Выбор налогов»: подключённые отмечены, новый вид подключается с днями из поля; отключение — переключателем в строке', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    const before = await setting(page.request, 'akc');
    expect(before?.enabled ?? false).toBe(false);
    try {
      await page.goto('/app/dicts/types');
      await expect(page.locator('[data-grid] [data-id]').first()).toBeVisible();
      await openCatalog(page, isMobile);
      const pick = page.getByRole('dialog', { name: 'Выбор налогов' });
      await expect(pick).toContainText('Отметьте налоги и отчёты, которые сдают ваши клиенты');
      // Поиск раскрывает группы; уже подключённый НДС отмечен и подписан «Подключён».
      await pick.getByRole('searchbox', { name: 'Поиск отчёта' }).fill('STI-06');
      const nds = pick.locator('[data-tx-row="nds"]').first();
      await expect(nds.getByRole('checkbox')).toBeChecked();
      await expect(nds).toContainText('Подключён');
      const akc = pick.locator('[data-tx-row="akc"]').first();
      await expect(akc.getByRole('checkbox')).not.toBeChecked();
      // Строка раскрывает описание вида.
      await akc.getByRole('button', { name: /^Описание:/ }).click();
      await expect(pick).toContainText('Подробнее о налоге:');
      await akc.getByRole('checkbox').check();
      await expect(pick.locator('[data-tx-total]')).toContainText('новых 1');
      await pick.getByLabel('Напоминать до срока, за дней').fill('10, 5');
      await pick.getByRole('button', { name: 'Подключить' }).click();
      await expect(pick).toBeHidden();
      await expect(
        page.getByRole('status').filter({ hasText: 'Подключено видов отчётов: 1' }),
      ).toBeVisible();
      expect(await setting(page.request, 'akc')).toMatchObject({
        enabled: true,
        remindDays: [10, 5],
        needFile: false,
        needReceipt: false,
      });

      // Отключение — переключателем «Подключён» в строке.
      await search(page, isMobile, 'Акциз');
      const row = page.locator('[data-grid] [data-id="akc"]');
      await expect(row.locator('[data-flag="enabled"]')).toBeChecked();
      await row.locator('[data-flag="enabled"]').click();
      await expect(page.getByRole('status').filter({ hasText: 'отключён' })).toBeVisible();
      await expect(row.locator('[data-flag="enabled"]')).not.toBeChecked();
      expect((await setting(page.request, 'akc'))?.enabled).toBe(false);
    } finally {
      await restore(page.request, origin, before, 'akc');
    }
  });

  test('«Файл при сдаче обязателен» — переключателем в строке; дни напоминаний — в «Настройках организации» формы вида', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    const before = await setting(page.request, 'nds');
    expect(before?.enabled).toBe(true);
    try {
      await page.goto('/app/dicts/types');
      await search(page, isMobile, 'НДС');
      const row = page.locator('[data-grid] [data-id="nds"]');
      const file = row.locator('[data-flag="needFile"]');
      await expect(file).toBeVisible();
      const wasOn = await file.isChecked();
      await file.click();
      await expect(
        page.getByRole('status').filter({
          hasText: wasOn ? 'файл при сдаче не обязателен' : 'файл при сдаче обязателен',
        }),
      ).toBeVisible();
      await expect(file).toBeChecked({ checked: !wasOn });
      expect((await setting(page.request, 'nds'))?.needFile).toBe(!wasOn);

      await row.getByText('НДС', { exact: true }).first().click();
      const view = page.getByRole('dialog', { name: 'НДС' });
      const days = view.locator('[data-remind-days]');
      await days.scrollIntoViewIfNeeded();
      // День вне 1–60 — ошибка под полем; верный день добавляется плашкой.
      const add = view.getByPlaceholder('+ день');
      await add.fill('61');
      await add.press('Enter');
      await expect(view).toContainText('От 1 до 60 дней');
      await add.fill('21');
      await add.press('Enter');
      await expect(days.locator('[data-chip="21"]')).toBeVisible();
      await view.getByRole('button', { name: 'Сохранить' }).click();
      await expect(view).toBeHidden();
      await expect(
        page.getByRole('status').filter({ hasText: 'Настройки вида сохранены' }),
      ).toBeVisible();
      expect((await setting(page.request, 'nds'))?.remindDays).toContain(21);
    } finally {
      await restore(page.request, origin, before, 'nds');
    }
  });
});
