import {
  contractorMoneyOf,
  contractorTaxTransfer,
  feeSubject,
  feeTransfer,
  kpiData,
  listIndicators,
  loadTargets,
  loadValues,
  pageContractorFacts,
  pageFiles,
  pagePayRequisites,
  pagePeople,
  pageReports,
  pageScreenTexts,
  pageYearMoney,
  waitingPayClaims,
  type Tx,
  type WaitingPayClaim,
} from '@buhuchet/db';
import {
  contractorFees,
  currentTariff,
  filePreviewKind,
  formatDateRu,
  hasTaxSum,
  indicatorOn,
  lastDayOf,
  monthOf,
  monthReconciliation,
  pageFeePaidTill,
  pageFileCategories,
  pageFileRel,
  pageKpiYears,
  pageMonthPay,
  pagePeriodicity,
  pageReportMark,
  pageTaxTotals,
  pageTipTexts,
  pageTypeNote,
  pageVerdictAmount,
  paymentStatus,
  periodFull,
  periodLabel,
  reportMonth,
  type Feature,
  type IsoDate,
  type PageSection,
  type Translate,
} from '@buhuchet/domain';
import type { PublicPageBody } from '@buhuchet/shared';
import { pageTransferOf } from '../telegram/client/requisite';

/*
 * Разделы открытой страницы контрагента (задача 2.43; ТЗ «Страница контрагента по ссылке» → «Что
 * видит контрагент», «Компоновка страницы»; прототип modules/cp-page.js, pubBody). Данные раздела
 * читаются и уходят в ответ, только если раздел показан (ТЗ «Разделы, скрытые в учётной политике или
 * в карточке контрагента, сервер не передаёт на страницу вовсе»): у скрытого раздела — null.
 * Шапка, строка состояния, «Главное» и «Ваш бухгалтер» показываются всегда; итоги «Главного» и
 * строки состояния считаются только по показанным разделам.
 */

// Раздел «Telegram» (задача К3) добавляет обработчик страницы: ему нужен подключённый бот.
type Body = Omit<
  PublicPageBody,
  'asOf' | 'contractor' | 'org' | 'sections' | 'telegram' | 'sent' | 'help'
>;

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
  // Принято под отчёт детализацией поступлений (прототип `r.recv`) — для «оплачено» месяца.
  const recvOf = new Map(money?.reports.map((x) => [x.id, x.received]) ?? []);
  const rows = (rep?.reports ?? []).map((r) => {
    const type = typeOf.get(r.typeCode);
    const sum = r.amount;
    return {
      r,
      type,
      hasSum: hasTaxSum(r.act),
      // «Получено от контрагента» по сверке (прототип `r.got`).
      got: money?.money.reports.get(r.id)?.received ?? 0,
      recv: recvOf.get(r.id) ?? 0,
      payStatus:
        taxpay && hasTaxSum(r.act) && (sum ?? 0) > 0
          ? (paymentStatus({ act: r.act, status: r.status, sum, paid: r.paid }) as
              'unpaid' | 'partial' | 'paid')
          : null,
      period: lowerFirst(periodText(r, type?.eventLabel ?? '', t)),
      month: reportMonth(r),
    };
  });
  // Сообщения клиента об оплате, которые ждут подтверждения (блок 6; прототип v116 `pgClaimWait`):
  // со страницы и из Telegram — для «Ожидает подтверждения» у месяцев и карточек «Как оплатить».
  const waiting: WaitingPayClaim[] =
    has('reports') || has('pay') || showFee ? await waitingPayClaims(tx, contractorId) : [];
  const lastWaiting = (purpose: 'tax' | 'fee', month?: string) =>
    waiting
      .filter((x) => x.purpose === purpose && (month === undefined || x.month === month))
      .pop() ?? null;

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
          .map((m) => ({
            month: m.month,
            charge: m.charge,
            got: m.got,
            // Оплачено полностью — «Оплачено»; клиент сообщил об оплате месяца — «Ожидает
            // подтверждения» (прототип v116: `p>=ch?…:pgClaimWait(c,'fee',m)?…`).
            status:
              m.status !== 'paid' && lastWaiting('fee', m.month) ? ('wait' as const) : m.status,
          })),
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
    // Подпись «Реквизиты для перевода — …» и кнопка копирования — как в Telegram (прототип v116 `pubPay`).
    const transfer = async (kind: 'tax' | 'fee') => {
      const of =
        kind === 'tax'
          ? await contractorTaxTransfer(tx, {
              paysTo: facts.paysTo,
              responsibleId: facts.responsibleEmployeeId,
            })
          : await feeTransfer(tx);
      return of ? pageTransferOf(tx, t, of) : null;
    };
    const card = async (kind: 'tax' | 'fee') => {
      const a = found[kind];
      if (!a) return null;
      const tr = await transfer(kind);
      const w = lastWaiting(kind);
      return {
        ...a,
        employee: kind === 'tax' && facts.paysTo === 'emp',
        head: tr?.head ?? '',
        copy: tr?.copy ?? a.copy,
        copyLabel: tr?.copyLabel ?? '',
        waiting: w ? { at: w.createdAt.toISOString(), amount: w.amount } : null,
      };
    };
    const [tax, fee] = [await card('tax'), await card('fee')];
    if (tax || fee) pay = { tax, fee };
  }

  // «По месяцам» с оплатой (прототип v116 `pgMonthPay`): только при «Учёте оплаты налогов».
  const months = taxpay && has('reports') ? monthsPay(rows, lastWaiting, t) : null;

  const responsible = people.people.find((p) => p.id === facts.responsibleEmployeeId) ?? null;
  const person = (p: (typeof people.people)[number]) => ({
    name: p.name,
    role: p.role,
    phone: p.phone,
  });

  return {
    today,
    // Телефон организации — в «Контактах», в «Бухгалтер пока не назначен» и когда у бухгалтера нет
    // своего телефона («Позвонить бухгалтеру», прототип v135 `ph`); иначе не передаётся.
    orgPhone: has('contacts') || !responsible?.phone ? people.orgPhone : null,
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
              month: x.month,
              // Любой файл открывается в окне просмотра страницы (доработки 16.11.2026, блок 5).
              files: (rep.files.get(x.r.id) ?? []).map((f) => ({
                id: f.id,
                name: f.name,
                size: f.size,
                preview: filePreviewKind(f.contentType),
              })),
            })),
            months,
            send: !!months && !!pay?.tax,
          }
        : null,
    files: has('files')
      ? (
          await pageFiles(
            tx,
            contractorId,
            pageFileCategories(o.sections, { projects: o.features.projects, fee: showFee }),
          )
        ).map((f) => ({
          id: f.id,
          name: f.name,
          category: f.category,
          rel: pageFileRel(f.source, t),
          date: f.date,
          size: f.size,
          preview: filePreviewKind(f.contentType),
        }))
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

