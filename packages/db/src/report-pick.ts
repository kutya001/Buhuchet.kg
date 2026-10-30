import {
  activeSingleTax,
  assignmentRateText,
  defaultSingleTaxRates,
  effectiveRule,
  nearestDueText,
  OPEN_REPORT_STATUSES,
  periodInAssignment,
  periodStartOf,
  RecordNotFoundError,
  SINGLE_TAX_REGIME,
  SINGLE_TAX_TYPES,
  statusDueText,
  type AssignmentEnRate,
  type BizSize,
  type GkedNode,
  type IsoDate,
  type PickDict,
  type PickSubject,
  type StatusDueRule,
  type Translate,
} from '@buhuchet/domain';
import { and, asc, eq, getTableName, gte, inArray, isNull, sql } from 'drizzle-orm';
import type { Tx } from './client';
import { contractorGkedDicts } from './contractors';
import { gkedIndexOf } from './gked';
import { writeHistory } from './history';
import {
  listReportBases,
  listReportTypes,
  listTaxBenefits,
  type ReportTypeRecord,
  type TaxBenefitRecord,
} from './platform-dicts';
import { calendarOf, reportTypeInfos, singleTaxRateRows } from './reports';
import {
  assignments,
  files,
  orgReportTypes,
  ownershipForms,
  reports,
  taxOffices,
  taxRegimes,
} from './schema';

/*
 * «Подбор отчётов» (ТЗ «Контрагенты» → «Подбор отчётов и налогов, льгот и статусов»; прототип
 * modules/report-pick.js): справочники для подбора, контрагент или черновик формы, строки описания вида
 * для контрагента и применение выбора — снятие видов с удалением текущих отчётов «К сдаче». Наборы
 * считает `@buhuchet/domain` (`reportPick`); новые назначения создаёт `createAssignment`.
 */

/**
 * Справочники платформы для подбора — те же, что у окна на экране: весь каталог видов (и отключённые —
 * для «Вид отключён»), действующие льготы и статусы, основания, ставки единого налога и ГКЭД по кодам.
 */
export async function reportPickDict(
  tx: Tx,
  gkedCodes: readonly string[],
): Promise<Omit<PickDict, 'types'> & { types: ReportTypeRecord[] }> {
  const [types, benefits, bases, rates, index] = await Promise.all([
    listReportTypes(tx, { all: true }),
    listTaxBenefits(tx),
    listReportBases(tx),
    singleTaxRateRows(tx),
    gkedIndexOf(tx, gkedCodes),
  ]);
  return { types, benefits, bases, rates, index };
}

/** Виды, подключённые в организации («Справочники → Виды отчётов»). */
export async function connectedReportTypes(tx: Tx): Promise<string[]> {
  const rows = await tx
    .select({ code: orgReportTypes.reportTypeCode })
    .from(orgReportTypes)
    .where(eq(orgReportTypes.enabled, true));
  return rows.map((r) => r.code);
}

/** Действующие назначения контрагента: виды и строки ЕНС назначения единого налога. */
export async function activeAssignments(
  tx: Tx,
  contractorId: string,
): Promise<{ codes: string[]; singleTax: AssignmentEnRate[] }> {
  const rows = await tx
    .select({
      reportTypeCode: assignments.reportTypeCode,
      endedOn: assignments.endedOn,
      enRates: assignments.enRates,
    })
    .from(assignments)
    .where(and(eq(assignments.contractorId, contractorId), isNull(assignments.endedOn)))
    .orderBy(asc(assignments.createdAt));
  return { codes: rows.map((r) => r.reportTypeCode), singleTax: activeSingleTax(rows) };
}

