import { randomBytes } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { platformAdmin, search } from './admin';
import { DEMO_PASSWORD, signIn } from './helpers';

// Админка → «Файлы», вкладка «Файлы» карточки организации и «Ждут удаления» (доработки 20.11.2026,
// пакет 2, блоки 3–5; прототип v154 admin/admin-files.js, modules/file-trash.js; этап 1, П4–П6,
// поток И). Файлы демо-организации общие для всех тестов: тест ищет только свой файл по своей метке.

/** Своя метка на каждый тест и проект. */
const uniqueTag = () => `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;

type Texts = Record<string, string>;

/** Тексты словаря интерфейса (`GET /api/l10n`): тест не копирует строки экрана. */
async function dictionary(api: APIRequestContext): Promise<Texts> {
  const res = await api.get('/api/l10n');
  expect(res.status()).toBe(200);
  return ((await res.json()) as { texts: Texts }).texts;
}

/** Файл «Загружен вручную» в демо-организации через API, как браузер: начать → PUT → закончить. */
async function apiUpload(api: APIRequestContext, origin: string, name: string, text: string) {
  const body = Buffer.from(text, 'utf8');
  const start = await api.post('/api/files/uploads', {
    headers: { origin },
    data: { source: { kind: 'manual', id: null }, name, size: body.length },
  });
  expect(start.status(), await start.text()).toBe(201);
  const ticket = (await start.json()) as {
    id: string;
    upload: { url: string; headers: Record<string, string> };
  };
  const put = await api.put(ticket.upload.url, { headers: ticket.upload.headers, data: body });
  expect(put.status(), await put.text()).toBe(200);
  const done = await api.post(`/api/files/${ticket.id}/complete`, { headers: { origin } });
  expect(done.status(), await done.text()).toBe(200);
  return (await done.json()) as { id: string; version: number };
}

/** Демо-организация бухгалтера erkin: номер и название (строка «По организациям», сведения файла). */
async function demoOrg(api: APIRequestContext) {
  const me = (await (await api.get('/api/auth/me')).json()) as {
    organization: { id: string; name: string };
  };
  return me.organization;
}

/** Файлов с меткой в «Файловом менеджере» сотрудника (поиск по названию). */
async function managerCount(api: APIRequestContext, tag: string) {
  const res = await api.get(`/api/files/manager?q=${encodeURIComponent(tag)}&size=25`, {
    maxRetries: 2,
  });
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { total: number }).total;
}

/**
 * «Все файлы» с поиском по своей метке: дождаться ответа списка с этим поиском и ровно своей строки —
 * иначе нажатие придёт в строку, которую сдвинет перерисовка (docs/typical-mistakes.md № 27).
 */
async function allFilesWithTag(page: Page, isMobile: boolean, tag: string) {
  await expect(page.locator('[data-afiles-all] [data-grid]')).toBeVisible();
  const searched = page.waitForResponse((r) => {
    const url = new URL(r.url());
    return url.pathname === '/api/admin/files' && url.searchParams.get('q') === tag;
  });
  await search(page, isMobile, tag);
  expect((await searched).status()).toBe(200);
  await expect(page.locator('[data-afiles-all] [data-grid] [data-id]')).toHaveCount(1);
}

test.describe('Доработки 20.11, пакет 2. Админка → «Файлы»', () => {
  test('(блоки 3 и 4) «Хранилище»: строка организации открывает её «Все файлы», окно файла со сведениями, «Открыть организацию» — вкладка «Файлы» карточки', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    const tag = uniqueTag();
    const name = `хранилище-${tag}.txt`;
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    const org = await demoOrg(page.request);
    const file = await apiUpload(page.request, origin, name, `Справка ${tag}\n`);
    await page.request.post('/api/auth/logout', { headers: { origin } });
    await platformAdmin(page.request, origin);

    await page.goto('/app/afiles/store');
    const store = page.locator('[data-afiles-store]');
    await expect(store.locator('[data-plate="tot"] [data-plate-value]')).not.toBeEmpty();
    await expect(store.locator('[data-plate="trash"]')).toBeVisible();
    // «По организациям»: строка демо-организации открывает «Все файлы» с фильтром по ней.
    await store.locator(`[data-afiles-orgs] [data-mini-row="${org.id}"]`).click();
    await expect(page).toHaveURL(/\/app\/afiles\/all/);
    await allFilesWithTag(page, isMobile, tag);
    const row = page.locator(`[data-afiles-all] [data-grid] [data-id="file:${file.id}"]`);
    await expect(row).toContainText(org.name);

    // Окно файла — то же окно просмотра, что у организаций, со сведениями справа.
    await row.getByText(name, { exact: true }).click();
    const win = page.getByRole('dialog', { name });
    await expect(win.locator(`[data-file-viewer="file:${file.id}"]`)).toBeVisible();
    await expect(win.locator('[data-fv="text"]')).toContainText(`Справка ${tag}`);
    const info = win.locator(`[data-afiles-info="file:${file.id}"]`);
    await expect(info).toContainText(org.name);

    // «Открыть организацию» → карточка этой организации сразу на вкладке «Файлы».
    await info.locator('[data-afiles-info-org]').click();
    const card = page.locator(`[data-org-card="${org.id}"]`);
    await expect(card.locator('[data-org-files-mem]')).toBeVisible();
    await expect(card.locator('[data-org-files-cats]')).toBeVisible();
    await expect(card.locator('[data-org-files] [data-grid]')).toBeVisible();
  });

  test('(блок 5, пункты 3–4) удалённый сотрудником файл сразу пропадает у фирмы и ждёт стирания в «Ждут удаления»; «Вернуть» — файл снова у фирмы', async ({
    page,
    browser,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const tag = uniqueTag();
    const name = `удалить-${tag}.txt`;
    const staff = await browser.newContext({ baseURL });
    try {
      await signIn(staff.request, origin, 'erkin', DEMO_PASSWORD);
      const file = await apiUpload(staff.request, origin, name, `Удаляемый ${tag}\n`);
      expect(await managerCount(staff.request, tag)).toBe(1);
      const del = await staff.request.delete(`/api/files/${file.id}?version=${file.version}`, {
        headers: { origin },
      });
      expect(del.status(), await del.text()).toBe(200);
      expect(await managerCount(staff.request, tag)).toBe(0);

      await platformAdmin(page.request, origin);
      const texts = await dictionary(page.request);
      await page.goto('/app/afiles/store');
      await page.locator('[data-afiles-store] [data-plate="trash"]').click();
      const trash = page.getByRole('dialog', { name: texts['afiles.trash.title'] });
      const line = trash.locator('[data-afiles-trash] [data-mini-row]').filter({ hasText: name });
      await expect(line).toHaveCount(1);
      await expect(line).toContainText(texts['afiles.trash.why.del']!);

      await line.locator('[data-afiles-trash-back]').click();
      const ask = page.getByRole('dialog', {
        name: texts['afiles.back.title']!.replace('{name}', name),
      });
      const restored = page.waitForResponse(
        (r) =>
          r.request().method() === 'POST' &&
          /\/api\/admin\/files\/trash\/[^/]+\/restore$/.test(new URL(r.url()).pathname),
      );
      await ask.getByRole('button', { name: texts['afiles.back.ok'], exact: true }).click();
      expect((await restored).status()).toBe(200);
      await expect(page.getByText(texts['afiles.back.done']!)).toBeVisible();
      await expect(line).toHaveCount(0);

      // Файл снова у фирмы: в «Файловом менеджере» сотрудника — там же, где был.
      expect(await managerCount(staff.request, tag)).toBe(1);
    } finally {
      await staff.close();
    }
  });

  test('(блок 3, пункт 7) модуль только администратору платформы: сотрудник получает отказ на методы «Файлов» Админки', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    const org = await demoOrg(page.request);
    for (const path of [
      '/api/admin/files/summary',
      '/api/admin/files?size=25',
      '/api/admin/files/trash',
      '/api/admin/files/check',
      `/api/admin/organizations/${org.id}/files?size=25`,
    ]) {
      const res = await page.request.get(path);
      expect(res.status(), path).toBe(403);
    }
  });
});
