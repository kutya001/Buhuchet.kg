import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { platformAdmin } from './admin';

// Админка → «Справочники платформы» → «Выгрузить в Excel», «Загрузить из Excel» и «Загрузки», часть 1
// задачи 2.37 (ТЗ «Выгрузка и загрузка справочников»; прототип admin/platform-dicts-io.js). Справочники
// и «Загрузки» общие для всей платформы, поэтому файл — *.shared.spec.ts, а загрузка в конце
// откатывается.

type Cat = { code: string; name: string; active: boolean; data: { note: string } };
type Load = { id: string; dict: string; rolledBackAt: string | null; last: boolean };

async function cats(api: APIRequestContext): Promise<Cat[]> {
  const res = await api.get('/api/admin/platform-dicts/cats?size=all');
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { items: Cat[] }).items;
}

async function lastLoad(api: APIRequestContext): Promise<Load | undefined> {
  const res = await api.get('/api/admin/platform-dict-loads?sort=at.desc&size=all');
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { items: Load[] }).items[0];
}

/** Пункт меню «Добавить»: на вкладках справочников в нём «Выгрузить в Excel» и «Загрузить из Excel». */
async function addMenu(page: Page, item: string) {
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByRole('menu', { name: 'Добавить' }).getByRole('menuitem', { name: item }).click();
}

test.describe('Админка: выгрузка и загрузка справочников', () => {
  test('(проверка задачи #93) загрузка с одной изменённой строкой показывает в предпросмотре одно изменение и после применения пишет историю; последнюю загрузку можно откатить', async ({
    page,
    baseURL,
  }, testInfo) => {
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const cat = (await cats(page.request)).find((x) => x.active)!;
    const note = `Из Excel ${testInfo.project.name} ${Date.now()}`;
    const toast = (text: string) => page.getByRole('status').filter({ hasText: text });
    let loadId: string | undefined;

    try {
      await page.goto('/app/pdicts/cats');
      await expect(page.locator('[data-grid] [data-id]').first()).toBeVisible();

      // «Выгрузить» над списком (то же окно — и в «+ Добавить»): строки с заголовками — в том же формате,
      // что и загрузка.
      const bar = page.locator('[data-io-bar]');
      await expect(bar).toContainText('сопоставление по коду, перед применением — сравнение');
      await bar.getByRole('button', { name: 'Выгрузить', exact: true }).click();
      const out = page.getByRole('dialog', { name: 'Выгрузка: Категории задач' });
      const text = out.getByRole('textbox', { name: 'Строки справочника для Excel' });
      await expect(text).toHaveValue(/^Код\tНазвание\tПояснение\tАктивно\n/);
      await expect(text).toHaveValue(new RegExp(`\\n${cat.code}\\t`));
      await expect(out.getByRole('button', { name: 'Скачать для Excel' })).toBeEnabled();
      // В подвале — «Закрыть» словом (крестик в шапке тоже «Закрыть»).
      await out.getByRole('button', { name: 'Закрыть' }).last().click();
      await expect(out).toBeHidden();

      // «Загрузить из Excel»: пусто — ошибка; текущая выгрузка с одной изменённой ячейкой.
      await addMenu(page, 'Загрузить из Excel');
      const load = page.getByRole('dialog', { name: 'Загрузка: Категории задач' });
      await load.getByRole('button', { name: 'Сравнить' }).click();
      await expect(load.getByText('Вставьте данные или выберите файл')).toBeVisible();
      // Файл CSV попадает в поле «Данные», как в прототипе; без столбца кода — ошибка файла.
      const data = load.getByLabel('Данные');
      await load.locator('input[type="file"]').setInputFiles({
        name: 'категории.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('Название;Пояснение\nКатегория;Текст\n'),
      });
      await expect(data).toHaveValue('Название;Пояснение\nКатегория;Текст\n');
      await load.getByRole('button', { name: 'Сравнить' }).click();
      await expect(load.getByRole('alert')).toHaveText(
        'Нет столбца «Код»: без кода строки не сопоставить',
      );
      await load.getByRole('button', { name: 'Подставить текущую выгрузку' }).click();
      await expect(data).toHaveValue(new RegExp(`\\n${cat.code}\\t`));
      const lines = (await data.inputValue()).split('\n').map((line) => {
        const cells = line.split('\t');
        if (cells[0] !== cat.code) return line;
        cells[2] = note;
        return cells.join('\t');
      });
      await data.fill(lines.join('\n'));
      await load.getByRole('button', { name: 'Сравнить' }).click();

      const plates = load.locator('[data-plates]');
      await expect(plates.locator('[data-plate="change"]')).toContainText('1');
      await expect(plates.locator('[data-plate="add"]')).toContainText('0');
      await expect(plates.locator('[data-plate="off"]')).toContainText('0');
      await expect(plates.locator('[data-plate="errors"]')).toContainText('ошибок нет');
      const rows = load.getByRole('table', { name: 'Что изменит загрузка' }).locator('tbody tr');
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText('изменится');
      await expect(rows.first()).toContainText(cat.code);
      await expect(rows.first()).toContainText(`Пояснение: ${cat.data.note || 'пусто'} → ${note}`);
      await expect(load).toContainText('Значения, которых нет в файле, остаются как есть');

      await load.getByRole('button', { name: 'ОК, применить 1' }).click();
      await expect(toast('Загружено: добавлено 0, изменено 1, отключено 0')).toBeVisible();
      await expect(load).toBeHidden();
      loadId = (await lastLoad(page.request))?.id;
      expect((await cats(page.request)).find((x) => x.code === cat.code)!.data.note).toBe(note);
      await expect(page.locator('[data-pdicts-history]')).toContainText(
        'Категории задач: загрузка из Excel — добавлено 0, изменено 1, отключено 0',
      );

      // «Загрузки»: новая сверху, «Последняя»; откат возвращает значение к виду до загрузки.
      await page.goto('/app/pdicts/loads');
      const found = page.locator(`[data-grid] [data-id="${loadId}"]`);
      await expect(found).toContainText('Категории задач');
      await expect(found).toContainText('Последняя');
      await found.locator('[data-row-menu]').click();
      await page
        .getByRole('menu', { name: 'Действия' })
        .getByRole('menuitem', { name: 'Откатить' })
        .click();
      const ask = page.getByRole('dialog', { name: 'Откатить последнюю загрузку?' });
      await expect(ask).toContainText('изменённые и отключённые (1) вернутся к прежнему виду');
      await ask.getByRole('button', { name: 'Откатить' }).click();
      await expect(toast('Загрузка откачена')).toBeVisible();
      await expect(found).toContainText('Откачена');
      expect((await cats(page.request)).find((x) => x.code === cat.code)!.data.note).toBe(
        cat.data.note,
      );

      // Откаченную второй раз не откатить.
      await found.locator('[data-row-menu]').click();
      const again = page
        .getByRole('menu', { name: 'Действия' })
        .getByRole('menuitem', { name: 'Откатить' });
      await expect(again).toBeDisabled();
      await expect(again).toContainText('Уже откачена');
      await page.keyboard.press('Escape');
    } finally {
      // Тест упал до отката — вернуть справочник.
      const last = await lastLoad(page.request);
      if (loadId && last?.id === loadId && !last.rolledBackAt) {
        await page.request.post(`/api/admin/platform-dict-loads/${loadId}/rollback`, {
          headers: { origin },
        });
      }
    }
  });
});
