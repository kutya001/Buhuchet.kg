import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { newOrgOwner } from './helpers';

// «Показать как», «Обзор экрана» и знакомые элементы (задача 2.31). Шаги засчитываются один раз, а
// знакомые элементы копятся у пользователя, поэтому каждый тест — со своей новой организацией и её
// владельцем (`newOrgOwner`). Пункты 48 и 59 приёмки проверяются на экранах «Отчетов для сдачи» и
// «Контрагентов» — их закрывают задачи этих экранов (docs/decisions.md п. Г-5); здесь тот же механизм
// на экранах, которые уже есть: «Сотрудники», «Роли», «Задачи».

async function stepDone(api: APIRequestContext, id: string) {
  const res = await api.get('/api/kb/me');
  expect(res.status(), await res.text()).toBe(200);
  const me = (await res.json()) as {
    lessons: { steps: { id: string; done: { how: string } | null }[] }[];
  };
  return me.lessons.flatMap((l) => l.steps).find((s) => s.id === id)?.done ?? null;
}

async function knownCount(api: APIRequestContext) {
  const res = await api.get('/api/kb/known');
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { keys: string[] }).keys.length;
}

const bubble = (page: Page) => page.locator('[data-tour-bubble]');
const nextButton = (page: Page) => page.locator('[data-tour-next]');
const titleOf = (page: Page) => bubble(page).locator('b').first();

/** Облачко готово («Далее» доступна): «N из M». */
async function position(page: Page) {
  await expect(nextButton(page)).toBeEnabled();
  const text = (await page.locator('[data-tour-count]').textContent()) ?? '';
  const m = /^(\d+) из (\d+)$/.exec(text);
  expect(m, text).not.toBeNull();
  return { i: Number(m![1]), n: Number(m![2]) };
}

/** «Далее» и дождаться следующего облачка. */
async function forward(page: Page) {
  const { i, n } = await position(page);
  await nextButton(page).click();
  await expect(page.locator('[data-tour-count]')).not.toHaveText(`${i} из ${n}`);
}

/** Листать «Далее» до облачка с одной из кнопок `stop`: заголовки пройденных облачков и кнопка. */
async function toEnd(page: Page, stop: string[] = ['Готово']) {
  const titles: string[] = [];
  for (let k = 0; k < 120; k++) {
    await position(page);
    titles.push(((await titleOf(page).textContent()) ?? '').trim());
    const label = ((await nextButton(page).textContent()) ?? '').trim();
    if (stop.includes(label)) return { titles, label };
    await forward(page);
  }
  throw new Error(`Показ не дошёл до ${stop.join(' / ')}: ${titles.join(' · ')}`);
}

/** Знакомые элементы уходят на сервер, когда показ закончен. */
const knownSaved = (page: Page) =>
  page.waitForResponse(
    (r) => r.url().endsWith('/api/kb/known') && r.request().method() === 'POST' && r.ok(),
  );

const endShow = (page: Page) =>
  bubble(page).getByRole('button', { name: 'Закончить показ', exact: true }).last().click();

async function showStep(page: Page, id: string) {
  await page.goto('/app/kb/lessons');
  await page
    .locator(`[data-kb-step="${id}"]`)
    .getByRole('button', { name: /^Показать (как|ещё раз)$/ })
    .click();
}

