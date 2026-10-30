import {
  auditActorName,
  bishkekDate,
  formatPhone,
  initialPeriods,
  officeBenefitChanges,
  RecordNotFoundError,
  serviceState,
  type BizSize,
  type ContractorGkedConfirmation,
  type ContractorKind,
  type ContractorRegistration,
  type ContractorUsage,
  type FirstMonthMode,
  type GkedDicts,
  type GkedRule,
  type HistoryChange,
  type IsoDate,
  type ListQuery,
  type ReportKind,
  type ServiceStatus,
  type SingleTaxSubject,
  type TariffPeriod,
} from '@buhuchet/domain';
import { and, asc, count, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Tx } from './client';
import { updateWithHistory, writeHistory } from './history';
import {
  auditActorValue,
  selectListExport,
  selectListPage,
  selectListValues,
  type ExportCell,
  type ListColumns,
  type ListFrom,
  type ListPageResult,
  type ListTexts,
  type ListWindowFields,
} from './list';
import {
  contractorBases,
  contractorBenefits,
  contractorGkedExtra,
  contractors,
  contractorTariffs,
  employees,
  gkedItems,
  ownershipForms,
  platformReference,
  reportBases,
  reportTypeRegimes,
  reportTypes,
  roles,
  singleTaxRates,
  taxBenefitOffices,
  taxBenefits,
  taxOffices,
  taxRegimes,
} from './schema';
import {
  contractorReportCount,
  moveUnfinishedReports,
  redueContractorReports,
  statusDueRules,
  unfinishedReportsCount,
  type RedueTexts,
} from './reports';
import { phoneCodes, type AuditRecord } from './staff';
import { moveContractorTasks, openTasksOfContractors } from './tasks';

/**
 * Модуль «Контрагенты»: контрагенты организации из контекста `withOrgContext` (RLS) с дополнительными
 * ГКЭД, льготами, основаниями и первой записью журнала тарифов. Область «Свои контрагенты» приходит
 * условием `scope` (`contractorScope`): контрагент вне неё — «не найден», как чужой организации.
 * История — в `audit_log` (entity `contractor`, `contractor_id`), закрепление — изменением поля
 * `responsibleEmployeeId` (docs/decisions.md).
 */

/** Значения полей контрагента, которые задаёт форма (создание и «Изменить»). */
export interface ContractorFields {
  name: string;
  inn: string;
  phone: string;
  kind: ContractorKind;
  formCode: string;
  regimeCode: string | null;
  regime2Code: string | null;
  gked: string | null;
  gkedExtra: string[];
  taxOfficeCode: string | null;
  bizSize: BizSize;
  benefits: { code: string; validFrom: IsoDate | null; validTo: IsoDate | null }[];
  bases: string[];
  responsibleEmployeeId: string | null;
  head: string;
  contact: string;
  contractNo: string;
  contractDate: IsoDate | null;
  note: string;
  registration: ContractorRegistration;
  startDate: IsoDate;
  firstMonthMode: FirstMonthMode;
  feeDay: number;
  paysTo: 'emp' | 'org';
  gkedConfirmation: ContractorGkedConfirmation | null;
}

/** Первая запись журнала тарифов: сумма в тыйынах, периодичность и месяц (первое число). */
export interface ContractorTariffInput {
  amount: number;
  period: TariffPeriod;
  validFrom: IsoDate;
  note: string;
}

export interface ContractorRecord {
  id: string;
  name: string;
  inn: string;
  phone: string;
  phoneText: string;
  kind: ContractorKind;
  form: { code: string; name: string; declarationFor: 'org' | 'ip' };
  regime: { code: string; name: string } | null;
  regime2: { code: string; name: string } | null;
  gked: { code: string; name: string } | null;
  gkedExtra: { code: string; name: string }[];
  taxOffice: { code: string; name: string } | null;
  bizSize: BizSize;
  /** `byOffice` — статус ставит УГНС контрагента (метка «по УГНС» в окне «Льготы и особые статусы»). */
  benefits: {
    code: string;
    name: string;
    validFrom: IsoDate | null;
    validTo: IsoDate | null;
    byOffice: boolean;
  }[];
  bases: { code: string; name: string }[];
  responsible: { id: string; shortName: string; active: boolean } | null;
  head: string;
  contact: string;
  contractNo: string;
  contractDate: IsoDate | null;
  note: string;
  registration: ContractorRegistration;
  startDate: IsoDate;
  firstMonthMode: FirstMonthMode;
  feeDay: number;
  paysTo: 'emp' | 'org';
  serviceStatus: ServiceStatus;
  /** Действующая ставка обслуживания (последняя с месяцем не позже текущего); null — нет. */
  tariff: { amount: number; period: TariffPeriod; validFrom: IsoDate } | null;
  gkedConfirmation: (ContractorGkedConfirmation & { by: string }) | null;
  audit: AuditRecord;
  version: number;
}

/** Строка списка контрагентов. */
export interface ContractorRow {
  id: string;
  name: string;
  inn: string;
  phone: string;
  phoneText: string;
  kind: ContractorKind;
  form: string;
  regime: string | null;
  regime2: string | null;
  benefits: string | null;
  gked: { code: string; name: string } | null;
  gkedExtra: string | null;
  taxOffice: string | null;
  serviceStatus: ServiceStatus;
  responsible: { id: string; shortName: string } | null;
  startDate: IsoDate;
  contractNo: string;
  contractDate: IsoDate | null;
  head: string;
  contact: string;
  tariff: { amount: number; period: TariffPeriod } | null;
  audit: AuditRecord;
  version: number;
}

const regime1 = alias(taxRegimes, 'regime1');
const regime2 = alias(taxRegimes, 'regime2');
const responsible = alias(employees, 'responsible');
const creator = alias(employees, 'cp_creator');
const updater = alias(employees, 'cp_updater');

/**
 * Область «Свои контрагенты»: только закреплённые за сотрудником; null — «Все контрагенты» (вся
 * организация, её отсекает RLS).
 */
export function contractorScope(ownEmployeeId: string | null): SQL | undefined {
  return ownEmployeeId ? eq(contractors.responsibleEmployeeId, ownEmployeeId) : undefined;
}

/** Действующая ставка: последняя запись журнала с месяцем не позже месяца `today`. */
function tariffOf(today: IsoDate, field: 'amount' | 'period') {
  const column = field === 'amount' ? contractorTariffs.amount : contractorTariffs.period;
  return sql`(select ${column} from ${contractorTariffs} where ${contractorTariffs.contractorId} = ${contractors.id} and ${contractorTariffs.validFrom} <= date_trunc('month', ${today}::date)::date order by ${contractorTariffs.validFrom} desc, ${contractorTariffs.createdAt} desc limit 1)`;
}

const BENEFIT_NAMES = sql<
  string | null
