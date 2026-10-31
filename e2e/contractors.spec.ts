import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import {
  DEMO_PASSWORD,
  defaultResponsible,
  finger,
  hire,
  settledBox,
  signIn,
  uniqueLogin,
} from './helpers';
import { orgWithTypes } from './orgs';
import { asOwner, assign, newContractor, staffIds } from './reports';

// «Контрагенты» → список и карточка контрагента (задачи 2.10 и 2.11, #66) через настоящий сайт.
// Демо-организация: владелец erkin, бухгалтер alisher с областью «Свои контрагенты»; новые
// контрагенты — свои на каждый запуск и проект (ПК и телефон), по слову в названии их находит поиск.
// Плашки на телефоне скрыты, пока их не включить: включает их новый главный бухгалтер теста, чтобы не
// менять вид списка демо-сотрудникам. Передача дел, подбор отчётов и показатели — в своей организации
// теста. Тариф Соцфонда в карточке и плашка «Тариф под вопросом» закрывают пункты 38 и 39 целиком (их
// правила и ответы API — e2e/socfund-api.spec.ts), итоги вкладки «Показатели» — пункт 22.

type CpRow = { id: string; name: string; gked: { code: string } | null };
type ReportItem = {
  id: string;
  periodStart: string;
  status: string;
  type: { code: string };
  responsible: { id: string } | null;
};

/** Слово из кириллицы, своё на каждый запуск: по нему поиск находит только контрагентов теста. */
const uniqueWord = (prefix: string) =>
  `${prefix}${Array.from({ length: 6 }, () => 'абвгдежзиклмнопрстуф'[Math.floor(Math.random() * 20)]).join('')}`;

/** Идущий месяц по Бишкеку (UTC+6). */
const currentMonth = () => new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 7);

/** Общий поиск по вкладке (на телефоне — кнопкой «Поиск» в верхней панели). */
async function search(page: Page, isMobile: boolean, text: string) {
  if (isMobile) await page.getByRole('button', { name: 'Поиск', exact: true }).click();
  await page.getByRole('searchbox').first().fill(text);
}

const rows = (page: Page) => page.locator('[data-grid] [data-id]');

/** Карточка контрагента из списка: строка (на телефоне — плитка) по названию. */
async function openCard(page: Page, name: string): Promise<Locator> {
  await rows(page).filter({ hasText: name }).first().getByText(name, { exact: true }).click();
  const card = page.getByRole('dialog', { name });
  await expect(card.locator('[data-cp-card]')).toBeVisible();
  return card;
}

/** Вкладка карточки: на телефоне — из списка под текущей вкладкой. */
async function toTab(page: Page, card: Locator, isMobile: boolean, name: RegExp) {
  if (isMobile) {
    await card.getByRole('tab', { selected: true }).click();
    await page.getByRole('menu').getByRole('menuitem', { name }).click();
  } else {
    await card.getByRole('tab', { name }).click();
  }
}

/** Новый главный бухгалтер демо-организации (область «Все контрагенты») входит в браузере. */
async function signInAsNewChief(page: Page, origin: string) {
  const login = uniqueLogin('e2e-cps');
  const { temporaryPassword } = await hire(page.request, origin, login, null, 'Главный бухгалтер');
  await signIn(page.request, origin, login, temporaryPassword);
  const changed = await page.request.post('/api/auth/password', {
    headers: { origin },
    data: { currentPassword: temporaryPassword, newPassword: 'Свой-пароль-e2e-1' },
  });
  expect(changed.status(), await changed.text()).toBe(200);
}

/** Список с плашками: на телефоне статистика по умолчанию скрыта — включается кнопкой. */
async function showPlates(page: Page, isMobile: boolean) {
  await page.goto('/app/cps/all');
  await expect(rows(page).first()).toBeVisible();
  if (isMobile) await page.locator('[data-stats-toggle]').click();
  await expect(page.locator('[data-plates]')).toBeVisible();
}

