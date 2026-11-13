import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { DEMO_PASSWORD, signIn } from './helpers';
import { asOwner, newContractor } from './reports';

// Бонусы сотрудников за разовые услуги (прототип v84 и v87, docs/deviations.md п. О-75) через
// настоящий сайт. Владелец демо-организации erkin добавляет разовую услугу с бонусом сотруднику: до
// полной оплаты бонус «ожидает оплаты» и в остаток не входит, после полной оплаты начислен; затем
// «Списать бонус» во вкладке «Сотрудники» → «Бонусы» и «Отменить списание» в «Начислениях и
// списаниях». Сотрудник и контрагент — свои на каждый запуск и проект (ПК и телефон).

type Sums = { cp: number; svc: number; wait: number; out: number; bal: number };

/** Слово из кириллицы, своё на каждый запуск: по нему поиск находит только записи теста. */
const uniqueWord = (prefix: string) =>
  `${prefix}${Array.from({ length: 6 }, () => 'абвгдежзиклмнопрстуф'[Math.floor(Math.random() * 20)]).join('')}`;

const uniqueLogin = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

/** Сумма на экране — с неразрывными пробелами: «1 000». */
const som = (text: string) =>
  new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s'));

/** Общий поиск по вкладке (на телефоне — кнопкой «Поиск» в верхней панели). */
async function search(page: Page, isMobile: boolean, text: string) {
  if (isMobile) await page.getByRole('button', { name: 'Поиск', exact: true }).click();
  await page.getByRole('searchbox').first().fill(text);
}

