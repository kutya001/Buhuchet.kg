import { expect, test, type Locator, type Page } from '@playwright/test';
import { DEMO_PASSWORD, signIn } from './helpers';

// Шкала статусов и «История статусов» (задача #17) через настоящий сайт: модулей с записями ещё нет,
// поэтому компоненты проверяются на странице образцов /samples с демо-записями (только в браузере).

async function openSamples(page: Page, baseURL: string | undefined) {
  await signIn(page.request, new URL(baseURL!).origin, 'erkin', DEMO_PASSWORD);
  await page.goto('/samples');
  await expect(page.getByRole('heading', { name: 'Образцы компонентов' })).toBeVisible();
}

async function openCard(page: Page, id: string, title: string): Promise<Locator> {
  await page.locator(`[data-sample="${id}"]`).click();
  const card = page.getByRole('dialog', { name: title });
  await expect(card.locator(`[data-sample-card="${id}"]`)).toBeVisible();
  return card;
}

/** Элементы карточки, которые вылезают за её правый край (обрезаны или уводят вбок). */
const overflowing = (card: Locator) =>
  card.evaluate((dialog) => {
    const edge = dialog.getBoundingClientRect().right + 1;
    return [...dialog.querySelectorAll('[data-sample-card] *')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > edge;
      })
      .map((el) => `${el.tagName} ${(el.textContent ?? '').slice(0, 40)}`);
  });

