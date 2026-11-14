import { expect, test, type APIRequestContext } from '@playwright/test';
import { DEMO_PASSWORD, signIn } from './helpers';

// «Telegram контрагентов» в настройках организации (доработки 13.11.2026, задача К4; прототип v94
// modules/cp-telegram.js: pgTgOrgHtml, pgTgOrgMount). Тест меняет общую запись демо-организации, поэтому
// файл *.shared.spec.ts: идёт после остальных тестов и по одному. Изменённое возвращается как было.

test.describe.configure({ mode: 'serial' });

type Policy = {
  version: number;
  cpTgPay: boolean;
  cpTgDebt: boolean;
  features: Record<string, boolean>;
};

async function policy(api: APIRequestContext) {
  const res = await api.get('/api/org/policy');
  expect(res.status()).toBe(200);
  return (await res.json()) as Policy;
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
      const box = page.locator('[data-org-cptg]');
      await expect(box.getByRole('heading', { name: 'Telegram контрагентов' })).toBeVisible();
      await expect(
        box.getByText(
          'Сообщение с налогами месяца приходит клиенту за 5 дней до ближайшего срока оплаты, если все суммы месяца указаны. Вручную его отправляет кнопка «Отправить в Telegram» в карточке контрагента, на вкладке «Отчёты к сдаче».',
        ),
      ).toBeVisible();
      await expect(
        box.getByText(
          'Сообщения получают только контрагенты, которые подключили Telegram на своей странице, и только по своим данным.',
        ),
      ).toBeVisible();
      const toggle = box.getByRole('switch', { name: /Отправлять «К оплате» контрагентам/ });
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
      const box = page.locator('[data-org-cptg]');
      await expect(
        box.getByText(
          'Раз в неделю, в понедельник в 10:00: недостача денег на налоги этого месяца и долг за обслуживание. У отдельного контрагента напоминание выключается в его карточке; клиент может выключить его сам кнопкой «Не напоминать».',
        ),
      ).toBeVisible();
      const toggle = box.getByRole('switch', { name: /Напоминать контрагентам о долге/ });
      await expect(toggle).toBeChecked({ checked: before.cpTgDebt });
      // Соседний переключатель «К оплате» от этого не меняется.
      const pay = box.getByRole('switch', { name: /Отправлять «К оплате» контрагентам/ });
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
