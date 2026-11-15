import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { platformAdmin } from './admin';
import { orgWithTypes } from './orgs';

// Админка → «База знаний (содержимое)» → «Страница контрагента» (доработки 15.11.2026, пункт 6; прототип
// v120 admin/kb-cppage.js): тексты подсказок страницы контрагента правит администратор платформы, и они
// сразу видны на всех страницах. Тексты общие для всех организаций, поэтому файл — *.shared.spec.ts
// (идёт после остальных и по одному): вопрос теста в конце удаляется, даже если проверка упала.

type Texts = Record<string, string>;

/** Тексты словаря интерфейса (`GET /api/l10n`): тест не копирует длинные строки. */
async function dictionary(api: APIRequestContext): Promise<Texts> {
  const res = await api.get('/api/l10n');
  expect(res.status()).toBe(200);
  return ((await res.json()) as { texts: Texts }).texts;
}

/** Текст словаря с подстановками `{имя}`. */
function text(texts: Texts, key: string, values: Record<string, string | number> = {}) {
  const raw = texts[key];
  expect(raw, key).toBeTruthy();
  return Object.entries(values).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), raw!);
}

/** Свой ИНН на каждый запуск и проект: 14 цифр, первая — 0. */
const freshInn = () =>
  `07${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10_000)
    .toString()
    .padStart(4, '0')}`;

