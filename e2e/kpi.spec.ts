import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { newOrgOwner, uniqueInn } from './helpers';

// «Показатели контрагентов» (задача 2.27, #83). Месяцы считаются от сегодняшнего дня по Бишкеку, а
// каждый тест — со своей новой организацией (`newOrgOwner`): показатели у неё выключены, пока владелец
// не включит их, а незаполненные месяцы не смешиваются с демо-организацией и другими тестами.

/** Месяц «ГГГГ-ММ» на `shift` месяцев от текущего по Бишкеку (UTC+6). */
function monthAt(shift: number): string {
  const now = new Date(Date.now() + 6 * 3_600_000);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + shift, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const MONTHS = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
];

/** «сентябрь 2026» — как месяц назван в «Не заполнено». */
const monthName = (m: string) => `${MONTHS[Number(m.slice(5)) - 1]!} ${m.slice(0, 4)}`;

/** Сотые: 100 чел. → 10000, 500 000 сом → 50000000. */
const hundredths = (n: number) => n * 100;

type Indicator = {
  id: string;
  name: string;
  unit: string;
  type: string;
  total: string;
  description: string;
  required: boolean;
  dueDay: number;
  start: string;
  scope: 'all' | 'selected';
  autoNew: boolean;
  version: number;
};

interface KpiOrg {
  origin: string;
  /** Номер контрагента по названию. */
  contractors: Record<string, string>;
  /** Номер показателя-примера по названию. */
  indicators: Record<string, string>;
}

/** Включить «Показатели контрагентов» в учётной политике. */
async function enableIndicators(api: APIRequestContext, origin: string) {
  const policy = (await (await api.get('/api/org/policy')).json()) as { version: number };
  const res = await api.patch('/api/org/policy', {
    headers: { origin },
    data: { version: policy.version, features: { indicators: true } },
  });
  expect(res.status(), await res.text()).toBe(200);
}

