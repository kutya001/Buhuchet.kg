import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { platformAdmin, search } from './admin';

// «Витрина данных» → «Консоль» Админки (доработки 27.11.2026: консоль запросов, этап 1, П4–П6; прототип
// v166 `renderDmCon`, `dmcRun`, `dmcMineDlg`, `dmcPhone`, `dmTplToCon`, `dmcFromMethod`): цепочки окон
// блока 1, пункт 7, блока 4, пункт 5, блока 5, пункт 6, «Мои запросы» и телефон. Свои записи теста —
// шаблон и запрос со своим словом в названии, вход — свой администратор платформы: «Мои запросы» и
// «История» у него пустые, вкладки консоли — свои (у каждого входа — свои).

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

/** Текст словаря без подстановок `{…}`: части между ними, по которым можно искать. */
const textPart = (text: string) =>
  text
    .split(/\{[a-z_]+\}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0]!;

/**
 * Нажать кнопку, которая запускает запрос (`POST path`, у «Сохранить» шаблона — `PUT`), и дождаться
 * ответа не 429: место запуска консоли одно на весь сайт (блок 2, пункт 3), места «Проверить»,
 * «Опубликовать» и «Сохранить» опубликованного — два, а сквозные тесты «Витрины» идут параллельно.
 * Любой другой ответ — итог нажатия.
 */
async function pressRun(
  page: Page,
  button: Locator,
  path: string,
  method: 'POST' | 'PUT' = 'POST',
): Promise<void> {
  await expect(async () => {
    const res = page.waitForResponse(
      (r) => new URL(r.url()).pathname === path && r.request().method() === method,
    );
    await button.click();
    expect((await res).status()).not.toBe(429);
  }).toPass({ timeout: 30_000, intervals: [250, 500, 1_000] });
}

const editorOf = (scope: Page | Locator) => scope.locator('[data-dm-ed-query]');