test.describe('Этап 1: шкала статусов и «История статусов»', () => {
  test('на телефоне шкала — шаги столбиком с датами справа, история — записи одна под другой; ничего не обрезано и не прокручивается вбок', async ({
    page,
    baseURL,
    isMobile,
  }) => {
    await openSamples(page, baseURL);
    const card = await openCard(page, 'task_failed', 'Задача: не выполнена');
    const scale = card.locator('ol[data-status-scale]');
    const steps = scale.locator(':scope > li > button');
    await expect(steps).toHaveCount(3);
    await expect(steps.nth(2)).toContainText('Не выполнена');
    await expect(steps.nth(2)).toContainText('на шаге 3 «Выполнена»');
    const boxes = await Promise.all(
      [0, 1, 2].map(async (i) => (await steps.nth(i).boundingBox())!),
    );
    const history = card.locator('[data-status-history]');
    const rows = history.locator('tbody > tr');
    await expect(rows).toHaveCount(5);
    // Сверху — новая запись; откат — с пометкой «Откат» и причиной.
    await expect(rows.first()).toContainText('Клиент не прислал документы');
    await expect(rows.nth(1)).toContainText('Откат');
    await expect(rows.nth(1)).toContainText('Отметили выполненной по ошибке');

    if (isMobile) {
      // Шаги — столбиком во всю ширину, дата и время — справа в строке шага.
      for (const [i, box] of boxes.entries()) {
        expect(Math.abs(box.x - boxes[0]!.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(box.width - boxes[0]!.width)).toBeLessThanOrEqual(1);
        if (i > 0) expect(box.y).toBeGreaterThan(boxes[i - 1]!.y + boxes[i - 1]!.height - 1);
        const date = steps.nth(i).locator('small', { hasText: /^\d\d\.\d\d\.\d{4} \d\d:\d\d$/ });
        const at = (await date.boundingBox())!;
        expect(at.x + at.width).toBeGreaterThan(box.x + box.width - 16);
        expect(at.x).toBeGreaterThan(box.x + box.width / 2);
      }
      expect(boxes[0]!.width).toBeGreaterThan(300);
      // История — записи одна под другой, без шапки таблицы, во всю ширину.
      await expect(history.locator('thead')).toBeHidden();
      const rowBoxes = await Promise.all(
        [0, 1, 2, 3, 4].map(async (i) => (await rows.nth(i).boundingBox())!),
      );
      for (const [i, box] of rowBoxes.entries()) {
        expect(Math.abs(box.x - rowBoxes[0]!.x)).toBeLessThanOrEqual(1);
        if (i > 0)
          expect(box.y).toBeGreaterThanOrEqual(rowBoxes[i - 1]!.y + rowBoxes[i - 1]!.height - 1);
      }
      await expect(rows.first()).toContainText('Кто: ');
      // Вбок не прокручивается ни шкала, ни история, ни страница.
      for (const el of [scale, history.locator('table')])
        expect(await el.evaluate((n) => n.scrollWidth - n.clientWidth)).toBeLessThanOrEqual(0);
    } else {
      // На ПК — шаги в строку, история — таблица с шапкой.
      expect(boxes[1]!.x).toBeGreaterThan(boxes[0]!.x + boxes[0]!.width);
      expect(boxes[2]!.x).toBeGreaterThan(boxes[1]!.x + boxes[1]!.width);
      await expect(history.locator('thead')).toBeVisible();
      await expect(history.locator('thead')).toContainText('В статусе');
    }
    expect(await overflowing(card)).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(0);

    // Две шкалы записи (сдача и оплата): на ПК — рядом, если помещаются; на телефоне — одна под
    // другой во всю ширину.
    await page.keyboard.press('Escape');
    const report = await openCard(page, 'report', 'Отчёт: сдача и оплата');
    const scales = report.locator('ol[data-status-scale]');
    await expect(scales).toHaveCount(2);
    if (isMobile) {
      const [sub, pay] = await Promise.all([
        scales.nth(0).boundingBox(),
        scales.nth(1).boundingBox(),
      ]);
      expect(pay!.y).toBeGreaterThan(sub!.y + sub!.height - 1);
      expect(Math.abs(pay!.width - sub!.width)).toBeLessThanOrEqual(1);
    }
    expect(await overflowing(report)).toEqual([]);
  });

  test('откат — только с правом и причиной: без причины ошибка, с причиной запись «Откат» в истории', async ({
    page,
    baseURL,
  }) => {
    await openSamples(page, baseURL);
    let card = await openCard(page, 'task_failed', 'Задача: не выполнена');
    await card.getByRole('button', { name: /^В работе/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Откатить: «Не выполнена» → «В работе»' });
    await expect(dialog).toContainText('Задача снова станет открытой у исполнителя');
    await dialog.getByRole('button', { name: 'Откатить' }).click();
    await expect(dialog.getByText('Укажите причину')).toBeVisible();
    await dialog.getByLabel('Причина отката').fill('  Поставили по ошибке  ');
    await dialog.getByRole('button', { name: 'Откатить' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Откат выполнен')).toBeVisible();
    const rows = card.locator('[data-status-history] tbody > tr');
    await expect(rows).toHaveCount(6);
    await expect(rows.first()).toContainText('Не выполнена');
    await expect(rows.first()).toContainText('Откат');
    await expect(rows.first()).toContainText('Поставили по ошибке');
    await expect(rows.first()).toContainText('Эркин С.');
    await expect(rows.first()).toContainText('сейчас');
    await expect(card.locator('[aria-current="step"]')).toContainText('В работе');

    // Без права «Откат статусов»: пройденные шаги не нажимаются, кнопок отката нет.
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();
    await page.getByLabel('Право «Откат статусов»').uncheck();
    card = await openCard(page, 'report_confirmed', 'Отчёт: сдача подтверждена');
    const steps = card.locator('ol[data-status-scale] > li > button');
    await expect(steps).toHaveCount(3);
    for (const i of [0, 1, 2]) await expect(steps.nth(i)).toHaveAttribute('aria-disabled', 'true');
    await expect(card.getByText('откатить')).toHaveCount(0);
    await expect(card.locator('[data-rollback-to]')).toHaveCount(0);
    await steps.nth(1).click({ force: true });
    await expect(page.getByRole('dialog', { name: /^Откатить/ })).toHaveCount(0);

    // С правом — снять подтверждение сдачи: «Подтверждено» → «Ждёт подтверждения».
    await page.keyboard.press('Escape');
    await page.getByLabel('Право «Откат статусов»').check();
    card = await openCard(page, 'report_confirmed', 'Отчёт: сдача подтверждена');
    await expect(card.locator('ol[data-status-scale]')).toContainText('Подтверждено');
    await card.locator('[data-rollback-to="waiting"]').click();
    const unconfirm = page.getByRole('dialog', {
      name: 'Откатить: «Подтверждено» → «Ждёт подтверждения»',
    });
    await unconfirm.getByLabel('Причина отката').fill('Подтвердили не тот отчёт');
    await unconfirm.getByRole('button', { name: 'Откатить' }).click();
    await expect(card.locator('ol[data-status-scale]')).toContainText('Ждёт подтверждения');
    await expect(card.locator('[data-status-history] tbody > tr').first()).toContainText(
      'Подтвердили не тот отчёт',
    );
  });

  test('следующий шаг — по нажатию и подтверждению; закрытый шаг объясняет почему', async ({
    page,
    baseURL,
  }) => {
    await openSamples(page, baseURL);
    const card = await openCard(page, 'report', 'Отчёт: сдача и оплата');
    const submit = card.getByRole('button', { name: /^3\s*Сдан/ });
    await expect(submit).toHaveAttribute('title', 'Сначала отметьте оплату налога');
    await expect(card).toContainText('«Сдан»: Сначала отметьте оплату налога');
    await card.getByRole('button', { name: /Оплачено частично/ }).click();
    const confirm = page.getByRole('dialog', { name: 'Перевести в «Оплачено частично»?' });
    await confirm.getByRole('button', { name: 'Перевести' }).click();
    await expect(page.getByText('Статус: Оплачено частично')).toBeVisible();
    const payment = card.locator('[data-status-history]').nth(1);
    await expect(payment.locator('tbody > tr').first()).toContainText('Не оплачено →');
    await expect(payment.locator('tbody > tr').first()).toContainText('Оплачено частично');
    await expect(submit).toHaveAttribute('title', 'Перевести в «Сдан»');
    await expect(card).not.toContainText('«Сдан»: Сначала отметьте оплату налога');
  });
});
