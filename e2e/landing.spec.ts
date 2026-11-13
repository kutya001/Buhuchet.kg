import { expect, test, type Page } from '@playwright/test';
import { DEMO_PASSWORD } from './helpers';

// Лендинг buhuchet.kg для гостей, вход с возвратом на ссылку и демо-версия /demo (задача #165, ТЗ
// «Лендинг — buhuchet.kg для гостей»). Тексты — словарь, группа «Лендинг» (refDB.json).

const HERO = 'Отчёты, сроки и деньги клиентов бухгалтерской фирмы — в одной программе';
const BLOCKS = [
  'Три символа герба бухгалтеров — в Buhuchet.kg',
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

/**
 * Заставки с логотипом (прототип v78) в браузере под управлением тестов нет (`navigator.webdriver`,
 * docs/deviations.md п. О-52): сквозные тесты открывают сотни страниц. Проверки заставки открывают
 * страницы как обычный браузер.
 */
const withIntro = (page: Page) =>
  page.addInitScript(() =>
    Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }),
  );

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

  test('(проверка прототипа v72 и v88) кнопка темы: без выбора лендинг и страница входа светлые и при тёмной теме устройства; тема меняется волной; выбор запоминается и действует в программе', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    const html = page.locator('html');
    const scheme = () =>
      page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);

    // Страница входа без выбора — светлая: от темы устройства тема не зависит (прототип v88).
    await page.goto('/login');
    await expect.poll(scheme).toBe('light');

    await page.goto('/');
    await expect.poll(scheme).toBe('light');
    await expect(html).not.toHaveAttribute('data-theme', /./);
    const toggle = page.locator('header').getByRole('button', { name: 'Светлая или тёмная тема' });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('title', 'Светлая или тёмная тема');
    // Значок: в светлой — луна, в тёмной — солнце.
    const moon = toggle.locator('.bu-light-only');
    const sun = toggle.locator('.bu-dark-only');
    await expect(moon).toBeVisible();
    await expect(sun).toBeHidden();
    // Ссылка «Демо-организация» в шапке — только на экранах от 1 280 px.
    const demo = page.locator('header').getByRole('link', { name: 'Демо-организация' });
    if (page.viewportSize()!.width >= 1280) await expect(demo).toBeVisible();
    else await expect(demo).toBeHidden();

    // Смена темы идёт волной со стороны кнопки: на время волны у страницы отметка data-wave
    // (сторона кнопки — «r» справа или «l» слева), после — отметки нет.
    const waves = await page.evaluate(() => {
      const seen: string[] = [];
      const root = document.documentElement;
      new MutationObserver(() => {
        if (root.dataset.wave) seen.push(root.dataset.wave);
      }).observe(root, { attributes: true, attributeFilter: ['data-wave'] });
      return ((window as unknown as { __waves: string[] }).__waves = seen);
    });
    expect(waves).toEqual([]);
    await toggle.click();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect.poll(scheme).toBe('dark');
    await expect(sun).toBeVisible();
    await expect(moon).toBeHidden();
    await expect(html).not.toHaveAttribute('data-wave', /./);
    const seen = await page.evaluate(() => (window as unknown as { __waves: string[] }).__waves);
    expect(seen).toHaveLength(1);
    expect(['l', 'r']).toContain(seen[0]);
    await toggle.click();
    await expect(html).toHaveAttribute('data-theme', 'light');
    await expect.poll(scheme).toBe('light');
    await toggle.click();

    // Выбор запомнен на этом устройстве: после перезагрузки и на странице входа — тёмная.
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect.poll(scheme).toBe('dark');
    await page.goto('/login');
    await expect(html).toHaveAttribute('data-theme', 'dark');
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
    await expect(consent).toContainText('Законом КР «Об информации персонального характера»');
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
    // Данные демо-версии — переменные её скрипта (`const CPS`, `let TODAY`), а не свойства `window`:
    // их видит только выражение, выполненное в странице.
    const made = await page
      .evaluate(
        `(() => {
          CPS.push({ ...structuredClone(CPS[0]), id: 990001, name: 'ОсОО «Сквозная демо»' });
          const report = REPORTS.find((r) => r.status === 'К сдаче' && !r.superseded);
          report.status = 'Сдан';
          report.subDate = TODAY;
          dbSoon();
          return true;
        })()`,
      )
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

