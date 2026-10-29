import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  kpiContractorOf,
  kpiContractorRecords,
  kpiIndicatorOf,
  listIndicators,
  loadTargets,
  resyncFillStatuses,
  writeTargets,
  type KpiContractorRecord,
  type TargetWrite,
} from '@buhuchet/db';
import {
  activeIndicators,
  indicatorOn,
  indicatorStart,
  offSince,
  reenableMonth,
  toggleTarget,
  type KpiBook,
} from '@buhuchet/domain';
import { KpiWho, WhoChanged, WhoChanges, WhoFrom } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { requirePermission } from '../../middleware/access';
import {
  currentMonthOf,
  error,
  inKpi,
  kpiFail,
  kpiScopeOf,
  noAuth,
  subjectOf,
  todayOf,
} from './common';

/*
 * «Кому вести» (задача 2.27; ТЗ «Показатели контрагентов» → «Кому вести»; прототип modules/kpi.js:
 * kpiWho, kWhoMass, kSetOn, kpiCardWhoHtml): таблица контрагенты × показатели с галочкой «Вести»,
 * массово по фильтру и «с <месяц>» у контрагента в его карточке. Видят все с правом «Просматривать
 * показатели» в своей области, меняет право «Настраивать показатели». Изменения — в историю показателя
 * и контрагента, статусы месяцев пересчитываются.
 */

const noSetup = {
  description: 'Нет права «Настраивать показатели» или функция выключена',
  content: error,
};
const notFound = () => apiFail(404, 'not_found', 'Запись не найдена');

export const whoRoute = createRoute({
  method: 'get',
  path: '/kpi/who',
  tags: ['kpi'],
  summary: '«Кому вести»: контрагенты × показатели',
  middleware: [requirePermission('kpiView')] as const,
  responses: {
    200: {
      description:
        'Неразовые контрагенты в области сотрудника (без архива) с полями фильтров и показатели по порядку',
      content: { 'application/json': { schema: KpiWho } },
    },
    401: noAuth,
    403: {
      description: 'Нет права «Просматривать показатели» или функция выключена',
      content: error,
    },
  },
});

export function whoHandler(deps: ApiDeps): RouteHandler<typeof whoRoute, AppEnv> {
  return async (c) => {
    const body = await inKpi(deps, c, async (tx) => {
      const [list, records] = await Promise.all([
        listIndicators(tx),
        kpiContractorRecords(tx, { scope: kpiScopeOf(subjectOf(c)) }),
      ]);
      const contractors = records.filter((r) => r.kind !== 'oneoff');
      const targets = await loadTargets(
        tx,
        contractors.map((r) => r.id),
      );
      const book: KpiBook = {
        indicators: list.map(kpiIndicatorOf),
        target: (i, cid) => targets.get(`${i}|${cid}`),
        hasValue: () => false,
      };
      const active = activeIndicators(book);
      const names = new Map(list.map((r) => [r.id, r.name]));
      return {
        indicators: active.map((i) => ({ id: i.id, name: names.get(i.id)! })),
        contractors: contractors.map((r) => {
          const kc = kpiContractorOf(r);
          return {
            id: r.id,
            name: r.name,
            inn: r.inn,
            regimeCode: r.regimeCode,
            regimeName: r.regimeName,
            responsibleEmployeeId: r.responsibleEmployeeId,
            responsibleName: r.responsibleName,
            paused: r.serviceStatus === 'paused',
            gked: r.gked,
            cells: active.map((i) => {
              const t = book.target(i.id, r.id);
              return {
                indicatorId: i.id,
                on: indicatorOn(i, t),
                start: indicatorStart(i, t, kc),
                offSince: offSince(i, book, r.id),
              };
            }),
          };
        }),
        reenableMonth: reenableMonth(todayOf(deps)),
      };
    });
    return c.json(body, 200);
  };
}

/** Контрагенты из запроса — в области сотрудника, неразовые и не в архиве; иначе 404. */
async function targetContractors(
  tx: Parameters<typeof kpiContractorRecords>[0],
  scope: ReturnType<typeof kpiScopeOf>,
  ids: readonly string[],
): Promise<Map<string, KpiContractorRecord>> {
  const unique = [...new Set(ids)];
  const rows = await kpiContractorRecords(tx, { scope, ids: unique });
  const ok = rows.filter((r) => r.kind !== 'oneoff');
  if (ok.length !== unique.length) notFound();
  return new Map(ok.map((r) => [r.id, r]));
}

export const whoSaveRoute = createRoute({
  method: 'put',
  path: '/kpi/who',
  tags: ['kpi'],
  summary: 'Включить или выключить показатели у контрагентов',
  middleware: [requirePermission('indSetup')] as const,
  request: {
    body: { content: { 'application/json': { schema: WhoChanges } }, required: true },
  },
  responses: {
    200: {
      description: 'Сколько галочек изменилось (уже так — не считается и в историю не пишется)',
      content: { 'application/json': { schema: WhoChanged } },
    },
    400: { description: 'Показатель в архиве', content: error },
    401: noAuth,
    403: noSetup,
    404: { description: 'Нет показателя или контрагента в области сотрудника', content: error },
  },
});

