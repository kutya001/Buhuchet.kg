import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { DEMO_PASSWORD, FAKE_TELEGRAM, pressStart, signIn, uniqueChat } from './helpers';
import { asOwner } from './reports';

// «Напомнить в Telegram» об оплате за обслуживание (доработки 14.11.2026, блок 4, пункт 5; прототип v110
// modules/cp-telegram.js: pgFeeTgShow, pgFeeTgWhy, pgFeeTgDlg, pgFeeSend). Кнопка есть только при долге
// за обслуживание, а у своего контрагента теста долга нет: начисления идут с месяца, когда его завели, и
// срок первого месяца переносится на следующий (docs/deviations.md п. В-6). Поэтому тест берёт
// демо-контрагента с долгом и он общий (*.shared): идёт после остальных и по одному. ПК и телефон
// напоминают разным контрагентам (не чаще раза в сутки на контрагента); свой Telegram теста в конце
// отключается, страница возвращается как была. Записи об отправке в истории остаются (историю не правят).

test.describe.configure({ mode: 'serial' });

/** Демо-контрагенты с долгом за обслуживание (demoDB.json) — свой у ПК и у телефона. */
const DEMO = { desktop: 'ОсОО «Иссык-Куль Тур»', mobile: 'ОсОО «Ош Текстиль»' } as const;

type FeeTelegram = {
  shown: boolean;
  refusal: string | null;
  dialog: { debt: number; text: string; requisite: string } | null;
};
type PageBlock = { enabled: boolean; closed: boolean; code: string | null };
type TgList = { items: { id: string; name: string; status: string; version: number }[] };

/** Сумма в сомах, как на экране: «280 000 сом» — с неразрывными пробелами, без «,00». */
function somPattern(tyiyn: number): string {
  const whole = Math.floor(tyiyn / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '\\s');
  const cents = tyiyn % 100;
  return `${whole}${cents ? `,${String(cents).padStart(2, '0')}` : ''}\\sсом`;
}

async function json<T>(api: APIRequestContext, path: string): Promise<T> {
  const res = await api.get(path);
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as T;
}

async function contractorByName(api: APIRequestContext, name: string) {
  const list = await json<{ items: { id: string; name: string }[] }>(
    api,
    `/api/contractors?size=all&q=${encodeURIComponent(name)}`,
  );
  const id = list.items.find((c) => c.name === name)?.id;
  expect(id, name).toBeTruthy();
  return json<{ id: string; name: string; inn: string }>(api, `/api/contractors/${id}`);
}

/** Карточка контрагента из списка «Контрагенты» → «Все» с поиском по названию. */
async function openCard(page: Page, isMobile: boolean, id: string, name: string): Promise<Locator> {
  await page.goto('/app/cps/all');
  await expect(page.locator('[data-grid]')).toBeVisible();
  if (isMobile) await page.getByRole('button', { name: 'Поиск', exact: true }).click();
  await page.getByRole('searchbox').first().fill(name);
  await page.locator(`[data-grid] [data-id="${id}"]`).getByText(name, { exact: true }).click();
  const card = page.getByRole('dialog', { name });
  await expect(card.locator('[data-cp-card]')).toBeVisible();
  return card;
}

/** Вкладка карточки: на телефоне — из списка под текущей вкладкой. */
async function toTab(page: Page, card: Locator, isMobile: boolean, name: RegExp) {
  if (isMobile) {
    await card.getByRole('tab', { selected: true }).click();
    await page.getByRole('menu').getByRole('menuitem', { name }).click();
  } else {
    await card.getByRole('tab', { name }).click();
  }
}

