import { expect, test, type Locator, type Page } from '@playwright/test';
import { uniqueInn } from './admin';
import { orgWithTypes } from './orgs';
import { assign, reportsOf } from './reports';

// «Подбор отчётов» и «Льготы и особые статусы» (задача 2.07, #63). Формы контрагента (задача 2.09) и
// вкладки карточки (задача 2.11) ещё нет, поэтому окна проверяются на странице образцов /samples:
// черновик формы создания и вкладка «Подбор отчётов» сохранённого контрагента. Организация своя на
// каждый тест, в ней подключён весь каталог видов: «Рекомендуемые» не зависят от того, что подключила
// демо-организация, а её общие записи тест не меняет.

type Draft = { form?: string; regime?: string; gked?: string; biz?: string };

/** Черновик формы создания на странице образцов. */
async function draft(page: Page, baseURL: string | undefined, fields: Draft, connect = true) {
  await orgWithTypes(page.request, new URL(baseURL!).origin, connect);
  await page.goto('/samples');
  await fill(page, fields);
}

async function fill(page: Page, fields: Draft) {
  const box = page.locator('[data-pick-draft]');
  if (fields.form) await box.locator('[data-draft="formCode"]').selectOption(fields.form);
  if (fields.regime) await box.locator('[data-draft="regimeCode"]').selectOption(fields.regime);
  if (fields.gked !== undefined) await box.locator('[data-draft="gked"]').fill(fields.gked);
  if (fields.biz) await box.locator('[data-draft="bizSize"]').selectOption(fields.biz);
}

async function openPick(page: Page): Promise<Locator> {
  const button = page.getByRole('button', { name: 'Подобрать отчёты' });
  await expect(button).toBeEnabled();
  await button.click();
  const dialog = page.getByRole('dialog', { name: 'Подбор отчётов' });
  await expect(dialog.locator('[data-pick-row]').first()).toBeVisible();
  return dialog;
}

/** «Льготы и особые статусы»: отметить статусы по названию и применить. */
async function pickBenefits(page: Page, names: string[], tab: 'Подходят по ГКЭД' | 'Все') {
  await page.getByRole('button', { name: 'Льготы и статусы' }).click();
  const dialog = page.getByRole('dialog', { name: 'Льготы и особые статусы' });
  await dialog.getByRole('button', { name: tab, exact: true }).click();
  for (const name of names) {
    const row = dialog.locator('[data-benefit-row]').filter({ hasText: name });
    if (tab === 'Подходят по ГКЭД') await expect(row).toContainText('по ГКЭД');
    await row.getByRole('checkbox', { name, exact: true }).check();
  }
  await dialog.getByRole('button', { name: 'Применить' }).click();
  await expect(dialog).toBeHidden();
}

const group = (dialog: Locator, key: string) => dialog.locator(`[data-pick-group="${key}"]`);
const row = (scope: Locator, code: string) => scope.locator(`[data-pick-row="${code}"]`);
const box = (scope: Locator, code: string) => row(scope, code).getByRole('checkbox');

/** Описание вида по нажатию на строку: на ПК — справа, на телефоне — под строкой. */
async function describe(dialog: Locator, code: string) {
  await row(dialog, code).click({ position: { x: 150, y: 12 } });
  return dialog.locator(`[data-pick-side], [data-pick-row="${code}"] + div`);
}

