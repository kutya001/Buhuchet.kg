import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  activeReportTypes,
  getContractor,
  kpiContractorOf,
  kpiContractorRecords,
  listTaxes,
  loadKpiData,
  reportTaxSource,
  type KpiContractorRecord,
  type Tx,
} from '@buhuchet/db';
import {
  cellState,
  formatText,
  hasPermission,
  indicatorOn,
  indicatorStart,
  offSince,
  reportTaxMonths,
  reportTaxRoles,
  socfundShort,
  socfundState,
  taxBase,
  taxBaseTotal,
  taxResult,
  type IsoDate,
  type Translate,
} from '@buhuchet/domain';
import { KpiTaxBox, KpiTaxParams } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { requirePermission } from '../../middleware/access';
import { socfundContext, socfundSubjectOf } from '../contractors/socfund-view';
import { serverTexts } from '../l10n/texts';
import { reportScopeOf } from '../reports/common';
import {
  canEditValues,
  currentMonthOf,
  error,
  inKpi,
  kpiScopeOf,
  noAuth,
  subjectOf,
  todayOf,
} from './common';

/*
 * «Расчёт по показателям» окон «Сумма к уплате» и «Отметить сданным» (прототип v80 modules/kpi-tax.js:
 * kTaxOk, kTaxHtml; docs/deviations.md п. О-62): значения показателей с отметкой «Для расчёта налогов»
 * за месяцы периода отчёта и подсказка суммы. Метод только читает: значения вносятся методом
 * `PUT /kpi/values`, «Вести» — `PUT /kpi/who`. Видит блок тот, кто видит и отчёт (право «Просматривать
 * отчёты» и область группы «Отчеты для сдачи»), и показатели контрагента (право «Просматривать
 * показатели» и область группы «Показатели контрагентов»); функция «Показатели контрагентов» включена.
 */

/** Налог со ставкой подоходного налога в «Налогах и ставках» (прототип kTaxSoc: НАЛ-01). */
const INCOME_TAX_CODE = 'НАЛ-01';

export const taxBoxRoute = createRoute({
  method: 'get',
  path: '/kpi/tax/{reportId}',
  tags: ['kpi'],
  summary: '«Расчёт по показателям» отчёта',
  middleware: [requirePermission('kpiView'), requirePermission('repView')] as const,
  request: { params: KpiTaxParams },
  responses: {
    200: {
      description:
        'Показатели «для расчёта налогов» контрагента за месяцы периода отчёта и подсказка суммы; `box: null` — блока у отчёта нет',
      content: { 'application/json': { schema: KpiTaxBox } },
    },
    401: noAuth,
    403: {
      description:
        'Нет права «Просматривать показатели» или «Просматривать отчёты», или функция выключена',
      content: error,
    },
    404: { description: 'Нет такого отчёта или он вне области сотрудника', content: error },
  },
});

/** Тариф Соцфонда контрагента для расчёта (прототип kTaxSoc: выбранный, иначе по условиям). */
async function socfundOf(tx: Tx, record: KpiContractorRecord, today: IsoDate) {
  const [contractor, types, taxes] = await Promise.all([
    getContractor(tx, record.id, { scope: undefined, today }),
    activeReportTypes(tx, record.id),
    listTaxes(tx),
  ]);
  const rateText = taxes.find((x) => x.code === INCOME_TAX_CODE)?.guide.rates[0]?.rate ?? '';
  if (!contractor) return { tariff: null, rateText };
  const { dict, form } = await socfundContext(
    tx,
    contractor.gked?.code ?? null,
    contractor.form.code,
  );
  const st = socfundState(
    socfundSubjectOf(
      {
        kind: contractor.kind,
        bases: contractor.bases.map((b) => b.code),
        gked: contractor.gked?.code ?? null,
        benefits: contractor.benefits.map((b) => b.code),
        flags: contractor.socfundFlags,
      },
      form,
      types,
    ),
    contractor.socfundTariff,
    dict,
  );
  const id = st ? (st.choice?.id ?? st.auto.tariff) : null;
  const tariff = id ? dict.tariffs.find((x) => x.id === id) : undefined;
  return { tariff: tariff ? { ...tariff, short: socfundShort(tariff) } : null, rateText };
}

