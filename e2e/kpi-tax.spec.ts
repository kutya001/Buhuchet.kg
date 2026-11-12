import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { DEMO_PASSWORD, signIn } from './helpers';
import {
  asOwner,
  assign,
  find,
  manualReport,
  newContractor,
  reportsOf,
  type NewContractor,
} from './reports';

// Показатели «для расчёта налогов» и «Расчёт по показателям» в окнах «Сумма к уплате» и «Отметить сданным»
// (прототип v80 modules/kpi-tax.js; docs/deviations.md п. О-62) через настоящий сайт. Демо-организация: «Показатели
// контрагентов» включены, отметки стоят у показателей «Выручка», «Фонд оплаты труда» и «Количество
// сотрудников». Значения вносятся только своему на каждый запуск и проект (ПК и телефон) контрагенту.

const PERIOD = '2026-09-01';
const MONTH = '2026-09';

type TaxBox = {
  box: {
    main: 'rev' | 'fot';
    rows: {
      role: string;
      on: boolean;
      cells: { month: string; value: number | null; input: boolean }[];
    }[];
    result: { kind: string; incomeTax?: number; contributions?: number; revenue?: number };
  } | null;
};

async function taxBox(api: APIRequestContext, reportId: string): Promise<TaxBox> {
  const res = await api.get(`/api/kpi/tax/${reportId}`);
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as TaxBox;
}

/** Карточка отчёта из списка с фильтром «ИНН и период». */
async function openCard(
  page: Page,
  cp: NewContractor,
  name: string,
  reportId: string,
  typeName: string,
  period = PERIOD,
) {
  const preset = encodeURIComponent(
    JSON.stringify({
      inn: { type: 'text', q: cp.inn },
      period: { type: 'enum', vals: [period] },
    }),
  );
  await page.goto(`/app/reports/all?preset=${preset}`);
  const row = page.locator(`[data-grid] [data-id="${reportId}"]`);
  await expect(row).toHaveCount(1);
  await row.getByText(name).first().click();
  const card = page.getByRole('dialog', { name: typeName });
  await expect(card.locator(`[data-report-card="${reportId}"]`)).toBeVisible();
  return card;
}

/** Карточка отчёта → «Ещё действия» → «Указать сумму». */
async function openAmount(
  page: Page,
  cp: NewContractor,
  name: string,
  reportId: string,
  typeName: string,
) {
  const card = await openCard(page, cp, name, reportId, typeName);
  await card.locator('[data-report-more]').click();
  await page
    .getByRole('menu', { name: 'Ещё действия' })
    .getByRole('menuitem', { name: 'Указать сумму' })
    .click();
  return page.getByRole('dialog', { name: 'Сумма к уплате' });
}

const toast = (page: Page, text: string | RegExp) =>
  page.getByRole('status').filter({ hasText: text }).first();

