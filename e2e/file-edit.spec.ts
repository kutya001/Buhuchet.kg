import { randomBytes } from 'node:crypto';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { search } from './admin';
import { DEMO_PASSWORD, signIn } from './helpers';
import { newContractor } from './reports';

// Доработки 13.11, задача И4 (прототип v95, modules/files.js `attachDlg`, `fileEditDlg`): необязательное
// примечание к прикрепляемым файлам и «Изменить файл» — название, примечание, замена файла. Блок «Файлы»
// проверяется на странице образцов /samples (общие файлы организации), остальное — в Файловом менеджере.

const MB = 1048576;
const uniqueTag = () => `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
const pdf = (name: string, size = 3 * 1024) => ({
  name,
  mimeType: 'application/pdf',
  buffer: Buffer.alloc(size, 2),
});

/** Загрузить файл через API, как это делает браузер: начать → PUT в хранилище → закончить. */
async function apiUpload(
  api: APIRequestContext,
  origin: string,
  data: Record<string, unknown> & { name: string },
) {
  const size = 2048;
  const start = await api.post('/api/files/uploads', {
    headers: { origin },
    data: { source: { kind: 'manual', id: null }, size, ...data },
  });
  expect(start.status(), await start.text()).toBe(201);
  const ticket = (await start.json()) as {
    id: string;
    upload: { url: string; headers: Record<string, string> };
  };
  const put = await api.put(ticket.upload.url, {
    headers: ticket.upload.headers,
    data: Buffer.alloc(size, 7),
  });
  expect(put.status(), await put.text()).toBe(200);
  const done = await api.post(`/api/files/${ticket.id}/complete`, { headers: { origin } });
  expect(done.status(), await done.text()).toBe(200);
  return ticket.id;
}

async function openFiles(page: Page, baseURL: string | undefined, login: string): Promise<Locator> {
  await signIn(page.request, new URL(baseURL!).origin, login, DEMO_PASSWORD);
  await page.goto('/samples');
  const box = page.locator('[data-sample-files]');
  await expect(box.getByRole('heading', { name: /^Файлы · \d+/ })).toBeVisible();
  return box;
}

const row = (box: Locator, name: string) => box.getByRole('listitem').filter({ hasText: name });

async function pick(page: Page, box: Locator, files: ReturnType<typeof pdf>[]) {
  const chooser = page.waitForEvent('filechooser');
  await box.getByRole('button', { name: 'Прикрепить' }).click();
  await (await chooser).setFiles(files);
}

test.describe('Доработки 13.11: примечание к файлам и «Изменить файл»', () => {
  test('(проверка прототипа v95) «Прикрепить»: окно со списком выбранных файлов и необязательным примечанием — одно на все; примечание видно под файлом', async ({
    page,
    baseURL,
  }) => {
    const box = await openFiles(page, baseURL, 'alisher');
    const tag = uniqueTag();
    const first = `акт-${tag}.pdf`;
    const second = `счёт-${tag}.pdf`;
    await pick(page, box, [pdf(first), pdf(second, 5 * 1024)]);
    const dlg = page.getByRole('dialog', { name: 'Прикрепить файлы: 2' });
    await expect(dlg.getByRole('listitem').filter({ hasText: first })).toContainText('PDF · 3 КБ');
    await expect(dlg.getByRole('listitem').filter({ hasText: second })).toContainText('PDF · 5 КБ');
    const note = dlg.getByLabel('Примечание');
    await expect(note).toHaveAttribute('placeholder', 'Необязательно: что это за документ');
    await expect(dlg).toContainText(
      'Одно на все выбранные файлы. Видно сотрудникам в записи и в Файловом менеджере; контрагенту на его странице не показывается',
    );
    await note.fill('Сверка  за октябрь,\nс печатью');
    await dlg.getByRole('button', { name: 'Прикрепить' }).click();
    await expect(page.getByText('Файлы прикреплены')).toBeVisible();
    await expect(dlg).toBeHidden();
    // Примечание — одной строкой под типом и размером у обоих файлов.
    for (const name of [first, second]) {
      await expect(row(box, name).locator('[data-file-note]')).toHaveText(
        'Сверка за октябрь, с печатью',
      );
    }

    // Без примечания: один файл — «Прикрепить файл», строки примечания у файла нет.
    const plain = `без-примечания-${tag}.pdf`;
    await pick(page, box, [pdf(plain)]);
    const one = page.getByRole('dialog', { name: 'Прикрепить файл' });
    await expect(one).toContainText(
      'Видно сотрудникам в записи и в Файловом менеджере; контрагенту на его странице не показывается',
    );
    await expect(one).not.toContainText('Одно на все выбранные файлы');
    await one.getByRole('button', { name: 'Прикрепить' }).click();
    await expect(row(box, plain)).toBeVisible();
    await expect(row(box, plain).locator('[data-file-note]')).toHaveCount(0);

    // «Отмена» — ничего не прикрепляется.
    const dropped = `отмена-${tag}.pdf`;
    await pick(page, box, [pdf(dropped)]);
    await page
      .getByRole('dialog', { name: 'Прикрепить файл' })
      .getByRole('button', { name: 'Отмена' })
      .click();
    await expect(row(box, dropped)).toHaveCount(0);
  });

  test('(проверка прототипа v95) «Изменить файл»: название без расширения, запрещённые знаки не принимаются, примечание меняется и убирается; замена ставит новый файл на место прежнего, расширение — от нового', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    await signIn(page.request, origin, 'alisher', DEMO_PASSWORD);
    const tag = uniqueTag();
    const name = `договор-${tag}.pdf`;
    const id = await apiUpload(page.request, origin, { name, note: 'Черновик' });
    const box = await openFiles(page, baseURL, 'alisher');
    const line = row(box, name);
    await expect(line.locator('[data-file-note]')).toHaveText('Черновик');

    // Карандаш открывает окно: название без расширения, расширение рядом, примечание, замена.
    await line.getByRole('button', { name: `Изменить ${name}` }).click();
    const dlg = page.getByRole('dialog', { name: 'Изменить файл' });
    const title = dlg.getByLabel('Название');
    await expect(title).toHaveValue(`договор-${tag}`);
    await expect(dlg.locator('[data-file-edit-ext]')).toHaveText('.pdf');
    await expect(dlg).toContainText(
      'Расширение остаётся прежним; при замене файла — берётся от нового',
    );
    await expect(dlg.getByLabel('Примечание')).toHaveValue('Черновик');
    await expect(dlg).toContainText(
      'Необязательно. Сейчас: PDF · 2 КБ. Новый файл встанет на место прежнего везде, где он виден; прежний удаляется без возможности вернуть',
    );

    // Пустое название и запрещённые знаки — ошибка под полем, окно остаётся.
    await title.fill('   ');
    await dlg.getByRole('button', { name: 'Сохранить' }).click();
    await expect(dlg.getByText('Укажите название файла')).toBeVisible();
    await title.fill('договор: новый');
    await dlg.getByRole('button', { name: 'Сохранить' }).click();
    await expect(
      dlg.getByText('В названии нельзя использовать знаки \\ / : * ? " < > |'),
    ).toBeVisible();

    // Новое название и примечание: «Файл изменён», строка обновилась, расширение прежнее.
    const renamed = `договор подписан-${tag}`;
    await title.fill(renamed);
    await dlg.getByLabel('Примечание').fill('Подписан обеими сторонами');
    await dlg.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByText('Файл изменён')).toBeVisible();
    await expect(dlg).toBeHidden();
    const changed = row(box, `${renamed}.pdf`);
    await expect(changed.locator('[data-file-note]')).toHaveText('Подписан обеими сторонами');
    await expect(row(box, name)).toHaveCount(0);

    // Замена: новый файл другого типа встаёт на место прежнего — тот же файл, новое расширение и размер.
    await changed.getByRole('button', { name: `Изменить ${renamed}.pdf` }).click();
    await dlg.locator('[data-file-edit-input]').setInputFiles({
      name: `скан-${tag}.png`,
      mimeType: 'image/png',
      buffer: Buffer.alloc(7 * 1024, 3),
    });
    await expect(dlg.locator('[data-file-edit-ext]')).toHaveText('.png');
    await dlg.getByLabel('Примечание').fill('');
    await dlg.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByText('Файл заменён')).toBeVisible();
    const replaced = row(box, `${renamed}.png`);
    await expect(replaced).toContainText('PNG · 7 КБ');
    await expect(replaced.locator('[data-file-note]')).toHaveCount(0);
    await expect(row(box, `${renamed}.pdf`)).toHaveCount(0);
    const download = page.waitForEvent('download');
    await replaced.getByRole('button', { name: `Скачать ${renamed}.png` }).click();
    expect((await download).suggestedFilename()).toBe(`${renamed}.png`);
    // Номер файла прежний: ссылки на него из записей не теряются.
    const list = (await (await page.request.get('/api/files?kind=manual')).json()) as {
      items: { id: string; name: string; size: number }[];
    };
    expect(list.items.find((f) => f.id === id)).toMatchObject({
      name: `${renamed}.png`,
      size: 7 * 1024,
    });

    // Файл больше 20 МБ на замену — ошибка под полем, файл остаётся прежним.
    await replaced.getByRole('button', { name: `Изменить ${renamed}.png` }).click();
    await dlg.locator('[data-file-edit-input]').setInputFiles({
      name: `большой-${tag}.png`,
      mimeType: 'image/png',
      buffer: Buffer.alloc(20 * MB + 1, 1),
    });
    await dlg.getByRole('button', { name: 'Сохранить' }).click();
    await expect(dlg.getByText('Файл больше 20 МБ')).toBeVisible();
    await dlg.getByRole('button', { name: 'Отмена' }).click();
  });

  test('(проверка прототипа v95) чужой файл без права «Удалять файлы»: название и примечание меняются, «Замена недоступна»; сервер замену не начинает', async ({
    page,
    browser,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const chief = await browser.newContext();
    await signIn(chief.request, origin, 'meerim', DEMO_PASSWORD);
    const tag = uniqueTag();
    const name = `приказ-${tag}.pdf`;
    const id = await apiUpload(chief.request, origin, { name });
    await chief.close();

    const box = await openFiles(page, baseURL, 'alisher');
    await row(box, name)
      .getByRole('button', { name: `Изменить ${name}` })
      .click();
    const dlg = page.getByRole('dialog', { name: 'Изменить файл' });
    await expect(dlg.locator('[data-file-edit-noreplace]')).toHaveText('Замена недоступна');
    await expect(dlg).toContainText(
      'Заменить файл может тот, у кого есть право «Удалять файлы»; свой файл — в течение суток после загрузки',
    );
    await expect(dlg.locator('[data-file-edit-input]')).toHaveCount(0);
    await dlg.getByLabel('Примечание').fill('По основной деятельности');
    await dlg.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByText('Файл изменён')).toBeVisible();
    await expect(row(box, name).locator('[data-file-note]')).toHaveText('По основной деятельности');

    const refused = await page.request.post(`/api/files/${id}/replacement`, {
      headers: { origin },
      data: { name: 'новый.pdf', size: 1024 },
    });
    expect(refused.status(), await refused.text()).toBe(403);
  });

  test('(проверка прототипа v95) Файловый менеджер: столбец «Примечание», действие «Изменить», в окне файла — «Примечание», «Изменить» и «Заменён»; правка файла контрагента — в его истории', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    const contractors = (
      (await (await page.request.get('/api/files/manager/contractors')).json()) as {
        items: { id: string; name: string }[];
      }
    ).items;
    const cp = contractors[0]!;
    const tag = uniqueTag();
    const name = `устав-${tag}.pdf`;
    const id = await apiUpload(page.request, origin, {
      name,
      contractorId: cp.id,
      note: 'Редакция 2024 года',
    });

    await page.goto('/app/files');
    await expect(page.locator('[data-grid]')).toBeVisible();
    await search(page, isMobile, tag);
    const line = page.locator(`[data-grid] [data-id="${id}"]`);
    await expect(line).toBeVisible();
    // Примечание — столбцом списка (на телефоне — строкой плитки).
    await expect(line).toContainText('Редакция 2024 года');

    // Действие «Изменить» в меню записи: новое название.
    await line.locator('[data-row-menu]').click();
    await page
      .getByRole('menu', { name: 'Действия' })
      .getByRole('menuitem', { name: 'Изменить' })
      .click();
    const dlg = page.getByRole('dialog', { name: 'Изменить файл' });
    await expect(dlg).toContainText('Загружен вручную');
    await dlg.getByLabel('Название').fill(`устав новый-${tag}`);
    await dlg.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByText('Файл изменён')).toBeVisible();
    await expect(line).toContainText(`устав новый-${tag}.pdf`);

    // Окно файла: «Примечание» и кнопка «Изменить»; после замены — строка «Заменён».
    await line.getByText(`устав новый-${tag}.pdf`, { exact: true }).click();
    const card = page.getByRole('dialog', { name: `устав новый-${tag}.pdf` });
    await expect(card.locator('[data-file-window-note]')).toHaveText('Редакция 2024 года');
    await expect(card).not.toContainText('Заменён');
    await card.getByRole('button', { name: 'Изменить' }).click();
    await dlg.locator('[data-file-edit-input]').setInputFiles(pdf(`скан-${tag}.pdf`, 9 * 1024));
    await dlg.getByLabel('Примечание').fill('');
    await dlg.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByText('Файл заменён')).toBeVisible();
    await expect(card).toContainText('Заменён');
    // Примечания больше нет — «нет».
    await expect(card.locator('[data-file-window-note]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    const link = await page.request.get(`/api/files/${id}/link`);
    expect(link.status()).toBe(200);

    // История контрагента: прикрепление с примечанием, переименование, замена и снятое примечание.
    const history = (await (
      await page.request.get(`/api/contractors/${cp.id}/history`)
    ).json()) as { items: { action: string; changes: { field: string; to?: unknown }[] }[] };
    const ofFile = history.items.filter((h) =>
      h.changes.some((c) => c.field === 'file' && String(c.to).includes(tag)),
    );
    expect(ofFile.map((h) => h.action).sort()).toEqual(['file_attach', 'file_edit', 'file_edit']);
  });

  test('(проверка прототипа v95) вкладка «Файлы» карточки контрагента: «Прикрепить» с примечанием, карандаш в строке, «Изменить» в окне файла; правки — в истории контрагента', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    const tag = uniqueTag();
    const cpName = `Файлы карточки ${tag}`;
    const cp = await newContractor(page.request, origin, { name: cpName });

    await page.goto('/app/cps/all');
    await expect(page.locator('[data-grid]')).toBeVisible();
    await search(page, isMobile, tag);
    await page
      .locator(`[data-grid] [data-id="${cp.id}"]`)
      .getByText(cpName, { exact: true })
      .click();
    const card = page.getByRole('dialog', { name: cpName });
    await expect(card.locator('[data-cp-card]')).toBeVisible();
    if (isMobile) {
      await card.getByRole('tab', { selected: true }).click();
      await page
        .getByRole('menu')
        .getByRole('menuitem', { name: /^Файлы/ })
        .click();
    } else {
      await card.getByRole('tab', { name: /^Файлы/ }).click();
    }
    const tab = card.locator('[data-cp-files]');
    await expect(tab).toBeVisible();

    // «Прикрепить»: окно с названием контрагента под заголовком и необязательным примечанием.
    const name = `договор-${tag}.pdf`;
    const chooser = page.waitForEvent('filechooser');
    await card.locator('[data-cp-attach]').click();
    await (await chooser).setFiles([pdf(name)]);
    const attach = page.getByRole('dialog', { name: 'Прикрепить файл' });
    await expect(attach).toContainText(cpName);
    await expect(attach.getByRole('listitem').filter({ hasText: name })).toContainText(
      'PDF · 3 КБ',
    );
    await attach.getByLabel('Примечание').fill('Подписан обеими сторонами');
    await attach.locator('[data-files-attach-ok]').click();
    await expect(attach).toBeHidden();
    const line = tab.locator('tbody tr').filter({ hasText: name });
    await expect(line.locator('[data-file-note]')).toHaveText('Подписан обеими сторонами');

    // Карандаш в строке: новое название, примечание убрано.
    await line.getByRole('button', { name: `Изменить ${name}` }).click();
    const dlg = page.getByRole('dialog', { name: 'Изменить файл' });
    await expect(dlg).toContainText('Загружен вручную');
    await expect(dlg.getByLabel('Название')).toHaveValue(`договор-${tag}`);
    await expect(dlg.getByLabel('Примечание')).toHaveValue('Подписан обеими сторонами');
    const renamed = `договор подписан-${tag}.pdf`;
    await dlg.getByLabel('Название').fill(`договор подписан-${tag}`);
    await dlg.getByLabel('Примечание').fill('');
    await dlg.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByText('Файл изменён')).toBeVisible();
    await expect(dlg).toBeHidden();
    const changed = tab.locator('tbody tr').filter({ hasText: renamed });
    await expect(changed).toBeVisible();
    await expect(changed.locator('[data-file-note]')).toHaveCount(0);

    // Окно файла: «Изменить» открывает то же окно; замена — «Файл заменён» и строка «Заменён».
    await changed.getByText(renamed, { exact: true }).click();
    const win = page.getByRole('dialog', { name: renamed });
    await expect(win).toContainText('Примечание');
    await win.locator('[data-file-window-edit]').click();
    await dlg.locator('[data-file-edit-input]').setInputFiles(pdf(`скан-${tag}.pdf`, 9 * 1024));
    await dlg.getByLabel('Примечание').fill('Скан с печатью');
    await dlg.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByText('Файл заменён')).toBeVisible();
    await expect(win).toContainText('Заменён');
    await expect(win.locator('[data-file-window-note]')).toHaveText('Скан с печатью');

    // История контрагента: прикрепление с примечанием и две правки файла.
    const history = (await (
      await page.request.get(`/api/contractors/${cp.id}/history`)
    ).json()) as { items: { action: string; changes: { field: string; to?: unknown }[] }[] };
    const ofFile = history.items.filter((h) =>
      h.changes.some((c) => c.field === 'file' && String(c.to).includes(tag)),
    );
    expect(ofFile.map((h) => h.action).sort()).toEqual(['file_attach', 'file_edit', 'file_edit']);
  });
});