>`(select string_agg(${taxBenefits.name}, ', ' order by ${taxBenefits.sortOrder}) from ${contractorBenefits} join ${taxBenefits} on ${taxBenefits.code} = ${contractorBenefits.benefitCode} where ${contractorBenefits.contractorId} = ${contractors.id})`;

const GKED_EXTRA_CODES = sql<
  string | null
>`(select string_agg(${contractorGkedExtra.gked}, ', ' order by ${contractorGkedExtra.sortOrder}) from ${contractorGkedExtra} where ${contractorGkedExtra.contractorId} = ${contractors.id})`;

/** «020 · Октябрьский» — код ГНС и краткое название (прототип ugnsLabel). */
const TAX_OFFICE_LABEL = sql<
  string | null
>`case when ${taxOffices.code} is null then null else coalesce(${taxOffices.gnsCode} || ' · ', '') || ${taxOffices.shortName} end`;

function rowFields(today: IsoDate) {
  return {
    id: contractors.id,
    name: contractors.name,
    inn: contractors.inn,
    phone: contractors.phone,
    kind: contractors.kind,
    form: ownershipForms.name,
    regime: regime1.name,
    regime2: regime2.name,
    benefits: BENEFIT_NAMES,
    gked: contractors.gked,
    gkedName: gkedItems.name,
    gkedExtra: GKED_EXTRA_CODES,
    taxOffice: TAX_OFFICE_LABEL,
    serviceStatus: contractors.serviceStatus,
    responsibleId: contractors.responsibleEmployeeId,
    responsibleName: responsible.shortName,
    startDate: contractors.startDate,
    contractNo: contractors.contractNo,
    contractDate: contractors.contractDate,
    head: contractors.head,
    contact: contractors.contact,
    tariffAmount: sql<number | null>`${tariffOf(today, 'amount')}`.mapWith((v) =>
      v == null ? null : Number(v),
    ),
    tariffPeriod: sql<TariffPeriod | null>`${tariffOf(today, 'period')}`,
    createdAt: contractors.createdAt,
    createdBy: contractors.createdBy,
    createdByName: creator.shortName,
    updatedAt: contractors.updatedAt,
    updatedBy: contractors.updatedBy,
    updatedByName: updater.shortName,
    version: contractors.version,
  };
}

/** Контрагенты со справочными названиями, ответственным и именами «Создал» и «Изменил». */
function fromContractors(tx: Tx, fields: object) {
  return tx
    .select(fields as Record<string, SQL>)
    .from(contractors)
    .innerJoin(ownershipForms, eq(ownershipForms.code, contractors.formCode))
    .leftJoin(regime1, eq(regime1.code, contractors.regimeCode))
    .leftJoin(regime2, eq(regime2.code, contractors.regime2Code))
    .leftJoin(gkedItems, eq(gkedItems.code, contractors.gked))
    .leftJoin(taxOffices, eq(taxOffices.code, contractors.taxOfficeCode))
    .leftJoin(responsible, eq(responsible.id, contractors.responsibleEmployeeId))
    .leftJoin(creator, eq(creator.userId, contractors.createdBy))
    .leftJoin(updater, eq(updater.userId, contractors.updatedBy))
    .$dynamic();
}

const contractorListFrom =
  (tx: Tx): ListFrom =>
  (fields) =>
    fromContractors(tx, fields);

type RowData = Record<keyof ReturnType<typeof rowFields>, unknown>;

type PhoneCodes = Awaited<ReturnType<typeof phoneCodes>>;

function auditOf(r: RowData): AuditRecord {
  return {
    createdAt: r.createdAt as Date,
    createdBy: auditActorName(r.createdBy as string | null, r.createdByName as string | null),
    updatedAt: r.updatedAt as Date,
    updatedBy: auditActorName(r.updatedBy as string | null, r.updatedByName as string | null),
  };
}

function toRow(r: RowData, codes: PhoneCodes): ContractorRow {
  const gked = r.gked as string | null;
  const responsibleId = r.responsibleId as string | null;
  return {
    id: r.id as string,
    name: r.name as string,
    inn: r.inn as string,
    phone: r.phone as string,
    phoneText: formatPhone(r.phone as string, codes),
    kind: r.kind as ContractorKind,
    form: r.form as string,
    regime: r.regime as string | null,
    regime2: r.regime2 as string | null,
    benefits: r.benefits as string | null,
    gked: gked ? { code: gked, name: (r.gkedName as string | null) ?? '' } : null,
    gkedExtra: r.gkedExtra as string | null,
    taxOffice: r.taxOffice as string | null,
    serviceStatus: r.serviceStatus as ServiceStatus,
    responsible: responsibleId
      ? { id: responsibleId, shortName: (r.responsibleName as string | null) ?? '' }
      : null,
    startDate: r.startDate as IsoDate,
    contractNo: r.contractNo as string,
    contractDate: r.contractDate as IsoDate | null,
    head: r.head as string,
    contact: r.contact as string,
    tariff:
      r.tariffAmount == null
        ? null
        : { amount: Number(r.tariffAmount), period: r.tariffPeriod as TariffPeriod },
    audit: auditOf(r),
    version: r.version as number,
  };
}

/** Порядок статусов обслуживания в сортировке: по шагам шкалы. */
const SERVICE_ORDER = sql`case ${contractors.serviceStatus} when 'active' then 0 when 'paused' then 1 else 2 end`;

const CREATED_BY = auditActorValue(contractors.createdBy, creator.shortName);

/** Договор, как на экране: «№ 160/24 от 16.07.2024», «Без номера от …» или только номер. */
function contractText(t: ListTexts): SQL {
  const date = sql`to_char(${contractors.contractDate}, 'DD.MM.YYYY')`;
  return sql`case when ${contractors.contractNo} = '' and ${contractors.contractDate} is null then null when ${contractors.contractDate} is null then '№ ' || ${contractors.contractNo} when ${contractors.contractNo} = '' then replace(${t('cp.contract.no_number')}, '{date}', ${date}) else replace(replace(${t('cp.contract')}, '{no}', ${contractors.contractNo}), '{date}', ${date}) end`;
}

/**
 * Столбцы списка контрагентов на сервере (ТЗ «Список контрагентов»; прототип modules/contractors.js,
 * cpCols): ключи — как у столбцов экрана. Справочные значения фильтруются по коду, а сортируются и
 * ищутся по названию; ответственный — по сотруднику. «Стоимость обслуживания» — только с правом «Видеть
 * плату за обслуживание» (`fee`). Просрочено, видов отчётов, тариф Соцфонда, деньги и долг добавят их
 * задачи (2.06, 2.08, поток В).
 */
