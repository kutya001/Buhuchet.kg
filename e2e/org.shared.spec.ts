import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { DEMO_PASSWORD, signIn } from './helpers';

// «Моя организация»: экраны, которые меняют общую запись демо-организации (функции, адрес страницы,
// дни напоминаний, настройки). Файл *.shared.spec.ts идёт после всех остальных тестов и по одному —
// сначала на ПК, потом на телефоне (playwright.config.ts), — чтобы выключенный на время модуль не
// попал в чужую проверку меню и прав. Всё изменённое возвращается как было.

test.describe.configure({ mode: 'serial' });

type Policy = {
  version: number;
  features: Record<string, boolean>;
  remindDays: number[];
  overdueRepeat: boolean;
  timezone: string;
  defaultRoleId: string | null;
  defaultRoleName: string | null;
};

/** Картинка PNG 1 × 1. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

async function policy(api: APIRequestContext) {
  const res = await api.get('/api/org/policy');
  expect(res.status()).toBe(200);
  return (await res.json()) as Policy;
}

async function patchPolicy(api: APIRequestContext, origin: string, data: Partial<Policy>) {
  const res = await api.patch('/api/org/policy', {
    headers: { origin },
    data: { version: (await policy(api)).version, ...data },
  });
  expect(res.status(), await res.text()).toBe(200);
}

async function setSlug(api: APIRequestContext, origin: string, slug: string) {
  const current = (await (await api.get('/api/org')).json()) as { version: number; slug: string };
  if (current.slug === slug) return;
  const res = await api.patch('/api/org', {
    headers: { origin },
    data: { version: current.version, slug },
  });
  expect(res.status(), await res.text()).toBe(200);
}

/** Ссылки меню на модуль в разметке страницы (левая панель; на телефоне она скрыта, но в разметке). */
const moduleLinks = (page: Page, moduleId: string) =>
  page.locator(`aside a[href^="/app/${moduleId}"]`);

