import { expect, test, type APIRequestContext } from '@playwright/test';
import { platformAdmin } from './admin';
import { newOrgOwner } from './helpers';
import { asOwner, assign, newContractor } from './reports';

// Админка → «Справочники платформы» → «Календарь»: пересчёт сроков несданных отчётов во всех
// организациях после правки каталога, часть 2 задачи 2.37 (ТЗ «Если изменение каталога влияет на сроки
// уже созданных отчётов, система показывает, сколько несданных отчётов в скольких организациях
// изменится, и пересчитывает только их»; «Срок, изменённый вручную, не пересчитывается»). Календарь
// общий для всей платформы, поэтому файл — *.shared.spec.ts, а день в конце удаляется.

type Report = {
  id: string;
  type: { code: string };
  periodStart: string;
  dueDate: string;
  dueManual: boolean;
  status: string;
  version: number;
};
type Day = { key: string; date: string; version: number };

async function reportsOf(api: APIRequestContext, inn: string): Promise<Report[]> {
  const filters = encodeURIComponent(JSON.stringify({ inn: { type: 'text', q: inn } }));
  const res = await api.get(`/api/reports?size=all&filters=${filters}`);
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { items: Report[] }).items
    .filter((r) => r.type.code === 'nds')
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart));
}

/**
 * Контрагент новой организации без платы за обслуживание (её задаёт тот, кто видит плату) — как
 * `newContractor`, со своим ИНН.
 */