/** Сотрудник своей организации теста с ролью «Бухгалтер» (сеанс владельца — в `api`). */
async function accountant(api: APIRequestContext, origin: string, fullName: string) {
  const roles = (await (await api.get('/api/roles?size=all')).json()) as {
    items: { id: string; name: string }[];
  };
  const res = await api.post('/api/staff', {
    headers: { origin },
    data: {
      fullName,
      login: uniqueLogin('e2e-acc'),
      roleId: roles.items.find((r) => r.name === 'Бухгалтер')!.id,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { employee: { id: string } }).employee.id;
}

/** Отчёты контрагента по ИНН с ответственным. */
async function reportsOf(api: APIRequestContext, inn: string): Promise<ReportItem[]> {
  const filters = encodeURIComponent(JSON.stringify({ inn: { type: 'text', q: inn } }));
  const res = await api.get(`/api/reports?size=all&tab=all&filters=${filters}`);
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { items: ReportItem[] }).items;
}

/** Месяц «ГГГГ-ММ» на `shift` месяцев от текущего по Бишкеку. */
function monthAt(shift: number): string {
  const now = new Date(Date.now() + 6 * 3_600_000);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + shift, 1));
  return d.toISOString().slice(0, 7);
}

/** Признаки тарифа Соцфонда: все «да» (СПиНО) или ничего не указано. */
const ALL_YES = { cashless: true, registry: true, confirmed: true, gov: false };
const NO_FLAGS = { cashless: null, registry: null, confirmed: null, gov: null };

