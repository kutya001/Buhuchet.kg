import { randomBytes } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { search } from './admin';
import { DEMO_PASSWORD, newOrgOwner, signIn } from './helpers';

// «Файловый менеджер» (задача 2.29, #85): все файлы организации с источником, ручная загрузка с
// контрагентом, окно файла, область «Свои контрагенты» и уроки модуля в «Базе знаний».

/** Своя метка на каждый тест и проект: список файлов демо-организации общий. */
const uniqueTag = () => `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;

type Contractor = { id: string; name: string };

/** Загрузить файл через API, как это делает браузер: начать → PUT в хранилище → закончить. */
async function apiUpload(
  api: APIRequestContext,
  origin: string,
  data: Record<string, unknown> & { name: string },
) {
  const size = 2048;
  const start = await api.post('/api/files/uploads', {
    headers: { origin },
    data: { source: { kind: 'manual', id: null }, size, ...data },
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
  return ticket.id;
}

async function uploadContractors(api: APIRequestContext) {
  const res = await api.get('/api/files/manager/contractors');
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { items: Contractor[] }).items;
}

/** Открыть Файловый менеджер и найти файлы общим поиском. */
async function openManager(page: Page, isMobile: boolean, text: string) {
  await page.goto('/app/files');
  await expect(page.locator('[data-grid]')).toBeVisible();
  await search(page, isMobile, text);
}

const fileRow = (page: Page, id: string) => page.locator(`[data-grid] [data-id="${id}"]`);

/** Учётная политика: включить или выключить «Файлы в карточках». */
async function filesFeature(api: APIRequestContext, origin: string, files: boolean) {
  const current = (await (await api.get('/api/org/policy')).json()) as { version: number };
  const res = await api.patch('/api/org/policy', {
    headers: { origin },
    data: { version: current.version, features: { files } },
  });
  expect(res.status(), await res.text()).toBe(200);
}

test.describe('Этап 2: Файловый менеджер', () => {
  test('(проверка задачи #85) бухгалтер со «Свои» не видит файлов чужих контрагентов; общий файл и файл своего — видит', async ({
    page,
    baseURL,
    isMobile,
    playwright,
  }) => {
    const origin = new URL(baseURL!).origin;
    const tag = uniqueTag();
    // Алишер Т. — бухгалтер с областью «Свои контрагенты»; владелец видит всех.
    await signIn(page.request, origin, 'alisher', DEMO_PASSWORD);
    const own = await uploadContractors(page.request);
    const owner = await playwright.request.newContext({ baseURL });
    await signIn(owner, origin, 'erkin', DEMO_PASSWORD);
    const all = await uploadContractors(owner);
    const mine = own[0]!;
    const other = all.find((c) => !own.some((o) => o.id === c.id))!;
    expect(other).toBeTruthy();
    const general = await apiUpload(owner, origin, { name: `общий-${tag}.pdf` });
    const ofMine = await apiUpload(owner, origin, {
      name: `свой-${tag}.pdf`,
      contractorId: mine.id,
      note: 'Подписанный договор',
    });
    const ofOther = await apiUpload(owner, origin, {
      name: `чужой-${tag}.pdf`,
      contractorId: other.id,
    });
    await owner.dispose();

    await openManager(page, isMobile, tag);
    // Столбцы по умолчанию — как в ТЗ: название, источник, контрагент, дата, кто загрузил.
    if (!isMobile) {
      await expect
        .poll(() =>
          page
            .locator('[data-grid] th[data-column]')
            .evaluateAll((ths) => ths.map((th) => th.getAttribute('data-column'))),
        )
        .toEqual(['name', 'src', 'cp', 'date', 'by']);
    }
    await expect(fileRow(page, general)).toBeVisible();
    await expect(fileRow(page, ofMine)).toBeVisible();
    await expect(fileRow(page, ofOther)).toHaveCount(0);
    // По прямой ссылке чужой файл тоже не открыть.
    expect((await page.request.get(`/api/files/${ofOther}/link`)).status()).toBe(404);

    // Окно файла: просмотр PDF, откуда, контрагент, кто загрузил, описание; «Готово» у ручной загрузки.
    await fileRow(page, ofMine).getByText(`свой-${tag}.pdf`, { exact: true }).click();
    const card = page.getByRole('dialog', { name: `свой-${tag}.pdf` });
    await expect(card.locator('[data-file-preview="pdf"]')).toHaveAttribute('src', /inline/);
    await expect(card.getByText('Загружен вручную').first()).toBeVisible();
    await expect(card.getByText(mine.name)).toBeVisible();
    await expect(card.getByText('Подписанный договор')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Скачать' })).toBeVisible();
    await card.getByRole('button', { name: 'Готово' }).click();
    await expect(card).toBeHidden();
  });

  test('файл задачи — с источником «название задачи»; «Перейти к источнику» открывает карточку задачи', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    const tag = uniqueTag();
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    const options = (await (await page.request.get('/api/tasks/form-options')).json()) as {
      categories: { code: string }[];
      executors: { id: string; shortName: string }[];
    };
    const me = (await (await page.request.get('/api/auth/me')).json()) as {
      employee: { id: string } | null;
    };
    const title = `Сверка ${tag}`;
    const created = await page.request.post('/api/tasks', {
      headers: { origin },
      data: {
        title,
        description: '',
        categoryCode: options.categories[0]!.code,
        contractorId: null,
        executorEmployeeId: me.employee!.id,
        term: 'day',
        dueDate: '2099-12-30',
        needFile: false,
        confirm: false,
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const task = (await created.json()) as { id: string };
    const file = await apiUpload(page.request, origin, {
      name: `акт-${tag}.png`,
      source: { kind: 'task', id: task.id },
    });

    await openManager(page, isMobile, tag);
    const row = fileRow(page, file);
    await expect(row).toContainText(title);
    await row.getByText(`акт-${tag}.png`, { exact: true }).click();
    const card = page.getByRole('dialog', { name: `акт-${tag}.png` });
    await expect(card.locator('[data-file-preview="image"] img')).toBeVisible();
    await card.getByRole('button', { name: 'Перейти к источнику' }).click();
    await expect(page.getByRole('dialog', { name: title })).toBeVisible();
  });

  test('(п. 21) «Загрузить файл вручную» из урока: окно загрузки, файл с комментарием, шаг засчитан; выключенные «Файлы в карточках» скрывают уроки модуля, включённые — возвращают', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await newOrgOwner(page.request, origin);
    const policy = (files: boolean) => filesFeature(page.request, origin, files);
    await policy(true);

    await page.goto('/app/kb/lessons');
    const upload = page.locator('[data-kb-step="upload"]');
    await expect(upload).toHaveAttribute('data-kb-state', 'open');
    await expect(page.locator('[data-kb-step="ffind"]')).toBeVisible();
    await upload.getByRole('button', { name: 'Перейти' }).click();
    await expect(page).toHaveURL(/\/app\/files/);
    const dialog = page.getByRole('dialog', { name: 'Загрузить файл' });
    await expect(dialog).toBeVisible();
    // Без файла — сообщение под полем.
    await dialog.getByRole('button', { name: 'Загрузить' }).click();
    await expect(dialog.getByText('Выберите хотя бы один файл')).toBeVisible();
    await dialog.locator('[data-files-upload-input]').setInputFiles({
      name: 'Устав.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.alloc(1024, 1),
    });
    await dialog.getByLabel('Комментарий').fill('Учредительные документы');
    await dialog.getByRole('button', { name: 'Загрузить' }).click();
    await expect(page.getByText('Загружено: 1')).toBeVisible();
    await expect(
      page.getByRole('dialog', { name: 'Готово: шаг «Загрузить файл вручную» выполнен' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Остаться здесь' }).click();
    // Строка файла; на ПК плашка «Загружено вручную» — 1 (на телефоне плашки скрыты, пока не включена
    // «Статистика»).
    await expect(page.locator('[data-grid]')).toContainText('Устав.pdf');
    if (!isMobile) await expect(page.locator('[data-plate="manual"]')).toContainText('1');

    await policy(false);
    await page.goto('/app/kb/lessons');
    await expect(page.locator('[data-kb-step="profile"]')).toBeVisible();
    await expect(page.locator('[data-kb-step="upload"]')).toHaveCount(0);
    await expect(page.locator('[data-kb-step="ffind"]')).toHaveCount(0);
    await policy(true);
    await page.reload();
    await expect(page.locator('[data-kb-step="upload"]')).toBeVisible();
    await expect(page.locator('[data-kb-step="ffind"]')).toBeVisible();
  });

  test('пустой модуль: «Здесь будут все файлы организации» с пояснением, «Добавить» открывает окно загрузки', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    await newOrgOwner(page.request, origin);
    await filesFeature(page.request, origin, true);
    await page.goto('/app/files');
    const grid = page.locator('[data-grid]');
    await expect(grid).toContainText('Здесь будут все файлы организации');
    await expect(grid).toContainText(
      'Отчёты, квитанции и документы, прикреплённые в любом модуле, собираются сюда сами.',
    );
    await grid.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Загрузить файл' })).toBeVisible();
  });

  test('«Моя организация» → «Настройки»: «Хранилище файлов» — занято и сколько файлов', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    await newOrgOwner(page.request, origin);
    await page.goto('/app/org/settings');
    const box = page.locator('[data-org-storage]');
    await expect(box).toContainText('Хранилище файлов');
    await expect(box).toContainText('Занято 0 КБ · файлов: 0');
    await expect(box).toContainText('Ограничение на один файл — 20 МБ');
  });
});
