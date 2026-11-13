import { expect, test, type Locator, type Page } from '@playwright/test';
import { DEMO_PASSWORD, pickContractor, signIn } from './helpers';
import { newContractor } from './reports';

// Доработки 13.11, задача И3 (прототип v93, ui/cp-select.js): поле «Контрагент» во всех формах — общий
// список с поиском по названию и по ИНН. Здесь — сам список (поиск, клавиши) и формы, где его не
// проверяют другие тесты: «Новая задача», «Загрузить файл», «Поступление от контрагента». «Новый
// проект», «Разовая услуга» и «Разовый отчёт» выбирают контрагента этим же списком в своих тестах
// (e2e/projects.spec.ts, e2e/finance.spec.ts, e2e/staff-bonuses.spec.ts, e2e/report-matrix.spec.ts).

const word = () => `Поиск${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

async function addMenu(page: Page, item: string) {
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByRole('menu', { name: 'Добавить' }).getByRole('menuitem', { name: item }).click();
}

const searchOf = (page: Page) =>
  page.getByRole('combobox', { name: 'Поиск контрагента по названию или ИНН' });
const rowsOf = (page: Page) => page.getByRole('listbox').getByRole('option');

/** Открыть список поля: строка поиска с подсказкой «Название или ИНН». */
async function openList(page: Page, field: Locator) {
  await field.click();
  await expect(searchOf(page)).toHaveAttribute('placeholder', 'Название или ИНН');
}

test.describe('Доработки 13.11: список контрагентов с поиском по названию и ИНН', () => {
  test('(п. 1–5) «Новый проект»: поле «Контрагент» ищет по части названия без учёта регистра и по цифрам ИНН, показывает ИНН в строках; «Ничего не найдено»; клавиши ↓, Enter, Esc', async ({
    page,
    request,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await signIn(request, origin, 'erkin', DEMO_PASSWORD);
    const name = word();
    const cp = await newContractor(request, origin, { name: `ОсОО «${name}»`, tariffAmount: 0 });
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    await page.goto('/app/projects');
    await expect(page.locator('[data-grid]')).toBeVisible();
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    const dlg = page.getByRole('dialog', { name: 'Новый проект' });
    const field = dlg.locator('[data-pd-cp]');
    await expect(field).toContainText('— выберите —');

    // По части названия, регистр не важен; в строке — название и ИНН.
    await openList(page, field);
    await expect(rowsOf(page).first()).toContainText('— выберите —');
    await searchOf(page).fill(name.toUpperCase());
    await expect(rowsOf(page)).toHaveCount(1);
    await expect(rowsOf(page).first()).toContainText(`ОсОО «${name}»`);
    await expect(rowsOf(page).first()).toContainText(cp.inn);
    // По цифрам ИНН подряд, пробелы в цифрах не мешают.
    await searchOf(page).fill(`${cp.inn.slice(0, 7)} ${cp.inn.slice(7)}`);
    await expect(rowsOf(page)).toHaveCount(1);
    await expect(rowsOf(page).first()).toContainText(`ОсОО «${name}»`);
    await searchOf(page).fill(cp.inn.slice(4, 12));
    await expect(rowsOf(page).first()).toContainText(`ОсОО «${name}»`);
    // Ничего не подошло.
    await searchOf(page).fill(`${name}-нет-такого`);
    await expect(page.getByRole('listbox')).toContainText('Ничего не найдено');
    await expect(rowsOf(page)).toHaveCount(0);

    if (isMobile) {
      await searchOf(page).fill(cp.inn);
      await rowsOf(page).first().click();
    } else {
      // Esc закрывает только список — окно формы остаётся; цифра на поле открывает список с запросом.
      await page.keyboard.press('Escape');
      await expect(page.getByRole('listbox')).toBeHidden();
      await expect(dlg).toBeVisible();
      await expect(field).toBeFocused();
      await page.keyboard.press(cp.inn[0]!);
      await expect(searchOf(page)).toHaveValue(cp.inn[0]!);
      await expect(searchOf(page)).toBeFocused();
      await searchOf(page).fill(cp.inn);
      // ↓ и ↑ не уходят за края списка, Enter выбирает строку и не сохраняет форму.
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('Enter');
    }
    await expect(page.getByRole('listbox')).toBeHidden();
    await expect(dlg).toBeVisible();
    await expect(field).toContainText(`ОсОО «${name}»`);
    if (!isMobile) await expect(field).toContainText(cp.inn);
  });

  test('(п. 6) тот же список — в окнах «Новая задача», «Загрузить файл» и «Поступление от контрагента»: контрагент находится по ИНН', async ({
    page,
    request,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    await signIn(request, origin, 'erkin', DEMO_PASSWORD);
    const name = word();
    const cp = await newContractor(request, origin, { name: `ОсОО «${name}»`, tariffAmount: 0 });
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);

    // «Новая задача» → «По контрагенту».
    await page.goto('/app/tasks');
    await expect(page.locator('[data-grid]')).toBeVisible();
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    const task = page.getByRole('dialog', { name: 'Новая задача' });
    await task.locator('[data-task-scope]').getByRole('button', { name: 'По контрагенту' }).click();
    const taskCp = task.getByLabel(/^Контрагент/);
    await expect(taskCp).toContainText('— выберите контрагента —');
    await pickContractor(taskCp, cp.inn);
    await expect(taskCp).toContainText(`ОсОО «${name}»`);
    await task.getByRole('button', { name: 'Отмена' }).click();
    await expect(task).toBeHidden();

    // «Загрузить файл»: пустой выбор — «общий файл организации».
    await page.goto('/app/files');
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    const upload = page.getByRole('dialog', { name: 'Загрузить файл' });
    const uploadCp = upload.locator('[data-files-upload-cp]');
    await expect(uploadCp).toContainText('общий файл организации');
    await pickContractor(uploadCp, cp.inn.slice(2, 11));
    await expect(uploadCp).toContainText(`ОсОО «${name}»`);
    await upload.getByRole('button', { name: 'Отмена' }).click();

    // «Поступление от контрагента» из «+ Добавить» модуля «Финансовые операции».
    await page.goto('/app/fin');
    await expect(page.locator('[data-grid]')).toBeVisible();
    await addMenu(page, 'Поступление');
    const receipt = page.getByRole('dialog', { name: 'Поступление от контрагента' });
    const receiptCp = receipt.locator('[data-receipt-contractor]');
    // Окно дочитывает данные первого контрагента и рисуется заново — список открываем после этого.
    await expect(receipt.getByRole('button', { name: 'Записать поступление' })).toBeEnabled();
    await pickContractor(receiptCp, name.toLowerCase());
    await expect(
      page
        .getByRole('dialog', { name: 'Поступление от контрагента' })
        .locator('[data-receipt-contractor]'),
    ).toContainText(`ОсОО «${name}»`);
  });
});
