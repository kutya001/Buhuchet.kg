import { expect, test, type APIRequestContext } from '@playwright/test';
import { asOwner, newContractor } from './reports';

// «Разовый отчёт» разового вида (задача 2.06, #62). В демо-организации «Утилизационный сбор при импорте»
// не подключён: тест подключает его и потом отключает, поэтому файл *.shared.spec.ts идёт после
// остальных тестов и по одному (playwright.config.ts).

test.describe.configure({ mode: 'serial' });

type Setting = { code: string; enabled: boolean; version: number };

async function setting(api: APIRequestContext, code: string) {
  const res = await api.get('/api/org-report-types/settings');
  expect(res.status()).toBe(200);
  return ((await res.json()) as { items: Setting[] }).items.find((s) => s.code === code);
}

async function setEnabled(api: APIRequestContext, origin: string, code: string, enabled: boolean) {
  const res = await api.put(`/api/org-report-types/${code}`, {
    headers: { origin },
    data: { enabled, version: (await setting(api, code))?.version ?? null },
  });
  expect(res.status(), await res.text()).toBe(200);
}

test.describe('Этап 2: отчёты — «Разовый отчёт»', () => {
  test('(п. 55) разовый утилизационный сбор: ввоз 05.11.2026 — оплатить до 20.11.2026, ввоз 18.11.2026 — до 03.12.2026', async ({
    request,
    baseURL,
  }) => {
    const origin = await asOwner(request, baseURL);
    const before = await setting(request, 'utli');
    if (!before?.enabled) await setEnabled(request, origin, 'utli', true);
    try {
      const cp = await newContractor(request, origin);
      const manual = async (eventDate: string) => {
        const res = await request.post('/api/reports', {
          headers: { origin },
          data: { contractorId: cp.id, reportTypeCode: 'utli', eventDate, reasonCode: 'ПРЧ-001' },
        });
        expect(res.status(), await res.text()).toBe(201);
        const { id } = (await res.json()) as { id: string };
        const card = await request.get(`/api/reports/${id}`);
        expect(card.status()).toBe(200);
        return (await card.json()) as {
          periodStart: string;
          eventDate: string;
          periodLabel: string;
          payDue: string;
        };
      };
      expect(await manual('2026-11-05')).toMatchObject({
        periodStart: '2026-11-01',
        eventDate: '2026-11-05',
        periodLabel: '11.2026 · 05.11',
        payDue: '2026-11-20',
      });
      expect(await manual('2026-11-18')).toMatchObject({
        eventDate: '2026-11-18',
        payDue: '2026-12-03',
      });
      // Тот же вид с той же датой события — уже есть.
      const again = await request.post('/api/reports', {
        headers: { origin },
        data: {
          contractorId: cp.id,
          reportTypeCode: 'utli',
          eventDate: '2026-11-05',
          reasonCode: 'ПРЧ-001',
        },
      });
      expect(again.status()).toBe(409);
    } finally {
      if (!before?.enabled) await setEnabled(request, origin, 'utli', false);
    }
  });
});