/** Поля контрагента или черновика формы, по которым считается подбор. */
export interface PickFields {
  formCode: string | null;
  regimeCode: string | null;
  regime2Code: string | null;
  gked: string | null;
  gkedExtra: readonly string[];
  taxOfficeCode: string | null;
  /** Юридический адрес — место деятельности для варианта ставки ЕН (прототип enPlace). */
  address: string;
  bizSize: BizSize;
  benefits: readonly { code: string; validFrom: IsoDate | null; validTo: IsoDate | null }[];
  bases: readonly string[];
  /** Строки ЕНС, выбранные в форме или в действующем назначении; пусто — подобранные по ГКЭД. */
  enRates: readonly AssignmentEnRate[];
  /** Строки ЕНС действующего назначения единого налога (для ЕНД при нулевой ставке). */
  singleTax: readonly AssignmentEnRate[];
}

/**
 * Контрагент для подбора (прототип pkCalc: cx): форма собственности с «Для ЕНД», режимы по порядку с
 * названиями, строки ЕНС для «Не для ставок ЕН» — выбранные, иначе подобранные по ГКЭД (прототип pkEn).
 * `connected` — виды, подключённые в организации.
 */
export async function reportPickSubject(
  tx: Tx,
  f: PickFields,
  connected: readonly string[],
): Promise<PickSubject> {
  const regimeCodes = [f.regimeCode, f.regime2Code].filter((c): c is string => !!c);
  const [[form], regimes, enCodes] = await Promise.all([
    f.formCode
      ? tx
          .select({ code: ownershipForms.code, declarationFor: ownershipForms.declarationFor })
          .from(ownershipForms)
          .where(eq(ownershipForms.code, f.formCode))
      : Promise.resolve([]),
    regimeCodes.length
      ? tx
          .select({ code: taxRegimes.code, name: taxRegimes.name })
          .from(taxRegimes)
          .where(inArray(taxRegimes.code, regimeCodes))
      : Promise.resolve([]),
    f.enRates.length
      ? Promise.resolve(f.enRates.map((e) => e.code))
      : draftSingleTaxRates(tx, f).then((rows) => rows.map((e) => e.code)),
  ]);
  return {
    form: form ?? null,
    regimes: regimeCodes
      .map((code) => regimes.find((r) => r.code === code))
      .filter((r): r is { code: string; name: string } => !!r),
    singleTax: f.singleTax,
    benefits: f.benefits.map((b) => b.code),
    bases: f.bases,
    bizSize: f.bizSize,
    gked: f.gked,
    gkedExtra: f.gkedExtra,
    enCodes,
    connected,
  };
}

/**
 * Строки ЕНС по основному и дополнительным ГКЭД, статусам и месту деятельности (прототип enAuto) — для
 * черновика формы и нового контрагента.
 */
export async function draftSingleTaxRates(tx: Tx, f: PickFields) {
  const [dicts, [office]] = await Promise.all([
    contractorGkedDicts(
      tx,
      [f.gked, ...f.gkedExtra].filter((c): c is string => !!c),
    ),
    f.taxOfficeCode
      ? tx
          .select({ region: taxOffices.region })
          .from(taxOffices)
          .where(eq(taxOffices.code, f.taxOfficeCode))
      : Promise.resolve([]),
  ]);
  return defaultSingleTaxRates(
    {
      gked: f.gked,
      gkedExtra: f.gkedExtra,
      benefits: f.benefits.map((b) => b.code),
      place: [office?.region ?? '', f.address].filter(Boolean).join(' '),
    },
    dicts.rates,
    dicts.index,
  );
}

/** Справочник ГКЭД по кодам контрагента и их предкам — окну для «Подходит по ГКЭД». */
export async function reportPickGked(tx: Tx, codes: readonly string[]): Promise<GkedNode[]> {
  return [...(await gkedIndexOf(tx, codes)).values()];
}

/**
 * Сроки по статусам (прототип tOv): статус действует, пока сегодня в его датах «Действует с / по»; из
 * нескольких статусов со своим сроком вида — первый по коду (как `statusDueRules`).
 */
