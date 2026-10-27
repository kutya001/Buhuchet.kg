import { expect, test } from '@playwright/test';
import { asOwner, assign, editContractor, find, newContractor, reportsOf } from './reports';

// Отчёты: назначения, создание по расписанию и сроки (задача 2.06, #62). Экранов у задачи нет (список —
// задача 2.13, карточка — 2.14), поэтому её проверки идут через API сайта под владельцем демо-организации.

/** Секрет планировщика — тот же, что в .env (по умолчанию из .env.example). */
const CRON_SECRET = process.env.CRON_SECRET ?? 'local-cron-secret-change-me';

test.describe('Этап 2: отчёты — назначения, создание по расписанию и сроки', () => {
  test('(п. 5) срок на нерабочем дне переносится на ближайший рабочий, на рабочей субботе — нет', async ({
    request,
    baseURL,
  }) => {
    const origin = await asOwner(request, baseURL);
    const cp = await newContractor(request, origin);
    // Внутренняя отчётность со сроком в назначении «14-го числа следующего месяца»: за январь 2026 —
    // 14.02, суббота; за февраль — 14.03, рабочая суббота по календарю.
    await assign(request, origin, {
      contractorId: cp.id,
      reportTypeCode: 'opu',
      ownPeriod: 'M',
      ownDay: 14,
      ownMonth: 1,
      fromMonth: '2026-01-01',
    });
    // Соцфонд до 20-го: за февраль 2026 — 20.03 (Орозо айт), 21.03 (Нооруз), 22.03 (воскресенье).
    await assign(request, origin, {
      contractorId: cp.id,
      reportTypeCode: 'soc',
      fromMonth: '2026-02-01',
    });
    const rows = await reportsOf(request, cp.inn);
    expect(find(rows, 'opu', '2026-01-01')).toMatchObject({
      dueBase: '2026-02-14',
      dueDate: '2026-02-16',
    });
    expect(find(rows, 'opu', '2026-02-01')).toMatchObject({
      dueBase: '2026-03-14',
      dueDate: '2026-03-14',
    });
    expect(find(rows, 'soc', '2026-02-01')).toMatchObject({
      dueBase: '2026-03-20',
      dueDate: '2026-03-23',
    });
    expect(find(rows, 'soc', '2026-04-01')).toMatchObject({
      dueBase: '2026-05-20',
      dueDate: '2026-05-20',
    });
  });

  test('(п. 52) УГНС крупных налогоплательщиков отмечает статус сам: НДС за октябрь 2026 — сдать до 30.11.2026, оплатить до 25.11.2026; после снятия статуса — сдать до 25.11.2026', async ({
    request,
    baseURL,
  }) => {
    const origin = await asOwner(request, baseURL);
    const big = await newContractor(request, origin, { taxOfficeCode: 'ugns-large' });
    expect(big.benefits).toEqual([expect.objectContaining({ code: 'ЛЬГ-30', byOffice: true })]);
    expect(big.notices).toEqual(['Отмечен статус «Крупный налогоплательщик» по УГНС']);
    await assign(request, origin, {
      contractorId: big.id,
      reportTypeCode: 'nds',
      rate: '12 %',
      fromMonth: '2026-10-01',
    });
    expect(find(await reportsOf(request, big.inn), 'nds', '2026-10-01')).toMatchObject({
      dueDate: '2026-11-30',
      payDue: '2026-11-25',
    });
    // Сменили УГНС на районное — статус снят сам, срок несданного НДС пересчитан по каталогу.
    const moved = await editContractor(request, origin, big, {
      taxOfficeCode: 'ugns-bishkek-lenin',
    });
    expect(moved.benefits).toEqual([]);
    expect(moved.notices).toEqual(['Снят статус «Крупный налогоплательщик» по УГНС']);
    expect(find(await reportsOf(request, big.inn), 'nds', '2026-10-01')).toMatchObject({
      dueDate: '2026-11-25',
      payDue: '2026-11-25',
    });
  });

  test('(проверка задачи #62) повторный запуск расписания не создаёт дублей', async ({
    request,
    baseURL,
  }) => {
    await asOwner(request, baseURL);
    const tick = async () => {
      const res = await request.post('/api/cron/tick', {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      });
      expect(res.status()).toBe(200);
      return (await res.json()) as { ran: { job: string; ok: boolean }[]; skipped: string[] };
    };
    // Первый вызов создаёт отчёты текущего и следующего периода, если задача ещё не шла в этом слоте.
    const first = await tick();
    expect(first.ran.filter((r) => r.job === 'reports.create-due' && !r.ok)).toEqual([]);
    // Демо-контрагент «Ала-Тоо Трейд»: его отчёты другие тесты не трогают.
    const before = await reportsOf(request, '03744097401851');
    expect(before.length).toBeGreaterThan(0);
    const again = await tick();
    expect(again.ran.map((r) => r.job)).not.toContain('reports.create-due');
    expect(again.skipped).toContain('reports.create-due');
    const after = await reportsOf(request, '03744097401851');
    expect(after.map((r) => `${r.type.code} ${r.periodStart}`).sort()).toEqual(
      before.map((r) => `${r.type.code} ${r.periodStart}`).sort(),
    );
  });
});
