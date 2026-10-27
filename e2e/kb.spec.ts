import { expect, test, type APIRequestContext } from '@playwright/test';
import { newOrgOwner } from './helpers';

// «База знаний»: программа обучения, уроки и уровни (задача 2.30). Шаги засчитываются один раз и
// навсегда по истории действий пользователя, поэтому каждый тест — со своей новой организацией и её
// владельцем (`newOrgOwner`): у него ещё ничего не засчитано, а демо-организация не меняется.

type KbMe = {
  progress: { pct: number; done: number };
  lessons: { steps: { id: string; done: { how: string } | null }[] }[];
};

async function kbMe(api: APIRequestContext) {
  const res = await api.get('/api/kb/me');
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as KbMe;
}

const stepDone = (me: KbMe, id: string) =>
  me.lessons.flatMap((l) => l.steps).find((s) => s.id === id)?.done ?? null;

test.describe('Этап 2: База знаний — программа, уроки, уровни', () => {
  test('(п. 12) владелец нажал «Перейти» у «Заполнить профиль организации», сохранил профиль — окно с «Вернуться к Базе знаний», «Следующий шаг» и «Остаться здесь»; шаг отмечен, прогресс вырос', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    await newOrgOwner(page.request, origin);
    const before = await kbMe(page.request);
    expect(stepDone(before, 'profile')).toBeNull();

    await page.goto('/app/kb/lessons');
    const step = page.locator('[data-kb-step="profile"]');
    await expect(step).toHaveAttribute('data-kb-state', 'open');
    await step.getByRole('button', { name: 'Перейти' }).click();
    await expect(page).toHaveURL(/\/app\/org\/main/);
    const main = page.locator('main');
    await main.getByLabel('Адрес', { exact: true }).fill('г. Бишкек, ул. Сквозная, 1');
    await main.getByRole('button', { name: 'Сохранить' }).click();

    const done = page.getByRole('dialog', {
      name: 'Готово: шаг «Заполнить профиль организации» выполнен',
    });
    await expect(done).toBeVisible();
    await expect(done.getByRole('button', { name: 'Остаться здесь' })).toBeVisible();
    await expect(done.getByRole('button', { name: /^Следующий шаг: / })).toBeVisible();
    await expect(done.getByRole('button', { name: 'Вернуться к Базе знаний' })).toBeVisible();
    const after = await kbMe(page.request);
    expect(stepDone(after, 'profile')).toMatchObject({ how: 'action' });
    expect(after.progress.pct).toBeGreaterThan(before.progress.pct);
    await expect(done).toContainText(`· ${after.progress.pct} %`);

    // «Вернуться к Базе знаний» — в «Уроки»: шаг отмечен, как засчитан — видно.
    await done.getByRole('button', { name: 'Вернуться к Базе знаний' }).click();
    await expect(page).toHaveURL(/\/app\/kb\/lessons/);
    await expect(step).toHaveAttribute('data-kb-state', 'done');
    await expect(step).toContainText('засчитано действием');
    await expect(step.getByRole('button', { name: 'Перейти' })).toHaveCount(0);
  });

  test('(п. 75) «Перейти» у шага «Посмотреть»: полоса-таймер, через 3 секунды «Шаг выполнен»; ушли с экрана раньше — шаг не засчитан', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    await newOrgOwner(page.request, origin);
    await page.goto('/app/kb/lessons');
    const bar = page.locator('[data-kb-bar="look"]');

    // Пробыли на экране шага 3 секунды — окно «Шаг выполнен» с «Следующий шаг» и «Вернуться к Базе знаний».
    await page.locator('[data-kb-step="roles"]').getByRole('button', { name: 'Перейти' }).click();
    await expect(page).toHaveURL(/\/app\/staff\/roles/);
    await expect(bar).toContainText('Смотрите экран…');
    const started = Date.now();
    const looked = page.getByRole('dialog', {
      name: 'Шаг выполнен: вы посмотрели «Посмотреть роли и права»',
    });
    await expect(looked).toBeVisible({ timeout: 8000 });
    expect(Date.now() - started).toBeGreaterThan(2500);
    await expect(looked.getByRole('button', { name: /^Следующий шаг: / })).toBeVisible();
    expect(stepDone(await kbMe(page.request), 'roles')).toMatchObject({ how: 'visit' });
    await looked.getByRole('button', { name: 'Вернуться к Базе знаний' }).click();
    await expect(page).toHaveURL(/\/app\/kb\/lessons/);
    await expect(page.locator('[data-kb-step="roles"]')).toHaveAttribute('data-kb-state', 'done');

    // Ушли с экрана раньше 3 секунд («Назад») — таймер сброшен, шаг не засчитан.
    const pdicts = page.locator('[data-kb-step="pdicts"]');
    await pdicts.getByRole('button', { name: 'Перейти' }).click();
    await expect(page).toHaveURL(/\/app\/dicts\/platform/);
    await expect(bar).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/app\/kb\/lessons/);
    await expect(bar).toHaveCount(0);
    await page.waitForTimeout(4000);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(pdicts).toHaveAttribute('data-kb-state', 'open');
    expect(stepDone(await kbMe(page.request), 'pdicts')).toBeNull();

    // Повторное «Перейти» запускает таймер снова.
    await pdicts.getByRole('button', { name: 'Перейти' }).click();
    await expect(bar).toBeVisible();
    await expect(
      page.getByRole('dialog', {
        name: /^Шаг выполнен: вы посмотрели «Посмотреть справочники платформы/,
      }),
    ).toBeVisible({ timeout: 8000 });
  });
});
