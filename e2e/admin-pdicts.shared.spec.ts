import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { platformAdmin, search } from './admin';
import { DEMO_PASSWORD, signIn } from './helpers';

// Админка → «Справочники платформы», часть 1 задачи 2.36 (ТЗ «Админка» → «Справочники платформы»;
// прототип admin/platform-dicts*.js): вкладки по группам с шапкой, правка органов, УГНС и банков, «Запросы»
// организаций с ответом. Справочники общие для всех организаций, поэтому файл — *.shared.spec.ts, а
// добавленные значения в конце удаляются.

type Value = {
  code: string;
  n: number | null;
  name: string;
  used: number;
  version: number;
  data: { gnsCode?: string | null; site?: string; kind?: string; byPhone?: boolean };
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

  test('(проверка задачи #92) банковские провайдеры: «Тип» и «Переводы по номеру телефона», у кошелька код КШЛ', async ({
    page,
    baseURL,
    isMobile,
  }, testInfo) => {
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const name = `Кошелёк ${testInfo.project.name} ${Date.now()}`;

    try {
      await page.goto('/app/pdicts/banks');
      await expect(page.locator('[data-grid] [data-id]').first()).toBeVisible();
      await page.getByRole('button', { name: 'Добавить', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Новое значение · Банковские провайдеры' });
      await dialog.getByLabel('Название').fill(name);
      await dialog.getByLabel('Тип').selectOption({ label: 'Электронный кошелёк' });
      await dialog.getByRole('switch', { name: /Переводы по номеру телефона/ }).check();
      await dialog.getByRole('button', { name: 'Сохранить' }).click();
      await expect(dialog).toBeHidden();

      const created = (await values(page.request, 'banks')).find((x) => x.name === name)!;
      expect(created).toMatchObject({ data: { kind: 'wallet', byPhone: true } });
      expect(created.code).toMatch(/^КШЛ-\d{2}$/);
      const found = await row(page, isMobile, name, created.code);
      await expect(found).toContainText('Электронный кошелёк');
      await expect(found).toContainText('Да');
      await expect(await rowAction(page, found, 'Изменить')).toBeVisible();
      await page.keyboard.press('Escape');
    } finally {
      await cleanup(page.request, origin, 'banks', name);
    }
  });

  test('(проверка задачи #92) «Запросы»: бухгалтер просит «Форма 1-ИП (Нацстатком)», отказ без ответа — ошибка, отказ с ответом и «Добавлено» без ответа; в «Моих запросах» бухгалтера — статус и ответ целиком', async ({
    page,
    baseURL,
    isMobile,
  }, testInfo) => {
    const origin = new URL(baseURL!).origin;
    const suffix = `${testInfo.project.name} ${Date.now()}`;
    const what = `Форма 1-ИП (Нацстатком) ${suffix}`;
    const answer =
      'В каталоге уже есть формы Нацстаткома для ИП: «Форма 1-П срочная (ИП)», месячная и годовая. Если нужна другая форма, пришлите её номер и индекс из перечня Нацстаткома.';
    const openAdd = async (item: string) => {
      await page.getByRole('button', { name: 'Добавить', exact: true }).click();
      await page
        .getByRole('menu', { name: 'Добавить' })
        .getByRole('menuitem', { name: item })
        .click();
    };

    // Бухгалтер (без права на справочники) просит добавить вид отчёта — из окна, как в ТЗ.
    await signIn(page.request, origin, 'aigerim', DEMO_PASSWORD);
    await page.goto('/app/dicts/platform');
    await openAdd('Попросить добавить');
    const ask = page.getByRole('dialog', { name: 'Попросить добавить' });
    await ask.getByLabel('Что добавить').fill(what);
    await ask.getByLabel('Комментарий').fill('Сдаём в Нацстатком');
    await ask.getByRole('button', { name: 'Отправить запрос' }).click();
    await expect(ask).toBeHidden();
    const added = `Учреждение ${suffix}`;
    const sent = await page.request.post('/api/dict-requests', {
      headers: { origin },
      data: { dict: 'forms', what: added, comment: '' },
    });
    expect(sent.status(), await sent.text()).toBe(201);
    const addedId = ((await sent.json()) as { id: string }).id;
    const mineRes = await page.request.get('/api/dict-requests');
    const id = ((await mineRes.json()) as { items: { id: string; what: string }[] }).items.find(
      (x) => x.what === what,
    )!.id;

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
    await dialog.getByLabel('Ответ организации').fill(answer);
    await dialog.getByRole('button', { name: 'Отклонить' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Организация увидит ответ в «Мои запросы»')).toBeVisible();
    await expect(found).toContainText('Отклонено');

    // Строка открывает запрос целиком; «Отправил» — ФИО из учётной записи.
    await found.click();
    const view = page.getByRole('dialog', { name: what });
    await expect(view).toContainText('Сдаём в Нацстатком');
    await expect(view).toContainText(answer);
    await view.getByRole('button', { name: 'Готово' }).click();

    // «Добавлено» — ответ по желанию.
    const done = await row(page, isMobile, added, addedId);
    await (await rowAction(page, done, 'Добавлено')).click();
    const yes = page.getByRole('dialog', { name: 'Запрос выполнен' });
    await yes.getByRole('button', { name: 'Отметить добавленным' }).click();
    await expect(yes).toBeHidden();
    await expect(done).toContainText('Добавлено');

    // Бухгалтер видит статус и ответ в окне «Мои запросы».
    await signIn(page.request, origin, 'aigerim', DEMO_PASSWORD);
    await page.goto('/app/dicts/platform');
    await openAdd('Мои запросы');
    const mine = page.getByRole('dialog', { name: 'Мои запросы' });
    const rejected = mine.locator('[data-mini-table] tr').filter({ hasText: what });
    await expect(rejected).toContainText('Отклонено');
    await expect(mine.locator('[data-mini-table] tr').filter({ hasText: added })).toContainText(
      'Добавлено',
    );
    // Нажатие на строку показывает ответ целиком.
    await rejected.click();
    const full = page.getByRole('dialog', { name: what });
    await expect(full).toContainText('Отклонено');
    await expect(full).toContainText(answer);
  });
  test('(проверка задачи #92) режимы и основания: полное название режима обязательно; виды отчётов основания — из сквозных', async ({
    page,
    baseURL,
    isMobile,
  }, testInfo) => {
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const regime = `Режим ${testInfo.project.name} ${Date.now()}`;
    const base = `Основание ${testInfo.project.name} ${Date.now()}`;
    const options = await page.request.get('/api/admin/platform-dicts/report-type-options');
    const type = (
      (await options.json()) as { items: { kind: string; active: boolean; shortName: string }[] }
    ).items.find((x) => x.kind === 'cross' && x.active)!;

    try {
      await page.goto('/app/pdicts/regimes');
      await expect(page.getByText('Состав — по ст. 46 НК КР')).toBeVisible();
      await page.getByRole('button', { name: 'Добавить', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Новый режим' });
      await dialog.getByLabel('Краткое название').fill(regime);
      await dialog.getByRole('button', { name: 'Сохранить' }).click();
      await expect(dialog.getByText('Введите полное название')).toBeVisible();
      await dialog.getByLabel('Полное название').fill(`${regime} — полное`);
      await dialog.getByRole('button', { name: 'Сохранить' }).click();
      await expect(dialog).toBeHidden();
      const created = (await values(page.request, 'regimes')).find((x) => x.name === regime)!;
      expect(created.code).toMatch(/^РЕЖ-\d{2}$/);
      const found = await row(page, isMobile, regime, created.code);
      await expect(found).toContainText('Специальный');

      await page.goto('/app/pdicts/bases');
      await page.getByRole('button', { name: 'Добавить', exact: true }).click();
      const baseDialog = page.getByRole('dialog', { name: 'Новое основание' });
      await baseDialog.getByLabel('Название').fill(base);
      await baseDialog
        .getByRole('group', { name: 'Виды отчётов' })
        .getByRole('button', { name: type.shortName, exact: true })
        .click();
      await baseDialog.getByRole('button', { name: 'Сохранить' }).click();
      await expect(baseDialog).toBeHidden();
      const saved = (await values(page.request, 'bases')).find((x) => x.name === base)!;
      const baseRow = await row(page, isMobile, base, saved.code);
      await expect(baseRow).toContainText(type.shortName);
      // Основание с видом отчёта «используется» — удалить нельзя, пока связь есть.
      await expect(await rowAction(page, baseRow, 'Удалить')).toBeDisabled();
      await page.keyboard.press('Escape');
    } finally {
      await cleanup(page.request, origin, 'regimes', regime);
      for (const x of (await values(page.request, 'bases')).filter((v) => v.name === base)) {
        await page.request.put(`/api/admin/platform-dicts/bases/${encodeURIComponent(x.code)}`, {
          headers: { origin },
          data: { name: x.name, types: [], version: x.version },
        });
      }
      await cleanup(page.request, origin, 'bases', base);
    }
  });

  test('(проверка задачи #92) коды стран: Кыргызстан по умолчанию не отключается, коды стран не удаляются', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    await platformAdmin(page.request, new URL(baseURL!).origin);
    await page.goto('/app/pdicts/phones');
    const found = await row(page, isMobile, 'Кыргызстан', 'KG');
    await expect(found).toContainText('+996');
    await expect(found).toContainText('+996 555 123 456');
    const off = await rowAction(page, found, 'Отключить');
    await expect(off).toBeDisabled();
    await expect(off).toContainText('Код по умолчанию отключить нельзя');
    await expect(
      page.getByRole('menu', { name: 'Действия' }).getByRole('menuitem', { name: 'Удалить' }),
    ).toHaveCount(0);
    await page
      .getByRole('menu', { name: 'Действия' })
      .getByRole('menuitem', { name: 'Изменить' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Изменить код страны' });
    await expect(dialog).toContainText('сохранённые номера не меняются');
    // С «+» код не сохраняется: поле — только цифры.
    await dialog.getByLabel('Код без +').fill('+996');
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(dialog.getByText('1–4 цифры')).toBeVisible();
    await dialog.getByRole('button', { name: 'Отмена' }).click();
  });

  test('(проверка задачи #92) календарь: нерабочий день добавляется и удаляется, праздник «каждый год» не удаляется; копирование на следующий год', async ({
    page,
    baseURL,
    isMobile,
  }, testInfo) => {
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    type Day = { key: string; date: string; version: number };
    const days = async () => {
      const res = await page.request.get('/api/admin/platform-dicts/calendar?size=all');
      expect(res.status(), await res.text()).toBe(200);
      return (await res.json()) as { year: number; items: Day[] };
    };
    const { year, items } = await days();
    const next = year + 1;
    // Свободный будний день следующего года: с 1 июня вперёд.
    const taken = new Set(items.map((x) => x.date));
    let date = `${next}-06-01`;
    while (taken.has(date) || [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay())) {
      const d = new Date(`${date}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      date = d.toISOString().slice(0, 10);
    }
    const ru = `${date.slice(8)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;
    const name = `Перенос: проверка ${testInfo.project.name}`;
    const toast = (text: string) => page.getByRole('status').filter({ hasText: text });

    try {
      await page.goto('/app/pdicts/calendar');
      await expect(page.getByText('Правило «суббота → понедельник» не используется')).toBeVisible();
      await page.getByRole('button', { name: 'Добавить', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Нерабочий день' }).click();
      const dialog = page.getByRole('dialog', { name: 'Нерабочий день' });
      await expect(dialog.getByLabel('Название')).toHaveValue('Орозо айт');
      await dialog.getByLabel('Дата').fill(date);
      await dialog.getByLabel('Тип').selectOption({ label: 'Рабочая суббота' });
      await dialog.getByRole('button', { name: 'Добавить' }).click();
      await expect(dialog.getByText('Рабочая суббота — только суббота')).toBeVisible();
      await dialog.getByLabel('Тип').selectOption({ label: 'Праздник или перенос' });
      await dialog.getByLabel('Название').fill(name);
      await dialog.getByRole('button', { name: 'Добавить' }).click();
      await expect(dialog).toBeHidden();
      await expect(toast('Календарь обновлён, сроки пересчитаны')).toBeVisible();

      let found = await row(page, isMobile, name, `${date}|${date}`);
      await expect(found).toContainText('Перенос');
      await expect(found).toContainText('Только в этом году');
      await (await rowAction(page, found, 'Удалить')).click();
      const ask = page.getByRole('dialog', { name: `Удалить ${ru}?` });
      await expect(ask).toContainText('Сроки несданных отчётов будут пересчитаны.');
      await ask.getByRole('button', { name: 'Удалить' }).click();
      await expect(toast('Удалено')).toBeVisible();
      await expect(found).toHaveCount(0);

      // Государственный праздник «каждый год» удалить нельзя.
      found = await row(page, isMobile, 'Новый год', `${year}-01-01|01-01`);
      const remove = await rowAction(page, found, 'Удалить');
      await expect(remove).toBeDisabled();
      await expect(remove).toContainText('Государственный праздник по закону, удалить нельзя');
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: `Создать ${next} год копированием` }).click();
      const copy = page.getByRole('dialog', {
        name: `Создать календарь ${next} года копированием`,
      });
      await expect(copy).toContainText(`Праздники «Каждый год» уже есть в ${next} году`);
      // Кнопка внизу окна: «Отмена», а если копировать нечего — «Закрыть» (у крестика нет текста).
      await copy.getByText(/^(Отмена|Закрыть)$/).click();
      await expect(copy).toBeHidden();
    } finally {
      for (const x of (await days()).items.filter((d) => d.key === date)) {
        await page.request.delete(`/api/admin/platform-dicts/calendar/${x.key}`, {
          headers: { origin },
          params: { version: x.version },
        });
      }
    }
  });
});
