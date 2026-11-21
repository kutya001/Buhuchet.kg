import { expect, test, type APIRequestContext, type Response } from '@playwright/test';
import { platformAdmin, search } from './admin';
import { DEMO_PASSWORD, signIn, stillElement } from './helpers';

// «Витрина данных» → «API Токены» в Админке (доработки 20.11.2026: Витрина данных, блок 5; общий план
// 20.11, этап 1, П14; прототип v155 `renderDmTok`, `dmNewTok`, `dmShowTok`): администратор выпускает
// токен шаблона «Для администратора», токен целиком показан один раз, в списке — только начало;
// перевыпуск и отзыв. Внешний адрес по токену, «Журнал запросов» и «Как подключить» (этап 2, П11–П12).
// Токены Админки общие для всех администраторов (предел — 20 действующих): тест отзывает свои токены в
// конце (и при падении), а ищет и проверяет только их — по своему названию.

type Texts = Record<string, string>;
type Form = {
  refusal: string | null;
  demo: boolean;
  templates: { id: string; code: string; name: string }[];
  terms: number[];
  defaultTerm: number;
};

/** Слово из кириллицы, своё на каждый запуск: по нему видно только токен теста. */
const uniqueWord = (prefix: string) =>
  `${prefix}${Array.from({ length: 8 }, () => 'абвгдежзиклмнопрстуф'[Math.floor(Math.random() * 20)]).join('')}`;

/** Тексты словаря интерфейса (`GET /api/l10n`): тест не копирует строки экрана. */
async function dictionary(api: APIRequestContext): Promise<Texts> {
  const res = await api.get('/api/l10n');
  expect(res.status()).toBe(200);
  return ((await res.json()) as { texts: Texts }).texts;
}

async function tokenForm(api: APIRequestContext, path: string): Promise<Form> {
  const res = await api.get(`${path}/form`);
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as Form;
}

type Issued = {
  token: string;
  item: { id: string; prefix: string; state: string; tplName: string };
};

const tokenList = (q: string) => (r: Response) =>
  new URL(r.url()).pathname === '/api/admin/dm/tokens' &&
  new URL(r.url()).searchParams.get('q') === q &&
  r.request().method() === 'GET';

/** Готовый шаблон Админки «Организации» (refDB.dmTemplates, код `orgs`). */
const ADMIN_TEMPLATE = 'orgs';
/** Готовый шаблон Админки с двумя параметрами-датами «Активность организаций по дням». */
const PARAM_TEMPLATE = 'org-activity';