test.describe('Этап 1: Моя организация — правки владельца', () => {
  test('владелец выключает модуль в учётной политике — он пропадает из меню у всех сотрудников; включает обратно — появляется', async ({
    page,
    browser,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    const colleague = await browser.newContext({ baseURL });
    await signIn(colleague.request, origin, 'alisher', DEMO_PASSWORD);
    const other = await colleague.newPage();
    await other.goto('/app/reports/week');
    await expect(moduleLinks(other, 'projects')).toHaveCount(1);

    await page.goto('/app/org/policy');
    const main = page.locator('main');
    const projects = main.locator('[data-feat-row="projects"]').getByRole('switch');
    await expect(projects).toBeChecked();
    await expect(moduleLinks(page, 'projects')).toHaveCount(1);
    try {
      await projects.click();
      await expect(
        page.getByRole('status').filter({ hasText: 'Проекты контрагентов: отключено' }),
      ).toBeVisible();
      await expect(projects).not.toBeChecked();
      // У владельца модуль пропал сразу, без перезагрузки; в истории — запись.
      await expect(moduleLinks(page, 'projects')).toHaveCount(0);
      if (isMobile) {
        await page.getByRole('button', { name: 'Меню' }).click();
        const sheet = page.getByRole('dialog', { name: 'Меню' });
        const others = sheet.getByRole('navigation', { name: 'Другие модули' });
        await expect(others.getByRole('link', { name: 'Сотрудники' })).toBeVisible();
        await expect(others.getByRole('link', { name: /Проекты/ })).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(sheet).toBeHidden();
      }
      await expect(main.locator('[data-timeline-item]').first()).toContainText(
        'Отключена функция «Проекты контрагентов»',
      );
      // У сотрудника — при следующем открытии страницы.
      await other.reload();
      await expect(moduleLinks(other, 'projects')).toHaveCount(0);
      await expect(moduleLinks(other, 'reports')).toHaveCount(1);

      await projects.click();
      const done = page.getByRole('dialog', { name: 'Функция «Проекты контрагентов» включена' });
      await expect(done).toBeVisible();
      await done.getByRole('button', { name: 'Позже' }).click();
      await expect(done).toBeHidden();
      await expect(projects).toBeChecked();
      await expect(moduleLinks(page, 'projects')).toHaveCount(1);
      await other.reload();
      await expect(moduleLinks(other, 'projects')).toHaveCount(1);
    } finally {
      if (!(await policy(page.request)).features.projects) {
        await patchPolicy(page.request, origin, { features: { projects: true } });
      }
      await colleague.close();
    }
  });

  test('владелец вводит «admin» в «Адрес страницы организации»: поле подсвечено «Этот адрес занят, выберите другой», сохранить нельзя; с адресом «ahti» сохраняется', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    await page.goto('/app/org/main');
    const main = page.locator('main');
    const slug = main.getByLabel('Адрес страницы организации');
    const save = main.getByRole('button', { name: 'Сохранить' });
    await expect(slug).toHaveValue('buhgalter-plyus');
    try {
      await slug.fill('admin');
      await expect(main.getByText('Этот адрес занят, выберите другой')).toBeVisible();
      await expect(slug).toHaveAttribute('aria-invalid', 'true');
      await save.click();
      await expect(slug).toBeFocused();
      await expect(
        page.getByRole('dialog', { name: 'Сменить адрес страницы организации?' }),
      ).toHaveCount(0);
      expect(((await (await page.request.get('/api/org')).json()) as { slug: string }).slug).toBe(
        'buhgalter-plyus',
      );

      await slug.fill('ahti');
      await expect(slug).not.toHaveAttribute('aria-invalid');
      await save.click();
      // Смена адреса ломает ссылки, уже отправленные контрагентам, — сначала вопрос.
      const confirm = page.getByRole('dialog', { name: 'Сменить адрес страницы организации?' });
      await expect(confirm).toContainText('www.buhuchet.kg/ahti/inn/');
      await confirm.getByRole('button', { name: 'Сменить адрес' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Сохранено' })).toBeVisible();
      await expect(main.getByText('www.buhuchet.kg/ahti/inn/', { exact: false })).toBeVisible();
      const me = (await (await page.request.get('/api/auth/me')).json()) as {
        organization: { slug: string };
      };
      expect(me.organization.slug).toBe('ahti');
    } finally {
      await setSlug(page.request, origin, 'buhgalter-plyus');
    }
  });

  test('дни напоминаний добавляются вводом и убираются крестиком; настройки сохраняются кнопкой', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    const before = await policy(page.request);
    try {
      await page.goto('/app/org/policy');
      const main = page.locator('main');
      const add = main.getByRole('textbox', { name: 'Добавить день напоминания' });
      await add.fill('14');
      await add.press('Enter');
      await expect(
        page.getByRole('status').filter({ hasText: 'Набор дней сохранён' }),
      ).toBeVisible();
      const chip = main.locator('[data-chip="14"]');
      await expect(chip).toHaveText('за 14 дней');
      expect((await policy(page.request)).remindDays).toContain(14);
      await chip.getByRole('button', { name: 'Убрать' }).click();
      await expect(chip).toHaveCount(0);
      await expect.poll(async () => (await policy(page.request)).remindDays).not.toContain(14);

      await page.goto('/app/org/settings');
      const repeat = main.getByRole('switch', { name: /Повторять при просрочке/ });
      await expect(repeat).toBeChecked({ checked: before.overdueRepeat });
      await repeat.click();
      await main.getByRole('button', { name: 'Сохранить настройки' }).click();
      await expect(
        page.getByRole('status').filter({ hasText: 'Настройки сохранены' }),
      ).toBeVisible();
      expect((await policy(page.request)).overdueRepeat).toBe(!before.overdueRepeat);
    } finally {
      await patchPolicy(page.request, origin, {
        remindDays: before.remindDays,
        overdueRepeat: before.overdueRepeat,
      });
    }
  });

  test('«Запись изменена другим пользователем»: сохранение поверх чужой правки не проходит, «Перечитать» показывает новые значения; часовой пояс и роль по умолчанию сохраняются', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    const before = await policy(page.request);
    try {
      await page.goto('/app/org/settings');
      const main = page.locator('main');
      const repeat = main.getByRole('switch', { name: /Повторять при просрочке/ });
      const timezone = main.getByLabel('Часовой пояс');
      const role = main.getByLabel('Роль по умолчанию для новых сотрудников');
      const save = main.getByRole('button', { name: 'Сохранить настройки' });
      await expect(repeat).toBeChecked({ checked: before.overdueRepeat });

      // Пока форма открыта, настройки меняет другой пользователь.
      await patchPolicy(page.request, origin, { overdueRepeat: !before.overdueRepeat });
      await timezone.selectOption('Asia/Almaty');
      await save.click();
      await expect(main.getByText('Запись изменена другим пользователем')).toBeVisible();
      await expect(save).toBeDisabled();
      expect((await policy(page.request)).timezone).toBe(before.timezone);
      await main.getByRole('button', { name: 'Перечитать' }).click();
      await expect(main.getByText('Запись изменена другим пользователем')).toHaveCount(0);
      await expect(repeat).toBeChecked({ checked: !before.overdueRepeat });
      await expect(timezone).toHaveValue(before.timezone);

      await timezone.selectOption('Asia/Almaty');
      await role.selectOption({ label: 'Главный бухгалтер' });
      await save.click();
      await expect(
        page.getByRole('status').filter({ hasText: 'Настройки сохранены' }),
      ).toBeVisible();
      expect(await policy(page.request)).toMatchObject({
        timezone: 'Asia/Almaty',
        defaultRoleName: 'Главный бухгалтер',
      });
    } finally {
      await patchPolicy(page.request, origin, {
        overdueRepeat: before.overdueRepeat,
        timezone: before.timezone,
        ...(before.defaultRoleId ? { defaultRoleId: before.defaultRoleId } : {}),
      });
    }
  });

  test('логотип PNG до 2 МБ: предпросмотр до сохранения, после «Сохранить» — у организации', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    const removeLogo = async () => {
      const current = (await (await page.request.get('/api/org')).json()) as {
        version: number;
        logo: unknown;
      };
      if (!current.logo) return;
      const res = await page.request.delete(`/api/org/logo?version=${current.version}`, {
        headers: { origin },
      });
      expect(res.status(), await res.text()).toBe(200);
    };
    await removeLogo();
    try {
      await page.goto('/app/org/main');
      const main = page.locator('main');
      await expect(main.locator('[data-org-logo]')).toHaveCount(0);
      await main.getByLabel('Логотип').setInputFiles({
        name: 'logo.png',
        mimeType: 'image/png',
        buffer: PNG,
      });
      // Предпросмотр — выбранный файл, ещё не сохранённый.
      await expect(main.locator('[data-org-logo]')).toHaveAttribute('src', /^blob:/);
      await main.getByRole('button', { name: 'Сохранить' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Сохранено' })).toBeVisible();
      // Картинку отдаёт хранилище по временной ссылке (в docker-e2e браузер до него не дотягивается,
      // поэтому проверяется ссылка, а не то, что картинка открылась).
      await expect(main.locator('[data-org-logo]')).not.toHaveAttribute('src', /^blob:/);
      const profile = (await (await page.request.get('/api/org')).json()) as {
        logo: { url: string } | null;
      };
      expect(profile.logo?.url).toBeTruthy();
    } finally {
      await removeLogo();
    }
  });
});
