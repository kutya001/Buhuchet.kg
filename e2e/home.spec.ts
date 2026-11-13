import { expect, test, type Page } from '@playwright/test';
import { newOrgOwner, showStats } from './helpers';
import { orgWithTypes } from './orgs';
import { assign } from './reports';

// «Главная»: «Сводка» и «Аналитика» (задача 2.34, #90) через настоящий сайт. Своя организация на
// каждый тест и проект (ПК и телефон): числа демо-организации меняют другие тесты.

/**
 * «Статистика» по умолчанию скрыта и на ПК, и на телефоне (прототип v88) — показать.
 * Выбор запоминается: показанные плашки второй раз не скрываются.
 */
async function showPlates(page: Page) {
  const home = page.locator('[data-home-summary]');
  await expect(home.locator('[data-home-hello]')).toBeVisible();
  await showStats(page);
  await expect(home.locator('[data-plates]')).toBeVisible();
}

/** Первое число месяца `shift` месяцев назад по Бишкеку. */
function monthStart(shift: number): string {
  const now = new Date(Date.now() + 6 * 3600_000);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - shift, 1))
    .toISOString()
    .slice(0, 10);
}

test.describe('«Главная»', () => {
  test('(п. 24) новая организация: на «Главной» — нули и подсказка «Добавьте контрагентов…», без чек-листов и обучающих плашек; модули пустые с подсказкой и кнопкой первого действия', async ({
    page,
    baseURL,
  }) => {
    await newOrgOwner(page.request, new URL(baseURL!).origin);
    await page.goto('/app/home/today');
    const home = page.locator('[data-home-summary]');
    await expect(home.locator('[data-home-hello]')).toContainText('Вы видите всю организацию');
    const hint = home.locator('[data-home-empty]');
    await expect(hint).toContainText('Добавьте контрагентов, чтобы здесь появились сроки и суммы.');

    // Статистика — по нулям.
    await showPlates(page);
    const values = home.locator('[data-plate] [data-plate-value]');
    await expect(values.first()).toBeVisible();
    expect(await values.count()).toBeGreaterThanOrEqual(4);
    for (const value of await values.all()) await expect(value).toHaveText('0');
    await expect(home.locator('[data-plate="ovr"]')).toContainText('всё сдано в срок');

    // Под плашками — только пустые блоки: ни чек-листов, ни обучающих плашек.
    await expect(home.locator('[data-box]')).toHaveCount(2);
    await expect(home.locator('[data-home-upcoming]')).toHaveText('Несданных отчётов нет.');
    await expect(home.locator('[data-home-progress]')).toHaveText(
      'Нет отчётов со сроком в этом месяце.',
    );
    await expect(home).not.toContainText(/чек-лист|урок|обучени/i);
    await expect(home.locator('button:not([data-plate])')).toHaveCount(2);

    // Первое действие: «Перейти к контрагентам» — пустой список с подсказкой и «Добавить контрагента».
    await hint.getByRole('button', { name: 'Перейти к контрагентам' }).click();
    await expect(page).toHaveURL(/\/app\/cps\/all$/);
    const cps = page.locator('[data-empty-state]');
    await expect(cps).toContainText('Здесь будут ваши клиенты');
    await expect(cps.getByRole('button', { name: 'Добавить контрагента' })).toBeVisible();

    // «Задачи» — тоже пустые, с подсказкой и кнопкой «Добавить».
    await page.goto('/app/tasks/mine');
    const tasks = page.locator('[data-empty-state]');
    await expect(tasks).toContainText(
      'Регулярные задачи создадутся сами по отчётам; ручную задачу можно поставить сейчас',
    );
    await expect(tasks.getByRole('button', { name: 'Добавить', exact: true })).toBeVisible();
  });

  test('(проверка задачи #90) число на плашке равно числу строк в открытом списке', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    await orgWithTypes(page.request, origin);
    const staff = (await (await page.request.get('/api/staff?size=all')).json()) as {
      items: { id: string }[];
    };
    const inn = `2${String(Date.now()).slice(-9)}${String(Math.floor(Math.random() * 1e4)).padStart(4, '0')}`;
    const created = await page.request.post('/api/contractors', {
      headers: { origin },
      data: {
        name: 'ИП Сводка Главной',
        inn,
        phone: '+996505890076',
        kind: 'regular',
        formCode: 'ФС-01',
        regimeCode: 'РЕЖ-01',
        gked: '46.34.0',
        startDate: monthStart(5),
        responsibleEmployeeId: staff.items[0]!.id,
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const cp = (await created.json()) as { id: string };
    // Соцфонд с четырёх месяцев назад: прошлые сроки прошли — отчёты просрочены, их задачи — «Мои
    // задачи на сегодня».
    await assign(page.request, origin, {
      contractorId: cp.id,
      reportTypeCode: 'soc',
      fromMonth: monthStart(4),
    });

    await page.goto('/app/home/today');
    await showPlates(page);
    const home = page.locator('[data-home-summary]');
    await expect(home.locator('[data-plate="ovr"] [data-plate-value]')).not.toHaveText('0');
    const plates = ['ovr', 'wks', 'tsk'] as const;
    for (const id of plates) {
      if (id !== 'ovr') {
        await page.goto('/app/home/today');
        await showPlates(page);
      }
      const plate = home.locator(`[data-plate="${id}"]`);
      const n = Number((await plate.locator('[data-plate-value]').innerText()).trim());
      await plate.click();
      await expect(page).toHaveURL(id === 'tsk' ? /\/app\/tasks\/mine$/ : /\/app\/reports\//);
      if (n === 0) {
        await expect(page.locator('[data-empty-state]')).toBeVisible();
        continue;
      }
      await expect(page.locator('[data-grid-count]')).toHaveText(new RegExp(`^${n}\\s`));
      // Фильтр плашки стоит в списке — его видно и можно снять.
      await expect(page.locator('[data-grid-reset]')).toBeVisible();
    }
  });
});