test.describe('Этап 3: «Расчёт по показателям» в окнах отчёта (прототип v80)', () => {
  test('Соцфонд: ФОТ вносится в окне «Сумма к уплате» и пишется в показатели, подоходный налог и взносы подставляются в строки платежей кнопкой «Подставить в сумму»', async ({
    page,
    request,
    baseURL,
  }) => {
    const origin = await asOwner(request, baseURL);
    const name = `ОсОО «Расчёт ФОТ ${Date.now() % 1_000_000}»`;
    const cp = await newContractor(request, origin, { name });
    // Назначение «Соцфонд» с сентября 2026: у контрагента появляется тариф Соцфонда (по условиям).
    await assign(request, origin, {
      contractorId: cp.id,
      reportTypeCode: 'soc',
      fromMonth: PERIOD,
    });
    const soc = find(await reportsOf(request, cp.inn), 'soc', PERIOD)!.id;
    const before = await taxBox(request, soc);
    expect(before.box?.main).toBe('fot');
    expect(before.box?.rows.map((r) => r.role)).toEqual(['fot', 'emp']);
    expect(before.box?.result.kind).toBe('missing');

    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    const dialog = await openAmount(page, cp, name, soc, 'Подоходный налог и взносы в Соцфонд');
    const box = dialog.locator('[data-kpi-tax-box="fot"]');
    await expect(box).toContainText('Расчёт по показателям');
    await expect(box).toContainText('ФОТ — база подоходного налога и взносов');
    await expect(box.locator('[data-kpi-tax-result="missing"]')).toContainText(
      'Нет значения «Фонд оплаты труда» за сентябрь 2026 — внесите выше, расчёт появится сам.',
    );

    // Не число — значение не пишется.
    const cell = box.locator(`[data-kpi-tax-cell="fot:${MONTH}"]`);
    await cell.fill('много');
    await cell.press('Enter');
    await expect(toast(page, '«много» — не число')).toBeVisible();
    await expect(cell).toHaveValue('');

    await cell.fill('500 000');
    await cell.press('Enter');
    await expect(
      toast(page, '«Фонд оплаты труда», сентябрь 2026: записано в показатели'),
    ).toBeVisible();
    // Условия тарифа Соцфонда у контрагента не отмечены — расчёта взносов нет.
    await expect(box.locator('[data-kpi-tax-result="no_tariff"]')).toContainText(
      'Тариф Соцфонда не определён — укажите его в карточке контрагента, тогда появится расчёт взносов',
    );
    await expect(box.locator('[data-kpi-tax-fill]')).toHaveCount(0);
    const fresh = (await (await request.get(`/api/contractors/${cp.id}`)).json()) as {
      version: number;
    };
    const tariff = await request.put(`/api/contractors/${cp.id}/socfund`, {
      headers: { origin },
      data: {
        version: fresh.version,
        flags: { pay: 'card', registry: true, confirmed: true, gov: false },
      },
    });
    expect(tariff.status(), await tariff.text()).toBe(200);

    const again = await openAmount(page, cp, name, soc, 'Подоходный налог и взносы в Соцфонд');
    const result = again.locator('[data-kpi-tax-box="fot"] [data-kpi-tax-result="socfund"]');
    await expect(result).toContainText('Подоходный налог ≈');
    await expect(result).toContainText('Страховые взносы ≈');

    // Значение — в показателях контрагента, расчёт — с сервера.
    const after = await taxBox(request, soc);
    expect(after.box?.rows[0]?.cells).toEqual([{ month: MONTH, value: 50_000_000, input: true }]);
    const { incomeTax, contributions } = after.box!.result;
    expect(incomeTax).toBeGreaterThan(0);
    expect(contributions).toBeGreaterThan(0);

    await result.locator('[data-kpi-tax-fill="sum"]').click();
    await expect(toast(page, 'Подставлено из показателей — проверьте и сохраните')).toBeVisible();
    const digits = async (selector: string) =>
      Number((await again.locator(selector).inputValue()).replace(/\D/g, '')) * 100;
    expect(await digits('[data-line-tax="pay:0"]')).toBe(incomeTax);
    expect(await digits('[data-line-tax="pay:1"]')).toBe(contributions);
    expect(await digits('[data-report-amount]')).toBe(incomeTax! + contributions!);

    await again.locator('[data-report-ok]').click();
    await expect(again).toBeHidden();
    await expect(toast(page, 'Сумма сохранена')).toBeVisible();
    const saved = await request.get(`/api/reports/${soc}`);
    expect(((await saved.json()) as { amount: number }).amount).toBe(incomeTax! + contributions!);
  });

  test('НДС: выручка из показателей показана справочно — суммы и кнопки «Подставить» нет; у отчёта «Сдача» блока нет', async ({
    page,
    request,
    baseURL,
  }) => {
    const origin = await asOwner(request, baseURL);
    const name = `ОсОО «Расчёт НДС ${Date.now() % 1_000_000}»`;
    const cp = await newContractor(request, origin, { name });
    const report = (reportTypeCode: string) =>
      manualReport(request, origin, {
        contractorId: cp.id,
        reportTypeCode,
        month: PERIOD,
        due: '2030-01-15',
      });
    const nds = await report('nds');
    const t1 = await report('t1m');
    expect((await taxBox(request, t1)).box).toBeNull();
    const indicator = (
      (await (await request.get('/api/kpi/indicators')).json()) as {
        items: { id: string; taxRole: string | null; archived: boolean }[];
      }
    ).items.find((i) => i.taxRole === 'rev' && !i.archived);
    expect(indicator).toBeTruthy();
    const put = await request.put('/api/kpi/values', {
      headers: { origin },
      data: {
        values: [
          { contractorId: cp.id, indicatorId: indicator!.id, month: MONTH, value: 120_000_000 },
        ],
      },
    });
    expect(put.status(), await put.text()).toBe(200);

    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    const dialog = await openAmount(page, cp, name, nds, 'НДС');
    const box = dialog.locator('[data-kpi-tax-box="rev"]');
    await expect(box).toContainText('выручка — база налога');
    await expect(box.locator(`[data-kpi-tax-cell="rev:${MONTH}"]`)).toHaveValue(/^1\s200\s000$/);
    await expect(box.locator('[data-kpi-tax-result="no_rate"]')).toContainText(
      /Выручка за период — 1\s200\s000\sсом\. НДС к уплате зависит от зачёта входящего НДС — сумму впишите сами\./,
    );
    await expect(box.locator('[data-kpi-tax-fill]')).toHaveCount(0);
  });

  test('Налог с продаж: показатель включается у контрагента кнопкой «Вести», выручка вносится по месяцам квартала, налог по ставке назначения подставляется в сумму в окне «Отметить сданным»', async ({
    page,
    request,
    baseURL,
  }) => {
    const quarter = '2026-07-01';
    const months = ['2026-07', '2026-08', '2026-09'];
    const origin = await asOwner(request, baseURL);
    const name = `ОсОО «Расчёт НсП ${Date.now() % 1_000_000}»`;
    const cp = await newContractor(request, origin, { name });
    await assign(request, origin, {
      contractorId: cp.id,
      reportTypeCode: 'nspq',
      rate: '2 %',
      fromMonth: quarter,
    });
    const nsp = find(await reportsOf(request, cp.inn), 'nspq', quarter)!;
    const indicator = (
      (await (await request.get('/api/kpi/indicators')).json()) as {
        items: { id: string; name: string; taxRole: string | null; archived: boolean }[];
      }
    ).items.find((i) => i.taxRole === 'rev' && !i.archived)!;
    // «Выручка» у контрагента не ведётся.
    const off = await request.put('/api/kpi/who', {
      headers: { origin },
      data: { changes: [{ indicatorId: indicator.id, contractorId: cp.id, on: false }] },
    });
    expect(off.status(), await off.text()).toBe(200);
    expect((await taxBox(request, nsp.id)).box?.rows[0]).toMatchObject({ role: 'rev', on: false });

    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    const card = await openCard(
      page,
      cp,
      name,
      nsp.id,
      'Налог с продаж, квартальный (малый бизнес, до 8 млн сом)',
      quarter,
    );
    await card.locator('[data-report-button="submit"]').click();
    const dialog = page.getByRole('dialog', { name: 'Отметить отчёт сданным' });
    const box = dialog.locator('[data-kpi-tax-box="rev"]');
    await expect(box).toContainText('не ведётся');
    await expect(box.locator('[data-kpi-tax-cell]')).toHaveCount(0);
    await box.locator('[data-kpi-tax-on="rev"]').click();
    await expect(toast(page, `«${indicator.name}»: ведётся у ${name}`)).toBeVisible();
    await expect(box.locator('[data-kpi-tax-on]')).toHaveCount(0);
    await expect(box.locator('[data-kpi-tax-cell]')).toHaveCount(3);

    for (const [k, month] of months.entries()) {
      const cell = box.locator(`[data-kpi-tax-cell="rev:${month}"]`);
      await cell.fill(`${k + 1}00 000`);
      await cell.press('Enter');
      await expect(cell).toHaveValue(new RegExp(`^${k + 1}00\\s000$`));
    }
    const result = box.locator('[data-kpi-tax-result="rate"]');
    await expect(result).toContainText(/≈ 12\s000\sсом/);
    await expect(result).toContainText(/2 % от выручки 600\s000\sсом/);

    // Показатель включён с первого месяца квартала, значения — в показателях.
    const after = await taxBox(request, nsp.id);
    expect(after.box?.rows[0]).toMatchObject({
      on: true,
      cells: months.map((month, k) => ({ month, value: (k + 1) * 10_000_000, input: true })),
    });

    await result.locator('[data-kpi-tax-fill="sum"]').click();
    await expect(toast(page, 'Подставлено из показателей — проверьте и сохраните')).toBeVisible();
    await expect(dialog.locator('[data-report-amount]')).toHaveValue(/^12\s000$/);
  });

  test('«Настройка показателей»: у показателя метка «для налогов», вторая такая же отметка не сохраняется', async ({
    page,
    request,
    baseURL,
  }) => {
    const origin = await asOwner(request, baseURL);
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    await page.goto('/app/kpi/setup');
    const list = page.locator('[data-kpi-setup-list]');
    await expect(list.locator('[data-kpi-tax-pill="rev"]')).toHaveText('для налогов: Выручка');
    await expect(list.locator('[data-kpi-tax-pill="fot"]')).toHaveText('для налогов: ФОТ');
    await expect(list.locator('[data-kpi-tax-pill="emp"]')).toHaveText('для налогов: Численность');

    await list.getByText('Доля экспорта', { exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Показатель «Доля экспорта»' });
    const role = dialog.locator('[data-kpi-tax-role]');
    await expect(role).toHaveValue('');
    await role.selectOption('rev');
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(dialog).toContainText('Эта отметка уже у показателя «Выручка»: снимите её там');
    await expect(dialog).toBeVisible();
  });
});