/** Своя организация теста с функцией «Страница контрагента» и контрагент с включённой страницей. */
async function contractorPage(api: APIRequestContext, origin: string, name: string) {
  await orgWithTypes(api, origin, false);
  const policy = (await (await api.get('/api/org/policy')).json()) as { version: number };
  const on = await api.patch('/api/org/policy', {
    headers: { origin },
    data: { version: policy.version, features: { cppage: true } },
  });
  expect(on.status(), await on.text()).toBe(200);
  const staff = (await (await api.get('/api/staff?size=all')).json()) as {
    items: { id: string }[];
  };
  const created = await api.post('/api/contractors', {
    headers: { origin },
    data: {
      name,
      inn: freshInn(),
      phone: '+996505890076',
      kind: 'regular',
      formCode: 'ФС-01',
      regimeCode: 'РЕЖ-01',
      gked: '46.34.0',
      startDate: '2026-10-01',
      responsibleEmployeeId: staff.items[0]!.id,
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  const page = await api.post(`/api/contractors/${id}/page/enable`, { headers: { origin } });
  expect(page.status(), await page.text()).toBe(200);
  const block = (await page.json()) as { link: string; code: string };
  return { path: new URL(block.link).pathname, code: block.code };
}

/** Пункт меню «+ Добавить»: на вкладке с Excel в нём ещё «Выгрузить в Excel» и «Загрузить из Excel». */
async function addMenu(page: Page, item: string) {
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByRole('menu', { name: 'Добавить' }).getByRole('menuitem', { name: item }).click();
}

interface AdminCpHelpLite {
  help: { faq: { id: string; q: string; a: string }[] };
  version: number;
}

test.describe('Доработки 15.11: Админка → «Страница контрагента»', () => {
  test('(приёмка 15.11, пункт 6) новый частый вопрос сразу виден в «Помощи» страницы контрагента; «Удалить» — пропадает; правки — в «Истории изменений» вкладки', async ({
    page,
    playwright,
    baseURL,
  }) => {
    // Своя организация с контрагентом, вход администратора и два открытия страницы контрагента.
    test.slow();
    const origin = new URL(baseURL!).origin;
    const owner = await playwright.request.newContext({ baseURL });
    const tag = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const cp = await contractorPage(owner, origin, `ОсОО «Вопрос ${tag}»`);
    const texts = await dictionary(owner);
    await owner.dispose();
    await platformAdmin(page.request, origin);
    // Свой адрес: после 3 неверных кодов за час ввод с адреса закрыт (docs/deviations.md п. Е-2).
    const part = () => Math.floor(Math.random() * 256);
    await page.setExtraHTTPHeaders({ 'x-forwarded-for': `198.18.${part()}.${part()}` });

    const q = `Где посмотреть акт сверки ${tag}?`;
    const a = `Спросите вашего бухгалтера: акт сверки он пришлёт файлом ${tag}`;
    const faqRow = page.locator('[data-cph-table="faq"] [data-mini-row]').filter({ hasText: q });
    const history = page.locator('[data-kbadm-history="cppage"]');
    /** «Помощь» на странице контрагента: вопрос теста и его ответ. */
    const helpQuestion = async () => {
      await page.locator('[data-pub-help]').click();
      const panel = page.locator('[data-pub-help-panel]');
      await expect(panel).toBeVisible();
      return panel.locator('[data-pub-faq]').filter({ has: page.getByRole('button', { name: q }) });
    };

    try {
      await page.goto('/app/kbadm/cppage');
      await expect(page.locator('[data-kbadm-cppage]')).toBeVisible();
      await addMenu(page, text(texts, 'add.kbadm.cph_faq'));
      const form = page.getByRole('dialog', { name: text(texts, 'cph.adm.faq.new') });
      await form.locator('[data-cph-save]').click();
      await expect(form).toContainText(text(texts, 'cph.adm.err.question'));
      await form.locator('[data-cph-faq-q]').fill(q);
      await form.locator('[data-cph-faq-a]').fill(a);
      await form.locator('[data-cph-save]').click();
      await expect(form).toBeHidden();
      // «+ Добавить» → «Вопрос» открыл раздел «Частые вопросы»: вопрос — последней строкой.
      await expect(page.locator('[data-kbadm-cppage="faq"]')).toBeVisible();
      await expect(faqRow).toHaveCount(1);
      await expect(history).toContainText(text(texts, 'cph.hist.faq.create', { name: q }));

      // Клиент: в «Помощи» — новый вопрос, ответ по нажатию.
      await page.goto(cp.path);
      const open = page.getByRole('button', { name: 'Открыть' });
      await expect(open).toBeEnabled();
      await page.getByLabel('Код доступа').fill(cp.code);
      await open.click();
      let mine = await helpQuestion();
      await expect(mine).toHaveCount(1);
      await mine.getByRole('button', { name: q }).click();
      await expect(mine).toContainText(a);

      // Админка: «Удалить» с подтверждением — вопроса нет ни в таблице, ни в «Помощи».
      await page.goto('/app/kbadm/cppage');
      await page
        .getByRole('group', { name: text(texts, 'cph.adm.subs') })
        .getByRole('button', { name: text(texts, 'cph.adm.sub.faq') })
        .click();
      await expect(faqRow).toHaveCount(1);
      await faqRow.locator('[data-cph-more]').click();
      await page
        .getByRole('menu', { name: text(texts, 'cph.adm.actions') })
        .getByRole('menuitem', { name: text(texts, 'cph.adm.menu.delete') })
        .click();
      const confirm = page.getByRole('dialog', { name: text(texts, 'cph.adm.faq.delete_t') });
      await expect(confirm).toContainText(q);
      await confirm.getByRole('button', { name: text(texts, 'cph.adm.menu.delete') }).click();
      await expect(confirm).toBeHidden();
      await expect(faqRow).toHaveCount(0);
      await expect(history).toContainText(text(texts, 'cph.hist.faq.delete', { name: q }));

      // Код этот браузер помнит: страница открывается сразу.
      await page.goto(cp.path);
      mine = await helpQuestion();
      await expect(page.locator('[data-pub-help-panel] [data-pub-faq]').first()).toBeVisible();
      await expect(mine).toHaveCount(0);
    } finally {
      // Вопрос теста не остаётся на страницах всех контрагентов, даже если проверка упала посередине.
      const view = await page.request.get('/api/admin/kb/cppage');
      if (view.ok()) {
        const body = (await view.json()) as AdminCpHelpLite;
        const left = body.help.faq.find((f) => f.q === q);
        if (left) {
          const res = await page.request.post('/api/admin/kb/cppage', {
            headers: { origin },
            data: { op: 'faqDelete', id: left.id, version: body.version },
          });
          expect(res.status(), await res.text()).toBe(200);
        }
      }
    }
  });
});
