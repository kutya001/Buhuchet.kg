import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { linkTelegram, newOrgOwner, signIn, uniqueChat, uniqueLogin } from './helpers';
import { connectAllTypes, orgWithTypes } from './orgs';
import { find, reportsOf } from './reports';

// Форма контрагента (задача 2.09, #65): «+ Добавить» → «Контрагент» в модуле «Контрагенты» (списка
// ещё нет — задача 2.10, вместо него заглушка), разделы и шаги формы, сверка с ГКЭД и вопросы перед
// сохранением, УГНС и статусы, «Изменить» (окно открывается со страницы образцов, пока нет карточки —
// задача 2.11). Новые контрагенты — в своей организации теста со всеми видами отчётов: демо не меняется.

/** Правильный ИНН: 14 цифр, первая — 0; свой у ПК и телефона. */
const freshInn = () =>
  `09${Date.now().toString().slice(-8)}${String(Math.floor(Math.random() * 10_000)).padStart(4, '0')}`;

/** «+ Добавить» → «Контрагент»: окно «Новый контрагент». */
async function openForm(page: Page): Promise<Locator> {
  await page.goto('/app/cps/all');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page
    .getByRole('menu', { name: 'Добавить' })
    .getByRole('menuitem', { name: 'Контрагент' })
    .click();
  const form = page.getByRole('dialog', { name: 'Новый контрагент' });
  // Форма ждёт четыре справочника (сотрудники, каталог, значения, коды телефонов): после перехода
  // на страницу они грузятся заново — ждать дольше обычного.
  await expect(form.locator('[data-cf]')).toBeVisible({ timeout: 15_000 });
  return form;
}

/** Раздел формы: на телефоне — шаг (переход проверяет предыдущие), на ПК все разделы на экране. */
async function toSection(form: Locator, n: 1 | 2 | 3, isMobile: boolean) {
  if (!isMobile) return;
  await form.locator(`[data-cf-step="${n}"]`).click();
  await expect(form.locator('[data-cf]')).toHaveAttribute('data-step', String(n));
}

/** Основной или дополнительный ГКЭД через окно поиска. */
async function pickGked(page: Page, form: Locator, code: string, extra = false) {
  await form.locator(extra ? '[data-gked-add]' : '[data-gked-main]').click();
  const dialog = page.getByRole('dialog', {
    name: extra ? 'Дополнительный вид деятельности (ГКЭД)' : 'Основной вид деятельности (ГКЭД)',
  });
  await dialog.locator('[data-gked-search]').fill(code);
  await dialog.locator(`[data-gked="${code}"]`).click();
  await expect(dialog).toBeHidden();
}

type Main = { name?: string; inn?: string; gked: string; form?: string };

/** «Реквизиты»: название, ИНН, телефон, ГКЭД и форма собственности. */
async function fillMain(page: Page, form: Locator, m: Main) {
  const inn = m.inn ?? freshInn();
  await form.locator('[data-cp-field="name"]').fill(m.name ?? `Форма ${inn}`);
  await form.locator('[data-cp-field="inn"]').fill(inn);
  await form.getByLabel('Телефон (звонок и WhatsApp)').fill('505890076');
  await pickGked(page, form, m.gked);
  if (m.form) await form.locator('[data-cp-field="form"]').selectOption(m.form);
  return inn;
}

const regimeField = (form: Locator) => form.locator('[data-cp-field="regime"]');
const gkedWarn = (form: Locator) => form.locator('[data-gked-warn]');
/**
 * «Сохранить контрагента» из раздела «Отчёты и обслуживание»: ответственный (у владельца с областью
 * «Все» по умолчанию не выбран) и стоимость обслуживания, если поле есть и пусто.
 */
async function save(form: Locator, isMobile: boolean) {
  await toSection(form, 3, isMobile);
  const responsible = form.locator('[data-cp-field="responsible"]');
  if (!(await responsible.inputValue())) await responsible.selectOption({ index: 1 });
  const fee = form.locator('[data-cp-field="fee"]');
  if ((await fee.count()) && !(await fee.inputValue())) await fee.fill('5000');
  await form.locator('[data-cp-save]').click();
}

