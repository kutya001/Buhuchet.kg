import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { DEMO_PASSWORD, signIn, uniqueLogin } from './helpers';

// Файлы записей (задача 2.04): хранение в S3 и блок «Файлы» карточки. Модулей с записями ещё нет,
// поэтому блок проверяется на странице образцов /samples на общих файлах организации — файлы там
// сохраняются по-настоящему: браузер кладёт файл в хранилище по подписанной ссылке, API его проверяет.

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MB = 1048576;

/** Своё имя файла на каждый тест и проект: список общий для ПК и телефона. */
const uniqueName = (prefix: string, ext = 'pdf') =>
  `${prefix}-${Date.now().toString(36)}${randomBytes(3).toString('hex')}.${ext}`;

type FileItem = { id: string; name: string; version: number; canDelete: boolean };

/** Загрузить файл через API, как это делает браузер: начать → PUT в хранилище → закончить. */
async function apiUpload(api: APIRequestContext, origin: string, name: string, size = 2048) {
  const start = await api.post('/api/files/uploads', {
    headers: { origin },
    data: { source: { kind: 'manual', id: null }, name, size },
  });
  expect(start.status(), await start.text()).toBe(201);
  const ticket = (await start.json()) as {
    id: string;
    upload: { url: string; headers: Record<string, string> };
  };
  const put = await api.put(ticket.upload.url, {
    headers: ticket.upload.headers,
    data: Buffer.alloc(size, 7),
  });
  expect(put.status(), await put.text()).toBe(200);
  const done = await api.post(`/api/files/${ticket.id}/complete`, { headers: { origin } });
  expect(done.status(), await done.text()).toBe(200);
  return (await done.json()) as FileItem;
}

async function openFiles(page: Page, baseURL: string | undefined, login: string): Promise<Locator> {
  await signIn(page.request, new URL(baseURL!).origin, login, DEMO_PASSWORD);
  await page.goto('/samples');
  const box = page.locator('[data-sample-files]');
  await expect(box.getByRole('heading', { name: /^Файлы · \d+/ })).toBeVisible();
  return box;
}

const row = (box: Locator, name: string) => box.getByRole('listitem').filter({ hasText: name });

