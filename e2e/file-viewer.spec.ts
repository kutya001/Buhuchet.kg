import { randomBytes } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { search } from './admin';
import { DEMO_PASSWORD, signIn } from './helpers';
import {
  oldDoc,
  win1251,
  XLSX_SHEETS,
  XML_EXTERNAL,
  xlsxTwoSheets,
  xmlWithEntity,
} from './view-files';

// Окно просмотра файлов (доработки 16.11.2026, блок 5; прототип v126 `ui/file-view.js`): файл
// открывается в окне без скачивания, «‹ ›» — соседние файлы того же списка.

/** Своя метка на каждый тест и проект: список файлов демо-организации общий. */
const uniqueTag = () => `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;

/** Загрузить файл вручную через API, как браузер: начать → PUT в хранилище → закончить. */
async function apiUpload(api: APIRequestContext, origin: string, name: string, body: Buffer) {
  const start = await api.post('/api/files/uploads', {
    headers: { origin },
    data: { source: { kind: 'manual', id: null }, name, size: body.length },
  });
  expect(start.status(), await start.text()).toBe(201);
  const ticket = (await start.json()) as {
    id: string;
    upload: { url: string; headers: Record<string, string> };
  };
  const put = await api.put(ticket.upload.url, { headers: ticket.upload.headers, data: body });
  expect(put.status(), await put.text()).toBe(200);
  const done = await api.post(`/api/files/${ticket.id}/complete`, { headers: { origin } });
  expect(done.status(), await done.text()).toBe(200);
  return ticket.id;
}

const fileRow = (page: Page, id: string) => page.locator(`[data-grid] [data-id="${id}"]`);

/** Открыть файл из строки «Файлового менеджера»: окно с названием файла и его просмотром. */
async function openFile(page: Page, id: string, name: string) {
  await fileRow(page, id).getByText(name, { exact: true }).click();
  const card = page.getByRole('dialog', { name });
  await expect(card.locator(`[data-file-viewer="${id}"]`)).toBeVisible();
  return card;
}

test.describe('Доработки 16.11. Окно просмотра файлов', () => {
  test('(сценарий 9) XLSX — листы вкладками, числа как в файле; TXT в Windows-1251 по-русски; XML с внешней сущностью — без загрузки внешнего; DOC — только «Скачать»; «‹ ›» — файлы списка', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const origin = new URL(baseURL!).origin;
    const tag = uniqueTag();
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    const names = {
      xlsx: `налоги-${tag}.xlsx`,
      txt: `выписка-${tag}.txt`,
      xml: `отчёт-ГНС-${tag}.xml`,
      doc: `договор-${tag}.doc`,
    };
    const ids = {
      xlsx: await apiUpload(page.request, origin, names.xlsx, xlsxTwoSheets()),
      txt: await apiUpload(
        page.request,
        origin,
        names.txt,
        win1251('Отчёт за октябрь\nИтого: 1 250,50 сом'),
      ),
      xml: await apiUpload(page.request, origin, names.xml, xmlWithEntity()),
      doc: await apiUpload(page.request, origin, names.doc, oldDoc()),
    };
    // Ни один запрос страницы не уходит по адресу внешней сущности XML.
    const external: string[] = [];
    page.on('request', (req) => {
      if (req.url().startsWith(new URL(XML_EXTERNAL).origin)) external.push(req.url());
    });

    await page.goto('/app/files');
    await expect(page.locator('[data-grid]')).toBeVisible();
    await search(page, isMobile, tag);
    await expect(fileRow(page, ids.doc)).toBeVisible();

    // XLSX: листы вкладками внизу, буквы столбцов, жирные заголовки, число в формате файла.
    let card = await openFile(page, ids.xlsx, names.xlsx);
    await expect(card.locator('[data-fsh]')).toHaveText([...XLSX_SHEETS]);
    await expect(card.locator('[data-fsh="0"]')).toHaveAttribute('aria-selected', 'true');
    await expect(card.locator('[data-cell="0:0"]')).toHaveText('Налог');
    await expect(card.locator('[data-cell="0:0"]')).toHaveClass(/font-bold/);
    await expect(card.locator('[data-cell="1:1"]')).toHaveText(/^1\s250,50$/);
    await card.locator('[data-fsh="1"]').click();
    await expect(card.locator('[data-cell="0:0"]')).toHaveText('Журнал записей');
    // Поиск по листу.
    await card.locator('[data-fsh="0"]').click();
    await card.locator('[data-fv-q]').fill('ндс');
    await card.locator('[data-fv-q]').press('Enter');
    await expect(card.locator('[data-fv-found]')).toHaveText('Найдено: 1');
    await expect(card.locator('[data-fv-download]')).toHaveAttribute(
      'href',
      `/api/files/${ids.xlsx}/download`,
    );

    // «‹ ›» — соседний файл того же списка (на ПК — ещё стрелки клавиатуры), счётчик «N из 4».
    await expect(card.locator('[data-fv-n]')).toHaveText(/из 4$/);
    const viewer = page.locator('[data-file-viewer]');
    const next = page.locator('[data-fv-next]');
    const forward = await next.isEnabled();
    await (forward ? next : page.locator('[data-fv-prev]')).click();
    await expect(viewer).not.toHaveAttribute('data-file-viewer', ids.xlsx);
    expect(Object.values(ids)).toContain(await viewer.getAttribute('data-file-viewer'));
    if (!isMobile) {
      await page.keyboard.press(forward ? 'ArrowLeft' : 'ArrowRight');
      await expect(viewer).toHaveAttribute('data-file-viewer', ids.xlsx);
    }
    await page
      .getByRole('dialog')
      .filter({ has: viewer })
      .getByRole('button', { name: 'Готово' })
      .click();
    await expect(viewer).toHaveCount(0);

    // TXT в Windows-1251: русский текст, кодировка определена сама; номера строк.
    card = await openFile(page, ids.txt, names.txt);
    await expect(card.locator('[data-fv="text"]')).toContainText('Отчёт за октябрь');
    await expect(card.locator('[data-fv="text"]')).toContainText('Итого: 1 250,50 сом');
    await expect(card.locator('[data-fv-enc]')).toHaveAttribute('data-fv-enc', 'windows-1251');
    await card.getByRole('button', { name: 'Готово' }).click();

    // XML с внешней сущностью: открыт с отступами, DOCTYPE пропущен с пометкой, внешнее не загружалось.
    card = await openFile(page, ids.xml, names.xml);
    await expect(card.locator('[data-fv="xml"]')).toContainText('ОсОО «Тест»');
    await expect(card.locator('[data-fv-doctype]')).toBeVisible();
    await card.getByRole('button', { name: 'Готово' }).click();
    expect(external).toEqual([]);

    // DOC — старый формат: просмотра нет, только «Скачать».
    card = await openFile(page, ids.doc, names.doc);
    await expect(card.locator('[data-fv-state="old"]')).toBeVisible();
    await expect(card.locator('[data-fv-state="old"] [data-fdl]')).toHaveAttribute(
      'href',
      `/api/files/${ids.doc}/download`,
    );
    await expect(card.locator('[data-fv="sheet"], [data-fv="doc"], [data-fv="text"]')).toHaveCount(
      0,
    );
    await card.getByRole('button', { name: 'Готово' }).click();
    await expect(viewer).toHaveCount(0);
  });
});
