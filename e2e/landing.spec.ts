import { expect, test, type Page } from '@playwright/test';
import { DEMO_PASSWORD, uniqueInn } from './helpers';
import { IP_CERT, leadDocsDraft, leadDocsFields } from './lead-docs';

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
  // «Войти» лендинга — обычная ссылка: страница входа грузится заново, поля видны раньше, чем React их
  // подхватил; «Войти» доступна только после этого (docs/typical-mistakes.md № 41).
  await expect(page.getByRole('button', { name: 'Войти' })).toBeEnabled();
  await page.getByLabel('Логин').fill(login);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await Promise.all([
    page.waitForResponse('**/api/auth/login'),
    page.getByRole('button', { name: 'Войти' }).click(),
  ]);
}

const leadForm = (page: Page) => page.locator('#lp-lead form');

/** Первое поле формы заявки (прототип v114): кнопка «ОсОО» поля «Форма организации». */
const firstLeadField = (page: Page) =>
  leadForm(page)
    .getByRole('group', { name: 'Форма организации' })
    .getByRole('button', { name: 'ОсОО' });

/**
 * Заставки с логотипом (прототип v78) в браузере под управлением тестов нет (`navigator.webdriver`,
 * docs/deviations.md п. О-52): сквозные тесты открывают сотни страниц. Проверки заставки открывают
 * страницы как обычный браузер.
 */
const withIntro = (page: Page) =>
  page.addInitScript(() =>
    Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }),
  );

/**
 * Заявка ИП (доработки 14.11.2026, блок 1): форма, свидетельство ГНС (из него подставляются название,
 * ИНН и адрес), затем поля заявителя.
 */
