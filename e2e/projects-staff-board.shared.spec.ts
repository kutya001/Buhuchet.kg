import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { boardBy, moveCard, openBoard } from './board';
import { asOwner, newContractor, staffIds } from './reports';

// «Доска» в «Проектах контрагентов» и «Сотрудниках» (прототип v85, modules/projects.js `projKanban`,
// modules/staff.js `staffKanban`) через настоящий сайт. Вид списка хранится у пользователя, поэтому
// файл *.shared.spec.ts: идёт после остальных тестов и по одному — другим тестам владельца доска вместо
// таблицы не достанется; в конце вид списка сбрасывается.

const resetView = (api: APIRequestContext, origin: string, key: string) =>
  api.delete(`/api/view-settings/${key}`, { headers: { origin } });

/** Слово из кириллицы, своё на каждый запуск: по нему поиск находит только записи теста. */
const uniqueWord = (prefix: string) =>
  `${prefix}${Array.from({ length: 6 }, () => 'абвгдежзиклмнопрстуф'[Math.floor(Math.random() * 20)]).join('')}`;

const uniqueLogin = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Общий поиск по вкладке (на телефоне — кнопкой «Поиск» в верхней панели). */
async function search(page: Page, isMobile: boolean, text: string) {
  if (isMobile) await page.getByRole('button', { name: 'Поиск', exact: true }).click();
  await page.getByRole('searchbox').first().fill(text);
}

/** Сегодня по Бишкеку и день через `days` дней. */
const day = (days: number) =>
  new Date(Date.now() + 6 * 3600_000 + days * 86_400_000).toISOString().slice(0, 10);