function statusRulesOf(
  benefits: PickFields['benefits'],
  dict: readonly TaxBenefitRecord[],
  today: IsoDate,
): Map<string, { rule: StatusDueRule; name: string }> {
  const out = new Map<string, { rule: StatusDueRule; name: string }>();
  const live = benefits
    .filter((b) => (!b.validFrom || b.validFrom <= today) && (!b.validTo || b.validTo >= today))
    .map((b) => dict.find((x) => x.code === b.code))
    .filter((b): b is TaxBenefitRecord => !!b)
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  for (const b of live) {
    for (const { reportType, ...rule } of b.dueRules) {
      if (!out.has(reportType))
        out.set(reportType, { rule: { benefitCode: b.code, ...rule }, name: b.name });
    }
  }
  return out;
}

/**
 * Строки описания вида для контрагента (прототип pkDescHtml): «Ближайший срок» (с учётом срока по
 * статусу) и «Срок по статусу»; ставки ЕН по ГКЭД — «ЕНС-03 · 2 % безнал + 4 % нал; …», если указан
 * ГКЭД или режим «Единый налог».
 */
export async function reportPickDetails(
  tx: Tx,
  f: PickFields,
  subject: PickSubject,
  context: { today: IsoDate; codes: readonly string[]; t: Translate },
): Promise<{ details: { code: string; near: string; statusDue: string }[]; enRates: string }> {
  const { today, t } = context;
  const [types, calendar, benefits, rates, byGked] = await Promise.all([
    reportTypeInfos(tx, context.codes),
    calendarOf(tx),
    listTaxBenefits(tx),
    singleTaxRateRows(tx),
    subject.gked || subject.regimes.some((r) => r.code === SINGLE_TAX_REGIME)
      ? draftSingleTaxRates(tx, f)
      : Promise.resolve([]),
  ]);
  const statuses = statusRulesOf(f.benefits, benefits, today);
  const details = [...types.values()].map((type) => {
    const status = statuses.get(type.code) ?? null;
    return {
      code: type.code,
      near: nearestDueText(effectiveRule(type, null, status?.rule ?? null), today, calendar, t),
      statusDue: statusDueText(type, status?.rule ?? null, status?.name ?? '', t),
    };
  });
  const enRates = byGked.length
    ? assignmentRateText(
        { reportTypeCode: SINGLE_TAX_TYPES[0]!, rate: null, enRates: byGked, rateAdditions: [] },
        { rateAdditions: [] },
        rates,
        { date: today },
        t,
      )
    : '';
  return { details: details.filter((d) => d.near || d.statusDue), enRates };
}

/**
 * Отчёты, которые снятие вида удаляет (прототип pkDroppable): текущего и будущих периодов, в статусе «К
 * сдаче», без даты сдачи, без файлов (последняя версия — и уточнённый); у вида с периодичностью
 * в назначении и у разового — с текущего месяца. Изменённый вручную срок движением не считается (ТЗ:
 * «статус дальше «К сдаче», деньги, файлы») — журнал сроков удаляется вместе с отчётом.
 * Денег у отчётов пока нет — условие «без денег» добавит задача денег (поток В).
 */
// Столбец внешней строки — с именем таблицы: в выборке из одной таблицы drizzle пишет столбцы без него.
const noFiles = sql`not exists (select 1 from ${files} f where f.source_id = ${sql.raw(
  `"${getTableName(reports)}"."id"`,
)} and f.state <> 'deleted')`;

