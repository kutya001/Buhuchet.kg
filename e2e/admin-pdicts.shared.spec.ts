import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { platformAdmin, search } from './admin';
import { DEMO_PASSWORD, signIn } from './helpers';

// Админка → «Справочники платформы», часть 1 задачи 2.36 (ТЗ «Админка» → «Справочники платформы»;
// прототип admin/platform-dicts*.js): вкладки по группам с шапкой, правка органов и УГНС, «Запросы»
// организаций с ответом. Справочники общие для всех организаций, поэтому файл — *.shared.spec.ts, а
// добавленные значения в конце удаляются.

type Value = {
  code: string;
  n: number | null;
  name: string;
  used: number;
  version: number;
  data: { gnsCode?: string | null; site?: string };
};

/** Значения справочника через API администратора. */
async function values(api: APIRequestContext, dict: string): Promise<Value[]> {
  const res = await api.get(`/api/admin/platform-dicts/${dict}?size=all`);
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { items: Value[] }).items;
}

/** Удалить значение, если тест его оставил (упал посередине). */
async function cleanup(api: APIRequestContext, origin: string, dict: string, name: string) {
  for (const x of (await values(api, dict)).filter((v) => v.name.startsWith(name))) {
    await api.delete(`/api/admin/platform-dicts/${dict}/${encodeURIComponent(x.code)}`, {
      headers: { origin },
      params: { version: x.version },
    });
  }
}

/** Строка списка по коду; на телефоне и ПК — `[data-id]`. */
async function row(page: Page, isMobile: boolean, text: string, code: string) {
  await search(page, isMobile, text);
  const found = page.locator(`[data-grid] [data-id="${code}"]`);
  await expect(found).toHaveCount(1);
  return found;
}

/** Пункт меню «Действия» строки. */
async function rowAction(page: Page, found: ReturnType<Page['locator']>, name: string) {
  await found.locator('[data-row-menu]').click();
  return page.getByRole('menu', { name: 'Действия' }).getByRole('menuitem', { name });
}