test.describe('Витрина данных: консоль запросов, этап 1', () => {
  test('(консоль, блок 1, пункт 7; блок 3; блок 4, пункт 5) «Консоль» → запрос с подсказками → «Выполнить» → деньги в сомах → «Сохранить в шаблон» → окно шаблона с запросом и столбцами → «Проверить» → «Опубликовать»; шаблон → «Открыть в консоли» → правка → «Сохранить в шаблон» → «Изменено: запрос» → «Сохранить»', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    test.skip(isMobile, 'писать запросы — на ПК (блок 1, пункт 6); телефон — отдельный тест');
    // Цепочка из двух окон шаблона и четырёх запусков на общих местах запуска (до 30 с ожидания каждое).
    test.slow();
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const texts = await dictionary(page.request);
    const name = uniqueWord('Консоль проверки ');
    const code = `e2e-con-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

    await page.goto('/app/dm/con');
    const pc = page.locator('[data-dm-con]');
    await expect(pc).toBeVisible();
    // Первый вход — одна вкладка «Запрос 1» с начальным запросом; слева — «База» по группам схемы.
    await expect(pc.locator('[data-dm-con-tab]')).toHaveCount(1);
    await expect(pc.locator('[data-dm-con-tab]')).toContainText(
      texts['dm.con.tab.name']!.replace('{n}', '1'),
    );
    await expect(pc.locator('[data-dm-con-table="contractors"]')).toBeAttached();
    const editor = editorOf(pc);

    // Подсказки (блок 3, пункт 2): после FROM — таблицы, и по-русски; после «псевдоним.» — поля.
    await editor.fill('SELECT * FROM rep');
    await page.keyboard.press('Control+Space');
    const options = page.locator('.cm-tooltip-autocomplete [role="option"]');
    await expect(options.filter({ hasText: /^reports/ })).toHaveCount(1);
    await page.keyboard.press('Escape');
    await editor.fill('SELECT * FROM отч');
    await page.keyboard.press('Control+Space');
    await expect(options.filter({ hasText: /^reports/ })).toHaveCount(1);
    await page.keyboard.press('Escape');
    await editor.fill('SELECT * FROM reports r WHERE r.');
    await page.keyboard.press('Control+Space');
    await expect(options.filter({ hasText: 'contractor_id' })).toHaveCount(1);
    await page.keyboard.press('Escape');
    // Ошибки по ходу набора (блок 3, пункт 4): таблицы нет в базе — строка под редактором.
    await editor.fill('SELECT * FROM nosuch_table');
    await expect(pc.locator('[data-dm-con-errs]')).toContainText(
      texts['dm.con.no_table']!.replace('{table}', 'nosuch_table'),
    );

    // «Выполнить»: результат под редактором; деньги — в сомах с пометкой «в базе тыйыны» (блок 1, пункт 5).
    const query = "SELECT 'один' AS word, 12550::bigint AS amount";
    await editor.fill(query);
    await expect(pc.locator('[data-dm-con-errs]')).toHaveCount(0);
    await pressRun(page, pc.locator('[data-dm-con-run]'), '/api/admin/dm/console/run');
    const result = pc.locator('[data-dm-con-res="rows"]');
    await expect(result).toContainText(texts['dm.con.money_note']!);
    await expect(result).toContainText(texts['dm.con.som']!.replace('{name}', 'amount'));
    await expect(result).toContainText('125,50');

    // «Сохранить в шаблон»: обычное окно шаблона, запрос и столбцы последнего запуска уже стоят.
    await pc.locator('[data-dm-con-tpl]').click();
    const dialog = page.getByRole('dialog', { name: texts['dm.ed.new']! });
    await expect(dialog).toContainText(texts['dm.ed.new_sub_con']!);
    await expect(editorOf(dialog)).toHaveText(query);
    await expect(dialog.locator('[data-dm-ed-col="word"]')).toBeVisible();
    await expect(dialog.locator('[data-dm-ed-col="amount"]')).toBeVisible();
    await dialog.getByRole('textbox', { name: texts['dm.ed.name']! }).first().fill(name);
    await dialog.getByRole('textbox', { name: texts['dm.ed.code']! }).fill(code);
    await dialog
      .getByRole('combobox', { name: texts['dm.ed.kind']!, exact: true })
      .selectOption('admin');
    await pressRun(page, dialog.locator('[data-dm-ed-check]'), '/api/admin/dm/templates/check');
    const publish = dialog.locator('[data-dm-ed-publish]');
    await expect(publish).toBeEnabled();
    await pressRun(page, publish, '/api/admin/dm/templates');
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole('status').filter({ hasText: texts['dm.ed.published']! }),
    ).toBeVisible();

    // «Шаблоны» → шаблон → «Открыть в консоли»: своя вкладка с именем шаблона и его запросом.
    const findOwn = async () => {
      await page.goto('/app/dm/tpl');
      await expect(page.locator('[data-dm-tpl-admin] [data-grid]')).toBeVisible();
      await search(page, false, name);
      const row = page
        .locator('[data-dm-tpl-admin] [data-grid] [data-id]')
        .filter({ hasText: name });
      await expect(row).toHaveCount(1);
      return row;
    };
    const own = await findOwn();
    const id = (await own.getAttribute('data-id'))!;
    await own.locator('[data-row-menu]').click();
    await page
      .getByRole('menu', { name: 'Действия' })
      .getByRole('menuitem', { name: texts['dm.tpl.act.console']! })
      .click();
    await expect(page).toHaveURL(/\/app\/dm\/con$/);
    const current = pc.locator('[data-dm-con-tab][aria-current="true"]');
    await expect(current).toContainText(name);
    await expect(pc.locator('[data-dm-con-tpl-of]')).toContainText(name);
    await expect(editor).toHaveText(query);

    // Правка → «Выполнить» → «Сохранить в шаблон»: окно этого шаблона, «Изменено: запрос».
    const changed = "SELECT 'два' AS word, 12550::bigint AS amount";
    await editor.fill(changed);
    await pressRun(page, pc.locator('[data-dm-con-run]'), '/api/admin/dm/console/run');
    await expect(pc.locator('[data-dm-con-res="rows"]')).toContainText('два');
    await pc.locator('[data-dm-con-tpl]').click();
    const card = page.getByRole('dialog', { name });
    await expect(card.locator('[data-dm-ed-changed]')).toHaveText(texts['dm.ed.sql_changed']!);
    await expect(editorOf(card)).toHaveText(changed);
    await pressRun(page, card.locator('[data-dm-ed-check]'), '/api/admin/dm/templates/check');
    // Опубликованный шаблон с новым запросом сервер проверяет ещё раз — на общем месте запуска.
    await pressRun(page, card.locator('[data-dm-ed-save]'), `/api/admin/dm/templates/${id}`, 'PUT');
    await expect(card).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: texts['dm.ed.saved']! })).toBeVisible();

    // Окно шаблона → «Открыть в консоли» (блок 4, пункт 3): та же вкладка, сохранённый запрос,
    // прежнего результата нет.
    await (await findOwn()).click();
    const again = page.getByRole('dialog', { name });
    await again.locator('[data-dm-ed-console]').click();
    await expect(again).toBeHidden();
    await expect(page).toHaveURL(/\/app\/dm\/con$/);
    await expect(current).toContainText(name);
    await expect(editor).toHaveText(changed);
    await expect(pc.locator('[data-dm-con-res="rows"]')).toHaveCount(0);
  });

  test('(консоль, блок 4, пункт 2) «Сохранить в Мои запросы» — запрос в списке автора; запуск — строка «Истории»; удалить — с вопросом', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    test.skip(isMobile, 'на телефоне «Мои запросы» только запускаются — отдельный тест');
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const texts = await dictionary(page.request);
    const name = uniqueWord('Мой запрос ');

    await page.goto('/app/dm/con');
    const pc = page.locator('[data-dm-con]');
    const query = "SELECT 'мой' AS word";
    await editorOf(pc).fill(query);
    await pressRun(page, pc.locator('[data-dm-con-run]'), '/api/admin/dm/console/run');
    await expect(pc.locator('[data-dm-con-res="rows"]')).toContainText('мой');

    await pc.locator('[data-dm-con-mine]').click();
    const dlg = page.locator('[data-dm-con-mine-dlg]');
    await dlg.getByRole('textbox').first().fill(name);
    await page.locator('[data-dm-con-mine-ok]').click();
    await expect(
      page.getByRole('status').filter({ hasText: texts['dm.con.mine.saved']! }),
    ).toBeVisible();
    // Вкладка получила название запроса; слева — «Мои запросы» с ним.
    await expect(pc.locator('[data-dm-con-tab][aria-current="true"]')).toContainText(name);
    const row = pc.locator('[data-dm-con-mine-row]').filter({ hasText: name });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(query);

    // «История»: свой запуск — строка с исходом «Успешно».
    await pc.locator('[data-dm-con-mq="hist"]').click();
    const hist = pc.locator('[data-dm-con-hist-row]').filter({ hasText: query });
    await expect(hist.first()).toContainText(texts['dm.con.outcome.ok']!);

    // Удалить — с вопросом; запрос пропадает из списка.
    await pc.locator('[data-dm-con-mq="mine"]').click();
    await row.locator('[data-dm-con-mdel]').click();
    const ask = page.getByRole('dialog', { name: texts['dm.con.mine.del_title']! });
    await expect(ask).toContainText(textPart(texts['dm.con.mine.del_text']!));
    await ask.getByRole('button', { name: texts['dm.con.mine.del']! }).click();
    await expect(
      page.getByRole('status').filter({ hasText: texts['dm.con.mine.deleted']! }),
    ).toBeVisible();
    await expect(row).toHaveCount(0);
  });

  test('(консоль, блок 5, пункты 1, 4, 6) «Техническая документация» → «API» → метод чтения с точным SQL → «Открыть в консоли» — SELECT и предупреждение; «Создать шаблон на основе» — окно нового шаблона с названием из описания метода', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    test.skip(isMobile, 'писать запросы — на ПК (блок 1, пункт 6)');
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const texts = await dictionary(page.request);
    const METHOD = 'GET /admin/files';
    const info = await page.request.get(
      `/api/admin/tech-docs/method?id=${encodeURIComponent(METHOD)}`,
    );
    expect(info.status()).toBe(200);
    const summary = ((await info.json()) as { summary: string }).summary;

    const openCard = async () => {
      await page.goto('/app/tdocs/api');
      await expect(page.locator('[data-grid]')).toBeVisible();
      await search(page, false, '/admin/files');
      await page.locator(`[data-grid] [data-id="${METHOD}"]`).click();
      const card = page.getByRole('dialog', { name: METHOD });
      await expect(card).toContainText(texts['tdocs.card.readonly_con']!);
      return card;
    };

    // «Открыть в консоли»: вкладка консоли с SELECT вместо CREATE VIEW, предупреждение — дословно.
    let card = await openCard();
    await card.locator('[data-td-con]').click();
    await expect(page).toHaveURL(/\/app\/dm\/con$/);
    const pc = page.locator('[data-dm-con]');
    const notes = pc.locator('[data-dm-con-notes]');
    await expect(notes).toContainText(texts['dm.con.warn']!);
    await expect(notes).toContainText(texts['dm.con.from']!.replace('{method}', METHOD));
    await expect(editorOf(pc)).toContainText('SELECT');
    await expect(editorOf(pc)).not.toContainText('CREATE VIEW');
    await expect(pc.locator('[data-dm-con-tab][aria-current="true"]')).toContainText(summary);
    // «Что заменено»: CREATE VIEW → SELECT и убранные проверки доступа — словами словаря.
    const changedNote = notes.locator('[data-dm-con-changed]');
    await expect(changedNote).toContainText(textPart(texts['dm.con.rw.view']!));
    await expect(changedNote).toContainText(texts['dm.con.rw.checks']!);
    // Запуск перестроенного запроса каждого метода снимка — тест API `console-queries.test.ts`.

    // «Создать шаблон на основе»: то же и сразу окно нового шаблона, название — из описания метода.
    card = await openCard();
    await card.locator('[data-td-tpl]').click();
    const dialog = page.getByRole('dialog', { name: texts['dm.ed.new']! });
    await expect(dialog.getByRole('textbox', { name: texts['dm.ed.name']! }).first()).toHaveValue(
      summary,
    );
    await expect(editorOf(dialog)).toContainText('SELECT');
  });

  test('(консоль, блок 1, пункт 6) телефон: «Мои запросы» — список, запуск и результат; писать запросы — на ПК', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    test.skip(!isMobile, 'телефон');
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const texts = await dictionary(page.request);
    const name = uniqueWord('Запрос телефона ');
    const saved = await page.request.post('/api/admin/dm/console/queries', {
      headers: { origin },
      data: { name, query: "SELECT 'телефон' AS word", params: {} },
    });
    expect(saved.status(), await saved.text()).toBe(201);
    const { id } = (await saved.json()) as { id: string };

    await page.goto('/app/dm/con');
    const phone = page.locator('[data-dm-con-phone]');
    await expect(phone).toContainText(texts['dm.con.phone_note']!);
    await expect(page.locator('[data-dm-con]')).toHaveCount(0);
    await phone.locator(`[data-dm-con-pm="${id}"]`).click();
    await pressRun(page, phone.locator('[data-dm-con-run]'), '/api/admin/dm/console/run');
    await expect(phone.locator('[data-dm-con-res="rows"]')).toContainText('телефон');
  });
});

// Этап 2 (П7–П9; прототип v167 `dmcSide` `pre`, `dmcBuild`, `#dmc-as`, `dmcToTpl`): заготовки, сборщик
// из панели «База», «Выполнять как организация». Свой администратор платформы — вкладки консоли свои.
test.describe('Витрина данных: консоль запросов, этап 2', () => {
  test('(консоль, этап 2, блок 4, пункт 1) «Заготовки» → заготовка открывается вкладкой и выполняется; готовый шаблон → «Открыть в консоли»', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    test.skip(isMobile, 'панель консоли — на ПК');
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const texts = await dictionary(page.request);

    await page.goto('/app/dm/con');
    const pc = page.locator('[data-dm-con]');
    await expect(pc).toBeVisible();
    await pc.locator('[data-dm-con-sidetab="pre"]').click();
    const pre = pc.locator('[data-dm-con-pre]');
    await expect(pre.locator('[data-dm-con-pre-row]').first()).toBeVisible();
    await pre.locator('[data-dm-con-pre-row="overdue"] button').click();
    const current = pc.locator('[data-dm-con-tab][aria-current="true"]');
    await expect(current).toContainText(texts['dm.con.pre.overdue']!);
    await expect(editorOf(pc)).toContainText('current_date - r.due_date');
    await pressRun(page, pc.locator('[data-dm-con-run]'), '/api/admin/dm/console/run');
    await expect(pc.locator('[data-dm-con-res="rows"]')).toBeVisible();

    // Готовые шаблоны платформы — под заготовками, «Открыть в консоли» — вкладка шаблона.
    const tpl = pre.locator('[data-dm-con-pre-tpl="contractors"]');
    const name = (await tpl.locator('b').first().textContent())!;
    await tpl.getByRole('button', { name: texts['dm.con.api.open']! }).click();
    await expect(current).toContainText(name);
    await expect(pc.locator('[data-dm-con-tpl-of]')).toContainText(name);
  });

  test('(консоль, этап 2, блок 6) «База» → «Собрать запрос» → отмечены contractors, reports, money_operations → путь связей, «Суммы задвоятся» → «Считать итоги отдельно» → «Открыть в консоли» → «Выполнить» → «Сохранить в шаблон» со столбцом «Контрагент (для области)»', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    test.skip(isMobile, 'сборщик — на ПК');
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const texts = await dictionary(page.request);

    await page.goto('/app/dm/con');
    const pc = page.locator('[data-dm-con]');
    await expect(pc).toBeVisible();
    await pc.locator('[data-dm-con-sidetab="db"]').click();
    await pc.locator('[data-dm-con-pick-start]').click();
    for (const table of ['contractors', 'reports', 'money_operations']) {
      await pc.locator(`[data-dm-con-pick-row="${table}"] input`).check();
    }
    await pc.locator('[data-dm-con-pick-go]').click();

    const win = page.locator('[data-dm-b]');
    await expect(win).toBeVisible();
    // Путь связей: отчёты и деньги — к контрагенту, по внешним ключам базы.
    await expect(win.locator('[data-dm-b-table]')).toHaveCount(3);
    await expect(win.locator('[data-dm-b-table="reports"] [data-dm-b-link]')).toContainText(
      'contractor_id',
    );
    await expect(win.locator('[data-dm-b-none]')).toHaveCount(0);
    const sql = win.locator('[data-dm-b-sql]');
    await expect(sql).toContainText('LEFT JOIN reports');
    // Удалённые и заменённые записи исключены сразу (блок 6, пункт 3).
    await expect(sql).toContainText('NOT r.superseded');
    // Две таблицы «много на одного» — предупреждение и «Считать итоги отдельно» (блок 6, пункт 4).
    await expect(win.locator('[data-dm-b-dbl]')).toContainText(texts['dm.b.dbl']!);
    await win.locator('[data-dm-b-sep]').click();
    await expect(sql).toContainText('WITH');
    await win.locator('[data-dm-b-go]').click();
    await expect(win).toBeHidden();

    const current = pc.locator('[data-dm-con-tab][aria-current="true"]');
    await expect(current).toContainText(textPart(texts['dm.b.name']!));
    const editor = editorOf(pc);
    await expect(editor).toContainText('WITH');
    await pressRun(page, pc.locator('[data-dm-con-run]'), '/api/admin/dm/console/run');
    await expect(pc.locator('[data-dm-con-res="rows"]')).toBeVisible();

    // «Сохранить в шаблон»: в запросе есть контрагенты — столбец contractor_id «Контрагент (для
    // области)» добавлен сам, уведомление называет модуль (блок 2, пункт 8).
    await pc.locator('[data-dm-con-tpl]').click();
    const dialog = page.getByRole('dialog', { name: texts['dm.ed.new']! });
    await expect(dialog.locator('[data-dm-ed-col="contractor_id"]')).toBeVisible();
    await expect(editorOf(dialog)).toContainText('AS contractor_id');
    await expect(
      page.getByRole('status').filter({ hasText: textPart(texts['dm.con.cp_auto']!) }),
    ).toBeVisible();
  });

  test('(консоль, этап 2, блок 2, пункт 8) «Выполнять как: Организация …» — результат организации с пометкой; таблица платформы — «данные платформы, организациям закрыта»', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    test.skip(isMobile, 'писать запросы — на ПК');
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const texts = await dictionary(page.request);

    await page.goto('/app/dm/con');
    const pc = page.locator('[data-dm-con]');
    await expect(pc).toBeVisible();
    const as = pc.locator('[data-dm-con-as]');
    const demoMark = texts['dm.con.as.org_demo']!.split('{name}')[1]!.trim();
    const demo = as.locator('option').filter({ hasText: demoMark });
    await expect(demo).toHaveCount(1);
    await as.selectOption((await demo.getAttribute('value'))!);
    await expect(pc.locator('[data-dm-con-as-hint]')).toContainText(
      textPart(texts['dm.con.as.hint_org']!),
    );

    const editor = editorOf(pc);
    await editor.fill('SELECT count(*) AS n FROM contractors');
    await pressRun(page, pc.locator('[data-dm-con-run]'), '/api/admin/dm/console/run');
    await expect(pc.locator('[data-dm-con-res="rows"] [data-dm-con-res-as]')).toContainText(
      textPart(texts['dm.con.res_as']!),
    );

    await editor.fill('SELECT count(*) AS n FROM platform_leads');
    await pressRun(page, pc.locator('[data-dm-con-run]'), '/api/admin/dm/console/run');
    await expect(pc.locator('[data-dm-con-error]')).toContainText(
      texts['err.dm_console_closed']!.replace('{table}', 'platform_leads'),
    );
  });

  test('(консоль, этап 2, блок 1, пункт 6) телефон: готовый шаблон → «Открыть в консоли» — запрос и запуск на телефоне', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    test.skip(!isMobile, 'телефон');
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const texts = await dictionary(page.request);
    const list = await page.request.get('/api/admin/dm/templates?size=all&sort=name.asc');
    expect(list.status()).toBe(200);
    const { items } = (await list.json()) as {
      items: { id: string; name: string; code: string; builtin: boolean }[];
    };
    const tpl = items.find((x) => x.builtin && x.code === 'contractors')!;
    expect(tpl).toBeTruthy();

    await page.goto('/app/dm/tpl');
    await expect(page.locator('[data-dm-tpl-admin] [data-grid]')).toBeVisible();
    await search(page, true, tpl.name);
    const row = page.locator(`[data-dm-tpl-admin] [data-grid] [data-id="${tpl.id}"]`);
    await row.locator('[data-row-menu]').click();
    await page
      .getByRole('menu', { name: 'Действия' })
      .getByRole('menuitem', { name: texts['dm.tpl.act.console']! })
      .click();
    await expect(page).toHaveURL(/\/app\/dm\/con$/);
    const phone = page.locator('[data-dm-con-phone]');
    await expect(phone).toContainText(tpl.name);
    await pressRun(page, phone.locator('[data-dm-con-run]'), '/api/admin/dm/console/run');
    await expect(phone.locator('[data-dm-con-res="rows"]')).toBeVisible();
  });
});
