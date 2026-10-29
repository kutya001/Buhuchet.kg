import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { newOrgOwner, signIn, uniqueInn, uniqueLogin } from './helpers';

// «Показатели контрагентов» → «Ввод из Excel» (задача 2.28, #84). Своя новая организация на тест
// (`newOrgOwner`): бухгалтер с двумя своими контрагентами и контрагент владельца.

/** Месяц «ГГГГ-ММ» на `shift` месяцев от текущего по Бишкеку (UTC+6). */
function monthAt(shift: number): string {
  const now = new Date(Date.now() + 6 * 3_600_000);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + shift, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const MONTHS = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
];

/** Файлы архива .xlsx текстом (центральный каталог, сжатие deflate). */
function unzip(buf: Buffer): Record<string, string> {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let at = buf.readUInt32LE(end + 16);
  const out: Record<string, string> = {};
  for (let i = buf.readUInt16LE(end + 10); i > 0; i--) {
    const size = buf.readUInt32LE(at + 20);
    const nameLength = buf.readUInt16LE(at + 28);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString('ascii', at + 46, at + 46 + nameLength);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    out[name] = (buf.readUInt16LE(at + 10) === 8 ? inflateRawSync(data) : data).toString('utf8');
    at += 46 + nameLength + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
  }
  return out;
}

interface Org {
  origin: string;
  inn: Record<string, string>;
  ids: Record<string, string>;
  accountant: { login: string; password: string };
}

/**
 * Организация: показатели включены, бухгалтер ведёт «Альфу» и «Бету», владелец — «Гамму»;
 * «Количество сотрудников» ведётся только у «Гаммы».
 */
