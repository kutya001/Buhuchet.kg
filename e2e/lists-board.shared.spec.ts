import { expect, test, type APIRequestContext } from '@playwright/test';
import { boardBy, moveCard, openBoard } from './board';
import { asOwner, manualReport, newContractor, staffIds } from './reports';

// «Доска» в «Отчётах для сдачи» и «Контрагентах» (прототип v84–v87, modules/reports.js `repKanban`,
// modules/contractors.js `cpKanban`) через настоящий сайт. Вид списка хранится у пользователя, поэтому
// файл *.shared.spec.ts: идёт после остальных тестов и по одному — другим тестам владельца доска вместо
// таблицы не достанется; в конце вид списка сбрасывается.

const resetView = (api: APIRequestContext, origin: string, key: string) =>
  api.delete(`/api/view-settings/${key}`, { headers: { origin } });

const uniqueName = (text: string) =>
  `${text} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

test.describe('Этап 3: вид «Доска» в отчётах и контрагентах', () => {
  test('(проверка прототипа v84) «Доска» отчётов: столбцы статусов сдачи с числом записей и суммой; перенос карточки в «В работе» берёт отчёт в работу; недопустимый перенос — отказ с причиной; в виде по ответственному перенос меняет ответственного за отчёт', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = await asOwner(page.request, baseURL);
    const staff = await staffIds(page.request);
    const cp = await newContractor(page.request, origin, {
      name: uniqueName('ОсОО «Доска отчётов»'),
      responsible: staff.alisher!,
    });
    const id = await manualReport(page.request, origin, {
      contractorId: cp.id,
      reportTypeCode: 't1m',
      month: '2026-09-01',
      due: '2030-01-15',
    });
    await resetView(page.request, origin, 'reports.all');
    try {
      // Фильтр по ИНН оставляет один отчёт; пустые столбцы статусов остаются на доске.
      const preset = encodeURIComponent(JSON.stringify({ inn: { type: 'text', q: cp.inn } }));
      await page.goto(`/app/reports/all?preset=${preset}`);
      await expect(page.locator(`[data-grid] [data-id="${id}"]`)).toBeVisible();
      const board = await openBoard(page, isMobile);
      const column = (key: string) => board.locator(`[data-board-column="${key}"]`);
      const cardOf = `[data-board-card][data-id="${id}"]`;
      const card = board.locator(cardOf);
      const own = board.locator('[data-board-column]').filter({ has: page.locator(cardOf) });

      // Столбцы статусов сдачи видны и пустыми; в шапке — число записей.
      await expect(column('todo')).toHaveAttribute('aria-label', 'К сдаче: 1');
      await expect(column('in_progress')).toHaveAttribute('aria-label', 'В работе: 0');
      await expect(column('submitted')).toHaveAttribute('aria-label', 'Сдан: 0');
      // Сумма в шапке — целыми сомами: у столбца с записью без суммы «0», у пустого суммы нет.
      await expect(column('todo').locator('[data-board-sum]')).toHaveText('0');
      await expect(column('submitted').locator('[data-board-sum]')).toHaveCount(0);
      await expect(page.locator('[data-grid] [data-grid-group-button]')).toHaveCount(0);

      // «К сдаче» → «В работе»: то же, что «Взять в работу» в меню отчёта.
      await moveCard(page, isMobile, card, column('in_progress'), 'В работе');
      await expect(page.getByText('Статус: В работе')).toBeVisible();
      await expect(column('in_progress').locator(cardOf)).toBeVisible();

      // Обратно в «К сдаче» перетаскиванием нельзя — отказ с причиной, карточка на месте.
      await moveCard(page, isMobile, card, column('todo'), 'К сдаче');
      await expect(
        page.getByText('Из «В работе» в «К сдаче» отчёт перевести нельзя'),
      ).toBeVisible();
      await expect(column('in_progress').locator(cardOf)).toBeVisible();

      // «Столбцы: Ответственный»: перенос в столбец сотрудника меняет ответственного за отчёт.
      await boardBy(page, 'Ответственный');
      await expect(own.locator('header')).toContainText('Алишер Т.');
      await moveCard(page, isMobile, card, column(staff.aigerim!), 'Айгерим С.');
      await expect(
        page.getByText('Ответственный за отчёт: Айгерим С., задача перешла к нему'),
      ).toBeVisible();
      await expect(column(staff.aigerim!).locator(cardOf)).toBeVisible();
      const saved = (await (await page.request.get(`/api/reports/${id}`)).json()) as {
        status: string;
        responsible: { id: string } | null;
      };
      expect(saved.status).toBe('in_progress');
      expect(saved.responsible?.id).toBe(staff.aigerim);
    } finally {
      await resetView(page.request, origin, 'reports.all');
    }
  });

  test('(проверка прототипа v84) «Доска» контрагентов: столбцы — ответственные; перенос карточки в столбец другого сотрудника спрашивает «Сменить ответственного?» и после «Передать» меняет его; по другим полям перенос ничего не меняет', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = await asOwner(page.request, baseURL);
    const staff = await staffIds(page.request);
    const name = uniqueName('ОсОО «Доска контрагентов»');
    const cp = await newContractor(page.request, origin, { name, responsible: staff.alisher! });
    await resetView(page.request, origin, 'cps.all');
    try {
      await page.goto('/app/cps/all');
      await expect(page.locator(`[data-grid] [data-id="${cp.id}"]`)).toBeVisible();
      const board = await openBoard(page, isMobile);
      const column = (key: string) => board.locator(`[data-board-column="${key}"]`);
      const cardOf = `[data-board-card][data-id="${cp.id}"]`;
      const card = board.locator(cardOf);

      // По умолчанию столбцы — ответственные сотрудники.
      await expect(column(staff.alisher!).locator('header')).toContainText('Алишер Т.');
      await expect(column(staff.alisher!).locator(cardOf)).toBeVisible();

      // Перенос в столбец другого сотрудника — вопрос; «Отмена» ничего не меняет.
      await moveCard(page, isMobile, card, column(staff.aigerim!), 'Айгерим С.');
      const ask = page.getByRole('dialog', { name: 'Сменить ответственного?' });
      await expect(ask).toContainText(`«${name}»: Алишер Т. → Айгерим С.`);
      await ask.getByRole('button', { name: 'Отмена' }).click();
      await expect(column(staff.alisher!).locator(cardOf)).toBeVisible();

      // «Передать» — ответственный меняется, карточка в новом столбце.
      await moveCard(page, isMobile, card, column(staff.aigerim!), 'Айгерим С.');
      await ask.getByRole('button', { name: 'Передать' }).click();
      await expect(page.getByText('Ответственный изменён')).toBeVisible();
      await expect(column(staff.aigerim!).locator(cardOf)).toBeVisible();
      const saved = (await (await page.request.get(`/api/contractors/${cp.id}`)).json()) as {
        responsible: { id: string } | null;
      };
      expect(saved.responsible?.id).toBe(staff.aigerim);

      // «Столбцы: Статус обслуживания»: перетаскиванием статус не меняется.
      await boardBy(page, 'Статус обслуживания');
      await expect(column('active').locator(cardOf)).toBeVisible();
      await moveCard(page, isMobile, card, column('paused'), 'Приостановлен');
      await expect(page.getByText('Перетаскиванием меняется только ответственный')).toBeVisible();
      await expect(column('active').locator(cardOf)).toBeVisible();
    } finally {
      await resetView(page.request, origin, 'cps.all');
    }
  });
});
