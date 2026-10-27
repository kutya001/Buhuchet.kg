import { expect, test, type APIRequestContext } from '@playwright/test';
import { platformAdmin } from './admin';
import { DEMO_PASSWORD, signIn } from './helpers';

// «Задачи» (задача 2.23, #79): выключенная в учётной политике «Задачи требуют подтверждения» и
// «Категории задач» в Админке. Меняет общую запись демо-организации и создаёт администратора
// платформы, поэтому файл *.shared.spec.ts: идёт после остальных тестов и по одному
// (playwright.config.ts). Политика возвращается как была.

test.describe.configure({ mode: 'serial' });

type Policy = { version: number; taskConfirm: boolean };

async function policy(api: APIRequestContext) {
  const res = await api.get('/api/org/policy');
  expect(res.status()).toBe(200);
  return (await res.json()) as Policy;
}

async function setTaskConfirm(api: APIRequestContext, origin: string, taskConfirm: boolean) {
  const res = await api.patch('/api/org/policy', {
    headers: { origin },
    data: { version: (await policy(api)).version, taskConfirm },
  });
  expect(res.status(), await res.text()).toBe(200);
}

test.describe('Этап 2: задачи — учётная политика', () => {
  test('(п. 42) «Задачи требуют подтверждения» выключено: новая задача открывается с выключенным переключателем, «Выполнена» сразу закрывает её', async ({
    page,
    playwright,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    const owner = await playwright.request.newContext({ baseURL });
    await signIn(owner, origin, 'erkin', DEMO_PASSWORD);
    const before = (await policy(owner)).taskConfirm;
    try {
      await setTaskConfirm(owner, origin, false);
      const title = `Подготовить сверку ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

      await signIn(page.request, origin, 'meerim', DEMO_PASSWORD);
      await page.goto('/app/tasks/mine');
      await page.getByRole('button', { name: 'Добавить', exact: true }).click();
      const form = page.getByRole('dialog', { name: 'Новая задача' });
      await expect(form.getByRole('switch', { name: 'Требуется подтверждение' })).not.toBeChecked();
      await form.getByLabel(/^Название/).fill(title);
      await form.getByRole('button', { name: 'Поставить задачу' }).click();
      await expect(form).toBeHidden();

      if (isMobile) await page.getByRole('button', { name: 'Поиск', exact: true }).click();
      await page.getByRole('searchbox').first().fill(title);
      const row = page.locator('[data-grid] [data-id]').filter({ hasText: title });
      await expect(row).toHaveCount(1);
      await row.getByText(title, { exact: true }).click();
      const card = page.getByRole('dialog', { name: title });
      await expect(card).toContainText(/Подтверждение\s*Не требуется/);
      await card.locator('[data-task-button="done"]').click();
      const done = page.getByRole('dialog', { name: 'Задача выполнена' });
      await expect(done).not.toContainText('подтвердит');
      await done.getByRole('button', { name: 'Выполнена' }).click();
      await expect(done).toBeHidden();
      await expect(page.getByRole('status').filter({ hasText: 'Задача выполнена' })).toBeVisible();
      await expect(card.locator('ol[data-status-scale] [aria-current="step"]')).toContainText(
        'Выполнена',
      );
      await expect(card.locator('[data-task-button]')).toHaveCount(0);
      await expect(card.locator('[data-status-history] tbody > tr').first()).toContainText(
        'Выполнена',
      );
    } finally {
      await setTaskConfirm(owner, origin, before);
      await owner.dispose();
    }
  });
});

test.describe('Этап 2: задачи — «Категории задач» в Админке', () => {
  test('администратор видит «Категории задач»: пояснение, значения, «Используется» по задачам организаций', async ({
    page,
    baseURL,
  }) => {
    await platformAdmin(page.request, new URL(baseURL!).origin);
    await page.goto('/app/pdicts/cats');
    await expect(page.locator('[data-pdicts-head]')).toContainText(
      'Работа системы · Категории задач',
    );
    await expect(page.getByText('Шаблон для организаций: категории ручных задач')).toBeVisible();
    await expect(page.getByText('Сбор документов').first()).toBeVisible();
    const res = await page.request.get('/api/admin/platform-dicts/cats?size=all');
    expect(res.status(), await res.text()).toBe(200);
    const items = ((await res.json()) as { items: { code: string; used: number }[] }).items;
    expect(items.map((x) => x.code)).toContain('КАТ-001');
    // Демо-задачи ссылаются на категории — значит, «Используется» не ноль.
    expect(items.some((x) => x.used > 0)).toBe(true);
  });
});
