import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { platformAdmin, search } from './admin';
import { newOrgOwner, uniqueLogin } from './helpers';

// Админка → «База знаний (содержимое)», задача 2.39 (ТЗ «Модуль База знаний (содержимое)»; прототип
// admin/kb-content.js, admin/platform-dicts-io.js): «Шаги уроков», «Статьи», «Уровни» (часть 1),
// «Показы» и выгрузка и загрузка Excel (часть 2). Содержимое общее для всех организаций, поэтому файл —
// *.shared.spec.ts (идёт после остальных и по одному): новый шаг и статья в конце теста выключаются,
// уровни, сценарий показа и загрузка возвращаются к прежнему виду.

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

interface KbShowsLite {
  shows: { step: string; items: Record<string, unknown>[] }[];
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

/** Пункт меню «+ Добавить»: на вкладках с Excel в нём ещё «Выгрузить в Excel» и «Загрузить из Excel». */
async function addMenu(page: Page, item: string) {
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByRole('menu', { name: 'Добавить' }).getByRole('menuitem', { name: item }).click();
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
    await addMenu(page, 'Шаг урока');
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
    await addMenu(page, 'Статья');
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

  test('(проверка задачи #95) «Показы»: свой сценарий шага с облачком с текстом виден в показе организаций; «Вернуть автоматический» убирает его', async ({
    page,
    baseURL,
    isMobile,
    playwright,
  }) => {
    const origin = new URL(baseURL!).origin;
    const owner = await playwright.request.newContext({ baseURL });
    await newOrgOwner(owner, origin);
    await platformAdmin(page.request, origin);
    const step = 'Настроить дни напоминаний до срока';
    const title = `Дни напоминаний ${uniqueLogin('e2e')}`;
    const ownShow = async () =>
      ((await (await owner.get('/api/kb/shows')).json()) as KbShowsLite).shows.find(
        (h) => h.step === 'remind',
      );
    try {
      await page.goto('/app/kbadm/shows');
      await expect(page.getByText('Сценарий «Показать как» для каждого шага')).toBeVisible();
      await expect(page.locator('[data-grid] [data-id]').first()).toBeVisible();
      const row = await rowOf(page, isMobile, step);
      await expect(row).toContainText('Автоматический');

      await rowAction(page, row, 'Создать свой сценарий');
      const form = page.getByRole('dialog', { name: 'Сценарий показа' });
      await expect(form.locator('[data-show-item="1"]')).toContainText(
        '1. Автоматически: Все элементы экрана',
      );
      await form.getByRole('button', { name: 'Облачко с текстом' }).click();
      const cloud = form.locator('[data-show-item="2"]');
      await expect(cloud).toContainText('2. Только текст');
      await form.getByRole('button', { name: 'Сохранить' }).click();
      await expect(toast(page, 'У каждого облачка должен быть заголовок')).toBeVisible();
      await cloud.getByLabel('Заголовок облачка').fill(title);
      await cloud.getByLabel('Текст облачка: что делает и пример').fill('Дни до срока');
      await form.getByRole('button', { name: 'Предпросмотр' }).click();
      const preview = page.getByRole('dialog', { name: 'Предпросмотр показа' });
      await expect(preview.locator('[data-show-preview] li')).toHaveCount(4);
      await expect(preview.locator('[data-show-preview] li').nth(2)).toContainText(title);
      await preview.getByRole('button', { name: 'Закрыть' }).last().click();
      await expect(preview).toBeHidden();
      await form.getByRole('button', { name: 'Сохранить' }).click();
      await expect(form).toBeHidden();
      await expect(toast(page, 'Сценарий сохранён')).toBeVisible();
      await expect(row).toContainText('Свой');
      const items = (await ownShow())?.items ?? [];
      expect(items).toHaveLength(2);
      expect(items[0]).toMatchObject({ auto: 'screen' });
      expect(items[1]).toMatchObject({ t: title, x: 'Дни до срока' });
      const history = page.locator('[data-kbadm-history="kbshows"]');
      await expect(history).toContainText(`Показы: «${step}» — создан свой сценарий (2 облачков)`);

      await rowAction(page, row, 'Вернуть автоматический');
      await expect(row).toContainText('Автоматический');
      expect(await ownShow()).toBeUndefined();
      await expect(history).toContainText(`Показы: «${step}» — снова автоматический`);
    } finally {
      // Тест упал до «Вернуть автоматический» — шаг снова без своего сценария.
      const left = (await (await page.request.get('/api/admin/kb/shows/remind')).json()) as {
        own: boolean;
        version: number;
      };
      if (left.own) {
        await page.request.delete(`/api/admin/kb/shows/remind?version=${left.version}`, {
          headers: { origin },
        });
      }
      await owner.dispose();
    }
  });

  test('(проверка задачи #95) Excel «Шаги уроков»: выгрузка в формате загрузки; правка шага в файле — одно изменение в сравнении и в истории; откат возвращает', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const stepOf = async () =>
      (await (await page.request.get('/api/admin/kb/steps/remind')).json()) as { w: string };
    const before = (await stepOf()).w;
    const why = `Из Excel ${uniqueLogin('e2e')}`;
    let loadId: string | undefined;
    try {
      await page.goto('/app/kbadm/steps');
      await expect(page.locator('[data-grid] [data-id]').first()).toBeVisible();
      const bar = page.locator('[data-io-bar]');
      await expect(bar).toContainText('сопоставление по коду, перед применением — сравнение');
      await bar.getByRole('button', { name: 'Выгрузить', exact: true }).click();
      const out = page.getByRole('dialog', { name: 'Выгрузка: Шаги уроков' });
      const text = out.getByRole('textbox', { name: 'Строки справочника для Excel' });
      await expect(text).toHaveValue(/^Код\tМодуль программы\tНазвание\tЗачем это нужно\t/);
      await expect(text).toHaveValue(/\nremind\t/);
      await out.getByRole('button', { name: 'Закрыть' }).last().click();
      await expect(out).toBeHidden();

      await addMenu(page, 'Загрузить из Excel');
      const load = page.getByRole('dialog', { name: 'Загрузка: Шаги уроков' });
      await load.getByRole('button', { name: 'Подставить текущую выгрузку' }).click();
      const data = load.getByLabel('Данные');
      await expect(data).toHaveValue(/\nremind\t/);
      const lines = (await data.inputValue()).split('\n');
      const col = lines[0]!.split('\t').indexOf('Зачем это нужно');
      await data.fill(
        lines
          .map((line) => {
            const cells = line.split('\t');
            if (cells[0] !== 'remind') return line;
            cells[col] = why;
            return cells.join('\t');
          })
          .join('\n'),
      );
      await load.getByRole('button', { name: 'Сравнить' }).click();
      const plates = load.locator('[data-plates]');
      await expect(plates.locator('[data-plate="change"]')).toContainText('1');
      await expect(plates.locator('[data-plate="add"]')).toContainText('0');
      await expect(plates.locator('[data-plate="errors"]')).toContainText('ошибок нет');
      const rows = load.getByRole('table', { name: 'Что изменит загрузка' }).locator('tbody tr');
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText('remind');
      await expect(rows.first()).toContainText(`→ ${why}`);
      await load.getByRole('button', { name: 'ОК, применить 1' }).click();
      await expect(toast(page, 'Загружено: добавлено 0, изменено 1, отключено 0')).toBeVisible();
      await expect(load).toBeHidden();
      expect((await stepOf()).w).toBe(why);
      const history = page.locator('[data-kbadm-history="kbsteps"]');
      await expect(history).toContainText(
        'Шаги уроков: загрузка из Excel — добавлено 0, изменено 1, отключено 0',
      );

      // Откат — на вкладке «Загрузки» «Справочников платформы» (проверка задачи #93); здесь — что он
      // возвращает шаг и пишет строку в историю вкладки.
      loadId = (
        (await (
          await page.request.get('/api/admin/platform-dict-loads?sort=at.desc&size=all')
        ).json()) as { items: { id: string; dict: string }[] }
      ).items.find((x) => x.dict === 'kbsteps')?.id;
      const res = await page.request.post(`/api/admin/platform-dict-loads/${loadId}/rollback`, {
        headers: { origin },
      });
      expect(res.status(), await res.text()).toBe(200);
      loadId = undefined;
      expect((await stepOf()).w).toBe(before);
      await page.reload();
      await expect(history).toContainText('Шаги уроков: загрузка от');
      await expect(history).toContainText('откачена');
    } finally {
      if (loadId) {
        await page.request.post(`/api/admin/platform-dict-loads/${loadId}/rollback`, {
          headers: { origin },
        });
      }
    }
  });
});
