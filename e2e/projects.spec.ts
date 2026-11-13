import { expect, test, type Locator, type Page } from '@playwright/test';
import { DEMO_PASSWORD, showStats, signIn } from './helpers';
import { asOwner, newContractor } from './reports';

// «Проекты контрагентов» (задача 2.26, #82, часть 1) через настоящий сайт. Демо-организация: владелец
// erkin, главный бухгалтер meerim (право «Вести проекты и разовые услуги», без «Отката статусов»).
// Проекты демо-данных: «Восстановление учёта 2024–2025» у ОсОО «Ала-Тоо Трейд» (в работе), «Переход на
// единый налог» у ОсОО «Манас Авто Плюс». Свои контрагенты, проекты и задачи — со своим словом на каждый
// запуск и проект (ПК и телефон).

/** Слово из кириллицы, своё на каждый запуск: по нему поиск находит только запись теста. */
const uniqueWord = (prefix: string) =>
  `${prefix}${Array.from({ length: 6 }, () => 'абвгдежзиклмнопрстуф'[Math.floor(Math.random() * 20)]).join('')}`;

/** «+ Добавить» модуля с одним способом — сразу окно. */
const add = (page: Page) => page.getByRole('button', { name: 'Добавить', exact: true }).click();

/** Общий поиск по вкладке (на телефоне — кнопкой «Поиск» в верхней панели). */
async function search(page: Page, isMobile: boolean, text: string) {
  if (isMobile) await page.getByRole('button', { name: 'Поиск', exact: true }).click();
  await page.getByRole('searchbox').first().fill(text);
}

/** Подписи вариантов выпадающего списка. */
const optionsOf = (select: Locator) =>
  select.evaluate((el: HTMLSelectElement) => [...el.options].map((o) => o.text));

/** «Проекты контрагентов» → «Все» → поиск → карточка проекта. */
async function openProject(page: Page, isMobile: boolean, name: string) {
  await page.goto('/app/projects/all');
  await expect(page.locator('[data-grid]')).toBeVisible();
  await search(page, isMobile, name);
  const row = page.locator('[data-grid] [data-id]').filter({ hasText: name });
  await expect(row).toHaveCount(1);
  await row.getByText(name, { exact: true }).click();
  const card = page.getByRole('dialog', { name });
  await expect(card.locator('[data-project-card] ol[data-status-scale]')).toBeVisible();
  return card;
}

