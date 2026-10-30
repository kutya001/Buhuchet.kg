import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { platformAdmin, search } from './admin';

// Админка → «Справочники платформы», часть 3 задачи 2.36 — вкладки «Работа системы» (ТЗ «Справочники,
// на которых держится логика системы» и «Шаблоны для организаций»; прототип admin/platform-dicts.js):
// «Статусы», «Права ролей», «Шаблоны ролей» и «Шаблоны» сообщений. Тексты и цвета общие для всех
// организаций, поэтому файл — *.shared.spec.ts, а каждая правка тут же возвращается обратно.

const P = '/api/admin/platform-dicts';

type Status = {
  scale: string;
  code: string;
  name: string;
  nameVersion: number;
  tone: string;
  toneVersion: number;
};
type Perm = { id: string; name: string; description: string; version: number };
type RoleTemplate = {
  code: string;
  name: string;
  permissions: string[];
  scopes: Record<string, string>;
  version: number;
};
type Template = { key: string; text: string; version: number };

async function getJson<T>(api: APIRequestContext, path: string): Promise<T> {
  const res = await api.get(path);
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as T;
}

const toast = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

test.describe('Админка: справочники платформы — работа системы', () => {
  test('(проверка задачи #92) «Статусы»: все шкалы с этапами, цвет и название статуса, периодичность без повторов; история', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const status = async () =>
      (await getJson<{ statuses: Status[] }>(page.request, `${P}/statuses`)).statuses.find(
        (x) => x.scale === 'project' && x.code === 'cancelled',
      )!;
    const before = await status();

    try {
      await page.goto('/app/pdicts/statuses');
      await expect(page.getByText('Состав статусов зашит в систему')).toBeVisible();
      for (const title of [
        'Статусы сдачи отчётов',
        'Статусы оплаты',
        'Статусы задач',
        'Статусы обслуживания контрагента',
        'Статусы проектов',
        'Статусы показателей',
        'Периодичность отчётов',
      ]) {
        await expect(page.getByRole('heading', { name: title })).toBeVisible();
      }
      const todo = page.locator('[data-status-scale="report"] [data-status="todo"]');
      await expect(todo).toContainText('Этап 1');
      await expect(todo).toContainText('отчёт создан, работа не начата');
      await expect(
        page.locator('[data-status-scale="report"] [data-status="confirmed"]'),
      ).toContainText('отметка');

      // Цвет — сразу для всех организаций.
      const row = page.locator('[data-status-scale="project"] [data-status="cancelled"]');
      await expect(row).toContainText('боковой');
      await row.getByLabel(`Цвет статуса «${before.name}»`).selectOption({ label: 'Фиолетовый' });
      await expect(toast(page, 'Цвет статуса изменён для всех организаций')).toBeVisible();

      // Название: пустое — ошибка; новое — на метке и в истории.
      await row.getByRole('button', { name: `Переименовать статус «${before.name}»` }).click();
      const dialog = page.getByRole('dialog', { name: 'Название статуса' });
      await expect(dialog).toContainText(`Сейчас: «${before.name}»`);
      await dialog.getByLabel('Новое название').fill(' ');
      await dialog.getByRole('button', { name: 'Сохранить' }).click();
      await expect(dialog.getByText('Введите название')).toBeVisible();
      await dialog.getByLabel('Новое название').fill('Отменён заказчиком');
      await dialog.getByRole('button', { name: 'Сохранить' }).click();
      await expect(dialog).toBeHidden();
      await expect(toast(page, 'Название статуса изменено для всех организаций')).toBeVisible();
      await expect(row).toContainText('Отменён заказчиком');
      const history = page.locator('[data-pdicts-history]');
      await expect(history).toContainText(
        `Статусы: «${before.name}» переименован в «Отменён заказчиком»`,
      );
      await expect(history).toContainText(`Статусы: «Отменён заказчиком» — цвет`);

      // Периодичность: название другой периодичности — ошибка.
      await page.getByRole('button', { name: 'Переименовать «Квартал»' }).click();
      const period = page.getByRole('dialog', { name: 'Название периодичности' });
      await period.getByLabel('Новое название').fill('Месяц');
      await period.getByRole('button', { name: 'Сохранить' }).click();
      await expect(period.getByText('Такое название уже есть')).toBeVisible();
      await period.getByRole('button', { name: 'Отмена' }).click();
      await expect(page.locator('[data-period="q"]')).toContainText('4 в году');
    } finally {
      const now = await status();
      await page.request.put(`${P}/statuses/project/cancelled/name`, {
        headers: { origin },
        data: { name: before.name, version: now.nameVersion },
      });
      await page.request.put(`${P}/statuses/project/cancelled/tone`, {
        headers: { origin },
        data: { tone: before.tone, version: now.toneVersion },
      });
    }
  });

  test('(проверка задачи #92) «Права ролей»: список по группам; окно права — название и описание обязательны, повтор названия — ошибка; история', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const perm = async () =>
      (await getJson<{ items: Perm[] }>(page.request, `${P}/perms?size=all`)).items.find(
        (x) => x.id === 'cpPause',
      )!;
    const before = await perm();

    try {
      await page.goto('/app/pdicts/perms');
      await expect(page.getByText('Набор прав задаёт система')).toBeVisible();
      await search(page, isMobile, before.name);
      const found = page.locator('[data-grid] [data-id="cpPause"]');
      await expect(found).toHaveCount(1);
      await expect(found).toContainText('Контрагенты');
      await found.locator('[data-row-menu]').click();
      await page
        .getByRole('menu', { name: 'Действия' })
        .getByRole('menuitem', { name: 'Изменить' })
        .click();
      const dialog = page.getByRole('dialog', { name: 'Право роли' });
      await expect(dialog).toContainText('Контрагенты · код cpPause');
      await dialog.getByLabel('Название').fill('Просматривать контрагентов');
      await dialog.getByLabel('Описание').fill('');
      await dialog.getByRole('button', { name: 'Сохранить' }).click();
      await expect(dialog.getByText('Введите описание')).toBeVisible();
      await dialog.getByLabel('Описание').fill(`${before.description} Проверка.`);
      await dialog.getByRole('button', { name: 'Сохранить' }).click();
      await expect(dialog.getByText('Такое право уже есть')).toBeVisible();
      await dialog.getByLabel('Название').fill(before.name);
      await dialog.getByRole('button', { name: 'Сохранить' }).click();
      await expect(dialog).toBeHidden();
      await expect(toast(page, 'Право сохранено для всех организаций')).toBeVisible();
      await expect(page.locator('[data-pdicts-history]')).toContainText(
        `Права ролей: «${before.name}» — изменено описание`,
      );
    } finally {
      const now = await perm();
      await page.request.put(`${P}/perms/cpPause`, {
        headers: { origin },
        data: { name: before.name, description: before.description, version: now.version },
      });
    }
  });

  test('(проверка задачи #92) «Шаблоны ролей»: права шаблона — право только владельца закрыто, без изменений — «Изменений нет»; убрать право — в истории; повтор названия — ошибка', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const template = async () =>
      (await getJson<{ items: RoleTemplate[] }>(page.request, `${P}/roletpl`)).items.find(
        (x) => x.code === 'acc',
      )!;
    const before = await template();

    try {
      await page.goto('/app/pdicts/roletpl');
      await expect(page.getByText('Шаблоны ролей для новых организаций')).toBeVisible();
      const card = page.locator('[data-role-template="acc"]');
      await expect(card).toContainText(`${before.permissions.length} из 38 прав`);

      // Повтор названия другого шаблона — ошибка.
      await card.getByRole('button', { name: `Переименовать шаблон «${before.name}»` }).click();
      const rename = page.getByRole('dialog', { name: 'Название шаблона роли' });
      await rename.getByLabel('Название').fill('Главный бухгалтер');
      await rename.getByRole('button', { name: 'Сохранить' }).click();
      await expect(rename.getByText('Такой шаблон уже есть')).toBeVisible();
      await rename.getByRole('button', { name: 'Отмена' }).click();

      await card.getByRole('button', { name: 'Права' }).click();
      let dialog = page.getByRole('dialog', { name: 'Права шаблона роли' });
      await expect(dialog).toContainText(`Выбрано прав: ${before.permissions.length} из 38`);
      await dialog.getByRole('searchbox').fill('Настройки и учётная политика');
      const owner = dialog.locator('[data-permission="org"]');
      await expect(owner.getByRole('checkbox')).toBeDisabled();
      await expect(owner).toContainText('Это право есть только у владельца организации');
      await dialog.getByRole('button', { name: 'Сохранить' }).click();
      await expect(dialog).toBeHidden();
      await expect(toast(page, 'Изменений нет')).toBeVisible();

      await card.getByRole('button', { name: 'Права' }).click();
      dialog = page.getByRole('dialog', { name: 'Права шаблона роли' });
      // Право не «Просматривать …»: без просмотра остальные права группы не сохранить.
      const removed = before.permissions.find((p) => !p.endsWith('View'))!;
      const { items: perms } = await getJson<{ items: Perm[] }>(
        page.request,
        `${P}/perms?size=all`,
      );
      const name = perms.find((p) => p.id === removed)!.name;
      // На телефоне группы свёрнуты: поиск раскрывает группу с найденным правом.
      await dialog.getByRole('searchbox').fill(name);
      await dialog.locator(`[data-permission="${removed}"]`).getByRole('checkbox').uncheck();
      await expect(dialog).toContainText(`Выбрано прав: ${before.permissions.length - 1} из 38`);
      await dialog.getByRole('button', { name: 'Сохранить' }).click();
      await expect(dialog).toBeHidden();
      await expect(
        toast(page, 'Шаблон роли изменён: действует для новых организаций'),
      ).toBeVisible();
      await expect(card).toContainText(`${before.permissions.length - 1} из 38 прав`);
      await expect(page.locator('[data-pdicts-history]')).toContainText(
        `Шаблоны ролей: «${before.name}» — убрано право «${name}»`,
      );
    } finally {
      const now = await template();
      await page.request.put(`${P}/roletpl/acc`, {
        headers: { origin },
        data: {
          name: before.name,
          permissions: before.permissions,
          scopes: before.scopes,
          version: now.version,
        },
      });
    }
  });

  test('(проверка задачи #92) «Шаблоны»: под шаблоном — подстановки; чужая подстановка и пустой текст — ошибка под полем; сохранение — в истории', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const all = async () =>
      (await getJson<{ items: Template[] }>(page.request, `${P}/templates`)).items;
    const before = await all();
    const code = before.find((x) => x.key === 'tgCode')!;

    try {
      await page.goto('/app/pdicts/templates');
      await expect(page.getByText('Подстановки в фигурных скобках заполняются сами')).toBeVisible();
      const field = page.getByLabel('Telegram: код восстановления пароля');
      await expect(field).toHaveValue(code.text);
      await expect(page.locator('[data-template="tgCode"]')).toContainText(
        'код для восстановления пароля, действует 10 минут. Подстановки: {код}',
      );
      const save = page.getByRole('button', { name: 'Сохранить шаблоны' });
      await field.fill('');
      await save.click();
      await expect(page.getByText('Введите текст шаблона')).toBeVisible();
      await field.fill('Код: {кот}');
      await save.click();
      await expect(page.getByText('Нет такой подстановки: {кот}. Доступны: {код}')).toBeVisible();
      await field.fill(`${code.text} Никому его не сообщайте.`);
      await save.click();
      await expect(toast(page, 'Шаблоны сохранены')).toBeVisible();
      await expect(page.locator('[data-pdicts-history]')).toContainText(
        'Шаблоны: «Telegram: код восстановления пароля» — изменён текст',
      );
    } finally {
      const now = await all();
      await page.request.put(`${P}/templates`, {
        headers: { origin },
        data: {
          items: now.map((x) => ({
            key: x.key,
            text: before.find((y) => y.key === x.key)?.text ?? x.text,
            version: x.version,
          })),
        },
      });
    }
  });
});
