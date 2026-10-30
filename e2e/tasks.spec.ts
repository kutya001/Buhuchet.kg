import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { DEMO_PASSWORD, signIn } from './helpers';

// «Задачи» (задача 2.23, #79) через настоящий сайт: форма «Общая / По контрагенту», подтверждение
// выполнения, возврат «На доработку», карточка задачи на телефоне. Демо-организация: владелец erkin,
// главный бухгалтер meerim, бухгалтер alisher. Название задачи — своё на каждый запуск и проект (ПК и
// телефон): по нему задача находится общим поиском. Выключение «Задачи требуют подтверждения» меняет
// учётную политику — tasks.shared.spec.ts.

const uniqueTitle = (text: string) =>
  `${text} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** «+ Добавить» модуля: у «Задач» один способ — кнопка сразу открывает «Новая задача». */
const add = (page: Page) => page.getByRole('button', { name: 'Добавить', exact: true }).click();

/** Общий поиск по вкладке (на телефоне — кнопкой «Поиск» в верхней панели). */
async function search(page: Page, isMobile: boolean, text: string) {
  if (isMobile) await page.getByRole('button', { name: 'Поиск', exact: true }).click();
  await page.getByRole('searchbox').first().fill(text);
}

/** Подпись выбранного значения выпадающего списка. */
const selected = (select: Locator) =>
  expect.poll(() => select.evaluate((el: HTMLSelectElement) => el.selectedOptions[0]?.text));

/** Вход под сотрудником демо-организации в отдельном контексте запросов. */
async function apiAs(
  playwright: { request: { newContext: (o: { baseURL?: string }) => Promise<APIRequestContext> } },
  baseURL: string,
  login: string,
) {
  const api = await playwright.request.newContext({ baseURL });
  await signIn(api, new URL(baseURL).origin, login, DEMO_PASSWORD);
  return api;
}

interface FormOptions {
  categories: { code: string; name: string }[];
  executors: { id: string; shortName: string }[];
}

/** Главный бухгалтер ставит задачу через API: исполнитель — Алишер Т., с подтверждением. */
async function createTask(chief: APIRequestContext, origin: string, title: string) {
  const options = (await (await chief.get('/api/tasks/form-options')).json()) as FormOptions;
  const res = await chief.post('/api/tasks', {
    headers: { origin },
    data: {
      title,
      description: '',
      categoryCode: options.categories[0]!.code,
      contractorId: null,
      executorEmployeeId: options.executors.find((e) => e.shortName === 'Алишер Т.')!.id,
      term: 'day',
      dueDate: '2099-12-30',
      needFile: false,
      confirm: true,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { id: string };
}

/** Открыть задачу из списка вкладки: поиск по названию, строка → карточка. */
async function openTask(page: Page, isMobile: boolean, tab: string, title: string, id: string) {
  await page.goto(`/app/tasks/${tab}`);
  await expect(page.locator('[data-grid]')).toBeVisible();
  await search(page, isMobile, title);
  const row = page.locator(`[data-grid] [data-id="${id}"]`);
  await expect(row).toHaveCount(1);
  await row.getByText(title, { exact: true }).click();
  const card = page.getByRole('dialog', { name: title });
  await expect(card.locator(`[data-task-card="${id}"] ol[data-status-scale]`)).toBeVisible();
  return card;
}

test.describe('Этап 2: задачи', () => {
  test('(п. 16) главный бухгалтер ставит задачу «Общая»: полей «Контрагент» и «Проект» нет, в списке — «Общая»; «По контрагенту» показывает поле контрагента', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const title = uniqueTitle('Собрать документы на отпуск');
    await signIn(page.request, new URL(baseURL!).origin, 'meerim', DEMO_PASSWORD);
    await page.goto('/app/tasks/byme');
    await expect(page.locator('[data-task-legend]')).toContainText('задача на дату');
    await expect(page.locator('[data-task-range]')).toContainText(
      /^С [а-я]+ \d{4}, вперёд и всё просроченное$/,
    );

    await add(page);
    const form = page.getByRole('dialog', { name: 'Новая задача' });
    const scope = form.locator('[data-task-scope]');
    // По умолчанию — «Общая»: полей «Контрагент» и «Проект» нет; исполнитель — тот, кто ставит.
    await expect(scope.getByRole('button', { name: 'Общая' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(form.getByLabel(/^Контрагент/)).toHaveCount(0);
    await expect(form.getByLabel(/^Проект/)).toHaveCount(0);
    await selected(form.getByLabel(/^Исполнитель/)).toBe('Мээрим К.');
    await expect(form.getByRole('switch', { name: 'Требуется подтверждение' })).toBeChecked();
    await expect(form).toContainText('По умолчанию — из учётной политики');

    // «По контрагенту» — обязательное поле «Контрагент» (галочку «Проект» добавит задача 2.26).
    await scope.getByRole('button', { name: 'По контрагенту' }).click();
    await expect(form.getByLabel(/^Контрагент/)).toBeVisible();
    await form.getByRole('button', { name: 'Поставить задачу' }).click();
    await expect(form).toContainText('Введите название');
    await expect(form).toContainText('Выберите контрагента');
    await scope.getByRole('button', { name: 'Общая' }).click();
    await expect(form.getByLabel(/^Контрагент/)).toHaveCount(0);

    await form.getByLabel(/^Название/).fill(title);
    await form.getByLabel(/^Исполнитель/).selectOption({ label: 'Алишер Т.' });
    await form.getByLabel(/^Вид срока/).selectOption({ label: 'На месяц' });
    await expect(form).toContainText('Срок — последний день месяца');
    await form.getByRole('button', { name: 'Поставить задачу' }).click();
    await expect(form).toBeHidden();
    await expect(
      page.getByRole('status').filter({ hasText: 'Задача поставлена: Алишер Т.' }),
    ).toBeVisible();

    await search(page, isMobile, title);
    // «Контрагент» по умолчанию скрыт, как в прототипе (docs/deviations.md п. Б-2): включаем в «Столбцах».
    await page.getByRole('button', { name: /^Столбцы/ }).click();
    const panel = page.getByRole('dialog', { name: 'Столбцы' });
    await panel.getByRole('checkbox', { name: 'Контрагент' }).check();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    const row = page.locator('[data-grid] [data-id]').filter({ hasText: title });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Общая');
    await expect(row).toContainText('Месяц');
    await expect(row).toContainText(/до \d\d\.\d\d\.\d{4}/);

    // В карточке — «Общая задача» вместо контрагента.
    await row.getByText(title, { exact: true }).click();
    const card = page.getByRole('dialog', { name: title });
    await expect(card).toContainText('Общая задача');
    await expect(card).toContainText('в течение месяца, до');
    await expect(card).toContainText('Задача поставлена');
  });

  test('(п. 40) бухгалтер отмечает «Выполнена» — «На подтверждении»; владелец подтверждает вместо главного бухгалтера, это видно в карточке и истории', async ({
    page,
    playwright,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    const title = uniqueTitle('Сверка с ГНС');
    const chief = await apiAs(playwright, baseURL!, 'meerim');
    const { id } = await createTask(chief, origin, title);
    await chief.dispose();

    // Исполнитель: «Выполнена» → «На подтверждении», кто подтвердит — в окне и в карточке.
    await signIn(page.request, origin, 'alisher', DEMO_PASSWORD);
    let card = await openTask(page, isMobile, 'mine', title, id);
    await card.locator('[data-task-button="done"]').click();
    const done = page.getByRole('dialog', { name: 'Задача выполнена' });
    await expect(done).toContainText('Постановщик увидит, когда и кем задача выполнена.');
    await expect(done).toContainText('подтвердит Мээрим К. или сотрудник с правом');
    await done.getByRole('button', { name: 'Выполнена' }).click();
    await expect(done).toBeHidden();
    await expect(
      page.getByRole('status').filter({ hasText: 'Отправлено на подтверждение: Мээрим К.' }),
    ).toBeVisible();
    await expect(card).toContainText('Ждёт подтверждения: Мээрим К. или сотрудник с правом');
    await expect(card).toContainText('Свою задачу подтвердить нельзя');
    await expect(card.locator('[data-task-button="confirm"]')).toHaveCount(0);
    await page.request.post('/api/auth/logout', { headers: { origin } });

    // Владелец (право «Подтверждать задачи») видит ждущую на плашке «На подтверждении» и подтверждает.
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    await page.goto('/app/tasks/all');
    const plate = page.locator('[data-plate="pend"]');
    if (!isMobile) {
      await expect(plate).toContainText('На подтверждении');
      await expect(plate).toContainText('можете подтвердить:');
    }
    card = await openTask(page, isMobile, 'all', title, id);
    await card.locator('[data-task-button="confirm"]').click();
    const confirm = page.getByRole('dialog', { name: 'Подтвердить выполнение' });
    await expect(confirm).toContainText(
      'Задачу ставил Мээрим К.. Вы подтверждаете вместо постановщика: это будет видно в истории.',
    );
    await confirm.getByLabel('Комментарий').fill('проверил сам');
    await confirm.getByRole('button', { name: 'Подтвердить' }).click();
    await expect(confirm).toBeHidden();
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'Задача подтверждена: Алишер Т. получит уведомление' }),
    ).toBeVisible();
    await expect(card).toContainText(/Подтвердил\s*Садыков Эркин Маратович вместо постановщика/);
    await expect(card).toContainText('проверил сам');
    const history = card.locator('[data-status-history] tbody > tr').first();
    await expect(history).toContainText('Подтверждена');
    await expect(history).toContainText('вместо постановщика Мээрим К., проверил сам');
  });

  test('(п. 41) «На доработку» без причины невозможно; после возврата задача «В работе» с отметкой «На доработке», исполнитель видит причину', async ({
    page,
    playwright,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    const title = uniqueTitle('Акт сверки');
    const chief = await apiAs(playwright, baseURL!, 'meerim');
    const { id } = await createTask(chief, origin, title);
    const executor = await apiAs(playwright, baseURL!, 'alisher');
    const marked = await executor.post(`/api/tasks/${id}/done`, { headers: { origin }, data: {} });
    expect(marked.status(), await marked.text()).toBe(200);
    await chief.dispose();

    await signIn(page.request, origin, 'meerim', DEMO_PASSWORD);
    const card = await openTask(page, isMobile, 'byme', title, id);
    await card.locator('[data-task-button="rework"]').click();
    const rework = page.getByRole('dialog', { name: 'Вернуть на доработку' });
    await expect(rework).toContainText('Задача вернётся в «В работе» с отметкой «На доработке»');
    await rework.getByRole('button', { name: 'На доработку' }).click();
    await expect(rework).toContainText('Укажите причину');
    await expect(rework).toBeVisible();
    await rework.getByLabel(/^Причина/).fill('Нет подписи руководителя');
    await rework.getByRole('button', { name: 'На доработку' }).click();
    await expect(rework).toBeHidden();
    await expect(
      page.getByRole('status').filter({ hasText: 'Задача возвращена на доработку' }),
    ).toBeVisible();
    const scale = card.locator('ol[data-status-scale]');
    await expect(scale).toContainText('На доработке');
    await expect(scale).toContainText('на шаге 2 «В работе»');
    await expect(card).toContainText(
      'Возвращена на доработку · Мээрим К.: Нет подписи руководителя',
    );

    // Исполнитель видит причину в карточке; задача снова у него в работе.
    const back = (await (await executor.get(`/api/tasks/${id}`)).json()) as {
      status: string;
      reworkReason: string;
    };
    expect(back).toMatchObject({ status: 'rework', reworkReason: 'Нет подписи руководителя' });
    await executor.dispose();
    await page.request.post('/api/auth/logout', { headers: { origin } });
    await signIn(page.request, origin, 'alisher', DEMO_PASSWORD);
    const mine = await openTask(page, isMobile, 'mine', title, id);
    await expect(mine).toContainText('Нет подписи руководителя');
    await expect(mine.locator('[data-task-button="done"]')).toBeVisible();
  });

  test('(п. 33) в карточке задачи на телефоне шкала — шаги столбиком с датами справа, «История статусов» — записи одна под другой; ничего не обрезано и не прокручивается вбок', async ({
    page,
    playwright,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    const title = uniqueTitle('Запрос в Соцфонд');
    const chief = await apiAs(playwright, baseURL!, 'meerim');
    const { id } = await createTask(chief, origin, title);
    await chief.dispose();
    await signIn(page.request, origin, 'alisher', DEMO_PASSWORD);
    expect(
      (await page.request.post(`/api/tasks/${id}/start`, { headers: { origin } })).status(),
    ).toBe(200);

    const card = await openTask(page, isMobile, 'mine', title, id);
    const steps = card.locator('ol[data-status-scale] > li > button');
    await expect(steps).toHaveCount(4);
    const rows = card.locator('[data-status-history] tbody > tr');
    await expect(rows).toHaveCount(2);
    const boxes = await Promise.all([0, 1].map(async (i) => (await steps.nth(i).boundingBox())!));
    if (isMobile) {
      expect(Math.abs(boxes[1]!.x - boxes[0]!.x)).toBeLessThanOrEqual(1);
      expect(boxes[1]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height - 1);
      const date = steps.nth(1).locator('small', { hasText: /^\d\d\.\d\d\.\d{4} \d\d:\d\d$/ });
      const at = (await date.boundingBox())!;
      expect(at.x).toBeGreaterThan(boxes[1]!.x + boxes[1]!.width / 2);
      await expect(card.locator('[data-status-history] thead')).toBeHidden();
      const [first, second] = await Promise.all([
        rows.nth(0).boundingBox(),
        rows.nth(1).boundingBox(),
      ]);
      expect(second!.y).toBeGreaterThanOrEqual(first!.y + first!.height - 1);
    } else {
      expect(boxes[1]!.x).toBeGreaterThan(boxes[0]!.x + boxes[0]!.width);
    }
    const overflow = await card.evaluate((dialog) => {
      const edge = dialog.getBoundingClientRect().right + 1;
      return [...dialog.querySelectorAll('[data-task-card] *')]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.right > edge;
        })
        .map((el) => `${el.tagName} ${(el.textContent ?? '').slice(0, 40)}`);
    });
    expect(overflow).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(0);
  });
});