test.describe('Этап 2: файлы записи', () => {
  test('файл больше 20 МБ не загружается с сообщением «Файл больше 20 МБ»; обычный — прикрепляется и скачивается', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const box = await openFiles(page, baseURL, 'alisher');
    const big = uniqueName('большой');
    const chooser = page.waitForEvent('filechooser');
    await box.getByRole('button', { name: 'Прикрепить' }).click();
    await (
      await chooser
    ).setFiles({ name: big, mimeType: 'application/pdf', buffer: Buffer.alloc(20 * MB + 1, 1) });
    await expect(page.getByText(`Файл больше 20 МБ: ${big}`)).toBeVisible();
    await expect(row(box, big)).toHaveCount(0);

    // Сервер не начинает загрузку больше 20 МБ, даже если браузер её не остановил.
    const origin = new URL(baseURL!).origin;
    const refused = await page.request.post('/api/files/uploads', {
      headers: { origin },
      data: { source: { kind: 'manual', id: null }, name: big, size: 20 * MB + 1 },
    });
    expect(refused.status()).toBe(400);
    expect(((await refused.json()) as { error: { message: string } }).error.message).toBe(
      'Файл больше 20 МБ',
    );

    // Файл до 20 МБ — прикрепляется: строка с типом и размером, «Скачать» и «Удалить» (свой файл).
    const small = uniqueName('акт');
    const chooser2 = page.waitForEvent('filechooser');
    await box.getByRole('button', { name: 'Прикрепить' }).click();
    await (
      await chooser2
    ).setFiles({ name: small, mimeType: 'application/pdf', buffer: Buffer.alloc(3 * 1024, 2) });
    await expect(page.getByText('Файлы прикреплены')).toBeVisible();
    const line = row(box, small);
    await expect(line).toContainText('PDF · 3 КБ');
    await expect(line.getByRole('button', { name: `Удалить ${small}` })).toBeVisible();

    const download = page.waitForEvent('download');
    await line.getByRole('button', { name: `Скачать ${small}` }).click();
    expect((await download).suggestedFilename()).toBe(small);

    if (isMobile) {
      // На телефоне блок во всю ширину и не прокручивается вбок; кнопки — не меньше 44 px для пальца.
      const width = await page.evaluate(() => document.documentElement.clientWidth);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      const boxRect = (await box.boundingBox())!;
      expect(boxRect.x + boxRect.width).toBeLessThanOrEqual(width);
      const target = await line.getByRole('button', { name: `Скачать ${small}` }).evaluate((el) => {
        const r = getComputedStyle(el, '::before');
        return [parseFloat(r.width), parseFloat(r.height)];
      });
      expect(Math.min(...target)).toBeGreaterThanOrEqual(44);
    }
  });

  test('чужой файл без права «Удалять файлы» не удаляется; с правом — удаляется с подтверждением', async ({
    page,
    browser,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const chiefContext = await browser.newContext();
    const chief = chiefContext.request;
    await signIn(chief, origin, 'meerim', DEMO_PASSWORD);
    const name = uniqueName('приказ');
    const file = await apiUpload(chief, origin, name);

    // Бухгалтер без права «Удалять файлы»: кнопки «Удалить» у чужого файла нет, API отказывает.
    const box = await openFiles(page, baseURL, 'alisher');
    const line = row(box, name);
    await expect(line).toBeVisible();
    await expect(line.getByRole('button', { name: `Скачать ${name}` })).toBeVisible();
    await expect(line.getByRole('button', { name: `Удалить ${name}` })).toHaveCount(0);
    const refused = await page.request.delete(`/api/files/${file.id}?version=${file.version}`, {
      headers: { origin },
    });
    expect(refused.status()).toBe(403);
    expect(((await refused.json()) as { error: { message: string } }).error.message).toBe(
      'Нужно право «Удалять файлы»: свой файл можно удалить без права в течение суток',
    );

    // Главный бухгалтер с правом удаляет его из блока: подтверждение, «Файл удалён».
    const chiefPage = await chiefContext.newPage();
    const chiefBox = await openFiles(chiefPage, baseURL, 'meerim');
    await row(chiefBox, name)
      .getByRole('button', { name: `Удалить ${name}` })
      .click();
    const dialog = chiefPage.getByRole('dialog', { name: `Удалить файл «${name}»?` });
    await expect(dialog).toContainText(
      'Файл пропадёт из записи и из файлового менеджера. Удаление записывается в историю.',
    );
    await dialog.getByRole('button', { name: 'Удалить' }).click();
    await expect(chiefPage.getByText('Файл удалён')).toBeVisible();
    await expect(row(chiefBox, name)).toHaveCount(0);
    expect((await chief.get(`/api/files/${file.id}/link`)).status()).toBe(404);
    await chiefContext.close();
  });

  test('файл другой организации не открывается', async ({ page, browser, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    const name = uniqueName('договор', 'docx');
    const file = await apiUpload(page.request, origin, name);
    expect((await page.request.get(`/api/files/${file.id}/link`)).status()).toBe(200);

    // Владелец другой организации (создаёт `pnpm db:create-org`, временный пароль сразу меняется).
    const login = uniqueLogin('e2e-files');
    const inn = `8${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 10_000)
      .toString()
      .padStart(4, '0')}`;
    const out = execFileSync(
      'pnpm',
      [
        '--silent',
        'db:create-org',
        '--name',
        `Чужая ${login}`,
        '--inn',
        inn,
        '--owner-fio',
        'Чужой Владелец Тестович',
        '--owner-login',
        login,
      ],
      { cwd: ROOT, encoding: 'utf8' },
    );
    const temporary = /Временный пароль[^:]*:\s*(\S+)/.exec(out)?.[1];
    expect(temporary, out).toBeTruthy();
    const other = await browser.newContext();
    await signIn(other.request, origin, login, temporary!);
    const changed = await other.request.post('/api/auth/password', {
      headers: { origin },
      data: {
        currentPassword: temporary,
        newPassword: `Bh-${randomBytes(9).toString('base64url')}`,
      },
    });
    expect(changed.status(), await changed.text()).toBe(200);

    for (const path of [`/api/files/${file.id}/link`, `/api/files/${file.id}/download`]) {
      const res = await other.request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(404);
    }
    const list = (await (await other.request.get('/api/files?kind=manual')).json()) as {
      items: FileItem[];
    };
    expect(list.items.map((i) => i.id)).not.toContain(file.id);

    // На странице чужой организации файла нет.
    const otherPage = await other.newPage();
    await otherPage.goto('/samples');
    const box = otherPage.locator('[data-sample-files]');
    await expect(box.getByRole('heading', { name: /^Файлы · \d+/ })).toBeVisible();
    await expect(row(box, name)).toHaveCount(0);
    await other.close();
  });
});
