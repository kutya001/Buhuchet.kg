import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { platformAdmin, search } from './admin';
import { newOrgOwner, uniqueLogin } from './helpers';

// Админка → «База знаний (содержимое)», часть 1 задачи 2.39 (ТЗ «Модуль База знаний (содержимое)»;
// прототип admin/kb-content.js): «Шаги уроков», «Статьи», «Уровни». Содержимое общее для всех
// организаций, поэтому файл — *.shared.spec.ts (идёт после остальных и по одному): новый шаг и статья
// в конце теста выключаются, уровни возвращаются к прежним.

test.describe.configure({ mode: 'serial' });

/** PNG 1 × 1. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

interface KbStateLite {
  lessons: { steps: { id: string; title: string; isNew: boolean }[] }[];
  progress: { levels: { name: string; percent: number }[] };
}

const kbMe = async (api: APIRequestContext) =>
  (await (await api.get('/api/kb/me')).json()) as KbStateLite;

const toast = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

/** Строка списка вкладки по названию (общий поиск по вкладке). */
async function rowOf(page: Page, isMobile: boolean, title: string) {
  await search(page, isMobile, title);
  const row = page.locator('[data-grid] [data-id]').filter({ hasText: title });
  await expect(row).toHaveCount(1);
  return row;
}

async function rowAction(page: Page, row: ReturnType<Page['locator']>, name: string) {
  await row.locator('[data-row-menu]').click();
  await page.getByRole('menu', { name: 'Действия' }).getByRole('menuitem', { name }).click();
}

