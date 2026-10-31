import { fileURLToPath } from 'node:url';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { orgWithTypes } from './orgs';

// Создание контрагента «Из свидетельства и выписки» (задача 2.17, #72, часть 2; Бета) через настоящий
// сайт: своя организация теста (весь каталог видов подключён), «+ Добавить» → «Из свидетельства и
// выписки» → два PDF → «Распознать» → заполненная форма → «Сохранить контрагента». Документы —
// синтетические PDF вымышленной ОсОО «Тестовая бухгалтерия» с текстовым слоем. Правила распознавания,
// чтение PDF и сканов, ответы API и подписи формы — тесты packages/domain/src/contractors/regdocs.test.ts,
// packages/adapters/src/documents.test.ts, packages/api/src/modules/contractors/regdocs.test.ts и
// apps/web/src/contractors/contractor-regdocs-model.test.ts.

const DOCS = ['regdocs-svid.pdf', 'regdocs-vyp.pdf'].map((name) =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)),
);
const INN = '02503202010045';
const NAME = 'ОсОО «Тестовая бухгалтерия»';

/** «+ Добавить» → «Из свидетельства и выписки» → оба PDF → «Распознать». */
async function recognize(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page
    .getByRole('menu', { name: 'Добавить' })
    .getByRole('menuitem', { name: /^Из свидетельства и выписки/ })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Новый контрагент из свидетельства и выписки' });
  await dialog.locator('[data-rd-input]').setInputFiles(DOCS);
  await expect(dialog.locator('[data-rd-file]')).toHaveCount(2);
  await dialog.locator('[data-rd-go]').click();
  return dialog;
}

/** Контрагенты организации теста с этим ИНН. */
async function byInn(api: APIRequestContext): Promise<{ id: string }[]> {
  const filters = encodeURIComponent(JSON.stringify({ inn: { type: 'text', q: INN } }));
  const res = await api.get(`/api/contractors?size=all&filters=${filters}`);
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { items: { id: string }[] }).items;
}

/** Вкладка карточки: на телефоне — из списка под текущей вкладкой. */
async function toTab(page: Page, card: Locator, isMobile: boolean, name: RegExp) {
  if (isMobile) {
    await card.getByRole('tab', { selected: true }).click();
    await page.getByRole('menu').getByRole('menuitem', { name }).click();
  } else {
    await card.getByRole('tab', { name }).click();
  }
}

test.describe('Этап 2: контрагент из свидетельства и выписки', () => {
  test('(п. 27) загружены свидетельство и выписка ОсОО: форма заполнена из документов с подписями источника и плашкой «Бета»; без «Сохранить» контрагента нет; после сохранения оба PDF во вкладке «Файлы»; повторная загрузка — «Контрагент с таким ИНН уже есть»', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await orgWithTypes(page.request, origin);
    await page.goto('/app/cps/all');
    const dialog = await recognize(page);

    // Распознано: окно документов закрылось, открылась форма «Новый контрагент» с меткой «Бета».
    const form = page
      .getByRole('dialog', { name: /^Новый контрагент/ })
      .filter({ has: page.locator('[data-cf]') });
    await expect(form).toBeVisible({ timeout: 30_000 });
    await expect(dialog).toBeHidden();
    await expect(form.getByRole('heading').first()).toContainText('Бета');
    await expect(form.locator('[data-rd-head]')).toContainText('Бета-версия.');
    await expect(form.locator('[data-rd-sum]')).toContainText('Распознано: Свидетельство');
    await expect(form.locator('[data-rd-sum]')).toContainText('Заполнено из документов');
    await expect(form.locator('[data-rd-attach]')).toContainText('regdocs-svid.pdf');

    // Реквизиты из документов: название, ИНН, ОКПО, рег. номер, форма, адрес, руководитель, ГКЭД.
    await expect(form.locator('[data-cp-field="name"]')).toHaveValue(NAME);
    await expect(form.locator('[data-cp-field="inn"]')).toHaveValue(INN);
    await expect(form.getByLabel('Код ОКПО')).toHaveValue('31415926');
    await expect(form.getByLabel('Регистрационный номер')).toHaveValue('214365-3301-ООО');
    await expect(form.locator('[data-cp-field="form"] option:checked')).toHaveText('ОсОО');
    await expect(form.getByLabel('Юридический адрес')).toHaveValue(
      'г.Бишкек, Октябрьский район, ул.Тестовая, д. 7, кв. 12',
    );
    await expect(form.getByLabel('Руководитель', { exact: true })).toHaveValue(
      'Тестова Айгуль Тестовна',
    );
    await expect(form.locator('[data-gked-main]')).toContainText('69.20.0');
    // У полей — подписи источника («из выписки», «из свидетельства», «из выписки и свидетельства»).
    expect(await form.locator('[data-rd-src]').count()).toBeGreaterThanOrEqual(10);
    await expect(form.getByText('из выписки и свидетельства').first()).toBeVisible();

    // Без «Сохранить» контрагента нет.
    expect(await byInn(page.request)).toHaveLength(0);

    // «Сохранить контрагента» (на телефоне — из третьего шага): ответственный и стоимость вручную.
    if (isMobile) {
      await form.locator('[data-cf-step="3"]').click();
      await expect(form.locator('[data-cf]')).toHaveAttribute('data-step', '3');
    }
    const responsible = form.locator('[data-cp-field="responsible"]');
    if (!(await responsible.inputValue())) await responsible.selectOption({ index: 1 });
    const fee = form.locator('[data-cp-field="fee"]');
    if ((await fee.count()) && !(await fee.inputValue())) await fee.fill('5000');
    await form.locator('[data-cp-save]').click();
    await expect(form).toBeHidden();
    await expect(page.getByText(/^Контрагент добавлен, отчётов создано: \d+$/)).toBeVisible();
    expect(await byInn(page.request)).toHaveLength(1);

    // Открылась карточка: «Регистрационные данные» с пометкой «из свидетельства и выписки».
    const card = page.getByRole('dialog', { name: NAME });
    await expect(card.locator('[data-cp-card]')).toBeVisible();
    await expect(card.locator('[data-cp-reg-docs]')).toHaveText('из свидетельства и выписки');

    // Оба PDF — во вкладке «Файлы», источник «Из свидетельства и выписки».
    await toTab(page, card, isMobile, /^Файлы/);
    const files = card.locator('[data-cp-files]');
    await expect(files).toContainText('Документов: 2');
    await expect(files).toContainText('regdocs-svid.pdf');
    await expect(files).toContainText('regdocs-vyp.pdf');
    await expect(files).toContainText('Из свидетельства и выписки');

    // История контрагента: «Создан из свидетельства и выписки (бета)».
    await toTab(page, card, isMobile, /^История/);
    await expect(
      card
        .getByRole('list', { name: 'История' })
        .getByRole('listitem')
        .filter({ hasText: 'Создан из свидетельства и выписки (бета)' }),
    ).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();

    // Повторная загрузка тех же документов: «Контрагент с таким ИНН уже есть» → «Открыть» — карточка.
    await recognize(page);
    const dup = page.getByRole('dialog', { name: 'Контрагент с таким ИНН уже есть' });
    await expect(dup).toBeVisible({ timeout: 30_000 });
    await expect(dup.locator('[data-rd-dup]')).toContainText(`ИНН ${INN} уже у контрагента`);
    await dup.locator('[data-rd-dup-open]').click();
    await expect(page.getByRole('dialog', { name: NAME }).locator('[data-cp-card]')).toBeVisible();
    expect(await byInn(page.request)).toHaveLength(1);
  });
});