async function fillLead(page: Page, phone: string) {
  const form = leadForm(page);
  await form
    .getByRole('group', { name: 'Форма организации' })
    .getByRole('button', { name: 'ИП' })
    .click();
  await form.getByLabel('Свидетельство ГНС').setInputFiles(IP_CERT);
  await expect(
    form.getByText('Данные из документов подставлены в поля — проверьте и поправьте, если нужно'),
  ).toBeVisible({ timeout: 30_000 });
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
    await expect(form.getByRole('group', { name: 'Форма организации' })).toBeAttached();
    for (const label of [
      'Название фирмы',
      'ИНН',
      'Имя и фамилия',
      'Телефон',
      'Сколько клиентов ведёте',
    ]) {
      await expect(form.getByLabel(label).first()).toBeAttached();
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
    // Прокрутка к форме и курсор в первом поле («Форма организации», прототип v114); над формой кнопки нет.
    await expect(firstLeadField(page)).toBeFocused();
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

  test('(проверка задачи #165, доработки 14.11.2026, блок 1) форма заявки: пустая — ошибки под полями, курсор в «Форме организации», без галочки — «Нужно согласие…»; нет связи — «Не удалось отправить…», введённое не пропадает; с галочкой — «Заявка отправлена. Подключите Telegram…» и кнопка на бота', async ({
    page,
  }) => {
    await ownAddress(page);
    await page.goto('/#lead');
    const form = leadForm(page);
    await expect(firstLeadField(page)).toBeFocused();
    await form.getByRole('button', { name: 'Отправить заявку' }).click();
    await expect(firstLeadField(page)).toBeFocused();
    for (const text of [
      'Выберите форму организации',
      'ИНН — 14 цифр',
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
    // У сайта есть бот (TELEGRAM_BOT_USERNAME в .env.example) — как в прототипе v114 (`ldOkHtml`):
    // «Заявка отправлена. Подключите Telegram…», кнопка на бота и срок ссылки, без «Спасибо! … по номеру».
    const sent = page.locator('#lp-lead').getByRole('status');
    await expect(sent).toContainText(
      'Заявка отправлена. Подключите Telegram, чтобы узнать решение',
    );
    await expect(sent).not.toContainText('Спасибо!');
    // Экран «Заявка отправлена» — на виду, а не выше экрана (прототип v133, оставлено в v143): форма была
    // длинной, после отправки страница встаёт к началу блока заявки.
    await expect(sent).toBeInViewport();
    const bot = sent.getByRole('link', { name: 'Подключить Telegram' });
    await expect(bot).toHaveAttribute('href', /^https:\/\/t\.me\/[A-Za-z0-9_]+\?start=l_/);
    await expect(bot).toHaveAttribute('target', '_blank');
    await expect(sent).toContainText('Ссылка на бота действует до');
  });

  test('(проверка задачи #165) четвёртая заявка за час с одного адреса: «Отправляем…», затем «Слишком много заявок…» с телефоном для связи; введённое не пропадает', async ({
    page,
    baseURL,
  }) => {
    const address = await ownAddress(page);
    const origin = new URL(baseURL!).origin;
    // Три заявки с этого адреса уже пришли (как с другой вкладки), у каждой — свои документы.
    for (let i = 0; i < 3; i += 1) {
      const draft = await leadDocsDraft(page.request, origin, address);
      const res = await page.request.post('/api/leads', {
        headers: { origin, 'x-forwarded-for': address },
        data: {
          ...leadDocsFields(draft, uniqueInn()),
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
    await expect(firstLeadField(page)).toBeFocused();
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

  test('(доработки 20.11.2026, цена; прототип v149) лендинг, «Вопросы», «Сколько стоит?»: 100 сом в месяц за клиента, пакетами по 10, скидка до 20 %, первый месяц за полцены', async ({
    page,
  }) => {
    await page.goto('/');
    const faq = page.locator('#lp-faq');
    const answer = faq.getByText(
      '100 сом в месяц за одного вашего клиента, пакетами по 10. При оплате на 3–12 месяцев — скидка до 20 %, первый месяц за полцены.',
    );
    await expect(answer).toBeHidden();
    await faq.getByText('Сколько стоит?', { exact: true }).click();
    await expect(answer).toBeVisible();
    await expect(faq.getByText('Стоимость зависит от числа клиентов')).toHaveCount(0);
  });
});

test.describe('Этап 3: лендинг v78 — заставка, герб, «Подробнее»; спираль на фоне и карточки функций (прототип v78, v144–v146)', () => {
  test('(проверка прототипа v78 и v143) заставка — один раз за сеанс: знак и BuhUchet.kg, любая клавиша — сразу к странице, знак встаёт в шапку, спираль выходит на фон; при новом открытии в той же вкладке и по «Войти» заставки нет, в новой вкладке — снова', async ({
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
    // Спираль логотипа вышла из знака на фон (прототип v145): отметки «ещё не видна» больше нет.
    await expect(page.locator('#lp-bgsp')).not.toHaveClass(/(^| )pre( |$)/);
    await expect(page.locator('#lp-path')).toHaveCount(0);

    // Новое открытие в той же вкладке — без заставки: она одна за сеанс (прототип v133, оставлено в v143).
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(HERO);
    await expect(intro).toBeHidden({ timeout: 1_000 });
    await expect(page.locator('.lp-logo .logo')).toHaveCSS('opacity', '1');

    // «Войти» — страница входа сразу, без заставки.
    await page.locator('a[href="/login"]:visible').first().click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible();
    // Заставка сама ушла бы через 3,5 с — здесь её не должно быть сразу.
    await expect(intro).toBeHidden({ timeout: 1_000 });

    // Новая вкладка — новый сеанс: заставка снова, без нажатия она уходит сама.
    const other = await page.context().newPage();
    try {
      await withIntro(other);
      await other.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(other.locator('.lp-intro')).toBeVisible();
      await expect(other.locator('.lp-intro')).toHaveCount(0, { timeout: 10_000 });
      await expect(other.locator('.lp-logo .logo')).toHaveCSS('opacity', '1');
    } finally {
      await other.close();
    }
  });

  test('(проверка прототипа v78 и v143) заставка при входе: на странице входа; после входа по логину в той же вкладке её нет — она одна за сеанс; открытие программы в новой вкладке — снова, знак улетает в меню слева, на телефоне меню скрыто — вверх', async ({
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
    await expect(page.locator('[data-grid], [data-home-hello]').first()).toBeVisible();
    await expect(intro).toBeHidden({ timeout: 1_000 });

    // Программа в новой вкладке (вход уже есть) — новый сеанс: заставка, знак улетает в меню слева.
    const other = await page.context().newPage();
    try {
      await withIntro(other);
      await other.goto('/app/home', { waitUntil: 'domcontentloaded' });
      const again = other.locator('.lp-intro');
      await expect(again).toBeVisible();
      await expect(again).toContainText('BuhUchet.kg');
      await expect(again).toHaveCount(0, { timeout: 10_000 });
      await expect(other.locator('.bu-intro-tg')).toHaveCount(0);
      if (!testInfo.project.name.startsWith('mobile')) {
        // Знак в левой панели — снова на месте.
        await expect(other.locator('[data-brand-mark]:visible').first()).toHaveCSS('opacity', '1');
      }
    } finally {
      await other.close();
    }
  });

  test('(проверка прототипа v78 и v144) у каждого блока «Подробнее»: подробности раскрываются и сворачиваются; у «Возможностей» — «Все функции — ещё 8»; символ герба раскрывается нажатием; весы в углу — наверх', async ({
    page,
  }) => {
    // Блоки появляются плавнее (прототип v91): нажатие ждёт, пока кнопка встанет на место, а блоков 8.
    test.slow();
    await page.goto('/');
    // Блок, подпись кнопки, текст из подробностей.
    const more: [string, string, string][] = [
      ['emb', 'Подробнее', 'Девиз на кольце герба: «Наука, совесть, независимость»'],
      ['who', 'Подробнее', 'Ведёте десятки и сотни клиентов'],
      ['features', 'Все функции — ещё 8', 'Отчёты, квитанции и договоры в карточках клиентов'],
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

    // «Возможности»: «Свернуть» прячет восемь функций, шесть главных с описаниями остаются на виду, а
    // кнопка снова зовёт «Все функции».
    const features = page.locator('#lp-features');
    await features.getByRole('button', { name: 'Свернуть' }).click();
    await expect(
      features.getByText('Отчёты, квитанции и договоры в карточках клиентов'),
    ).toBeHidden();
    await expect(
      features.getByText('Сроки, чеки клиентов и новые задачи — в программе и в Telegram'),
    ).toBeVisible();
    await expect(features.locator('.lp-more')).toHaveText('Все функции — ещё 8');

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

  test('(проверка прототипа v91 и v144–v146) на фоне — спираль логотипа, она поворачивается при прокрутке; в гербе — спираль; у каждой из 14 функций своя карточка со значком и примерами, сверху шесть главных; в подвале — версия платформы без даты', async ({
    page,
  }) => {
    await page.goto('/');
    // На фоне — та же спираль, что в знаке шапки (прототип v145): сквозной линии и спирали первого экрана
    // больше нет. Спираль закреплена на экране, под содержимым блоков, и нажатий не перехватывает.
    const spiral = page.locator('#lp-bgsp');
    await expect(spiral).toHaveCount(1);
    await expect(page.locator('#lp-path, .lp-hb-sp')).toHaveCount(0);
    await expect(spiral).not.toHaveClass(/(^| )pre( |$)/);
    await expect(spiral).toHaveCSS('pointer-events', 'none');
    const same = await page.evaluate(() => {
      const d = (sel: string) => document.querySelector(sel)?.getAttribute('d');
      return d('#lp-bgsp .lg-sp') === d('.lp-logo .logo .lg-sp') && !!d('#lp-bgsp .lg-sp');
    });
    expect(same).toBe(true);
    // Спираль шире половины экрана и не вызывает прокрутку вбок. После заставки она две секунды растёт
    // из знака шапки — размер меряется, когда рост закончился.
    await expect(spiral).not.toHaveClass(/(^| )(grow0|growing)( |$)/);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.querySelector('.lp-bgsp-g')!.getBoundingClientRect().width /
            document.documentElement.clientWidth,
        ),
      )
      .toBeGreaterThan(0.5);
    const fit = await page.evaluate(() => ({
      spiral: document.querySelector('.lp-bgsp-g')!.getBoundingClientRect().width,
      screen: document.documentElement.clientWidth,
      page: document.documentElement.scrollWidth,
    }));
    expect(fit.spiral).toBeGreaterThan(fit.screen * 0.5);
    expect(fit.page).toBeLessThanOrEqual(fit.screen);
    // При прокрутке спираль поворачивается по часовой стрелке и чуть сжимается.
    const turn = () =>
      page
        .locator('.lp-bgsp-s')
        .evaluate((e) =>
          Number(/rotate\(([-\d.]+)deg\)/.exec((e as SVGElement).style.transform)?.[1] ?? 0),
        );
    expect(await turn()).toBe(0);
    await page.locator('#lp-who h2').scrollIntoViewIfNeeded();
    await expect.poll(turn).toBeGreaterThan(5);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(turn).toBe(0);

    // Герб: под весами — спираль Бернулли, у всех трёх символов в списке — значки.
    const emb = page.locator('#lp-emb');
    await expect(emb.locator('.e-curve .e-inf')).toHaveCount(1);
    await expect(emb.locator('.lp-emb-ic svg')).toHaveCount(3);
    // Это именно спираль, а не прежняя «∞»: кривая начинается у своего центра, раскручивается вправо и
    // не замыкается — и в гербе, и в значке строки «Кривая Бернулли».
    const ends = (path: SVGPathElement) => {
      const a = path.getPointAtLength(0);
      const b = path.getPointAtLength(path.getTotalLength());
      return {
        ax: a.x,
        ay: a.y,
        bx: b.x,
        by: b.y,
        closed: /z/i.test(path.getAttribute('d') ?? ''),
      };
    };
    const curve = await emb.locator('.e-curve .e-inf').evaluate(ends);
    expect(curve.closed).toBe(false);
    expect(Math.hypot(curve.ax - 146, curve.ay - 235)).toBeLessThan(5);
    expect(curve.bx - 146).toBeGreaterThan(20);
    const mark = await emb
      .locator('.lp-emb-l li')
      .filter({ hasText: 'Кривая Бернулли' })
      .locator('.lp-emb-ic svg path')
      .evaluate(ends);
    expect(mark.closed).toBe(false);
    expect(Math.hypot(mark.ax - 11, mark.ay - 12.6)).toBeLessThan(2.5);
    expect(mark.bx - 11).toBeGreaterThan(5);

    // «Возможности» (прототип v144): 14 карточек, у каждой свой значок и до трёх примеров; сверху шесть
    // главных, описание видно сразу, остальные восемь — по «Все функции».
    const features = page.locator('#lp-features');
    const icons = features.locator('.lp-fcd .lp-fi');
    await expect(icons).toHaveCount(14);
    const kinds = await icons.evaluateAll((list) => list.map((x) => x.classList[1]));
    expect(new Set(kinds).size).toBe(14);
    const top = features.locator('.lp-fgrid:not(.lp-frest) .lp-fcd');
    await expect(top.locator('h3')).toHaveText([
      'Отчёты создаются сами',
      'Сроки по закону',
      'Уведомления',
      'Напоминания в Telegram',
      'Деньги на налоги',
      'Страница для клиента',
    ]);
    await expect(features.locator('.lp-frest .lp-fcd')).toHaveCount(8);
    const bell = top.filter({ hasText: 'Уведомления' });
    await bell.scrollIntoViewIfNeeded();
    await expect(bell.locator('p')).toBeVisible();
    await expect(bell.locator('.lp-fch i')).toHaveText([
      'Через 3 дня срок',
      'Клиент прислал чек',
      'Новая задача',
    ]);
    // Карточка не кнопка: раскрывать нечего, описание на виду.
    await expect(features.getByRole('button', { name: /^Уведомления/ })).toHaveCount(0);
    await expect(features.locator('.lp-frest .lp-fcd').first()).toBeHidden();
    await features.locator('.lp-more').click();
    await expect(features.locator('.lp-frest .lp-fcd h3').first()).toBeVisible();
    await expect(features.locator('.lp-frest .lp-fcd h3')).toHaveText([
      'Подбор налогов',
      'Задачи',
      'Плата за обслуживание',
      'Файлы',
      'Просмотр файлов',
      'Показатели клиентов',
      'Роли и права',
      'Обучение внутри',
    ]);

    // Подвал: версия платформы — номером, без даты.
    const foot = page.locator('.lp-foot');
    await expect(foot.locator('.lp-ver')).toHaveText(/^Версия \d+$/);
    await expect(foot).not.toContainText(/\d{2}\.\d{2}\.\d{4}/);
  });

  test.describe('«уменьшить движение»', () => {
    test.use({ reducedMotion: 'reduce' });

    test('(проверка прототипа v78 и v146) при «уменьшить движение» нет заставки и анимаций: спираль сразу стоит на фоне и не поворачивается, всё видно сразу', async ({
      page,
    }) => {
      await withIntro(page);
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('.lp-intro')).toBeHidden();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(HERO);
      await expect(page.locator('.lp-intro')).toHaveCount(0);
      await expect(page.locator('.land')).not.toHaveClass(/lp-anim/);
      // Спираль сразу на фоне: не растёт из знака и при прокрутке не поворачивается.
      const spiral = page.locator('#lp-bgsp');
      await expect(spiral).not.toHaveClass(/(^| )(pre|grow0|growing|over)( |$)/);
      await page.locator('#lp-who h2').scrollIntoViewIfNeeded();
      await expect(page.locator('.lp-bgsp-s')).toHaveCSS(
        'transform',
        /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/,
      );
      await expect(page.locator('#lp-who h2')).toHaveCSS('opacity', '1');
      await expect(page.locator('#lp-change .lp-fc').first()).toHaveClass(/now/);
      // Карточки «Возможностей» не оживают.
      await page.locator('#lp-features h2').scrollIntoViewIfNeeded();
      await expect(page.locator('#lp-features .lp-fcd').first()).toBeVisible();
      await expect(page.locator('#lp-features .lp-fcd.fx')).toHaveCount(0);
    });
  });
});
