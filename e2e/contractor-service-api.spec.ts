import { expect, test, type APIRequestContext } from '@playwright/test';
import { asOwner, assign, newContractor } from './reports';

// Контрагенты: приостановка, возобновление, архив и разовые (задача 2.12, #68). Кнопки обслуживания
// в карточке подключит задача карточки контрагента (2.11), поэтому проверки идут через API сайта под
// владельцем демо-организации. Правила — тесты `packages/domain/src/contractors/service.test.ts`, база —
// `packages/db/src/contractor-service.test.ts`, права и ответы — `packages/api/src/modules/contractors/service.test.ts`.

type ReportRow = { type: { code: string }; periodStart: string; status: string };

/** Идущий месяц по Бишкеку (UTC+6). */
const currentMonth = () => new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 7);

const addMonth = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

/** Отчёты контрагента по ИНН; `tab` — вкладка списка («Просрочено» — overdue). */
async function reports(api: APIRequestContext, inn: string, tab = 'all'): Promise<ReportRow[]> {
  const filters = encodeURIComponent(JSON.stringify({ inn: { type: 'text', q: inn } }));
  const res = await api.get(`/api/reports?size=all&tab=${tab}&filters=${filters}`);
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { items: ReportRow[] }).items;
}

const socStatuses = (rows: ReportRow[]) =>
  rows
    .filter((r) => r.type.code === 'soc')
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart))
    .map((r) => `${r.periodStart.slice(0, 7)} ${r.status}`);

test.describe('Этап 2: контрагенты — приостановка, возобновление, архив', () => {
  test('(проверка задачи #68) приостановленный контрагент не попадает в «Просрочено»; откат приостановки возвращает его', async ({
    request,
    baseURL,
  }) => {
    const origin = await asOwner(request, baseURL);
    const cp = await newContractor(request, origin);
    // Соцфонд с июля 2026: за июль срок 20.08 — просрочен.
    await assign(request, origin, {
      contractorId: cp.id,
      reportTypeCode: 'soc',
      fromMonth: '2026-07-01',
    });
    const overdue = await reports(request, cp.inn, 'overdue');
    expect(overdue.map((r) => r.periodStart)).toContain('2026-07-01');

    const month = currentMonth();
    const paused = await request.post(`/api/contractors/${cp.id}/pause`, {
      headers: { origin },
      data: { from: month, reason: 'Нет деятельности', version: cp.version },
    });
    expect(paused.status(), await paused.text()).toBe(200);
    const saved = (await paused.json()) as {
      service: { status: string; version: number; skipped: string[] };
      effect: { notRequired: number };
    };
    expect(saved.service.status).toBe('paused');
    expect(saved.service.skipped).toEqual([month]);
    // Просрочки по приостановленному контрагенту не считаются; сам он остаётся в списке контрагентов.
    expect(await reports(request, cp.inn, 'overdue')).toEqual([]);
    const statuses = socStatuses(await reports(request, cp.inn));
    expect(statuses).toContain(`${month} not_required`);
    expect(statuses).toContain('2026-07 todo');

    // Откат шагом назад на шкале: обслуживание без перерыва, отчёт за идущий месяц — снова к сдаче.
    const rolled = await request.post(`/api/contractors/${cp.id}/pause/rollback`, {
      headers: { origin },
      data: { reason: 'Поставили по ошибке', fill: [month], version: saved.service.version },
    });
    expect(rolled.status(), await rolled.text()).toBe(200);
    expect(((await rolled.json()) as { service: { status: string } }).service.status).toBe(
      'active',
    );
    expect((await reports(request, cp.inn, 'overdue')).map((r) => r.periodStart)).toContain(
      '2026-07-01',
    );
    expect(socStatuses(await reports(request, cp.inn))).toContain(`${month} todo`);
  });

  test('(проверка задачи #68) возврат из архива: отчёты продолжают создаваться с текущего периода, видно сколько открытых', async ({
    request,
    baseURL,
  }) => {
    const origin = await asOwner(request, baseURL);
    const cp = await newContractor(request, origin);
    const month = currentMonth();
    const next = addMonth(month, 1);
    await assign(request, origin, {
      contractorId: cp.id,
      reportTypeCode: 'soc',
      fromMonth: `${month}-01`,
    });
    expect(socStatuses(await reports(request, cp.inn))).toEqual([`${month} todo`, `${next} todo`]);

    const archived = await request.post('/api/contractors/archive', {
      headers: { origin },
      data: { ids: [cp.id] },
    });
    expect(archived.status(), await archived.text()).toBe(200);
    expect(await archived.json()).toEqual({ archived: 1, skipped: 0, notRequired: 1 });
    // Обслуживание заканчивается идущим месяцем: за него отчёт остаётся к сдаче, за следующий — нет.
    expect(socStatuses(await reports(request, cp.inn))).toEqual([
      `${month} todo`,
      `${next} not_required`,
    ]);
    // Архивного не правят — сначала «Вернуть из архива».
    const edit = await request.patch(`/api/contractors/${cp.id}`, {
      headers: { origin },
      data: { version: cp.version + 1, note: 'Правка в архиве' },
    });
    expect(edit.status()).toBe(409);

    const back = await request.post(`/api/contractors/${cp.id}/unarchive`, {
      headers: { origin },
      data: {},
    });
    expect(back.status(), await back.text()).toBe(200);
    const card = (await back.json()) as {
      id: string;
      serviceStatus: string;
      service: { periods: { from: string; to: string | null }[] };
      effect: { open: number };
    };
    expect(card).toMatchObject({ id: cp.id, serviceStatus: 'active', effect: { open: 2 } });
    expect(card.service.periods.at(-1)).toEqual({ from: '2026-01', to: null });
    expect(socStatuses(await reports(request, cp.inn))).toEqual([`${month} todo`, `${next} todo`]);
  });
});
