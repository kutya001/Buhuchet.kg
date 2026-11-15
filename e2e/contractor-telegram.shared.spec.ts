import { expect, test, type APIRequestContext } from '@playwright/test';
import { DEMO_PASSWORD, signIn } from './helpers';

// Строки «К оплате» и «Оплата за обслуживание» блока «Telegram-уведомления» в настройках организации
// (доработки 13.11.2026, задачи К4 и К5; с пакета 14.11.2026, блок 3, — в общем блоке, с этапа 2 — дни,
// время и день напоминания о долге; прототип v115 modules/cp-telegram.js: pgTgNoticeRows, pgTgNoticeMount).
// Тест меняет общую запись демо-организации, поэтому файл *.shared.spec.ts: идёт после остальных тестов и
// по одному. Изменённое возвращается как было.

test.describe.configure({ mode: 'serial' });

type Policy = {
  version: number;
  cpTgPay: boolean;
  cpTgDebt: boolean;
  cpPayDays: number[];
  cpPayAt: string;
  cpFeeDays: number[];
  cpFeeAt: string;
  cpDebtWeekDay: number;
  features: Record<string, boolean>;
};

async function policy(api: APIRequestContext) {
  // Чтение повторяется при обрыве простаивающего соединения (docs/typical-mistakes.md № 26).
  const res = await api.get('/api/org/policy', { maxRetries: 2 });
  expect(res.status()).toBe(200);
  return (await res.json()) as Policy;
}

type Notices = Pick<Policy, 'cpPayDays' | 'cpPayAt' | 'cpFeeDays' | 'cpFeeAt' | 'cpDebtWeekDay'>;

/** Дни, время и день долга строк контрагентов — как по умолчанию у демо-организации. */
const DEFAULT_NOTICES: Notices = {
  cpPayDays: [5],
  cpPayAt: '10:00',
  cpFeeDays: [5],
  cpFeeAt: '10:00',
  cpDebtWeekDay: 1,
};

/**
 * Поставить дни и время строк: сохранение по версии, поэтому при «запись изменена» (сохранение от
 * нажатия ещё шло) — перечитать версию и повторить.
 */
async function setNotices(api: APIRequestContext, origin: string, to: Notices) {
  await expect(async () => {
    const now = await policy(api);
    if (
      now.cpPayDays.join() === to.cpPayDays.join() &&
      now.cpFeeDays.join() === to.cpFeeDays.join() &&
      now.cpPayAt === to.cpPayAt &&
      now.cpFeeAt === to.cpFeeAt &&
      now.cpDebtWeekDay === to.cpDebtWeekDay
    ) {
      return;
    }
    const res = await api.patch('/api/org/policy', {
      headers: { origin },
      data: { version: now.version, ...to },
    });
    expect(res.status(), await res.text()).toBe(200);
  }).toPass({ timeout: 15_000 });
}