async function plainContractor(api: APIRequestContext, origin: string) {
  const staff = (await (await api.get('/api/staff?size=all')).json()) as {
    items: { id: string; active: boolean }[];
  };
  const inn = `07${Date.now().toString().slice(-8)}${String(Math.floor(Math.random() * 10_000)).padStart(4, '0')}`;
  const res = await api.post('/api/contractors', {
    headers: { origin },
    data: {
      name: `Сроки отчётов ${inn}`,
      inn,
      phone: '+996505890076',
      kind: 'regular',
      formCode: 'ФС-01',
      regimeCode: 'РЕЖ-01',
      gked: '46.34.0',
      taxOfficeCode: null,
      benefits: [],
      startDate: '2026-01-01',
      responsibleEmployeeId: staff.items.find((e) => e.active)!.id,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return { ...((await res.json()) as { id: string }), inn };
}

/** Следующий рабочий день после `date` по календарю (суббота и воскресенье — выходные). */
function nextWorkday(date: string, off: Set<string>): string {
  const d = new Date(`${date}T00:00:00Z`);
  do d.setUTCDate(d.getUTCDate() + 1);
  while ([0, 6].includes(d.getUTCDay()) || off.has(d.toISOString().slice(0, 10)));
  return d.toISOString().slice(0, 10);
}

test.describe('Админка: сроки несданных отчётов после правки календаря', () => {
  test('(проверка задачи #93) правка календаря в предпросмотре и после применения меняет сроки несданных отчётов в двух организациях одинаково, а срок, изменённый вручную, не меняется', async ({
    page,
    baseURL,
    playwright,
  }, testInfo) => {
    const origin = new URL(baseURL!).origin;
    await platformAdmin(page.request, origin);
    const demo = await playwright.request.newContext({ baseURL });
    const other = await playwright.request.newContext({ baseURL });
    const days = async () => {
      const res = await page.request.get('/api/admin/platform-dicts/calendar?size=all');
      expect(res.status(), await res.text()).toBe(200);
      return ((await res.json()) as { items: (Day & { kind: string })[] }).items;
    };
    let date = '';

    try {
      // Две организации: демо и новая, в каждой — контрагент с НДС; в демо — ещё один с ручным сроком.
      await asOwner(demo, baseURL);
      await newOrgOwner(other, origin);
      const connected = await other.post('/api/org-report-types/connect', {
        headers: { origin },
        data: { connect: ['nds'], disconnect: [] },
      });
      expect(connected.status(), await connected.text()).toBe(200);
      const month = new Date().toISOString().slice(0, 8) + '01';
      const cps = {
        demo: await newContractor(demo, origin),
        manual: await newContractor(demo, origin),
        other: await plainContractor(other, origin),
      };
      for (const [api, cp] of [
        [demo, cps.demo],
        [demo, cps.manual],
        [other, cps.other],
      ] as const) {
        await assign(api, origin, {
          contractorId: cp.id,
          reportTypeCode: 'nds',
          rate: '12 %',
          fromMonth: month,
        });
      }
      const [first] = (await reportsOf(demo, cps.demo.inn)).filter((r) => r.status !== 'submitted');
      expect(first).toBeTruthy();
      const ofOther = (await reportsOf(other, cps.other.inn)).find(
        (r) => r.periodStart === first!.periodStart,
      )!;
      expect(ofOther.dueDate).toBe(first!.dueDate);
      // Ручной срок — тот же день, что у остальных (сначала другой день, потом обратно: тот же срок
      // «Изменить срок» не меняет): пересчёт его не трогает.
      const manualOf = async () =>
        (await reportsOf(demo, cps.manual.inn)).find((r) => r.periodStart === first!.periodStart)!;
      for (const due of [nextWorkday(first!.dueDate, new Set()), first!.dueDate]) {
        const changed = await demo.post(`/api/reports/${(await manualOf()).id}/due`, {
          headers: { origin },
          data: {
            due,
            reasonCode: 'ПРЧ-001',
            comment: 'Сквозной тест',
            version: (await manualOf()).version,
          },
        });
        expect(changed.status(), await changed.text()).toBe(200);
      }
      const manual = await manualOf();
      expect([manual.dueDate, manual.dueManual]).toEqual([first!.dueDate, true]);

      // Срок отчётов становится нерабочим днём — переносится на следующий рабочий.
      date = first!.dueDate;
      const off = new Set((await days()).filter((d) => d.kind !== 'workday').map((d) => d.date));
      const moved = nextWorkday(date, off);
      const toast = (text: string | RegExp) => page.getByRole('status').filter({ hasText: text });

      await page.goto('/app/pdicts/calendar');
      await page.getByRole('button', { name: 'Добавить', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Нерабочий день' }).click();
      const dialog = page.getByRole('dialog', { name: 'Нерабочий день' });
      await dialog.getByLabel('Дата').fill(date);
      await dialog.getByLabel('Название').fill(`Перенос: сроки ${testInfo.project.name}`);
      // Предпросмотр: сколько несданных отчётов в скольких организациях изменится.
      const note = dialog.getByText(/^Сроки пересчитаются у \d+ несданн/);
      await expect(note).toBeVisible();
      await expect(note).toHaveText(
        /^Сроки пересчитаются у (\d+) несданн\S+ отчёт\S* в (\d+) организац\S+\. Сданные не меняются\.$/,
      );
      const [, shownReports, shownOrgs] = /у (\d+) .* в (\d+) /.exec((await note.textContent())!)!;
      expect(Number(shownOrgs)).toBeGreaterThanOrEqual(2);
      // Предпросмотр ничего не меняет.
      expect((await reportsOf(other, cps.other.inn))[0]!.dueDate).toBe(ofOther.dueDate);

      await dialog.getByRole('button', { name: 'Добавить' }).click();
      await expect(dialog).toBeHidden();
      // После применения — столько же, сколько в предпросмотре.
      await expect(
        toast(new RegExp(`^Календарь обновлён, сроки пересчитаны у ${shownReports} несданн`)),
      ).toBeVisible();

      const after = {
        demo: (await reportsOf(demo, cps.demo.inn)).find((r) => r.id === first!.id)!,
        other: (await reportsOf(other, cps.other.inn)).find((r) => r.id === ofOther.id)!,
        manual: (await reportsOf(demo, cps.manual.inn)).find((r) => r.id === manual.id)!,
      };
      expect(after.demo.dueDate).toBe(moved);
      expect(after.other.dueDate).toBe(moved);
      expect([after.manual.dueDate, after.manual.dueManual]).toEqual([date, true]);
    } finally {
      for (const x of (await days()).filter((d) => d.key === date)) {
        await page.request.delete(`/api/admin/platform-dicts/calendar/${x.key}`, {
          headers: { origin },
          params: { version: x.version },
        });
      }
      await demo.dispose();
      await other.dispose();
    }
  });
});
