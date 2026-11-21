import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { newOrgOwner, stillElement } from './helpers';

// Урок «Витрина данных» в «Базе знаний» (доработки 20.11.2026: Витрина данных, «Порядок работ», этап 3
// «Интерфейс»; общий план 20.11, этап 3, П3; прототип v157 kb-lessons `dmshow`, `dmtok`, kbShows
// `sh-dmshow`, `sh-dmcat`). Шаги засчитываются один раз и навсегда, поэтому каждый тест — со своей новой
// организацией и её владельцем (`newOrgOwner`): у него ещё ничего не засчитано, а демо-организация не
// меняется. Цепочка: «Базы знаний» → «Перейти» → экран модуля → действие → окно «Готово» → шаг засчитан.

type KbMe = {
  lessons: { steps: { id: string; title: string; done: { how: string } | null }[] }[];
};

async function kbMe(api: APIRequestContext) {
  // Чтение — повтор безопасен (docs/typical-mistakes.md № 26).
  const res = await api.get('/api/kb/me', { maxRetries: 2 });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as KbMe;
}

const stepOf = (me: KbMe, id: string) =>
  me.lessons.flatMap((l) => l.steps).find((s) => s.id === id);

/** Тексты словаря интерфейса (`GET /api/l10n`): тест не копирует строки экрана. */
async function dictionary(api: APIRequestContext): Promise<Record<string, string>> {
  const res = await api.get('/api/l10n', { maxRetries: 2 });
  expect(res.status()).toBe(200);
  return ((await res.json()) as { texts: Record<string, string> }).texts;
}

/** «Перейти» у шага урока на «Уроках». */
async function goStep(page: Page, id: string) {
  await page.goto('/app/kb/lessons');
  const step = page.locator(`[data-kb-step="${id}"]`);
  await expect(step).toHaveAttribute('data-kb-state', 'open');
  await step.getByRole('button', { name: 'Перейти' }).click();
}

const bubble = (page: Page) => page.locator('[data-tour-bubble]');
const nextButton = (page: Page) => page.locator('[data-tour-next]');

/**
 * Листать «Показать как» до последнего облачка: заголовки облачков по порядку и кнопка последнего —
 * «Готово» у шага «Посмотреть», «Сделать сейчас» у шага «Сделать».
 */
async function showTitles(page: Page) {
  const titles: string[] = [];
  for (let k = 0; k < 30; k++) {
    await expect(nextButton(page)).toBeEnabled();
    // Облачко переезжает к элементу: нажатие по движущейся кнопке теряется (типовая ошибка № 34).
    await stillElement(bubble(page));
    titles.push(((await bubble(page).locator('b').first().textContent()) ?? '').trim());
    const label = ((await nextButton(page).textContent()) ?? '').trim();
    if (label === 'Готово' || label === 'Сделать сейчас') return { titles, label };
    const count = (await page.locator('[data-tour-count]').textContent()) ?? '';
    await nextButton(page).click();
    await expect(page.locator('[data-tour-count]')).not.toHaveText(count, { timeout: 10_000 });
  }
  throw new Error(`Показ не дошёл до конца: ${titles.join(' · ')}`);
}

