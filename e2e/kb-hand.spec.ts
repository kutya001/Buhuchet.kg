import { expect, test, type APIRequestContext } from '@playwright/test';
import { ownerPassword } from './admin';
import { newOrgOwner, signIn, uniqueLogin } from './helpers';

// «Отметить выполненным» в «Уроках» (решение заказчика 06.11.2026, прототип v74 ckHandMark, ckHandOff):
// шаг засчитывается сразу, без перехода и показа, в процент и уровень; «Снять отметку» возвращает
// его, полученный уровень не понижается. Своя организация на каждый тест и проект: шаги засчитываются
// по истории действий, а демо-организация не меняется. Правила — `packages/api/src/modules/kb/kb.test.ts`.

type KbMe = {
  progress: { pct: number; done: number; total: number; level: number };
  lessons: { steps: { id: string; learn: boolean; screens: string[] }[] }[];
};

async function kbMe(api: APIRequestContext) {
  const res = await api.get('/api/kb/me');
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as KbMe;
}

test.describe('Этап 3: База знаний — «Отметить выполненным» (прототип v74)', () => {
  test('(прототип v74) бухгалтер в «Уроках» нажал «Отметить выполненным» у шага «Посмотреть вкладки «На неделе», «Просрочено»…»: шаг выполнен с меткой «Отмечено вручную», процент и уровень выросли; «Снять отметку» вернула шаг в невыполненные, уровень не понизился; у владельца в «Уровнях сотрудников» видно, сколько шагов отмечено вручную', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    const ownerLogin = await newOrgOwner(page.request, origin);
    const roles = (await (await page.request.get('/api/roles?size=all')).json()) as {
      items: { id: string; name: string }[];
    };
    const login = uniqueLogin('e2e-hand');
    const hired = await page.request.post('/api/staff', {
      headers: { origin },
      data: {
        fullName: 'Отметкина Ручная Тестовна',
        login,
        phone: null,
        roleId: roles.items.find((r) => r.name === 'Бухгалтер')!.id,
      },
    });
    expect(hired.status(), await hired.text()).toBe(201);
    const { employee, temporaryPassword } = (await hired.json()) as {
      employee: { id: string };
      temporaryPassword: string;
    };
    await page.request.post('/api/auth/logout', { headers: { origin } });
    await signIn(page.request, origin, login, temporaryPassword);
    const changed = await page.request.post('/api/auth/password', {
      headers: { origin },
      data: { currentPassword: temporaryPassword, newPassword: ownerPassword() },
    });
    expect(changed.status(), await changed.text()).toBe(200);

    // До уровня «Ученик» (25 %) не хватает одного шага: один шаг уже выполнен (3 секунды на экране),
    // остальные отмечены вручную заранее.
    const before = await kbMe(page.request);
    expect(before.progress).toMatchObject({ done: 0, level: 0 });
    const all = before.lessons.flatMap((l) => l.steps).filter((s) => s.id !== 'rtabs');
    const seen = all.find((s) => s.learn && s.screens.length)!;
    const look = await page.request.post(`/api/kb/steps/${seen.id}/look`, { headers: { origin } });
    expect(look.status(), await look.text()).toBe(200);
    const need = Math.ceil(before.progress.total / 4);
    const others = all.filter((s) => s !== seen).slice(0, need - 2);
    for (const s of others) {
      const res = await page.request.post(`/api/kb/steps/${s.id}/hand`, { headers: { origin } });
      expect(res.status(), await res.text()).toBe(200);
    }
    const ready = await kbMe(page.request);
    expect(ready.progress).toMatchObject({ done: need - 1, level: 0 });

    await page.goto('/app/kb/lessons');
    const step = page.locator('[data-kb-step="rtabs"]');
    await expect(step).toHaveAttribute('data-kb-state', 'open');
    const hand = step.getByRole('button', { name: 'Отметить выполненным' });
    if (isMobile) {
      // На телефоне — только в «⋯», как в прототипе.
      await expect(hand).toBeHidden();
      await step.getByRole('button', { name: 'Ещё', exact: true }).click();
      await page
        .getByRole('menu', { name: 'Ещё', exact: true })
        .getByRole('menuitem', { name: /^Отметить выполненным/ })
        .click();
    } else {
      await expect(hand).toHaveAttribute('title', 'Шаг засчитается сразу, без перехода и показа');
      await hand.click();
    }
    await expect(
      page.getByRole('status').filter({ hasText: 'Шаг отмечен выполненным' }),
    ).toBeVisible();
    await expect(page.locator('[data-kb-congrats]')).toContainText('Новый уровень: Ученик');
    await expect(step).toHaveAttribute('data-kb-state', 'done');
    await expect(step.locator('[data-kb-hand]')).toContainText('Отмечено вручную');
    // Окна «Готово: шаг выполнен» у ручной отметки нет.
    await expect(page.getByRole('dialog', { name: /^Шаг выполнен|^Готово: шаг/ })).toHaveCount(0);
    const marked = await kbMe(page.request);
    expect(marked.progress).toMatchObject({ done: need, level: 1 });
    expect(marked.progress.pct).toBeGreaterThan(ready.progress.pct);

    // «Снять отметку»: шаг снова не выполнен, уровень остаётся «Ученик».
    await step.getByRole('button', { name: 'Ещё', exact: true }).click();
    await page
      .getByRole('menu', { name: 'Ещё', exact: true })
      .getByRole('menuitem', { name: /^Снять отметку/ })
      .click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Отметка снята: шаг снова не выполнен' }),
    ).toBeVisible();
    await expect(step).toHaveAttribute('data-kb-state', 'open');
    await expect(step.locator('[data-kb-hand]')).toHaveCount(0);
    const off = await kbMe(page.request);
    expect(off.progress).toMatchObject({ done: need - 1, level: 1 });
    expect(off.progress.pct).toBeLessThan(25);

    // Владелец: «Уровни сотрудников» → «Из них отмечено вручную».
    await page.request.post('/api/auth/logout', { headers: { origin } });
    await signIn(page.request, origin, ownerLogin, 'Свой-пароль-e2e-1');
    await page.goto('/app/kb/team');
    const grid = page.locator('[data-grid]');
    await expect(grid.locator('[data-id]').first()).toBeVisible();
    if (isMobile) await page.getByRole('button', { name: 'Вид списка: Таблица' }).click();
    const head = grid.locator('thead').first();
    await expect(head.locator('th[data-column="hand"]')).toContainText('Из них отмечено вручную');
    const keys = await head
      .locator('th')
      .evaluateAll((ths) => ths.map((th) => th.getAttribute('data-column')));
    const row = grid.locator(`[data-id="${employee.id}"]`);
    await expect(row.locator('td').nth(keys.indexOf('hand'))).toHaveText(String(need - 2));
    await expect(row.locator('td').nth(keys.indexOf('steps'))).toHaveText(
      `${need - 1} из ${before.progress.total}`,
    );
  });
});
