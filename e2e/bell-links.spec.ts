import { expect, test } from '@playwright/test';
import { DEMO_PASSWORD, newOrgOwner, signIn, uniqueLogin } from './helpers';

// Куда ведут строки колокольчика (доработки 16.11.2026, блок 3; прототип v123 `bellGo`;
// docs/deviations.md п. И-11): новость — «Новости» с `?news=`, сотрудник — «Сотрудники» с `?employee=`
// (заявка `?lead=` — в admin-leads.spec.ts). Запись открывается, адрес — без параметра.

test.describe('Доработки 16.11. Колокольчик: переход по строке', () => {
  test('«Новость»: `?news=` раскрывает свою новость в ленте и отмечает её прочитанной', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    // Новый владелец: отметки «прочитано» — только его, общие записи демо-организации не меняются.
    await newOrgOwner(page.request, origin);
    type Feed = { items: { id: string; read: boolean }[] };
    const feed = ((await (await page.request.get('/api/news')).json()) as Feed).items;
    // Не самая новая: та раскрыта и без ссылки.
    const target = feed.slice(1).find((n) => !n.read) ?? feed[1];
    expect(target, 'в ленте нужна хотя бы вторая новость').toBeTruthy();

    await page.goto(`/app/kb/news?news=${encodeURIComponent(target!.id)}`);
    const row = page.locator(`[data-news="${target!.id}"]`);
    await expect(row).toHaveAttribute('data-open', '');
    await expect(row.locator('[aria-expanded="true"]')).toBeVisible();
    await expect(page).toHaveURL(/\/app\/kb\/news$/);
    await expect
      .poll(async () => {
        const now = (await (await page.request.get('/api/news')).json()) as Feed;
        return now.items.find((n) => n.id === target!.id)?.read;
      })
      .toBe(true);
  });

  test('«Вход сотрудника заблокирован»: `?employee=` открывает карточку сотрудника; номер, которого нет, и не номер — ничего', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    const roles = (await (await page.request.get('/api/roles?size=all')).json()) as {
      items: { id: string; name: string }[];
    };
    const word = Array.from(
      { length: 6 },
      () => 'абвгдежзиклмнопрстуф'[Math.floor(Math.random() * 20)],
    ).join('');
    const fullName = `Колокольчиков Бел${word} Тестович`;
    const hired = await page.request.post('/api/staff', {
      headers: { origin },
      data: {
        fullName,
        login: uniqueLogin('e2e-bell'),
        roleId: roles.items.find((r) => r.name === 'Бухгалтер')!.id,
      },
    });
    expect(hired.status(), await hired.text()).toBe(201);
    const { employee } = (await hired.json()) as { employee: { id: string } };

    await page.goto(`/app/staff/list?employee=${employee.id}`);
    await expect(page.getByRole('dialog', { name: fullName })).toBeVisible();
    await expect(page).toHaveURL(/\/app\/staff\/list$/);

    // Номер, которого нет, карточку не открывает и адрес чистит: окна проверяются после ответа сервера.
    const missing = '00000000-0000-4000-8000-000000000000';
    const answered = page.waitForResponse(
      (r) => new URL(r.url()).pathname === `/api/staff/${missing}`,
    );
    await page.goto(`/app/staff/list?employee=${missing}`);
    expect((await answered).status()).toBe(404);
    await expect(page).toHaveURL(/\/app\/staff\/list$/);
    await expect(page.locator('[data-grid] [data-id]').first()).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Не номер вовсе — запроса нет, адрес чистится, окна нет.
    await page.goto('/app/staff/list?employee=abc');
    await expect(page).toHaveURL(/\/app\/staff\/list$/);
    await expect(page.locator('[data-grid] [data-id]').first()).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