type PageRow = {
  r: {
    id: string;
    act: Parameters<typeof pageMonthPay>[1][number]['act'];
    amount: number | null;
    paid: number;
    payDue: IsoDate | null;
    typeCode: string;
    period: 'M' | 'Q' | 'H' | 'Y';
    periodStart: IsoDate;
    eventDate: IsoDate | null;
  };
  type?: { short: string } | undefined;
  got: number;
  recv: number;
  month: string;
};

/**
 * Оплата по месяцам для клиента (доработки 14.11.2026, блок 6, пункт 3; прототип v116 `pgMonthPay`):
 * «к оплате», «оплачено» (принятое от клиента под отчёты месяца или уплаченное в бюджет, не больше
 * суммы), «осталось», пометка и строки «Перечислить»; месяцы без сумм к оплате не приходят.
 */
function monthsPay(
  rows: readonly PageRow[],
  lastWaiting: (purpose: 'tax', month: string) => WaitingPayClaim | null,
  t: Translate,
): NonNullable<NonNullable<Body['reports']>['months']> {
  const byMonth = new Map<string, PageRow[]>();
  for (const x of rows) byMonth.set(x.month, [...(byMonth.get(x.month) ?? []), x]);
  const byId = new Map(rows.map((x) => [x.r.id, x]));
  return [...byMonth.keys()]
    .sort()
    .map((month) => {
      const list = byMonth.get(month)!;
      const p = pageMonthPay(
        month as `${number}-${number}`,
        list.map((x) => ({
          id: x.r.id,
          act: x.r.act,
          amount: x.r.amount,
          paid: x.r.paid,
          // Как в прототипе (`pgMonthPay`: `x.r.recv`): принятое под отчёт, без доли свободного остатка.
          received: x.recv,
          payDue: x.r.payDue,
        })),
        !!lastWaiting('tax', month),
      );
      return {
        ...p,
        rows: p.rows.map((row) => {
          const x = byId.get(row.id)!;
          return {
            ...row,
            type: x.type?.short ?? x.r.typeCode,
            period: periodLabel(
              { period: x.r.period, start: x.r.periodStart, event: x.r.eventDate },
              t,
            ),
          };
        }),
      };
    })
    .filter((m) => m.sum > 0);
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