test.describe('Этап 2: проекты контрагентов', () => {
  test('(п. 16, проект) задача «По контрагенту» с галочкой «Проект» показывает поле проекта только с проектами выбранного контрагента; проект задачи — ссылкой в её карточке и в карточке проекта', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const title = uniqueWord('Акт сверки ');
    await signIn(page.request, new URL(baseURL!).origin, 'meerim', DEMO_PASSWORD);
    await page.goto('/app/tasks/byme');
    await expect(page.locator('[data-grid]')).toBeVisible();
    await add(page);
    const form = page.getByRole('dialog', { name: 'Новая задача' });
    await form.locator('[data-task-scope]').getByRole('button', { name: 'По контрагенту' }).click();
    const withProject = form.getByRole('switch', { name: 'Проект' });
    await expect(withProject).not.toBeChecked();
    await withProject.check();
    const project = form.getByRole('combobox', { name: /^Проект/ });
    await expect(project).toBeVisible();
    // Контрагент не выбран — сначала его.
    await expect.poll(() => optionsOf(project)).toEqual(['— сначала выберите контрагента —']);
    await form.getByLabel(/^Контрагент/).selectOption({ label: 'ОсОО «Ала-Тоо Трейд»' });
    await expect
      .poll(() => optionsOf(project))
      .toEqual(['— выберите проект —', 'Восстановление учёта 2024–2025']);
    await form.getByLabel(/^Название/).fill(title);
    await form.getByRole('button', { name: 'Поставить задачу' }).click();
    await expect(form).toContainText('Выберите проект или снимите галочку «Проект»');
    await project.selectOption({ label: 'Восстановление учёта 2024–2025' });
    // У другого контрагента — его проекты; выбранный проект снимается.
    await form.getByLabel(/^Контрагент/).selectOption({ label: 'ОсОО «Манас Авто Плюс»' });
    await expect
      .poll(() => optionsOf(project))
      .toEqual(['— выберите проект —', 'Переход на единый налог']);
    await form.getByLabel(/^Контрагент/).selectOption({ label: 'ОсОО «Ала-Тоо Трейд»' });
    await project.selectOption({ label: 'Восстановление учёта 2024–2025' });
    await form.getByRole('button', { name: 'Поставить задачу' }).click();
    await expect(form).toBeHidden();

    await search(page, isMobile, title);
    const row = page.locator('[data-grid] [data-id]').filter({ hasText: title });
    await expect(row).toHaveCount(1);
    await row.getByText(title, { exact: true }).click();
    const card = page.getByRole('dialog', { name: title });
    await expect(card).toContainText('ОсОО «Ала-Тоо Трейд»');
    await card.getByRole('button', { name: 'Восстановление учёта 2024–2025' }).click();
    const projectCard = page.getByRole('dialog', { name: 'Восстановление учёта 2024–2025' });
    await expect(projectCard.locator('[data-project-card]')).toBeVisible();
    await expect(projectCard.locator('[data-pj-task-row]').filter({ hasText: title })).toHaveCount(
      1,
    );
  });

  test('(п. 33, карточка проекта) на телефоне в карточке проекта шкала — шаги столбиком с датами справа, «История статусов» — записи одна под другой; ничего не обрезано и не прокручивается вбок', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    // Свой проект: создан «В работе» и завершён — две записи «Истории статусов» (у демо-проектов, как в
    // прототипе, одна: «Проект создан»).
    const origin = await asOwner(page.request, baseURL);
    const word = uniqueWord('Проверка');
    const cp = await newContractor(page.request, origin, {
      name: `ОсОО «${word}»`,
      tariffAmount: 0,
    });
    const me = (await (await page.request.get('/api/auth/me')).json()) as {
      employee: { id: string } | null;
    };
    const name = `Подготовка к налоговой проверке ${word}`;
    const created = await page.request.post('/api/projects', {
      headers: { origin },
      data: {
        contractorId: cp.id,
        status: 'in_progress',
        name,
        startsOn: '2026-10-01',
        endsOn: '2026-12-31',
        description: '',
        plan: null,
        members: [me.employee!.id],
        lead: me.employee!.id,
        works: [],
      },
    });
    expect(created.status()).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const { version } = (await (await page.request.get(`/api/projects/${id}`)).json()) as {
      version: number;
    };
    const done = await page.request.post(`/api/projects/${id}/status`, {
      headers: { origin },
      data: { to: 'done', version },
    });
    expect(done.status()).toBe(200);

    const card = await openProject(page, isMobile, name);
    const steps = card.locator('ol[data-status-scale] > li > button');
    await expect(steps).toHaveCount(3);
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
      return [...dialog.querySelectorAll('[data-project-card] *')]
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

  test('(проверка задачи #82) «+ Добавить» → «Проект»: карточка открывается сама; «В работу» на шкале после вопроса, работа отмечается сделанной, откат — только с причиной', async ({
    page,
    request,
    baseURL,
    isMobile,
  }) => {
    const origin = await asOwner(request, baseURL);
    const word = uniqueWord('Проект');
    const cpName = `ОсОО «${word}»`;
    const cp = await newContractor(request, origin, { name: cpName, tariffAmount: 0 });
    const name = `Восстановление учёта ${word}`;

    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    await page.goto('/app/projects/active');
    await expect(page.locator('[data-grid]')).toBeVisible();
    // Плашки-итоги по умолчанию скрыты (прототип v88) — на ПК показать кнопкой «Статистика».
    if (!isMobile) {
      await showStats(page);
      await expect(page.locator('[data-plate="run"]')).toBeVisible();
    }
    await add(page);
    const dlg = page.getByRole('dialog', { name: 'Новый проект' });
    await dlg.locator('[data-pd-ok]').click();
    await expect(dlg).toContainText('Введите название');
    await expect(dlg).toContainText('Выберите контрагента');
    await dlg.locator('[data-pd-name]').fill(name);
    await dlg.locator('[data-pd-cp]').selectOption(cp.id);
    await dlg.locator('[data-pd-plan]').fill('50000');
    await dlg.locator('[data-pd-work-add]').click();
    await dlg.locator('[data-pd-work-name]').last().fill('Подготовить документы к освоению');
    await dlg.locator('[data-pd-ok]').click();
    await expect(dlg).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'Проект создан' })).toBeVisible();

    // Прототип: созданный проект сразу открывается.
    const card = page.getByRole('dialog', { name });
    await expect(card.locator('[data-project-card]')).toBeVisible();
    await expect(card).toContainText(cpName);
    await expect(card).toContainText('Работы · 0 из 1');
    await expect(card).toContainText(/Запланировано\s*50\s000\sсом/);

    await card.locator('ol[data-status-scale] button[title="Перевести в «В работе»"]').click();
    const ask = page.getByRole('dialog', { name: 'Перевести проект в «В работе»?' });
    await ask.getByRole('button', { name: 'В работу' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Статус проекта: В работе' }),
    ).toBeVisible();
    await expect(card.locator('[data-status-history] tbody > tr')).toHaveCount(2);

    await card.locator('[data-pj-work]').check();
    await expect(card).toContainText('Работы · 1 из 1');
    await expect(card).toContainText('Сделано: Подготовить документы к освоению');

    await card.locator('[data-pj-more]').click();
    await page.getByRole('menuitem', { name: 'Откатить в «Планируется»' }).click();
    const back = page.getByRole('dialog', { name: 'Откатить: «В работе» → «Планируется»' });
    await expect(back).toContainText('Проект вернётся в план.');
    await back.locator('[data-rollback-ok]').click();
    await expect(back).toContainText('Укажите причину');
    await back.getByRole('textbox').fill('Ошиблись со сроком начала');
    await back.locator('[data-rollback-ok]').click();
    await expect(back).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'Откат выполнен' })).toBeVisible();
    await expect(card.locator('[data-status-history]')).toContainText('Ошиблись со сроком начала');
    const saved = (await (await request.get(`/api/contractors/${cp.id}/projects`)).json()) as {
      items: { name: string; status: string }[];
    };
    expect(saved.items).toEqual([expect.objectContaining({ name, status: 'planned' })]);
  });

  test('(п. 66, транш проекта) транш 50 000 сом, изменённый на 45 000 сом с причиной, уменьшает «получено» проекта; без причины сумма не меняется', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    // Свой проект со стоимостью 60 000 сом: транш записывается в карточке, меняется в окне транша.
    const origin = await asOwner(page.request, baseURL);
    const word = uniqueWord('Транш');
    const cp = await newContractor(page.request, origin, {
      name: `ОсОО «${word}»`,
      tariffAmount: 0,
    });
    const me = (await (await page.request.get('/api/auth/me')).json()) as {
      employee: { id: string } | null;
    };
    const name = `Аудит запасов ${word}`;
    const created = await page.request.post('/api/projects', {
      headers: { origin },
      data: {
        contractorId: cp.id,
        status: 'in_progress',
        name,
        startsOn: '2026-10-01',
        endsOn: '2026-12-31',
        description: '',
        plan: 6_000_000,
        members: [me.employee!.id],
        lead: me.employee!.id,
        works: [],
      },
    });
    expect(created.status()).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const card = await openProject(page, isMobile, name);
    await expect(card).toContainText('Оплаты (транши) · 0');
    await expect(card).toContainText('Оплат пока не было');
    await card.locator('[data-pj-pay]').click();
    const pay = page.getByRole('dialog').filter({ has: page.locator('[data-pj-pay-dlg]') });
    await expect(pay).toContainText(/Осталось получить\s*60\s000\sсом/);
    await pay.locator('[data-pt-amount]').fill('70000');
    await pay.locator('[data-pt-ok]').click();
    await expect(pay).toContainText(/Больше остатка: осталось\s*60\s000\sсом/);
    await pay.locator('[data-pt-amount]').fill('50000');
    await pay.locator('[data-pt-note]').fill('Аванс');
    await pay.locator('[data-pt-ok]').click();
    await expect(pay).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'Оплата записана' })).toBeVisible();
    await expect(card).toContainText('Оплаты (транши) · 1');
    await expect(card.locator('[data-pj-paid]')).toHaveText(/^50\s000/);
    await expect(card).toContainText(/Получено\s*50\s000\sсом/);

    // Окно транша → «Изменить»: без причины сумма не меняется, с причиной — меняется.
    await card.locator('[data-pt-row]').click();
    const win = page.getByRole('dialog').filter({ has: page.locator('[data-pt-window]') });
    await expect(win.locator('[data-pt-received]')).toHaveText(/^50\s000\sсом из 60\s000\sсом$/);
    await win.locator('[data-fin-action="edit"]').click();
    const edit = page.getByRole('dialog').filter({ has: page.locator('[data-pt-edit]') });
    await edit.locator('[data-pt-amount]').fill('45000');
    await edit.locator('[data-pt-ok]').click();
    await expect(edit).toContainText('Укажите причину: меняется сумма');
    const before = (await (await page.request.get(`/api/projects/${id}`)).json()) as {
      money: { paid: number } | null;
    };
    expect(before.money?.paid).toBe(5_000_000);
    await edit.locator('[data-pt-reason]').fill('Клиент вернул 5 000 сом');
    await edit.locator('[data-pt-ok]').click();
    await expect(edit).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'Операция изменена' })).toBeVisible();
    await expect(win).toContainText('Изменена');
    await expect(win).toContainText('Клиент вернул 5 000 сом');
    await expect(win.locator('[data-pt-received]')).toHaveText(/^45\s000\sсом из 60\s000\sсом$/);
    await win.getByRole('button', { name: 'Готово', exact: true }).click();
    await expect(win).toBeHidden();

    await expect(card.locator('[data-pj-paid]')).toHaveText(/^45\s000/);
    await expect(card).toContainText(/Получено\s*45\s000\sсом/);
    await expect(card.locator('[data-pt-row]')).toContainText('изменён');
    const after = (await (await page.request.get(`/api/projects/${id}`)).json()) as {
      money: { paid: number } | null;
    };
    expect(after.money?.paid).toBe(4_500_000);
  });
});
