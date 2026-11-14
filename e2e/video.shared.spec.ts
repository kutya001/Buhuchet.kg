import { expect, test, type APIRequestContext } from '@playwright/test';
import { platformAdmin, search } from './admin';
import { newOrgOwner, uniqueLogin } from './helpers';

// Видео платформы (решение заказчика 08.11.2026, прототип v79): видеоинструкция модуля — во вкладке
// «Видео» Базы знаний, первой в окне «?» и кнопкой ▶ в верхней панели; окно видео по ссылке; «Просмотры
// видео» у владельца; презентация «На лендинге» — блок «Видео о Buhuchet.kg» и ссылка в первом экране.
// Видео общие для всех организаций, поэтому файл — *.shared.spec.ts: созданные видео в конце теста
// снимаются с публикации и удаляются. Видео — по ссылке YouTube: сам ролик в тесте не играет.

test.describe.configure({ mode: 'serial' });

interface SavedVideo {
  video: { id: string; version: number; title: string };
}

const fields = (title: string, patch: Record<string, unknown> = {}) => ({
  title,
  kind: 'instr',
  source: 'yt',
  yt: 'https://youtu.be/dQw4w9WgXcQ',
  ytDuration: 100,
  cover: 'none',
  description: 'Пошагово: как добавить контрагента',
  module: 'cps',
  article: null,
  ord: 1,
  audience: 'all',
  ...patch,
});