test.describe('Админка: справочники платформы', () => {
  test('(п. 37) ряд вкладок «Справочники платформы» разделён по группам, у вкладки шапка с пояснением', async ({
    page,
    baseURL,
  }) => {
    await platformAdmin(page.request, new URL(baseURL!).origin);
    await page.goto('/app/pdicts/organs');
    const tabs = page.getByRole('tablist', { name: 'Справочники платформы' });
    // Шесть групп — пять черт между ними.
    await expect(tabs.locator('[data-tab-sep]')).toHaveCount(5);
    await expect(tabs.locator('a[href="/app/pdicts/organs"]')).toHaveAttribute(
      'title',
      'Органы и банки · Органы',
    );
    const head = page.locator('[data-pdicts-head]');
    await expect(head).toContainText('Органы и банки · Органы');
    await expect(head).toContainText('Где используется:');
    // «Причины изменения срока» описаны вместе с «Категориями задач» (прототип).
    await page.goto('/app/pdicts/reasons');
    await expect(head).toContainText('Работа системы · Категории задач');
    await expect(page.getByText('Шаблон для организаций: причины')).toBeVisible();
  });

  test('(проверка задачи #92) органы: добавить с телефоном, повтор названия — ошибка, «Выше», переименовать, отключить, удалить только неиспользуемое; история', async ({
    page,
    baseURL,
    isMobile,
  }, testInfo) => {
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const name = `Минэкономики ${testInfo.project.name} ${Date.now()}`;
    const before = await values(page.request, 'organs');
    const taken = before[0]!.name;
    const toast = (text: string) => page.getByRole('status').filter({ hasText: text });

    try {
      await page.goto('/app/pdicts/organs');
      await expect(page.locator('[data-grid] [data-id]').first()).toBeVisible();
      await page.getByRole('button', { name: 'Добавить', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Новое значение · Органы' });
      await dialog.getByRole('button', { name: 'Сохранить' }).click();
      await expect(dialog.getByText('Введите название')).toBeVisible();
      await dialog.getByLabel('Название').fill(taken);
      await dialog.getByRole('button', { name: 'Сохранить' }).click();
      await expect(dialog.getByText('Такое значение уже есть')).toBeVisible();
      await dialog.getByLabel('Название').fill(name);
      await dialog.getByRole('button', { name: 'Добавить телефон' }).click();
      await dialog.getByLabel('Подпись').fill('Приёмная');
      await dialog.getByRole('button', { name: 'Сохранить' }).click();
      await expect(dialog.getByText('Введите номер')).toBeVisible();
      await dialog.getByLabel('Номер').fill('+996 312 62 05 10');
      await dialog.getByLabel('Сайт').fill('mineconom.gov.kg');
      await dialog.getByRole('button', { name: 'Сохранить' }).click();
      await expect(dialog).toBeHidden();
      await expect(toast('Сохранено')).toBeVisible();

      const created = (await values(page.request, 'organs')).find((x) => x.name === name)!;
      expect(created.n).toBe(before.length + 1);
      // Сайт без протокола сохраняется с https:// — у организации он открывается ссылкой.
      expect(created.data.site).toBe('https://mineconom.gov.kg');
      let found = await row(page, isMobile, name, created.code);
      // «№» — первый столбец таблицы (вид закреплён: «Таблица» и на телефоне, как в прототипе).
      const n = found.locator('td').first();
      await expect(n).toHaveText(String(created.n));
      // Последнее значение ниже не опустить.
      await expect(await rowAction(page, found, 'Ниже')).toBeDisabled();
      await page
        .getByRole('menu', { name: 'Действия' })
        .getByRole('menuitem', { name: 'Выше' })
        .click();
      await expect(n).toHaveText(String(created.n! - 1));
      const history = page.locator('[data-pdicts-history]');
      await expect(history).toContainText(
        `Органы: «${name}» перемещено с № ${created.n} на № ${created.n! - 1}`,
      );

      await (await rowAction(page, found, 'Переименовать')).click();
      const edit = page.getByRole('dialog', { name: 'Изменить' });
      await expect(edit).toContainText('Новое название увидят все организации');
      await expect(edit.getByLabel('Номер')).toHaveValue('+996 312 62 05 10');
      await edit.getByLabel('Название').fill(`${name} (ред.)`);
      await edit.getByRole('button', { name: 'Сохранить' }).click();
      await expect(edit).toBeHidden();
      await expect(history).toContainText(`Органы: «${name}» → «${name} (ред.)»`);

      found = await row(page, isMobile, `${name} (ред.)`, created.code);
      await (await rowAction(page, found, 'Отключить')).click();
      await expect(toast('Значение отключено')).toBeVisible();
      await expect(found).toContainText('Отключено');
      await expect(history).toContainText(`«${name} (ред.)» отключено (было: активно)`);
      await (await rowAction(page, found, 'Включить')).click();
      await expect(found).toContainText('Активно');

      await (await rowAction(page, found, 'Удалить')).click();
      const ask = page.getByRole('dialog', { name: `Удалить «${name} (ред.)»?` });
      await expect(ask).toContainText('Значение нигде не используется и будет удалено.');
      await ask.getByRole('button', { name: 'Удалить' }).click();
      await expect(toast('Удалено')).toBeVisible();
      await expect(found).toHaveCount(0);
      await expect(history).toContainText(`Органы: «${name} (ред.)» удалено`);

      // Орган, к которому привязаны виды отчётов, удалить нельзя — только отключить.
      const used = before.find((x) => x.used > 0)!;
      found = await row(page, isMobile, used.name, used.code);
      const remove = await rowAction(page, found, 'Удалить');
      await expect(remove).toBeDisabled();
      await expect(remove).toContainText(
        `Используется в ${used.used} записях — можно только отключить`,
      );
    } finally {
      await cleanup(page.request, origin, 'organs', name);
    }
  });

  test('(проверка задачи #92) УГНС: код ГНС — три цифры или пусто, повтор кода — ошибка; без кода — «—»', async ({
    page,
    baseURL,
    isMobile,
  }, testInfo) => {
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const name = `УГНС по новому району ${testInfo.project.name} ${Date.now()}`;
    const taken = (await values(page.request, 'ugns')).find((x) => x.data.gnsCode)!.data.gnsCode!;

    try {
      await page.goto('/app/pdicts/ugns');
      await expect(page.getByText('Налоговые органы: республиканские управления')).toBeVisible();
      await page.getByRole('button', { name: 'Добавить', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Новый налоговый орган' });
      await expect(dialog.getByLabel('Регион')).toHaveValue('г. Бишкек');
      await dialog.getByLabel('Код').fill('12');
      await dialog.getByRole('button', { name: 'Сохранить' }).click();
      await expect(dialog.getByText('Ровно три цифры')).toBeVisible();
      await expect(dialog.getByText('Введите краткое название')).toBeVisible();
      await dialog.getByLabel('Код').fill(taken);
      await dialog.getByLabel('Полное название').fill(name);
      await dialog.getByLabel('Краткое название').fill('Новый р-н');
      await dialog.getByRole('button', { name: 'Сохранить' }).click();
      await expect(dialog.getByText('Такой код уже есть')).toBeVisible();
      await dialog.getByLabel('Код').fill('');
      await dialog.getByRole('button', { name: 'Сохранить' }).click();
      await expect(dialog).toBeHidden();

      const created = (await values(page.request, 'ugns')).find((x) => x.name === name)!;
      expect(created).toMatchObject({ n: null, data: { gnsCode: null } });
      const found = await row(page, isMobile, name, created.code);
      await expect(found).toContainText('—');
      // У УГНС нет «№» и «Выше»/«Ниже»: список — по региону (решение заказчика, deviations Д-2).
      await found.locator('[data-row-menu]').click();
      const menu = page.getByRole('menu', { name: 'Действия' });
      await expect(menu.getByRole('menuitem', { name: 'Изменить' })).toBeVisible();
      await expect(menu.getByRole('menuitem', { name: 'Выше' })).toHaveCount(0);
      await page.keyboard.press('Escape');
    } finally {
      await cleanup(page.request, origin, 'ugns', name);
    }
  });

  test('(проверка задачи #92) «Запросы»: отказ без ответа — ошибка, «Добавлено» — без ответа; статус и ответ видны организации в «Моих запросах»', async ({
    page,
    baseURL,
    isMobile,
    playwright,
  }, testInfo) => {
    const origin = new URL(baseURL!).origin;
    const org = await playwright.request.newContext({ baseURL });
    await signIn(org, origin, 'erkin', DEMO_PASSWORD);
    const what = `Фонд ${testInfo.project.name} ${Date.now()}`;
    const ask = async (text: string, comment: string) => {
      const sent = await org.post('/api/dict-requests', {
        headers: { origin },
        data: { dict: 'forms', what: text, comment },
      });
      expect(sent.status(), await sent.text()).toBe(201);
      return ((await sent.json()) as { id: string }).id;
    };
    const id = await ask(what, 'Для НКО');
    const added = `Учреждение ${testInfo.project.name} ${Date.now()}`;
    const addedId = await ask(added, '');
    await org.dispose();

    await platformAdmin(page.request, origin);
    await page.goto('/app/pdicts/requests');
    await expect(page.locator('[data-grid] [data-id]').first()).toBeVisible();
    const found = await row(page, isMobile, what, id);
    await expect(found).toContainText('Новый');
    await (await rowAction(page, found, 'Отклонить')).click();
    const dialog = page.getByRole('dialog', { name: 'Отклонить запрос' });
    await expect(dialog).toContainText('Обязательно при отказе');
    await dialog.getByRole('button', { name: 'Отклонить' }).click();
    await expect(dialog.getByText('Напишите, почему запрос отклонён')).toBeVisible();
    await dialog.getByLabel('Ответ организации').fill('Это не форма собственности');
    await dialog.getByRole('button', { name: 'Отклонить' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Организация увидит ответ в «Мои запросы»')).toBeVisible();
    await expect(found).toContainText('Отклонено');

    // Строка открывает запрос целиком.
    await found.click();
    const view = page.getByRole('dialog', { name: what });
    await expect(view).toContainText('Для НКО');
    await expect(view).toContainText('Это не форма собственности');
    await view.getByRole('button', { name: 'Готово' }).click();

    // «Добавлено» — ответ по желанию.
    const done = await row(page, isMobile, added, addedId);
    await (await rowAction(page, done, 'Добавлено')).click();
    const yes = page.getByRole('dialog', { name: 'Запрос выполнен' });
    await yes.getByRole('button', { name: 'Отметить добавленным' }).click();
    await expect(yes).toBeHidden();
    await expect(done).toContainText('Добавлено');

    // Организация видит статус и ответ в окне «Мои запросы».
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    await page.goto('/app/dicts/platform');
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    await page
      .getByRole('menu', { name: 'Добавить' })
      .getByRole('menuitem', { name: 'Мои запросы' })
      .click();
    const mine = page.getByRole('dialog', { name: 'Мои запросы' });
    const rejected = mine.locator('[data-mini-table] tr').filter({ hasText: what });
    await expect(rejected).toContainText('Отклонено');
    await expect(rejected).toContainText('Это не форма собственности');
    await expect(mine.locator('[data-mini-table] tr').filter({ hasText: added })).toContainText(
      'Добавлено',
    );
    // Нажатие на строку показывает ответ целиком.
    await rejected.click();
    const full = page.getByRole('dialog', { name: what });
    await expect(full).toContainText('Отклонено');
    await expect(full).toContainText('Это не форма собственности');
  });
});
