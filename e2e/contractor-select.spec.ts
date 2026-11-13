import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { DEMO_PASSWORD, phoneTableView, pickContractor, signIn } from './helpers';
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

/** Файл контрагента, загруженный вручную: начать → PUT в хранилище → закончить. */
async function uploadFor(
  api: APIRequestContext,
  origin: string,
  contractorId: string,
  name: string,
) {
  const size = 1024;
  const start = await api.post('/api/files/uploads', {
    headers: { origin },
    data: { source: { kind: 'manual', id: null }, contractorId, name, size },
  });
  expect(start.status(), await start.text()).toBe(201);
  const ticket = (await start.json()) as {
    id: string;
    upload: { url: string; headers: Record<string, string> };
  };
  const put = await api.put(ticket.upload.url, {
    headers: ticket.upload.headers,
    data: Buffer.alloc(size, 5),
  });
  expect(put.status(), await put.text()).toBe(200);
  const done = await api.post(`/api/files/${ticket.id}/complete`, { headers: { origin } });
  expect(done.status(), await done.text()).toBe(200);
  return ticket.id;
}

test.describe('Доработки 13.11: список контрагентов с поиском по названию и ИНН', () => {
  test('(проверка прототипа v93) «Новый проект»: поле «Контрагент» ищет по части названия без учёта регистра и по цифрам ИНН, показывает ИНН в строках; «Ничего не найдено»; клавиши ↓, Enter, Esc', async ({
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
    // Enter выбрал строку и форму не сохранял: окно открыто, ошибок полей нет.
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('[id$="-err"]')).toHaveCount(0);
    await expect(field).toContainText(`ОсОО «${name}»`);
    // ИНН выбранного — на кнопке поля; на узком телефоне его там нет.
    const inn = field.locator('small');
    await expect(inn).toHaveText(cp.inn);
    if (isMobile) await expect(inn).toBeHidden();
    else await expect(inn).toBeVisible();

    // Список открывается на выбранном контрагенте (и на телефоне); повторное нажатие на поле закрывает.
    await field.click();
    const picked = page.getByRole('listbox').getByRole('option', { selected: true });
    await expect(picked).toContainText(`ОсОО «${name}»`);
    await expect(picked).toBeInViewport();
    await field.click();
    await expect(page.getByRole('listbox')).toBeHidden();
    await expect(dlg).toBeVisible();
  });

  test('(проверка прототипа v93) тот же список — в окнах «Новая задача», «Загрузить файл» и «Поступление от контрагента»: контрагент находится по ИНН', async ({
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

  test('(проверка прототипа v93) фильтр столбца «Контрагент»: поле «Название или ИНН» находит значение по ИНН — цифрами подряд и с пробелами; «Выбрать все» по найденному оставляет в списке записи этого контрагента', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    // Поле поиска в фильтре есть, когда значений больше восьми: девять контрагентов с файлом у каждого.
    const tag = word();
    const cps: { id: string; inn: string; name: string; file: string }[] = [];
    for (let i = 1; i <= 9; i++) {
      const name = `ОсОО «${tag} ${i}»`;
      const cp = await newContractor(page.request, origin, { name, tariffAmount: 0 });
      const file = await uploadFor(page.request, origin, cp.id, `устав ${tag} ${i}.pdf`);
      cps.push({ id: cp.id, inn: cp.inn, name, file });
    }
    const target = cps[4]!;

    await page.goto('/app/files');
    const grid = page.locator('[data-grid]');
    await expect(grid.locator('[data-id]').first()).toBeVisible();
    if (isMobile) await phoneTableView(page);
    await grid.getByRole('button', { name: 'Фильтр: Контрагент' }).click();
    const filter = page.getByRole('dialog', { name: 'Контрагент' });
    const find = filter.getByRole('textbox', { name: 'Название или ИНН' });
    await expect(find).toHaveAttribute('placeholder', 'Название или ИНН');
    const values = filter.locator('[data-filter-values] label');

    // По названию — как раньше: все девять контрагентов теста.
    await find.fill(tag.toUpperCase());
    await expect(values).toHaveCount(10);
    // По ИНН — цифрами подряд: один контрагент; цифры через пробел — он же.
    await find.fill(target.inn);
    await expect(values).toHaveCount(2);
    await expect(values.nth(1)).toContainText(target.name);
    await find.fill(`${target.inn.slice(0, 4)} ${target.inn.slice(4, 9)} ${target.inn.slice(9)}`);
    await expect(values).toHaveCount(2);
    await expect(values.nth(1)).toContainText(target.name);
    // Цифры, которых нет ни в одном ИНН и названии, — ничего не найдено.
    await find.fill('99999999999999999');
    await expect(values).toHaveCount(1);

    // Снять всё, найти по ИНН, «Выбрать все» и «Применить»: в списке — только файл этого контрагента.
    await find.fill('');
    await filter.getByRole('checkbox', { name: 'Выбрать все' }).uncheck();
    await find.fill(target.inn);
    await expect(values).toHaveCount(2);
    await filter.getByRole('checkbox', { name: 'Выбрать все' }).check();
    await expect(filter.getByRole('checkbox', { name: target.name })).toBeChecked();
    await filter.getByRole('button', { name: 'Применить' }).click();
    await expect(grid.locator('[data-id]')).toHaveCount(1);
    await expect(grid.locator(`[data-id="${target.file}"]`)).toBeVisible();
  });
});
