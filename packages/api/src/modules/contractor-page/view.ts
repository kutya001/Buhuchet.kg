import {
  contractorMoneyOf,
  feeSubject,
  kpiData,
  listIndicators,
  loadTargets,
  loadValues,
  pageContractorFacts,
  pagePayRequisites,
  pagePeople,
  pageReports,
  pageScreenTexts,
  pageYearMoney,
  type Tx,
} from '@buhuchet/db';
import {
  contractorFees,
  currentTariff,
  formatDateRu,
  hasTaxSum,
  indicatorOn,
  lastDayOf,
  monthOf,
  monthReconciliation,
  pageFeePaidTill,
  pageKpiYears,
  pagePeriodicity,
  pageReportMark,
  pageTaxTotals,
  pageTipTexts,
  pageTypeNote,
  pageVerdictAmount,
  paymentStatus,
  periodFull,
  periodLabel,
  type Feature,
  type IsoDate,
  type PageSection,
  type Translate,
} from '@buhuchet/domain';
import type { PublicPageBody } from '@buhuchet/shared';

/*
 * Разделы открытой страницы контрагента (задача 2.43; ТЗ «Страница контрагента по ссылке» → «Что
 * видит контрагент», «Компоновка страницы»; прототип modules/cp-page.js, pubBody). Данные раздела
 * читаются и уходят в ответ, только если раздел показан (ТЗ «Разделы, скрытые в учётной политике или
 * в карточке контрагента, сервер не передаёт на страницу вовсе»): у скрытого раздела — null.
 * Шапка, строка состояния, «Главное» и «Ваш бухгалтер» показываются всегда; итоги «Главного» и
 * строки состояния считаются только по показанным разделам.
 */

type Body = Omit<PublicPageBody, 'asOf' | 'contractor' | 'org' | 'sections'>;

/** Разделы страницы и телефон организации для шапки «Ваш бухгалтер» и «Контактов». */
export type ContractorPageBody = Body & { orgPhone: PublicPageBody['org']['phone'] };

/** Период отчёта полностью (прототип `phuman`): «Сентябрь 2026», у разового — с датой события. */
function periodText(
  r: { period: 'M' | 'Q' | 'H' | 'Y'; periodStart: IsoDate; eventDate: IsoDate | null },
  eventLabel: string,
  t: Translate,
): string {
  const period = periodFull({ period: r.period, start: r.periodStart }, t);
  if (!r.eventDate) return period;
  return t('report.period.event_full', {
    period,
    event: eventLabel || t('report.event.default'),
    date: formatDateRu(r.eventDate),
  });
}

/**
 * Период строчными, как на странице прототипа (`phuman`: «сентябрь 2026»; «Единый налог за сентябрь
 * 2026»): строчной становится только русская первая буква, «II кв.» остаётся как есть.
 */
const lowerFirst = (text: string) => text.replace(/^[А-ЯЁ]/, (x) => x.toLowerCase());