test.describe('Этап 2: База знаний — «Показать как» и «Обзор экрана»', () => {
  // Новая организация (`pnpm db:create-org`) и показ на десятки облачков.
  test.describe.configure({ timeout: 120_000 });

  test('(проверка задачи #87; механизм п. 48 на «Ролях») «Показать как» у шага «Посмотреть»: облачка с «N из M»; «Закончить показ» на середине не засчитывает шаг; «Продолжить с 3 из M» — без пройденных облачков; проход до «Готово» засчитывает шаг показом', async ({
    page,
    baseURL,
  }) => {
    await newOrgOwner(page.request, new URL(baseURL!).origin);
    await showStep(page, 'roles');
    await expect(page).toHaveURL(/\/app\/staff\/roles/);
    const first = await position(page);
    expect(first.i).toBe(1);
    const n = first.n;
    expect(n).toBeGreaterThan(4);
    await expect(titleOf(page)).toHaveText('Посмотреть роли и права');

    await forward(page);
    await forward(page);
    expect(await position(page)).toEqual({ i: 3, n });
    const saved = knownSaved(page);
    await endShow(page);
    await saved;
    await expect(bubble(page)).toHaveCount(0);
    await expect(
      page.getByText(
        'Показ закончен раньше: шаг «Посмотреть» засчитается, когда пройдёте показ до конца',
      ),
    ).toBeVisible();
    expect(await stepDone(page.request, 'roles')).toBeNull();

    // Второй раз — «Продолжить показ?»: «Продолжить» пропускает уже пройденные (знакомые) облачки.
    await showStep(page, 'roles');
    const ask = page.getByRole('dialog', { name: 'Продолжить показ?' });
    await expect(ask).toContainText(`В прошлый раз вы закончили показ на облачке 3 из ${n}.`);
    await expect(ask.getByRole('button', { name: 'Сначала' })).toBeVisible();
    await ask.getByRole('button', { name: `Продолжить с 3 из ${n}` }).click();
    // Вступление знакомым не становится — пропущено одно облачко, второе.
    const resumed = await position(page);
    expect(resumed).toEqual({ i: 1, n: n - 1 });
    await expect(page.locator('[data-tour-skipped]')).toHaveText(
      /Пропущено знакомых элементов: 1\s*Показать всё/,
    );

    const { label } = await toEnd(page);
    expect(label).toBe('Готово');
    await nextButton(page).click();
    await expect(bubble(page)).toHaveCount(0);
    await expect(
      page.getByRole('dialog', { name: 'Шаг выполнен: вы посмотрели «Посмотреть роли и права»' }),
    ).toBeVisible();
    expect(await stepDone(page.request, 'roles')).toMatchObject({ how: 'show' });

    await page.goto('/app/kb/lessons');
    const step = page.locator('[data-kb-step="roles"]');
    await expect(step).toHaveAttribute('data-kb-state', 'done');
    await expect(step).toContainText('засчитано показом');
    await expect(step.getByRole('button', { name: 'Показать ещё раз' })).toBeVisible();
  });

  test('(проверка задачи #87; механизм п. 59 на «Ролях» и карточке сотрудника) после показа «Ролей» показ карточки сотрудника пропускает знакомые общие элементы: «Пропущено знакомых элементов: N» и «Показать всё»; повторный показ «Ролей» — «Всё на этом экране вам уже знакомо»; «Показывать всё заново» в «Мой уровень»', async ({
    page,
    baseURL,
  }) => {
    await newOrgOwner(page.request, new URL(baseURL!).origin);
    await showStep(page, 'roles');
    const roles = await toEnd(page);
    expect(roles.titles).toContain('«На весь экран»');
    let saved = knownSaved(page);
    await nextButton(page).click();
    await saved;
    await page.getByRole('button', { name: 'Остаться здесь' }).click();

    // Карточка сотрудника: общие элементы, объяснённые в «Ролях», не показываются.
    await showStep(page, 'empcard');
    await position(page);
    const skipped = page.locator('[data-tour-skipped]');
    await expect(skipped).toContainText(/Пропущено знакомых элементов: \d+/);
    await expect(skipped.getByRole('button', { name: 'Показать всё' })).toBeVisible();
    const card = await toEnd(page);
    expect(card.titles).not.toContain('«На весь экран»');
    expect(card.titles.some((x) => x.startsWith('Карточка'))).toBe(true);
    saved = knownSaved(page);
    await endShow(page);
    await saved;

    // «Показать всё» — тот же показ целиком, с «На весь экран».
    await showStep(page, 'empcard');
    const ask = page.getByRole('dialog', { name: 'Продолжить показ?' });
    await ask.getByRole('button', { name: 'Сначала' }).click();
    const full = await toEnd(page);
    expect(full.titles).toContain('«На весь экран»');
    await expect(skipped).toHaveCount(0);
    await endShow(page);
    await expect(bubble(page)).toHaveCount(0);

    // Повторный показ пройденного шага «Посмотреть» — одно облачко «Всё на этом экране вам уже знакомо».
    await showStep(page, 'roles');
    expect(await position(page)).toEqual({ i: 1, n: 1 });
    await expect(titleOf(page)).toHaveText('Всё на этом экране вам уже знакомо');
    await expect(nextButton(page)).toHaveText('Готово');
    await expect(skipped).toContainText(`Пропущено знакомых элементов: ${roles.titles.length - 2}`);
    await bubble(page).getByRole('button', { name: 'Показать всё' }).click();
    await expect(page.locator('[data-tour-count]')).toHaveText(`1 из ${roles.titles.length}`);
    await expect(skipped).toHaveCount(0);
    await endShow(page);

    // «Показывать всё заново»: знакомых элементов нет, выполненные шаги остаются.
    expect(await knownCount(page.request)).toBeGreaterThan(0);
    await page.goto('/app/kb/level');
    await page.getByRole('button', { name: 'Показывать всё заново' }).click();
    const confirm = page.getByRole('dialog', { name: 'Показывать всё заново?' });
    await expect(confirm).toContainText('сейчас знакомых элементов');
    await confirm.getByRole('button', { name: 'Показывать всё заново' }).click();
    await expect(page.getByText('Показы снова проходят по всем элементам')).toBeVisible();
    expect(await knownCount(page.request)).toBe(0);
    expect(await stepDone(page.request, 'roles')).toMatchObject({ how: 'show' });

    await showStep(page, 'roles');
    expect(await position(page)).toEqual({ i: 1, n: roles.titles.length });
    await expect(skipped).toHaveCount(0);
  });

  test('(проверка задачи #87) шаг «Выбрать тему оформления» без экрана засчитывается только показом: «Показать как» подсвечивает переключатель темы, «Готово» засчитывает шаг', async ({
    page,
    baseURL,
  }) => {
    await newOrgOwner(page.request, new URL(baseURL!).origin);
    await showStep(page, 'theme');
    const { titles, label } = await toEnd(page);
    expect(label).toBe('Готово');
    expect(titles[0]).toBe('Выбрать тему оформления');
    expect(titles.length).toBeGreaterThan(2);
    await nextButton(page).click();
    await expect(
      page.getByRole('dialog', {
        name: 'Шаг выполнен: вы посмотрели «Выбрать тему оформления»',
      }),
    ).toBeVisible();
    expect(await stepDone(page.request, 'theme')).toMatchObject({ how: 'show' });
  });

  test('(проверка задачи #87) «Показать экран» у урока «Задачи»: «Обзор экрана: Задачи · …» по каждому элементу, «Готово» засчитывает шаги «Посмотреть» этого экрана; «Показать экран» из «?» другого модуля', async ({
    page,
    baseURL,
  }) => {
    await newOrgOwner(page.request, new URL(baseURL!).origin);
    expect(await stepDone(page.request, 'daymonth')).toBeNull();
    await page.goto('/app/kb/lessons');
    await page.locator('[data-ck-scr="tasks.mine"]').first().click();
    await expect(page).toHaveURL(/\/app\/tasks\/mine/);
    await position(page);
    await expect(titleOf(page)).toHaveText(/^Обзор экрана: Задачи · /);
    const { titles, label } = await toEnd(page);
    expect(label).toBe('Готово');
    expect(titles.length).toBeGreaterThan(3);
    await nextButton(page).click();
    await expect(bubble(page)).toHaveCount(0);
    await expect(
      page.getByText(/^База знаний: (шаг просмотрен — «.+»|просмотрено шагов: \d+)$/),
    ).toBeVisible();
    expect(await stepDone(page.request, 'daymonth')).toMatchObject({ how: 'show' });

    // «?» на экране «Сотрудников» → «Показать экран»: обзор этого экрана.
    await page.goto('/app/staff/list');
    await page.getByRole('button', { name: 'Помощь' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Показать экран' }).click();
    await position(page);
    await expect(titleOf(page)).toHaveText(/^Обзор экрана: Сотрудники/);
    await forward(page);
    await endShow(page);
    await expect(bubble(page)).toHaveCount(0);
    // Обзор экрана шагов не засчитывает раньше «Готово» и не пишет про шаг «Посмотреть».
    await expect(page.getByText(/^Показ закончен раньше/)).toHaveCount(0);
  });

  test('(проверка задачи #87) шаг «Сделать» — «Сделать сейчас»: открывается «Новый сотрудник», показ идёт по полям формы с «· обязательно»; «Понятно, заполню» оставляет форму открытой', async ({
    page,
    baseURL,
  }) => {
    await newOrgOwner(page.request, new URL(baseURL!).origin);
    await showStep(page, 'emps');
    const before = await toEnd(page, ['Сделать сейчас']);
    expect(before.label).toBe('Сделать сейчас');
    await nextButton(page).click();
    const form = page.getByRole('dialog', { name: 'Новый сотрудник', exact: true });
    await expect(form).toBeVisible();
    const fields = await toEnd(page, ['Понятно, заполню']);
    expect(fields.titles).toContain('ФИО · обязательно');
    await nextButton(page).click();
    await expect(bubble(page)).toHaveCount(0);
    await expect(form).toBeVisible();
    await expect(form.getByLabel('ФИО')).toBeEditable();
    expect(await stepDone(page.request, 'emps')).toBeNull();
  });
});
