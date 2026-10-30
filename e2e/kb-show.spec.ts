import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { newOrgOwner, uniqueLogin } from './helpers';
import { connectAllTypes } from './orgs';
import { manualReport } from './reports';

// «Показать как», «Обзор экрана» и знакомые элементы (задача 2.31). Шаги засчитываются один раз, а
// знакомые элементы копятся у пользователя, поэтому каждый тест — со своей новой организацией и её
// владельцем (`newOrgOwner`). Пункты 48 и 59 приёмки — на «Отчетах для сдачи» (2.13) и форме
// «Новый контрагент» (2.09); тот же механизм — на «Сотрудниках», «Ролях» и «Задачах».

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

/**
 * Листать «Далее» до облачка с одной из кнопок `stop`: заголовки и пояснения пройденных облачков и
 * кнопка.
 */
async function toEnd(page: Page, stop: string[] = ['Готово']) {
  const titles: string[] = [];
  const texts: string[] = [];
  for (let k = 0; k < 120; k++) {
    await position(page);
    titles.push(((await titleOf(page).textContent()) ?? '').trim());
    texts.push(((await bubble(page).locator('p').first().textContent()) ?? '').trim());
    const label = ((await nextButton(page).textContent()) ?? '').trim();
    if (stop.includes(label)) return { titles, texts, label };
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

  // ОТКЛОНЕНИЕ: docs/deviations.md#Г-7
  test('(п. 59, решение Г-7) после показа «Ролей» показ карточки сотрудника пропускает знакомые общие элементы: «Пропущено знакомых элементов: N» и «Показать всё»; повторный показ «Ролей» — «Всё на этом экране вам уже знакомо»; «Показывать всё заново» в «Мой уровень»', async ({
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

  test('(п. 48) «Показать как» у шага «Посмотреть вкладки «На неделе», «Просрочено»…»: показ проходит по каждой вкладке, плашке, фильтру и кнопке с пояснением и счётчиком «N из M»; «Закончить показ» на середине не засчитывает шаг, проход до «Готово» засчитывает', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await newOrgOwner(page.request, origin);
    await connectAllTypes(page.request, origin);
    const staff = (await (await page.request.get('/api/staff?size=all')).json()) as {
      items: { id: string }[];
    };
    const made = await page.request.post('/api/contractors', {
      headers: { origin },
      data: {
        name: 'ОсОО «Показ отчётов»',
        inn: `08${Date.now().toString().slice(-8)}${String(Math.floor(Math.random() * 10_000)).padStart(4, '0')}`,
        phone: '+996505890076',
        kind: 'regular',
        formCode: 'ФС-01',
        regimeCode: 'РЕЖ-01',
        gked: '46.34.0',
        taxOfficeCode: null,
        startDate: '2026-01-01',
        responsibleEmployeeId: staff.items[0]!.id,
      },
    });
    expect(made.status(), await made.text()).toBe(201);
    const cp = (await made.json()) as { id: string };
    await manualReport(page.request, origin, {
      contractorId: cp.id,
      reportTypeCode: 'nds',
      month: '2026-09-01',
      // Срок — сегодня по Бишкеку: отчёт на вкладке «На неделе».
      due: new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 10),
    });
    await showStep(page, 'rtabs');
    await expect(page).toHaveURL(/\/app\/reports\/week/);
    const first = await position(page);
    expect(first.i).toBe(1);
    await expect(titleOf(page)).toHaveText(/^Посмотреть вкладки «На неделе», «Просрочено»/);
    await forward(page);
    await forward(page);
    await endShow(page);
    await expect(bubble(page)).toHaveCount(0);
    await expect(
      page.getByText(
        'Показ закончен раньше: шаг «Посмотреть» засчитается, когда пройдёте показ до конца',
      ),
    ).toBeVisible();
    expect(await stepDone(page.request, 'rtabs')).toBeNull();

    await showStep(page, 'rtabs');
    await page
      .getByRole('dialog', { name: 'Продолжить показ?' })
      .getByRole('button', { name: 'Сначала' })
      .click();
    const all = await position(page);
    const { titles, texts, label } = await toEnd(page);
    expect(label).toBe('Готово');
    expect(titles.length).toBe(all.n);
    expect(titles).toEqual(
      expect.arrayContaining([
        'Вкладка «На неделе»',
        'Вкладка «Просрочено»',
        'Вкладка «Ожидают подтверждения»',
        'Вкладка «Календарь»',
        'Кнопка «Статистика»',
        'Кнопка «…» — действия',
      ]),
    );
    // На телефоне плашки по умолчанию скрыты, а список — карточками без фильтров столбцов, как в
    // прототипе: облачка показывают только видимое.
    if (!isMobile) {
      expect(titles).toEqual(
        expect.arrayContaining([
          'Плашка «Просрочено»',
          'Плашка «На этой неделе»',
          'Фильтр столбца',
        ]),
      );
    }
    expect(titles.some((x) => x.startsWith('Кнопка «+'))).toBe(true);
    // У каждого облачка — пояснение.
    expect(texts.every((x) => x.length > 0)).toBe(true);
    await nextButton(page).click();
    await expect(
      page.getByRole('dialog', { name: /^Шаг выполнен: вы посмотрели «Посмотреть вкладки/ }),
    ).toBeVisible();
    expect(await stepDone(page.request, 'rtabs')).toMatchObject({ how: 'show' });
  });

  // ОТКЛОНЕНИЕ: docs/deviations.md#Г-7
  test('(проверка задачи #87) «Показать как» у шага «Заполнить профиль организации», затем у «Добавить первого контрагента»: показ на «Контрагентах», «Сделать сейчас» открывает «Новый контрагент» и идёт по разделам и полям с пояснениями; «На весь экран» показывается — в показе профиля общих элементов нет, как в прототипе', async ({
    page,
    baseURL,
  }) => {
    await newOrgOwner(page.request, new URL(baseURL!).origin);
    await showStep(page, 'profile');
    await toEnd(page, ['Сделать сейчас']);
    await endShow(page);
    await expect(bubble(page)).toHaveCount(0);
    // Показ профиля пройден: его элементы стали знакомыми на сервере.
    await expect.poll(() => knownCount(page.request), { timeout: 15_000 }).toBeGreaterThan(0);

    await showStep(page, 'cp1');
    await expect(page).toHaveURL(/\/app\/cps\/all/);
    await position(page);
    await expect(titleOf(page)).toHaveText('Добавить первого контрагента или загрузить из Excel');
    const screen = await toEnd(page, ['Сделать сейчас']);
    // «+ Добавить» на телефоне — «+».
    expect(screen.titles.some((x) => x.startsWith('Кнопка «+'))).toBe(true);
    await nextButton(page).click();
    const form = page.getByRole('dialog', { name: 'Новый контрагент', exact: true });
    await expect(form).toBeVisible();
    await position(page);
    await expect(page.locator('[data-tour-skipped]')).toHaveCount(0);
    const fields = await toEnd(page, ['Понятно, заполню']);
    expect(fields.titles).toContain('«На весь экран»');
    // Оглавление формы (разделы) в показ не попадает, как в прототипе.
    expect(fields.titles.some((x) => x.startsWith('Вкладка'))).toBe(false);
    // Пояснение поля — из справочника показов по коду поля прототипа (nc-inn).
    const inn = fields.titles.indexOf('ИНН · обязательно');
    expect(inn).toBeGreaterThan(-1);
    expect(fields.texts[inn]).toBe(
      '14 цифр. Система проверит, что такого ИНН ещё нет, в том числе среди архивных.',
    );
    await nextButton(page).click();
    await expect(bubble(page)).toHaveCount(0);
    await expect(form).toBeVisible();
    expect(await stepDone(page.request, 'cp1')).toBeNull();
  });

  // ОТКЛОНЕНИЕ: docs/deviations.md#Г-7
  test('(проверка задачи #87) после показа «Ролей» показ «Добавить первого контрагента» пропускает знакомые общие элементы формы: «Пропущено знакомых элементов: N» и «Показать всё», «На весь экран» не показывается', async ({
    page,
    baseURL,
  }) => {
    await newOrgOwner(page.request, new URL(baseURL!).origin);
    await showStep(page, 'roles');
    const roles = await toEnd(page);
    expect(roles.titles).toContain('«На весь экран»');
    const saved = knownSaved(page);
    await nextButton(page).click();
    await saved;
    await page.getByRole('button', { name: 'Остаться здесь' }).click();

    await showStep(page, 'cp1');
    await toEnd(page, ['Сделать сейчас']);
    await nextButton(page).click();
    await expect(page.getByRole('dialog', { name: 'Новый контрагент', exact: true })).toBeVisible();
    await position(page);
    const skipped = page.locator('[data-tour-skipped]');
    await expect(skipped).toContainText(/Пропущено знакомых элементов: \d+/);
    await expect(skipped.getByRole('button', { name: 'Показать всё' })).toBeVisible();
    const fields = await toEnd(page, ['Понятно, заполню']);
    expect(fields.titles).not.toContain('«На весь экран»');
    expect(fields.titles).toContain('Название · обязательно');
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

  test('(проверка задачи #87) шаг «Сделать» — «Сделать сейчас»: открывается «Новый сотрудник», показ идёт по полям формы с «· обязательно» и пояснением поля; «Понятно, заполню» оставляет форму открытой, сохранение засчитывает шаг', async ({
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
    // Пояснение поля — из справочника показов по коду поля прототипа (ne-fio).
    const fio = fields.titles.indexOf('ФИО · обязательно');
    expect(fio).toBeGreaterThan(-1);
    expect(fields.texts[fio]).toBe('Фамилия, имя, отчество сотрудника.');
    await nextButton(page).click();
    await expect(bubble(page)).toHaveCount(0);
    await expect(form).toBeVisible();
    expect(await stepDone(page.request, 'emps')).toBeNull();

    // Форма заполнена и сохранена — шаг засчитан действием, окно «Готово: шаг … выполнен».
    await form.getByLabel('ФИО').fill('Показов Сквозной Тестович');
    await form.getByLabel('Логин').fill(uniqueLogin('e2e-show'));
    await form.getByRole('button', { name: 'Создать' }).click();
    await expect(form).toBeHidden();
    await expect(
      page.getByRole('dialog', { name: 'Готово: шаг «Добавить сотрудников» выполнен' }),
    ).toBeVisible();
    expect(await stepDone(page.request, 'emps')).toMatchObject({ how: 'action' });
  });

  test('(проверка задачи #87) «Сделать сейчас» у шага без формы: показ заканчивается, «Моя организация» открыта и нужное место подсвечено', async ({
    page,
    baseURL,
  }) => {
    await newOrgOwner(page.request, new URL(baseURL!).origin);
    await showStep(page, 'profile');
    const before = await toEnd(page, ['Сделать сейчас']);
    expect(before.label).toBe('Сделать сейчас');
    // Пояснение поля профиля — из справочника показов по коду поля прототипа (og-name).
    const name = before.titles.indexOf('Название · обязательно');
    expect(name).toBeGreaterThan(-1);
    expect(before.texts[name]).toBe('Название вашей фирмы, как в документах.');
    await nextButton(page).click();
    await expect(bubble(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/app\/org\/main/);
    await expect(page.locator('main [data-ck-flash]')).toBeVisible();
    expect(await stepDone(page.request, 'profile')).toBeNull();
  });
});
