import { expect, test, type Locator, type Page } from '@playwright/test';
import { DEMO_PASSWORD, finger, newOrgOwner, settledBox, signIn } from './helpers';
import { asOwner, manualReport, newContractor, staffIds } from './reports';

// «Отчеты для сдачи» → вкладки и список (задача 2.13, #69) через настоящий сайт. Отчёты — «Разовым
// отчётом» через API у своего на каждый запуск и проект (ПК и телефон) контрагента: по слову в его
// названии они находятся общим поиском. Демо-организация: владелец erkin, главный бухгалтер meerim,
// бухгалтер alisher с областью «Свои контрагенты».

type Item = {
  id: string;
  contractor: { id: string; name: string };
  act: 'sub' | 'pay' | 'both';
  status: string;
  amount: number | null;
  responsible: { id: string } | null;
};

/** Слово из кириллицы, своё на каждый запуск: по нему поиск находит только отчёты этого теста. */
const uniqueWord = (prefix: string) =>
  `${prefix}${Array.from({ length: 6 }, () => 'абвгдежзиклмнопрстуф'[Math.floor(Math.random() * 20)]).join('')}`;

/** Общий поиск по вкладке (на телефоне — кнопкой «Поиск» в верхней панели). */
async function search(page: Page, isMobile: boolean, text: string) {
  if (isMobile) await page.getByRole('button', { name: 'Поиск', exact: true }).click();
  await page.getByRole('searchbox').first().fill(text);
}

/** Текст ячейки столбца `key` в строке таблицы (по порядку заголовков). */
const cellText = (grid: Locator, id: string, key: string) =>
  grid.evaluate(
    (el, [rowId, col]) => {
      const heads = [...el.querySelectorAll('thead tr:first-child th')];
      const i = heads.findIndex((th) => th.getAttribute('data-column') === col);
      const row = el.querySelector(`tbody tr[data-id="${rowId}"]`);
      return i < 0 || !row ? null : (row.children[i]?.textContent ?? null);
    },
    [id, key] as const,
  );