test.describe('Витрина данных: API Токены', () => {
  test('(доработки 20.11.2026, Витрина данных) администратор выпускает токен шаблона «Для администратора»: 30 дней по умолчанию, токен показан один раз, в списке только начало; «Перевыпустить» и «Отозвать»', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const texts = await dictionary(page.request);
    const form = await tokenForm(page.request, '/api/admin/dm/tokens');
    const tpl = form.templates.find((x) => x.code === ADMIN_TEMPLATE)!;
    expect(tpl, `готовый шаблон Админки «${ADMIN_TEMPLATE}»`).toBeTruthy();
    expect(form.refusal).toBeNull();
    expect(form.defaultTerm).toBe(30);
    // Что организации шаблонов Админки не видят — тесты `packages/api/src/modules/datamart/tokens.test.ts`.

    // Свои токены отзываются и при падении теста: предел 20 у Админки общий для всех администраторов.
    const mine: string[] = [];
    try {
      await page.goto('/app/dm/tok');
      const tab = page.locator('[data-dm-tokens="admin"]');
      await expect(tab).toContainText(texts['dm.tok.note_admin']!);

      // «+ Добавить» Админки — меню «Шаблон» и «Токен» (прототип v155 `dmAdd`): «Токен» открывает
      // «Новый API-токен».
      await page.getByRole('button', { name: 'Добавить', exact: true }).click();
      await page
        .getByRole('menu', { name: 'Добавить' })
        .getByRole('menuitem', { name: texts['add.dm.tok']! })
        .click();
      const dialog = page.getByRole('dialog', { name: texts['dm.tok.new.title']! });
      await expect(dialog.locator('[data-dm-new]')).toBeVisible();
      await expect(
        dialog.locator(`optgroup[label="${texts['dm.group.admin']}"] option`, {
          hasText: tpl.name,
        }),
      ).toHaveCount(1);
      const term = dialog.getByRole('group', { name: texts['dm.tok.new.term']! });
      const days30 = texts['dm.tok.term.many']!.replace('{n}', '30');
      await expect(term.getByRole('button', { name: days30 })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await dialog.getByRole('combobox').selectOption({ label: tpl.name });
      const name = uniqueWord('Токен');
      await dialog.getByLabel(texts['dm.tok.new.name']!).fill(name);
      const created = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === '/api/admin/dm/tokens' && r.request().method() === 'POST',
      );
      await dialog.locator('[data-dm-new-ok]').click();
      const res = await created;
      expect(res.status(), await res.text()).toBe(201);
      const issued = (await res.json()) as Issued;
      mine.push(issued.item.id);
      expect(issued.token).toMatch(/^bk_[0-9A-Za-z]{43}$/);
      expect(issued.token.startsWith(issued.item.prefix)).toBe(true);
      expect(issued.item.state).toBe('active');
      expect(issued.item.tplName).toBe(tpl.name);

      // Токен целиком — только в окне «Скопируйте токен»; там же «Как подключить» с этим токеном в
      // заголовке (этап 2, П12).
      const shown = page.getByRole('dialog', { name: texts['dm.tok.show.title']! });
      await expect(shown.locator('[data-dm-token-value]')).toHaveText(issued.token);
      await expect(shown.locator('[data-dm-token-copy]')).toBeVisible();
      const how = shown.locator('[data-dm-how]');
      await expect(how).toContainText(texts['dm.how.title']!);
      // Прототип v160: ссылка CSV, адрес и заголовок — отдельными кнопками, нажатие копирует; токен —
      // только в заголовке, в адресах его нет.
      const base = how.locator('[data-dm-how-chip="url"]');
      await expect(base).toContainText(`/api/ext/v1/${ADMIN_TEMPLATE}`);
      const csv = how.locator('[data-dm-how-chip="csv"]');
      await expect(csv).toContainText(`/api/ext/v1/${ADMIN_TEMPLATE}?format=csv`);
      await expect(csv).not.toContainText('bk_');
      await expect(base).not.toContainText('bk_');
      await expect(how.locator('[data-dm-how-chip="header"]')).toHaveText('Authorization');
      await expect(how.locator('[data-dm-how-chip="bearer"]')).toHaveText(`Bearer ${issued.token}`);
      await expect(how.locator('[data-dm-how-part]')).toHaveCount(0);
      // Блок на каждую программу; Excel · Power Query открыт сразу, остальные раскрываются.
      await expect(how.locator('[data-dm-how-app]')).toHaveCount(6);
      for (const [app, title] of [
        ['pq', 'dm.how.pq.title'],
        ['vba', 'dm.how.vba.title'],
        ['gs', 'dm.how.gs.title'],
        ['pbi', 'dm.how.pbi.title'],
        ['1c', 'dm.how.c1.title'],
        ['oth', 'dm.how.oth.title'],
      ] as const) {
        await expect(how.locator(`[data-dm-how-app="${app}"] summary`)).toContainText(
          texts[title]!,
        );
      }
      // (прототип v163) Токен в файле — открытым текстом: предупреждение у Excel, Power BI и 1С; у Google
      // Таблиц оно в самом скрипте, у «Других сервисов» его нет.
      await expect(how.locator('[data-dm-how-plain]')).toHaveCount(4);
      // В каждом из четырёх блоков оно первое в теле блока, перед шагами.
      for (const app of ['pq', 'vba', 'pbi', '1c'])
        await expect(
          how.locator(`[data-dm-how-app="${app}"] > div > [data-dm-how-plain]:first-child`),
        ).toHaveText(texts['dm.how.token_plain']!);
      await expect(how.locator('[data-dm-how-app="pq"] [data-dm-how-plain]')).toBeVisible();
      const pq = how.locator('[data-dm-how-code="pq"]');
      await expect(pq).toBeVisible();
      await expect(pq).toContainText(`Token = "${issued.token}"`);
      await expect(pq).toContainText('Query = [format = "csv"');
      await expect(how.locator('[data-dm-how-code="vba"]')).toBeHidden();
      // Первое нажатие в окне: на телефоне оно въезжает шторкой (типовая ошибка № 34).
      await stillElement(shown);
      await how.locator('[data-dm-how-app="vba"] summary').click();
      await expect(how.locator('[data-dm-how-code="vba"]')).toBeVisible();
      await expect(how.locator('[data-dm-how-code="vba"]')).toContainText('Sub LoadBuhuchet()');
      // Нажатие на адрес и «Скопировать код» копируют: в буфере — адрес и код целиком.
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
      await page.evaluate(() => navigator.clipboard.writeText(''));
      await base.click();
      await expect(
        page.getByRole('status').filter({ hasText: texts['dm.how.copied']! }),
      ).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toMatch(new RegExp(`^https?://[^/]+/api/ext/v1/${ADMIN_TEMPLATE}$`));
      await how.locator('[data-dm-how-copy="vba"]').click();
      await expect(
        page.getByRole('status').filter({ hasText: texts['dm.how.code_copied']! }),
      ).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toContain(`Const TOKEN As String = "${issued.token}"`);
      await page.evaluate(() => navigator.clipboard.writeText(''));
      await shown.getByRole('button', { name: texts['dm.tok.show.done']! }).click();
      await expect(shown).toBeHidden();

      // В списке — своя строка с началом токена, самого токена на странице и в ответах больше нет.
      const listed = page.waitForResponse(tokenList(name));
      await search(page, isMobile, name);
      const list = await listed;
      expect(await list.text()).not.toContain(issued.token);
      const row = page.locator(`[data-grid] [data-id="${issued.item.id}"]`);
      await expect(row).toContainText(name);
      await expect(row).toContainText(`${issued.item.prefix}…`);
      await expect(row).toContainText(texts['dm.tok.state.active']!);
      await expect(page.locator('body')).not.toContainText(issued.token);
      const card = await page.request.get(`/api/admin/dm/tokens/${issued.item.id}`, {
        maxRetries: 2,
      });
      expect(card.status()).toBe(200);
      expect(await card.text()).not.toContain(issued.token);

      // «Перевыпустить» из меню строки: новый токен снова показан один раз, прежний — «Перевыпущен:
      // работает до …».
      const menu = page.getByRole('menu', { name: 'Действия' });
      await row.locator('[data-row-menu]').click();
      await menu.getByRole('menuitem', { name: texts['dm.tok.act.reissue']! }).click();
      const ask = page.getByRole('dialog', { name: texts['dm.tok.reissue.title']! });
      const reissued = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === `/api/admin/dm/tokens/${issued.item.id}/reissue` &&
          r.request().method() === 'POST',
      );
      await ask.getByRole('button', { name: texts['dm.tok.reissue.ok']! }).click();
      const re = await reissued;
      expect(re.status(), await re.text()).toBe(201);
      const next = (await re.json()) as Issued;
      mine.push(next.item.id);
      expect(next.token).not.toBe(issued.token);
      await expect(shown.locator('[data-dm-token-value]')).toHaveText(next.token);
      await shown.getByRole('button', { name: texts['dm.tok.show.done']! }).click();
      await expect(shown).toBeHidden();
      await expect(row.locator('[data-dm-note]')).toContainText(
        texts['dm.tok.reissued_note']!.split('{till}')[0]!,
      );
      await expect(page.locator(`[data-grid] [data-id="${next.item.id}"]`)).toContainText(
        `${next.item.prefix}…`,
      );
      await expect(page.locator('body')).not.toContainText(next.token);

      // «Отозвать» из меню строки: токен «Отозван», рядом — кто и когда.
      await row.locator('[data-row-menu]').click();
      await menu.getByRole('menuitem', { name: texts['dm.tok.act.revoke']! }).click();
      const confirm = page.getByRole('dialog', { name: texts['dm.tok.revoke.title']! });
      await expect(confirm).toContainText(name);
      const revoked = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === `/api/admin/dm/tokens/${issued.item.id}/revoke` &&
          r.request().method() === 'POST',
      );
      await confirm.getByRole('button', { name: texts['dm.tok.revoke.ok']! }).click();
      expect((await revoked).status()).toBe(200);
      await expect(page.getByText(texts['dm.tok.revoke.done']!)).toBeVisible();
      await expect(row).toContainText(texts['dm.tok.state.revoked']!);
      await expect(row.locator('[data-dm-note]')).toContainText(texts['dm.tok.who_admin']!);
    } finally {
      // Отозванный отвечает 409 — это тоже «больше не действует».
      for (const id of mine) {
        const res = await page.request.post(`/api/admin/dm/tokens/${id}/revoke`, {
          headers: { origin },
          maxRetries: 2,
        });
        expect([200, 409]).toContain(res.status());
      }
    }
  });

  test('(доработки 20.11.2026, Витрина данных) внешний адрес по токену: токен только в заголовке, ответ JSON и CSV; запрос — в «Журнале запросов» Админки, строка открывает окно токена с «Как подключить»; отозванный — «Токен не подходит»', async ({
    page,
    baseURL,
    isMobile,
    playwright,
  }) => {
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const texts = await dictionary(page.request);
    const form = await tokenForm(page.request, '/api/admin/dm/tokens');
    const tpl = form.templates.find((x) => x.code === ADMIN_TEMPLATE)!;
    expect(tpl, `готовый шаблон Админки «${ADMIN_TEMPLATE}»`).toBeTruthy();
    const name = uniqueWord('Журнал');
    // Внешняя программа — без cookie входа.
    const ext = await playwright.request.newContext({ baseURL });
    const mine: string[] = [];
    try {
      const res = await page.request.post('/api/admin/dm/tokens', {
        headers: { origin },
        data: { templateId: tpl.id, name, term: form.defaultTerm },
      });
      expect(res.status(), await res.text()).toBe(201);
      const issued = (await res.json()) as Issued;
      mine.push(issued.item.id);

      // Токен в адресе не принимается: адрес попадает в журналы и историю браузера.
      const inUrl = await ext.get(`/api/ext/v1/${ADMIN_TEMPLATE}?token=${issued.token}`);
      expect(inUrl.status()).toBe(400);
      expect(((await inUrl.json()) as { error: { code: string } }).error.code).toBe(
        'dm_ext_token_in_url',
      );
      // Токен в заголовке — JSON: столбцы, строки, всего.
      const answer = await ext.get(`/api/ext/v1/${ADMIN_TEMPLATE}`, {
        headers: { authorization: `Bearer ${issued.token}` },
      });
      expect(answer.status(), await answer.text()).toBe(200);
      const body = (await answer.json()) as { columns: unknown[]; rows: unknown[]; total: number };
      expect(body.columns.length).toBeGreaterThan(0);
      // Строка на организацию: на долгой базе стенда их может быть больше страницы (1 000).
      expect(body.rows.length).toBe(Math.min(body.total, 1000));

      // «Журнал запросов»: строка этого запроса — по названию токена.
      await page.goto('/app/dm/log');
      await expect(page.locator('[data-dm-log]')).toBeVisible();
      const listed = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === '/api/admin/dm/requests' &&
          new URL(r.url()).searchParams.get('q') === name &&
          r.request().method() === 'GET',
      );
      await search(page, isMobile, name);
      expect((await listed).status()).toBe(200);
      const row = page.locator('[data-grid] [data-id]').filter({ hasText: name });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(texts['dm.res.ok']!);
      await expect(row).toContainText(`${issued.item.prefix}…`);
      await expect(row).toContainText(tpl.name);

      // Строка открывает окно токена; «Как подключить» там — без токена.
      await row.getByText(tpl.name, { exact: true }).first().click();
      const card = page.locator('[data-dm-card]');
      await expect(card).toBeVisible();
      // В коде — «bk_ВАШ_ТОКЕН» и подсказка вставить полный токен (прототип v160): начала токена в
      // коде нет, чтобы его не приняли за сам токен.
      await expect(card.locator('[data-dm-how-chip="bearer"]')).toHaveText(
        `Bearer ${texts['dm.how.placeholder']}`,
      );
      await expect(card.locator('[data-dm-how-part]')).toContainText(texts['dm.how.placeholder']!);
      await expect(card.locator('[data-dm-how-code="pq"]')).toContainText(
        `Token = "${texts['dm.how.placeholder']}"`,
      );
      // (прототип v163) Предупреждение о токене в файле — и в окне уже выпущенного токена.
      await expect(card.locator('[data-dm-how-plain]')).toHaveCount(4);
      await expect(card.locator('[data-dm-how-app="pq"] [data-dm-how-plain]')).toBeVisible();
      await expect(page.locator('body')).not.toContainText(issued.token);

      // С `?format=csv` — таблица с названиями столбцов (метка UTF-8 впереди).
      const csv = await ext.get(`/api/ext/v1/${ADMIN_TEMPLATE}?format=csv`, {
        headers: { authorization: `Bearer ${issued.token}` },
      });
      expect(csv.status(), await csv.text()).toBe(200);
      expect(csv.headers()['content-type']).toContain('text/csv');
      expect((await csv.text()).startsWith('\uFEFF')).toBe(true);
      // «Отозвать» — следующий запрос «Токен не подходит или истёк».
      const revoked = await page.request.post(`/api/admin/dm/tokens/${issued.item.id}/revoke`, {
        headers: { origin },
      });
      expect(revoked.status(), await revoked.text()).toBe(200);
      const after = await ext.get(`/api/ext/v1/${ADMIN_TEMPLATE}`, {
        headers: { authorization: `Bearer ${issued.token}` },
      });
      expect(after.status()).toBe(401);
      expect(((await after.json()) as { error: { code: string } }).error.code).toBe('dm_ext_token');
    } finally {
      await ext.dispose();
      for (const id of mine) {
        const res = await page.request.post(`/api/admin/dm/tokens/${id}/revoke`, {
          headers: { origin },
          maxRetries: 2,
        });
        expect([200, 409]).toContain(res.status());
      }
    }
  });

  test('(правки 21.11.2026, прототип v160) «Как подключить» у шаблона с параметрами: таблица параметров, параметры отдельными частями адреса и строками кода, шаги о параметрах', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const texts = await dictionary(page.request);
    const form = await tokenForm(page.request, '/api/admin/dm/tokens');
    const tpl = form.templates.find((x) => x.code === PARAM_TEMPLATE)!;
    expect(tpl, `готовый шаблон Админки «${PARAM_TEMPLATE}»`).toBeTruthy();
    const name = uniqueWord('Параметры');
    const mine: string[] = [];
    try {
      const res = await page.request.post('/api/admin/dm/tokens', {
        headers: { origin },
        data: { templateId: tpl.id, name, term: form.defaultTerm },
      });
      expect(res.status(), await res.text()).toBe(201);
      const issued = (await res.json()) as Issued;
      mine.push(issued.item.id);
      // Параметры шаблона и их значения на сегодня — из ответа окна токена.
      const cardRes = await page.request.get(`/api/admin/dm/tokens/${issued.item.id}`, {
        maxRetries: 2,
      });
      expect(cardRes.status(), await cardRes.text()).toBe(200);
      const { how: served } = (await cardRes.json()) as {
        how: { base: string; params: { code: string; name: string; value: string | null }[] };
      };
      expect(served.params.map((p) => p.code)).toEqual(['date_from', 'date_to']);
      const [from, to] = served.params as [(typeof served.params)[0], (typeof served.params)[0]];
      expect(from.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(to.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      await page.goto(`/app/dm/tok?tok=${issued.item.id}`);
      const card = page.getByRole('dialog', { name });
      const how = card.locator('[data-dm-how]');
      await expect(how).toBeVisible();
      // «Ссылка CSV» — с параметрами по умолчанию, «Адрес» — без них.
      const query = `?format=csv&date_from=${from.value}&date_to=${to.value}`;
      await expect(how.locator('[data-dm-how-chip="csv"]')).toHaveText(`${served.base}${query}`);
      await expect(how.locator('[data-dm-how-chip="url"]')).toHaveText(served.base);
      // Таблица «Параметр / Значение / Что это»: строка на параметр, код и значение — кнопками-копиями.
      const rows = how.locator('[data-dm-how-params] tbody tr');
      await expect(rows).toHaveCount(2);
      for (const [i, p] of [from, to].entries()) {
        await expect(rows.nth(i).getByRole('button', { name: p.code, exact: true })).toBeVisible();
        await expect(
          rows.nth(i).getByRole('button', { name: p.value!, exact: true }),
        ).toBeVisible();
        await expect(rows.nth(i)).toContainText(p.name);
        await expect(rows.nth(i)).toContainText(texts['dm.how.fmt.date']!);
        await expect(rows.nth(i)).not.toContainText(texts['dm.how.optional']!);
      }
      // Excel · Power Query открыт сразу: части адреса по одной, шаги о параметрах и формула ячейки.
      const pq = how.locator('[data-dm-how-app="pq"]');
      for (const part of [
        `${served.base}?format=csv`,
        `&date_from=${from.value}`,
        `&date_to=${to.value}`,
      ]) {
        await expect(pq.getByRole('button', { name: part, exact: true })).toBeVisible();
      }
      await expect(pq).toContainText(texts['dm.how.pq.b3']!);
      await expect(pq).toContainText(texts['dm.how.pq.b4_privacy']!);
      await expect(
        pq.getByRole('button', {
          name: 'Date.ToText(Date.From(Excel.CurrentWorkbook(){[Name="date_from"]}[Content]{0}[Column1]), "yyyy-MM-dd")',
          exact: true,
        }),
      ).toBeVisible();
      const code = how.locator('[data-dm-how-code="pq"]');
      await expect(code).toContainText(texts['dm.how.code.params_refresh']!);
      await expect(code).toContainText(`= "${from.value}",   // date_from, `);
      await expect(code).toContainText('Query = [format = "csv", date_from = #"');
      // Остальные блоки раскрываются: у макроса и у «Других сервисов» — свои шаги о параметрах.
      await stillElement(card);
      await how.locator('[data-dm-how-app="vba"] summary').click();
      const vba = how.locator('[data-dm-how-app="vba"]');
      await expect(vba.locator('[data-dm-how-code="vba"]')).toBeVisible();
      await expect(
        vba.getByRole('button', { name: 'Range("B1").Text', exact: true }),
      ).toBeVisible();
      await expect(vba.locator('[data-dm-how-code="vba"]')).toContainText(
        `?format=csv" & "&date_from=" & WorksheetFunction.EncodeURL(p1) & "&date_to=" & WorksheetFunction.EncodeURL(p2)`,
      );
      await how.locator('[data-dm-how-app="oth"] summary').click();
      const oth = how.locator('[data-dm-how-app="oth"]');
      await expect(oth.locator('[data-dm-how-code="curl"]')).toBeVisible();
      await expect(
        oth.getByRole('button', { name: `date_from=${from.value}`, exact: true }),
      ).toBeVisible();
      await expect(oth.locator('[data-dm-how-code="curl"]')).toContainText(
        `"${served.base}${query}"`,
      );
      await expect(oth.locator('[data-dm-how-code="py"]')).toContainText(
        `PARAMS = {"date_from": "${from.value}", "date_to": "${to.value}"}`,
      );
      await expect(page.locator('body')).not.toContainText(issued.token);
    } finally {
      for (const id of mine) {
        const res = await page.request.post(`/api/admin/dm/tokens/${id}/revoke`, {
          headers: { origin },
          maxRetries: 2,
        });
        expect([200, 409]).toContain(res.status());
      }
    }
  });

  test('(доработки 20.11.2026, Витрина данных) срок больше 180 дней задать нельзя; в демо-организации токен не выпускается', async ({
    page,
    baseURL,
    playwright,
  }) => {
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const form = await tokenForm(page.request, '/api/admin/dm/tokens');
    expect(form.terms).toEqual([7, 30, 90, 180]);
    // Срок проверяется раньше шаблона и названия: отказ один и тот же при любом шаблоне.
    for (const term of [181, 365]) {
      const res = await page.request.post('/api/admin/dm/tokens', {
        headers: { origin },
        data: { templateId: crypto.randomUUID(), name: uniqueWord('Срок'), term },
      });
      expect(res.status()).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('dm_token_term');
    }

    // Демо-организация: окно отвечает отказом, выпуск — 403 (экран организации подключает этап 2).
    const demo = await playwright.request.newContext({ baseURL });
    try {
      await signIn(demo, origin, 'erkin', DEMO_PASSWORD);
      const demoForm = await tokenForm(demo, '/api/dm/tokens');
      expect(demoForm.demo).toBe(true);
      expect(demoForm.refusal).toBe('dm_token_demo');
      const res = await demo.post('/api/dm/tokens', {
        headers: { origin },
        data: { templateId: crypto.randomUUID(), name: uniqueWord('Демо'), term: 30 },
      });
      expect(res.status()).toBe(403);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('dm_token_demo');
    } finally {
      await demo.dispose();
    }
  });

  test('(доработки 20.11.2026, Витрина данных, блок 5, пункт 10) ссылка на окно токена из колокольчика и кнопки «Открыть» бота: «API Токены» с ?tok= открывает окно этого токена и убирает номер из адреса', async ({
    page,
    baseURL,
  }) => {
    // Строка колокольчика и «Открыть» в сообщении владельцам ведут на `/app/dm/tok?tok=<номер>`
    // (общий план 20.11, этап 3, П5). У Админки та же вкладка — проверяется на своём токене; цепочку
    // от строки владельца организации — `e2e/org-ext-api.spec.ts` (модуль в меню организации, этап 3, П2).
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const texts = await dictionary(page.request);
    const form = await tokenForm(page.request, '/api/admin/dm/tokens');
    const tpl = form.templates.find((x) => x.code === ADMIN_TEMPLATE)!;
    expect(tpl, `готовый шаблон Админки «${ADMIN_TEMPLATE}»`).toBeTruthy();
    const name = uniqueWord('Ссылка');
    const mine: string[] = [];
    try {
      const res = await page.request.post('/api/admin/dm/tokens', {
        headers: { origin },
        data: { templateId: tpl.id, name, term: form.defaultTerm },
      });
      expect(res.status(), await res.text()).toBe(201);
      const issued = (await res.json()) as Issued;
      mine.push(issued.item.id);

      await page.goto(`/app/dm/tok?tok=${issued.item.id}`);
      const card = page.getByRole('dialog', { name });
      await expect(card.locator('[data-dm-card]')).toBeVisible();
      await expect(card).toContainText(`${issued.item.prefix}…`);
      await expect(page).not.toHaveURL(/[?&]tok=/);
      await expect(page.locator('[data-dm-tokens="admin"]')).toContainText(
        texts['dm.tok.note_admin']!,
      );
    } finally {
      for (const id of mine) {
        const res = await page.request.post(`/api/admin/dm/tokens/${id}/revoke`, {
          headers: { origin },
          maxRetries: 2,
        });
        expect([200, 409]).toContain(res.status());
      }
    }
  });
});
