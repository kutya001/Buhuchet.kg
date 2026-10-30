import { expect, test, type Page } from '@playwright/test';
import { search } from './admin';
import { DEMO_PASSWORD, signIn } from './helpers';
import { asOwner, manualReport, newContractor, reportsOf } from './reports';

// «Кто что сдаёт», массовое назначение, «Календарь», «сменить» ответственного и перенос срока «Разового
// отчёта» с нерабочего дня (задача 2.15, #71) через настоящий сайт. Контрагенты — свои на каждый запуск
// и проект (ПК и телефон): по слову в названии их находит общий поиск вкладки. Демо-организация:
// владелец erkin, главный бухгалтер meerim, бухгалтер alisher.

/** Слово из кириллицы, своё на каждый запуск: по нему поиск находит только записи этого теста. */
const uniqueWord = (prefix: string) =>
  `${prefix}${Array.from({ length: 6 }, () => 'абвгдежзиклмнопрстуф'[Math.floor(Math.random() * 20)]).join('')}`;

/** Сегодня по Бишкеку. */
const bishkekToday = () => new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 10);

/** Месяц `YYYY-MM` через `n` месяцев. */
function addMonths(month: string, n: number): string {
  const total = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** Суббота и воскресенье — на понедельник (25-е и 15-е число праздниками в КР не бывают). */
function weekday(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const add = d.getUTCDay() === 6 ? 2 : d.getUTCDay() === 0 ? 1 : 0;
  return new Date(d.getTime() + add * 86_400_000).toISOString().slice(0, 10);
}

/** ДД.ММ.ГГГГ, как на экране. */
const ru = (iso: string) => iso.split('-').reverse().join('.');

async function addMenu(page: Page, item: string) {
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByRole('menu', { name: 'Добавить' }).getByRole('menuitem', { name: item }).click();
}

/** Короткое имя сотрудника демо-организации по логину. */
async function shortName(page: Page, login: string): Promise<{ id: string; shortName: string }> {
  const res = await page.request.get('/api/staff?size=all');
  expect(res.status()).toBe(200);
  const { items } = (await res.json()) as {
    items: { id: string; login: string; shortName: string }[];
  };
  return items.find((e) => e.login === login)!;
}

test.describe('Этап 2: отчёты — «Кто что сдаёт», массовое назначение и «Календарь»', () => {
  test('(п. 1) вид «НДС» назначен трём контрагентам одним действием: у каждого отчёты на текущий и следующий месяц с правильным сроком; в «Кто что сдаёт» — галочки, снятая галочка спрашивает «Снять назначение» с числом будущих отчётов', async ({
    page,
    request,
    baseURL,
    isMobile,
  }) => {
    const origin = await asOwner(request, baseURL);
    const word = uniqueWord('Массово');
    const cps: Awaited<ReturnType<typeof newContractor>>[] = [];
    for (const n of [1, 2, 3]) {
      cps.push(await newContractor(request, origin, { name: `ОсОО «${word} ${n}»` }));
    }

    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    await page.goto('/app/reports/matrix');
    await expect(page.locator('[data-matrix]')).toBeVisible();

    await test.step('«+ Добавить» → «Назначить отчёты массово»: НДС, три компании, ставка 12 %', async () => {
      await addMenu(page, 'Назначить отчёты массово');
      const dialog = page.getByRole('dialog', { name: 'Назначить отчёт нескольким контрагентам' });
      await expect(dialog.locator('[data-mass-type]')).toHaveValue('nds');
      await expect(dialog).toContainText('Срок: до 25-го числа месяца после отчётного');
      const box = (id: string) => dialog.locator(`[data-mass-cp="${id}"] input`);
      // «Отметить все подходящие» — все, кто ещё не сдаёт и кому вид подходит; смена вида снимает отметки.
      await dialog.locator('[data-mass-all]').click();
      for (const cp of cps) await expect(box(cp.id)).toBeChecked();
      const free = await dialog.locator('[data-mass-cp] input:not(:disabled)').count();
      await expect(dialog.locator('[data-mass-selected]')).toHaveText(`Выбрано: ${free}`);
      const other = await dialog
        .locator('[data-mass-type] option:not([value="nds"])')
        .first()
        .getAttribute('value');
      await dialog.locator('[data-mass-type]').selectOption(other!);
      await dialog.locator('[data-mass-type]').selectOption('nds');
      await expect(dialog.locator('[data-mass-selected]')).toHaveText('Выбрано: 0');
      for (const cp of cps) await box(cp.id).check();
      await expect(dialog.locator('[data-mass-selected]')).toHaveText('Выбрано: 3');
      await dialog.locator('[data-mass-rate]').selectOption('12 %');
      await dialog.getByRole('button', { name: 'Назначить' }).click();
      await expect(dialog).toBeHidden();
      await expect(
        page.getByRole('status').getByText('НДС назначен: 3 контрагентам'),
      ).toBeVisible();
    });

    await test.step('у каждого — НДС за текущий и следующий месяц, срок 25-го следующего месяца', async () => {
      const month = bishkekToday().slice(0, 7);
      const expected = [0, 1].map((n) => {
        const period = addMonths(month, n);
        const base = `${addMonths(period, 1)}-25`;
        return [`${period}-01`, base, weekday(base)];
      });
      for (const cp of cps) {
        const rows = (await reportsOf(request, cp.inn))
          .filter((r) => r.type.code === 'nds')
          .sort((a, b) => a.periodStart.localeCompare(b.periodStart));
        expect(rows.map((r) => [r.periodStart, r.dueBase, r.dueDate])).toEqual(expected);
      }
    });

    await test.step('«Кто что сдаёт»: три галочки НДС, снятая — после «Снять назначение»', async () => {
      await search(page, isMobile, word);
      await expect(page.locator('[data-matrix-cp]')).toHaveCount(3);
      const cell = (id: string) =>
        page.locator(`[data-matrix-cp="${id}"] [data-matrix-cell="nds"]`);
      for (const cp of cps) await expect(cell(cp.id)).toBeChecked();
      await expect(page.locator('[data-matrix-total="nds"]')).toHaveText('3');

      await cell(cps[2]!.id).click();
      const ask = page.getByRole('dialog', { name: 'Снять назначение: НДС?' });
      await expect(ask).toContainText('Будущих несданных отчётов: 2');
      await ask.getByRole('button', { name: 'Снять' }).click();
      await expect(page.getByRole('status').getByText('Назначение снято')).toBeVisible();
      await expect(cell(cps[2]!.id)).not.toBeChecked();
      await expect(page.locator('[data-matrix-total="nds"]')).toHaveText('2');
      const left = (await reportsOf(request, cps[2]!.inn)).filter((r) => r.type.code === 'nds');
      expect(left).toHaveLength(2);

      // Галочка снова назначает вид с текущего месяца.
      await cell(cps[2]!.id).click();
      await expect(
        page.getByRole('status').getByText(`НДС назначен: ОсОО «${word} 3»`),
      ).toBeVisible();
      await expect(cell(cps[2]!.id)).toBeChecked();
    });
  });

  test('(задача 2.15) «Календарь»: у дня число отчётов к сдаче, нажатие на день открывает список отчётов на эту дату; в карточке «сменить» меняет ответственного, в истории — прежний и новый ответственный', async ({
    page,
    request,
    baseURL,
    isMobile,
  }) => {
    const origin = await asOwner(request, baseURL);
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    const [alisher, meerim] = [await shortName(page, 'alisher'), await shortName(page, 'meerim')];
    const word = uniqueWord('Календарь');
    const cp = await newContractor(request, origin, {
      name: `ОсОО «${word}»`,
      responsible: alisher.id,
    });
    const due = weekday(`${addMonths(bishkekToday().slice(0, 7), 1)}-15`);
    const id = await manualReport(request, origin, {
      contractorId: cp.id,
      reportTypeCode: 't1m',
      month: '2026-09-01',
      due,
    });

    await page.goto('/app/reports/calendar');
    await expect(page.locator('[data-calendar-month]')).toBeVisible();
    await page.locator('[data-calendar-move="1"]').click();
    const day = page.locator(`[data-day="${due}"]`);
    await expect(day).toContainText('к сдаче');
    await day.click();
    await expect(day).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(`Отчёты со сроком ${ru(due)}`)).toBeVisible();
    const list = page.locator(`[data-calendar-list="${due}"]`);
    await search(page, isMobile, word);
    await expect(list.locator('[data-id]')).toHaveCount(1);
    await list.locator(`[data-id="${id}"]`).click();

    const card = page
      .getByRole('dialog')
      .filter({ has: page.locator(`[data-report-card="${id}"]`) });
    await expect(card).toContainText(alisher.shortName);
    await card.locator('[data-report-responsible]').click();
    await page
      .getByRole('menu', { name: 'Ответственный' })
      .getByRole('menuitem', { name: meerim.shortName, exact: true })
      .click();
    await expect(page.getByRole('status').getByText('Ответственный изменён')).toBeVisible();
    await expect(card).toContainText(`Ответственный: ${alisher.shortName} → ${meerim.shortName}`);
    const saved = await request.get(`/api/reports/${id}`);
    expect(((await saved.json()) as { responsible: { id: string } }).responsible.id).toBe(
      meerim.id,
    );
  });

  test('(задача 2.15) «Разовый отчёт»: срок на нерабочий день — подсказка «… — нерабочий день: срок будет …», отчёт создан со сроком на ближайший рабочий день', async ({
    page,
    request,
    baseURL,
  }) => {
    const origin = await asOwner(request, baseURL);
    const cp = await newContractor(request, origin, { name: `ОсОО «${uniqueWord('Перенос')}»` });
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    await page.goto('/app/reports/all');
    await expect(page.locator('[data-grid]')).toBeVisible();
    await addMenu(page, 'Разовый отчёт');
    const dialog = page.getByRole('dialog', { name: 'Разовый отчёт' });
    await dialog.getByLabel('Контрагент').selectOption(cp.id);
    await dialog.getByLabel('Вид отчёта').selectOption('t1m');
    await dialog.getByLabel('Месяц периода').fill('2026-09');
    await expect(dialog).toContainText('Срок на нерабочий день переносится на ближайший рабочий');
    // 12.12.2026 — суббота: срок будет 14.12.2026.
    await dialog.getByLabel('Срок сдачи').fill('2026-12-12');
    await expect(dialog.locator('[data-due-shift]')).toHaveText(
      '12.12.2026 — нерабочий день: срок будет 14.12.2026',
    );
    await dialog.getByRole('button', { name: 'Создать отчёт' }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page
        .getByRole('status')
        .getByText('Отчёт создан; срок 12.12.2026 — нерабочий день, перенесён на 14.12.2026'),
    ).toBeVisible();
    const rows = (await reportsOf(request, cp.inn)).filter((r) => r.type.code === 't1m');
    expect(rows.map((r) => r.dueDate)).toEqual(['2026-12-14']);
    const card = page.getByRole('dialog').filter({ has: page.locator('[data-report-card]') });
    await expect(card).toContainText('14.12.2026');
    await expect(card).toContainText('срок 12.12.2026 — нерабочий день, перенесён на 14.12.2026');
  });
});