async function droppableReports(
  tx: Tx,
  contractorId: string,
  codes: readonly string[],
  today: IsoDate,
  lock: boolean,
): Promise<{ id: string; typeCode: string }[]> {
  if (codes.length === 0) return [];
  const types = await reportTypeInfos(tx, codes);
  const out: { id: string; typeCode: string }[] = [];
  for (const type of types.values()) {
    const from =
      type.oneOff || periodInAssignment(type)
        ? periodStartOf('M', today)
        : periodStartOf(type.period, today);
    const query = tx
      .select({ id: reports.id })
      .from(reports)
      .where(
        and(
          eq(reports.contractorId, contractorId),
          eq(reports.reportTypeCode, type.code),
          eq(reports.superseded, false),
          eq(reports.status, 'todo'),
          isNull(reports.submittedOn),
          gte(reports.periodStart, from),
          noFiles,
        ),
      );
    const rows = lock ? await query.for('update') : await query;
    out.push(...rows.map((r) => ({ id: r.id, typeCode: type.code })));
  }
  return out;
}

/**
 * Что сделает снятие видов (прототип pkChangesHtml): сколько отчётов удалится и сколько несданных со
 * сроком с сегодняшнего дня останется — по ним уже есть движение, их доводят вручную.
 */
export async function reportPickRemovePreview(
  tx: Tx,
  contractorId: string,
  codes: readonly string[],
  today: IsoDate,
): Promise<{ deleted: number; kept: number }> {
  if (codes.length === 0) return { deleted: 0, kept: 0 };
  const [drop, open] = await Promise.all([
    droppableReports(tx, contractorId, codes, today, false),
    tx
      .select({ id: reports.id })
      .from(reports)
      .where(
        and(
          eq(reports.contractorId, contractorId),
          inArray(reports.reportTypeCode, [...codes]),
          eq(reports.superseded, false),
          inArray(reports.status, [...OPEN_REPORT_STATUSES]),
          gte(reports.dueDate, today),
        ),
      ),
  ]);
  const gone = new Set(drop.map((r) => r.id));
  return { deleted: drop.length, kept: open.filter((r) => !gone.has(r.id)).length };
}

/**
 * Снять виды у контрагента из подбора (прототип pkApply): назначение заканчивается сегодня, отчёты
 * текущего и будущих периодов «К сдаче» без движения удаляются, остальные остаются как есть и доводятся
 * вручную; отчёты прошлых периодов не меняются. В истории контрагента — снятие с причиной (у
 * обязательного вида — «снял, хотя отчёт обязателен…») и каждый удалённый отчёт. Контрагента уже
 * заблокировали и проверили; `codes` — виды с действующим назначением.
 */
export async function removePickedTypes(
  tx: Tx,
  contractorId: string,
  codes: readonly string[],
  context: {
    today: IsoDate;
    /** Причина снятия в истории: вид и сколько его отчётов удалено. */
    reason: (code: string, deleted: number) => string;
    deleteReason: string;
  },
): Promise<number> {
  if (codes.length === 0) return 0;
  const ended = await tx
    .update(assignments)
    .set({
      endedOn: context.today,
      version: sql`${assignments.version} + 1`,
      updatedAt: sql`now()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .where(
      and(
        eq(assignments.contractorId, contractorId),
        inArray(assignments.reportTypeCode, [...codes]),
        isNull(assignments.endedOn),
      ),
    )
    .returning({ id: assignments.id, code: assignments.reportTypeCode });
  if (ended.length !== codes.length) {
    throw new RecordNotFoundError('assignment', codes.join(','));
  }
  const drop = await droppableReports(tx, contractorId, codes, context.today, true);
  if (drop.length) {
    await tx.delete(reports).where(
      inArray(
        reports.id,
        drop.map((r) => r.id),
      ),
    );
  }
  await writeHistory(
    tx,
    ...ended.map((a) => ({
      entity: 'assignment' as const,
      entityId: a.id,
      action: 'update' as const,
      changes: [{ field: 'endedOn', from: null, to: context.today }],
      reason: context.reason(a.code, drop.filter((r) => r.typeCode === a.code).length),
      contractorId,
    })),
    ...drop.map((r) => ({
      entity: 'report' as const,
      entityId: r.id,
      action: 'delete' as const,
      reason: context.deleteReason,
      contractorId,
    })),
  );
  return drop.length;
}