test.describe('Этап 2: отчёты — список и вкладки', () => {
  test('(п. 11, без шкалы оплаты) у НДС — «Сдача + уплата» и шкала сдачи, у патента — «Уплата» без шкалы сдачи, у 1-Т — «Сдача» без суммы; «Уплатить» — только отчёты, по которым есть что платить', async ({
    page,
    request,
    baseURL,
    isMobile,
  }) => {
    const origin = await asOwner(request, baseURL);
    const word = uniqueWord('Метки');
    const cp = await newContractor(request, origin, { name: `ОсОО «${word}»` });
    const report = (reportTypeCode: string, month: string) =>
      manualReport(request, origin, {
        contractorId: cp.id,
        reportTypeCode,
        month,
        due: '2030-01-15',
      });
    const nds = await report('nds', '2026-09-01');
    const pat = await report('pat', '2026-10-01');
    const t1 = await report('t1m', '2026-09-01');

    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    await page.goto('/app/reports/all');
    const grid = page.locator('[data-grid]');
    await expect(grid.locator('[data-id]').first()).toBeVisible();
    await search(page, isMobile, word);
    const row = (id: string) => grid.locator(`[data-id="${id}"]`);
    await expect(grid.locator('[data-id]')).toHaveCount(3);

    // Метка «Что сделать»: на ПК — столбец за видом отчёта, на телефоне — на плитке рядом с видом.
    await expect(row(nds).locator('[data-act]')).toHaveText('Сдача + уплата');
    await expect(row(nds).locator('[data-act]')).toHaveAttribute('data-act', 'both');
    await expect(row(pat).locator('[data-act]')).toHaveText('Уплата');
    await expect(row(t1).locator('[data-act]')).toHaveText('Сдача');
    // Шкала сдачи — у НДС и 1-Т; у патента вместо неё «—». Шкалу оплаты добавит задача 2.19.
    await expect(row(nds).locator('[data-status-mini]')).toContainText('К сдаче');
    await expect(row(t1).locator('[data-status-mini]')).toContainText('К сдаче');
    await expect(row(pat).locator('[data-status-mini]')).toHaveCount(0);
    if (isMobile) {
      // На плитке строки сумм у 1-Т нет: платить нечего.
      await expect(row(t1).locator('[data-tile-line]')).toHaveCount(0);
    } else {
      expect(await cellText(grid, pat, 'status')).toBe('—');
      expect(await cellText(grid, t1, 'amount')).toBe('—');
      expect(await cellText(grid, nds, 'amount')).toBe('не указана');
    }

    // Быстрый фильтр над списком.
    const quick = page.locator('[data-report-quick]');
    await quick.getByRole('button', { name: /^Уплатить/ }).click();
    await expect(grid.locator('[data-id]')).toHaveCount(2);
    await expect(row(nds)).toBeVisible();
    await expect(row(pat)).toBeVisible();
    await quick.getByRole('button', { name: /^Сдать/ }).click();
    await expect(grid.locator('[data-id]')).toHaveCount(2);
    await expect(row(nds)).toBeVisible();
    await expect(row(t1)).toBeVisible();
    await quick.getByRole('button', { name: /^Все/ }).click();
    await expect(grid.locator('[data-id]')).toHaveCount(3);

    // «Уплатить» по всей организации: только виды с уплатой, без «Не требуется» и нулевой суммы.
    const list = async (quickFilter: string) => {
      const res = await request.get(`/api/reports?size=all&tab=all&quick=${quickFilter}`);
      expect(res.status()).toBe(200);
      return ((await res.json()) as { items: Item[] }).items;
    };
    const toPay = await list('pay');
    expect(toPay.length).toBeGreaterThan(0);
    for (const r of toPay) {
      expect(r.act, r.id).not.toBe('sub');
      expect(r.status, r.id).not.toBe('not_required');
      expect(r.amount === null || r.amount > 0, r.id).toBe(true);
    }
    expect((await list('all')).length).toBeGreaterThan(toPay.length);
  });

  test('(п. 6, отчёты) бухгалтер с правом «только свои» видит в «Отчётах для сдачи» только свои отчёты: чужих нет ни в списке, ни в поиске, ни в фильтре, карточка чужого не открывается', async ({
    page,
    request,
    baseURL,
    isMobile,
  }) => {
    const origin = await asOwner(request, baseURL);
    const staff = await staffIds(request);
    const word = uniqueWord('Свои');
    const ownName = `ОсОО «${word} Алишера»`;
    const own = await newContractor(request, origin, {
      name: ownName,
      responsible: staff.alisher!,
    });
    const other = await newContractor(request, origin, {
      name: `ОсОО «${word} Мээрим»`,
      responsible: staff.meerim!,
    });
    const make = (contractorId: string) =>
      manualReport(request, origin, {
        contractorId,
        reportTypeCode: 'nds',
        month: '2026-09-01',
        due: '2030-01-15',
      });
    const ownReport = await make(own.id);
    const otherReport = await make(other.id);
    // Владелец видит оба отчёта.
    const both = await request.get(`/api/reports?size=all&q=${encodeURIComponent(word)}`);
    expect(((await both.json()) as { items: Item[] }).items.map((r) => r.id).sort()).toEqual(
      [ownReport, otherReport].sort(),
    );

    await signIn(page.request, origin, 'alisher', DEMO_PASSWORD);
    const api = page.request;
    // Каждый отчёт в списке бухгалтера — его: он ответственный за контрагента или за сам отчёт.
    const mine = (
      (await (await api.get('/api/reports?size=all&tab=all')).json()) as {
        items: Item[];
      }
    ).items;
    const cps = (
      (await (await api.get('/api/contractors?size=all')).json()) as {
        items: { id: string }[];
      }
    ).items;
    const ownCps = new Set(cps.map((c) => c.id));
    expect(ownCps.has(own.id)).toBe(true);
    expect(ownCps.has(other.id)).toBe(false);
    expect(mine.map((r) => r.id)).toContain(ownReport);
    expect(mine.map((r) => r.id)).not.toContain(otherReport);
    for (const r of mine) {
      expect(ownCps.has(r.contractor.id) || r.responsible?.id === staff.alisher, r.id).toBe(true);
    }
    // Чужой отчёт не открывается, его контрагента нет в значениях фильтра «Контрагент».
    expect((await api.get(`/api/reports/${otherReport}`)).status()).toBe(404);
    const values = await api.get(`/api/reports/values?col=cp&q=${encodeURIComponent(word)}`);
    expect(values.status()).toBe(200);
    expect(
      ((await values.json()) as { items: { value: string }[] }).items.map((v) => v.value),
    ).toEqual([ownName]);

    // На экране поиск по общему слову находит только свой отчёт.
    await page.goto('/app/reports/all');
    const grid = page.locator('[data-grid]');
    await expect(grid.locator('[data-id]').first()).toBeVisible();
    await search(page, isMobile, word);
    await expect(grid.locator('[data-id]')).toHaveCount(1);
    await expect(grid.locator(`[data-id="${ownReport}"]`)).toContainText(ownName);
  });

  test('(п. 9) на телефоне в «Отчётах для сдачи» доступны поиск, фильтры и действия над отчётом без правого клика: касание плитки открывает карточку, «⋯» и долгое нажатие — меню, «Изменить срок» переносит срок', async ({
    page,
    request,
    baseURL,
    isMobile,
  }) => {
    const origin = await asOwner(request, baseURL);
    const word = uniqueWord('Действия');
    const cp = await newContractor(request, origin, { name: `ОсОО «${word}»` });
    const report = (reportTypeCode: string) =>
      manualReport(request, origin, {
        contractorId: cp.id,
        reportTypeCode,
        month: '2026-09-01',
        due: '2030-01-15',
      });
    const nds = await report('nds');
    const t1 = await report('t1m');

    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    // Вид списка по умолчанию: тест переключает вид на телефоне, прерванный повтор мог его оставить.
    if (isMobile) {
      const reset = await page.request.delete('/api/view-settings/reports.all', {
        headers: { origin },
      });
      expect(reset.ok(), await reset.text()).toBe(true);
    }
    await page.goto('/app/reports/all');
    const grid = page.locator('[data-grid]');
    await expect(grid.locator('[data-id]').first()).toBeVisible();
    // На телефоне список — плитками, на ПК — таблицей.
    await expect(grid).toHaveAttribute('data-view', isMobile ? 'cards' : 'table');
    await search(page, isMobile, word);
    const row = (id: string) => grid.locator(`[data-id="${id}"]`);
    await expect(grid.locator('[data-id]')).toHaveCount(2);

    // Фильтр у столбца «Вид отчёта» (на телефоне — в виде «Таблица», как в прототипе); плашка фильтра
    // видна и в плитках, там же фильтр снимается.
    if (isMobile) await page.getByRole('button', { name: 'Вид списка: Таблица' }).click();
    await grid.getByRole('button', { name: 'Фильтр: Вид отчёта' }).click();
    const filter = page.getByRole('dialog', { name: 'Вид отчёта' });
    // «1-Т» месячный и годовой — одно значение, как в прототипе.
    await expect(filter.getByRole('checkbox', { name: /^1-Т(\s|$)/ })).toHaveCount(1);
    await filter.getByRole('checkbox', { name: /^НДС(\s|$)/ }).uncheck();
    await filter.getByRole('button', { name: 'Применить' }).click();
    await expect(grid.locator('[data-id]')).toHaveCount(1);
    await expect(row(t1)).toBeVisible();
    if (isMobile) await page.getByRole('button', { name: 'Вид списка: Карточки' }).click();
    const chip = grid.locator('[data-chip="type"]');
    await expect(chip).toContainText('Вид отчёта');
    await chip.getByRole('button', { name: 'Убрать фильтр' }).click();
    await expect(grid.locator('[data-id]')).toHaveCount(2);

    const menu = page.getByRole('menu', { name: 'Действия' });
    // Касание строки или плитки открывает карточку отчёта (задача 2.14, как в прототипе `open`).
    await row(nds).getByText(`ОсОО «${word}»`).click();
    const card = page.getByRole('dialog', { name: 'НДС' });
    await expect(card.locator(`[data-report-card="${nds}"]`)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Меню без правого клика: на телефоне — долгим нажатием на плитку, на ПК — правым кликом.
    if (isMobile) {
      const box = await settledBox(row(t1).locator('dl'));
      await (await finger(page)).hold({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
    } else {
      await row(t1).click({ button: 'right' });
    }
    await expect(menu.getByRole('menuitem', { name: 'Открыть карточку' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Изменить срок' })).toBeVisible();
    // У 1-Т платить нечего — «Указать сумму» нет.
    await expect(menu.getByRole('menuitem', { name: 'Указать сумму' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // «⋯» → «Изменить срок»: новый срок виден в строке с меткой «перенос».
    await row(nds).locator('[data-row-menu]').click();
    await menu.getByRole('menuitem', { name: 'Изменить срок' }).click();
    const dialog = page.getByRole('dialog', { name: 'Изменить срок сдачи' });
    await expect(dialog).toContainText(`ОсОО «${word}» · НДС 09.2026`);
    await expect(dialog).toContainText('Сейчас: 15.01.2030');
    await dialog.getByLabel(/^Новый срок/).fill('2030-01-17');
    await dialog.getByLabel(/^Комментарий/).fill('Попросил контрагент');
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'Срок сдачи изменён' })).toBeVisible();
    await expect(row(nds)).toContainText('17.01.2030');
    await expect(row(nds)).toContainText('перенос');
    await expect(row(t1)).toContainText('15.01.2030');
  });

  test('(проверка задачи 2.13) «Перейти» у шага «Скрыть и показать статистику модуля» ведёт на «На неделе» «Отчетов для сдачи», кнопка статистики засчитывает шаг', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    // Шаги засчитываются один раз и навсегда — у владельца новой организации.
    await newOrgOwner(page.request, new URL(baseURL!).origin);
    const stepDone = async () => {
      const res = await page.request.get('/api/kb/me');
      expect(res.status()).toBe(200);
      const me = (await res.json()) as { lessons: { steps: { id: string; done: unknown }[] }[] };
      return me.lessons.flatMap((l) => l.steps).find((x) => x.id === 'stats')?.done ?? null;
    };
    expect(await stepDone()).toBeNull();
    await page.goto('/app/kb/lessons');
    await page.locator('[data-kb-step="stats"]').getByRole('button', { name: 'Перейти' }).click();
    await expect(page).toHaveURL(/\/app\/reports\/week$/);
    // Список загружен — с ним и настройки вида: отчётов в новой организации ещё нет.
    await expect(
      page.getByText('Отчёты появятся, когда вы назначите виды отчётов контрагентам'),
    ).toBeVisible();
    // Статистика по умолчанию: на ПК показана, на телефоне скрыта.
    const toggle = page.locator('[data-stats-toggle]');
    await expect(toggle).toHaveAttribute('aria-pressed', isMobile ? 'false' : 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', isMobile ? 'true' : 'false');
    await expect(page.locator('[data-plates]')).toHaveCount(isMobile ? 1 : 0);
    await expect.poll(stepDone).not.toBeNull();
  });
});