/** Контрагент демо-организации с ГКЭД, льготами и признаками тарифа Соцфонда (как в socfund-api). */
async function socfundContractor(
  api: APIRequestContext,
  origin: string,
  data: { name: string; gked: string; flags: Record<string, boolean | null>; benefits?: string[] },
) {
  const inn = `06${Date.now().toString().slice(-8)}${String(Math.floor(Math.random() * 10_000)).padStart(4, '0')}`;
  const res = await api.post('/api/contractors', {
    headers: { origin },
    data: {
      name: data.name,
      inn,
      phone: '+996505890076',
      kind: 'regular',
      formCode: 'ФС-01',
      regimeCode: 'РЕЖ-01',
      gked: data.gked,
      bases: ['employees'],
      benefits: (data.benefits ?? []).map((code) => ({ code, validFrom: null, validTo: null })),
      socfund: { flags: data.flags },
      startDate: '2026-01-01',
      responsibleEmployeeId: await defaultResponsible(api),
      tariff: { amount: 1_000_000, period: 'M' },
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { id: string; version: number };
}

/** Совпадает ли прямоугольник с ожидаемым с точностью до пикселя. */
function expectBox(
  box: { x: number; y: number; width: number; height: number },
  want: { x: number; y: number; width: number; height: number },
) {
  for (const k of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(box[k] - want[k]), `${k}: ${box[k]} ≠ ${want[k]}`).toBeLessThanOrEqual(1);
  }
}

test.describe('Этап 2: контрагенты — список и карточка', () => {
  test('(п. 6, контрагенты) бухгалтер с правом «только свои» не видит чужих контрагентов: их нет ни в списке, ни в поиске, карточка чужого не открывается', async ({
    page,
    request,
    baseURL,
    isMobile,
  }) => {
    const origin = await asOwner(request, baseURL);
    const staff = await staffIds(request);
    const word = uniqueWord('Свои');
    const ownName = `ОсОО «${word} Алишера»`;
    const own = await newContractor(request, origin, {
      name: ownName,
      responsible: staff.alisher!,
    });
    const other = await newContractor(request, origin, {
      name: `ОсОО «${word} Мээрим»`,
      responsible: staff.meerim!,
    });

    await signIn(page.request, origin, 'alisher', DEMO_PASSWORD);
    const api = page.request;
    const list = (await (await api.get('/api/contractors?size=all')).json()) as {
      items: CpRow[];
    };
    const ids = list.items.map((c) => c.id);
    expect(ids).toContain(own.id);
    expect(ids).not.toContain(other.id);
    expect((await api.get(`/api/contractors/${other.id}`)).status()).toBe(404);
    expect((await api.get(`/api/contractors/${own.id}`)).status()).toBe(200);

    // На экране поиск по общему слову находит только своего; его карточка открывается.
    await page.goto('/app/cps/all');
    await expect(rows(page).first()).toBeVisible();
    await search(page, isMobile, word);
    await expect(rows(page)).toHaveCount(1);
    await expect(page.locator(`[data-grid] [data-id="${own.id}"]`)).toContainText(ownName);
    const card = await openCard(page, ownName);
    await expect(card).toContainText(own.inn);
  });

  test('(Без ГКЭД) плашка «Без ГКЭД» показывает контрагентов без основного вида деятельности; в их карточке — предупреждение «Укажите основной вид деятельности (ГКЭД)»', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await signInAsNewChief(page, origin);
    // Другие тесты могут добавлять контрагентов в демо-организацию одновременно с этим: поэтому всё,
    // что прочитано раньше, сверяется с тем, что прочитано позже (добавленные — только во втором).
    const all = (await (await page.request.get('/api/contractors?size=all')).json()) as {
      items: CpRow[];
    };
    const without = all.items.filter((c) => c.gked === null).map((c) => c.id);
    expect(without.length).toBeGreaterThan(0);
    await showPlates(page, isMobile);
    const plate = page.locator('[data-plate="nogk"]');
    await expect(plate).toContainText('Без ГКЭД');
    await plate.click();
    await expect(plate).toHaveAttribute('aria-pressed', 'true');
    await expect(rows(page).filter({ hasText: 'ОсОО «Укс»' })).toBeVisible();
    const shown = await rows(page).evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-id')),
    );

    // Плашка ставит фильтр «ГКЭД указан: нет»: API с ним отдаёт всех контрагентов без основного ГКЭД,
    // и только их; на экране — они же.
    const filters = encodeURIComponent(JSON.stringify({ gkedSet: { type: 'enum', vals: ['no'] } }));
    const res = await page.request.get(`/api/contractors?size=all&filters=${filters}`);
    expect(res.status()).toBe(200);
    const items = ((await res.json()) as { items: CpRow[] }).items;
    expect(items.every((c) => c.gked === null)).toBe(true);
    const api = new Set(items.map((c) => c.id));
    for (const id of without) expect(api.has(id), id).toBe(true);
    for (const id of shown) expect(api.has(id!), id!).toBe(true);
    expect(shown.length).toBeGreaterThanOrEqual(without.length);

    const card = await openCard(page, 'ОсОО «Укс»');
    await expect(card).toContainText('Укажите основной вид деятельности (ГКЭД)');
  });

  test('(передача дел) «Передать контрагентов» в карточке сотрудника переводит всех его контрагентов и их несданные отчёты, в том числе будущих периодов, к другому сотруднику', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await orgWithTypes(page.request, origin);
    const api = page.request;
    const word = uniqueWord('Передача');
    const fromName = `Передаткин ${word} Первый`;
    const from = await accountant(api, origin, fromName);
    const to = await accountant(api, origin, `Принимаев ${word} Второй`);
    const cps = await Promise.all(
      [1, 2].map((n) =>
        newContractor(api, origin, {
          name: `ОсОО «${word} ${n}»`,
          responsible: from,
          tariff: false,
        }),
      ),
    );
    const month = currentMonth();
    for (const cp of cps) {
      await assign(api, origin, {
        contractorId: cp.id,
        reportTypeCode: 'soc',
        fromMonth: `${month}-01`,
      });
    }
    const before = await reportsOf(api, cps[0]!.inn);
    // Отчёт за идущий месяц и за следующий — оба у прежнего ответственного.
    expect(before.length).toBeGreaterThanOrEqual(2);
    expect(before.every((r) => r.responsible?.id === from)).toBe(true);

    await page.goto('/app/staff/list');
    await search(page, isMobile, word);
    await rows(page)
      .filter({ hasText: fromName })
      .first()
      .getByText(fromName, { exact: true })
      .click();
    const card = page.getByRole('dialog', { name: fromName });
    await card.getByRole('button', { name: 'Действия' }).click();
    await page
      .getByRole('menu', { name: 'Действия' })
      .getByRole('menuitem', { name: /^Передать контрагентов/ })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Передать контрагентов' });
    await expect(dialog.locator('[data-transfer-cps]')).toHaveText('2');
    await dialog.getByLabel('Кому').selectOption(to);
    await dialog.getByRole('button', { name: 'Передать', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole('status').filter({ hasText: /Передано 2 контрагентов/ }),
    ).toBeVisible();

    for (const cp of cps) {
      const got = (await (await api.get(`/api/contractors/${cp.id}`)).json()) as {
        responsible: { id: string } | null;
      };
      expect(got.responsible?.id).toBe(to);
      const after = await reportsOf(api, cp.inn);
      expect(after.length).toBeGreaterThanOrEqual(2);
      for (const r of after) expect(r.responsible?.id, `${r.type.code} ${r.periodStart}`).toBe(to);
    }
    // У прежнего сотрудника закреплённых контрагентов больше нет.
    await expect(card).toBeVisible();
    await toTab(page, card, isMobile, /^Контрагенты/);
    await expect(card).toContainText('Нет закреплённых контрагентов');
  });

  test('(п. 26, карточка контрагента) по «На весь экран» карточка занимает всё окно браузера, таблица на вкладке шире без перекоса; следующая карточка тоже развёрнута, пока её не свернуть; на телефоне развёрнутая карточка листается свайпами по вкладкам и закрывается свайпом вниз', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    await asOwner(page.request, baseURL);
    const first = 'ОсОО «Ала-Тоо Трейд»';
    const second = 'ОсОО «Бишкек Стройсервис»';
    await page.goto('/app/cps/all');
    await expect(rows(page).first()).toBeVisible();
    await search(page, isMobile, 'Ала-Тоо');
    let card = await openCard(page, first);
    const view = page.viewportSize()!;
    const inset = isMobile ? 0 : 12;
    const full = {
      x: inset,
      y: inset,
      width: view.width - inset * 2,
      height: view.height - inset * 2,
    };

    if (isMobile) {
      await card.getByRole('button', { name: 'На весь экран' }).click();
      await expect(card.getByRole('button', { name: 'Свернуть окно' })).toBeVisible();
      const box = await settledBox(card);
      expectBox(box, full);
      const current = card.getByRole('tab', { selected: true });
      await expect(current).toContainText('Основное');
      const swipe = await finger(page);
      const y = box.y + box.height * 0.72;
      const left = { x: box.x + box.width * 0.85, y };
      const right = { x: box.x + box.width * 0.15, y };

      await test.step('протяжка влево дальше трети ширины — вкладка «Отчёты к сдаче»', async () => {
        await swipe.drag(left, { x: left.x - box.width / 3 - 40, y });
        await expect(current).toContainText('Отчёты к сдаче');
        expectBox(await settledBox(card), full);
      });

      await test.step('рывок вправо — снова «Основное»', async () => {
        await swipe.flick(right, { x: right.x + 80, y });
        await expect(current).toContainText('Основное');
      });

      await test.step('протяжка вниз за шапку — карточка закрывается, страница та же', async () => {
        const head = { x: box.x + box.width / 2, y: box.y + 30 };
        await swipe.drag(head, { x: head.x, y: head.y + Math.min(box.height / 4, 160) + 30 });
        await expect(card).toBeHidden();
        await expect(page).toHaveURL(/\/app\/cps\/all$/);
      });
      return;
    }

    // На ПК таблица «Отчётов к сдаче» растягивается на всю ширину развёрнутой карточки; заголовки
    // столбцов стоят над своими ячейками.
    await toTab(page, card, isMobile, /^Отчёты к сдаче/);
    const table = card.getByRole('table', { name: 'Отчёты к сдаче' });
    await expect(table.locator('tbody tr[data-id]').first()).toBeVisible();
    const scroller = card.locator('[data-grid-scroll]');
    const before = (await settledBox(card)).width;
    const narrow = (await scroller.boundingBox())!;
    await card.getByRole('button', { name: 'На весь экран' }).click();
    await expect(card.getByRole('button', { name: 'Свернуть окно' })).toBeVisible();
    await expect(async () => expectBox(await settledBox(card), full)).toPass();
    const wide = (await scroller.boundingBox())!;
    expect(wide.width - narrow.width).toBeGreaterThanOrEqual(full.width - before - 2);
    expect(wide.height).toBeGreaterThanOrEqual(narrow.height - 1);
    const skew = await table.evaluate((el) => {
      const heads = Array.from(el.querySelectorAll('thead tr:first-child th'));
      const cells = Array.from(el.querySelector('tbody tr[data-id]')?.children ?? []);
      return heads.map((th, i) => {
        const a = th.getBoundingClientRect();
        const b = cells[i]?.getBoundingClientRect();
        return b ? Math.abs(a.left - b.left) + Math.abs(a.width - b.width) : 0;
      });
    });
    expect(Math.max(...skew)).toBeLessThanOrEqual(1);

    await test.step('следующая карточка открывается развёрнутой; «Свернуть окно» — снова обычная', async () => {
      await card.locator('[data-cp-done]').click();
      await expect(card).toBeHidden();
      await search(page, isMobile, 'Бишкек Стройсервис');
      card = await openCard(page, second);
      await expect(card.getByRole('button', { name: 'Свернуть окно' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(async () => expectBox(await settledBox(card), full)).toPass();
      await card.getByRole('button', { name: 'Свернуть окно' }).click();
      await expect(card.getByRole('button', { name: 'На весь экран' })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
      await expect(async () =>
        expect((await settledBox(card)).width).toBeCloseTo(before, 0),
      ).toPass();
    });
  });

  test('(п. 32) в карточке вкладки «Отчёты к сдаче» и «Подбор отчётов»: отметили отчёт — «новых 1»; переход на другую вкладку спрашивает «Подбор не применён»; «Применить» и подтверждение — отчёт назначен; в «Изменить» блока «Сдаёт отчёты» нет', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await orgWithTypes(page.request, origin);
    const word = uniqueWord('Подбор');
    const name = `ОсОО «${word}»`;
    await newContractor(page.request, origin, { name, tariff: false });
    await page.goto('/app/cps/all');
    await expect(rows(page).first()).toBeVisible();
    await search(page, isMobile, word);
    const card = await openCard(page, name);
    if (!isMobile) {
      await expect(card.getByRole('tab', { name: /^Отчёты к сдаче/ })).toBeVisible();
      await expect(card.getByRole('tab', { name: /^Подбор отчётов/ })).toBeVisible();
    }

    await toTab(page, card, isMobile, /^Подбор отчётов/);
    const tab = card.locator('[data-pick-tab]');
    await tab.getByRole('button', { name: 'Все', exact: true }).click();
    // НДС подходит к ОНР; назначений у нового контрагента нет.
    const row = tab.locator('[data-pick-row="nds"]');
    await expect(row.getByRole('checkbox')).not.toBeChecked();
    await row.getByRole('checkbox').check();
    await expect(tab.locator('[data-pick-sum]')).toContainText('новых 1');

    await test.step('уход на другую вкладку — «Подбор не применён»; «Отмена» оставляет подбор', async () => {
      await toTab(page, card, isMobile, /^Отчёты к сдаче/);
      const leave = page.getByRole('dialog', { name: 'Подбор не применён' });
      await expect(leave).toBeVisible();
      await leave.getByRole('button', { name: 'Отмена' }).click();
      await expect(leave).toBeHidden();
      await expect(card.getByRole('tab', { selected: true })).toContainText('Подбор отчётов');
      await expect(row.getByRole('checkbox')).toBeChecked();
    });

    await test.step('«Применить» и подтверждение — отчёт назначен', async () => {
      await tab.getByRole('button', { name: 'Применить' }).click();
      const ask = page.getByRole('dialog', { name: 'Изменить отчёты контрагента?' });
      await expect(ask).toContainText('Будет добавлено:');
      await ask.getByRole('button', { name: 'Сохранить' }).click();
      await expect(
        page.getByRole('status').filter({ hasText: 'Отчёты изменены: добавлено 1, снято 0' }),
      ).toBeVisible();
      await expect(row).toContainText('Назначен');
      // Подбор применён: на другую вкладку — без вопроса.
      await toTab(page, card, isMobile, /^Отчёты к сдаче/);
      await expect(page.getByRole('dialog', { name: 'Подбор не применён' })).toHaveCount(0);
      await expect(card.getByRole('tab', { selected: true })).toContainText('Отчёты к сдаче');
    });

    await test.step('«Изменить» — без блока «Сдаёт отчёты»', async () => {
      await card.locator('[data-cp-more]').click();
      await page
        .getByRole('menu', { name: 'Действия' })
        .getByRole('menuitem', { name: 'Изменить' })
        .click();
      const edit = page.getByRole('dialog', { name: 'Изменить контрагента' });
      await expect(edit.locator('[data-cp-field="form"]')).toBeVisible({ timeout: 15_000 });
      await expect(edit).not.toContainText('Сдаёт отчёты');
    });
  });

  test('(п. 33, карточка контрагента) на телефоне в карточке контрагента шкала обслуживания — шаги столбиком с датами справа, «История статусов» — записи одна под другой; ничего не обрезано и не прокручивается вбок', async ({
    page,
    request,
    baseURL,
    isMobile,
  }) => {
    const origin = await asOwner(request, baseURL);
    const word = uniqueWord('Пауза');
    const name = `ОсОО «${word}»`;
    const cp = await newContractor(request, origin, { name });
    const paused = await request.post(`/api/contractors/${cp.id}/pause`, {
      headers: { origin },
      data: { from: currentMonth(), reason: 'Нет деятельности', version: cp.version },
    });
    expect(paused.status(), await paused.text()).toBe(200);

    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    await page.goto('/app/cps/all');
    await expect(rows(page).first()).toBeVisible();
    await search(page, isMobile, word);
    const card = await openCard(page, name);
    const scale = card.locator('[data-service-scale]');
    const steps = scale.locator('ol[data-status-scale] > li > button');
    await expect(steps.first()).toBeVisible();
    await expect(steps.nth(1)).toHaveAttribute('aria-current', 'step');
    await card.getByText('История статусов', { exact: true }).click();
    const history = card.locator('[data-status-history] tbody > tr');
    await expect(history).toHaveCount(2);
    const boxes = await Promise.all([0, 1].map(async (i) => (await steps.nth(i).boundingBox())!));
    if (isMobile) {
      expect(Math.abs(boxes[1]!.x - boxes[0]!.x)).toBeLessThanOrEqual(1);
      expect(boxes[1]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height - 1);
      const date = steps.nth(1).locator('small', { hasText: /\d\d\.\d\d\.\d{4}/ });
      const at = (await date.boundingBox())!;
      expect(at.x).toBeGreaterThan(boxes[1]!.x + boxes[1]!.width / 2);
      await expect(card.locator('[data-status-history] thead')).toBeHidden();
      const [one, two] = await Promise.all([
        history.nth(0).boundingBox(),
        history.nth(1).boundingBox(),
      ]);
      expect(two!.y).toBeGreaterThanOrEqual(one!.y + one!.height - 1);
    } else {
      expect(boxes[1]!.x).toBeGreaterThan(boxes[0]!.x + boxes[0]!.width);
    }
    const overflow = await card.evaluate((dialog) => {
      const edge = dialog.getBoundingClientRect().right + 1;
      return Array.from(dialog.querySelectorAll('[data-cp-card] *'))
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.right > edge;
        })
        .map((el) => `${el.tagName} ${(el.textContent ?? '').slice(0, 40)}`);
    });
    expect(overflow).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(0);
  });

  test('(п. 58) у демо-ИП на патенте с ГКЭД 96.02.0 в карточке жёлтая отметка «подтвердил…», в истории контрагента — запись, кто подтвердил', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    const name = 'ИП Жумабеков Р. С.';
    await signInAsNewChief(page, origin);
    // ИП в архиве (как в прототипе): виден по плашке «В архиве».
    await showPlates(page, isMobile);
    await page.locator('[data-plate="arc"]').click();
    await search(page, isMobile, 'Жумабеков');
    const card = await openCard(page, name);
    const warn = card.locator('[data-gked-warn]');
    await expect(warn).toContainText('Режим «Патент»');
    await expect(warn).toContainText('подтвердил');
    await expect(warn).not.toContainText('нужно подтверждение');

    await toTab(page, card, isMobile, /^История/);
    const entry = card
      .getByRole('list', { name: 'История' })
      .getByRole('listitem')
      .filter({ hasText: 'Подтверждено право на режим' });
    await expect(entry).toHaveCount(1);
    await expect(entry).toContainText('Айгерим С.');
  });
  test('(п. 38, карточка контрагента) ОсОО с ГКЭД 47.11 и всеми признаками — «СПиНО», у «Соцфонда» (STI-161) в «Подборе отчётов» видны ставки тарифа; после смены основного ГКЭД на 64.19.1 в карточке «Тариф СПиНО больше не применим» с кнопкой «Сменить на базовый»', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = await asOwner(page.request, baseURL);
    const word = uniqueWord('Спино');
    const name = `ОсОО «${word}»`;
    const cp = await socfundContractor(page.request, origin, {
      name,
      gked: '47.11.0',
      flags: ALL_YES,
    });
    await page.goto('/app/cps/all');
    await expect(rows(page).first()).toBeVisible();
    await search(page, isMobile, word);
    let card = await openCard(page, name);
    await expect(card.locator('[data-cp-card]')).toContainText('СПиНО');

    await test.step('«Подбор отчётов»: у «Соцфонда» — ставки тарифа СПиНО', async () => {
      await toTab(page, card, isMobile, /^Подбор отчётов/);
      const tab = card.locator('[data-pick-tab]');
      await tab.getByRole('button', { name: 'Все', exact: true }).click();
      await tab.locator('[data-pick-row="soc"]').click({ position: { x: 150, y: 12 } });
      const desc = tab.locator('[data-pick-side], [data-pick-row="soc"] + div');
      await expect(desc).toContainText('СПиНО');
      await expect(desc).toContainText('итого 12,25 %');
    });

    await test.step('ГКЭД сменили на 64.19.1 — «больше не применим», «Сменить на базовый» ставит базовый тариф', async () => {
      await card.locator('[data-cp-done]').click();
      await expect(card).toBeHidden();
      const moved = await page.request.patch(`/api/contractors/${cp.id}`, {
        headers: { origin },
        data: { version: cp.version, gked: '64.19.1' },
      });
      expect(moved.status(), await moved.text()).toBe(200);
      await page.reload();
      await expect(rows(page).first()).toBeVisible();
      await search(page, isMobile, word);
      card = await openCard(page, name);
      const bad = card.locator('[data-sf-bad]');
      await expect(bad).toContainText('Тариф СПиНО больше не применим');
      await bad.locator('[data-cp-sfto]').click();
      await expect(
        page.getByRole('status').filter({ hasText: 'Тариф Соцфонда: Базовый тариф' }),
      ).toBeVisible();
      await expect(card.locator('[data-sf-bad]')).toHaveCount(0);
      await expect(card).toContainText('Базовый тариф');
    });
  });

  test('(п. 39, карточка контрагента) у резидента ПКИ — «Тариф ПВТ / ПКИ»; ручной «СПиНО» в карточке сохраняется только после подтверждения «Тариф не совпадает с условиями», и контрагент попадает в плашку «Тариф под вопросом»', async ({
    page,
    request,
    baseURL,
    isMobile,
  }) => {
    const origin = await asOwner(request, baseURL);
    const word = uniqueWord('Пки');
    const name = `ОсОО «${word}»`;
    const cp = await socfundContractor(request, origin, {
      name,
      gked: '62.01.0',
      flags: NO_FLAGS,
      benefits: ['ЛЬГ-01'],
    });
    await signInAsNewChief(page, origin);
    await showPlates(page, isMobile);
    await search(page, isMobile, word);
    const card = await openCard(page, name);
    await expect(card).toContainText('Тариф ПВТ / ПКИ');

    await card.locator('[data-cp-sf]').click();
    const dialog = page.getByRole('dialog', { name: 'Тариф Соцфонда' });
    await dialog.locator('[data-sf-tariff]').selectOption('spino');
    await dialog.getByLabel('Почему тариф выбран вручную').fill('письмо ГНС');
    await dialog.locator('[data-sf-save]').click();
    const ask = page.getByRole('dialog', { name: 'Тариф не совпадает с условиями' });
    await expect(ask).toContainText('«СПиНО» расходится с условиями: Статус «Резидент ПКИ».');
    await ask.getByRole('button', { name: 'Сохранить' }).click();
    await expect(dialog).toBeHidden();
    await expect(card).toContainText('СПиНО');
    await expect(card).toContainText('письмо ГНС');
    await card.locator('[data-cp-done]').click();
    await expect(card).toBeHidden();

    const plate = page.locator('[data-plate="sfq"]');
    await expect(plate).toContainText('Тариф под вопросом');
    await plate.click();
    await expect(plate).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(`[data-grid] [data-id="${cp.id}"]`)).toContainText(name);
    await expect(rows(page)).toHaveCount(1);
  });

  test('(п. 22) внесли по контрагенту «Выручку» 100 000, 150 000 и 200 000 сом за три месяца: на вкладке «Показатели» карточки за этот период — сумма 450 000, среднее 150 000, максимум 200 000, минимум 100 000', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    const api = page.request;
    await orgWithTypes(api, origin, false);
    const policy = (await (await api.get('/api/org/policy')).json()) as { version: number };
    const on = await api.patch('/api/org/policy', {
      headers: { origin },
      data: { version: policy.version, features: { indicators: true } },
    });
    expect(on.status(), await on.text()).toBe(200);
    const word = uniqueWord('Выручка');
    const name = `ОсОО «${word}»`;
    const cp = await newContractor(api, origin, { name, tariff: false });

    // «Выручка» — показатель-пример новой организации; ведётся с первого из трёх месяцев.
    const list = (await (await api.get('/api/kpi/indicators')).json()) as {
      items: { id: string; name: string }[];
    };
    const id = list.items.find((i) => i.name === 'Выручка')!.id;
    const ind = (await (await api.get(`/api/kpi/indicators/${id}`)).json()) as Record<
      string,
      unknown
    >;
    const saved = await api.put(`/api/kpi/indicators/${id}`, {
      headers: { origin },
      data: {
        name: ind.name,
        unit: ind.unit,
        type: ind.type,
        total: ind.total,
        description: ind.description,
        required: ind.required,
        dueDay: ind.dueDay,
        start: monthAt(-3),
        scope: ind.scope,
        autoNew: ind.autoNew,
        selected: ind.selected,
        version: ind.version,
      },
    });
    expect(saved.status(), await saved.text()).toBe(200);
    const put = await api.put('/api/kpi/values', {
      headers: { origin },
      data: {
        values: [100_000, 150_000, 200_000].map((som, i) => ({
          contractorId: cp.id,
          indicatorId: id,
          month: monthAt(i - 3),
          value: som * 100,
        })),
      },
    });
    expect(put.status(), await put.text()).toBe(200);

    await page.goto('/app/cps/all');
    await expect(rows(page).first()).toBeVisible();
    await search(page, isMobile, word);
    const card = await openCard(page, name);
    await toTab(page, card, isMobile, /^Показатели/);
    const period = card.locator('[data-kpi-period] input[type="month"]');
    await period.nth(0).fill(monthAt(-3));
    await period.nth(1).fill(monthAt(-1));
    // На ПК — столбцы итогов таблицы, на телефоне — плитки «Сумма», «Среднее»… над месяцами показателя.
    const label = { sum: 'Сумма', avg: 'Среднее', max: 'Максимум', min: 'Минимум' } as const;
    const total = (k: keyof typeof label) =>
      isMobile
        ? card
            .locator('section', { hasText: 'Выручка' })
            .locator('span', {
              has: page.locator('small', { hasText: new RegExp(`^${label[k]}$`) }),
            })
            .locator('b')
        : card.locator(`[data-kpi-card-total="Выручка|${k}"]`);
    await expect(total('sum')).toHaveText(/^450\s000$/);
    await expect(total('avg')).toContainText(/^150\s000/);
    await expect(total('max')).toHaveText(/^200\s000$/);
    await expect(total('min')).toHaveText(/^100\s000$/);
  });
  test('(решение 30.10.2026, docs/deviations.md п. А-7) в «Изменить» включили основание «Есть имущество»: после сохранения окно «Основания изменились» предлагает добавить его отчёты, «Добавить» назначает налог на имущество', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await orgWithTypes(page.request, origin);
    const word = uniqueWord('Основания');
    const name = `ОсОО «${word}»`;
    await newContractor(page.request, origin, { name, tariff: false });
    await page.goto('/app/cps/all');
    await expect(rows(page).first()).toBeVisible();
    await search(page, isMobile, word);
    const card = await openCard(page, name);
    await expect(card).toContainText('Сдаёт отчёты · 0');

    await card.locator('[data-cp-more]').click();
    await page
      .getByRole('menu', { name: 'Действия' })
      .getByRole('menuitem', { name: 'Изменить' })
      .click();
    const edit = page.getByRole('dialog', { name: 'Изменить контрагента' });
    const property = edit.locator('[data-base="property"]');
    await expect(property).toHaveAttribute('aria-pressed', 'false', { timeout: 15_000 });
    await property.click();
    await expect(property).toHaveAttribute('aria-pressed', 'true');
    await edit.locator('[data-cp-save]').click();
    await expect(edit).toBeHidden();

    const bases = page.getByRole('dialog', { name: 'Основания изменились' });
    const add = bases.locator('[data-base-part="add"]');
    await expect(add).toContainText('Включено основание: есть имущество');
    await expect(add.locator('[data-base-type="imn"]')).toBeVisible();
    await bases.locator('[data-base-go="add"]').click();
    await expect(bases).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: /^Добавлено: / })).toBeVisible();
    await expect(card).toContainText('Сдаёт отчёты · 1');
  });
});