test.describe('Этап 3: вид «Доска» в проектах и сотрудниках', () => {
  test('(проверка прототипа v85) «Доска» проектов: столбцы статусов видны и пустыми; перенос в «В работе» меняет статус сразу, через шаг и назад — отказ с причиной; в виде по главному перенос в столбец сотрудника меняет главного и добавляет его в ответственные', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = await asOwner(page.request, baseURL);
    const staff = await staffIds(page.request);
    const word = uniqueWord('Доска');
    const cp = await newContractor(page.request, origin, {
      name: `ОсОО «${word}»`,
      tariffAmount: 0,
    });
    const create = async (title: string, lead: string) => {
      const res = await page.request.post('/api/projects', {
        headers: { origin },
        data: {
          contractorId: cp.id,
          name: `${title} ${word}`,
          startsOn: day(0),
          endsOn: day(30),
          plan: null,
          members: [lead],
          lead,
        },
      });
      expect(res.status(), await res.text()).toBe(201);
      return ((await res.json()) as { id: string }).id;
    };
    const id = await create('Восстановление учёта', staff.alisher!);
    // Второй проект — чтобы у Айгерим был свой столбец в виде «по главному».
    await create('Постановка учёта', staff.aigerim!);
    await resetView(page.request, origin, 'projects.all');
    try {
      await page.goto('/app/projects/all');
      await expect(page.locator('[data-grid]')).toBeVisible();
      await search(page, isMobile, word);
      await expect(page.locator(`[data-grid] [data-id="${id}"]`)).toBeVisible();
      const board = await openBoard(page, isMobile);
      const column = (key: string) => board.locator(`[data-board-column="${key}"]`);
      const cardOf = `[data-board-card][data-id="${id}"]`;
      const card = board.locator(cardOf);
      const toast = (text: string | RegExp) => page.getByRole('status').filter({ hasText: text });

      // По умолчанию столбцы — статусы; «В работе» и «Завершён» видны и пустыми.
      await expect(column('planned').locator('header')).toContainText('Планируется');
      await expect(column('planned').locator(cardOf)).toBeVisible();
      await expect(column('in_progress').locator('header')).toContainText('В работе');
      await expect(column('done').locator('header')).toContainText('Завершён');

      // Через шаг — отказ с причиной, статус прежний.
      await moveCard(page, isMobile, card, column('done'), 'Завершён');
      await expect(toast('Из «Планируется» в «Завершён» проект перевести нельзя')).toBeVisible();
      await expect(column('planned').locator(cardOf)).toBeVisible();

      // Шаг вперёд по шкале — сразу.
      await moveCard(page, isMobile, card, column('in_progress'), 'В работе');
      await expect(toast('Статус проекта: В работе')).toBeVisible();
      await expect(column('in_progress').locator(cardOf)).toBeVisible();

      // Назад перетаскиванием нельзя: откат — в меню проекта.
      await moveCard(page, isMobile, card, column('planned'), 'Планируется');
      await expect(toast(/проект перевести нельзя: откат — в меню проекта/)).toBeVisible();
      await expect(column('in_progress').locator(cardOf)).toBeVisible();

      // «Столбцы: Главный»: перенос в столбец другого сотрудника меняет главного.
      await boardBy(page, 'Главный');
      await expect(column(staff.alisher!).locator('header')).toContainText('Алишер Т.');
      await expect(column(staff.alisher!).locator(cardOf)).toBeVisible();
      await moveCard(page, isMobile, card, column(staff.aigerim!), 'Айгерим С.');
      await expect(toast('Главный по проекту: Айгерим С.')).toBeVisible();
      await expect(column(staff.aigerim!).locator(cardOf)).toBeVisible();
      const saved = (await (await page.request.get(`/api/projects/${id}`)).json()) as {
        status: string;
        lead: { id: string };
        members: { id: string }[];
      };
      expect(saved.status).toBe('in_progress');
      expect(saved.lead.id).toBe(staff.aigerim);
      expect(saved.members.map((m) => m.id).sort()).toEqual(
        [staff.alisher!, staff.aigerim!].sort(),
      );
    } finally {
      await resetView(page.request, origin, 'projects.all');
    }
  });

  test('(проверка прототипа v85) «Доска» сотрудников: столбцы — роли организации; перенос в столбец другой роли спрашивает «Сменить роль?» и после подтверждения меняет её; в роль владельца и по статусу перенос ничего не меняет', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = await asOwner(page.request, baseURL);
    const roles = (
      (await (await page.request.get('/api/roles?size=all')).json()) as {
        items: { id: string; name: string; isOwner: boolean }[];
      }
    ).items;
    const accountant = roles.find((r) => r.name === 'Бухгалтер')!;
    const chief = roles.find((r) => r.name === 'Главный бухгалтер')!;
    const ownerRole = roles.find((r) => r.isOwner)!;
    const word = uniqueWord('Доска');
    const hire = async (n: string) => {
      const res = await page.request.post('/api/staff', {
        headers: { origin },
        data: {
          fullName: `Перестановов ${word} ${n}`,
          login: uniqueLogin('e2e-board'),
          roleId: accountant.id,
        },
      });
      expect(res.status(), await res.text()).toBe(201);
      return ((await res.json()) as { employee: { id: string; version: number } }).employee;
    };
    const first = await hire('Первый');
    // Второй — заблокирован: у доски «по статусу» будет столбец «Заблокирован».
    const second = await hire('Второй');
    const blocked = await page.request.post(`/api/staff/${second.id}/block`, {
      headers: { origin },
      data: { version: second.version },
    });
    expect(blocked.status(), await blocked.text()).toBe(200);
    await resetView(page.request, origin, 'staff.list');
    try {
      await page.goto('/app/staff/list');
      await expect(page.locator('[data-grid]')).toBeVisible();
      await search(page, isMobile, word);
      await expect(page.locator(`[data-grid] [data-id="${first.id}"]`)).toBeVisible();
      const board = await openBoard(page, isMobile);
      const column = (key: string) => board.locator(`[data-board-column="${key}"]`);
      const cardOf = `[data-board-card][data-id="${first.id}"]`;
      const card = board.locator(cardOf);
      const toast = (text: string) => page.getByRole('status').filter({ hasText: text });
      const roleOf = async () =>
        (await (await page.request.get(`/api/staff/${first.id}`)).json()) as {
          role: { id: string };
          active: boolean;
        };

      // По умолчанию столбцы — роли организации, видны и пустыми.
      await expect(column(accountant.id).locator('header')).toContainText('Бухгалтер');
      await expect(column(accountant.id).locator(cardOf)).toBeVisible();
      await expect(column(chief.id).locator('header')).toContainText('Главный бухгалтер');
      await expect(column(ownerRole.id).locator('header')).toContainText(ownerRole.name);

      // В роль владельца — отказ.
      await moveCard(page, isMobile, card, column(ownerRole.id), ownerRole.name);
      await expect(toast('Владелец в организации один')).toBeVisible();
      await expect(column(accountant.id).locator(cardOf)).toBeVisible();

      // Другая роль — вопрос; «Отмена» ничего не меняет.
      await moveCard(page, isMobile, card, column(chief.id), 'Главный бухгалтер');
      const ask = page.getByRole('dialog', { name: 'Сменить роль?' });
      await expect(ask).toContainText(
        `Перестановов ${word} Первый: Бухгалтер → Главный бухгалтер. Права сотрудника изменятся сразу.`,
      );
      await ask.getByRole('button', { name: 'Отмена' }).click();
      await expect(column(accountant.id).locator(cardOf)).toBeVisible();
      expect((await roleOf()).role.id).toBe(accountant.id);

      // «Сменить роль» — роль меняется, карточка в новом столбце.
      await moveCard(page, isMobile, card, column(chief.id), 'Главный бухгалтер');
      await ask.getByRole('button', { name: 'Сменить роль' }).click();
      await expect(toast('Роль изменена')).toBeVisible();
      await expect(column(chief.id).locator(cardOf)).toBeVisible();
      expect((await roleOf()).role.id).toBe(chief.id);

      // «Столбцы: Статус»: перетаскиванием сотрудник не блокируется.
      await boardBy(page, 'Статус');
      await expect(column('active').locator(cardOf)).toBeVisible();
      await moveCard(page, isMobile, card, column('blocked'), 'Заблокирован');
      await expect(toast('Перетаскиванием меняется только роль')).toBeVisible();
      await expect(column('active').locator(cardOf)).toBeVisible();
      expect((await roleOf()).active).toBe(true);
    } finally {
      await resetView(page.request, origin, 'staff.list');
    }
  });
});
