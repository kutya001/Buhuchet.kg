import { expect, test, type Locator, type Page } from '@playwright/test';
import { orgWithTypes } from './orgs';

// Загрузка контрагентов из Excel (задача 2.16, #72, часть 1) через настоящий сайт: своя организация
// теста (владелец — единственный сотрудник, весь каталог видов подключён), пустой список → «Загрузить из
// Excel» → вставка → «Показать таблицу» → «Проверить» → «ОК». Правила проверки строк, шаблон и ответы API
// — тесты packages/domain/src/contractors/import.test.ts и packages/api/src/modules/contractors/import.test.ts.

/** Правильный ИНН (14 цифр, первая — 0), свой у ПК и телефона; второй — соседний. */
function freshInns(): [string, string] {
  const base = `0${Date.now().toString().slice(-9)}${String(Math.floor(Math.random() * 1_000)).padStart(3, '0')}`;
  return [`${base}1`, `${base}2`];
}

/** Слово из кириллицы, своё на каждый запуск: по нему видно только контрагентов теста. */
const uniqueWord = (prefix: string) =>
  `${prefix}${Array.from({ length: 6 }, () => 'абвгдежзиклмнопрстуф'[Math.floor(Math.random() * 20)]).join('')}`;

const rows = (page: Page) => page.locator('[data-grid] [data-id]');

/** Строка таблицы окна загрузки по номеру. */
const importRow = (dialog: Locator, n: number) => dialog.locator(`[data-cp-import-row="${n}"]`);

test.describe('Этап 2: загрузка контрагентов из Excel', () => {
  test('(п. 19) строка без основного ГКЭД загружается с предупреждением «без ГКЭД»; плашка-фильтр «Без ГКЭД» показывает загруженного контрагента без основного вида деятельности, в его карточке — предупреждение «Укажите основной вид деятельности (ГКЭД)»', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await orgWithTypes(page.request, origin);
    const word = uniqueWord('Импорт');
    const withGked = `ОсОО «${word} с ГКЭД»`;
    const noGked = `ОсОО «${word} без ГКЭД»`;
    const [inn1, inn2] = freshInns();
    const text = [
      [
        'Название',
        'ИНН',
        'Телефон',
        'Виды отчётов',
        'Ответственный',
        'Основной ГКЭД',
        'Режим налогообложения',
      ],
      [withGked, inn1, '0555 123 456', 'НДС', 'Подборова Сквозная', '69.20.0', 'ОНР'],
      [noGked, inn2, '555 123 457', '', 'подборова', '', 'ОНР'],
      ['ОсОО «Без ИНН»', '123', '', 'НДС', '', '', 'ОНР'],
    ]
      .map((r) => r.join('\t'))
      .join('\n');

    // Новая организация: в пустом списке рядом с «Добавить контрагента» — «Загрузить из Excel».
    await page.goto('/app/cps/all');
    await page.getByRole('button', { name: 'Загрузить из Excel' }).click();
    const dialog = page.getByRole('dialog', { name: 'Загрузка контрагентов из Excel' });
    await dialog.getByLabel('Данные').fill(text);
    await dialog.getByRole('button', { name: 'Показать таблицу' }).click();
    await expect(dialog).toContainText('Разделитель: табуляция · строк: 3 · заголовки найдены');
    await expect(dialog.locator('[data-cp-import-col="5"]')).toHaveValue('gked');
    await expect(importRow(dialog, 0)).toContainText('не проверено');

    await dialog.getByRole('button', { name: 'Проверить' }).click();
    await expect(importRow(dialog, 0)).toContainText('готова');
    await expect(importRow(dialog, 1)).toContainText('готова');
    await expect(importRow(dialog, 1)).toContainText('без ГКЭД');
    await expect(importRow(dialog, 1)).toContainText('Отчёты подобраны автоматически');
    await expect(importRow(dialog, 2)).toContainText('ИНН не 14 цифр');
    await expect(importRow(dialog, 2)).toContainText('нет телефона');
    await expect(importRow(dialog, 2)).toContainText('не указан ответственный');
    await expect(dialog.locator('[data-cp-import-ready]')).toHaveText('Готово к загрузке: 2 из 3');

    // Ячейку можно исправить прямо в таблице: строка снова «не проверено», «Проверить» — заново.
    await importRow(dialog, 2).getByLabel('Телефон, строка 3').fill('555 123 458');
    await expect(importRow(dialog, 2)).toContainText('не проверено');
    await expect(dialog.locator('[data-cp-import-ready]')).toHaveText('Готово к загрузке: 0 из 3');
    await dialog.getByRole('button', { name: 'Проверить' }).click();
    await expect(importRow(dialog, 2)).toContainText('ИНН не 14 цифр');
    await expect(importRow(dialog, 2)).not.toContainText('нет телефона');
    await expect(dialog.locator('[data-cp-import-ready]')).toHaveText('Готово к загрузке: 2 из 3');

    // «ОК» создаёт только готовые строки; строка с ошибками остаётся в окне.
    await dialog.getByRole('button', { name: 'ОК, создать 2' }).click();
    await expect(page.getByText('Создано контрагентов: 2. Пропущено строк: 1')).toBeVisible();
    await expect(dialog.locator('[data-cp-import-row]')).toHaveCount(1);
    await expect(importRow(dialog, 0)).toContainText('ИНН не 14 цифр');
    await dialog.getByRole('button', { name: 'Закрыть' }).first().click();
    await expect(dialog).toBeHidden();

    // Плашка «Без ГКЭД» (на телефоне статистика скрыта — включается кнопкой): только контрагент без ГКЭД.
    await expect(rows(page).filter({ hasText: noGked })).toBeVisible();
    if (isMobile) await page.locator('[data-stats-toggle]').click();
    const plate = page.locator('[data-plate="nogk"]');
    await plate.click();
    await expect(plate).toHaveAttribute('aria-pressed', 'true');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText(noGked);

    await rows(page).first().getByText(noGked, { exact: true }).click();
    const card = page.getByRole('dialog', { name: noGked });
    await expect(card.locator('[data-cp-card]')).toBeVisible();
    await expect(card).toContainText('Укажите основной вид деятельности (ГКЭД)');

    // Первая строка загружена со своим основным ГКЭД, вторая — без него.
    const list = (await (await page.request.get('/api/contractors?size=all')).json()) as {
      items: { name: string; gked: { code: string } | null }[];
    };
    expect(list.items.find((c) => c.name === withGked)?.gked?.code).toBe('69.20.0');
    expect(list.items.find((c) => c.name === noGked)?.gked).toBeNull();
  });
});