export async function contractorPageBody(
  tx: Tx,
  o: {
    orgId: string;
    contractorId: string;
    sections: readonly PageSection[];
    features: Readonly<Record<Feature, boolean>>;
    today: IsoDate;
    t: Translate;
  },
): Promise<ContractorPageBody | null> {
  const { contractorId, today, t } = o;
  const facts = await pageContractorFacts(tx, contractorId);
  if (!facts) return null;
  const has = (s: PageSection) => o.sections.includes(s);
  const taxpay = o.features.taxpay;
  const showFee = has('fee') && !facts.oneOff;
  const year = today.slice(0, 4);
  const monthEnd = lastDayOf(monthOf(today));

  const [people, texts] = await Promise.all([
    pagePeople(tx, {
      contractorId,
      responsibleId: facts.responsibleEmployeeId,
      orgId: o.orgId,
      contractorPhone: facts.phone,
    }),
    pageScreenTexts(tx),
  ]);

  // Отчёты нужны «Отчётам», а их суммы — ещё и плитке «Налоги» при показанных «Деньгах на налоги».
  const needReports = has('reports') || has('money');
  // Файлы у периодов — только при «Файлах в карточках». ОТКЛОНЕНИЕ: docs/deviations.md#Е-4
  const rep = needReports
    ? await pageReports(tx, contractorId, has('reports') && o.features.files)
    : null;
  const money = taxpay && needReports ? await contractorMoneyOf(tx, contractorId) : null;
  const typeOf = new Map(rep?.types.map((x) => [x.code, x]) ?? []);
  const rows = (rep?.reports ?? []).map((r) => {
    const type = typeOf.get(r.typeCode);
    const sum = r.amount;
    return {
      r,
      type,
      hasSum: hasTaxSum(r.act),
      // «Получено от контрагента» по сверке (прототип `r.got`).
      got: money?.money.reports.get(r.id)?.received ?? 0,
      payStatus:
        taxpay && hasTaxSum(r.act) && (sum ?? 0) > 0
          ? (paymentStatus({ act: r.act, status: r.status, sum, paid: r.paid }) as
              'unpaid' | 'partial' | 'paid')
          : null,
      period: lowerFirst(periodText(r, type?.eventLabel ?? '', t)),
    };
  });

  const late = has('reports')
    ? rows.filter((x) => pageReportMark({ status: x.r.status, due: x.r.dueDate }, today) === 'late')
        .length
    : 0;

  let moneyBody: Body['money'] = null;
  if (has('money') && money) {
    const rec = monthReconciliation(money.money, money.reports, monthEnd);
    const byId = new Map(money.reports.map((r) => [r.id, r]));
    const totals = await pageYearMoney(tx, contractorId, year);
    moneyBody = {
      monthEnd,
      verdict: rec.verdict.state,
      amount: pageVerdictAmount(rec.verdict),
      dueSum: rec.dueSum,
      got: totals.got,
      paid: totals.paid,
      due: rec.due.map((id) => {
        const r = byId.get(id)!;
        return {
          id,
          type: r.typeShort,
          period: periodLabel({ period: r.period, start: r.periodStart, event: r.eventDate }, t),
          left: (r.sum ?? 0) - r.paid,
          payDue: r.payDue,
        };
      }),
    };
  }

  let feeBody: Body['fee'] = null;
  if (showFee) {
    const found = await feeSubject(tx, contractorId, undefined);
    if (found) {
      const fees = contractorFees(found.subject, found.payments, today);
      const tariff = currentTariff(found.subject.tariffs, today);
      feeBody = {
        tariff: tariff ? { amount: tariff.amount, period: tariff.period } : null,
        feeDay: found.subject.feeDay,
        debt: fees.debt,
        paidTill: pageFeePaidTill(fees.months),
        months: fees.months
          .filter((m) => m.charge > 0 || m.paid > 0)
          .reverse()
          .map((m) => ({ month: m.month, charge: m.charge, got: m.got, status: m.status })),
      };
    }
  }

  const taxTotals = pageTaxTotals(
    rows.map((x) => ({
      due: x.r.dueDate,
      hasSum: x.hasSum,
      sum: x.r.amount,
      got: x.got,
      paid: x.r.paid,
    })),
    year,
  );
  const yearRows = rows.filter((x) => x.r.dueDate.slice(0, 4) === year);
  const next = rows.find(
    (x) => pageReportMark({ status: x.r.status, due: x.r.dueDate }, today) === 'next',
  );

  let pay: Body['pay'] = null;
  if (has('pay')) {
    const found = await pagePayRequisites(tx, {
      paysTo: facts.paysTo,
      responsibleId: facts.responsibleEmployeeId,
      tax: taxpay,
      fee: showFee,
    });
    if (found.tax || found.fee) pay = found;
  }

  const responsible = people.people.find((p) => p.id === facts.responsibleEmployeeId) ?? null;
  const person = (p: (typeof people.people)[number]) => ({
    name: p.name,
    role: p.role,
    phone: p.phone,
  });

  return {
    today,
    // Телефон организации — в «Контактах» и в «Бухгалтер пока не назначен»; иначе не передаётся.
    orgPhone: has('contacts') || !responsible ? people.orgPhone : null,
    issues: {
      late,
      short: moneyBody?.verdict === 'short' ? moneyBody.amount : 0,
      feeDebt: feeBody?.debt ?? 0,
    },
    main: {
      reports: has('reports')
        ? {
            submitted: yearRows.filter((x) => x.r.status === 'submitted').length,
            total: yearRows.length,
            next: next
              ? {
                  due: next.r.dueDate,
                  type: next.type?.name ?? next.r.typeCode,
                  period: next.period,
                }
              : null,
          }
        : null,
      taxes:
        needReports && taxTotals.count
          ? {
              due: taxTotals.due,
              got: taxpay ? taxTotals.got : null,
              paid: taxpay ? taxTotals.paid : null,
              go: moneyBody ? 'money' : 'reports',
            }
          : null,
      fee: feeBody ? { debt: feeBody.debt, paidTill: feeBody.paidTill } : null,
    },
    accountant: responsible ? person(responsible) : null,
    pay,
    reports:
      has('reports') && rep
        ? {
            types: rep.types.map((x) => ({
              code: x.code,
              short: x.short,
              name: x.name,
              organ: x.organ,
              periodicity: pagePeriodicity(x),
              note: pageTypeNote(x),
            })),
            items: rows.map((x) => ({
              id: x.r.id,
              type: x.r.typeCode,
              period: x.period,
              due: x.r.dueDate,
              status: x.r.status,
              submittedOn: x.r.submittedOn,
              hasSum: x.hasSum,
              sum: x.r.amount,
              payStatus: x.payStatus,
              files: rep.files.get(x.r.id) ?? [],
            })),
          }
        : null,
    money: moneyBody,
    fee: feeBody,
    kpi: has('kpi') ? await pageKpi(tx, contractorId, today) : null,
    contacts: has('contacts')
      ? {
          people: people.people
            .filter((p) => p.active)
            .map((p) => ({
              ...person(p),
              responsible: p.id === facts.responsibleEmployeeId,
              types: people.types.filter((x) => x.employeeId === p.id).map((x) => x.short),
            })),
          head: facts.head,
          contact: facts.contact,
          phone: people.contractorPhone,
        }
      : null,
    texts: pageTipTexts(texts),
  };
}