export function contractorListColumns(
  t: ListTexts,
  options: { today: IsoDate; fee: boolean },
): ListColumns {
  const columns: Record<string, ListColumns[string]> = {
    name: { type: 'text', label: 'cp.col.name', value: contractors.name },
    inn: { type: 'text', label: 'cp.col.inn', value: contractors.inn, compact: true },
    phone: { type: 'text', label: 'cp.col.phone', value: contractors.phone, compact: true },
    form: {
      type: 'enum',
      label: 'cp.col.form',
      value: contractors.formCode,
      display: ownershipForms.name,
      sort: { value: ownershipForms.name, text: true },
    },
    regime: {
      type: 'enum',
      label: 'cp.col.regime',
      value: contractors.regimeCode,
      display: regime1.name,
      sort: { value: regime1.name, text: true },
    },
    regime2: {
      type: 'enum',
      label: 'cp.col.regime2',
      value: contractors.regime2Code,
      display: regime2.name,
      sort: { value: regime2.name, text: true },
    },
    benefits: { type: 'text', label: 'cp.col.benefits', value: BENEFIT_NAMES },
    gked: {
      type: 'text',
      label: 'cp.col.gked',
      value: sql`case when ${contractors.gked} is null then null else ${contractors.gked} || ' ' || coalesce(${gkedItems.name}, '') end`,
    },
    gkedExtra: { type: 'text', label: 'cp.col.gked_extra', value: GKED_EXTRA_CODES },
    gkedSet: {
      type: 'enum',
      label: 'cp.col.gked_set',
      value: sql`case when ${contractors.gked} is null then 'no' else 'yes' end`,
      display: sql`case when ${contractors.gked} is null then ${t('cp.no')} else ${t('cp.yes')} end`,
    },
    taxOffice: {
      type: 'enum',
      label: 'cp.col.tax_office',
      value: contractors.taxOfficeCode,
      display: TAX_OFFICE_LABEL,
      sort: { value: TAX_OFFICE_LABEL, text: true },
    },
    kind: {
      type: 'enum',
      label: 'cp.col.kind',
      value: contractors.kind,
      display: sql`case when ${contractors.kind} = 'oneoff' then ${t('cp.kind.oneoff')} else ${t('cp.kind.regular')} end`,
    },
    service: {
      type: 'enum',
      label: 'cp.col.service',
      value: contractors.serviceStatus,
      display: sql`case ${contractors.serviceStatus} when 'active' then ${t('status.service.active')} when 'paused' then ${t('status.service.paused')} else ${t('status.service.archived')} end`,
      sort: { value: SERVICE_ORDER, text: false },
    },
    responsible: {
      type: 'enum',
      label: 'cp.col.responsible',
      value: contractors.responsibleEmployeeId,
      display: responsible.shortName,
      sort: { value: responsible.shortName, text: true },
    },
    start: { type: 'date', label: 'cp.col.start', value: contractors.startDate },
    contract: {
      type: 'text',
      label: 'cp.col.contract',
      value: contractText(t),
    },
    head: { type: 'text', label: 'cp.col.head', value: contractors.head },
    contact: { type: 'text', label: 'cp.col.contact', value: contractors.contact },
    createdAt: { type: 'datetime', label: 'grid.col.created_at', value: contractors.createdAt },
    updatedAt: { type: 'datetime', label: 'grid.col.updated_at', value: contractors.updatedAt },
    createdBy: { type: 'enum', label: 'grid.col.created_by', value: CREATED_BY },
    updatedBy: {
      type: 'enum',
      label: 'grid.col.updated_by',
      value: sql`coalesce(${auditActorValue(contractors.updatedBy, updater.shortName)}, ${CREATED_BY})`,
    },
  };
  if (options.fee) {
    columns.fee = {
      type: 'money',
      label: 'cp.col.fee',
      value: tariffOf(options.today, 'amount'),
    };
  }
  return columns;
}

/** Вкладки модуля (прототип cpsTabs): все контрагенты в области и закреплённые за собой. */
export const CONTRACTOR_TABS = ['all', 'mine'] as const;
export type ContractorTab = (typeof CONTRACTOR_TABS)[number];

export interface ContractorListOptions {
  t: ListTexts;
  today: IsoDate;
  /** Право «Видеть плату за обслуживание»: столбец «Стоимость обслуживания». */
  fee: boolean;
  /** Область «Свои контрагенты» (`contractorScope`). */
  scope: SQL | undefined;
  tab: ContractorTab;
  /** Сотрудник, который смотрит: вкладка «Мои контрагенты». */
  employeeId: string;
}

/**
 * Условие списка: область, вкладка и архив. Архивные в списке не видны, пока фильтр «Статус
 * обслуживания» их не покажет (прототип renderCps: плашка «В архиве» ставит этот фильтр).
 */
function listScope(query: Pick<ListQuery, 'filters'>, o: ContractorListOptions): SQL | undefined {
  const parts: (SQL | undefined)[] = [o.scope];
  if (o.tab === 'mine') parts.push(eq(contractors.responsibleEmployeeId, o.employeeId));
  if (!Object.hasOwn(query.filters, 'service'))
    parts.push(ne(contractors.serviceStatus, 'archived'));
  return and(...parts);
}

const CONTRACTOR_NATURAL = [contractors.createdAt, contractors.id];
const DEFAULT_SORT = { key: 'name', dir: 'asc' } as const;

/**
 * Страница списка контрагентов: сортировка, страница, фильтры, поиск и группы — на сервере; по
 * умолчанию — по названию (прототип: sort name).
 */
export async function listContractorsPage(
  tx: Tx,
  query: ListQuery,
  o: ContractorListOptions,
): Promise<ListPageResult<ContractorRow>> {
  const fields = rowFields(o.today);
  const page = await selectListPage({
    query,
    columns: contractorListColumns(o.t, o),
    natural: CONTRACTOR_NATURAL,
    defaultSort: DEFAULT_SORT,
    scope: listScope(query, o),
    select: ({ window, where, orderBy, limit, offset }) =>
      fromContractors(tx, { ...fields, ...window } as typeof fields & ListWindowFields)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset) as unknown as Promise<
        (RowData & {
          listTotal: number;
          listTotals: Record<string, number> | null;
          listGroups: string[] | null;
        })[]
      >,
    from: contractorListFrom(tx),
  });
  const codes = await phoneCodes(tx);
  return { ...page, rows: page.rows.map((r) => toRow(r as RowData, codes)) };
}

/** Значения столбца для фильтра-галочек — в той же области и вкладке. */
export function listContractorValues(
  tx: Tx,
  key: string,
  o: ContractorListOptions,
  query: Pick<ListQuery, 'filters'>,
  q?: string,
) {
  return selectListValues({
    columns: contractorListColumns(o.t, o),
    key,
    scope: listScope(query, o),
    from: contractorListFrom(tx),
    q,
  });
}

