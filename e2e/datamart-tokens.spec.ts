import { expect, test, type APIRequestContext, type Response } from '@playwright/test';
import { platformAdmin, search } from './admin';
import { DEMO_PASSWORD, newOrgOwner, signIn } from './helpers';

// «Витрина данных» → «API Токены» в Админке (доработки 20.11.2026: Витрина данных, блок 5; общий план
// 20.11, этап 1, П14; прототип v155 `renderDmTok`, `dmNewTok`, `dmShowTok`): администратор выпускает
// токен шаблона «Для администратора», токен целиком показан один раз, в списке — только начало; отзыв.
// Токены Админки общие для всех администраторов (предел — 20 действующих): тест отзывает свой токен в
// конце, а ищет и проверяет только его — по своему названию.

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

const tokenList = (q: string) => (r: Response) =>
  new URL(r.url()).pathname === '/api/admin/dm/tokens' &&
  new URL(r.url()).searchParams.get('q') === q &&
  r.request().method() === 'GET';

/** Готовый шаблон Админки «Организации» (refDB.dmTemplates, код `orgs`). */
const ADMIN_TEMPLATE = 'orgs';

test.describe('Витрина данных: API Токены', () => {
  test('(доработки 20.11.2026, Витрина данных) администратор выпускает токен шаблона «Для администратора»: 30 дней по умолчанию, токен показан один раз, в списке только начало; организации шаблон не видят; «Отозвать»', async ({
    page,
    baseURL,
    isMobile,
    playwright,
  }) => {
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const texts = await dictionary(page.request);
    const form = await tokenForm(page.request, '/api/admin/dm/tokens');
    const tpl = form.templates.find((x) => x.code === ADMIN_TEMPLATE);
    // Заглушка до слияния потока К (этап 1, П11): готовые шаблоны «Витрины данных» наполняет его
    // `seedDmTemplates`; в общей сборке этапа 1 шаблон есть всегда, и сборка эту строку убирает.
    test.skip(!tpl, 'до слияния потока К: готовых шаблонов Админки ещё нет');
    expect(form.refusal).toBeNull();
    expect(form.defaultTerm).toBe(30);

    // Организация шаблонов Админки не видит: ни в окне «Новый API-токен», ни в выпуске.
    const org = await playwright.request.newContext({ baseURL });
    try {
      await newOrgOwner(org, origin);
      const orgForm = await tokenForm(org, '/api/dm/tokens');
      expect(orgForm.templates.map((x) => x.id)).not.toContain(tpl!.id);
    } finally {
      await org.dispose();
    }

    await page.goto('/app/dm/tok');
    const tab = page.locator('[data-dm-tokens="admin"]');
    await expect(tab).toContainText(texts['dm.tok.note_admin']!);

    // «+ Добавить» с одним способом сразу открывает «Новый API-токен».
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: texts['dm.tok.new.title']! });
    await expect(dialog.locator('[data-dm-new]')).toBeVisible();
    await expect(
      dialog.locator(`optgroup[label="${texts['dm.group.admin']}"] option`, { hasText: tpl!.name }),
    ).toHaveCount(1);
    const term = dialog.getByRole('group', { name: texts['dm.tok.new.term']! });
    const days30 = texts['dm.tok.term.many']!.replace('{n}', '30');
    await expect(term.getByRole('button', { name: days30 })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await dialog.getByRole('combobox').selectOption({ label: tpl!.name });
    const name = uniqueWord('Токен');
    await dialog.getByLabel(texts['dm.tok.new.name']!).fill(name);
    const created = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === '/api/admin/dm/tokens' && r.request().method() === 'POST',
    );
    await dialog.locator('[data-dm-new-ok]').click();
    const res = await created;
    expect(res.status(), await res.text()).toBe(201);
    const issued = (await res.json()) as {
      token: string;
      item: { id: string; prefix: string; state: string; tplName: string };
    };
    expect(issued.token).toMatch(/^bk_[0-9A-Za-z]{43}$/);
    expect(issued.token.startsWith(issued.item.prefix)).toBe(true);
    expect(issued.item.state).toBe('active');
    expect(issued.item.tplName).toBe(tpl!.name);

    // Токен целиком — только в окне «Скопируйте токен».
    const shown = page.getByRole('dialog', { name: texts['dm.tok.show.title']! });
    await expect(shown.locator('[data-dm-token-value]')).toHaveText(issued.token);
    await expect(shown.locator('[data-dm-token-copy]')).toBeVisible();
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
    const card = await page.request.get(`/api/admin/dm/tokens/${issued.item.id}`);
    expect(card.status()).toBe(200);
    expect(await card.text()).not.toContain(issued.token);

    // «Отозвать» из меню строки: токен «Отозван», рядом — кто и когда.
    await row.locator('[data-row-menu]').click();
    await page
      .getByRole('menu', { name: 'Действия' })
      .getByRole('menuitem', { name: texts['dm.tok.act.revoke']! })
      .click();
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
