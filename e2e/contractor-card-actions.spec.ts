import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { cardTab, closeWindow, DEMO_PASSWORD, openCardFold, signIn } from './helpers';
import { asOwner, manualReport, newContractor } from './reports';

// Карточка контрагента: главная кнопка вкладки в подвале, настройки оплаты «сразу» с «Отменить» и
// маленькая карточка «Просрочено отчётов» (решения заказчика 17.11 и 18.11.2026, прототипы v137, v142)
// через настоящий сайт. Демо-организация: включены «Учёт оплаты налогов», «Плата за обслуживание»,
// «Задачи» и «Проекты»; владелец erkin. Контрагенты — свои на каждый запуск и проект (ПК и телефон),
// по слову в названии их находит поиск.

/** Слово из кириллицы, своё на каждый запуск: по нему поиск находит только контрагентов теста. */
const uniqueWord = (prefix: string) =>
  `${prefix}${Array.from({ length: 6 }, () => 'абвгдежзиклмнопрстуф'[Math.floor(Math.random() * 20)]).join('')}`;

/** День по Бишкеку (UTC+6) со сдвигом в днях. */
const bishkek = (shift = 0) =>
  new Date(Date.now() + 6 * 3_600_000 + shift * 86_400_000).toISOString().slice(0, 10);

/** Ближайший прошедший будний день: срок на выходном сервер сразу переносит на рабочий. */
function lastWorkday(): string {
  for (let i = 1; ; i++) {
    const day = new Date(`${bishkek(-i)}T00:00:00Z`).getUTCDay();
    if (day !== 0 && day !== 6) return bishkek(-i);
  }
}

/** Первый день прошлого квартала: единый налог — квартальный отчёт. */
function previousQuarter(): string {
  const now = new Date(`${bishkek()}T00:00:00Z`);
  const quarterStart = now.getUTCMonth() - (now.getUTCMonth() % 3);
  return new Date(Date.UTC(now.getUTCFullYear(), quarterStart - 3, 1)).toISOString().slice(0, 10);
}

/** Сумма на экране — с неразрывными пробелами: «25 000». */
const som = (text: string) => new RegExp(`^${text.replace(/ /g, '\\s')}$`);

const row = (page: Page, id: string) => page.locator(`[data-grid] [data-id="${id}"]`);

/** Карточка контрагента из «Контрагенты» → «Все»: поиск по слову теста, строка (на телефоне — плитка). */
async function openCard(
  page: Page,
  isMobile: boolean,
  word: string,
  cp: { id: string },
  name: string,
): Promise<Locator> {
  await page.goto('/app/cps/all');
  await expect(page.locator('[data-grid]')).toBeVisible();
  if (isMobile) await page.getByRole('button', { name: 'Поиск', exact: true }).click();
  await page.getByRole('searchbox').first().fill(word);
  await expect(row(page, cp.id)).toHaveCount(1);
  await row(page, cp.id).getByText(name, { exact: true }).click();
  const card = page.getByRole('dialog', { name });
  await expect(card.locator('[data-cp-card]')).toBeVisible();
  return card;
}

async function paysTo(api: APIRequestContext, id: string): Promise<string> {
  const res = await api.get(`/api/contractors/${id}`);
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { paysTo: string }).paysTo;
}

async function feeDebt(api: APIRequestContext, id: string): Promise<number> {
  const res = await api.get(`/api/contractors/${id}/fees`);
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { debt: number }).debt;
}

/** «1 250,50 сом» с экрана — в тыйыны. */
const tyiyns = (text: string) =>
  Math.round(Number(text.replace(/[^\d,]/g, '').replace(/,/g, '.')) * 100);