export function taxBoxHandler(deps: ApiDeps): RouteHandler<typeof taxBoxRoute, AppEnv> {
  return async (c) => {
    const { reportId } = c.req.valid('param');
    const subject = subjectOf(c);
    const texts = await serverTexts(deps);
    const t: Translate = (key, params) => formatText(texts(key), params);
    const today = todayOf(deps);
    const current = currentMonthOf(deps);
    const body = await inKpi(deps, c, async (tx): Promise<KpiTaxBox | null> => {
      const source = await reportTaxSource(tx, reportId, reportScopeOf(subject), t);
      if (!source) return null;
      const roles = reportTaxRoles(source.typeCode, source.act);
      const months = roles ? reportTaxMonths(source.period, source.periodStart) : [];
      const main = roles?.[0];
      if (!roles || (main !== 'rev' && main !== 'fot') || months.length === 0) return { box: null };
      // Показатели контрагента — только в области группы «Показатели контрагентов».
      const [record] = await kpiContractorRecords(tx, {
        scope: kpiScopeOf(subject),
        archived: true,
        ids: [source.contractorId],
      });
      if (!record) return { box: null };
      const kc = kpiContractorOf(record);
      const data = await loadKpiData(tx, {
        contractorIds: [record.id],
        from: months[0]!,
        to: months[months.length - 1]!,
      });
      const editable = canEditValues(subject, record);
      const canSetup = hasPermission(subject, 'indSetup');
      const live = record.kind !== 'oneoff' && record.serviceStatus !== 'archived';
      // Показатель роли — первый по порядку действующий с отметкой (прототип kTaxInd).
      const found = roles.flatMap((role) => {
        const r = data.indicators.find((x) => !x.archived && x.taxRole === role);
        const i = r && data.book.indicators.find((x) => x.id === r.id);
        if (!r || !i) return [];
        const base = taxBase(months, (m) => data.valueOf(record.id, r.id, m));
        return [{ role, r, i, base }];
      });
      const mainRow = found.find((x) => x.role === main);
      const socfund =
        main === 'fot' && mainRow && mainRow.base.missing.length === 0
          ? await socfundOf(tx, record, today)
          : null;
      const result = taxResult({
        typeCode: source.typeCode,
        main: mainRow ? { name: mainRow.r.name, base: mainRow.base } : null,
        ...(main === 'fot'
          ? {
              socfund: {
                tariff: socfund?.tariff ?? null,
                rateText: socfund?.rateText ?? '',
                emp: found.find((x) => x.role === 'emp')?.base ?? null,
              },
            }
          : {}),
        rateLines: source.lineDefs.filter((d) => d.kind === 'rate'),
        assignmentRate: source.rate,
      });
      // «Подставить в сумму» у «Соцфонда»: строки платежей «Подоходный налог» и «Страховые взносы».
      const payments = source.lineDefs.filter((d) => d.kind === 'payment');
      const incomeKey = payments.find((d) => /подоходн/i.test(d.label))?.key ?? null;
      const contributionsKey = payments.find((d) => /взнос/i.test(d.label))?.key ?? null;
      const both = incomeKey !== null && contributionsKey !== null;
      return {
        box: {
          contractor: { id: record.id, name: record.name },
          main,
          months,
          current,
          canSetup,
          editable,
          // Без основного показателя таблицы нет — только подсказка (прототип kTaxHtml).
          rows: (mainRow ? found : []).map(({ role, r, i, base }) => {
            const target = data.book.target(i.id, record.id);
            return {
              role,
              indicator: { id: r.id, name: r.name, unit: r.unit, type: r.type },
              on: live && indicatorOn(i, target),
              offSince: offSince(i, data.book, record.id),
              canTurnOn: canSetup && live,
              start: indicatorStart(i, target, kc),
              cells: months.map((month, j) => ({
                month,
                value: base.values[j] ?? null,
                input: editable && month <= current && cellState(data.book, i, kc, month) !== 'off',
              })),
              total: months.length > 1 ? taxBaseTotal(role, base) : null,
            };
          }),
          result:
            result.kind === 'socfund'
              ? {
                  ...result,
                  incomeKey: both ? incomeKey : null,
                  contributionsKey: both ? contributionsKey : null,
                }
              : result,
        },
      };
    });
    if (!body) return apiFail(404, 'report_not_found', 'Отчёт не найден');
    return c.json(body, 200);
  };
}