/** «Сохранить контрагента»: окно закрылось, уведомление «Контрагент добавлен…». */
async function expectCreated(page: Page, form: Locator) {
  await expect(form).toBeHidden();
  await expect(page.getByText(/^Контрагент добавлен, отчётов создано: \d+$/)).toBeVisible();
}

type Card = {
  id: string;
  version: number;
  regime: { code: string } | null;
  benefits: { code: string; byOffice: boolean }[];
  gkedConfirmation: { ask: string; by: string } | null;
};

async function contractorByInn(api: APIRequestContext, inn: string): Promise<Card> {
  const filters = encodeURIComponent(JSON.stringify({ inn: { type: 'text', q: inn } }));
  const list = (await (await api.get(`/api/contractors?size=all&filters=${filters}`)).json()) as {
    items: { id: string }[];
  };
  expect(list.items).toHaveLength(1);
  return (await (await api.get(`/api/contractors/${list.items[0]!.id}`)).json()) as Card;
}

test.describe('Этап 2: форма контрагента', () => {
  test('(п. 13) бухгалтер без права создавать контрагентов не видит шага «Добавить первого контрагента», пройдя остальные шаги — «Эксперт»; владелец видит его уровень в «Сотрудниках»; у владельца «Перейти» открывает «Новый контрагент» и созданный контрагент засчитывает шаг', async ({
    page,
    playwright,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await newOrgOwner(page.request, origin);
    const api = page.request;

    // Владелец: роль «Бухгалтер» без права «Создавать контрагентов» и сотрудник с ней.
    const roles = (await (await api.get('/api/roles?size=all')).json()) as {
      items: { id: string; templateCode: string | null }[];
    };
    const accId = roles.items.find((r) => r.templateCode === 'acc')!.id;
    const acc = (await (await api.get(`/api/roles/${accId}`)).json()) as {
      permissions: string[];
      version: number;
    };
    const updated = await api.patch(`/api/roles/${accId}`, {
      headers: { origin },
      data: { version: acc.version, permissions: acc.permissions.filter((p) => p !== 'createCp') },
    });
    expect(updated.status(), await updated.text()).toBe(200);
    // Уроки «Файлового менеджера» (задача 2.29) проверяет её тест: здесь «Файлы в карточках» выключены.
    const policy = (await (await api.get('/api/org/policy')).json()) as { version: number };
    const filesOff = await api.patch('/api/org/policy', {
      headers: { origin },
      data: { version: policy.version, features: { files: false } },
    });
    expect(filesOff.status(), await filesOff.text()).toBe(200);
    const login = uniqueLogin('e2e-acc');
    const hired = await api.post('/api/staff', {
      headers: { origin },
      data: { fullName: 'Счетова Сквозная Тестовна', login, phone: null, roleId: accId },
    });
    expect(hired.status(), await hired.text()).toBe(201);
    const {
      employee: { id: employeeId },
      temporaryPassword,
    } = (await hired.json()) as { employee: { id: string }; temporaryPassword: string };

    // Бухгалтер: шага «Добавить первого контрагента» в программе нет.
    const acct = await playwright.request.newContext({ baseURL });
    await signIn(acct, origin, login, temporaryPassword);
    const changed = await acct.post('/api/auth/password', {
      headers: { origin },
      data: { currentPassword: temporaryPassword, newPassword: 'Свой-пароль-e2e-2' },
    });
    expect(changed.status(), await changed.text()).toBe(200);
    type Me = {
      progress: { pct: number; level: number; levels: { name: string }[] };
      lessons: { steps: { id: string; done: unknown }[] }[];
    };
    const me = async () => {
      // Шаги «действием» отмечает сверка с историей — её запускает экран «Базы знаний».
      const synced = await acct.post('/api/kb/sync', {
        headers: { origin },
        data: { reason: 'open' },
      });
      expect(synced.status(), await synced.text()).toBe(200);
      return (await (await acct.get('/api/kb/me')).json()) as Me;
    };
    const steps = (await me()).lessons.flatMap((l) => l.steps.map((s) => s.id));
    expect(steps).not.toContain('cp1');
    expect(steps).toEqual(
      expect.arrayContaining(['tg', 'pdicts', 'daymonth', 'tdone', 'search', 'cols']),
    );

    // Остальные свои шаги — тем же, чем их засчитывают экраны: Telegram, просмотр экрана шага,
    // первое использование, своя задача «Выполнена».
    await linkTelegram(acct, origin, uniqueChat());
    for (const id of ['pdicts', 'daymonth']) {
      const look = await acct.post(`/api/kb/steps/${id}/look`, { headers: { origin } });
      expect(look.status(), await look.text()).toBe(200);
    }
    for (const hit of ['search', 'cols', 'grp', 'xls', 'swipe']) {
      const used = await acct.post(`/api/kb/hits/${hit}`, { headers: { origin } });
      expect(used.status(), await used.text()).toBe(200);
    }
    const options = (await (await api.get('/api/tasks/form-options')).json()) as {
      categories: { code: string }[];
    };
    const task = await api.post('/api/tasks', {
      headers: { origin },
      data: {
        title: 'Сверить акты',
        description: '',
        categoryCode: options.categories[0]!.code,
        contractorId: null,
        executorEmployeeId: employeeId,
        term: 'day',
        dueDate: '2099-12-30',
        needFile: false,
        confirm: false,
      },
    });
    expect(task.status(), await task.text()).toBe(201);
    const { id: taskId } = (await task.json()) as { id: string };
    const done = await acct.post(`/api/tasks/${taskId}/done`, { headers: { origin }, data: {} });
    expect(done.status(), await done.text()).toBe(200);
    const finished = await me();
    expect(finished.lessons.flatMap((l) => l.steps).filter((s) => !s.done)).toEqual([]);
    expect(finished.progress.pct).toBe(100);
    expect(finished.progress.levels[finished.progress.level]!.name).toBe('Эксперт');
    await acct.dispose();

    // Владелец видит уровень бухгалтера в «Сотрудниках».
    await page.goto('/app/staff/list');
    const row = page.locator(`[data-grid] [data-id="${employeeId}"]`);
    await expect(row).toContainText('Эксперт');

    // У владельца шаг есть: «Перейти» открывает «Новый контрагент», созданный контрагент засчитывает
    // шаг действием.
    await connectAllTypes(api, origin);
    await page.goto('/app/kb/lessons');
    const step = page.locator('[data-kb-step="cp1"]');
    await expect(step).toHaveAttribute('data-kb-state', 'open');
    await step.getByRole('button', { name: 'Перейти' }).click();
    await expect(page).toHaveURL(/\/app\/cps\/all/);
    const form = page.getByRole('dialog', { name: 'Новый контрагент' });
    await expect(form.locator('[data-cf]')).toBeVisible();
    await fillMain(page, form, { gked: '47.11.0' });
    await toSection(form, 2, isMobile);
    await regimeField(form).selectOption('РЕЖ-01');
    await save(form, isMobile);
    await expect(form).toBeHidden();
    await expect(
      page.getByRole('dialog', {
        name: 'Готово: шаг «Добавить первого контрагента или загрузить из Excel» выполнен',
      }),
    ).toBeVisible();
  });

  test('(п. 17) ГКЭД 47.11.0 и «Единый налог»: подставлена ставка торговли; статус «Резидент ПВТ» — предупреждение о несоответствии видов деятельности и вопрос при сохранении', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    await orgWithTypes(page.request, new URL(baseURL!).origin);
    const form = await openForm(page);
    await fillMain(page, form, { gked: '47.11.0' });
    await toSection(form, 2, isMobile);
    await expect(regimeField(form)).toHaveValue('РЕЖ-03');
    await expect(form.locator('[data-gked-rate]')).toContainText(
      'Ставка единого налога по основному ГКЭД 47.11.0: 0,5 % (Торговля',
    );
    await toSection(form, 3, isMobile);
    const en = form.locator('[data-en-rows="enq"]');
    await expect(en).toContainText('Торговля');

    await toSection(form, 2, isMobile);
    await form.locator('[data-cp-benefits-open]').click();
    const benefits = page.getByRole('dialog', { name: 'Льготы и особые статусы' });
    await benefits.getByRole('button', { name: 'Все', exact: true }).click();
    await benefits
      .locator('[data-benefit-row]')
      .filter({ hasText: 'Резидент ПВТ' })
      .getByRole('checkbox', { name: 'Резидент ПВТ', exact: true })
      .check();
    await benefits.getByRole('button', { name: 'Применить' }).click();
    await expect(gkedWarn(form)).toContainText(
      'Виды деятельности контрагента не соответствуют статусу «Резидент ПВТ»',
    );

    await save(form, isMobile);
    const ask = page.getByRole('dialog', { name: 'Сохранить с несоответствием?' });
    await expect(ask).toContainText('Резидент ПВТ');
    await ask.getByRole('button', { name: 'Сохранить' }).click();
    await expectCreated(page, form);
  });

  test('(п. 18) ГКЭД 64.19.1: «Единый налог» не сохраняется — ошибка у режима со ссылкой на ст. 419; 64.19.1 дополнительным — сохраняется, предупреждение остаётся', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    await orgWithTypes(page.request, new URL(baseURL!).origin);
    const form = await openForm(page);
    await fillMain(page, form, { gked: '64.19.1' });
    await expect(gkedWarn(form)).toContainText('ст. 419');
    // На ПК — «Сохранить контрагента», на телефоне дальше «Режима и статусов» не пускает: ошибка у
    // поля режима, форма остаётся на шаге 2.
    if (isMobile) await form.locator('[data-cf-step="3"]').click();
    else await save(form, false);
    const regime = form.getByRole('combobox', { name: 'Режим налогообложения' });
    if (isMobile) await expect(form.locator('[data-cf]')).toHaveAttribute('data-step', '2');
    await expect(regime).toBeVisible();
    await expect(regime).toHaveAccessibleDescription(/ст\. 419/);
    await expect(form).toBeVisible();

    await toSection(form, 1, isMobile);
    await pickGked(page, form, '47.11.0');
    await pickGked(page, form, '64.19.1', true);
    await toSection(form, 2, isMobile);
    await expect(regime).not.toHaveAccessibleDescription(/ст\. 419/);
    await expect(gkedWarn(form)).toContainText('64.19.1');
    await save(form, isMobile);
    await expectCreated(page, form);
  });

  test('(п. 29) на телефоне форма идёт шагами «Реквизиты», «Режим и статусы», «Отчёты и обслуживание», «Далее» без ИНН не пускает дальше, описание отчёта в окне подбора — под строкой; на ПК разделы на одном экране с отметками', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    await orgWithTypes(page.request, new URL(baseURL!).origin);
    const form = await openForm(page);
    const toc = form.locator('[data-cf-toc]');
    await expect(toc.getByRole('tab')).toHaveText([
      /Реквизиты/,
      /Режим и статусы/,
      /Отчёты и обслуживание/,
    ]);
    await expect(form.locator('[data-cf-mark="1"]')).toHaveText('осталось: 4');
    const inn = form.locator('[data-cp-field="inn"]');

    if (isMobile) {
      await expect(form.locator('[data-cf]')).toHaveAttribute('data-step', '1');
      await expect(form.locator('[data-cf-sec="2"]')).toBeHidden();
      await form.locator('[data-cp-field="name"]').fill('ОсОО «Шаги»');
      await form.getByLabel('Телефон (звонок и WhatsApp)').fill('505890076');
      await pickGked(page, form, '62.01.0');
      await form.locator('[data-cf-next]').click();
      // Без ИНН дальше не пускает: ошибка под полем, тот же шаг.
      await expect(form.locator('[data-cf]')).toHaveAttribute('data-step', '1');
      await expect(inn).toHaveAccessibleDescription('ИНН — ровно 14 цифр');
      await expect(form.locator('[data-cf-mark="1"]')).toHaveText('ошибок: 1');
      await inn.fill(freshInn());
      await form.locator('[data-cf-next]').click();
      await expect(form.locator('[data-cf]')).toHaveAttribute('data-step', '2');
      await expect(form.locator('[data-cf-sec="1"]')).toBeHidden();
      await expect(regimeField(form)).toBeVisible();
      await form.locator('[data-cf-next]').click();
      await expect(form.locator('[data-cf]')).toHaveAttribute('data-step', '3');
      await form.locator('[data-cf-back]').click();
      await expect(form.locator('[data-cf]')).toHaveAttribute('data-step', '2');
      await form.locator('[data-cf-next]').click();

      // Описание отчёта в окне подбора — под строкой.
      await form.locator('[data-cp-pick]').click();
      const pick = page.getByRole('dialog', { name: 'Подбор отчётов' });
      const row = pick.locator('[data-pick-row="enq"]');
      await row.click({ position: { x: 150, y: 12 } });
      await expect(pick.locator('[data-pick-row="enq"] + div')).toContainText('Срок сдачи');
      await expect(pick.locator('[data-pick-side]')).toHaveCount(0);
    } else {
      // На ПК все три раздела видны сразу, отметки — в оглавлении.
      for (const n of [1, 2, 3]) await expect(form.locator(`[data-cf-sec="${n}"]`)).toBeVisible();
      await save(form, isMobile);
      await expect(inn).toHaveAccessibleDescription('ИНН — ровно 14 цифр');
      await expect(form.locator('[data-cf-mark="1"]')).toHaveText('ошибок: 4');
      await expect(form.locator('[data-cf-mark="2"]')).toHaveText('заполнено');
    }
  });

  test('(п. 52) УГНС «Управление по крупным налогоплательщикам ГНС»: статус «Крупный налогоплательщик» отмечен сам «по УГНС»; НДС за октябрь 2026 — сдать до 30.11.2026, оплатить до 25.11.2026', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await orgWithTypes(page.request, origin);
    const form = await openForm(page);
    const inn = await fillMain(page, form, { gked: '46.34.0' });
    await form.locator('[data-cp-field="office"]').selectOption('ugns-large');
    await expect(page.getByText('Отмечен статус «Крупный налогоплательщик» по УГНС')).toBeVisible();
    await toSection(form, 2, isMobile);
    await regimeField(form).selectOption('РЕЖ-01');
    await expect(form.locator('[data-cp-benefits]')).toContainText(
      'Крупный налогоплательщик · отмечен по УГНС',
    );
    await toSection(form, 3, isMobile);
    await expect(form.locator('[data-cp-type="nds"]')).toBeVisible();
    await form.locator('[data-cp-field="start"]').fill('2026-01-01');
    await save(form, isMobile);
    await expectCreated(page, form);

    const card = await contractorByInn(page.request, inn);
    expect(card.benefits).toContainEqual(
      expect.objectContaining({ code: 'ЛЬГ-30', byOffice: true }),
    );
    const nds = find(await reportsOf(page.request, inn), 'nds', '2026-10-01');
    expect(nds).toMatchObject({ dueDate: '2026-11-30', payDue: '2026-11-25' });
  });

  test('(п. 56) ГКЭД 61.10.0 и «Единый налог»: вопрос «Оказывает услуги интернета?», после ответа режим сохраняется с отметкой о подтверждении; 64.19.2 (МФО) — «Проверьте право на режим «Единый налог»» с «Подтверждаю», тариф СПиНО — с предупреждением', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    await orgWithTypes(page.request, new URL(baseURL!).origin);
    let form = await openForm(page);
    const inn = await fillMain(page, form, { gked: '61.10.0' });
    await toSection(form, 3, isMobile);
    await save(form, isMobile);
    const ask = page.getByRole('dialog', { name: 'Оказывает услуги интернета?' });
    await expect(ask).toContainText('61.10.0');
    await ask.getByRole('button', { name: 'Нет, не оказывает' }).click();
    await expectCreated(page, form);
    const card = await contractorByInn(page.request, inn);
    expect(card.regime?.code).toBe('РЕЖ-03');
    expect(card.gkedConfirmation).toMatchObject({ ask: 'Оказывает услуги интернета?' });

    form = await openForm(page);
    await fillMain(page, form, { gked: '64.19.2' });
    await toSection(form, 2, isMobile);
    await form.locator('[data-base]').filter({ hasText: 'Есть наёмные сотрудники' }).click();
    for (const flag of ['cashless', 'registry', 'confirmed']) {
      await form
        .locator(`[data-sf-flag="${flag}"]`)
        .getByRole('button', { name: 'Да', exact: true })
        .click();
    }
    await expect(form.locator('[data-sf-fit]')).toContainText('СПиНО');
    await expect(form.locator('[data-socfund]')).toContainText(
      'Проверьте право на СПиНО по виду деятельности: основной ГКЭД 64.19.2',
    );
    await toSection(form, 3, isMobile);
    await save(form, isMobile);
    const confirm = page.getByRole('dialog', { name: 'Проверьте право на режим «Единый налог»' });
    await expect(confirm).toContainText('64.19.2');
    await confirm.getByRole('button', { name: 'Подтверждаю' }).click();
    await expectCreated(page, form);
  });

  test('(п. 57) «Патент»: ИП с 47.11.0 — без предупреждения, с 47.77.0 — подтверждение; физлицо на патенте (ФС-22) с 74.20.0 — без предупреждения, с 47.11.0 — предупреждение', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    // Четыре формы подряд в одном тесте: времени нужно больше обычного.
    test.slow();
    await orgWithTypes(page.request, new URL(baseURL!).origin);
    const patent = 'Проверьте право на режим «Патент»';
    const choose = async (formCode: string, gked: string) => {
      const form = await openForm(page);
      await fillMain(page, form, { gked, form: formCode });
      await toSection(form, 2, isMobile);
      await regimeField(form).selectOption('РЕЖ-02');
      return form;
    };

    // ИП с 47.11.0: вопроса нет ни при выборе режима, ни при сохранении.
    let form = await choose('ФС-02', '47.11.0');
    await expect(gkedWarn(form)).toHaveCount(0);
    await toSection(form, 3, isMobile);
    await save(form, isMobile);
    await expectCreated(page, form);

    // ИП с 47.77.0 (ювелирные изделия): вопрос сразу при выборе режима.
    form = await choose('ФС-02', '47.77.0');
    const ask = page.getByRole('dialog', { name: patent });
    await expect(ask).toContainText('47.77.0');
    await ask.getByRole('button', { name: 'Подтверждаю' }).click();
    await expect(gkedWarn(form)).toContainText('Патент');

    // Физическое лицо на патенте: 74.20.0 (фотография) — без вопроса, 47.11.0 — с вопросом.
    form = await choose('ФС-22', '74.20.0');
    await expect(gkedWarn(form)).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: patent })).toHaveCount(0);
    await choose('ФС-22', '47.11.0');
    await expect(page.getByRole('dialog', { name: patent })).toContainText('47.11.0');
  });

  test('(проверка задачи #65) «Изменить» у ИП на патенте с ГКЭД 96.02.0 и подтверждением: в окне — кто подтвердил; дополнительный ГКЭД вне перечня или другая форма собственности — снова «нужно подтверждение»; 96.04.0 из перечня — предупреждения нет', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    // Демо-ИП из п. 58 в архиве (как в прототипе): «Изменить» у него нет, пока его не вернут из архива
    // (задача 2.12), а отметку и запись истории показывает карточка (2.11). Поэтому такой же ИП
    // создаётся с подтверждением в своей организации.
    await orgWithTypes(page.request, new URL(baseURL!).origin);
    const form = await openForm(page);
    const name = `ИП Парикмахер ${freshInn().slice(-6)}`;
    await fillMain(page, form, { name, gked: '96.02.0', form: 'ФС-02' });
    await toSection(form, 2, isMobile);
    await regimeField(form).selectOption('РЕЖ-02');
    await page
      .getByRole('dialog', { name: 'Проверьте право на режим «Патент»' })
      .getByRole('button', { name: 'Подтверждаю' })
      .click();
    await save(form, isMobile);
    await expectCreated(page, form);

    await page.goto('/samples');
    const picker = page.locator('[data-sample-contractor]');
    const value = await picker.locator('option', { hasText: name }).getAttribute('value');
    await picker.selectOption(value!);
    await page.locator('[data-sample-edit]').click();
    const edit = page.getByRole('dialog', { name: 'Изменить контрагента' });
    const warn = gkedWarn(edit);
    await expect(warn).toContainText('подтвердил');
    await expect(warn).not.toContainText('нужно подтверждение');

    // Дополнительный ГКЭД тоже вне перечня — подтверждение нужно снова.
    await pickGked(page, edit, '64.19.1', true);
    await expect(warn).toContainText('нужно подтверждение');
    await edit.getByRole('button', { name: 'Убрать 64.19.1' }).click();
    await expect(warn).toContainText('подтвердил');

    // Другая форма собственности — тоже.
    await edit.locator('[data-cp-field="form"]').selectOption('ФС-01');
    await expect(warn).toContainText('для организаций — нужно подтверждение');
    await edit.locator('[data-cp-field="form"]').selectOption('ФС-02');
    await expect(warn).toContainText('подтвердил');

    // Код из перечня «Для ИП» — предупреждения о патенте нет.
    await pickGked(page, edit, '96.04.0', true);
    await expect(edit.locator('[data-gked-warn]')).toHaveCount(0);
  });

  test('(проверка задачи #65) разовый контрагент — без отчётов и платы; обязательный отчёт снимается после «Снять обязательный отчёт?»; статус по УГНС можно снять вручную; «Изменить»: «Изменений нет», сохранение и «запись изменена другим пользователем»', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    // Пять окон подряд в одном тесте: времени нужно больше обычного.
    test.slow();
    await orgWithTypes(page.request, new URL(baseURL!).origin);

    await test.step('разовый: нет отчётов, ставок и стоимости — «Разовый контрагент добавлен»', async () => {
      const form = await openForm(page);
      await form
        .locator('[data-cp-field="kind"]')
        .getByRole('button', { name: 'Разовое', exact: true })
        .click();
      const inn = await fillMain(page, form, { gked: '69.20.0' });
      await toSection(form, 3, isMobile);
      await expect(form.locator('[data-cp-types]')).toHaveCount(0);
      await expect(form.locator('[data-cp-field="fee"]')).toHaveCount(0);
      await save(form, isMobile);
      await expect(form).toBeHidden();
      await expect(page.getByText('Разовый контрагент добавлен', { exact: true })).toBeVisible();
      expect(await reportsOf(page.request, inn)).toEqual([]);
    });

    const form = await openForm(page);
    const name = `ОсОО «Изменить ${freshInn().slice(-6)}»`;
    const inn = await fillMain(page, form, { name, gked: '69.20.0' });
    await test.step('статус по УГНС отмечен сам и снимается вручную', async () => {
      await form.locator('[data-cp-field="office"]').selectOption('ugns-large');
      await toSection(form, 2, isMobile);
      await expect(form.locator('[data-cp-benefits]')).toContainText('отмечен по УГНС');
      await form.locator('[data-cp-benefits-open]').click();
      const benefits = page.getByRole('dialog', { name: 'Льготы и особые статусы' });
      await benefits.getByRole('button', { name: 'Все', exact: true }).click();
      await benefits
        .getByRole('checkbox', { name: 'Крупный налогоплательщик', exact: true })
        .uncheck();
      await benefits.getByRole('button', { name: 'Применить' }).click();
      await expect(form.locator('[data-cp-benefits]')).not.toContainText('Крупный');
    });

    await test.step('обязательный отчёт снимается только после вопроса', async () => {
      await expect(regimeField(form)).toHaveValue('РЕЖ-03');
      await toSection(form, 3, isMobile);
      const enq = form.locator('[data-cp-type="enq"]');
      await enq.getByRole('button').click();
      const must = page.getByRole('dialog', { name: 'Снять обязательный отчёт?' });
      await expect(must).toContainText('обязателен');
      await must.getByRole('button', { name: 'Отмена' }).click();
      await expect(enq).toBeVisible();
      await enq.getByRole('button').click();
      await must.getByRole('button', { name: 'Снять', exact: true }).click();
      await expect(enq).toHaveCount(0);
      await save(form, isMobile);
      await expectCreated(page, form);
    });

    const card = await contractorByInn(page.request, inn);
    expect(card.benefits).toEqual([]);
    expect((await reportsOf(page.request, inn)).map((r) => r.type.code)).not.toContain('enq');

    const openEdit = async () => {
      await page.goto('/samples');
      const picker = page.locator('[data-sample-contractor]');
      const value = await picker.locator('option', { hasText: name }).getAttribute('value');
      await picker.selectOption(value!);
      await page.locator('[data-sample-edit]').click();
      return page.getByRole('dialog', { name: 'Изменить контрагента' });
    };

    await test.step('«Изменить»: без правок — «Изменений нет», с правкой — «Контрагент сохранён»', async () => {
      let edit = await openEdit();
      await edit.locator('[data-cp-save]').click();
      await expect(edit).toBeHidden();
      await expect(page.getByText('Изменений нет', { exact: true })).toBeVisible();

      edit = await openEdit();
      await edit.getByLabel('Примечание', { exact: true }).fill('Договор продлён');
      await edit.locator('[data-cp-save]').click();
      await expect(edit).toBeHidden();
      await expect(page.getByText(/^Контрагент сохранён/)).toBeVisible();
      const saved = await contractorByInn(page.request, inn);
      expect(saved.version).toBeGreaterThan(card.version);
      expect(saved.benefits).toEqual([]);
    });

    await test.step('пока окно открыто, контрагента изменил другой — «Запись изменена другим пользователем»', async () => {
      const edit = await openEdit();
      const now = await contractorByInn(page.request, inn);
      const other = await page.request.patch(`/api/contractors/${now.id}`, {
        headers: { origin: new URL(baseURL!).origin },
        data: { version: now.version, contact: 'Айгуль' },
      });
      expect(other.status(), await other.text()).toBe(200);
      await edit.getByLabel('Примечание', { exact: true }).fill('Ещё правка');
      await edit.locator('[data-cp-save]').click();
      await expect(edit.getByText('Запись изменена другим пользователем')).toBeVisible();
      await expect(edit.locator('[data-cp-save]')).toBeDisabled();
    });
  });

  test('(проверка задачи #65) ИНН архивного контрагента: в ошибке «Такой ИНН уже есть» — «Вернуть из архива»; после возврата окно закрывается, контрагент снова обслуживается', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await orgWithTypes(page.request, origin);
    const staff = (await (await page.request.get('/api/staff?size=all')).json()) as {
      items: { id: string }[];
    };
    const oldInn = freshInn();
    const created = await page.request.post('/api/contractors', {
      headers: { origin },
      data: {
        name: `Архивный ${oldInn}`,
        inn: oldInn,
        phone: '+996505890076',
        kind: 'regular',
        formCode: 'ФС-01',
        regimeCode: 'РЕЖ-01',
        gked: '46.34.0',
        startDate: '2026-01-01',
        responsibleEmployeeId: staff.items[0]!.id,
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const old = { ...((await created.json()) as { id: string }), inn: oldInn };
    const archived = await page.request.post('/api/contractors/archive', {
      headers: { origin },
      data: { ids: [old.id] },
    });
    expect(archived.status(), await archived.text()).toBe(200);

    const form = await openForm(page);
    await fillMain(page, form, { inn: old.inn, gked: '46.34.0' });
    await toSection(form, 2, isMobile);
    await regimeField(form).selectOption('РЕЖ-01');
    await save(form, isMobile);
    const inn = form.locator('[data-field]').filter({ has: page.locator('[data-cp-field="inn"]') });
    await expect(inn).toContainText('Такой ИНН уже есть');
    const back = inn.locator('[data-cp-unarchive]');
    await expect(back).toHaveText('Вернуть из архива');
    // Другой ИНН в поле — кнопки нет: она возвращает найденного контрагента.
    await form.locator('[data-cp-field="inn"]').fill(freshInn());
    await expect(back).toHaveCount(0);
    await form.locator('[data-cp-field="inn"]').fill(old.inn);
    await save(form, isMobile);
    await back.click();
    await expect(form).toBeHidden();
    await expect(
      page.getByText(/^Контрагент возвращён из архива, открытых отчётов: \d+$/),
    ).toBeVisible();
    const service = (await (
      await page.request.get(`/api/contractors/${old.id}/service`)
    ).json()) as {
      status: string;
    };
    expect(service.status).toBe('active');
  });
});
