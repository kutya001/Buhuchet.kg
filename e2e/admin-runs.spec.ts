import { expect, test, type APIRequestContext } from '@playwright/test';
import { platformAdmin, search } from './admin';

// Админка → «Запуски» (решение заказчика 17.11.2026; ТЗ «Доработки 17.11.2026», блок «Админка: запуски
// по расписанию и переписка бота»; прототип v132 admin/runs.js): задачи по расписанию, журнал их
// запусков и окно «Запуск». Только просмотр. Журнал запусков общий для всех тестов: тест не считает
// строки, а ждёт хотя бы один запуск своей задачи после собственного вызова расписания.

const CRON_SECRET = process.env.CRON_SECRET ?? 'local-cron-secret-change-me';
/** Задача, которая запускается каждую минуту: её запуск есть после любого вызова расписания. */
const JOB = 'telegram.send';
const POLL = { timeout: 90_000, intervals: [2_000, 5_000, 10_000] };

type Texts = Record<string, string>;

/** Тексты словаря интерфейса (`GET /api/l10n`): тест не копирует строки экрана. */
async function dictionary(api: APIRequestContext): Promise<Texts> {
  const res = await api.get('/api/l10n');
  expect(res.status()).toBe(200);
  return ((await res.json()) as { texts: Texts }).texts;
}

/** Запусков задачи за 7 дней — все, не только «Важные». */
async function runsOf(api: APIRequestContext): Promise<number> {
  const filters = JSON.stringify({ title: { type: 'enum', vals: [JOB] } });
  const res = await api.get(
    `/api/admin/runs?all=1&days=7&size=25&filters=${encodeURIComponent(filters)}`,
    { maxRetries: 2 },
  );
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { total: number }).total;
}

test.describe('Админка: запуски', () => {
  test('(доработки 17.11.2026) задача по расписанию с «Как часто» и «Что делает», её запуски и окно «Запуск»', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    // Расписание вызывает сам тест и ждёт запуск опросом: задачи идут не мгновенно.
    test.setTimeout(180_000);
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const texts = await dictionary(page.request);
    const title = texts['alert.job.telegram_send']!;
    expect(title).toBeTruthy();
    await expect
      .poll(async () => {
        const res = await page.request.post('/api/cron/tick', {
          headers: { authorization: `Bearer ${CRON_SECRET}` },
        });
        expect(res.status(), await res.text()).toBe(200);
        return runsOf(page.request);
      }, POLL)
      .toBeGreaterThan(0);

    // «Задачи»: название, «Как часто» словами и «Что делает» — у своей задачи.
    await page.goto('/app/runs/jobs');
    const found = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === '/api/admin/runs/jobs' &&
        new URL(r.url()).searchParams.get('q') === title,
    );
    await search(page, isMobile, title);
    expect((await found).status()).toBe(200);
    const job = page.locator(`[data-grid] [data-id="${JOB}"]`);
    await expect(job).toContainText(title);
    await expect(job).toContainText(texts['runs.every.minute']!);

    // Нажатие на задачу открывает её запуски: «Все» за 7 дней, с фильтром по задаче.
    await job.click();
    await expect(page).toHaveURL(/\/app\/runs\/runs(\?|$)/);
    const run = page.locator(`[data-runs-list] [data-grid] [data-id^="${JOB}:"]`).first();
    await expect(run).toContainText(title);
    await expect(
      page.locator('[data-runs-list] [data-grid] [data-id]').filter({ hasNotText: title }),
    ).toHaveCount(0);

    // Окно «Запуск»: задача со служебным именем, попытка и за какое время запуск.
    await run.click();
    const card = page.locator(`[data-run-card^="${JOB}:"]`);
    await expect(card).toContainText(title);
    await expect(card).toContainText(JOB);
    await expect(card).toContainText(texts['runs.col.slot']!);
    await expect(card).toContainText(texts['runs.col.tr']!);
    const runWindow = page.getByRole('dialog').filter({ has: card });
    await runWindow.getByRole('button', { name: 'Закрыть' }).last().click();
    await expect(card).toHaveCount(0);
  });

  test('(доработки 17.11.2026) «Запуски» видит только администратор платформы', async ({
    playwright,
    baseURL,
  }) => {
    const guest = await playwright.request.newContext({ baseURL });
    try {
      expect((await guest.get('/api/admin/runs/jobs')).status()).toBe(401);
      expect((await guest.get('/api/admin/runs')).status()).toBe(401);
    } finally {
      await guest.dispose();
    }
  });
});