/**
 * Галочка «Вести» (прототип `kSetOn`): включение снимает «Не ведётся с …» и требует показатель с
 * текущего месяца; выключение ставит «Не ведётся с <текущий месяц>», значения остаются.
 */
export function whoSaveHandler(deps: ApiDeps): RouteHandler<typeof whoSaveRoute, AppEnv> {
  return async (c) => {
    const { changes } = c.req.valid('json');
    const today = todayOf(deps);
    const changed = await inKpi(deps, c, async (tx) => {
      const list = await listIndicators(tx);
      const byId = new Map(list.map((r) => [r.id, r]));
      for (const ch of changes) {
        const r = byId.get(ch.indicatorId);
        if (!r) notFound();
        if (r!.archived) kpiFail(400, 'indicator_archived');
      }
      const contractors = await targetContractors(
        tx,
        kpiScopeOf(subjectOf(c)),
        changes.map((ch) => ch.contractorId),
      );
      const targets = await loadTargets(tx, [...contractors.keys()]);
      const byIndicator = new Map<string, TargetWrite[]>();
      const seen = new Set<string>();
      for (const ch of changes) {
        const key = `${ch.indicatorId}|${ch.contractorId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const i = kpiIndicatorOf(byId.get(ch.indicatorId)!);
        const current = targets.get(key);
        const next = toggleTarget(i, current, ch.on, today);
        if (!next) continue;
        const writes = byIndicator.get(i.id) ?? [];
        writes.push({
          contractorId: ch.contractorId,
          before: indicatorOn(i, current),
          after: ch.on,
          target: next,
        });
        byIndicator.set(i.id, writes);
      }
      let n = 0;
      for (const [id, writes] of byIndicator) {
        await writeTargets(tx, id, writes);
        n += writes.length;
      }
      if (n > 0) {
        const ids = [...new Set([...byIndicator.values()].flat().map((w) => w.contractorId))];
        await resyncFillStatuses(tx, today, ids);
      }
      return n;
    });
    return c.json({ changed }, 200);
  };
}

export const whoFromRoute = createRoute({
  method: 'put',
  path: '/kpi/who/from',
  tags: ['kpi'],
  summary: '«с <месяц>» показателя у контрагента',
  middleware: [requirePermission('indSetup')] as const,
  request: {
    body: { content: { 'application/json': { schema: WhoFrom } }, required: true },
  },
  responses: {
    200: {
      description: 'Месяц изменён (уже такой — без изменений)',
      content: { 'application/json': { schema: WhoChanged } },
    },
    400: { description: 'Месяц позже текущего или показатель в архиве', content: error },
    401: noAuth,
    403: noSetup,
    404: { description: 'Нет показателя или контрагента в области сотрудника', content: error },
    409: { description: 'Показатель у контрагента не ведётся', content: error },
  },
});

/**
 * «Выручка · вести с 01.2026» в карточке контрагента (прототип `kpiCardMount`, `data-kcf`): с этого
 * месяца показатель обязателен, более ранние значения вносить можно, но незаполненными они не считаются.
 */
export function whoFromHandler(deps: ApiDeps): RouteHandler<typeof whoFromRoute, AppEnv> {
  return async (c) => {
    const body = c.req.valid('json');
    const today = todayOf(deps);
    if (body.from > currentMonthOf(deps)) kpiFail(400, 'from_in_future');
    const changed = await inKpi(deps, c, async (tx) => {
      const r = (await listIndicators(tx)).find((x) => x.id === body.indicatorId);
      if (!r) return notFound();
      if (r.archived) kpiFail(400, 'indicator_archived');
      const contractors = await targetContractors(tx, kpiScopeOf(subjectOf(c)), [
        body.contractorId,
      ]);
      const contractor = contractors.get(body.contractorId)!;
      if (contractor.serviceStatus === 'archived') notFound();
      const i = kpiIndicatorOf(r);
      const current = (await loadTargets(tx, [body.contractorId])).get(
        `${r.id}|${body.contractorId}`,
      );
      if (!indicatorOn(i, current)) kpiFail(409, 'target_off');
      const was = indicatorStart(i, current, kpiContractorOf(contractor));
      if (was === body.from) return 0;
      await writeTargets(tx, r.id, [
        {
          contractorId: body.contractorId,
          before: true,
          after: true,
          target: { on: true, from: body.from, offSince: null },
          fromBefore: was,
        },
      ]);
      await resyncFillStatuses(tx, today, [body.contractorId]);
      return 1;
    });
    return c.json({ changed }, 200);
  };
}