test.describe('Доработки 14.11, К (блок 4): «Напомнить в Telegram» об оплате за обслуживание', () => {
  test('(доработки 14.11.2026, блок 4, пункт 5) «Напомнить в Telegram» на вкладке «Обслуживание»: окно с получателем, текстом по шаблону и реквизитами для обслуживания; клиенту — «Оплата за обслуживание до …» с текстом сотрудника, реквизитами и «Оплатил»; отправка — в истории; второй раз за день кнопка неактивна — «Сегодня уже напоминали в ЧЧ:ММ»', async ({
    page,
    playwright,
    request,
    baseURL,
    isMobile,
  }) => {
    // Подключение Telegram клиентом, отправка и проверки окна, чата и истории — дольше 30 с на машине CI.
    test.slow();
    const origin = await asOwner(request, baseURL);
    const cp = await contractorByName(request, isMobile ? DEMO.mobile : DEMO.desktop);
    const before = await json<PageBlock>(request, `/api/contractors/${cp.id}/page`);
    expect(before.closed).toBe(false);
    const chat = uniqueChat();
    const tgName = `@e2e_${chat}`;
    try {
      // Клиент вводит код своей страницы и подключает Telegram, владелец подтверждает.
      let code = before.code;
      if (!before.enabled) {
        const on = await request.post(`/api/contractors/${cp.id}/page/enable`, {
          headers: { origin },
        });
        expect(on.status(), await on.text()).toBe(200);
        code = ((await on.json()) as PageBlock).code;
      }
      const part = () => Math.floor(Math.random() * 256);
      const client = await playwright.request.newContext({
        baseURL,
        extraHTTPHeaders: { 'x-forwarded-for': `198.18.${part()}.${part()}` },
      });
      const opened = await client.post(`/api/page/buhgalter-plyus/${cp.inn}/code`, {
        headers: { origin },
        data: { code },
      });
      expect(opened.status(), await opened.text()).toBe(200);
      const link = await client.post(`/buhgalter-plyus/inn/${cp.inn}/telegram`, {
        headers: { origin },
      });
      expect(link.status(), await link.text()).toBe(200);
      const { url } = (await link.json()) as { url: string };
      expect((await pressStart(request, url, chat)).status()).toBe(200);
      await client.dispose();
      const list = await json<TgList>(request, `/api/contractors/${cp.id}/page/telegram`);
      const waiting = list.items.find((i) => i.name === tgName)!;
      const approved = await request.post(`/api/contractors/${cp.id}/page/telegram/${waiting.id}`, {
        headers: { origin },
        data: { action: 'approve', version: waiting.version },
      });
      expect(approved.status(), await approved.text()).toBe(200);

      // Долг за обслуживание есть, отправке ничто не мешает: текст и реквизиты окна — для сверки.
      const state = await json<FeeTelegram>(request, `/api/contractors/${cp.id}/fee-telegram`);
      expect(state).toMatchObject({ shown: true, refusal: null });
      const { debt, text: template, requisite } = state.dialog!;
      expect(debt).toBeGreaterThan(0);
      const sum = somPattern(debt);
      const own = `Напоминаем об оплате за обслуживание, ${cp.name}.`;

      await signIn(page.request, origin, 'erkin', DEMO_PASSWORD);
      const card = await openCard(page, isMobile, cp.id, cp.name);
      await toTab(page, card, isMobile, /Обслуживание/);
      const button = card.locator('[data-fee-tab] [data-fee-telegram]');

      await test.step('окно: получатель, текст по шаблону долга, реквизиты для обслуживания; поправил текст и отправил', async () => {
        await expect(button).toBeVisible();
        await expect(button).not.toHaveAttribute('aria-disabled', 'true');
        await button.click();
        const dialog = page.getByRole('dialog', { name: 'Напомнить в Telegram' });
        await expect(dialog.locator('[data-fee-telegram-to]')).toContainText(tgName);
        const text = dialog.locator('[data-fee-telegram-text]');
        await expect(text).toHaveValue(template);
        expect(template).toMatch(
          new RegExp(
            `^Долг за обслуживание — ${sum} \\([а-я]+ \\d{4}(, [а-я]+ \\d{4})*\\)\\. Пожалуйста, оплатите до \\d\\d\\.\\d\\d\\.\\d{4}\\.$`,
          ),
        );
        const req = dialog.locator('[data-fee-telegram-requisite]');
        await expect(req).toContainText('Реквизиты для перевода — организации');
        await expect(req).toContainText(requisite.split('\n')[0]!);
        await expect(req).toContainText(
          'Под сообщением — кнопки «Скопировать номер телефона» и «Оплатил».',
        );
        // Пустой текст не отправляется.
        await text.fill('  ');
        await dialog.locator('[data-fee-telegram-send]').click();
        await expect(dialog).toContainText('Введите текст сообщения');
        await text.fill(own);
        await dialog.locator('[data-fee-telegram-send]').click();
        await expect(
          page
            .getByRole('status')
            .filter({ hasText: 'Напоминание отправлено в Telegram: получателей — 1' }),
        ).toBeVisible();
        await expect(dialog).toBeHidden();
      });

      await test.step('клиенту — «Оплата за обслуживание до …» с текстом сотрудника, реквизитами и кнопками', async () => {
        const res = await request.get(`${FAKE_TELEGRAM}/messages?chat=${chat}`);
        expect(res.status()).toBe(200);
        const messages = (await res.json()) as {
          text: string;
          keyboard?: { text: string }[][];
        }[];
        const sent = messages.filter((m) => m.text.includes('Оплата за обслуживание до'));
        expect(sent).toHaveLength(1);
        expect(sent[0]!.text).toContain(cp.name);
        expect(sent[0]!.text).toContain(own);
        expect(sent[0]!.text).toContain(requisite.split('\n')[0]!);
        expect(sent[0]!.keyboard?.flat().map((b) => b.text)).toEqual([
          'Скопировать номер телефона',
          'Оплатил',
        ]);
      });

      await test.step('второй раз за день кнопка неактивна: «Сегодня уже напоминали в ЧЧ:ММ»', async () => {
        await expect(button).toHaveAttribute('aria-disabled', 'true');
        await expect(button).toHaveAttribute('title', /^Сегодня уже напоминали в \d\d:\d\d$/);
        // Кнопка помечена недоступной, но нажимается: по нажатию — причина сообщением, окна нет.
        await button.click({ force: true });
        await expect(
          page.getByRole('status').filter({ hasText: /Сегодня уже напоминали в \d\d:\d\d/ }),
        ).toBeVisible();
        await expect(page.getByRole('dialog', { name: 'Напомнить в Telegram' })).toHaveCount(0);
      });

      await test.step('отправка — в истории контрагента', async () => {
        await toTab(page, card, isMobile, /История/);
        await expect(card).toContainText(
          new RegExp(
            `Напоминание об оплате за обслуживание отправлено в Telegram: ${sum}, получателей — 1`,
          ),
        );
      });
    } finally {
      // Свой Telegram теста — отключить; страницу — как была.
      const list = await json<TgList>(request, `/api/contractors/${cp.id}/page/telegram`);
      for (const x of list.items.filter((i) => i.name === tgName && i.status === 'on')) {
        const off = await request.post(`/api/contractors/${cp.id}/page/telegram/${x.id}`, {
          headers: { origin },
          data: { action: 'unlink', version: x.version },
        });
        expect(off.status(), await off.text()).toBe(200);
      }
      if (!before.enabled) {
        const off = await request.post(`/api/contractors/${cp.id}/page/disable`, {
          headers: { origin },
        });
        expect(off.status(), await off.text()).toBe(200);
      }
    }
  });
});