/**
 * «Показатели» (прототип pubBody, `inds`): показатели не в архиве, которые ведутся у контрагента, по
 * порядку; значения — только внесённые, по текущий месяц; без статусов проверки и примечаний.
 */
async function pageKpi(tx: Tx, contractorId: string, today: IsoDate): Promise<Body['kpi']> {
  const [list, targets, values] = await Promise.all([
    listIndicators(tx),
    loadTargets(tx, [contractorId]),
    loadValues(tx, { contractorIds: [contractorId], filled: true, to: monthOf(today) }),
  ]);
  const { book } = kpiData(list, targets, values);
  const byIndicator = new Map<string, { month: string; value: number }[]>();
  for (const v of values) {
    if (v.value === null) continue;
    const l = byIndicator.get(v.indicatorId) ?? [];
    l.push({ month: v.month, value: v.value });
    byIndicator.set(v.indicatorId, l);
  }
  return {
    years: pageKpiYears(
      values.map((v) => v.month),
      today,
    ),
    indicators: list
      .filter((r) => !r.archived && indicatorOn(r, book.target(r.id, contractorId)))
      .map((r) => ({
        id: r.id,
        name: r.name,
        unit: r.unit,
        type: r.type,
        total: r.total,
        values: byIndicator.get(r.id) ?? [],
      })),
  };
}
