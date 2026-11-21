import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { E2E_SUBSCRIPTION, ownerPassword, platformAdmin, search, uniqueInn } from './admin';
import { cardTab, onPhone, openColumnFilter, phoneListMenu, uniqueLogin } from './helpers';

// «Витрина данных» → «Шаблоны» и «Вывод» в Админке (доработки 20.11.2026: Витрина данных, блоки 3–4,
// «Как проверить…» → «Шаблоны и защита», «Права и вывод»; общий план 20.11, этап 2, П6–П7; прототип
// v155 `renderDmTpl`, `dmTplDlg`, `renderDmOut`, `dmDraw`, `dmEx`). Модуль организации откроется на
// этапе 3 (П2): здесь — экраны Админки на тех же методах. Свои записи теста — шаблон со своим
// названием и кодом, организации со своим словом в названии: тест ищет и считает только их.

type Texts = Record<string, string>;

/** Слово из кириллицы, своё на каждый запуск. */
const uniqueWord = (prefix: string) =>
  `${prefix}${Array.from({ length: 8 }, () => 'абвгдежзиклмнопрстуф'[Math.floor(Math.random() * 20)]).join('')}`;

/** Тексты словаря интерфейса (`GET /api/l10n`): тест не копирует строки экрана. */
async function dictionary(api: APIRequestContext): Promise<Texts> {
  const res = await api.get('/api/l10n');
  expect(res.status()).toBe(200);
  return ((await res.json()) as { texts: Texts }).texts;
}

