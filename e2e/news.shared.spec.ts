import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { ADMIN_PASSWORD, platformAdmin } from './admin';
import { hire, newOrgOwner, signIn, uniqueLogin } from './helpers';

// «Новости» и «Что нового» (задача 2.32). Новость видят все пользователи платформы, поэтому тесты — в
// *.shared.spec.ts (идут после остальных и по одному): опубликованная новость не попадёт в чужую
// проверку счётчиков. Читатель — новый бухгалтер демо-организации: новости, вышедшие до его создания,
// у него прочитаны (docs/deviations.md п. Г-3), непрочитанные — только новости теста. В конце теста
// новости снимаются с публикации.

test.describe.configure({ mode: 'serial' });

const READER_PASSWORD = 'Свой-пароль-e2e-1';

/**
 * Последний день, новости которого уже видны: сегодня по Бишкеку с 09:00, раньше — вчера. Новость теста
 * с этой датой — выше любой новости начального наполнения (в один день выше та, что опубликована позже).
 */
const shownDay = () => {
  const bishkek = new Date(Date.now() + 6 * 3600_000);
  if (bishkek.getUTCHours() < 9) bishkek.setUTCDate(bishkek.getUTCDate() - 1);
  return bishkek.toISOString().slice(0, 10);
};

const MD_14 =
  '## Что нового\n- Отчёты по неделям\n\n## Исправлено\n- Счётчик на вкладке\n\n## Где найти\n- Меню → «Отчёты»\n';

/** PNG 1 × 1. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

interface News {
  id: string;
  version: number;
  off: boolean;
}

/** Новый бухгалтер демо-организации со своим паролем; сеанс в `api` закрыт. */
async function newReader(api: APIRequestContext, origin: string): Promise<string> {
  const login = uniqueLogin('e2e-news');
  const { temporaryPassword } = await hire(api, origin, login);
  await signIn(api, origin, login, temporaryPassword);
  const res = await api.post('/api/auth/password', {
    headers: { origin },
    data: { currentPassword: temporaryPassword, newPassword: READER_PASSWORD },
  });
  expect(res.status(), await res.text()).toBe(200);
  await api.post('/api/auth/logout', { headers: { origin } });
  return login;
}