test.describe('Доработки 17.11 и 18.11: карточка контрагента', () => {
  test('(прототип v137) главная кнопка вкладки в подвале карточки контрагента: на «Основном» её нет, на «Деньгах» — «Поступление», на «Обслуживании» — «Принять оплату» с суммой начисления, на «Задачах» — «Задача», на «Проектах» — «Проект»; каждое окно открывается уже с этим контрагентом', async ({
    page,
    request,
    baseURL,
    isMobile,
  }) => {
    const origin = await asOwner(request, baseURL);
    const word = uniqueWord('Подвал');
    const name = `ОсОО «${word}»`;
    const cp = await newContractor(request, origin, { name, tariffAmount: 2_500_000 });

    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    const card = await openCard(page, isMobile, word, cp, name);
    // «Основное»: главной кнопки нет, «Готово» тоже — окно закрывает крестик.
    await expect(card.locator('[data-cp-act]')).toHaveCount(0);
    await expect(card.locator('[data-cp-done]')).toHaveCount(0);

    // «Деньги» → «Поступление»: окно поступления этого контрагента.
    await cardTab(page, card, isMobile, /^Деньги/);
    const receive = card.locator('[data-cp-act="money"]');
    await expect(receive).toHaveText('Поступление');
    await expect(card.locator('[data-cp-act]')).toHaveCount(1);
    await receive.click();
    const receipt = page.getByRole('dialog').filter({
      has: page.locator(`[data-receipt-dialog="${cp.id}"]`),
    });
    await expect(receipt).toBeVisible();
    await closeWindow(receipt);
    // «Баланс по контрагенту» внизу вкладки: строка «Долг за обслуживание» — долг из платы за
    // обслуживание (начисление идущего месяца долгом становится только после дня оплаты).
    const debt = await feeDebt(request, cp.id);
    const debtRow = card.locator('[data-money-balance] [data-money-fee-debt]');
    await expect(debtRow).toHaveText(/^[\d\s,]+сом$/);
    expect(tyiyns(await debtRow.innerText())).toBe(debt);

    // «Обслуживание» → «Принять оплату»: сумма — начисление за идущий месяц.
    await cardTab(page, card, isMobile, /Обслуживание/);
    const accept = card.locator('[data-cp-act="fee"]');
    await expect(accept).toHaveText('Принять оплату');
    await expect(card.locator('[data-cp-act]')).toHaveCount(1);
    await accept.click();
    const feePay = page.getByRole('dialog', { name: 'Принять оплату за обслуживание' });
    await expect(feePay).toContainText(name);
    await expect(feePay.locator('[data-fee-pay-sum]')).toHaveValue(som('25 000'));
    await closeWindow(feePay);

    // «Задачи» → «Задача»: задача «По контрагенту», контрагент уже выбран.
    await cardTab(page, card, isMobile, /^Задачи/);
    const task = card.locator('[data-cp-act="tasks"]');
    await expect(task).toHaveText('Задача');
    await expect(card.locator('[data-cp-act]')).toHaveCount(1);
    await task.click();
    const taskForm = page.getByRole('dialog', { name: 'Новая задача' });
    await expect(
      taskForm.locator('[data-task-scope]').getByRole('button', { name: 'По контрагенту' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(taskForm.getByLabel(/^Контрагент/)).toContainText(name);
    await closeWindow(taskForm);

    // «Проекты» → «Проект»: контрагент назван под заголовком, поля выбора контрагента нет.
    await cardTab(page, card, isMobile, /^Проекты/);
    const project = card.locator('[data-cp-act="projects"]');
    await expect(project).toHaveText('Проект');
    await expect(card.locator('[data-cp-act]')).toHaveCount(1);
    await project.click();
    const projectForm = page.getByRole('dialog', { name: 'Новый проект' });
    await expect(projectForm).toContainText(name);
    await expect(projectForm.locator('[data-pd-name]')).toBeVisible();
    await expect(projectForm.locator('[data-pd-cp]')).toHaveCount(0);
    await closeWindow(projectForm);
  });

  test('(прототип v137) настройка оплаты в карточке контрагента сохраняется сразу, без «Сохранить»: «Деньги на налоги переводит» меняется выбором, «Отменить» в уведомлении «Сохранено» возвращает прежнее', async ({
    page,
    request,
    baseURL,
    isMobile,
  }) => {
    const origin = await asOwner(request, baseURL);
    const word = uniqueWord('Оплата');
    const name = `ОсОО «${word}»`;
    const cp = await newContractor(request, origin, { name });
    const was = await paysTo(request, cp.id);
    const next = was === 'emp' ? 'org' : 'emp';

    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    const card = await openCard(page, isMobile, word, cp, name);
    const fold = await openCardFold(card, 'pay');
    const select = fold.locator('[data-money-pays-to]');
    await expect(select).toHaveValue(was);

    await select.selectOption(next);
    const saved = page.getByRole('status').filter({ hasText: 'Сохранено' });
    await expect(saved).toBeVisible();
    await expect(select).toHaveValue(next);
    await expect.poll(() => paysTo(request, cp.id)).toBe(next);

    // «Отменить» в уведомлении: прежнее значение — на экране и в базе.
    await saved.getByRole('button', { name: 'Отменить', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Отменено' })).toBeVisible();
    await expect(select).toHaveValue(was);
    await expect.poll(() => paysTo(request, cp.id)).toBe(was);
  });

  test('(прототип v142) несданный в срок отчёт — маленькая красная карточка «Просрочено отчётов» с числом вверху «Основного»; нажатие открывает «Отчёты к сдаче»', async ({
    page,
    request,
    baseURL,
    isMobile,
  }) => {
    const origin = await asOwner(request, baseURL);
    const word = uniqueWord('Срок');
    const name = `ОсОО «${word}»`;
    const cp = await newContractor(request, origin, { name });
    await manualReport(request, origin, {
      contractorId: cp.id,
      reportTypeCode: 'enq',
      month: previousQuarter(),
      due: lastWorkday(),
    });

    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    const card = await openCard(page, isMobile, word, cp, name);
    const overdue = card.locator('[data-cp-hot] [data-plate]').filter({
      hasText: 'Просрочено отчётов',
    });
    await expect(overdue).toHaveCount(1);
    await expect(overdue.locator('[data-plate-value]')).toHaveText('1');
    await overdue.click();
    await expect(card.getByRole('tab', { selected: true })).toContainText('Отчёты к сдаче');
  });
});
