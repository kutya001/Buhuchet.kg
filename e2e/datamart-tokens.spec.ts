import { expect, test, type APIRequestContext, type Response } from '@playwright/test';
import { platformAdmin, search } from './admin';
import { DEMO_PASSWORD, signIn } from './helpers';

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

      // «+ Добавить» с одним способом сразу открывает «Новый API-токен».
      await page.getByRole('button', { name: 'Добавить', exact: true }).click();
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
      await expect(how.locator('[data-dm-how-url]')).toContainText(`/api/ext/v1/${ADMIN_TEMPLATE}`);
      await expect(how.locator('[data-dm-how-header]')).toHaveText(
        `Authorization: Bearer ${issued.token}`,
      );
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

  test('(доработки 20.11.2026, Витрина данных) внешний адрес по токену: токен только в заголовке, ответ JSON; запрос — в «Журнале запросов» Админки, строка открывает окно токена с «Как подключить»', async ({
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
      expect(body.total).toBe(body.rows.length);

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

      // Строка открывает окно токена; «Как подключить» там — с началом токена, не с токеном.
      await row.getByText(tpl.name, { exact: true }).first().click();
      const card = page.locator('[data-dm-card]');
      await expect(card).toBeVisible();
      await expect(card.locator('[data-dm-how-header]')).toHaveText(
        `Authorization: Bearer ${issued.item.prefix}…`,
      );
      await expect(page.locator('body')).not.toContainText(issued.token);
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
});