test.describe('Доработки 13.11, К4: «Telegram контрагентов» в настройках организации', () => {
  test('(доработки 13.11.2026, К4) настройки организации, блок «Telegram контрагентов»: «Отправлять «К оплате» контрагентам» включается и выключается сразу, без «Сохранить настройки»; без права на настройки переключить нельзя', async ({
    page,
    playwright,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    const before = await policy(page.request);
    expect(before.features.telegram && before.features.cppage).toBe(true);
    try {
      await page.goto('/app/org/settings');
      const box = page.locator('[data-tgn="cpPay"]');
      await expect(box).toContainText('Контрагентам');
      await expect(box).toContainText(
        'Сообщение с налогами месяца и реквизитами для перевода, если все суммы месяца указаны. После «Оплатил» в Telegram или принятия денег за месяц следующие не уходят. Вручную его отправляет кнопка «Отправить в Telegram» в карточке контрагента, на вкладке «Отчёты к сдаче».',
      );
      await expect(box).toContainText(
        'Получают только контрагенты, которые подключили Telegram на своей странице, и только по своим данным.',
      );
      // Дни и время — как сохранены у организации (по умолчанию «за 5» и 10:00).
      if (before.cpPayDays.join() === '5') {
        await expect(box.locator('[data-tgn-kv="days"]')).toContainText(
          'За 5 дней до ближайшего срока оплаты месяца',
        );
      }
      await expect(box.locator('[data-tgn-kv="at"]')).toContainText(before.cpPayAt);
      const toggle = box.getByRole('switch', { name: '«К оплате»' });
      await expect(toggle).toBeChecked({ checked: before.cpTgPay });

      // Несохранённые поля «Настроек» переключатель не сбрасывает (в прототипе форма не перерисовывается).
      const zone = page.getByLabel('Часовой пояс');
      const other = (await zone.inputValue()) === 'Asia/Almaty' ? 'Asia/Tashkent' : 'Asia/Almaty';
      await zone.selectOption(other);

      await toggle.click();
      await expect(
        page.getByRole('status').filter({
          hasText: `Отправлять «К оплате» контрагентам: ${before.cpTgPay ? 'выключено' : 'включено'}`,
        }),
      ).toBeVisible();
      expect((await policy(page.request)).cpTgPay).toBe(!before.cpTgPay);
      await expect(zone).toHaveValue(other);
      // После перезагрузки переключатель в новом положении.
      await page.reload();
      await expect(toggle).toBeChecked({ checked: !before.cpTgPay });
      await toggle.click();
      await expect(
        page.getByRole('status').filter({
          hasText: `Отправлять «К оплате» контрагентам: ${before.cpTgPay ? 'включено' : 'выключено'}`,
        }),
      ).toBeVisible();
      expect((await policy(page.request)).cpTgPay).toBe(before.cpTgPay);
      // Ничего не прокручивается вбок (на телефоне — тоже).
      const wide = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(wide).toBe(false);

      // Бухгалтер (без права «Настройки и учётная политика») настройку не меняет.
      const staff = await playwright.request.newContext({ baseURL });
      await signIn(staff, origin, 'alisher', DEMO_PASSWORD);
      const refused = await staff.patch('/api/org/policy', {
        headers: { origin },
        data: { version: (await policy(page.request)).version, cpTgPay: !before.cpTgPay },
      });
      expect(refused.status()).toBe(403);
      await staff.dispose();
      expect((await policy(page.request)).cpTgPay).toBe(before.cpTgPay);
    } finally {
      const now = await policy(page.request);
      if (now.cpTgPay !== before.cpTgPay) {
        const res = await page.request.patch('/api/org/policy', {
          headers: { origin },
          data: { version: now.version, cpTgPay: before.cpTgPay },
        });
        expect(res.status(), await res.text()).toBe(200);
      }
    }
  });
});

test.describe('Доработки 13.11, К5: «Напоминать контрагентам о долге» в настройках организации', () => {
  test('(доработки 13.11.2026, К5) настройки организации, блок «Telegram контрагентов»: «Напоминать контрагентам о долге» включается и выключается сразу; без права на настройки переключить нельзя', async ({
    page,
    playwright,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    const before = await policy(page.request);
    expect(before.features.telegram && before.features.cppage).toBe(true);
    const state = (on: boolean) => (on ? 'включено' : 'выключено');
    try {
      await page.goto('/app/org/settings');
      const box = page.locator('[data-tgn="cpFee"]');
      // У демо-организации включена «Плата за обслуживание»: до срока — «Оплата за обслуживание до …».
      await expect(box).toContainText(
        'После срока — напоминание о долге: недостача денег на налоги этого месяца и долг за обслуживание. У отдельного контрагента напоминание выключается в его карточке; клиент может выключить его сам кнопкой «Не напоминать».',
      );
      if (before.cpFeeDays.join() === '5' && before.cpDebtWeekDay === 1) {
        await expect(box.locator('[data-tgn-kv="days"]')).toContainText(
          'За 5 дней до дня оплаты; после срока — по понедельникам',
        );
      }
      await expect(box.locator('[data-tgn-kv="at"]')).toContainText(before.cpFeeAt);
      const toggle = box.getByRole('switch', { name: 'Оплата за обслуживание' });
      await expect(toggle).toBeChecked({ checked: before.cpTgDebt });
      // Соседний переключатель «К оплате» от этого не меняется.
      const pay = page.locator('[data-tgn="cpPay"]').getByRole('switch');
      await expect(pay).toBeChecked({ checked: before.cpTgPay });

      await toggle.click();
      await expect(
        page.getByRole('status').filter({
          hasText: `Напоминать контрагентам о долге: ${state(!before.cpTgDebt)}`,
        }),
      ).toBeVisible();
      expect(await policy(page.request)).toMatchObject({
        cpTgDebt: !before.cpTgDebt,
        cpTgPay: before.cpTgPay,
      });
      // После перезагрузки переключатель в новом положении.
      await page.reload();
      await expect(toggle).toBeChecked({ checked: !before.cpTgDebt });
      await expect(pay).toBeChecked({ checked: before.cpTgPay });
      await toggle.click();
      await expect(
        page.getByRole('status').filter({
          hasText: `Напоминать контрагентам о долге: ${state(before.cpTgDebt)}`,
        }),
      ).toBeVisible();
      expect((await policy(page.request)).cpTgDebt).toBe(before.cpTgDebt);
      // Ничего не прокручивается вбок (на телефоне — тоже).
      const wide = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(wide).toBe(false);

      // Бухгалтер (без права «Настройки и учётная политика») настройку не меняет.
      const staff = await playwright.request.newContext({ baseURL });
      await signIn(staff, origin, 'alisher', DEMO_PASSWORD);
      const refused = await staff.patch('/api/org/policy', {
        headers: { origin },
        data: { version: (await policy(page.request)).version, cpTgDebt: !before.cpTgDebt },
      });
      expect(refused.status()).toBe(403);
      await staff.dispose();
      expect((await policy(page.request)).cpTgDebt).toBe(before.cpTgDebt);
    } finally {
      const now = await policy(page.request);
      if (now.cpTgDebt !== before.cpTgDebt) {
        const res = await page.request.patch('/api/org/policy', {
          headers: { origin },
          data: { version: now.version, cpTgDebt: before.cpTgDebt },
        });
        expect(res.status(), await res.text()).toBe(200);
      }
    }
  });
});

test.describe('Доработки 14.11, этап 2: дни и время «К оплате» и «Оплаты за обслуживание»', () => {
  test('(доработки 14.11.2026, блок 3, этап 2) «Telegram-уведомления», строки контрагентов: дни «за 5» … «за 1 день», время отправки и день напоминания о долге сохраняются сразу; хотя бы один день остаётся; без права на настройки — нельзя', async ({
    page,
    playwright,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
    const before = await policy(page.request);
    expect(before.features.telegram && before.features.cppage && before.features.fee).toBe(true);
    const saved = (text: string) =>
      expect(page.getByRole('status').filter({ hasText: text })).toBeVisible();
    try {
      // Начинаем с «за 5» у обеих строк, 10:00 и понедельника — так стоит по умолчанию.
      await setNotices(page.request, origin, DEFAULT_NOTICES);
      await page.goto('/app/org/settings');
      const pay = page.locator('[data-tgn="cpPay"]');
      const fee = page.locator('[data-tgn="cpFee"]');

      // «К оплате»: отметить «за 3» — сразу сохранено, строка «Дни» — новыми днями.
      // Галочка сохраняется на сервере и отмечается по ответу: click, а не check (check ждёт смены сразу).
      await pay.locator('[data-tgn-day="p:3"]').click();
      await saved('«К оплате»: за 5, 3 дня до срока');
      await expect(pay.locator('[data-tgn-day="p:3"]')).toBeChecked();
      await expect(pay.locator('[data-tgn-kv="days"]')).toContainText(
        'За 5, 3 дня до ближайшего срока оплаты месяца',
      );
      expect((await policy(page.request)).cpPayDays).toEqual([5, 3]);
      // Последний отмеченный день снять нельзя.
      await pay.locator('[data-tgn-day="p:5"]').click();
      await saved('«К оплате»: за 3 дня до срока');
      await expect(pay.locator('[data-tgn-day="p:5"]')).not.toBeChecked();
      await pay.locator('[data-tgn-day="p:3"]').click();
      await expect(pay.getByText('Отметьте хотя бы один день')).toBeVisible();
      await expect(pay.locator('[data-tgn-day="p:3"]')).toBeChecked();
      expect((await policy(page.request)).cpPayDays).toEqual([3]);

      // Время отправки — когда поле оставили.
      const at = pay.locator('[data-tgn-at="p"]');
      await at.fill('09:30');
      await at.press('Enter');
      await saved('«К оплате»: в 09:30');
      await expect(pay.locator('[data-tgn-kv="at"]')).toContainText('09:30');
      expect((await policy(page.request)).cpPayAt).toBe('09:30');

      // «Оплата за обслуживание»: дни до дня оплаты и день напоминания о долге.
      await fee.locator('[data-tgn-day="f:1"]').click();
      await saved('Оплата за обслуживание: за 5, 1 день до срока');
      await expect(fee.locator('[data-tgn-day="f:1"]')).toBeChecked();
      await fee.locator('[data-tgn-fwd]').selectOption('3');
      await saved('Напоминание о долге — по средам');
      await expect(fee.locator('[data-tgn-kv="days"]')).toContainText(
        'За 5, 1 день до дня оплаты; после срока — по средам',
      );
      expect(await policy(page.request)).toMatchObject({ cpFeeDays: [5, 1], cpDebtWeekDay: 3 });
      // После перезагрузки — то же.
      await page.reload();
      await expect(pay.locator('[data-tgn-day="p:3"]')).toBeChecked();
      await expect(pay.locator('[data-tgn-day="p:5"]')).not.toBeChecked();
      await expect(at).toHaveValue('09:30');
      await expect(fee.locator('[data-tgn-fwd]')).toHaveValue('3');
      // Ничего не прокручивается вбок (на телефоне — тоже).
      const wide = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(wide).toBe(false);

      // Бухгалтер (без права «Настройки и учётная политика») дни не меняет.
      const staff = await playwright.request.newContext({ baseURL });
      await signIn(staff, origin, 'alisher', DEMO_PASSWORD);
      const refused = await staff.patch('/api/org/policy', {
        headers: { origin },
        data: { version: (await policy(page.request)).version, cpPayDays: [1] },
      });
      expect(refused.status()).toBe(403);
      await staff.dispose();
      expect((await policy(page.request)).cpPayDays).toEqual([3]);
    } finally {
      // Сохранение от последнего нажатия могло ещё идти — возврат по свежей версии, с повтором.
      await setNotices(page.request, origin, {
        cpPayDays: before.cpPayDays,
        cpPayAt: before.cpPayAt,
        cpFeeDays: before.cpFeeDays,
        cpFeeAt: before.cpFeeAt,
        cpDebtWeekDay: before.cpDebtWeekDay,
      });
    }
  });
});