/** Контрагенты для выгрузки в Excel: все под поиском и фильтрами; телефон — по маске, как на экране. */
export async function exportContractors(
  tx: Tx,
  query: ListQuery,
  keys: readonly string[],
  o: ContractorListOptions,
) {
  const result = await selectListExport({
    query,
    columns: contractorListColumns(o.t, o),
    keys,
    natural: CONTRACTOR_NATURAL,
    defaultSort: DEFAULT_SORT,
    scope: listScope(query, o),
    from: contractorListFrom(tx),
  });
  const phone = keys.indexOf('phone');
  if (phone < 0) return result;
  const codes = await phoneCodes(tx);
  const rows = result.rows.map((row): ExportCell[] =>
    row.map((cell, i) =>
      i === phone && typeof cell === 'string' ? formatPhone(cell, codes) : cell,
    ),
  );
  return { ...result, rows };
}

/** Счётчики вкладок (прототип cpsTabs): «Все» — в области, «Мои контрагенты» — свои; без архива. */
export async function contractorTabCounts(
  tx: Tx,
  scope: SQL | undefined,
  employeeId: string,
): Promise<{ all: number; mine: number }> {
  const live = ne(contractors.serviceStatus, 'archived');
  const [all] = await tx.select({ n: count() }).from(contractors).where(and(live, scope));
  const [mine] = await tx
    .select({ n: count() })
    .from(contractors)
    .where(and(live, eq(contractors.responsibleEmployeeId, employeeId)));
  return { all: Number(all?.n ?? 0), mine: Number(mine?.n ?? 0) };
}