test.describe('Этап 2: подбор отчётов и налогов', () => {
  test('(п. 28) ОсОО на едином налоге со статусом «Резидент ПКИ» и наёмными сотрудниками: заранее отмечены ЕН, отчисления ПКИ и отчёт в Соцфонд; ЕНД не нужен по статусу, НДС не подходит к режиму; «Подходит» ставит галочку', async ({
    page,
    baseURL,
  }) => {
    await draft(page, baseURL, { form: 'ФС-01', regime: 'РЕЖ-03', gked: '62.01.0' });
    await pickBenefits(page, ['Резидент ПКИ'], 'Подходят по ГКЭД');
    await expect(page.locator('[data-result="benefits"]')).toContainText('Резидент ПКИ');
    const dialog = await openPick(page);
    await expect(dialog.locator('[data-pick-context]')).toContainText('Статусы: Резидент ПКИ');
    await dialog.getByRole('button', { name: 'Есть наёмные сотрудники' }).click();

    await expect(box(group(dialog, 'regime'), 'enq')).toBeChecked();
    await expect(box(group(dialog, 'status'), 'pkid')).toBeChecked();
    await expect(box(group(dialog, 'basis'), 'soc')).toBeChecked();
    await expect(row(dialog, 'endo')).toHaveCount(0);
    await expect(dialog.locator('[data-pick-sum]')).toContainText('Выбрано: 3 · новых 3');

    await dialog.getByRole('button', { name: 'Все', exact: true }).click();
    await expect(row(dialog, 'endo')).toContainText('Не нужен по статусу «Резидент ПКИ»');
    await expect(box(dialog, 'endo')).not.toBeChecked();
    await expect(row(dialog, 'nds')).toContainText('Не подходит к режиму «Единый налог»');
    await expect(box(dialog, 'nds')).toBeDisabled();

    const desc = await describe(dialog, 'endo');
    await expect(desc).toContainText('Срок сдачи');
    await expect(desc).toContainText('Ближайший срок');
    await expect(desc).toContainText('Статья НК КР');
    await desc.getByRole('button', { name: 'Подходит', exact: true }).click();
    await expect(box(dialog, 'endo')).toBeChecked();
    await expect(row(dialog, 'endo')).toContainText('Будет добавлен');

    await dialog.getByRole('button', { name: 'Применить' }).click();
    await expect(page.locator('[data-result="reports"]')).toContainText('ЕНД орг.');
    await expect(page.locator('[data-result="bases"]')).toContainText('Есть наёмные сотрудники');
  });

  test('(п. 51) ОсОО на ОНР со средним бизнесом: «Годовая финансовая отчётность» отмечена в «Для всех»; у малого её нет, пока не отмечен «Субъект публичного интереса» — тогда она «По статусу»', async ({
    page,
    baseURL,
  }) => {
    await draft(page, baseURL, { form: 'ФС-01', regime: 'РЕЖ-01', gked: '47.11.0', biz: 'medium' });
    let dialog = await openPick(page);
    await expect(box(group(dialog, 'all'), 'fin')).toBeChecked();
    const desc = await describe(dialog, 'fin');
    await expect(desc).toContainText('Госфиннадзор');
    await expect(desc).toContainText('до 1 июня');
    await dialog.getByRole('button', { name: 'Отмена' }).click();

    await fill(page, { biz: 'small' });
    dialog = await openPick(page);
    await expect(row(group(dialog, 'all'), 'fin')).toHaveCount(0);
    await expect(row(group(dialog, 'status'), 'fin')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Отмена' }).click();

    await pickBenefits(page, ['Субъект публичного интереса'], 'Все');
    dialog = await openPick(page);
    await expect(row(group(dialog, 'status'), 'fin')).toContainText(
      'По статусу «Субъект публичного интереса»',
    );
  });

  test('(п. 53, 54) ГКЭД 94.99 без основания «В списке Нацстаткома»: 4-фин предложены «Подходит по ГКЭД 94»; отметили 4-фин — основание включилось само, свёрнутая группа «Формы Нацстаткома» с «отмечено 2 из N», поиск «6041017» находит 1-Т', async ({
    page,
    baseURL,
  }) => {
    await draft(page, baseURL, { form: 'ФС-01', regime: 'РЕЖ-01', gked: '94.99.0' });
    const dialog = await openPick(page);
    const gked = group(dialog, 'gked');
    for (const code of ['fin4y', 'fin4h']) {
      await expect(row(gked, code)).toContainText('Подходит по ГКЭД 94');
      await expect(box(gked, code)).not.toBeChecked();
    }
    await expect(group(dialog, 'stat')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'В списке Нацстаткома' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    await box(gked, 'fin4y').check();
    await expect(
      page.getByRole('status').filter({ hasText: 'Включено основание «В списке Нацстаткома»' }),
    ).toBeVisible();
    await expect(dialog).toContainText(
      'Основание «В списке Нацстаткома» включено само: отмечена форма Нацстаткома.',
    );
    await expect(dialog.getByRole('button', { name: 'В списке Нацстаткома' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const stat = group(dialog, 'stat');
    await expect(stat.locator('[data-pick-count]')).toHaveText(/^отмечено 2 из \d+$/);
    await expect(stat.locator('[data-pick-row]')).toHaveCount(0);
    await expect(stat.getByRole('button', { name: 'Формы Нацстаткома' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    // Несовпадение ГКЭД у остальных форм Нацстаткома предупреждений не даёт.
    await stat.getByRole('button', { name: 'Формы Нацстаткома' }).click();
    await expect(stat.locator('[data-pick-row]').nth(2)).toBeVisible();
    await expect(
      stat.locator('[data-pick-row] .text-danger-label, [data-pick-row] .text-warn-label'),
    ).toHaveCount(0);

    await dialog.getByRole('searchbox', { name: 'Поиск отчёта' }).fill('6041017');
    await expect(stat.locator('[data-pick-row]').filter({ hasText: '1-Т' }).first()).toBeVisible();
  });

  test('(п. 55) основание «Производство или импорт товаров с утилизационным сбором»: утильсбор производителей отмечен, утильсбор при импорте — «По желанию», разовый', async ({
    page,
    baseURL,
  }) => {
    await draft(page, baseURL, { form: 'ФС-01', regime: 'РЕЖ-01', gked: '47.11.0' });
    const dialog = await openPick(page);
    await dialog
      .getByRole('button', { name: 'Производство или импорт товаров с утилизационным сбором' })
      .click();
    await expect(box(group(dialog, 'basis'), 'utlq')).toBeChecked();
    const choice = group(dialog, 'choice');
    await expect(box(choice, 'utli')).not.toBeChecked();
    await expect(row(choice, 'utli')).toContainText('Разовый');
  });

  test('(проверка задачи #63) п. 52 в окне «Льготы и особые статусы»: при УГНС крупных налогоплательщиков у статуса «Крупный налогоплательщик» метка «по УГНС», в описании — «у контрагента»', async ({
    page,
    baseURL,
  }) => {
    await draft(page, baseURL, { form: 'ФС-01', regime: 'РЕЖ-01', gked: '47.11.0' });
    await page.locator('[data-draft="taxOfficeCode"]').selectOption('ugns-large');
    await page.getByRole('button', { name: 'Льготы и статусы' }).click();
    const dialog = page.getByRole('dialog', { name: 'Льготы и особые статусы' });
    await dialog.getByRole('button', { name: 'Все', exact: true }).click();
    const big = dialog
      .locator('[data-benefit-row]')
      .filter({ hasText: 'Крупный налогоплательщик' });
    await expect(big).toContainText('по УГНС');
    await expect(big).toContainText('Статус');
    await big.click({ position: { x: 150, y: 12 } });
    await expect(dialog.getByText('Ставится по УГНС')).toBeVisible();
    await expect(dialog.getByText('у контрагента', { exact: true })).toBeVisible();
    // Статус тарифа СПиНО выбирается в блоке «Тариф Соцфонда», здесь его нет.
    await dialog.getByRole('searchbox').fill('СПиНО');
    await expect(dialog.locator('[data-benefit-row]')).toHaveCount(0);
  });

  test('(проверка задачи #63) «Добавить отчёт»: вкладка «Все» без оснований, новым отмечается один отчёт, выбранные остаются', async ({
    page,
    baseURL,
  }) => {
    await draft(page, baseURL, { form: 'ФС-01', regime: 'РЕЖ-01', gked: '47.11.0' });
    await page.getByRole('button', { name: 'Добавить отчёт' }).click();
    const dialog = page.getByRole('dialog', { name: 'Добавить отчёт' });
    await expect(row(dialog, 'utli')).toBeVisible();
    await expect(dialog.locator('[data-pick-bases]')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Рекомендуемые' })).toHaveCount(0);
    await expect(box(dialog, 'nds')).toBeChecked();
    const add = dialog.getByRole('button', { name: 'Добавить', exact: true });
    await expect(add).toBeDisabled();

    await box(dialog, 'utli').check();
    await box(dialog, 'utlq').check();
    await expect(box(dialog, 'utli')).not.toBeChecked();
    await expect(box(dialog, 'nds')).toBeChecked();
    await add.click();
    await expect(dialog).toBeHidden();

    const pick = await openPick(page);
    await pick.getByRole('button', { name: 'Все', exact: true }).click();
    await expect(box(pick, 'utlq')).toBeChecked();
    await expect(box(pick, 'utli')).not.toBeChecked();
    await expect(box(pick, 'nds')).toBeChecked();
  });

  test('(проверка задачи #63) в организации без подключённых видов окно подбора просит подключить их: «Выбрать налоги» открывает «Выбор налогов»', async ({
    page,
    baseURL,
  }) => {
    await draft(page, baseURL, { form: 'ФС-01', regime: 'РЕЖ-01', gked: '47.11.0' }, false);
    const button = page.getByRole('button', { name: 'Подобрать отчёты' });
    await expect(button).toBeEnabled();
    await button.click();
    const note = page.getByRole('dialog', { name: 'Подбор отчётов' }).locator('[data-no-types]');
    await expect(note).toContainText('Подключите виды отчётов.');
    await note.getByRole('button', { name: 'Выбрать налоги' }).click();
    await expect(page.getByRole('dialog', { name: 'Выбор налогов' })).toBeVisible();
  });

  test('(п. 30) вкладка «Подбор отчётов»: снятый вид с текущим отчётом «К сдаче» — подтверждение «удалится 1», после сохранения текущий отчёт удалён, прошлый на месте', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    await orgWithTypes(page.request, origin);
    const staff = (await (await page.request.get('/api/staff?size=all')).json()) as {
      items: { id: string }[];
    };
    const inn = uniqueInn().replace(/^9/, '0');
    const res = await page.request.post('/api/contractors', {
      headers: { origin },
      data: {
        name: `Подбор отчётов ${inn}`,
        inn,
        phone: '+996505890076',
        kind: 'regular',
        formCode: 'ФС-01',
        regimeCode: 'РЕЖ-01',
        gked: '47.11.0',
        startDate: '2026-01-01',
        responsibleEmployeeId: staff.items[0]!.id,
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    const cp = { ...((await res.json()) as { id: string }), inn };
    // Утильсбор производителей — квартальный: с прошлого квартала — отчёт прошлого и текущего.
    const now = new Date(Date.now() + 6 * 3600_000);
    const quarter = Math.floor(now.getUTCMonth() / 3) * 3;
    const prev = new Date(Date.UTC(now.getUTCFullYear(), quarter - 3, 1))
      .toISOString()
      .slice(0, 10);
    const cur = new Date(Date.UTC(now.getUTCFullYear(), quarter, 1)).toISOString().slice(0, 10);
    await assign(page.request, origin, {
      contractorId: cp.id,
      reportTypeCode: 'utlq',
      fromMonth: prev,
    });
    const starts = (await reportsOf(page.request, cp.inn)).map((r) => r.periodStart).sort();
    expect(starts).toEqual([prev, cur]);

    await page.goto(`/samples?cp=${cp.id}`);
    const tab = page.locator('[data-pick-tab]');
    await tab.getByRole('button', { name: 'Все', exact: true }).click();
    await expect(row(tab, 'utlq')).toContainText('Назначен');
    await box(tab, 'utlq').uncheck();
    await expect(row(tab, 'utlq')).toContainText('Будет снят');
    await expect(tab.locator('[data-pick-sum]')).toContainText('будет снято 1');
    await tab.getByRole('button', { name: 'Применить' }).click();

    const ask = page.getByRole('dialog', { name: 'Изменить отчёты контрагента?' });
    await expect(ask).toContainText('Будет снято: Утильсбор произв.');
    await expect(ask).toContainText('Удалится несданных отчётов текущего и будущих периодов: 1.');
    await expect(ask).toContainText('Отчёты прошлых периодов не меняются.');
    await ask.getByRole('button', { name: 'Сохранить' }).click();
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'Отчёты изменены: добавлено 0, снято 1, удалено отчётов 1' }),
    ).toBeVisible();
    await expect(box(tab, 'utlq')).not.toBeChecked();
    await expect(row(tab, 'utlq')).not.toContainText('Назначен');

    expect((await reportsOf(page.request, cp.inn)).map((r) => r.periodStart)).toEqual([prev]);
  });
});