/** Вход через страницу входа — после него открывается «Что нового». */
async function logIn(page: Page, login: string) {
  await page.goto('/login');
  await page.getByLabel('Логин').fill(login);
  await page.getByLabel('Пароль', { exact: true }).fill(READER_PASSWORD);
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForURL(/\/app\//);
}

async function publish(admin: APIRequestContext, origin: string, over: Record<string, unknown>) {
  const res = await admin.post('/api/admin/news', {
    headers: { origin },
    data: {
      title: 'Версия 1.4 — 20.10.2026',
      type: 'update',
      release: '1.4',
      date: shownDay(),
      short: 'Отчёты по неделям и исправленный счётчик',
      md: MD_14,
      link: null,
      pinned: false,
      showOnLogin: true,
      audience: 'all',
      publish: true,
      ...over,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as News;
}

/** Снять новость теста с публикации: у остальных тестов и прогонов её нет. */
async function takeOff(admin: APIRequestContext, origin: string, id: string) {
  const current = (await (await admin.get(`/api/admin/news/${id}`)).json()) as News;
  if (current.off) return;
  const res = await admin.post(`/api/admin/news/${id}/off`, {
    headers: { origin },
    data: { version: current.version, off: true },
  });
  expect(res.status(), await res.text()).toBe(200);
}

const unread = async (api: APIRequestContext) =>
  ((await (await api.get('/api/news/unread')).json()) as { unread: number }).unread;

test.describe('Этап 2: Новости и «Что нового»', () => {
  test('(п. 14) администратор опубликовал «Версия 1.4 — 20.10.2026» в Админке: у пользователя на вкладке «Новости» она сверху с «Новое» и счётчиком, после открытия отметка пропадает; снятая с публикации пропадает', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    const reader = await newReader(page.request, origin);
    const adminLogin = await platformAdmin(page.request, origin);
    let id: string | null = null;
    try {
      await page.goto('/app/kbadm/news');
      await expect(page.locator('[data-grid] [data-id]').first()).toBeVisible();
      await page.getByRole('button', { name: 'Добавить', exact: true }).click();
      const form = page.getByRole('dialog', { name: 'Новая новость' });
      await expect(form).toContainText('Сначала сохраняется черновиком');
      const publishButton = form.getByRole('button', { name: 'Опубликовать' });
      await publishButton.click();
      await expect(form).toContainText('Введите заголовок');
      await expect(form).toContainText('Укажите версию: без неё можно только объявление');
      await expect(form).toContainText('Введите краткое описание для ленты');
      await expect(form).toContainText('Введите подробное описание');

      const title = `Версия 1.4 — 20.10.2026 ${uniqueLogin('e2e')}`;
      await form.getByRole('textbox', { name: 'Заголовок', exact: true }).fill(title);
      await form.getByLabel('Версия', { exact: true }).fill('1.4');
      await form.getByLabel('Дата публикации').fill(shownDay());
      await form.getByLabel('Краткое описание').fill('Отчёты по неделям и исправленный счётчик');
      const md = form.getByLabel('Подробное описание (markdown)');
      await md.fill(MD_14);
      // Картинка — в хранилище, в тексте — её адрес.
      await form
        .locator('input[type=file]')
        .setInputFiles({ name: 'screen.png', mimeType: 'image/png', buffer: PNG });
      await expect(md).toHaveValue(/!\[screen\.png\]\(\/api\/news\/images\/[0-9a-f-]{36}\)/);
      if (isMobile) await form.getByRole('button', { name: 'Предпросмотр' }).click();
      const preview = form.locator('[data-news-preview]');
      await expect(preview.getByRole('heading', { name: 'Исправлено' })).toBeVisible();
      await expect(preview.locator('img')).toHaveAttribute('src', /^\/api\/news\/images\//);
      await publishButton.click();
      await expect(form).toBeHidden();
      await expect(
        page.getByRole('status').filter({
          hasText: 'Новость опубликована: у всех на вкладке «Новости» с отметкой «Новое»',
        }),
      ).toBeVisible();
      const list = (await (await page.request.get('/api/admin/news?size=all')).json()) as {
        items: (News & { title: string })[];
      };
      id = list.items.find((n) => n.title === title)!.id;

      // Пользователь: сверху ленты (под закреплёнными), «Новое», счётчик у вкладки.
      await page.request.post('/api/auth/logout', { headers: { origin } });
      await signIn(page.request, origin, reader, READER_PASSWORD);
      await page.goto('/app/kb/news');
      const tab = page.locator('[data-tabrow] [role=tab][title="Новости"]');
      await expect(tab.locator('[title="Непрочитанные новости"]')).toHaveText('1');
      // Под закреплёнными первая группа версий — 1.4, в ней эта новость.
      const firstGroup = page
        .locator('section')
        .filter({ has: page.getByRole('heading', { name: /^Версия / }) })
        .first();
      await expect(firstGroup.getByRole('heading')).toHaveText(/^Версия 1\.4 — /);
      await expect(firstGroup.locator('[data-news]').first()).toHaveAttribute('data-news', id);
      const row = page.locator(`[data-news="${id}"]`);
      await expect(row.locator('[data-news-fresh]')).toHaveText('Новое');
      await row.click();
      const dialog = page.getByRole('dialog', { name: title });
      await expect(dialog.getByRole('heading', { name: 'Где найти' })).toBeVisible();
      await dialog.getByRole('button', { name: 'Закрыть' }).last().click();
      await expect(dialog).toBeHidden();
      await expect(row.locator('[data-news-fresh]')).toHaveCount(0);
      await expect(tab.locator('[title="Непрочитанные новости"]')).toHaveCount(0);
      expect(await unread(page.request)).toBe(0);

      // Администратор снимает новость с публикации — у пользователя её нет.
      await page.request.post('/api/auth/logout', { headers: { origin } });
      await signIn(page.request, origin, adminLogin, ADMIN_PASSWORD);
      await page.goto('/app/kbadm/news');
      const adminRow = page.locator(`[data-grid] [data-id="${id}"]`);
      await expect(adminRow).toContainText('2/2 Опубликовано');
      await adminRow.locator('[data-row-menu]').click();
      await page
        .getByRole('menu', { name: 'Действия' })
        .getByRole('menuitem', { name: /^Снять с публикации/ })
        .click();
      await page
        .getByRole('dialog', { name: `Снять «${title}» с публикации?` })
        .getByRole('button', { name: 'Снять с публикации' })
        .click();
      await expect(
        page.getByRole('status').filter({ hasText: 'Новость снята с публикации' }),
      ).toBeVisible();
      await expect(adminRow).toContainText('2/2 Опубликовано · снято');
      // Под списком — «История изменений» словами прототипа, новые сверху.
      const history = page.getByRole('list', { name: /^История изменений · \d+$/ });
      await expect(history.locator('[data-timeline-item]').first()).toContainText(
        `Новости: «${title}» — Снято с публикации`,
      );
      await expect(history).toContainText(`Новости: «${title}» — Опубликовано`);
      // Сразу «Опубликовать» в окне новой новости — как в прототипе, ещё и строка «Черновик».
      await expect(history).toContainText(`Новости: «${title}» — Черновик`);
      await page.request.post('/api/auth/logout', { headers: { origin } });
      await signIn(page.request, origin, reader, READER_PASSWORD);
      const feed = (await (await page.request.get('/api/news')).json()) as {
        items: { id: string }[];
      };
      expect(feed.items.map((n) => n.id)).not.toContain(id);
    } finally {
      if (id) {
        await page.request.post('/api/auth/logout', { headers: { origin } });
        await signIn(page.request, origin, adminLogin, ADMIN_PASSWORD);
        await takeOff(page.request, origin, id);
      }
    }
  });

  test('(п. 15, п. 71) бухгалтер входит после выхода 1.4: «Что нового» с разделами, после «Понятно» новость прочитана и окно больше не открывается; новая новость «Показывать при входе» — окно только с ней', async ({
    page,
    baseURL,
    playwright,
  }) => {
    const origin = new URL(baseURL!).origin;
    const admin = await playwright.request.newContext({ baseURL });
    await platformAdmin(admin, origin);
    const reader = await newReader(page.request, origin);
    const ids: string[] = [];
    try {
      const v14 = await publish(admin, origin, {});
      ids.push(v14.id);
      const before = await playwright.request.newContext({ baseURL });
      await signIn(before, origin, reader, READER_PASSWORD);
      expect(await unread(before)).toBe(1);
      await before.dispose();

      await logIn(page, reader);
      const window = page.getByRole('dialog', { name: 'Что нового' });
      await expect(window).toBeVisible();
      await expect(window).toContainText('Добро пожаловать в Buhuchet.kg: начните с Базы знаний.');
      await expect(window.locator('[data-whats-new-item]')).toHaveCount(1);
      const item = window.locator(`[data-whats-new-item="${v14.id}"]`);
      await expect(item.getByRole('heading', { name: 'Версия 1.4 — 20.10.2026' })).toBeVisible();
      for (const section of ['Что нового', 'Исправлено', 'Где найти']) {
        await expect(item.getByRole('heading', { name: section })).toBeVisible();
      }
      await window.getByRole('button', { name: 'Понятно' }).click();
      await expect(window).toBeHidden();
      expect(await unread(page.request)).toBe(0);
      await page.goto('/app/kb/news');
      const row = page.locator(`[data-news="${v14.id}"]`);
      await expect(row).toBeVisible();
      await expect(row.locator('[data-news-fresh]')).toHaveCount(0);

      // Следующий вход: непрочитанных новостей «Показывать при входе» нет — окна нет.
      await page.request.post('/api/auth/logout', { headers: { origin } });
      const asked = page.waitForResponse((r) => r.url().endsWith('/api/news/whats-new'));
      await logIn(page, reader);
      expect(((await (await asked).json()) as { items: unknown[] }).items).toHaveLength(0);
      await expect(page.getByRole('dialog', { name: 'Что нового' })).toHaveCount(0);

      // (п. 71) Новая новость с «Показывать при входе» — окно только с ней, без приветствия.
      const v15 = await publish(admin, origin, {
        title: 'Версия 1.5 — 21.10.2026',
        release: '1.5',
      });
      ids.push(v15.id);
      await page.request.post('/api/auth/logout', { headers: { origin } });
      await logIn(page, reader);
      await expect(window).toBeVisible();
      await expect(window.locator('[data-whats-new-item]')).toHaveCount(1);
      await expect(window.locator(`[data-whats-new-item="${v15.id}"]`)).toBeVisible();
      await expect(window).not.toContainText('Добро пожаловать');
      await window.getByRole('button', { name: 'Понятно' }).click();
      await expect(window).toBeHidden();
    } finally {
      for (const id of ids) await takeOff(admin, origin, id);
      await admin.dispose();
    }
  });

  // Задача 2.33 (ТЗ «Новости» → «Окно «Что нового» при входе»): у владельца новой организации сначала
  // «Приветствие», а «Что нового» в этот вход не показывается — даже когда непрочитанная новость есть.
  test('(проверка задачи #89) владелец новой организации: при первом входе — приветствие без «Что нового»; после «Позже» при следующем входе — «Что нового»', async ({
    page,
    baseURL,
    playwright,
  }) => {
    const origin = new URL(baseURL!).origin;
    const admin = await playwright.request.newContext({ baseURL });
    await platformAdmin(admin, origin);
    const owner = await newOrgOwner(page.request, origin);
    await page.request.post('/api/auth/logout', { headers: { origin } });
    const ids: string[] = [];
    try {
      const v16 = await publish(admin, origin, {
        title: 'Версия 1.6 — 22.10.2026',
        release: '1.6',
      });
      ids.push(v16.id);
      let askedWhatsNew = 0;
      page.on('request', (r) => {
        if (r.url().endsWith('/api/news/whats-new')) askedWhatsNew += 1;
      });
      await logIn(page, owner);
      const welcome = page.getByRole('dialog', { name: 'Приветствие' });
      await expect(welcome).toBeVisible();
      await expect(welcome).toContainText('1 из 6');
      await expect(page.getByRole('dialog', { name: 'Что нового' })).toHaveCount(0);
      expect(askedWhatsNew).toBe(0);
      await welcome.getByRole('button', { name: 'Позже' }).click();
      await expect(
        page.getByText('Опросник можно пройти позже: «Моя организация» → «Учётная политика»'),
      ).toBeVisible();

      // Опросник отложен: приветствие само не открывается, при входе — «Что нового» с новостью.
      await page.request.post('/api/auth/logout', { headers: { origin } });
      await logIn(page, owner);
      const window = page.getByRole('dialog', { name: 'Что нового' });
      await expect(window).toBeVisible();
      await expect(window.locator(`[data-whats-new-item="${v16.id}"]`)).toBeVisible();
      await expect(welcome).toHaveCount(0);
      await window.getByRole('button', { name: 'Понятно' }).click();
      await expect(window).toBeHidden();
    } finally {
      for (const id of ids) await takeOff(admin, origin, id);
      await admin.dispose();
    }
  });
});
