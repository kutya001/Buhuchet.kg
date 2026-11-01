import { expect, test, type Page } from '@playwright/test';
import { DEMO_PASSWORD } from './helpers';

// Лендинг buhuchet.kg для гостей, вход с возвратом на ссылку и демо-версия /demo (задача #165, ТЗ
// «Лендинг — buhuchet.kg для гостей»). Тексты — словарь, группа «Лендинг» (refDB.json).

const HERO = 'Отчёты, сроки и деньги клиентов бухгалтерской фирмы — в одной программе';
const BLOCKS = [
  'Кому подходит',
  'Что меняется',
  'Возможности',
  'Как это выглядит',
  'Как начать',
  'Безопасность и данные',
  'Вопросы',
  'Оставить заявку',
];

/**
 * Свой адрес на каждый тест: с одного адреса — не больше 3 заявок в час, а тесты обоих проектов и
 * повторы идут с одной машины. Адрес берётся из первого X-Forwarded-For, как за Vercel и Caddy.
 */
async function ownAddress(page: Page) {
  const part = () => Math.floor(Math.random() * 256);
  const address = `198.19.${part()}.${part()}`;
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': address });
  return address;
}

/** Свой номер на каждый запуск: повтор с тем же телефоном за сутки дописывается к первой заявке. */
const uniquePhone = () =>
  `7${String(Date.now()).slice(-5)}${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;

async function signInByForm(page: Page, login: string, password: string) {
  await page.getByLabel('Логин').fill(login);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await Promise.all([
    page.waitForResponse('**/api/auth/login'),
    page.getByRole('button', { name: 'Войти' }).click(),
  ]);
}

const leadForm = (page: Page) => page.locator('#lp-lead form');

async function fillLead(page: Page, phone: string) {
  const form = leadForm(page);
  await form.getByLabel('Имя и фамилия').fill('Сквозная Заявка');
  await form.getByLabel('Название фирмы').fill('ОсОО «Сквозной тест»');
  await form.getByLabel('Телефон').fill(phone);
  await form.getByLabel('Сколько клиентов ведёте').selectOption('21–50');
}

test.describe('Этап 3: лендинг для гостей (задача #165)', () => {
  test('(лендинг, гость) гость видит лендинг от первого экрана до «Вопросов» и форму заявки; «Войти» — страница входа, после входа владелец на Главной; повторно buhuchet.kg — сразу Главная', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Buhuchet.kg — программа для бухгалтерских фирм Кыргызстана');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(HERO);
    for (const name of BLOCKS) {
      await expect(page.getByRole('heading', { level: 2, name })).toBeAttached();
    }
    const form = leadForm(page);
    for (const label of ['Имя и фамилия', 'Название фирмы', 'Телефон', 'Сколько клиентов ведёте']) {
      await expect(form.getByLabel(label)).toBeAttached();
    }
    await expect(form.getByRole('button', { name: 'Отправить заявку' })).toBeAttached();
    // Числа полосы цифр — из справочников платформы, а не вручную.
    await expect(page.getByText('видов отчётов и платежей в каталоге')).toBeVisible();

    await page.locator('header').getByRole('link', { name: 'Войти' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('link', { name: 'О платформе' })).toHaveAttribute('href', '/');
    await signInByForm(page, 'erkin', DEMO_PASSWORD);
    await expect(page).toHaveURL(/\/app\/home\//);

    await page.goto('/');
    await expect(page).toHaveURL(/\/app\/home\//);
  });

  test('(лендинг, ссылка из Telegram) гость открыл ссылку на отчёты из Telegram без входа: страница входа, после входа — эта страница', async ({
    page,
  }) => {
    // Ссылка сообщения бота о новом отчёте (packages/api/src/modules/telegram/events.ts).
    await page.goto('/app/reports/all');
    await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Freports%2Fall$/);
    await signInByForm(page, 'erkin', DEMO_PASSWORD);
    await expect(page).toHaveURL(/\/app\/reports\/all$/);
    // Чужой адрес в next не уводит с сайта: после входа — программа.
    await page.goto('/login?next=//example.com/app');
    await expect(page).toHaveURL(/\/app\/home\//);
  });

  test('(лендинг, телефон) на телефоне лендинг без горизонтальной прокрутки; после первого экрана внизу закреплена «Оставить заявку», над формой заявки она скрыта', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'кнопка внизу экрана — только на телефоне');
    await page.goto('/');
    const width = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      window.innerWidth,
    ]);
    expect(width[0]).toBeLessThanOrEqual(width[1]!);
    const fab = page.locator('.lp-fab');
    await expect(fab).toBeHidden();
    await page.getByRole('heading', { level: 2, name: 'Возможности' }).scrollIntoViewIfNeeded();
    await expect(fab).toBeVisible();
    await fab.getByRole('button', { name: 'Оставить заявку' }).click();
    // Прокрутка к форме и курсор в первом поле; над формой кнопки нет.
    await expect(leadForm(page).getByLabel('Имя и фамилия')).toBeFocused();
    await expect(fab).toBeHidden();
    // Панель «≡»: ссылки на блоки, «Оставить заявку» и «Посмотреть на демо-организацию».
    await page.getByRole('button', { name: 'Меню' }).click();
    const menu = page.locator('#lp-menu');
    await expect(menu.getByRole('button', { name: 'Как начать' })).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Посмотреть на демо-организацию' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  });

  test('(проверка задачи #165) форма заявки: пустая — ошибки под полями, без галочки — «Нужно согласие…»; нет связи — «Не удалось отправить…», введённое не пропадает; с галочкой — «Спасибо!»', async ({
    page,
  }) => {
    await ownAddress(page);
    await page.goto('/#lead');
    const form = leadForm(page);
    await expect(form.getByLabel('Имя и фамилия')).toBeFocused();
    await form.getByRole('button', { name: 'Отправить заявку' }).click();
    for (const text of [
      'Введите имя и фамилию',
      'Введите название фирмы',
      'Номер — 9 цифр после кода страны',
      'Выберите, сколько клиентов ведёте',
      'Нужно согласие на обработку персональных данных',
    ]) {
      await expect(form.getByText(text)).toBeVisible();
    }
    const phone = uniquePhone();
    await fillLead(page, phone);
    await form.getByRole('button', { name: 'Отправить заявку' }).click();
    await expect(form.getByText('Нужно согласие на обработку персональных данных')).toBeVisible();

    await form.getByRole('button', { name: 'обработку персональных данных' }).click();
    const consent = page.getByRole('dialog', { name: 'Согласие на обработку персональных данных' });
    await expect(consent).toContainText('Закону КР «Об информации персонального характера»');
    await consent.getByRole('button', { name: 'Понятно' }).click();
    await form.getByLabel(/Согласен на/).check();

    await page.route('**/api/leads', (route) => route.abort('internetdisconnected'));
    await form.getByRole('button', { name: 'Отправить заявку' }).click();
    await expect(form.getByRole('alert')).toHaveText(
      'Не удалось отправить заявку. Проверьте подключение и попробуйте ещё раз',
    );
    await expect(form.getByLabel('Имя и фамилия')).toHaveValue('Сквозная Заявка');
    await page.unroute('**/api/leads');

    await form.getByRole('button', { name: 'Отправить заявку' }).click();
    const formatted = `+996 ${phone.slice(0, 3)} ${phone.slice(3, 6)} ${phone.slice(6)}`;
    await expect(page.locator('#lp-lead').getByRole('status')).toHaveText(
      `Спасибо! Заявка отправлена. Мы свяжемся с вами по номеру ${formatted} в рабочее время.`,
    );
  });

  test('(проверка задачи #165) четвёртая заявка за час с одного адреса: «Отправляем…», затем «Слишком много заявок…» с телефоном для связи; введённое не пропадает', async ({
    page,
    baseURL,
  }) => {
    const address = await ownAddress(page);
    const origin = new URL(baseURL!).origin;
    // Три заявки с этого адреса уже пришли (как с другой вкладки).
    for (let i = 0; i < 3; i += 1) {
      const res = await page.request.post('/api/leads', {
        headers: { origin, 'x-forwarded-for': address },
        data: {
          name: 'Сквозная Заявка',
          firm: 'ОсОО «Сквозной тест»',
          phone: `+996${uniquePhone()}`,
          size: '21–50',
          telegram: '',
          note: '',
          consent: true,
          website: '',
        },
      });
      expect(res.status()).toBe(200);
    }
    await page.goto('/#lead');
    await fillLead(page, uniquePhone());
    const form = leadForm(page);
    await form.getByLabel(/Согласен на/).check();
    // Пока заявка отправляется — «Отправляем…», кнопка неактивна.
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/api/leads', async (route) => {
      await held;
      await route.continue();
    });
    await form.getByRole('button', { name: 'Отправить заявку' }).click();
    await expect(form.getByRole('button', { name: 'Отправляем…' })).toBeDisabled();
    release();
    await expect(form.getByRole('alert')).toHaveText(
      'Слишком много заявок с этого адреса. Попробуйте через час или позвоните нам: +996 500 888 268',
    );
    await expect(form.getByLabel('Имя и фамилия')).toHaveValue('Сквозная Заявка');
    await page.unroute('**/api/leads');
  });

  test('(лендинг, демо) «Посмотреть на демо-организацию»: программа с полосой «Демо-версия…»; изменения — без единого запроса к серверу и только в этом браузере; «Оставить заявку» в полосе — форма на лендинге', async ({
    page,
    browser,
  }) => {
    await page.goto('/');
    const requests: string[] = [];
    const onRequest = (r: { url: () => string }) => requests.push(r.url());
    await Promise.all([
      page.waitForURL(/\/demo$/),
      page
        .locator('#lp-hero')
        .getByRole('link', { name: 'Посмотреть на демо-организацию' })
        .click(),
    ]);
    const strip = page.locator('#demo-strip');
    await expect(strip).toContainText(
      'Демо-версия: данные выдуманные, всё работает только в вашем браузере',
    );
    page.on('request', onRequest);
    // Новый контрагент и отчёт «Сдан» — данными самой демо-версии (как их сохраняют её формы):
    // формы прототипа проверяет его репозиторий, здесь — что всё остаётся в браузере гостя.
    const made = await page
      .evaluate(() => {
        const w = window as unknown as {
          CPS: Record<string, unknown>[];
          REPORTS: { status: string; superseded?: boolean; subDate?: string }[];
          TODAY: string;
          dbSoon: () => void;
        };
        w.CPS.push({ ...structuredClone(w.CPS[0]), id: 990001, name: 'ОсОО «Сквозная демо»' });
        const report = w.REPORTS.find((r) => r.status === 'К сдаче' && !r.superseded)!;
        report.status = 'Сдан';
        report.subDate = w.TODAY;
        w.dbSoon();
        return true;
      })
      .catch(() => false);
    expect(made).toBe(true);
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('budemo.temdb') ?? ''))
      .toContain('Сквозная демо');
    // Хранилище демо-версии — свои ключи budemo.*, не ключи программы.
    expect(
      await page.evaluate(() => Object.keys(localStorage).filter((k) => !k.startsWith('budemo.'))),
    ).toEqual([]);
    await page.reload();
    await expect(strip).toBeVisible();
    await page.evaluate(() => {
      window.location.hash = '#cps';
    });
    await expect(page.getByText('ОсОО «Сквозная демо»').first()).toBeVisible();
    // Ни одного запроса к серверу, кроме самого файла демо-версии при обновлении страницы.
    expect(requests.filter((u) => !/\/demo$/.test(new URL(u).pathname))).toEqual([]);

    const other = await browser.newContext();
    const fresh = await other.newPage();
    await fresh.goto('/demo');
    await expect(fresh.locator('#demo-strip')).toBeVisible();
    await fresh.evaluate(() => {
      window.location.hash = '#cps';
    });
    await expect(fresh.getByText('ОсОО «Сквозная демо»')).toHaveCount(0);
    await other.close();

    page.off('request', onRequest);
    await Promise.all([
      page.waitForURL((url) => url.pathname === '/'),
      strip.getByRole('button', { name: 'Оставить заявку' }).click(),
    ]);
    await expect(leadForm(page).getByLabel('Имя и фамилия')).toBeFocused();
  });

  test('(проверка задачи #165) /demo — запрет исходящих запросов и без индексации; лендинг рабочего сайта — с превью ссылки', async ({
    request,
  }) => {
    const demo = await request.get('/demo');
    expect(demo.status()).toBe(200);
    const csp = demo.headers()['content-security-policy'] ?? '';
    for (const rule of ["default-src 'none'", "connect-src 'none'", "form-action 'none'"]) {
      expect(csp.split('; ')).toContain(rule);
    }
    expect(demo.headers()['x-robots-tag']).toBe('noindex, nofollow');
    expect(await demo.text()).toContain('var BU_DEMO=');
    const landing = await (await request.get('/')).text();
    expect(landing).toContain('property="og:image"');
    expect(landing).toContain('og.jpg');
    expect((await request.get('/og.jpg')).headers()['content-type']).toBe('image/jpeg');
  });
});