async function importOrg(api: APIRequestContext, origin: string): Promise<Org> {
  await newOrgOwner(api, origin);
  const policy = (await (await api.get('/api/org/policy')).json()) as { version: number };
  const on = await api.patch('/api/org/policy', {
    headers: { origin },
    data: { version: policy.version, features: { indicators: true } },
  });
  expect(on.status(), await on.text()).toBe(200);
  const roles = (await (await api.get('/api/roles?size=all')).json()) as {
    items: { id: string; name: string }[];
  };
  const login = uniqueLogin('e2e-kimp');
  const hired = await api.post('/api/staff', {
    headers: { origin },
    data: {
      fullName: 'Бухгалтерова Импорт',
      login,
      phone: null,
      roleId: roles.items.find((r) => r.name === 'Бухгалтер')!.id,
    },
  });
  expect(hired.status(), await hired.text()).toBe(201);
  const created = (await hired.json()) as {
    employee: { id: string };
    temporaryPassword: string;
  };
  const staff = (await (await api.get('/api/staff?size=all')).json()) as {
    items: { id: string }[];
  };
  const ownerId = staff.items.find((s) => s.id !== created.employee.id)!.id;
  const inn: Record<string, string> = {};
  const ids: Record<string, string> = {};
  for (const [name, responsible] of [
    ['ОсОО «Альфа»', created.employee.id],
    ['ОсОО «Бета»', created.employee.id],
    ['ОсОО «Гамма»', ownerId],
  ] as const) {
    inn[name] = `0${uniqueInn().slice(1)}`;
    const res = await api.post('/api/contractors', {
      headers: { origin },
      data: {
        name,
        inn: inn[name],
        phone: '+996505890076',
        kind: 'regular',
        formCode: 'ФС-01',
        regimeCode: 'РЕЖ-01',
        gked: '46.34.0',
        startDate: `${monthAt(-12)}-01`,
        responsibleEmployeeId: responsible,
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    ids[name] = ((await res.json()) as { id: string }).id;
  }
  // «Количество сотрудников» — только «Гамме»: у контрагентов бухгалтера этот показатель не ведётся.
  const list = (await (await api.get('/api/kpi/indicators')).json()) as {
    items: { id: string; name: string }[];
  };
  const staffCount = list.items.find((i) => i.name === 'Количество сотрудников')!.id;
  const card = (await (await api.get(`/api/kpi/indicators/${staffCount}`)).json()) as Record<
    string,
    unknown
  >;
  const saved = await api.put(`/api/kpi/indicators/${staffCount}`, {
    headers: { origin },
    data: {
      name: card.name,
      unit: card.unit,
      type: card.type,
      total: card.total,
      description: card.description,
      required: card.required,
      dueDay: card.dueDay,
      start: card.start,
      scope: 'selected',
      autoNew: false,
      selected: [ids['ОсОО «Гамма»']],
      version: card.version,
    },
  });
  expect(saved.status(), await saved.text()).toBe(200);
  await api.post('/api/auth/logout', { headers: { origin } });

  // Бухгалтер входит и меняет временный пароль.
  await signIn(api, origin, login, created.temporaryPassword);
  const password = 'Свой-пароль-e2e-2';
  const changed = await api.post('/api/auth/password', {
    headers: { origin },
    data: { currentPassword: created.temporaryPassword, newPassword: password },
  });
  expect(changed.status(), await changed.text()).toBe(200);
  return { origin, inn, ids, accountant: { login, password } };
}

/**
 * «Ввод из Excel»: на ПК — своя кнопка рядом с «+ Добавить»; на телефоне — «+ Добавить», а у бухгалтера
 * (без права «Настраивать показатели») это единственный способ, и кнопка сразу открывает окно.
 */
async function openImport(page: Page, isMobile: boolean) {
  if (isMobile) {
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  } else {
    await page.getByRole('button', { name: 'Ввод из Excel' }).click();
  }
  const dialog = page.getByRole('dialog', { name: 'Ввод из Excel' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('Этап 2: Показатели контрагентов — ввод из Excel', () => {
  test('(п. 45) бухгалтер скачивает шаблон: только его контрагенты и ведущиеся показатели, ИНН и названия защищены; «abc» — ошибка с номером строки, остальное применено, в истории значения «Из Excel»', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const api = page.request;
    const origin = new URL(baseURL!).origin;
    const org = await importOrg(api, origin);
    const month = monthAt(-1);
    const head = `Выручка · ${month.slice(5)}.${month.slice(0, 4)}`;

    await page.goto('/app/kpi/month');
    const dialog = await openImport(page, isMobile);

    // Шаг 1: по умолчанию — прошлый месяц; в предпросмотре — только контрагенты бухгалтера.
    await expect(dialog.getByLabel('С месяца')).toHaveValue(month);
    await expect(dialog.getByLabel('По месяц')).toHaveValue(month);
    const preview = dialog.locator('[data-kpi-import-preview]');
    await expect(preview).toContainText('ОсОО «Альфа»');
    await expect(preview).toContainText('ОсОО «Бета»');
    await expect(preview).not.toContainText('ОсОО «Гамма»');
    await expect(preview).toContainText(head);
    await expect(preview).not.toContainText('Количество сотрудников');
    await expect(dialog).toContainText('В шаблоне 2 контрагента и 1 столбец показателей');

    const download = page.waitForEvent('download');
    const response = page.waitForResponse((r) => r.url().includes('/api/kpi/import/template?'));
    await dialog.getByRole('button', { name: 'Скачать шаблон .xlsx' }).click();
    const file = await download;
    // Имя файла задаёт сервер: «Показатели сентябрь 2026.xlsx».
    expect((await response).headers()['content-disposition']).toContain(
      encodeURIComponent(
        `Показатели ${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}.xlsx`,
      ),
    );
    const xlsx = unzip(readFileSync((await file.path())!));
    const sheet = xlsx['xl/worksheets/sheet1.xml']!;
    expect(sheet).toContain(org.inn['ОсОО «Альфа»']);
    expect(sheet).toContain(org.inn['ОсОО «Бета»']);
    expect(sheet).not.toContain(org.inn['ОсОО «Гамма»']);
    expect(sheet).not.toContain('Количество сотрудников');
    // Лист защищён; ИНН и название — защищённые ячейки (стиль без «locked=0»).
    expect(sheet).toContain('<sheetProtection sheet="1"');
    expect(sheet).toMatch(/<c r="A2" t="inlineStr" s="5">/);
    expect(xlsx['xl/workbook.xml']).toContain('name="Подсказки"');

    // Шаг 2 открылся сам: загружаем заполненный шаблон с «abc» во второй строке.
    await expect(dialog.locator('[data-kpi-import="load"]')).toBeVisible();
    const csv = [
      `ИНН;Контрагент;${head} (сом, сумма в сом)`,
      `${org.inn['ОсОО «Альфа»']};ОсОО «Альфа»;1 250 000`,
      `${org.inn['ОсОО «Бета»']};ОсОО «Бета»;abc`,
    ].join('\r\n');
    await dialog.locator('[data-kpi-import-drop] input[type=file]').setInputFiles({
      name: 'Показатели заполненные.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf8'),
    });
    await expect(dialog.locator('[data-kpi-import-file]')).toHaveText('Показатели заполненные.csv');
    await expect(dialog.locator('[data-plate="kxn"]')).toContainText('1');
    await expect(dialog.locator('[data-plate="kxe"]')).toContainText('1');
    const errors = dialog.locator('[data-kpi-import-errors]');
    await expect(errors).toContainText('C3');
    await expect(errors).toContainText('ОсОО «Бета»');
    await expect(errors).toContainText('abc');
    await expect(errors).toContainText('не число');
    await expect(dialog.locator('[data-kpi-import-items="added"]')).toContainText('ОсОО «Альфа»');

    await dialog.getByRole('button', { name: 'Применить 1' }).click();
    await expect(page.getByText('Записано значений: 1, ошибок осталось: 1')).toBeVisible();
    await expect(dialog).toContainText('Записано: новых 1, изменённых 0');

    // «История загрузок»: файл, новых 1, ошибок 1.
    await dialog.getByRole('button', { name: 'История загрузок' }).click();
    const history = page.getByRole('dialog', { name: 'История загрузок' });
    await expect(history.locator('[data-kpi-import-history]')).toContainText(
      'Показатели заполненные.csv',
    );
    await history.getByRole('button', { name: 'Готово' }).click();
    await expect(history).toBeHidden();

    // Значение «Альфы» записано, «Беты» — нет; в истории значения — «Из Excel».
    const entry = async (name: string) =>
      (await (
        await api.get(`/api/kpi/entry?contractorId=${org.ids[name]}&month=${month}`)
      ).json()) as {
        items: { indicator: { name: string }; value: number | null }[];
        history: { reason: string | null }[];
      };
    const alpha = await entry('ОсОО «Альфа»');
    expect(alpha.items.find((i) => i.indicator.name === 'Выручка')!.value).toBe(125_000_000);
    expect(alpha.history.map((h) => h.reason)).toEqual(['xlsx']);
    expect((await entry('ОсОО «Бета»')).items.every((i) => i.value === null)).toBe(true);

    if (isMobile) {
      await page.goto('/app/kpi/month');
      await page.locator('[data-kpi-month-pick]').click();
      await page.locator(`[data-kpi-choice="${month}"]`).click();
      await page.locator(`[data-kpi-tile="${org.ids['ОсОО «Альфа»']}"]`).click();
    } else {
      await page.goto('/app/kpi/period');
      const main = page.locator('main');
      await main.getByLabel('С', { exact: true }).fill(month);
      await main.getByLabel('по', { exact: true }).fill(month);
      const row = page
        .locator('[data-grid] [data-id]')
        .filter({ hasText: 'ОсОО «Альфа»' })
        .filter({ hasText: 'Выручка' });
      await row.locator(`[data-kpi-cell$="|${month}"]`).click();
    }
    const card = page.getByRole('dialog', { name: 'ОсОО «Альфа»' });
    await expect(card).toContainText('Из Excel');
  });
});