async function createVideo(
  admin: APIRequestContext,
  origin: string,
  title: string,
  patch: Record<string, unknown> = {},
) {
  const res = await admin.post('/api/admin/videos', {
    headers: { origin },
    data: { ...fields(title, patch), publish: true },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as SavedVideo).video;
}

/** Снять с публикации и удалить: видео общие, после теста их не остаётся. */
async function removeVideo(admin: APIRequestContext, origin: string, id: string) {
  const card = await admin.get(`/api/admin/videos/${id}`);
  if (card.status() === 404) return;
  let { version } = ((await card.json()) as { video: { version: number } }).video;
  const off = await admin.post(`/api/admin/videos/${id}/off`, {
    headers: { origin },
    data: { version, off: true },
  });
  if (off.ok()) version = ((await off.json()) as SavedVideo).video.version;
  const del = await admin.delete(`/api/admin/videos/${id}?version=${version}`, {
    headers: { origin },
  });
  expect([204, 404], await del.text()).toContain(del.status());
}

test.describe('Видео платформы (прототип v79)', () => {
  test('(проверка прототипа v79) видеоинструкция модуля: во вкладке «Видео», первой в окне «?», кнопкой ▶ вверху и по ссылке; «Просмотры видео» у владельца; снятое с публикации пропадает', async ({
    page,
    baseURL,
    isMobile,
    playwright,
  }) => {
    const origin = new URL(baseURL!).origin;
    const admin = await playwright.request.newContext({ baseURL });
    await platformAdmin(admin, origin);
    const title = `Как добавить контрагента ${uniqueLogin('e2e')}`;
    const video = await createVideo(admin, origin, title);
    try {
      await newOrgOwner(page.request, origin);

      // Кнопка ▶ слева от «?» (на ПК) и первая карточка в окне «?» модуля.
      await page.goto('/app/cps/all');
      const top = page.getByRole('button', { name: `Видеоинструкция: ${title}` });
      if (isMobile) await expect(top).toBeHidden();
      else {
        await top.click();
        const win = page.getByRole('dialog', { name: title });
        await expect(win).toContainText('Видеоинструкция');
        await page.keyboard.press('Escape');
        await expect(win).toBeHidden();
      }
      await page.getByRole('button', { name: 'Помощь' }).click();
      const help = page.getByRole('dialog').locator('[data-video-help]');
      await expect(help).toContainText(title);
      await help.locator(`[data-video-open="${video.id}"]`).click();
      const win = page.getByRole('dialog', { name: title });
      await expect(win).toContainText('Пошагово: как добавить контрагента');
      await page.keyboard.press('Escape');
      await expect(win).toBeHidden();

      // Вкладка «Видео» Базы знаний: карточка с «Новое» сменилась отметкой просмотра.
      await page.goto('/app/kb/video');
      const card = page.locator('[data-grid] [data-id]').filter({ hasText: title });
      await expect(card).toHaveCount(1);
      await card.click();
      await expect(page.getByRole('dialog', { name: title })).toBeVisible();
      await page.keyboard.press('Escape');

      // Ссылка на видео (`?video=<код>`) открывает окно сразу.
      await page.goto(`/app/kb/video?video=${video.id}`);
      await expect(page.getByRole('dialog', { name: title })).toBeVisible();
      await expect(page).toHaveURL(/\/app\/kb\/video$/);
      await page.keyboard.press('Escape');

      // «Просмотры видео»: владелец видит свои открытия.
      await page.goto('/app/kb/vviews');
      await search(page, isMobile, title);
      const row = page.locator('[data-grid] [data-id]').filter({ hasText: title });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText('Новикова Сквозная');

      // Снятое с публикации видео пропадает из «Видео» и из окна «?».
      const card2 = await admin.get(`/api/admin/videos/${video.id}`);
      const { version } = ((await card2.json()) as SavedVideo).video;
      const off = await admin.post(`/api/admin/videos/${video.id}/off`, {
        headers: { origin },
        data: { version, off: true },
      });
      expect(off.status(), await off.text()).toBe(200);
      // Видео других тестов может и не быть: тогда во вкладке «Видео пока нет».
      await page.goto('/app/kb/video');
      await expect(
        page.locator('[data-kb-video]').or(page.getByText('Видео пока нет')).first(),
      ).toBeVisible();
      await expect(page.getByText(title)).toHaveCount(0);
      await Promise.all([page.waitForResponse('**/api/kb/videos/all'), page.goto('/app/cps/all')]);
      await expect(top).toHaveCount(0);
    } finally {
      await removeVideo(admin, origin, video.id);
      await admin.dispose();
    }
  });

  test('(проверка прототипа v79) вкладка «Видео» Админки: видео в списке со статусом, «Снять с публикации» спрашивает и снимает', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const title = `Вкладки отчётов ${uniqueLogin('e2e')}`;
    const video = await createVideo(page.request, origin, title, { module: 'reports' });
    try {
      await page.goto('/app/kbadm/video');
      await search(page, isMobile, title);
      const row = page.locator('[data-grid] [data-id]').filter({ hasText: title });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText('Опубликовано');
      await row.locator('[data-row-menu]').click();
      await page
        .getByRole('menu', { name: 'Действия' })
        .getByRole('menuitem', { name: 'Снять с публикации' })
        .click();
      const ask = page.getByRole('dialog', { name: `Снять «${title}» с публикации?` });
      await ask.getByRole('button', { name: 'Снять с публикации' }).click();
      await expect(
        page.getByRole('status').filter({ hasText: 'Видео снято с публикации' }),
      ).toBeVisible();
      await expect(row).toContainText('снято');
    } finally {
      await removeVideo(page.request, origin, video.id);
    }
  });

  test('(проверка прототипа v79) лендинг: видео «На лендинге» — блок «Видео о Buhuchet.kg» и «Смотреть видео» в первом экране; гость открывает окно видео', async ({
    page,
    baseURL,
    playwright,
  }) => {
    // Справочники лендинга сервер хранит в памяти до минуты: новое видео появляется не сразу, а сразу
    // после того же теста на ПК (на той же машине CI) в памяти ещё может быть его видео, уже удалённое.
    test.setTimeout(150_000);
    const origin = new URL(baseURL!).origin;
    const admin = await playwright.request.newContext({ baseURL });
    await platformAdmin(admin, origin);
    const title = `Buhuchet.kg за 2 минуты ${uniqueLogin('e2e')}`;
    const created = await createVideo(admin, origin, title, { kind: 'pres', module: null });
    try {
      const shown = await admin.put(`/api/admin/videos/${created.id}`, {
        headers: { origin },
        data: {
          ...fields(title, { kind: 'pres', module: null, cover: 'keep' }),
          version: created.version,
          landing: true,
          landingOrd: 1,
        },
      });
      expect(shown.status(), await shown.text()).toBe(200);

      const block = page.locator('#lp-video');
      // Ждём своё видео в первом экране, а не любой блок: блок может быть из памяти с видео прошлого теста.
      const lead = page.locator(`#lp-hero [data-lp-vid="${created.id}"]`);
      await expect(async () => {
        await page.goto('/');
        await expect(lead).toBeVisible({ timeout: 2_000 });
      }).toPass({ timeout: 100_000, intervals: [5_000] });
      await expect(block).toBeVisible();
      await expect(block.getByRole('heading', { name: 'Видео о Buhuchet.kg' })).toBeVisible();
      // Обложка — своя, без адресов YouTube.
      await expect(page.locator('img[src*="ytimg"]')).toHaveCount(0);

      await page
        .locator('#lp-hero')
        .getByRole('button', { name: /^Смотреть видео · 1:40$/ })
        .click();
      const win = page.getByRole('dialog', { name: title });
      await expect(win).toContainText('Презентация');
      await page.keyboard.press('Escape');
      await expect(win).toBeHidden();
      await block.locator(`[data-lp-vid="${created.id}"]`).first().click();
      await expect(page.getByRole('dialog', { name: title })).toBeVisible();
    } finally {
      await removeVideo(admin, origin, created.id);
      await admin.dispose();
    }
  });
});