test.describe('Этап 3: лендинг v78 — заставка, линия Бернулли, герб, «Подробнее» (прототип v78)', () => {
  test('(проверка прототипа v78) заставка при каждом открытии лендинга: знак и BuhUchet.kg, любая клавиша — сразу к странице, знак встаёт в шапку; при новом открытии — снова, по «Войти» — страница входа без неё', async ({
    page,
  }) => {
    await withIntro(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const intro = page.locator('.lp-intro');
    await expect(intro).toBeVisible();
    await expect(intro).toContainText('BuhUchet.kg');
    await page.keyboard.press('Shift');
    await expect(intro).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(HERO);
    await expect(page.locator('.lp-logo .logo')).toHaveCSS('opacity', '1');
    // Линия Бернулли с петлёй у заголовка каждого из 9 блоков.
    await expect(page.locator('#lp-path .lp-knots circle')).toHaveCount(9);

    // Новое открытие — снова заставка; без нажатия она уходит сама.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(intro).toBeVisible();
    await expect(intro).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator('.lp-logo .logo')).toHaveCSS('opacity', '1');

    // «Войти» — страница входа сразу, без заставки.
    await page.locator('a[href="/login"]:visible').first().click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible();
    // Заставка сама ушла бы через 3,5 с — здесь её не должно быть сразу.
    await expect(intro).toBeHidden({ timeout: 1_000 });
  });

  test('(проверка прототипа v78) заставка при входе: на странице входа и после входа по логину; знак улетает в меню слева, на телефоне меню скрыто — вверх', async ({
    page,
  }, testInfo) => {
    await withIntro(page);
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    const intro = page.locator('.lp-intro');
    await expect(intro).toBeVisible();
    await page.keyboard.press('Shift');
    await expect(intro).toHaveCount(0, { timeout: 10_000 });

    await signInByForm(page, 'erkin', DEMO_PASSWORD);
    await expect(page).toHaveURL(/\/app\//);
    await expect(intro).toBeVisible();
    await expect(intro).toContainText('BuhUchet.kg');
    await expect(intro).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator('.bu-intro-tg')).toHaveCount(0);
    if (!testInfo.project.name.startsWith('mobile')) {
      // Знак в левой панели — снова на месте.
      await expect(page.locator('[data-brand-mark]:visible').first()).toHaveCSS('opacity', '1');
    }
  });

  test('(проверка прототипа v78) у каждого блока «Подробнее»: подробности раскрываются и сворачиваются; символ герба и плитка «Возможностей» раскрываются нажатием; весы в углу — наверх', async ({
    page,
  }) => {
    await page.goto('/');
    // Блок, подпись кнопки, текст из подробностей.
    const more: [string, string, string][] = [
      ['emb', 'Подробнее', 'Девиз на кольце герба: «Наука, совесть, независимость»'],
      ['who', 'Подробнее', 'Ведёте десятки и сотни клиентов'],
      ['features', 'Подробнее', 'Отчёты, квитанции и договоры в карточках клиентов'],
      ['shots', 'Подробнее', 'Все отчёты клиентов со сроками, статусами и суммами'],
      ['start', 'Подробнее', 'Мы свяжемся, покажем программу и создадим вашу организацию'],
      ['security', 'Подробнее', 'Данные каждой фирмы отделены'],
      ['faq', 'Подробнее', 'Что видит мой клиент?'],
      ['lead', 'Контакты', '+996 500 888 268'],
    ];
    for (const [id, label, text] of more) {
      const block = page.locator(`#lp-${id}`);
      const detail = block.getByText(text).first();
      await expect(detail).toBeHidden();
      // Подпись кнопки меняется на «Свернуть» — ищем саму кнопку, а не подпись.
      const button = block.locator('.lp-more');
      await expect(button).toHaveText(label);
      await button.click();
      await expect(detail).toBeVisible();
      await expect(button).toHaveAttribute('aria-expanded', 'true');
      await expect(button).toHaveText('Свернуть');
    }
    // «Что меняется»: «Подробнее» ставит «Было» и «Стало» рядом — подсказка о переворачивании не нужна.
    const change = page.locator('#lp-change');
    await expect(change.getByText('Нажмите на карточку — увидите, как было')).toBeVisible();
    await change.getByRole('button', { name: 'Подробнее', exact: true }).click();
    await expect(change.getByText('Нажмите на карточку — увидите, как было')).toBeHidden();
    await change.getByRole('button', { name: 'Свернуть', exact: true }).click();
    await expect(change.getByText('Нажмите на карточку — увидите, как было')).toBeVisible();

    // Герб: символ подсвечивается и показывает, что он значит в программе; нажатие на солнце в гербе.
    const emb = page.locator('#lp-emb');
    await emb.getByRole('button', { name: 'Свернуть', exact: true }).click();
    const scales = emb.getByRole('button', { name: 'Весы: баланс' });
    await expect(emb.getByText('Деньги клиентов на налоги сходятся')).toBeHidden();
    await scales.click();
    await expect(scales).toHaveAttribute('aria-pressed', 'true');
    await expect(emb.getByText('Деньги клиентов на налоги сходятся')).toBeVisible();
    const seal = emb.getByRole('img', { name: /^Герб бухгалтеров/ });
    const size = await seal.evaluate((e) => {
      e.scrollIntoView({ block: 'center' });
      return e.clientWidth;
    });
    await seal.click({ position: { x: size * 0.5, y: size * 0.26 } });
    await expect(emb.getByRole('button', { name: 'Солнце: учёт освещает дела' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(scales).toHaveAttribute('aria-pressed', 'false');

    // «Возможности»: плитка раскрывается нажатием.
    // Раскрытая плитка читается вместе с описанием — имя начинается с «Файлы».
    const tile = page.locator('#lp-features').getByRole('button', { name: /^Файлы/ });
    await page.locator('#lp-features').getByRole('button', { name: 'Свернуть' }).click();
    await expect(page.getByText('Отчёты, квитанции и договоры в карточках клиентов')).toBeHidden();
    await tile.click();
    await expect(tile).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('Отчёты, квитанции и договоры в карточках клиентов')).toBeVisible();

    // Весы-значок в углу: после первого экрана; нажатие — в начало страницы.
    await page.locator('#lp-faq h2').scrollIntoViewIfNeeded();
    const top = page.getByRole('button', { name: 'Наверх', exact: true });
    await expect(top).toBeVisible();
    await top.click();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await expect(top).toBeHidden();
    // Фокус — на логотипе в шапке: скрытые весы с фокусом останавливали прокрутку на полпути.
    await expect(page.locator('.lp-logo')).toBeFocused();
  });

  test.describe('«уменьшить движение»', () => {
    test.use({ reducedMotion: 'reduce' });

    test('(проверка прототипа v78) при «уменьшить движение» нет заставки и анимаций: линия Бернулли нарисована целиком, всё видно сразу', async ({
      page,
    }) => {
      await withIntro(page);
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('.lp-intro')).toBeHidden();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(HERO);
      await expect(page.locator('.lp-intro')).toHaveCount(0);
      await expect(page.locator('.land')).not.toHaveClass(/lp-anim/);
      await expect(page.locator('#lp-path .lp-knots circle.on')).toHaveCount(9);
      await expect(page.locator('#lp-who h2')).toHaveCSS('opacity', '1');
      await expect(page.locator('#lp-change .lp-fc').first()).toHaveClass(/now/);
    });
  });
});
