import { expect, test, type Locator, type Page } from '@playwright/test';
import { defaultResponsible } from './helpers';
import { orgWithTypes } from './orgs';
import { assign, newContractor } from './reports';

// Прототип v84: дата начала обслуживания исправляется в «Изменить контрагента» с причиной
// (docs/deviations.md п. О-73). Своя организация теста со всеми видами отчётов; контрагент — свой
// на каждый запуск и проект (ПК и телефон).

/** Слово из кириллицы, своё на каждый запуск: по нему поиск находит только контрагента теста. */
const uniqueWord = (prefix: string) =>
  `${prefix}${Array.from({ length: 6 }, () => 'абвгдежзиклмнопрстуф'[Math.floor(Math.random() * 20)]).join('')}`;

/** Сегодня и завтра по Бишкеку (UTC+6). */
const bishkekDay = (plus = 0) =>
  new Date(Date.now() + 6 * 3_600_000 + plus * 86_400_000).toISOString().slice(0, 10);

const rows = (page: Page) => page.locator('[data-grid] [data-id]');

async function openEdit(page: Page, card: Locator) {
  await card.locator('[data-cp-more]').click();
  await page
    .getByRole('menu', { name: 'Действия' })
    .getByRole('menuitem', { name: 'Изменить' })
    .click();
  const edit = page.getByRole('dialog', { name: 'Изменить контрагента' });
  await expect(edit.locator('[data-cp-field="start-date"]')).toBeVisible({ timeout: 15_000 });
  return edit;
}

test('(проверка прототипа v84) дата начала обслуживания исправляется в «Изменить контрагента» только с причиной: не позже сегодняшней и не позже первого сданного отчёта; карточка, период обслуживания и история показывают новую дату', async ({
  page,
  baseURL,
  isMobile,
}) => {
  const origin = new URL(baseURL!).origin;
  await orgWithTypes(page.request, origin);
  const word = uniqueWord('Начало');
  const name = `ОсОО «${word}»`;
  const cp = await newContractor(page.request, origin, { name, tariff: false });
  // Соцфонд с апреля 2026, прошлые периоды отмечены сданными: первый сдан в мае 2026.
  await assign(page.request, origin, {
    contractorId: cp.id,
    reportTypeCode: 'soc',
    fromMonth: '2026-04-01',
    markPast: true,
  });

  await page.goto('/app/cps/all');
  await expect(rows(page).first()).toBeVisible();
  if (isMobile) await page.getByRole('button', { name: 'Поиск', exact: true }).click();
  await page.getByRole('searchbox').first().fill(word);
  await rows(page).filter({ hasText: name }).first().getByText(name, { exact: true }).click();
  const card = page.getByRole('dialog', { name });
  await expect(card.locator('[data-cp-card]')).toBeVisible();
  await expect(card).toContainText('01.01.2026');

  const edit = await openEdit(page, card);
  const date = edit.locator('[data-cp-field="start-date"]');
  const reason = edit.locator('[data-cp-field="start-reason"]');
  const save = edit.locator('[data-cp-save]');

  await test.step('поля: дата с подсказкой и причина; новая дата без причины не сохраняется', async () => {
    await expect(date).toHaveValue('2026-01-01');
    await expect(edit).toContainText('Дата начала обслуживания');
    await expect(edit).toContainText(
      'С этой даты ведётся учёт контрагента: первый период обслуживания, начисления за обслуживание и месяцы показателей',
    );
    await expect(edit).toContainText('Обязательна, если дата начала меняется');
    await date.fill('2026-03-10');
    await save.click();
    await expect(edit).toContainText('Укажите причину: меняется дата начала');
  });

  await test.step('позже сегодняшней и позже первого сданного отчёта — отказ под полем даты', async () => {
    await reason.fill('внесли с ошибкой');
    await date.fill(bishkekDay(1));
    await save.click();
    await expect(edit).toContainText('Дата не может быть позже сегодняшней');
    await date.fill('2026-09-01');
    await save.click();
    await expect(edit).toContainText(
      /Отчёт «.+ 04\.2026» сдан \d\d\.05\.2026: дата начала должна быть не позже/,
    );
  });

  await test.step('дата с причиной сохраняется: карточка, период обслуживания, история', async () => {
    await date.fill('2026-03-10');
    await save.click();
    await expect(edit).toBeHidden();
    await expect(page.getByText('Контрагент сохранён').first()).toBeVisible();
    await expect(card).toContainText('10.03.2026');
    await expect(card).not.toContainText('01.01.2026');
    await expect(card).toContainText('Периоды обслуживания: 03.2026–…');
    if (isMobile) {
      await card.getByRole('tab', { selected: true }).click();
      await page
        .getByRole('menu')
        .getByRole('menuitem', { name: /^История/ })
        .click();
    } else {
      await card.getByRole('tab', { name: /^История/ }).click();
    }
    await expect(card).toContainText(
      'Дата начала обслуживания: 01.01.2026 → 10.03.2026. Причина: внесли с ошибкой',
    );
  });

  await test.step('та же дата — «Изменений нет», причина без новой даты не нужна', async () => {
    const again = await openEdit(page, card);
    await expect(again.locator('[data-cp-field="start-date"]')).toHaveValue('2026-03-10');
    await expect(again.locator('[data-cp-field="start-reason"]')).toHaveValue('');
    await again.locator('[data-cp-save]').click();
    await expect(page.getByText('Изменений нет').first()).toBeVisible();
    await expect(again).toBeHidden();
  });

  await test.step('у разового контрагента поле называется «Дата первого обращения», подсказки нет', async () => {
    const oneWord = uniqueWord('Разовый');
    const oneName = `ИП ${oneWord}`;
    const created = await page.request.post('/api/contractors', {
      headers: { origin },
      data: {
        name: oneName,
        inn: `08${Date.now().toString().slice(-8)}${String(Math.floor(Math.random() * 10_000)).padStart(4, '0')}`,
        phone: '+996505890076',
        kind: 'oneoff',
        formCode: 'ФС-01',
        regimeCode: 'РЕЖ-01',
        gked: '46.34.0',
        startDate: '2026-02-01',
        responsibleEmployeeId: await defaultResponsible(page.request),
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    await page.goto('/app/cps/all');
    await expect(rows(page).first()).toBeVisible();
    if (isMobile) await page.getByRole('button', { name: 'Поиск', exact: true }).click();
    await page.getByRole('searchbox').first().fill(oneWord);
    await rows(page)
      .filter({ hasText: oneName })
      .first()
      .getByText(oneName, { exact: true })
      .click();
    const oneCard = page.getByRole('dialog', { name: oneName });
    await expect(oneCard.locator('[data-cp-card]')).toBeVisible();
    const oneEdit = await openEdit(page, oneCard);
    await expect(oneEdit).toContainText('Дата первого обращения');
    await expect(oneEdit).not.toContainText('Дата начала обслуживания');
    await expect(oneEdit).not.toContainText('С этой даты ведётся учёт контрагента');
    await expect(oneEdit.locator('[data-cp-field="start-date"]')).toHaveValue('2026-02-01');
  });
});