test.describe('Этап 2: Админка → «База знаний (содержимое)»', () => {
  test('(проверка задачи #95) новый шаг урока появляется у организаций с «Новое», выключенный пропадает; правка — в «Истории изменений»', async ({
    page,
    baseURL,
    isMobile,
    playwright,
  }) => {
    const origin = new URL(baseURL!).origin;
    const owner = await playwright.request.newContext({ baseURL });
    await newOrgOwner(owner, origin);
    await platformAdmin(page.request, origin);
    const title = `Посмотреть список контрагентов ${uniqueLogin('e2e')}`;

    await page.goto('/app/kbadm/steps');
    await expect(page.getByText('Шаги программ обучения для всех организаций')).toBeVisible();
    await expect(page.locator('[data-grid] [data-id]').first()).toBeVisible();
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    const form = page.getByRole('dialog', { name: 'Новый шаг урока' });
    await expect(form).toContainText('Появится у всех с отметкой «Новое»');
    await form.getByRole('button', { name: 'Сохранить' }).click();
    await expect(form).toContainText('Введите название');

    await form.getByLabel('Модуль программы').selectOption({ label: 'Контрагенты' });
    await form.getByLabel('Вид шага').selectOption({ label: 'Посмотреть' });
    await form.getByRole('textbox', { name: 'Название', exact: true }).fill(title);
    await form.getByLabel('Зачем это нужно').fill('Все контрагенты организации');
    await form.getByLabel('Место для «Перейти»').selectOption({ label: 'Контрагенты' });
    await form.getByRole('button', { name: 'Сохранить' }).click();
    await expect(form).toBeHidden();
    await expect(toast(page, 'Шаг добавлен: появится у всех с отметкой «Новое»')).toBeVisible();

    const row = await rowOf(page, isMobile, title);
    await expect(row).toContainText('Новое');
    await expect(row).toContainText('Посмотреть');
    const added = (await kbMe(owner)).lessons
      .flatMap((l) => l.steps)
      .find((s) => s.title === title);
    expect(added).toMatchObject({ isNew: true });

    await rowAction(page, row, 'Выключить');
    await expect(row).toContainText('Нет');
    expect((await kbMe(owner)).lessons.flatMap((l) => l.steps).some((s) => s.title === title)).toBe(
      false,
    );
    const history = page.locator('[data-kbadm-history="kbsteps"]');
    await expect(history).toContainText(`Шаги уроков: «${title}» выключен`);
    await expect(history).toContainText(`Шаги уроков: добавлен шаг «${title}» (Организации)`);
    await owner.dispose();
  });

  test('(проверка задачи #95) статья с картинкой: предпросмотр как у пользователя, сохранение и отключение', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const title = `Контрагенты: как добавить ${uniqueLogin('e2e')}`;

    await page.goto('/app/kbadm/arts');
    await expect(page.getByText('Статьи «Базы знаний» для всех организаций')).toBeVisible();
    await expect(page.locator('[data-grid] [data-id]').first()).toBeVisible();
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    const form = page.getByRole('dialog', { name: 'Новая статья' });
    await form.getByRole('textbox', { name: 'Название', exact: true }).fill(title);
    await form.getByLabel('К какому модулю относится').selectOption({ label: 'Контрагенты' });
    const text = form.getByLabel('Текст', { exact: true });
    await text.fill('<h4>Шаг 1</h4><p>Нажмите <b>«+ Добавить»</b></p><script>alert(1)</script>');
    // Картинка — в хранилище, в тексте — её адрес.
    await form
      .locator('input[type=file]')
      .setInputFiles({ name: 'screen.png', mimeType: 'image/png', buffer: PNG });
    await expect(text).toHaveValue(
      /<img src="\/api\/news\/images\/[0-9a-f-]{36}" alt="screen\.png">/,
    );

    await form.getByRole('button', { name: 'Предпросмотр' }).click();
    const preview = page.getByRole('dialog', { name: title });
    await expect(preview.getByRole('heading', { name: 'Шаг 1' })).toBeVisible();
    await expect(preview).toContainText('Нажмите «+ Добавить»');
    await expect(preview.locator('img')).toHaveAttribute('src', /^\/api\/news\/images\//);
    await expect(preview.locator('script')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(preview).toBeHidden();

    await form.getByRole('button', { name: 'Сохранить' }).click();
    await expect(form).toBeHidden();
    await expect(toast(page, 'Статья сохранена')).toBeVisible();
    const row = await rowOf(page, isMobile, title);
    await expect(row).toContainText('Контрагенты');

    await rowAction(page, row, 'Отключить');
    await expect(row).toContainText('Нет');
    const history = page.locator('[data-kbadm-history="kbarts"]');
    await expect(history).toContainText(`Статьи: «${title}» отключена`);
    await expect(history).toContainText(`Статьи: добавлена «${title}»`);
  });

  test('(проверка задачи #95) «Уровни»: пустое название — ошибка, новое название уровня видно у организаций; запись в истории', async ({
    page,
    baseURL,
    playwright,
  }) => {
    const origin = new URL(baseURL!).origin;
    const owner = await playwright.request.newContext({ baseURL });
    await newOrgOwner(owner, origin);
    await platformAdmin(page.request, origin);
    const before = (await kbMe(owner)).progress.levels[1]!;
    const name = `Стажёр ${Date.now().toString(36)}`;

    await page.goto('/app/kbadm/levels');
    const box = page.locator('[data-kbadm-levels="business"]');
    const second = box.getByLabel('Название уровня 2');
    await expect(second).toHaveValue(before.name);
    try {
      await second.fill('');
      await box.getByRole('button', { name: 'Сохранить' }).click();
      await expect(box).toContainText('У каждого уровня должно быть название');
      await second.fill(name);
      await box.getByRole('button', { name: 'Сохранить' }).click();
      await expect(toast(page, 'Уровни сохранены: полученные уровни не отнимаются')).toBeVisible();
      expect((await kbMe(owner)).progress.levels[1]).toMatchObject({ name });
      await expect(page.locator('[data-kbadm-history="kblevels"]')).toContainText(
        `Уровни (организации): 2: ${before.name} ${before.percent} % → ${name} ${before.percent} %`,
      );
    } finally {
      // Прежнее название — у остальных тестов и прогонов.
      const current = (await (await page.request.get('/api/admin/kb/levels')).json()) as {
        business: { n: string; p: number }[];
        version: number;
      };
      const res = await page.request.put('/api/admin/kb/levels/business', {
        headers: { origin },
        data: {
          levels: current.business.map((l, j) => (j === 1 ? { ...l, n: before.name } : l)),
          version: current.version,
        },
      });
      expect(res.status(), await res.text()).toBe(200);
      await owner.dispose();
    }
  });
});