test.describe('Витрина данных: урок «Базы знаний»', () => {
  test('(доработки 20.11.2026, Витрина данных, этап 3) «Показать отчёт»: «Перейти» ведёт во «Вывод», первое «Показать» засчитывает шаг и открывает «Готово»; «?» модуля — статья «Витрина данных»', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    await newOrgOwner(page.request, origin);
    const before = await kbMe(page.request);
    const show = stepOf(before, 'dmshow');
    expect(show, 'шаг «Показать отчёт» в программе владельца').toBeTruthy();
    expect(show!.done).toBeNull();
    // Все четыре шага урока — у владельца с правами «Смотреть» и «Управлять API-токенами».
    for (const id of ['dmxl', 'dmcat', 'dmtok']) expect(stepOf(before, id), id).toBeTruthy();

    await goStep(page, 'dmshow');
    await expect(page).toHaveURL(/\/app\/dm\/out$/);
    const go = page.locator('[data-dm-out-show]');
    // «Перейти» подсвечивает кнопку «Показать» (прототип `G('dm','out','#dm-go')`).
    await expect(go).toHaveAttribute('data-ck-flash', '');
    await go.click();

    const done = page.getByRole('dialog', { name: `Готово: шаг «${show!.title}» выполнен` });
    await expect(done).toBeVisible();
    await expect
      .poll(async () => stepOf(await kbMe(page.request), 'dmshow')?.done?.how)
      .toBe('use');
    await done.getByRole('button', { name: 'Остаться здесь' }).click();
    await expect(done).toBeHidden();

    // «?» у названия модуля → «Вся инструкция» — статья модуля «Витрина данных» (refDB a_dm).
    const info = page.getByRole('button', { name: 'Что здесь: подсказка по модулю' });
    await info.click();
    const infoBox = page.getByRole('dialog', { name: 'Что здесь: подсказка по модулю' });
    await infoBox.getByRole('button', { name: 'Вся инструкция' }).click();
    await expect(infoBox).toBeHidden();
    const article = page
      .getByRole('dialog')
      .filter({ hasText: 'Готовые отчёты платформы по вашим данным' });
    await expect(article).toBeVisible();
    await expect(article).toContainText('Внешний доступ по API');
  });

  test('(доработки 20.11.2026, Витрина данных, этап 3) «Выпустить API-токен»: при выключенном API «Перейти» подсвечивает красную плашку; включён — сразу «Новый API-токен», а «Готово» — только после окна с токеном', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    await newOrgOwner(page.request, origin);
    const texts = await dictionary(page.request);
    const tok = stepOf(await kbMe(page.request), 'dmtok');
    expect(tok, 'шаг «Выпустить API-токен» в программе владельца').toBeTruthy();
    expect(tok!.done).toBeNull();

    // «Внешний доступ по API» выключен (по умолчанию): вместо окна — подсвеченная плашка вкладки.
    await goStep(page, 'dmtok');
    await expect(page).toHaveURL(/\/app\/dm\/tok$/);
    const off = page.locator('[data-dm-api-off]');
    await expect(off).toHaveAttribute('data-ck-flash', '');
    await expect(off).toContainText(texts['dm.tok.api_off']!);
    await expect(page.getByRole('dialog', { name: texts['dm.tok.new.title'] })).toHaveCount(0);

    // Владелец включает API (учётная политика, поле `extApi` — этап 3, П2).
    const policy = (await (
      await page.request.get('/api/org/policy', { maxRetries: 2 })
    ).json()) as {
      version: number;
    };
    const on = await page.request.patch('/api/org/policy', {
      headers: { origin },
      data: { version: policy.version, extApi: true },
    });
    expect(on.status(), await on.text()).toBe(200);

    await goStep(page, 'dmtok');
    await expect(page).toHaveURL(/\/app\/dm\/tok$/);
    const form = page.getByRole('dialog', { name: texts['dm.tok.new.title'] });
    await expect(form).toBeVisible();
    await form.getByLabel(texts['dm.tok.new.name']!).fill('Урок базы знаний');
    await form.getByRole('button', { name: texts['dm.tok.new.ok'], exact: true }).click();

    // Окно с токеном не закрывается нажатием мимо: «Готово» урока ждёт, пока его закроют (прототип
    // ckEval, `sticky`), иначе оно заслонило бы токен, который больше не покажется.
    const shown = page.getByRole('dialog', { name: texts['dm.tok.show.title'] });
    await expect(shown).toBeVisible();
    await expect(shown.locator('[data-dm-token-value]')).toHaveText(/^bk_/);
    await expect
      .poll(async () => stepOf(await kbMe(page.request), 'dmtok')?.done?.how)
      .toBe('action');
    const done = page.getByRole('dialog', { name: `Готово: шаг «${tok!.title}» выполнен` });
    await expect(done).toHaveCount(0);
    await shown.getByRole('button', { name: texts['dm.tok.show.done'], exact: true }).click();
    await expect(shown).toBeHidden();
    await expect(done).toBeVisible();
  });

  test('(доработки 20.11.2026, Витрина данных, этап 3) «Показать как»: облачка «Вывода» — шаблон, параметры, «Показать»; показ каталога шаблонов до конца засчитывает шаг «Посмотреть»', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    await newOrgOwner(page.request, origin);

    await page.goto('/app/kb/lessons');
    await page
      .locator('[data-kb-step="dmshow"]')
      .getByRole('button', { name: 'Показать как' })
      .click();
    await expect(page).toHaveURL(/\/app\/dm\/out$/);
    // Сценарий sh-dmshow (refDB.kbShows): все три элемента есть на экране продукта; шаг «Сделать» —
    // в конце «Сделать сейчас», оно подсвечивает «Показать», как «Перейти».
    const shown = await showTitles(page);
    expect(shown.titles).toEqual(
      expect.arrayContaining(['Шаблон', 'Параметры', 'Кнопка «Показать»']),
    );
    expect(shown.label).toBe('Сделать сейчас');
    await nextButton(page).click();
    await expect(bubble(page)).toHaveCount(0);
    await expect(page.locator('[data-dm-out-show]')).toHaveAttribute('data-ck-flash', '');

    const before = stepOf(await kbMe(page.request), 'dmcat');
    expect(before?.done ?? null).toBeNull();
    await page.goto('/app/kb/lessons');
    await page
      .locator('[data-kb-step="dmcat"]')
      .getByRole('button', { name: 'Показать как' })
      .click();
    await expect(page).toHaveURL(/\/app\/dm\/tpl$/);
    const catalog = await showTitles(page);
    expect(catalog.titles).toEqual(expect.arrayContaining(['Карточка шаблона', '«Показать»']));
    expect(catalog.label).toBe('Готово');
    await nextButton(page).click();
    await expect(bubble(page)).toHaveCount(0);
    await expect
      .poll(async () => stepOf(await kbMe(page.request), 'dmcat')?.done?.how)
      .toBe('show');
  });
});