/** Карточка контрагента; null — нет такого в организации или он вне области. */
export async function getContractor(
  tx: Tx,
  id: string,
  options: { scope: SQL | undefined; today: IsoDate },
): Promise<ContractorRecord | null> {
  if (!UUID_RE.test(id)) return null;
  const [row] = await fromContractors(tx, {
    ...rowFields(options.today),
    formCode: contractors.formCode,
    declarationFor: ownershipForms.declarationFor,
    regimeCode: contractors.regimeCode,
    regime2Code: contractors.regime2Code,
    taxOfficeCode: contractors.taxOfficeCode,
    bizSize: contractors.bizSize,
    responsibleActive: responsible.active,
    note: contractors.note,
    registration: contractors.registration,
    firstMonthMode: contractors.firstMonthMode,
    feeDay: contractors.feeDay,
    paysTo: contractors.paysTo,
    gkedConfirmation: contractors.gkedConfirmation,
    tariffFrom: sql<
      string | null
    >`(select ${contractorTariffs.validFrom}::text from ${contractorTariffs} where ${contractorTariffs.contractorId} = ${contractors.id} and ${contractorTariffs.validFrom} <= date_trunc('month', ${options.today}::date)::date order by ${contractorTariffs.validFrom} desc, ${contractorTariffs.createdAt} desc limit 1)`,
  }).where(and(eq(contractors.id, id), options.scope));
  if (!row) return null;
  const r = row as RowData & Record<string, unknown>;
  const [extra, benefits, bases, codes] = await Promise.all([
    tx
      .select({ code: contractorGkedExtra.gked, name: gkedItems.name })
      .from(contractorGkedExtra)
      .innerJoin(gkedItems, eq(gkedItems.code, contractorGkedExtra.gked))
      .where(eq(contractorGkedExtra.contractorId, id))
      .orderBy(asc(contractorGkedExtra.sortOrder)),
    tx
      .select({
        code: contractorBenefits.benefitCode,
        name: taxBenefits.name,
        validFrom: contractorBenefits.validFrom,
        validTo: contractorBenefits.validTo,
        byOffice: sql<boolean>`exists (select 1 from ${taxBenefitOffices} where ${taxBenefitOffices.benefitCode} = ${contractorBenefits.benefitCode} and ${taxBenefitOffices.taxOfficeCode} = ${(r.taxOfficeCode as string | null) ?? null})`,
      })
      .from(contractorBenefits)
      .innerJoin(taxBenefits, eq(taxBenefits.code, contractorBenefits.benefitCode))
      .where(eq(contractorBenefits.contractorId, id))
      .orderBy(asc(taxBenefits.sortOrder)),
    tx
      .select({ code: contractorBases.baseCode, name: reportBases.name })
      .from(contractorBases)
      .innerJoin(reportBases, eq(reportBases.code, contractorBases.baseCode))
      .where(eq(contractorBases.contractorId, id))
      .orderBy(asc(reportBases.sortOrder)),
    phoneCodes(tx),
  ]);
  const confirmation = r.gkedConfirmation as ContractorGkedConfirmation | null;
  let by = '';
  if (confirmation) {
    const [who] = await tx
      .select({ shortName: employees.shortName })
      .from(employees)
      .where(eq(employees.id, confirmation.employeeId));
    by = who?.shortName ?? '';
  }
  const base = toRow(r, codes);
  return {
    id: base.id,
    name: base.name,
    inn: base.inn,
    phone: base.phone,
    phoneText: base.phoneText,
    kind: base.kind,
    form: {
      code: r.formCode as string,
      name: base.form,
      declarationFor: r.declarationFor as 'org' | 'ip',
    },
    regime: r.regimeCode ? { code: r.regimeCode as string, name: base.regime ?? '' } : null,
    regime2: r.regime2Code ? { code: r.regime2Code as string, name: base.regime2 ?? '' } : null,
    gked: base.gked,
    gkedExtra: extra,
    taxOffice: r.taxOfficeCode
      ? { code: r.taxOfficeCode as string, name: base.taxOffice ?? '' }
      : null,
    bizSize: r.bizSize as BizSize,
    benefits,
    bases,
    responsible: base.responsible && {
      ...base.responsible,
      active: (r.responsibleActive as boolean | null) ?? false,
    },
    head: base.head,
    contact: base.contact,
    contractNo: base.contractNo,
    contractDate: base.contractDate,
    note: r.note as string,
    registration: r.registration as ContractorRegistration,
    startDate: base.startDate,
    firstMonthMode: r.firstMonthMode as FirstMonthMode,
    feeDay: r.feeDay as number,
    paysTo: r.paysTo as 'emp' | 'org',
    serviceStatus: base.serviceStatus,
    tariff: base.tariff && { ...base.tariff, validFrom: r.tariffFrom as IsoDate },
    gkedConfirmation: confirmation && { ...confirmation, by },
    audit: base.audit,
    version: base.version,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Контрагент с тем же ИНН среди всех контрагентов организации, включая разовых, приостановленных и
 * архивных (ТЗ «Регистрация контрагентов»); `exceptId` — сам изменяемый. Область не учитывается:
 * дубль ищется по всей организации.
 */
export async function findContractorByInn(
  tx: Tx,
  inn: string,
  exceptId?: string,
): Promise<{
  id: string;
  name: string;
  archived: boolean;
  responsibleEmployeeId: string | null;
} | null> {
  const [row] = await tx
    .select({
      id: contractors.id,
      name: contractors.name,
      status: contractors.serviceStatus,
      responsibleEmployeeId: contractors.responsibleEmployeeId,
    })
    .from(contractors)
    .where(and(eq(contractors.inn, inn), exceptId ? ne(contractors.id, exceptId) : undefined));
  return row
    ? {
        id: row.id,
        name: row.name,
        archived: row.status === 'archived',
        responsibleEmployeeId: row.responsibleEmployeeId,
      }
    : null;
}

/** Строка контрагента для решения о правке; блокируется до конца транзакции. */
export async function lockContractor(
  tx: Tx,
  id: string,
  scope: SQL | undefined,
): Promise<typeof contractors.$inferSelect | null> {
  if (!UUID_RE.test(id)) return null;
  const [row] = await tx
    .select()
    .from(contractors)
    .where(and(eq(contractors.id, id), scope))
    .for('update');
  return row ?? null;
}

/** Набор дочерних записей формы. */
async function childrenOf(tx: Tx, id: string) {
  const [extra, benefits, bases] = await Promise.all([
    tx
      .select({ gked: contractorGkedExtra.gked })
      .from(contractorGkedExtra)
      .where(eq(contractorGkedExtra.contractorId, id))
      .orderBy(asc(contractorGkedExtra.sortOrder)),
    tx
      .select({
        code: contractorBenefits.benefitCode,
        validFrom: contractorBenefits.validFrom,
        validTo: contractorBenefits.validTo,
      })
      .from(contractorBenefits)
      .where(eq(contractorBenefits.contractorId, id))
      .orderBy(asc(contractorBenefits.benefitCode)),
    tx
      .select({ code: contractorBases.baseCode })
      .from(contractorBases)
      .where(eq(contractorBases.contractorId, id))
      .orderBy(asc(contractorBases.baseCode)),
  ]);
  return {
    gkedExtra: extra.map((x) => x.gked),
    benefits,
    bases: bases.map((x) => x.code),
  };
}

/** Сохранённые поля контрагента с дочерними записями — для проверки правки и истории. */
export async function readContractorFields(
  tx: Tx,
  row: typeof contractors.$inferSelect,
): Promise<ContractorFields> {
  const children = await childrenOf(tx, row.id);
  return {
    name: row.name,
    inn: row.inn,
    phone: row.phone,
    kind: row.kind,
    formCode: row.formCode,
    regimeCode: row.regimeCode,
    regime2Code: row.regime2Code,
    gked: row.gked,
    gkedExtra: children.gkedExtra,
    taxOfficeCode: row.taxOfficeCode,
    bizSize: row.bizSize,
    benefits: children.benefits,
    bases: children.bases,
    responsibleEmployeeId: row.responsibleEmployeeId,
    head: row.head,
    contact: row.contact,
    contractNo: row.contractNo,
    contractDate: row.contractDate,
    note: row.note,
    registration: row.registration,
    startDate: row.startDate,
    firstMonthMode: row.firstMonthMode,
    feeDay: row.feeDay,
    paysTo: row.paysTo,
    gkedConfirmation: row.gkedConfirmation,
  };
}

const sortedBenefits = (list: ContractorFields['benefits']) =>
  [...list]
    .sort((a, b) => (a.code < b.code ? -1 : 1))
    .map((b) => ({ code: b.code, validFrom: b.validFrom, validTo: b.validTo }));

async function insertChildren(
  tx: Tx,
  orgId: string,
  id: string,
  values: Partial<Pick<ContractorFields, 'gkedExtra' | 'benefits' | 'bases'>>,
) {
  if (values.gkedExtra?.length) {
    await tx
      .insert(contractorGkedExtra)
      .values(
        values.gkedExtra.map((gked, i) => ({ orgId, contractorId: id, gked, sortOrder: i + 1 })),
      );
  }
  if (values.benefits?.length) {
    await tx.insert(contractorBenefits).values(
      values.benefits.map((b) => ({
        orgId,
        contractorId: id,
        benefitCode: b.code,
        validFrom: b.validFrom,
        validTo: b.validTo,
      })),
    );
  }
  if (values.bases?.length) {
    await tx
      .insert(contractorBases)
      .values(values.bases.map((baseCode) => ({ orgId, contractorId: id, baseCode })));
  }
}

const CONTRACTOR_COLUMNS = [
  'name',
  'inn',
  'phone',
  'kind',
  'formCode',
  'regimeCode',
  'regime2Code',
  'gked',
  'taxOfficeCode',
  'bizSize',
  'responsibleEmployeeId',
  'head',
  'contact',
  'contractNo',
  'contractDate',
  'note',
  'registration',
  'startDate',
  'firstMonthMode',
  'feeDay',
  'paysTo',
  'gkedConfirmation',
] as const;

/**
 * Создать контрагента одним целым (ТЗ «Сохранение контрагента — одно целое действие»): контрагент,
 * дополнительные ГКЭД, льготы, основания, первая запись журнала тарифов и история — в одной
 * транзакции; назначения и отчёты добавят задачи 2.06 и 2.07 в эту же транзакцию. Сбой любой вставки
 * откатывает всё.
 */
export async function createContractor(
  tx: Tx,
  orgId: string,
  input: ContractorFields,
  tariff: ContractorTariffInput | null,
  options: { today?: IsoDate } = {},
): Promise<string> {
  const values = Object.fromEntries(CONTRACTOR_COLUMNS.map((k) => [k, input[k]])) as Pick<
    ContractorFields,
    (typeof CONTRACTOR_COLUMNS)[number]
  >;
  // Обслуживание — с месяца начала (прототип addCpDlg: periods; первый период постоянному ставит база,
  // миграция 0055); начало в будущем — «Приостановлен» до него, как cpStatus прототипа.
  const oneOff = input.kind === 'oneoff';
  const periods = initialPeriods(oneOff, input.startDate);
  const month = (options.today ?? bishkekDate(new Date())).slice(0, 7);
  const [row] = await tx
    .insert(contractors)
    .values({
      ...values,
      orgId,
      serviceStatus: serviceState({ archived: false, oneOff, periods }, month),
      createdBy: sql`app.current_user_id()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .returning({ id: contractors.id });
  const id = row!.id;
  await insertChildren(tx, orgId, id, input);
  if (tariff) {
    await tx.insert(contractorTariffs).values({
      orgId,
      contractorId: id,
      amount: tariff.amount,
      period: tariff.period,
      validFrom: tariff.validFrom,
      note: tariff.note,
      createdBy: sql`app.current_user_id()`,
    });
  }
  const changes: HistoryChange[] = [
    ...CONTRACTOR_COLUMNS.filter((k) => k !== 'gkedConfirmation').map((field) => ({
      field,
      to: values[field] as HistoryChange['to'],
    })),
    { field: 'gkedExtra', to: input.gkedExtra },
    { field: 'benefits', to: sortedBenefits(input.benefits) },
    { field: 'bases', to: [...input.bases].sort() },
  ];
  if (tariff) changes.push({ field: 'tariff', to: { ...tariff } });
  if (input.gkedConfirmation) {
    changes.push({ field: 'gkedConfirmation', to: { ...input.gkedConfirmation } });
  }
  await writeHistory(tx, {
    entity: 'contractor',
    entityId: id,
    action: 'create',
    contractorId: id,
    changes: changes.filter((c) => c.to !== '' && c.to !== null && !isEmptyList(c.to)),
  });
  return id;
}

const isEmptyList = (v: unknown) =>
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0);

/**
 * Контрагент для строк ЕНС по умолчанию (прототип enAuto, enPlace): ГКЭД, статусы и место деятельности —
 * город УГНС и юридический адрес. Контрагента уже проверили на область.
 */
export async function singleTaxSubject(tx: Tx, contractorId: string): Promise<SingleTaxSubject> {
  const [[row], extra, benefits] = await Promise.all([
    tx
      .select({
        gked: contractors.gked,
        region: taxOffices.region,
        registration: contractors.registration,
      })
      .from(contractors)
      .leftJoin(taxOffices, eq(taxOffices.code, contractors.taxOfficeCode))
      .where(eq(contractors.id, contractorId)),
    tx
      .select({ code: contractorGkedExtra.gked })
      .from(contractorGkedExtra)
      .where(eq(contractorGkedExtra.contractorId, contractorId))
      .orderBy(asc(contractorGkedExtra.sortOrder)),
    tx
      .select({ code: contractorBenefits.benefitCode })
      .from(contractorBenefits)
      .where(eq(contractorBenefits.contractorId, contractorId)),
  ]);
  if (!row) throw new RecordNotFoundError('contractor', contractorId);
  const address = (row.registration as ContractorRegistration).address ?? '';
  return {
    gked: row.gked,
    gkedExtra: extra.map((x) => x.code),
    benefits: benefits.map((b) => b.code),
    place: [row.region, address].filter(Boolean).join(' '),
  };
}

/** Статусы, которые ставит УГНС («Ставится по УГНС», прототип ugBens): действующие. */
export async function officeBenefits(
  tx: Tx,
  officeCode: string | null,
): Promise<{ code: string; name: string }[]> {
  if (!officeCode) return [];
  return tx
    .select({ code: taxBenefits.code, name: taxBenefits.name })
    .from(taxBenefitOffices)
    .innerJoin(taxBenefits, eq(taxBenefits.code, taxBenefitOffices.benefitCode))
    .where(and(eq(taxBenefitOffices.taxOfficeCode, officeCode), eq(taxBenefits.active, true)))
    .orderBy(asc(taxBenefits.code));
}

/** Уведомления «по УГНС»: шаблоны с `{name}` — название статуса. */
export interface OfficeBenefitTexts {
  marked: string;
  dropped: string;
}

/**
 * Статусы «Ставится по УГНС» при выборе или смене УГНС (ТЗ «Окно «Льготы и особые статусы»»; прототип
 * ugAuto, ugDrop, ugMsg): льготы и статусы контрагента после смены и уведомления «Отмечен статус «…» по
 * УГНС», «Снят статус «…» по УГНС». Новый статус — без дат действия. УГНС не менялось — без изменений.
 */
export async function withOfficeBenefits(
  tx: Tx,
  benefits: ContractorFields['benefits'],
  offices: { from: string | null; to: string | null },
  texts: OfficeBenefitTexts,
): Promise<{ benefits: ContractorFields['benefits']; notes: string[] }> {
  if (offices.from === offices.to) return { benefits, notes: [] };
  const [byOld, byNew] = await Promise.all([
    officeBenefits(tx, offices.from),
    officeBenefits(tx, offices.to),
  ]);
  const { add, drop } = officeBenefitChanges(
    benefits.map((b) => b.code),
    byOld.map((b) => b.code),
    byNew.map((b) => b.code),
  );
  const names = new Map([...byOld, ...byNew].map((b) => [b.code, b.name]));
  const note = (template: string, code: string) => template.replace('{name}', names.get(code)!);
  return {
    benefits: [
      ...benefits.filter((b) => !drop.includes(b.code)),
      ...add.map((code) => ({ code, validFrom: null, validTo: null })),
    ],
    notes: [
      ...add.map((code) => note(texts.marked, code)),
      ...drop.map((code) => note(texts.dropped, code)),
    ],
  };
}

/** Уведомления «по УГНС» — отдельными записями истории контрагента (прототип log у ugApply). */
export async function writeContractorNotes(
  tx: Tx,
  contractorId: string,
  notes: readonly string[],
): Promise<void> {
  await writeHistory(
    tx,
    ...notes.map((reason) => ({
      entity: 'contractor' as const,
      entityId: contractorId,
      action: 'update' as const,
      reason,
      contractorId,
    })),
  );
}

/**
 * Изменить контрагента («Изменить» в карточке): поля, дополнительные ГКЭД, льготы и основания — с
 * защитой от одновременной правки и историей «было → стало» в той же транзакции. Устаревшая версия —
 * `RecordChangedError`, вне области — `RecordNotFoundError`. С `redue` сменившиеся статусы пересчитывают
 * сроки несданных отчётов.
 */
export async function updateContractor(
  tx: Tx,
  orgId: string,
  id: string,
  version: number,
  patch: Partial<ContractorFields>,
  scope: SQL | undefined,
  redue?: { today: IsoDate; texts: RedueTexts },
): Promise<void> {
  const current = await lockContractor(tx, id, scope);
  if (!current) throw new RecordNotFoundError('contractor', id);
  const fields = Object.fromEntries(
    CONTRACTOR_COLUMNS.filter((k) => patch[k] !== undefined).map((k) => [k, patch[k]]),
  );
  const changes: HistoryChange[] = [];
  // Статусы со своим сроком до правки: от них в историю отчёта — «снят статус «…»».
  const was = redue && patch.benefits ? await statusDueRules(tx, [id], redue.today) : null;
  if (current.version === version) {
    const before = await childrenOf(tx, id);
    const replace: Partial<Pick<ContractorFields, 'gkedExtra' | 'benefits' | 'bases'>> = {};
    if (patch.gkedExtra && !sameJson(before.gkedExtra, patch.gkedExtra)) {
      changes.push({ field: 'gkedExtra', from: before.gkedExtra, to: patch.gkedExtra });
      await tx.delete(contractorGkedExtra).where(eq(contractorGkedExtra.contractorId, id));
      replace.gkedExtra = patch.gkedExtra;
    }
    const benefits = patch.benefits && sortedBenefits(patch.benefits);
    if (benefits && !sameJson(before.benefits, benefits)) {
      changes.push({ field: 'benefits', from: before.benefits, to: benefits });
      await tx.delete(contractorBenefits).where(eq(contractorBenefits.contractorId, id));
      replace.benefits = benefits;
    }
    const bases = patch.bases && [...patch.bases].sort();
    if (bases && !sameJson(before.bases, bases)) {
      changes.push({ field: 'bases', from: before.bases, to: bases });
      await tx.delete(contractorBases).where(eq(contractorBases.contractorId, id));
      replace.bases = bases;
    }
    await insertChildren(tx, orgId, id, replace);
  }
  await updateWithHistory(tx, {
    table: contractors,
    entity: 'contractor',
    id,
    version,
    patch: fields,
    changes,
    where: scope,
    contractorId: id,
  });
  // Сменился ответственный — к новому переходят незавершённые отчёты (прототип transferCp).
  const to = patch.responsibleEmployeeId;
  if (to && to !== current.responsibleEmployeeId) {
    await moveUnfinishedReports(tx, [
      { contractorId: id, from: current.responsibleEmployeeId, to },
    ]);
  }
  // Статусы со своим сроком поменялись — сроки несданных пересчитываются (прототип cpRedue).
  if (redue && was && changes.some((c) => c.field === 'benefits')) {
    await redueContractorReports(tx, id, redue.today, { was, texts: redue.texts });
  }
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Назначить ответственного контрагентам (ТЗ «Массовое закрепление»; прототип respDlg и transferCp):
 * каждому — запись истории «Ответственный: было → стало». Тот же ответственный — без изменений. Все
 * контрагенты должны быть в области и не в архиве. Незавершённые отчёты, открытые задачи и деньги
 * переходят вместе с контрагентом — это добавят задачи 2.06, 2.14 и поток В в эту же транзакцию.
 */
export async function assignContractors(
  tx: Tx,
  ids: readonly string[],
  employeeId: string,
  scope: SQL | undefined,
): Promise<{ changed: number; archived: string[] }> {
  const wanted = [...new Set(ids)];
  const bad = wanted.find((id) => !UUID_RE.test(id));
  if (bad) throw new RecordNotFoundError('contractor', bad);
  if (wanted.length === 0) return { changed: 0, archived: [] };
  // Все строки — одним запросом и в одном порядке: одновременные назначения не встанут друг другу
  // поперёк.
  const locked = await tx
    .select({
      id: contractors.id,
      responsibleEmployeeId: contractors.responsibleEmployeeId,
      serviceStatus: contractors.serviceStatus,
    })
    .from(contractors)
    .where(and(inArray(contractors.id, wanted), scope))
    .orderBy(asc(contractors.id))
    .for('update');
  if (locked.length !== wanted.length) {
    const found = new Set(locked.map((r) => r.id));
    throw new RecordNotFoundError(
      'contractor',
      wanted.find((id) => !found.has(id))!,
    );
  }
  const archived = locked.filter((r) => r.serviceStatus === 'archived').map((r) => r.id);
  if (archived.length) return { changed: 0, archived };
  const moving = locked.filter((r) => r.responsibleEmployeeId !== employeeId);
  if (moving.length === 0) return { changed: 0, archived: [] };
  await tx
    .update(contractors)
    .set({
      responsibleEmployeeId: employeeId,
      version: sql`${contractors.version} + 1`,
      updatedAt: sql`now()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .where(
      inArray(
        contractors.id,
        moving.map((r) => r.id),
      ),
    );
  await writeHistory(
    tx,
    ...moving.map((r) => ({
      entity: 'contractor' as const,
      entityId: r.id,
      action: 'update' as const,
      changes: [{ field: 'responsibleEmployeeId', from: r.responsibleEmployeeId, to: employeeId }],
      contractorId: r.id,
    })),
  );
  await moveUnfinishedReports(
    tx,
    moving.map((r) => ({ contractorId: r.id, from: r.responsibleEmployeeId, to: employeeId })),
  );
  // Открытые задачи по контрагенту у прежнего ответственного переходят к новому (прототип `transferCp`).
  await moveContractorTasks(
    tx,
    moving.map((r) => ({ contractorId: r.id, from: r.responsibleEmployeeId })),
    employeeId,
  );
  return { changed: moving.length, archived: [] };
}

/** Контрагенты сотрудника на обслуживании (не в архиве) — для передачи дел. */
async function employeeContractorIds(tx: Tx, employeeId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: contractors.id })
    .from(contractors)
    .where(
      and(
        eq(contractors.responsibleEmployeeId, employeeId),
        ne(contractors.serviceStatus, 'archived'),
      ),
    );
  return rows.map((r) => r.id);
}

/**
 * Что перейдёт при передаче дел (прототип transferDlg): число контрагентов, открытые задачи по ним,
 * незавершённые отчёты (`unfinishedReportsCount`) и «Кому» по умолчанию — активный сотрудник с ролью
 * из шаблона «Главный бухгалтер», иначе первый активный, кроме самого сотрудника. Деньги добавит их задача.
 */
export async function transferPreview(
  tx: Tx,
  fromEmployeeId: string,
): Promise<{ contractors: number; tasks: number; reports: number; defaultTo: string | null }> {
  const ids = await employeeContractorIds(tx, fromEmployeeId);
  const candidates = await tx
    .select({ id: employees.id, chief: sql<boolean>`${roles.templateCode} = 'chief'` })
    .from(employees)
    .innerJoin(roles, eq(roles.id, employees.roleId))
    .where(and(eq(employees.active, true), ne(employees.id, fromEmployeeId)))
    .orderBy(asc(employees.createdAt), asc(employees.id));
  const to = candidates.find((c) => c.chief) ?? candidates[0];
  return {
    contractors: ids.length,
    tasks: await openTasksOfContractors(tx, ids, fromEmployeeId),
    reports: await unfinishedReportsCount(tx, ids, fromEmployeeId),
    defaultTo: to?.id ?? null,
  };
}

/**
 * Передача дел (ТЗ «Передача дел»): все контрагенты сотрудника на обслуживании переходят к другому —
 * каждый с записью истории. Права «Сотрудники и роли» достаточно, область не сужает.
 */
export async function transferContractors(
  tx: Tx,
  fromEmployeeId: string,
  toEmployeeId: string,
): Promise<number> {
  const ids = await employeeContractorIds(tx, fromEmployeeId);
  const { changed } = await assignContractors(tx, ids, toEmployeeId, undefined);
  return changed;
}

/**
 * Что есть по контрагенту — отчёты, деньги, проекты и услуги: без них его можно удалить (ТЗ
 * «Контрагента нельзя удалить, если по нему есть отчёты»). Деньги и проекты добавят задачи 2.19 и
 * 2.22, 2.16 в эту функцию.
 */
export async function contractorUsage(tx: Tx, id: string): Promise<ContractorUsage> {
  return { reports: await contractorReportCount(tx, id), money: 0, projects: 0 };
}

/**
 * Удалить контрагента вместе с дочерними записями (каскад); история остаётся с записью «удалён»
 * (название и ИНН). Проверку «нет отчётов, денег и проектов» делает вызывающий (`contractorUsage`).
 */
export async function deleteContractor(
  tx: Tx,
  row: Pick<typeof contractors.$inferSelect, 'id' | 'name' | 'inn'>,
): Promise<void> {
  await writeHistory(tx, {
    entity: 'contractor',
    entityId: row.id,
    action: 'delete',
    contractorId: row.id,
    changes: [
      { field: 'name', from: row.name },
      { field: 'inn', from: row.inn },
    ],
  });
  await tx.delete(contractors).where(eq(contractors.id, row.id));
}

/** Сотрудник организации для поля «Ответственный»: активен ли; null — нет такого. */
export async function employeeActive(tx: Tx, id: string): Promise<boolean | null> {
  if (!UUID_RE.test(id)) return null;
  const [row] = await tx
    .select({ active: employees.active })
    .from(employees)
    .where(eq(employees.id, id));
  return row ? row.active : null;
}

/** Значения справочников платформы, на которые ссылается контрагент: есть ли и действует ли. */
export interface ContractorDictValues {
  forms: Map<string, { active: boolean; declarationFor: 'org' | 'ip' }>;
  regimes: Map<string, boolean>;
  benefits: Map<string, boolean>;
  bases: Map<string, boolean>;
  taxOffices: Map<string, boolean>;
  gked: Map<string, { active: boolean; level: string }>;
}

/** Прочитать значения справочников по кодам (для проверки «есть и действует» перед сохранением). */
export async function contractorDictValues(
  tx: Tx,
  codes: {
    forms: string[];
    regimes: string[];
    benefits: string[];
    bases: string[];
    taxOffices: string[];
    gked: string[];
  },
): Promise<ContractorDictValues> {
  const none = (list: string[]) => (list.length ? list : ['']);
  const [forms, regimes, benefits, bases, offices, gked] = await Promise.all([
    tx
      .select({
        code: ownershipForms.code,
        active: ownershipForms.active,
        declarationFor: ownershipForms.declarationFor,
      })
      .from(ownershipForms)
      .where(inArray(ownershipForms.code, none(codes.forms))),
    tx
      .select({ code: taxRegimes.code, active: taxRegimes.active })
      .from(taxRegimes)
      .where(inArray(taxRegimes.code, none(codes.regimes))),
    tx
      .select({ code: taxBenefits.code, active: taxBenefits.active })
      .from(taxBenefits)
      .where(inArray(taxBenefits.code, none(codes.benefits))),
    tx
      .select({ code: reportBases.code, active: reportBases.active })
      .from(reportBases)
      .where(inArray(reportBases.code, none(codes.bases))),
    tx
      .select({ code: taxOffices.code, active: taxOffices.active })
      .from(taxOffices)
      .where(inArray(taxOffices.code, none(codes.taxOffices))),
    tx
      .select({ code: gkedItems.code, active: gkedItems.active, level: gkedItems.level })
      .from(gkedItems)
      .where(inArray(gkedItems.code, none(codes.gked))),
  ]);
  return {
    forms: new Map(
      forms.map((f) => [f.code, { active: f.active, declarationFor: f.declarationFor }]),
    ),
    regimes: new Map(regimes.map((x) => [x.code, x.active])),
    benefits: new Map(benefits.map((x) => [x.code, x.active])),
    bases: new Map(bases.map((x) => [x.code, x.active])),
    taxOffices: new Map(offices.map((x) => [x.code, x.active])),
    gked: new Map(gked.map((x) => [x.code, { active: x.active, level: x.level }])),
  };
}

/**
 * Справочники для сверки с ГКЭД (`gkedCheck`): коды контрагента с их предками (для правил «секция
 * буквой»), режимы, льготы, ставки единого налога, группы кодов и — если переданы — назначенные виды
 * отчётов с их режимами.
 */
export async function contractorGkedDicts(
  tx: Tx,
  codes: readonly string[],
  typeCodes: readonly string[] = [],
): Promise<GkedDicts> {
  const list = codes.length ? [...codes] : [''];
  const up = (await tx.execute(sql`
    with recursive up as (
      select code, level, parent_code, active from ${gkedItems} where code in (${sql.join(
        list.map((c) => sql`${c}`),
        sql`, `,
      )})
      union
      select g.code, g.level, g.parent_code, g.active from ${gkedItems} g join up on g.code = up.parent_code
    ) select code, level, parent_code, active from up
  `)) as unknown as { code: string; level: string; parent_code: string | null; active: boolean }[];
  const [regimes, benefits, rates, groupsRow, types, typeRegimes] = await Promise.all([
    tx
      .select({
        code: taxRegimes.code,
        name: taxRegimes.name,
        article: taxRegimes.article,
        gked: taxRegimes.gked,
      })
      .from(taxRegimes),
    tx
      .select({ code: taxBenefits.code, name: taxBenefits.name, gked: taxBenefits.gked })
      .from(taxBenefits),
    tx
      .select({
        code: singleTaxRates.code,
        rate: singleTaxRates.rate,
        activity: singleTaxRates.activity,
        gked: singleTaxRates.gked,
      })
      .from(singleTaxRates)
      .where(eq(singleTaxRates.active, true))
      .orderBy(asc(singleTaxRates.sortOrder)),
    tx
      .select({ payload: platformReference.payload })
      .from(platformReference)
      .where(eq(platformReference.key, 'gkedGroups')),
    typeCodes.length
      ? tx
          .select({
            code: reportTypes.code,
            shortName: reportTypes.shortName,
            kind: reportTypes.kind,
            gked: reportTypes.gked,
          })
          .from(reportTypes)
          .where(inArray(reportTypes.code, [...typeCodes]))
      : Promise.resolve([]),
    typeCodes.length
      ? tx
          .select({ type: reportTypeRegimes.reportTypeCode, regime: reportTypeRegimes.regimeCode })
          .from(reportTypeRegimes)
          .where(
            and(
              inArray(reportTypeRegimes.reportTypeCode, [...typeCodes]),
              eq(reportTypeRegimes.relation, 'applies'),
            ),
          )
      : Promise.resolve([]),
  ]);
  const groups = Object.entries(
    (groupsRow[0]?.payload ?? {}) as Record<
      string,
      { name?: string; codes?: string[]; ask?: string }
    >,
  ).map(([id, g]) => ({ id, name: g.name ?? '', codes: g.codes ?? [], ask: g.ask ?? '' }));
  return {
    index: new Map(
      up.map((x) => [
        x.code,
        { code: x.code, level: x.level, parent: x.parent_code, active: x.active },
      ]),
    ),
    regimes: regimes.map((r) => ({ ...r, gked: r.gked as GkedRule | null })),
    benefits: benefits.map((b) => ({ ...b, gked: b.gked as GkedRule | null })),
    rates: rates.map((x) => ({ ...x, gked: x.gked as GkedRule | null })),
    types: types.map((x) => ({
      code: x.code,
      shortName: x.shortName,
      kind: x.kind as ReportKind,
      gked: x.gked as GkedRule | null,
      regimes: typeRegimes.filter((r) => r.type === x.code).map((r) => r.regime),
    })),
    groups,
  };
}