/** Новый контрагент на ОНР (`РЕЖ-01`) или едином налоге (`РЕЖ-03`), обслуживается год. */
async function addContractor(
  api: APIRequestContext,
  origin: string,
  name: string,
  regimeCode: 'РЕЖ-01' | 'РЕЖ-03',
) {
  const staff = (await (await api.get('/api/staff?size=all')).json()) as {
    items: { id: string }[];
  };
  const res = await api.post('/api/contractors', {
    headers: { origin },
    data: {
      name,
      inn: `0${uniqueInn().slice(1)}`,
      phone: '+996505890076',
      kind: 'regular',
      formCode: 'ФС-01',
      regimeCode,
      gked: '46.34.0',
      startDate: `${monthAt(-12)}-01`,
      responsibleEmployeeId: staff.items[0]!.id,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/**
 * Организация с включёнными показателями и контрагентами. Показатели-примеры «Выручка» и «Количество
 * сотрудников» новая организация получает сама, «Вести с» — месяц её создания.
 */
async function kpiOrg(
  api: APIRequestContext,
  baseURL: string | undefined,
  contractors: Record<string, 'РЕЖ-01' | 'РЕЖ-03'>,
): Promise<KpiOrg> {
  const origin = new URL(baseURL!).origin;
  await newOrgOwner(api, origin);
  await enableIndicators(api, origin);
  const ids: Record<string, string> = {};
  for (const [name, regime] of Object.entries(contractors)) {
    ids[name] = await addContractor(api, origin, name, regime);
  }
  const list = (await (await api.get('/api/kpi/indicators')).json()) as { items: Indicator[] };
  return {
    origin,
    contractors: ids,
    indicators: Object.fromEntries(list.items.map((i) => [i.name, i.id])),
  };
}

/** Сохранить показатель с изменёнными полями. */
async function editIndicator(
  api: APIRequestContext,
  org: KpiOrg,
  name: string,
  patch: Partial<Indicator> & { selected?: string[] },
) {
  const card = (await (
    await api.get(`/api/kpi/indicators/${org.indicators[name]!}`)
  ).json()) as Indicator & { selected: string[] };
  const res = await api.put(`/api/kpi/indicators/${card.id}`, {
    headers: { origin: org.origin },
    data: {
      name: card.name,
      unit: card.unit,
      type: card.type,
      total: card.total,
      description: card.description,
      required: card.required,
      dueDay: card.dueDay,
      start: card.start,
      scope: card.scope,
      autoNew: card.autoNew,
      selected: card.selected,
      version: card.version,
      ...patch,
    },
  });
  expect(res.status(), await res.text()).toBe(200);
}

async function putValues(
  api: APIRequestContext,
  org: KpiOrg,
  values: { contractor: string; indicator: string; month: string; value: number }[],
) {
  const res = await api.put('/api/kpi/values', {
    headers: { origin: org.origin },
    data: {
      values: values.map((v) => ({
        contractorId: org.contractors[v.contractor]!,
        indicatorId: org.indicators[v.indicator]!,
        month: v.month,
        value: v.value,
      })),
    },
  });
  expect(res.status(), await res.text()).toBe(200);
}

type Summary = { overdue: boolean; contractors: { contractorId: string; months: string[] }[] };

async function summary(api: APIRequestContext): Promise<Summary> {
  const res = await api.get('/api/kpi/missing-summary');
  expect(res.status()).toBe(200);
  return (await res.json()) as Summary;
}

/** Строки списка (на телефоне — карточки) с текстом. */
const rows = (page: Page, text: string) =>
  page.locator('[data-grid] [data-id]').filter({ hasText: text });

/**
 * Счётчик модуля: на ПК — у «Показатели контрагентов» в меню слева; на телефоне модуль в «Других
 * модулях», поэтому цвет повторяет точка на кнопке «Меню».
 */
async function expectModuleCount(page: Page, isMobile: boolean, tone: 'red' | 'yellow') {
  if (isMobile) {
    const menu = page.getByRole('button', { name: 'Меню', exact: true });
    await expect(menu.locator(`[data-tone="${tone}"]`)).toBeVisible();
  } else {
    const link = page.locator('aside').getByRole('link', { name: /^Показатели контрагентов/ });
    await expect(link.locator(`[data-tone="${tone}"]`)).toBeVisible();
  }
}

test.describe('Этап 2: Показатели контрагентов', () => {
  test('(п. 63) «Выручка» ведётся 9 месяцев, внесены два последних: счётчик модуля красный; внесли значение за ранний месяц — незаполненных меньше; месяцы до «Вести с» не считаются', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const api = page.request;
    const org = await kpiOrg(api, baseURL, { 'ОсОО «Ведётся с начала»': 'РЕЖ-01' });
    const cp = 'ОсОО «Ведётся с начала»';
    await editIndicator(api, org, 'Выручка', { start: monthAt(-9) });
    await putValues(api, org, [
      { contractor: cp, indicator: 'Выручка', month: monthAt(-2), value: hundredths(500_000) },
      { contractor: cp, indicator: 'Выручка', month: monthAt(-1), value: hundredths(600_000) },
    ]);
    const missing = [-9, -8, -7, -6, -5, -4, -3].map(monthAt);
    const before = await summary(api);
    expect(before.overdue).toBe(true);
    expect(before.contractors.find((c) => c.contractorId === org.contractors[cp])!.months).toEqual(
      missing,
    );

    // «Не заполнено»: семь месяцев, раньше «Вести с» — ни одного.
    await page.goto('/app/kpi/missing');
    await expectModuleCount(page, isMobile, 'red');
    await expect(rows(page, cp)).toHaveCount(missing.length);
    await expect(rows(page, monthName(monthAt(-10)))).toHaveCount(0);

    // «Ввод за месяц»: выбрали ранний месяц и внесли значение.
    const early = monthAt(-7);
    await page.goto('/app/kpi/month');
    await page.locator('[data-kpi-month-pick]').click();
    await page.locator(`[data-kpi-choice="${early}"]`).click();
    await expect(page.locator(`[data-kpi-month="${early}"]`)).toBeVisible();
    if (isMobile) {
      await page.locator(`[data-kpi-tile="${org.contractors[cp]}"]`).click();
      const entry = page.getByRole('dialog', { name: cp });
      await entry.getByLabel('Значение, сом').fill('450 000');
      await entry.getByRole('button', { name: 'Сохранить' }).click();
      await expect(entry).toBeHidden();
    } else {
      const cell = page.getByRole('textbox', { name: `${cp}: Выручка` });
      await cell.fill('450 000');
      await cell.press('Enter');
    }
    await expect
      .poll(
        async () =>
          (await summary(api)).contractors.find((c) => c.contractorId === org.contractors[cp])
            ?.months.length,
      )
      .toBe(missing.length - 1);

    await page.goto('/app/kpi/missing');
    await expect(rows(page, cp)).toHaveCount(missing.length - 1);
    await expectModuleCount(page, isMobile, 'red');

    // Значение за месяц раньше «Вести с» вносить можно, незаполненным такой месяц не становится.
    await putValues(api, org, [
      { contractor: cp, indicator: 'Выручка', month: monthAt(-11), value: hundredths(1) },
    ]);
    expect(
      (await summary(api)).contractors.find((c) => c.contractorId === org.contractors[cp])!.months,
    ).toEqual(missing.filter((m) => m !== early));
  });

  test('(п. 23) пустой месяц — не ноль: 100 чел. и один пустой месяц — среднее 100 «по 1 из 2», месяц в «Не заполнено»', async ({
    page,
    baseURL,
  }) => {
    const api = page.request;
    const cp = 'ОсОО «Среднее без нулей»';
    const org = await kpiOrg(api, baseURL, { [cp]: 'РЕЖ-01' });
    const [first, second] = [monthAt(-2), monthAt(-1)];
    await editIndicator(api, org, 'Количество сотрудников', { start: first });
    await putValues(api, org, [
      { contractor: cp, indicator: 'Количество сотрудников', month: first, value: hundredths(100) },
    ]);

    await page.goto('/app/kpi/period');
    const main = page.locator('main');
    await main.getByLabel('С', { exact: true }).fill(first);
    await main.getByLabel('по', { exact: true }).fill(second);
    const row = rows(page, cp).filter({ hasText: 'Количество сотрудников' });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('по 1 из 2');
    await expect(row.locator(`[data-kpi-cell$="|${first}"]`)).toHaveText('100');
    await expect(row.locator(`[data-kpi-cell$="|${second}"]`)).toHaveText('пусто');

    await page.goto('/app/kpi/missing');
    await expect(rows(page, cp)).toHaveCount(1);
    await expect(rows(page, cp)).toContainText(monthName(second));
  });

  test('(п. 44) «Выручка» «Выбранным» — только ОНР: у контрагента на едином налоге ячейка серая, в «Не заполнено» его нет; новый контрагент на ОНР включён сам', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const api = page.request;
    const onr = 'ОсОО «Общий режим»';
    const en = 'ОсОО «Единый налог»';
    const org = await kpiOrg(api, baseURL, { [onr]: 'РЕЖ-01', [en]: 'РЕЖ-03' });
    await editIndicator(api, org, 'Выручка', { start: monthAt(-2) });

    // «Настройка показателей» → «Выручка» → «Выбранным», отмечен только контрагент на ОНР.
    await page.goto('/app/kpi/setup');
    await page.locator('[data-kpi-indicator="Выручка"]').click();
    const dialog = page.getByRole('dialog', { name: 'Показатель «Выручка»' });
    await dialog.getByRole('button', { name: 'Выбранным', exact: true }).click();
    // Окно уже ведущегося показателя: отмечены те, у кого он ведётся сейчас, — оставляем только ОНР.
    await dialog.getByRole('checkbox', { name: new RegExp(`^${en}`) }).uncheck();
    await expect(dialog.getByRole('checkbox', { name: new RegExp(`^${onr}`) })).toBeChecked();
    await expect(
      dialog.getByRole('checkbox', { name: 'Включать новых контрагентов автоматически' }),
    ).toBeChecked();
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(dialog).toBeHidden();

    // «Ввод за месяц»: у контрагента на едином налоге «Выручка» не ведётся — ячейка серая.
    await page.goto('/app/kpi/month');
    await page.locator('[data-kpi-month-pick]').click();
    await page.locator(`[data-kpi-choice="${monthAt(-2)}"]`).click();
    await expect(page.locator(`[data-kpi-month="${monthAt(-2)}"]`)).toBeVisible();
    if (isMobile) {
      await page.locator(`[data-kpi-tile="${org.contractors[en]!}"]`).click();
      const entry = page.getByRole('dialog', { name: en });
      await expect(entry.locator(`[data-kpi-item="${org.indicators['Выручка']!}"]`)).toHaveCount(0);
      await entry.getByRole('button', { name: 'Отмена' }).click();
      await page.locator(`[data-kpi-tile="${org.contractors[onr]!}"]`).click();
      const own = page.getByRole('dialog', { name: onr });
      await expect(own.locator(`[data-kpi-item="${org.indicators['Выручка']!}"]`)).toHaveCount(1);
      await own.getByRole('button', { name: 'Отмена' }).click();
    } else {
      await expect(
        page.locator(`[data-kpi-row="${org.contractors[en]!}"] [data-kpi-off]`),
      ).toHaveCount(1);
      await expect(
        page.locator(`[data-kpi-row="${org.contractors[onr]!}"] [data-kpi-off]`),
      ).toHaveCount(0);
    }

    // «Не заполнено»: контрагент на ОНР есть, на едином налоге — нет.
    await page.goto('/app/kpi/missing');
    await expect(rows(page, onr).first()).toBeVisible();
    await expect(rows(page, en)).toHaveCount(0);

    // Новый контрагент на ОНР — «Выручка» у него ведётся сама.
    const fresh = 'ОсОО «Новый на ОНР»';
    org.contractors[fresh] = await addContractor(api, org.origin, fresh, 'РЕЖ-01');
    await page.reload();
    await expect(rows(page, fresh).first()).toBeVisible();
    await expect(rows(page, en)).toHaveCount(0);
  });

  test('(п. 49) владелец включает «Показатели контрагентов»: окно с «Пройти урок»; в программе шаги показателей с «Новое», процент уменьшается, уровень прежний', async ({
    page,
    baseURL,
  }) => {
    const api = page.request;
    const origin = new URL(baseURL!).origin;
    await newOrgOwner(api, origin);
    // Что-то уже пройдено — процент больше нуля. Шаг «Включить нужные функции» засчитывается
    // любым переключением функции, поэтому он выполнен заранее: иначе включение показателей само
    // добавило бы выполненный шаг.
    expect((await api.post('/api/kb/hits/search', { headers: { origin } })).status()).toBe(200);
    const policy = (await (await api.get('/api/org/policy')).json()) as { version: number };
    const calendarOff = await api.patch('/api/org/policy', {
      headers: { origin },
      data: { version: policy.version, features: { calendar: false } },
    });
    expect(calendarOff.status(), await calendarOff.text()).toBe(200);
    const synced = await api.post('/api/kb/sync', {
      headers: { origin },
      data: { reason: 'open' },
    });
    expect(synced.status(), await synced.text()).toBe(200);
    type Me = { progress: { pct: number; level: number } };
    const before = (await (await api.get('/api/kb/me')).json()) as Me;
    expect(before.progress.pct).toBeGreaterThan(0);

    await page.goto('/app/org/policy');
    await page.locator('main [data-feat-row="indicators"]').getByRole('switch').click();
    const on = page.getByRole('dialog', { name: 'Функция «Показатели контрагентов» включена' });
    await expect(on).toBeVisible();
    await expect(on.getByRole('button', { name: 'Пройти урок' })).toBeVisible();

    const after = (await (await api.get('/api/kb/me')).json()) as Me;
    expect(after.progress.pct).toBeLessThan(before.progress.pct);
    expect(after.progress.level).toBe(before.progress.level);

    // «Пройти урок» открывает «Уроки» и сразу показывает первый шаг показателей (задача 2.31).
    await on.getByRole('button', { name: 'Пройти урок' }).click();
    const bubble = page.locator('[data-tour-bubble]');
    await expect(bubble.locator('b').first()).toHaveText('Настроить показатели');
    await expect(page.locator('[data-tour-count]')).toHaveText(/^1 из \d+$/);
    await bubble.getByRole('button', { name: 'Закончить показ', exact: true }).last().click();
    await expect(bubble).toHaveCount(0);
    await page.goto('/app/kb/lessons');
    for (const id of ['kset', 'kwho', 'kval', 'kper', 'kchk']) {
      const step = page.locator(`[data-kb-step="${id}"]`);
      await expect(step).toHaveAttribute('data-kb-state', 'open');
      await expect(step).toContainText('Новое');
    }
  });

  test('(проверка задачи) новый показатель в «Настройке показателей» и «Кому вести»: выключенный у контрагента показатель виден в «За период» с пометкой «Не ведётся с …»', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const api = page.request;
    const cp = 'ОсОО «Доля экспорта»';
    const org = await kpiOrg(api, baseURL, { [cp]: 'РЕЖ-01' });

    // «+ Добавить» → «Показатель»: процент, «Последнее значение», ведётся с прошлого месяца.
    await page.goto('/app/kpi/setup');
    // На ПК «Ввод из Excel» — своя кнопка в строке вкладок, и «+ Добавить» сразу открывает показатель;
    // на телефоне оба способа — в меню «+ Добавить».
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    if (isMobile) {
      await page
        .getByRole('menu', { name: 'Добавить' })
        .getByRole('menuitem', { name: 'Показатель', exact: true })
        .click();
    }
    const dialog = page.getByRole('dialog', { name: 'Новый показатель' });
    await dialog.getByLabel('Название').fill('Доля экспорта');
    await dialog.getByLabel('Единица').selectOption('%');
    await dialog.getByLabel('Тип значения').selectOption('pct');
    await dialog.getByLabel('Основной итог').selectOption('last');
    await dialog.getByLabel('Вести с').fill(monthAt(-1));
    await dialog.getByRole('button', { name: 'Создать показатель' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('[data-kpi-indicator="Доля экспорта"]')).toBeVisible();
    const list = (await (await api.get('/api/kpi/indicators')).json()) as { items: Indicator[] };
    org.indicators['Доля экспорта'] = list.items.find((i) => i.name === 'Доля экспорта')!.id;
    await putValues(api, org, [
      { contractor: cp, indicator: 'Доля экспорта', month: monthAt(-1), value: hundredths(12) },
    ]);

    // «Кому вести»: выключили показатель у контрагента.
    await page.locator('[data-kpi-setup-view]').getByRole('button', { name: 'Кому вести' }).click();
    if (isMobile) {
      await page.locator('main').getByLabel('Показатель').selectOption({ label: 'Доля экспорта' });
    }
    const cell = page.getByRole(isMobile ? 'switch' : 'checkbox', {
      name: `${cp}: вести «Доля экспорта»`,
    });
    await expect(cell).toBeChecked();
    await cell.click();
    await expect(cell).not.toBeChecked();
    await expect
      .poll(async () => {
        const who = (await (await api.get('/api/kpi/who')).json()) as {
          contractors: { name: string; cells: { indicatorId: string; on: boolean }[] }[];
        };
        return who.contractors
          .find((c) => c.name === cp)!
          .cells.find((x) => x.indicatorId === org.indicators['Доля экспорта'])!.on;
      })
      .toBe(false);

    // «За период»: значение осталось, у строки пометка «Не ведётся с <месяц>».
    await page.goto('/app/kpi/period');
    const row = rows(page, cp).filter({ hasText: 'Доля экспорта' });
    await expect(row).toContainText('Не ведётся с');
    await expect(row.locator(`[data-kpi-cell$="|${monthAt(-1)}"]`)).toHaveText('12');
  });
});