/** Текст словаря с подстановками как шаблон поиска: `{n}` — своё значение, остальные — что угодно. */
function textPattern(text: string, values: Record<string, string>): RegExp {
  const parts = text.split(/(\{[a-z_]+\})/);
  return new RegExp(
    parts
      .map((p) => {
        const m = /^\{([a-z_]+)\}$/.exec(p);
        if (!m) return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const v = values[m[1]!];
        return v === undefined ? '.+?' : v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join(''),
  );
}

/**
 * Нажать кнопку окна шаблона, которая запускает запрос (`POST path`), и дождаться ответа не 429.
 * Запусков шаблонов с экрана на весь сайт одновременно — два (п. О-96), а сквозные тесты идут
 * параллельно: соседний тест «Витрины» может в этот момент занять оба места — тогда 429 `dm_busy_all`
 * («Сейчас выполняется много запросов»). «Показать» в этой очереди ждёт сама, а «Проверить» и
 * «Опубликовать» отвечают отказом, поэтому нажимаем снова; любой другой ответ — итог нажатия.
 */
async function pressRun(page: Page, button: Locator, path: string): Promise<void> {
  await expect(async () => {
    const res = page.waitForResponse(
      (r) => new URL(r.url()).pathname === path && r.request().method() === 'POST',
    );
    await button.click();
    expect((await res).status()).not.toBe(429);
  }).toPass({ timeout: 20_000, intervals: [250, 500, 1_000] });
}

/** Пункт меню «+ Добавить»: у «Витрины данных» Админки — «Шаблон» и «Токен». */
async function addMenu(page: Page, item: string) {
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByRole('menu', { name: 'Добавить' }).getByRole('menuitem', { name: item }).click();
}

/** Организация теста со своим названием (владелец — только для учёта «Сотрудников»). */
async function newOrg(
  api: APIRequestContext,
  origin: string,
  name: string,
): Promise<{ id: string; slug: string }> {
  const created = await api.post('/api/admin/organizations', {
    headers: { origin },
    data: {
      name,
      inn: uniqueInn(),
      ownerFullName: 'Витринова Сквозная',
      ownerLogin: uniqueLogin('e2e-dm'),
      temporaryPassword: ownerPassword(),
      subscription: E2E_SUBSCRIPTION,
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  return ((await created.json()) as { organization: { id: string; slug: string } }).organization;
}

test.describe('Витрина данных: «Шаблоны» и «Вывод» Админки', () => {
  test('(Витрина данных, блок 3; этап 2, П7) новый шаблон: «Опубликовать» недоступна до «Проверить», два оператора отклоняются с причиной под запросом; опубликованный — «Опубликован» в списке и с результатом в «Выводе»', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    // Нажатия «Проверить» и «Опубликовать» могут ждать свободного места запуска сайта (`pressRun`).
    test.slow();
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const texts = await dictionary(page.request);
    const name = uniqueWord('Шаблон проверки ');
    const code = `e2e-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

    await page.goto('/app/dm/tpl');
    await expect(page.locator('[data-dm-tpl-admin]')).toBeVisible();
    await addMenu(page, texts['add.dm.tpl']!);
    const dialog = page.getByRole('dialog', { name: texts['dm.ed.new']! });
    // Подписи полей со звёздочкой обязательного; «Название» — первое поле окна (так же подписаны поля
    // столбцов образца запроса ниже).
    await dialog.getByRole('textbox', { name: texts['dm.ed.name']! }).first().fill(name);
    await dialog.getByRole('textbox', { name: texts['dm.ed.code']! }).fill(code);
    await dialog
      .getByRole('combobox', { name: texts['dm.ed.kind']!, exact: true })
      .selectOption('admin');
    const query = dialog.locator('[data-dm-ed-query]');
    const publish = dialog.locator('[data-dm-ed-publish]');
    const check = () =>
      pressRun(page, dialog.locator('[data-dm-ed-check]'), '/api/admin/dm/templates/check');

    // Два оператора подряд: «Проверить» отклоняет с причиной, опубликовать по-прежнему нельзя.
    await query.fill('SELECT 7 AS seven; SELECT 8 AS eight');
    await expect(publish).toBeDisabled();
    await check();
    await expect(dialog).toContainText(texts['err.dm_sql_two_statements']!);
    await expect(dialog.locator('[data-dm-ed-result]')).toHaveCount(0);
    await expect(publish).toBeDisabled();
    // UPDATE — тоже отказ с причиной; закрытая таблица сеансов не читается: ошибка базы под запросом.
    await query.fill('UPDATE organizations SET name = name');
    await check();
    await expect(dialog).toContainText(texts['err.dm_sql_not_select']!);
    await expect(publish).toBeDisabled();
    await query.fill('SELECT token_hash FROM sessions');
    await check();
    // У поля запроса текст совпадает с запросом, поэтому «sessions» ищем после причины отказа.
    await expect(dialog).toContainText(
      new RegExp(`${textPattern(texts['err.dm_check_failed']!, { error: '' }).source}.*sessions`),
    );
    await expect(dialog.locator('[data-dm-ed-result]')).toHaveCount(0);
    await expect(publish).toBeDisabled();

    // Один оператор: «Запрос выполнен: строк 1», столбец прочитан, «Опубликовать» доступна.
    await query.fill('SELECT 7 AS seven');
    await check();
    await expect(dialog.locator('[data-dm-ed-result]')).toContainText(
      textPattern(texts['dm.ed.check_ok_adm']!, { n: '1' }),
    );
    await expect(dialog.locator('[data-dm-ed-col="seven"]')).toBeVisible();
    await expect(publish).toBeEnabled();
    await pressRun(page, publish, '/api/admin/dm/templates');
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole('status').filter({ hasText: texts['dm.ed.published']! }),
    ).toBeVisible();

    // В списке — своя строка «Опубликован».
    await search(page, isMobile, name);
    const own = page.locator('[data-dm-tpl-admin] [data-grid] [data-id]').filter({ hasText: name });
    await expect(own).toHaveCount(1);
    await expect(own).toContainText(texts['dm.tpl.state.published']!);

    // Строка колокольчика «Шаблон перестал работать» ведёт на `?tpl=<номер>`: окно этого шаблона,
    // адрес — уже без `?tpl=`.
    const id = await own.getAttribute('data-id');
    await page.goto(`/app/dm/tpl?tpl=${id}`);
    const card = page.getByRole('dialog', { name });
    await expect(card.locator('[data-dm-ed-query]')).toHaveValue('SELECT 7 AS seven');
    await expect(page).not.toHaveURL(/[?&]tpl=/);
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);

    // «Вывод»: шаблон в группе «Для администратора», «Показать» — его строка.
    await page.goto('/app/dm/out');
    const tpl = page.locator('[data-dm-out-tpl]');
    await expect(
      tpl.locator(`optgroup[label="${texts['dm.group.admin']}"] option[value="${code}"]`),
    ).toHaveText(name);
    await tpl.selectOption(code);
    await page.locator('[data-dm-out-show]').click();
    const result = page.locator('[data-dm-out-result]');
    await expect(result.locator('[data-dm-out-meta]')).toContainText(
      textPattern(texts['dm.out.meta']!, { n: '1' }),
    );
    await expect(result.locator('tbody td[data-dx="0"]')).toHaveText(['7']);
  });

  test('(Витрина данных, блок 4, пункты 2–5; этап 2, П6) «Вывод» как в Excel: поиск и сортировка — по всему результату; на ПК три выделенные ячейки дают «Выделено: 3», сумму и среднее, Ctrl+C — те же три значения; «В Excel» отдаёт файл', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    // Длинный сценарий: три организации, шаблон по всем организациям стенда, две сортировки, фильтр,
    // «В Excel» (сервер выполняет шаблон заново) и выделение.
    test.slow();
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const texts = await dictionary(page.request);
    // Три свои организации: по одному сотруднику (владелец) — у каждой «Сотрудников» 1.
    const word = uniqueWord('Витрина');
    const names = [1, 2, 3].map((i) => `ОсОО «${word} ${i}»`);
    await Promise.all(names.map((n) => newOrg(page.request, origin, n)));

    // Готовый шаблон Админки «Организации» (refDB.dmTemplates, код `orgs`): строки — все организации.
    await page.goto('/app/dm/out');
    await page.locator('[data-dm-out-tpl]').selectOption('orgs');
    await page.locator('[data-dm-out-show]').click();
    const result = page.locator('[data-dm-out-result]');
    await expect(result.locator('[data-dm-out-meta]')).toBeVisible();
    await search(page, isMobile, word);
    const orgCells = result.locator('tbody td[data-dx="0"]');
    await expect(orgCells).toHaveText(names);

    // Сортировка по «Организация» — по всему результату: по возрастанию, затем по убыванию.
    const head = result.locator('th[data-column="org"]');
    // Первая кнопка заголовка — сортировка (за ней — «Фильтр»).
    const sort = head.getByRole('button').first();
    await sort.click();
    await expect(head).toHaveAttribute('aria-sort', 'ascending');
    await expect(orgCells).toHaveText(names);
    await sort.click();
    await expect(head).toHaveAttribute('aria-sort', 'descending');
    await expect(orgCells).toHaveText([...names].reverse());

    // «В Excel» — тем же запуском, с поиском экрана: в файле три строки.
    const download = page.waitForEvent('download');
    if (onPhone(page)) await phoneListMenu(page, /^В Excel/);
    else await page.getByRole('button', { name: 'В Excel' }).click();
    await download;
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: textPattern(texts['grid.exported.few']!, { n: '3' }) }),
    ).toBeVisible();

    // Выделение и Ctrl+C — мышью и клавишами ПК (на телефоне их нет).
    if (!isMobile) {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
      const staff = result.locator('tbody td[data-dx="2"]');
      await expect(staff).toHaveText(['1', '1', '1']);
      await staff.nth(0).click();
      await staff.nth(2).click({ modifiers: ['Shift'] });
      const stat = page.locator('[data-ex-stat]');
      await expect(stat).toContainText(`${texts['kpi.ex.stat.selected']} 3`);
      await expect(stat).toContainText(`${texts['kpi.ex.stat.sum']} 3`);
      await expect(stat).toContainText(`${texts['kpi.ex.stat.avg']} 1`);
      await page.evaluate(() => navigator.clipboard.writeText(''));
      await page.keyboard.press('Control+c');
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toBe(['1', '1', '1'].join('\n'));
    }

    // Фильтр столбца — тоже по всему результату: «Организация» содержит «<слово> 2» — одна строка.
    // Подпись столбца — из шаблона `orgs` (refDB.dmTemplates), а не из словаря.
    const filter = await openColumnFilter(page, 'Организация');
    await filter.getByRole('textbox', { name: texts['grid.filter_contains'] }).fill(`${word} 2`);
    await filter.getByRole('button', { name: texts['grid.apply'], exact: true }).click();
    await expect(orgCells).toHaveText([names[1]!]);
  });

  test('(Витрина данных, «Админка», пункт 3; этап 2, П7) шаблон «Для организаций» в Админке — «глазами организации»: выбранная организация, «Показать», в «Истории» её карточки — «Открыт шаблон … глазами организации»', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const texts = await dictionary(page.request);
    const orgName = `ОсОО «${uniqueWord('Глазами')}»`;
    const org = await newOrg(page.request, origin, orgName);

    // Готовый шаблон организаций «Контрагенты» (refDB.dmTemplates, код `contractors`, без параметров).
    await page.goto('/app/dm/out');
    const tpl = page.locator('[data-dm-out-tpl]');
    await tpl.selectOption('contractors');
    const tplName = (await tpl.locator('option[value="contractors"]').textContent())!.trim();
    await page.locator('[data-dm-out-org]').selectOption(org.id);
    // Свой запуск — с выбранной организацией (автозапуск шаблона по умолчанию может ещё идти).
    const run = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === '/api/admin/dm/output/run' &&
        r.request().method() === 'POST' &&
        // 429 — ожидание очереди: «Показать» повторит запрос сам.
        r.status() !== 429 &&
        (r.request().postDataJSON() as { orgId?: string; code?: string }).code === 'contractors',
    );
    await page.locator('[data-dm-out-show]').click();
    const res = await run;
    expect(res.status(), await res.text()).toBe(200);
    expect((res.request().postDataJSON() as { orgId?: string }).orgId).toBe(org.id);

    // Карточка этой организации → «История»: запись об открытии шаблона глазами организации.
    const loaded = page.waitForResponse(
      (r) => r.url().includes(`/api/admin/organizations/${org.id}/card`) && r.ok(),
    );
    await page.goto(`/app/orgs#orgs/${org.slug}`);
    await loaded;
    const card = page.getByRole('dialog', { name: orgName });
    await cardTab(page, card, isMobile, texts['orgs.card.tab.hist']!);
    await expect(
      card
        .locator('[data-timeline-item]')
        .filter({ hasText: texts['dm.out.history_porg']!.replace('{name}', tplName) }),
    ).toHaveCount(1);
  });
});