/** Владелец создаёт сотрудника с ролью «Бухгалтер» и своим ФИО. */
async function hire(owner: APIRequestContext, origin: string, fullName: string) {
  const roles = (await (await owner.get('/api/roles?size=all')).json()) as {
    items: { id: string; name: string }[];
  };
  const res = await owner.post('/api/staff', {
    headers: { origin },
    data: {
      fullName,
      login: uniqueLogin('e2e-bonus'),
      roleId: roles.items.find((r) => r.name === 'Бухгалтер')!.id,
    },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { employee: { id: string } }).employee.id;
}

/** Суммы бонусов сотрудника — как в окне «Бонусы: начисления и списания». */
async function sumsOf(api: APIRequestContext, employeeId: string): Promise<Sums> {
  const res = await api.get(`/api/bonuses/employees/${employeeId}`);
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as Sums;
}

test.describe('Бонусы сотрудников за разовые услуги', () => {
  test('(прототип v84 и v87) услуга с бонусом: до полной оплаты бонус ожидает и в остаток не входит, после оплаты начислен; «Списать бонус» уменьшает остаток, «Отменить списание» возвращает', async ({
    page,
    request,
    baseURL,
    isMobile,
  }) => {
    test.slow();
    const origin = await asOwner(request, baseURL);
    const word = uniqueWord('Бонус');
    const fio = `${word} Сквозной Тестович`;
    const cp = await newContractor(request, origin, { name: `ОсОО «${word}»`, tariffAmount: 0 });
    const employeeId = await hire(request, origin, fio);
    const service = `Восстановление учёта ${word}`;

    // «Разовая услуга» с бонусом: первая строка «Добавить бонус», сотрудник и сумма.
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    await page.goto('/app/fin/proj');
    await expect(page.locator('[data-grid]')).toBeVisible();
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    await page
      .getByRole('menu', { name: 'Добавить' })
      .getByRole('menuitem', { name: 'Разовая услуга' })
      .click();
    const add = page.getByRole('dialog', { name: 'Разовая услуга' });
    await add.locator('[data-svc-cp]').selectOption(cp.id);
    await add.locator('[data-svc-name]').fill(service);
    await add.locator('[data-svc-amount]').fill('5000');
    await add.locator('[data-svc-bonus-add]').click();
    await add.locator('[data-svc-bonus-emp]').selectOption(employeeId);

    // Бонусов больше стоимости услуги — отказ под блоком, услуга не сохранена.
    await add.locator('[data-svc-bonus-amount]').fill('6000');
    await add.locator('[data-svc-ok]').click();
    await expect(add.locator('[data-svc-bonus-error]')).toBeVisible();
    await add.locator('[data-svc-bonus-amount]').fill('1000');
    await add.locator('[data-svc-ok]').click();
    await expect(add).toBeHidden();
    await expect(
      page.getByRole('status').filter({ hasText: 'Разовая услуга добавлена' }),
    ).toBeVisible();

    // До оплаты: в карточке услуги бонус ждёт оплаты, в остаток сотрудника не входит.
    expect(await sumsOf(request, employeeId)).toMatchObject({ svc: 0, wait: 100_000, bal: 0 });
    await search(page, isMobile, word);
    const line = page.locator('[data-grid] [data-id^="svc:"]');
    await expect(line).toHaveCount(1);
    await line.getByText(`ОсОО «${word}»`).first().click();
    const card = page.getByRole('dialog', { name: service });
    const box = card.locator('[data-svc-bonus-box]');
    await expect(box).toContainText(fio);
    await expect(box).toContainText(som('1 000 сом'));
    await expect(box).toContainText('Ожидают оплаты услуги');

    // Частичная оплата бонус не начисляет, полная — начисляет.
    const payOf = async (amount: string) => {
      await card.locator('[data-svc-pay-btn]').click();
      const pay = page.getByRole('dialog', { name: 'Оплата разовой услуги' });
      await pay.locator('[data-svc-amount]').fill(amount);
      await pay.locator('[data-svc-ok]').click();
      await expect(pay).toBeHidden();
    };
    await payOf('2000');
    await expect(card).toContainText('Оплачено частично');
    await expect(box).toContainText('Ожидают оплаты услуги');
    expect(await sumsOf(request, employeeId)).toMatchObject({ svc: 0, wait: 100_000, bal: 0 });
    await payOf('3000');
    await expect(box).toContainText('Начислены');
    expect(await sumsOf(request, employeeId)).toMatchObject({
      svc: 100_000,
      wait: 0,
      bal: 100_000,
    });

    // «Сотрудники» → «Бонусы» → «Остатки»: «Списать» в строке сотрудника.
    await page.goto('/app/staff/bonus');
    await search(page, isMobile, word);
    const balance = page.locator(`[data-bonus-balances] [data-id="${employeeId}"]`);
    await expect(balance).toContainText(som('1 000,00'));
    await balance.locator(`[data-bonus-out="${employeeId}"]`).click();
    const out = page.getByRole('dialog', { name: 'Списать бонус' });
    await expect(out.locator('[data-bonus-out-dialog]')).toBeVisible();
    await expect(out.locator('[data-bonus-out-sum]')).toHaveValue(som('1 000'));

    // Больше остатка и без основания — отказы под полями; верные данные — бонус списан.
    await out.locator('[data-bonus-out-sum]').fill('1500');
    await out.locator('[data-bonus-out-ok]').click();
    await expect(out).toContainText(som('Не больше остатка: 1 000 сом'));
    await expect(out).toContainText('Укажите основание');
    await out.locator('[data-bonus-out-sum]').fill('400');
    await out.locator('[data-bonus-out-note]').fill(`Выдано с зарплатой ${word}`);
    await out.locator('[data-bonus-out-ok]').click();
    await expect(out).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'Бонус списан' })).toBeVisible();
    await expect(balance).toContainText(som('600,00'));
    expect(await sumsOf(request, employeeId)).toMatchObject({ out: 40_000, bal: 60_000 });

    // «Начисления и списания»: начисление за услугу и списание; «Отменить списание» возвращает остаток.
    await page.getByRole('button', { name: 'Начисления и списания', exact: true }).click();
    const rows = page.locator('[data-bonus-log] [data-id]');
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: 'Разовая услуга' })).toContainText(som('+1 000,00'));
    const written = rows.filter({ hasText: `Выдано с зарплатой ${word}` });
    await expect(written).toContainText(som('−400,00'));
    await written.locator('[data-row-menu]').click();
    await page
      .getByRole('menu', { name: 'Действия' })
      .getByRole('menuitem', { name: 'Отменить списание' })
      .click();
    const ask = page.getByRole('dialog', { name: 'Отменить списание бонуса?' });
    await expect(ask).toContainText(som('400 сом'));
    await ask.getByRole('button', { name: 'Отменить списание' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Списание отменено' })).toBeVisible();
    await expect(rows).toHaveCount(1);
    expect(await sumsOf(request, employeeId)).toMatchObject({ out: 0, bal: 100_000 });
  });
});
