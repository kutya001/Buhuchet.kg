import {
  auditActorName,
  monthLabel,
  type IsoDate,
  type ListQuery,
  type MoneyHolderKind,
  type Tyiyn,
  type YearMonth,
} from '@buhuchet/domain';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Tx } from './client';
import { writeHistory } from './history';
import {
  auditActorValue,
  moneyText,
  selectListExport,
  selectListPage,
  selectListValues,
  somUnitText,
  type ListColumns,
  type ListFrom,
  type ListPageResult,
  type ListTexts,
} from './list';
import {
  closedMonths,
  contractors,
  employees,
  feeAllocations,
  feePayments,
  files,
  moneyAllocations,
  moneyOperations,
  reports,
  reportTypes,
} from './schema';
import { dictLiteral } from './sql-text';

/*
 * Журнал модуля «Финансовые операции по контрагентам» (задача 2.22; ТЗ «Финансовые операции по
 * контрагентам»: «единый журнал всех денег от контрагентов … это тот же журнал, показанный целиком, а не
 * копия»; прототип modules/finance.js `finRows`, `finCols`, `renderFin`, `renderJournal`, modules/staff.js
 * — вкладка «Списания в бонус»). Строки — операции по счёту контрагента (`money_operations`) и оплаты за
 * обслуживание (`fee_payments`) одним подзапросом `j`; сортировка, фильтры, поиск, группы, итоги и
 * выгрузка — общим механизмом списков. Область «Финансовые операции» и права видимости групп строк
 * передаёт API.
 */

/** Поле подзапроса журнала `j`. */
const j = (name: string) => sql.raw(`"j"."${name}"`);

/**
 * Операции и оплаты за обслуживание одной таблицей: ключ строки (`op:…`, `fee:…`), группа вкладки
 * (`tax` — налоги, `wo` — списания и возвраты, `fee` — обслуживание), удалена ли, изменена ли, счёт.
 * У поступления `amount` — часть на налоги: плата за обслуживание из него — отдельные строки `fee`
 * (ТЗ: «сумма одних и тех же денег не задваивается»).
 */
const JOURNAL = sql`(
  select 'op:' || o.id::text as key, 'op' as src, o.id as ref_id, o.contractor_id, o.kind,
    case when o.kind in ('bonus', 'refund') then 'wo' else 'tax' end as grp,
    o.op_date, o.amount, o.total, o.cancelled_at is not null as deleted, o.edited,
    o.holder_kind, o.holder_employee_id, o.report_id, o.self, o.ref_operation_id,
    null::uuid as receipt_id, o.note, o.created_by, o.created_at, o.updated_by, o.updated_at
  from ${moneyOperations} o
  union all
  select 'fee:' || f.id::text, 'fee', f.id, f.contractor_id, 'fee', 'fee', f.paid_on, f.amount,
    null::bigint, f.deleted_at is not null, f.edited, 'org', null::uuid, null::uuid, false, null::uuid,
    f.operation_id, f.note, f.created_by, f.created_at, f.updated_by, f.updated_at
  from ${feePayments} f
) j`;

/** Счёт операции — сотрудник; внёс операцию — сотрудник по пользователю. */
const jh = alias(employees, 'jh');
const jc = alias(employees, 'jc');
const ju = alias(employees, 'ju');

/**
 * Служебные столбцы «Создал», «Изменил», «Создано», «Изменено» (прототип ui/grid.js `auditCols`):
 * «Изменил» у записи без правок — тот, кто создал.
 */
function journalAudit(): ListColumns {
  const created = auditActorValue(j('created_by'), sql`${jc.shortName}`);
  return {
    createdAt: { type: 'datetime', label: 'grid.col.created_at', value: j('created_at') },
    updatedAt: { type: 'datetime', label: 'grid.col.updated_at', value: j('updated_at') },
    createdBy: { type: 'enum', label: 'grid.col.created_by', value: created },
    updatedBy: {
      type: 'enum',
      label: 'grid.col.updated_by',
      value: sql`coalesce(${auditActorValue(j('updated_by'), sql`${ju.shortName}`)}, ${created})`,
    },
  };
}

/** Названия месяцев словами (прототип `ymLabel`): «октябрь 2026». */
const MONTH_NAMES = Array.from({ length: 12 }, (_, i) =>
  monthLabel(`2000-${String(i + 1).padStart(2, '0')}` as YearMonth).replace(/ 2000$/, ''),
);
const monthText = (d: SQL) =>
  sql`(array[${sql.join(
    MONTH_NAMES.map((m) => dictLiteral(m)),
    sql`, `,
  )}])[extract(month from ${d})::int] || ' ' || extract(year from ${d})::int::text`;

const lit = (t: ListTexts, key: string) => sql`${dictLiteral(t(key))}::text`;

/**
 * Подпись периода отчёта `r` (прототип `plabel`): «10.2026», «III кв. 2026», «I пол. 2026», «2026»,
 * «11.2026 · 05.11» — как `periodLabel` из @buhuchet/domain.
 */
function periodOf(t: ListTexts, r: string): SQL {
  const x = (c: string) => sql.raw(`${r}.${c}`);
  const year = sql`extract(year from ${x('period_start')})::int::text`;
  const month = sql`extract(month from ${x('period_start')})::int`;
  const q = sql`(array['I','II','III','IV'])[extract(quarter from ${x('period_start')})::int]`;
  const h = sql`(array['I','II'])[case when ${month} <= 6 then 1 else 2 end]`;
  return sql`case
    when ${x('event_date')} is not null then to_char(${x('event_date')}, 'MM.YYYY') || ' · ' || to_char(${x('event_date')}, 'DD.MM')
    when ${x('period')} = 'M' then to_char(${x('period_start')}, 'MM.YYYY')
    when ${x('period')} = 'Q' then replace(replace(${lit(t, 'report.period.q_short')}, '{n}', ${q}), '{y}', ${year})
    when ${x('period')} = 'H' then replace(replace(${lit(t, 'report.period.h_short')}, '{n}', ${h}), '{y}', ${year})
    else ${year} end`;
}

/** «НДС 09.2026» отчёта `r` с видом `rt`. */
const reportLabelOf = (t: ListTexts, r: string, rt: string) =>
  sql`${sql.raw(`${rt}.short_name`)} || ' ' || ${periodOf(t, r)}`;

/** Отчёт операции оплаты и возврата по уточнённому: «НДС 09.2026». */
const opReportLabel = (t: ListTexts) =>
  sql`(select ${reportLabelOf(t, 'jr', 'jrt')} from ${reports} jr join ${reportTypes} jrt on jrt.code = jr.report_type_code where jr.id = ${j('report_id')})`;

/** Целые сомы без копеек (прототип `fmtM(x, false)` в `allocText`): «21 490». */
const wholeText = (value: SQL) =>
  sql`regexp_replace(round(abs(${value})::numeric / 100)::bigint::text, '(\\d)(?=(\\d{3})+$)', '\\1' || chr(160), 'g')`;

/** Строки детализации поступления: «НДС 09.2026 — 1 000» через «; » (прототип `allocText`). */
const allocParts = (t: ListTexts) =>
  sql`(select string_agg(${reportLabelOf(t, 'ar', 'art')} || ' — ' || ${wholeText(sql.raw('a.amount'))}, '; ' order by ar.period_start, art.short_name, ar.id) from ${moneyAllocations} a join ${reports} ar on ar.id = a.report_id join ${reportTypes} art on art.code = ar.report_type_code where a.operation_id = ${j('ref_id')})`;

/** Распределено по отчётам из поступления. */
const allocSum = sql`(select coalesce(sum(a.amount), 0)::bigint from ${moneyAllocations} a where a.operation_id = ${j('ref_id')})`;

/** Распределено по месяцам из оплаты за обслуживание. */
const feeAllocSum = sql`(select coalesce(sum(fa.amount), 0)::bigint from ${feeAllocations} fa where fa.payment_id = ${j('ref_id')})`;

/** Месяцы оплаты за обслуживание словами через запятую. */
const feeMonths = sql`(select string_agg(${monthText(sql.raw('fa.month'))}, ', ' order by fa.month) from ${feeAllocations} fa where fa.payment_id = ${j('ref_id')})`;

/** Аванс поступления на налоги: не распределено по отчётам. */
const receiptAdvance = sql`greatest(0, ${j('amount')} - ${allocSum})`;

/**
 * «За что» (прототип finRows, `what`): поступление — детализация без платы или «Аванс» и «ещё … за
 * обслуживание — отдельной строкой» (тому, кто видит плату); оплата налога — отчёт («Оплата контрагентом
 * напрямую · …»); оплата за обслуживание — месяцы или «Аванс за обслуживание» и «из общего поступления»;
 * списание и возврат — причина; перевод — «Со счёта организации на счёт …»; обратная запись — «К
 * поступлению от …: причина»; возврат по уточнённому — «… (версия N)».
 */
function whatOf(t: ListTexts, fee: boolean): SQL {
  const parts = allocParts(t);
  const adv = receiptAdvance;
  const feeTail = fee
    ? sql`case when ${j('total')} > ${j('amount')} then replace(${lit(t, 'fin.j.in_fee')}, '{amount}', ${somUnitText(sql`${j('total')} - ${j('amount')}`)}) else '' end`
    : sql`''`;
  const feeAdv = sql`${j('amount')} - ${feeAllocSum}`;
  const holderName = sql`coalesce(${jh.shortName}, '—')`;
  return sql`case ${j('kind')}
    when 'in' then coalesce(${parts} || case when ${adv} > 0 then '; ' || replace(${lit(t, 'fin.j.in_adv')}, '{amount}', ${wholeText(adv)}) else '' end, ${lit(t, 'money.op.basis_advance')}) || ${feeTail}
    when 'pay' then case when ${j('self')} then replace(${lit(t, 'money.op.basis_self')}, '{report}', coalesce(${opReportLabel(t)}, '—')) else coalesce(${opReportLabel(t)}, '—') end
    when 'back' then coalesce(replace(${lit(t, 'fin.basis.back')}, '{n}', (select jb.revision::text from ${reports} jb where jb.id = ${j('report_id')})), '—')
    when 'xfer' then case when ${j('note')} = '' then replace(${lit(t, 'fin.basis.xfer')}, '{name}', ${holderName}) else regexp_replace(replace(${lit(t, 'fin.basis.xfer')}, '{name}', ${holderName}), '\\.$', '') || '. ' || ${j('note')} end
    when 'corr' then replace(${lit(t, 'fin.basis.corr')}, '{date}', coalesce((select to_char(jo.op_date, 'DD.MM.YYYY') from ${moneyOperations} jo where jo.id = ${j('ref_operation_id')}), '—')) || case when ${j('note')} = '' then '' else ': ' || ${j('note')} end
    when 'fee' then case when ${feeMonths} is null then ${lit(t, 'fin.j.fee_adv')} else replace(${lit(t, 'fin.j.fee_months')}, '{months}', ${feeMonths}) || case when ${feeAdv} > 0 then replace(${lit(t, 'fin.j.fee_more_adv')}, '{amount}', ${somUnitText(feeAdv)}) else '' end end || case when ${j('receipt_id')} is not null then ${lit(t, 'fin.j.from_receipt')} else '' end
    else ${j('note')} end`;
}

/** Вид строки: у «Оплатил контрагент сам» — свой (прототип OP_SELF). */
const CAT = sql<string>`case when ${j('kind')} = 'pay' and ${j('self')} then 'self' else ${j('kind')} end`;

const catLabel = (t: ListTexts) =>
  sql`case ${CAT} when 'self' then ${lit(t, 'money.op.self')} when 'fee' then ${lit(t, 'files.kind.fee_payment')} ${sql.join(
    ['in', 'pay', 'bonus', 'refund', 'back', 'corr', 'xfer'].map(
      (k) => sql` when ${dictLiteral(k)} then ${lit(t, `money.op.${k}`)}`,
    ),
    sql``,
  )} end`;

/** Счёт: организации, «контрагент сам» или сотрудника (прототип `acc`). */
const ACC = sql<string>`case ${j('holder_kind')} when 'org' then 'org' when 'client' then 'client' else ${j('holder_employee_id')}::text end`;

/**
 * Сумма в итогах (прототип finCols, `amount.val`): расход — с минусом; удалённые, переводы и оплаты
 * «контрагент сам» в итоги не входят.
 */
const SIGNED = sql`case when ${j('deleted')} or ${j('kind')} = 'xfer' or ${j('self')} then null when ${j('kind')} in ('pay', 'bonus', 'refund') then -${j('amount')} else ${j('amount')} end`;

/** Файлов у операции: поступление, оплата налога, оплата за обслуживание, остальные операции. */
const FILES = sql<number>`(select count(*)::int from ${files} jf where jf.source_id = ${j('ref_id')} and jf.state = 'ready' and jf.source_kind in ('receipt', 'tax_payment', 'fee_payment', 'money_operation'))`;

/** «Отчёт»: оплата и возврат — свой отчёт, поступление — виды из детализации. */
const repOf = sql`case when ${j('report_id')} is not null then (select jrt.short_name from ${reports} jr join ${reportTypes} jrt on jrt.code = jr.report_type_code where jr.id = ${j('report_id')}) when ${j('kind')} = 'in' then (select string_agg(art.short_name, ', ' order by ar.period_start, art.short_name, ar.id) from ${moneyAllocations} a join ${reports} ar on ar.id = a.report_id join ${reportTypes} art on art.code = ar.report_type_code where a.operation_id = ${j('ref_id')}) end`;

/** «Период»: отчёта операции, периоды детализации поступления, месяцы оплаты за обслуживание. */
const perOf = (t: ListTexts) =>
  sql`case when ${j('report_id')} is not null then (select ${periodOf(t, 'jr')} from ${reports} jr where jr.id = ${j('report_id')}) when ${j('kind')} = 'in' then (select string_agg(distinct ${periodOf(t, 'ar')}, ', ') from ${moneyAllocations} a join ${reports} ar on ar.id = a.report_id where a.operation_id = ${j('ref_id')}) when ${j('kind')} = 'fee' then ${feeMonths} end`;

/** Вкладка журнала (прототип FIN_TABS; «Проекты и услуги» заполнят разовые услуги и проекты). */
export const FIN_JOURNAL_TABS = ['all', 'tax', 'fee', 'proj', 'wo'] as const;
export type FinJournalTab = (typeof FIN_JOURNAL_TABS)[number];

export interface FinJournalOptions {
  tab: FinJournalTab;
  /** «Показать удалённые»: удалённые видны, но в итоги не входят. */
  deleted: boolean;
  /** Налоговые операции (поступления, оплаты, списания, возвраты) видны: «Учёт оплаты налогов» и право. */
  tax: boolean;
  /** Оплаты за обслуживание видны: функция «Плата за обслуживание» и право «Видеть плату». */
  fee: boolean;
  /** Область группы «Финансовые операции» по контрагенту. */
  scope: SQL | undefined;
  t: ListTexts;
}

/**
 * Поступление только за обслуживание (на налоги 0) не видно тому, кто не видит плату (как окно операции,
 * docs/deviations.md п. В-19).
 */
const FEE_ONLY_HIDDEN = sql`not (${j('kind')} = 'in' and ${j('amount')} = 0)`;

/** Строки, которые видит сотрудник на вкладке: группы по правам, удалённые — с фильтром. */
function journalScope(o: FinJournalOptions): SQL {
  const groups = [
    ...(o.tax && (o.tab === 'all' || o.tab === 'tax') ? ['tax'] : []),
    ...(o.tax && (o.tab === 'all' || o.tab === 'wo') ? ['wo'] : []),
    ...(o.fee && (o.tab === 'all' || o.tab === 'fee') ? ['fee'] : []),
  ];
  const grp = groups.length
    ? sql`${j('grp')} in (${sql.join(
        groups.map((g) => dictLiteral(g)),
        sql`, `,
      )})`
    : sql`false`;
  return and(
    grp,
    o.deleted ? undefined : sql`not ${j('deleted')}`,
    o.fee ? undefined : FEE_ONLY_HIDDEN,
    o.scope,
  )!;
}

/** Столбцы журнала (прототип finCols): ключи — как у столбцов экрана. */
export function finJournalColumns(o: Pick<FinJournalOptions, 't' | 'fee'>): ListColumns {
  const { t } = o;
  const created = auditActorValue(j('created_by'), sql`${jc.shortName}`);
  return {
    date: { type: 'date', label: 'fin.j.col.date', value: j('op_date') },
    cp: {
      type: 'enum',
      label: 'fin.j.col.cp',
      value: sql`${contractors.id}::text`,
      display: contractors.name,
      sort: { value: contractors.name, text: true },
    },
    cat: {
      type: 'enum',
      label: 'fin.j.col.cat',
      value: CAT,
      display: catLabel(t),
      sort: { value: catLabel(t), text: true },
    },
    what: { type: 'text', label: 'fin.j.col.what', value: whatOf(t, o.fee) },
    amount: {
      type: 'money',
      label: 'fin.j.col.amount',
      value: SIGNED,
      total: true,
      display: sql`case when ${j('kind')} in ('pay', 'bonus', 'refund') and not ${j('self')} then chr(8722) when ${j('kind')} = 'corr' then case when ${j('amount')} < 0 then chr(8722) else '+' end when ${j('kind')} in ('xfer') or ${j('self')} then '' else '+' end || ${moneyText(sql`abs(${j('amount')})`)}`,
    },
    acc: {
      type: 'enum',
      label: 'fin.j.col.acc',
      value: ACC,
      display: sql`case ${j('holder_kind')} when 'org' then ${lit(t, 'fin.j.acc_org')} when 'client' then ${lit(t, 'fin.j.acc_client')} else coalesce(${jh.shortName}, '—') end`,
    },
    by: { type: 'enum', label: 'fin.j.col.by', value: created },
    files: { type: 'int', label: 'fin.j.col.files', value: FILES },
    rep: { type: 'text', label: 'fin.j.col.rep', value: repOf },
    per: { type: 'text', label: 'fin.j.col.per', value: perOf(t) },
    note: { type: 'text', label: 'fin.j.col.note', value: j('note') },
    ...journalAudit(),
  };
}

/** «Создал», «Изменил», «Создано», «Изменено» строки (прототип ui/grid.js `auditCols`). */
export interface ListRowAudit {
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

const isoOf = (v: unknown) => (v instanceof Date ? v : new Date(String(v))).toISOString();

/** Поля служебных столбцов строки: у записи без правок «Изменил» — тот, кто создал. */
function rowAudit(r: {
  createdAt: unknown;
  updatedAt: unknown;
  createdBy: unknown;
  createdByName: unknown;
  updatedBy: unknown;
  updatedByName: unknown;
}): ListRowAudit {
  const created = auditActorName(r.createdBy as string | null, r.createdByName as string | null);
  return {
    createdAt: isoOf(r.createdAt),
    createdBy: created,
    updatedAt: isoOf(r.updatedAt ?? r.createdAt),
    updatedBy: r.updatedBy
      ? auditActorName(r.updatedBy as string | null, r.updatedByName as string | null)
      : created,
  };
}

/** Журнал с контрагентом, счётом и автором. */
function journalQuery(tx: Tx, fields: Record<string, SQL>) {
  return tx
    .select(fields)
    .from(JOURNAL)
    .innerJoin(contractors, sql`${contractors.id} = ${j('contractor_id')}`)
    .leftJoin(jh, sql`${jh.id} = ${j('holder_employee_id')}`)
    .leftJoin(jc, sql`${jc.userId} = ${j('created_by')}`)
    .leftJoin(ju, sql`${ju.userId} = ${j('updated_by')}`)
    .$dynamic();
}

const journalFrom =
  (tx: Tx): ListFrom =>
  (fields) =>
    journalQuery(tx, fields);

const JOURNAL_NATURAL = [j('op_date'), j('created_at'), j('key')];
const JOURNAL_SORT = { key: 'date', dir: 'desc' } as const;

/** Строка журнала. */
export interface FinJournalRow {
  key: string;
  src: 'op' | 'fee';
  id: string;
  kind: string;
  self: boolean;
  contractor: { id: string; name: string };
  date: IsoDate;
  /** Сумма без знака; знак — по виду (у обратной записи — по `signed`). */
  amount: Tyiyn;
  signed: number;
  what: string;
  deleted: boolean;
  edited: boolean;
  acc: { kind: MoneyHolderKind; name: string | null };
  by: string | null;
  files: number;
  rep: string | null;
  per: string | null;
  note: string;
  /** Оплата за обслуживание — часть общего поступления. */
  receiptPart: boolean;
  /** Контрагент в архиве — для замков меню строки (прототип `opLock`). */
  archived: boolean;
  /** «Открыть источник»: отчёт оплаты налога, общее поступление оплаты за обслуживание. */
  reportId: string | null;
  receipt: { id: string; total: Tyiyn; date: IsoDate } | null;
  audit: ListRowAudit;
}

function journalFields(o: FinJournalOptions) {
  const cols = finJournalColumns(o);
  return {
    key: sql<string>`${j('key')}`,
    src: sql<'op' | 'fee'>`${j('src')}`,
    id: sql<string>`${j('ref_id')}`,
    kind: sql<string>`${j('kind')}`,
    self: sql<boolean>`${j('self')}`,
    contractorId: sql<string>`${contractors.id}`,
    contractorName: sql<string>`${contractors.name}`,
    date: sql<string>`${j('op_date')}::text`,
    amount: sql<string>`${j('amount')}::text`,
    what: sql<string>`${cols.what!.value}`,
    deleted: sql<boolean>`${j('deleted')}`,
    edited: sql<boolean>`${j('edited')}`,
    holderKind: sql<MoneyHolderKind>`${j('holder_kind')}`,
    holderName: sql<string | null>`${jh.shortName}`,
    createdBy: sql<string | null>`${j('created_by')}`,
    createdByName: sql<string | null>`${jc.shortName}`,
    createdAt: sql<string>`to_json(${j('created_at')}) #>> '{}'`,
    updatedAt: sql<string | null>`to_json(${j('updated_at')}) #>> '{}'`,
    updatedBy: sql<string | null>`${j('updated_by')}`,
    updatedByName: sql<string | null>`${ju.shortName}`,
    files: FILES,
    rep: sql<string | null>`${repOf}`,
    per: sql<string | null>`${perOf(o.t)}`,
    note: sql<string>`${j('note')}`,
    receiptPart: sql<boolean>`${j('receipt_id')} is not null`,
    archived: sql<boolean>`${contractors.serviceStatus} = 'archived'`,
    reportId: sql<string | null>`${j('report_id')}`,
    receiptId: sql<string | null>`${j('receipt_id')}`,
    receiptTotal: sql<
      string | null
    >`(select coalesce(r.total, r.amount)::text from ${moneyOperations} r where r.id = ${j('receipt_id')})`,
    receiptDate: sql<
      string | null
    >`(select r.op_date::text from ${moneyOperations} r where r.id = ${j('receipt_id')})`,
  };
}

type JournalData = { [K in keyof ReturnType<typeof journalFields>]: unknown };

function toJournalRow(r: JournalData): FinJournalRow {
  const amount = Number(r.amount);
  const kind = r.kind as string;
  return {
    key: r.key as string,
    src: r.src as 'op' | 'fee',
    id: r.id as string,
    kind,
    self: Boolean(r.self),
    contractor: { id: r.contractorId as string, name: r.contractorName as string },
    date: r.date as IsoDate,
    amount: Math.abs(amount),
    signed: kind === 'pay' || kind === 'bonus' || kind === 'refund' ? -Math.abs(amount) : amount,
    what: (r.what as string | null) ?? '',
    deleted: Boolean(r.deleted),
    edited: Boolean(r.edited),
    acc: {
      kind: r.holderKind as MoneyHolderKind,
      name: (r.holderName as string | null) ?? null,
    },
    by: auditActorName(r.createdBy as string | null, r.createdByName as string | null),
    files: Number(r.files ?? 0),
    rep: (r.rep as string | null) ?? null,
    per: (r.per as string | null) ?? null,
    note: (r.note as string | null) ?? '',
    receiptPart: Boolean(r.receiptPart),
    archived: Boolean(r.archived),
    reportId: (r.reportId as string | null) ?? null,
    receipt: r.receiptId
      ? {
          id: r.receiptId as string,
          total: Number(r.receiptTotal ?? 0),
          date: r.receiptDate as IsoDate,
        }
      : null,
    audit: rowAudit(r),
  };
}

/** Страница журнала: сортировка, страница, фильтры, поиск, группы и итоги — на сервере. */
export async function listFinJournalPage(
  tx: Tx,
  query: ListQuery,
  o: FinJournalOptions,
): Promise<ListPageResult<FinJournalRow>> {
  const fields = journalFields(o);
  const from = journalFrom(tx);
  const page = await selectListPage({
    query,
    columns: finJournalColumns(o),
    natural: JOURNAL_NATURAL,
    defaultSort: JOURNAL_SORT,
    scope: journalScope(o),
    select: ({ window, where, orderBy, limit, offset }) =>
      journalQuery(tx, { ...fields, ...window } as unknown as Record<string, SQL>)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset) as unknown as Promise<
        (JournalData & {
          listTotal: number;
          listTotals: Record<string, number> | null;
          listGroups: string[] | null;
        })[]
      >,
    from,
  });
  return { ...page, rows: page.rows.map((r) => toJournalRow(r as JournalData)) };
}

/** Значения столбца журнала для фильтра-галочек. */
export function listFinJournalValues(tx: Tx, key: string, o: FinJournalOptions, q?: string) {
  return selectListValues({
    columns: finJournalColumns(o),
    key,
    scope: journalScope(o),
    from: journalFrom(tx),
    q,
  });
}

/** Журнал для выгрузки в Excel: все записи под поиском и фильтрами. */
export function exportFinJournal(
  tx: Tx,
  query: ListQuery,
  keys: readonly string[],
  o: FinJournalOptions,
) {
  return selectListExport({
    query,
    columns: finJournalColumns(o),
    keys,
    natural: JOURNAL_NATURAL,
    defaultSort: JOURNAL_SORT,
    scope: journalScope(o),
    from: journalFrom(tx),
  });
}

/* ───────────── «Журнал поступлений» ───────────── */

/** Деньги контрагента на счетах (прототип `c.avail`) — для «Изменение» поступления. */
const AVAIL = sql`(select coalesce(sum(case when ao.kind in ('in', 'back', 'corr') then ao.amount else -ao.amount end) filter (where ao.kind <> 'xfer' and not ao.self), 0)::bigint from ${moneyOperations} ao where ao.contractor_id = ${j('contractor_id')} and ao.cancelled_at is null)`;

/** Сколько из поступления уже потрачено на налоги (прототип `inMin`); у удалённого — 0. */
const IN_MIN = sql`case when ${j('deleted')} then 0 else greatest(0, ${j('amount')} - ${AVAIL}) end`;

const FEE_PART = sql`(${j('total')} - ${j('amount')})`;

/** Сумма обратных записей к поступлению (прототип `corrOf`). */
const CORR_SUM = sql`(select sum(co.amount)::bigint from ${moneyOperations} co where co.ref_operation_id = ${j('ref_id')} and co.kind = 'corr' and co.cancelled_at is null)`;

/** Пусто у удалённого: в итоги и суммы не входит. */
const live = (v: SQL) => sql`case when ${j('deleted')} then null else ${v} end`;

export interface ReceiptJournalOptions {
  deleted: boolean;
  /** Плата за обслуживание видна: столбец «За обслуживание» и детализация с ней. */
  fee: boolean;
  scope: SQL | undefined;
  t: ListTexts;
}

/** Детализация поступления целиком (прототип `allocText`): отчёты, обслуживание, аванс. */
function receiptAllocText(t: ListTexts, fee: boolean): SQL {
  const feeParts = fee
    ? sql`(select string_agg(replace(${lit(t, 'fin.j.alloc_fee')}, '{month}', ${monthText(sql.raw('fa.month'))}) || ' — ' || ${wholeText(sql.raw('fa.amount'))}, '; ' order by fa.month) from ${feePayments} fp join ${feeAllocations} fa on fa.payment_id = fp.id where fp.operation_id = ${j('ref_id')} and (fp.deleted_at is null) = not ${j('deleted')})`
    : sql`null`;
  const head = sql`concat_ws('; ', ${allocParts(t)}, ${feeParts})`;
  return sql`case when ${head} = '' then null else ${head} || case when ${receiptAdvance} > 0 then '; ' || replace(${lit(t, 'fin.j.in_adv')}, '{amount}', ${wholeText(receiptAdvance)}) else '' end end`;
}

/** Столбцы «Журнала поступлений» (прототип renderJournal). */
export function receiptJournalColumns(o: Pick<ReceiptJournalOptions, 't' | 'fee'>): ListColumns {
  const { t } = o;
  const total = o.fee ? sql`coalesce(${j('total')}, ${j('amount')})` : j('amount');
  const dist = o.fee ? sql`${allocSum} + ${FEE_PART}` : allocSum;
  const ed = sql`case when ${j('deleted')} then 'deleted' when ${IN_MIN} > 0 then 'spent' else 'free' end`;
  return {
    date: { type: 'date', label: 'fin.j.col.date', value: j('op_date') },
    cp: {
      type: 'enum',
      label: 'fin.j.col.cp',
      value: sql`${contractors.id}::text`,
      display: contractors.name,
      sort: { value: contractors.name, text: true },
    },
    total: { type: 'money', label: 'fin.r.col.total', value: live(total), total: true },
    dist: { type: 'money', label: 'fin.r.col.dist', value: live(dist), total: true },
    alloc: {
      type: 'text',
      label: 'fin.r.col.alloc',
      value: sql`coalesce(${receiptAllocText(t, o.fee)}, ${lit(t, 'fin.r.advance')})`,
    },
    tax: { type: 'money', label: 'fin.r.col.tax', value: live(j('amount')), total: true },
    ...(o.fee && {
      fee: { type: 'money', label: 'fin.r.col.fee', value: live(FEE_PART), total: true },
    }),
    adv: { type: 'money', label: 'fin.r.col.adv', value: live(receiptAdvance), total: true },
    corr: { type: 'money', label: 'fin.r.col.corr', value: sql`nullif(${CORR_SUM}, 0)` },
    ed: {
      type: 'enum',
      label: 'fin.r.col.ed',
      value: ed,
      display: sql`case ${ed} when 'deleted' then ${lit(t, 'fin.r.ed.deleted')} when 'spent' then ${lit(t, 'fin.r.ed.spent')} else ${lit(t, 'fin.r.ed.free')} end`,
    },
    files: { type: 'int', label: 'fin.r.col.files', value: FILES },
    by: {
      type: 'enum',
      label: 'fin.j.col.by',
      value: auditActorValue(j('created_by'), sql`${jc.shortName}`),
    },
    note: { type: 'text', label: 'fin.j.col.note', value: j('note') },
    holder: {
      type: 'enum',
      label: 'fin.r.col.holder',
      value: ACC,
      display: sql`case ${j('holder_kind')} when 'org' then ${lit(t, 'fin.r.holder_org')} else coalesce(${jh.shortName}, '—') end`,
    },
    ...journalAudit(),
  };
}

function receiptScope(o: ReceiptJournalOptions): SQL {
  return and(
    sql`${j('kind')} = 'in'`,
    o.deleted ? undefined : sql`not ${j('deleted')}`,
    o.fee ? undefined : FEE_ONLY_HIDDEN,
    o.scope,
  )!;
}

/** Строка «Журнала поступлений». */
export interface ReceiptJournalRow {
  id: string;
  contractor: { id: string; name: string };
  date: IsoDate;
  /** Общая сумма: с платой — тому, кто её видит, иначе только на налоги. */
  total: Tyiyn;
  tax: Tyiyn;
  /** Часть за обслуживание; null — плата не видна. */
  fee: Tyiyn | null;
  distributed: Tyiyn;
  advance: Tyiyn;
  /** Число строк детализации (у «2 строки»). */
  lines: number;
  alloc: string | null;
  corrections: Tyiyn | null;
  /** Уже потрачено на налоги (прототип `inMin`): уменьшить ниже нельзя. */
  spent: Tyiyn;
  deleted: boolean;
  edited: boolean;
  files: number;
  by: string | null;
  note: string;
  holder: { kind: MoneyHolderKind; name: string | null };
  audit: ListRowAudit;
  /** Контрагент в архиве — для замков меню строки. */
  archived: boolean;
}

function receiptFields(o: ReceiptJournalOptions) {
  const cols = receiptJournalColumns(o);
  const lines = o.fee
    ? sql<number>`((select count(*) from ${moneyAllocations} a where a.operation_id = ${j('ref_id')}) + (select count(*) from ${feePayments} fp join ${feeAllocations} fa on fa.payment_id = fp.id where fp.operation_id = ${j('ref_id')} and fp.deleted_at is null))::int`
    : sql<number>`(select count(*) from ${moneyAllocations} a where a.operation_id = ${j('ref_id')})::int`;
  return {
    id: sql<string>`${j('ref_id')}`,
    contractorId: sql<string>`${contractors.id}`,
    contractorName: sql<string>`${contractors.name}`,
    date: sql<string>`${j('op_date')}::text`,
    total: sql<string>`coalesce(${j('total')}, ${j('amount')})::text`,
    tax: sql<string>`${j('amount')}::text`,
    allocated: sql<string>`${allocSum}::text`,
    lines,
    alloc: sql<string | null>`${cols.alloc!.value}`,
    corrections: sql<string | null>`${CORR_SUM}::text`,
    spent: sql<string>`${IN_MIN}::text`,
    deleted: sql<boolean>`${j('deleted')}`,
    edited: sql<boolean>`${j('edited')}`,
    files: FILES,
    createdBy: sql<string | null>`${j('created_by')}`,
    createdByName: sql<string | null>`${jc.shortName}`,
    createdAt: sql<string>`to_json(${j('created_at')}) #>> '{}'`,
    updatedAt: sql<string | null>`to_json(${j('updated_at')}) #>> '{}'`,
    updatedBy: sql<string | null>`${j('updated_by')}`,
    updatedByName: sql<string | null>`${ju.shortName}`,
    note: sql<string>`${j('note')}`,
    holderKind: sql<MoneyHolderKind>`${j('holder_kind')}`,
    holderName: sql<string | null>`${jh.shortName}`,
    archived: sql<boolean>`${contractors.serviceStatus} = 'archived'`,
  };
}

type ReceiptData = { [K in keyof ReturnType<typeof receiptFields>]: unknown };

function toReceiptRow(r: ReceiptData, fee: boolean): ReceiptJournalRow {
  const tax = Number(r.tax);
  const all = Number(r.total);
  const allocated = Number(r.allocated);
  const feePart = all - tax;
  return {
    id: r.id as string,
    contractor: { id: r.contractorId as string, name: r.contractorName as string },
    date: r.date as IsoDate,
    total: fee ? all : tax,
    tax,
    fee: fee ? feePart : null,
    distributed: allocated + (fee ? feePart : 0),
    advance: Math.max(0, tax - allocated),
    lines: Number(r.lines ?? 0),
    alloc: (r.alloc as string | null) ?? null,
    corrections: r.corrections == null ? null : Number(r.corrections),
    spent: Number(r.spent),
    deleted: Boolean(r.deleted),
    edited: Boolean(r.edited),
    files: Number(r.files ?? 0),
    by: auditActorName(r.createdBy as string | null, r.createdByName as string | null),
    note: (r.note as string | null) ?? '',
    holder: {
      kind: r.holderKind as MoneyHolderKind,
      name: (r.holderName as string | null) ?? null,
    },
    audit: rowAudit(r),
    archived: Boolean(r.archived),
  };
}

/** Страница «Журнала поступлений». */
export async function listReceiptJournalPage(
  tx: Tx,
  query: ListQuery,
  o: ReceiptJournalOptions,
): Promise<ListPageResult<ReceiptJournalRow>> {
  const fields = receiptFields(o);
  const from = journalFrom(tx);
  const page = await selectListPage({
    query,
    columns: receiptJournalColumns(o),
    natural: JOURNAL_NATURAL,
    defaultSort: JOURNAL_SORT,
    scope: receiptScope(o),
    select: ({ window, where, orderBy, limit, offset }) =>
      journalQuery(tx, { ...fields, ...window } as unknown as Record<string, SQL>)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset) as unknown as Promise<
        (ReceiptData & {
          listTotal: number;
          listTotals: Record<string, number> | null;
          listGroups: string[] | null;
        })[]
      >,
    from,
  });
  return { ...page, rows: page.rows.map((r) => toReceiptRow(r as ReceiptData, o.fee)) };
}

export function listReceiptJournalValues(
  tx: Tx,
  key: string,
  o: ReceiptJournalOptions,
  q?: string,
) {
  return selectListValues({
    columns: receiptJournalColumns(o),
    key,
    scope: receiptScope(o),
    from: journalFrom(tx),
    q,
  });
}

export function exportReceiptJournal(
  tx: Tx,
  query: ListQuery,
  keys: readonly string[],
  o: ReceiptJournalOptions,
) {
  return selectListExport({
    query,
    columns: receiptJournalColumns(o),
    keys,
    natural: JOURNAL_NATURAL,
    defaultSort: JOURNAL_SORT,
    scope: receiptScope(o),
    from: journalFrom(tx),
  });
}

/* ───────────── Плашки месяца ───────────── */

/** Плашки модуля за месяц (прототип renderFin): суммы по действующим операциям в области. */
export interface FinSummary {
  month: YearMonth;
  /** «Поступило на налоги» и «оплачено в бюджет»; null — налоговые операции не видны. */
  tax: { received: Tyiyn; paid: Tyiyn } | null;
  /** «Получено за обслуживание»; null — плата не видна. */
  fee: Tyiyn | null;
  /** «Списания и возвраты»; null — не видны. */
  wo: Tyiyn | null;
}

export async function finSummary(
  tx: Tx,
  month: YearMonth,
  o: Pick<FinJournalOptions, 'tax' | 'fee' | 'scope'>,
): Promise<FinSummary> {
  const first = `${month}-01`;
  const [row] = await tx
    .select({
      received: sql<string>`coalesce(sum(${j('amount')}) filter (where ${j('kind')} = 'in'), 0)::text`,
      paid: sql<string>`coalesce(sum(${j('amount')}) filter (where ${j('kind')} = 'pay'), 0)::text`,
      fee: sql<string>`coalesce(sum(${j('amount')}) filter (where ${j('kind')} = 'fee'), 0)::text`,
      wo: sql<string>`coalesce(sum(${j('amount')}) filter (where ${j('kind')} in ('bonus', 'refund')), 0)::text`,
    })
    .from(JOURNAL)
    .innerJoin(contractors, sql`${contractors.id} = ${j('contractor_id')}`)
    .where(
      and(
        sql`not ${j('deleted')}`,
        sql`${j('op_date')} >= ${first}::date and ${j('op_date')} < (${first}::date + interval '1 month')`,
        o.scope,
      ),
    );
  return {
    month,
    tax: o.tax ? { received: Number(row?.received ?? 0), paid: Number(row?.paid ?? 0) } : null,
    fee: o.fee ? Number(row?.fee ?? 0) : null,
    wo: o.tax ? Number(row?.wo ?? 0) : null,
  };
}

/* ───────────── Закрытые месяцы и «Списания в бонус» ───────────── */

/** Закрытые месяцы организации (прототип `CLOSED`): новые сверху. */
export async function closedMonthsOf(tx: Tx): Promise<YearMonth[]> {
  const rows = await tx
    .select({ month: closedMonths.month })
    .from(closedMonths)
    .orderBy(sql`${closedMonths.month} desc`);
  return rows.map((r) => r.month.slice(0, 7) as YearMonth);
}

/** Месяц даты закрыт. */
export async function monthClosed(tx: Tx, date: IsoDate): Promise<boolean> {
  const [row] = await tx
    .select({ id: closedMonths.id })
    .from(closedMonths)
    .where(eq(closedMonths.month, `${date.slice(0, 7)}-01`))
    .limit(1);
  return !!row;
}

/** Ошибка закрытия месяца: уже закрыт. */
export class MonthClosedTakenError extends Error {
  constructor() {
    super('month_close_taken');
    this.name = 'MonthClosedTakenError';
  }
}

/**
 * «Закрыть <месяц>» (прототип: вкладка «Списания в бонус», `bg-close`): прошлый месяц фиксирует
 * оплаты налогов, списания и возвраты — их больше не меняют и не удаляют. Запись в истории учётной
 * политики («Месяц … закрыт отчётом о списаниях»). Права проверяет вызывающий.
 */
export async function closeMonth(tx: Tx, month: YearMonth): Promise<void> {
  const first = `${month}-01`;
  const [row] = await tx
    .insert(closedMonths)
    .values({ month: first, closedBy: sql`app.current_user_id()` })
    .onConflictDoNothing()
    .returning({ orgId: closedMonths.orgId });
  if (!row) throw new MonthClosedTakenError();
  await writeHistory(tx, {
    entity: 'org_settings',
    entityId: row.orgId,
    action: 'update',
    changes: [{ field: 'monthClosed', to: month }],
  });
}

/** Списания в бонус за месяц: сколько и на какую сумму (подтверждение «Закрыть <месяц>»). */
export async function bonusesOfMonth(
  tx: Tx,
  month: YearMonth,
): Promise<{ count: number; amount: Tyiyn }> {
  const first = `${month}-01`;
  const [row] = await tx
    .select({
      n: sql<number>`count(*)::int`,
      s: sql<string>`coalesce(sum(${moneyOperations.amount}), 0)::text`,
    })
    .from(moneyOperations)
    .where(
      and(
        eq(moneyOperations.kind, 'bonus'),
        sql`${moneyOperations.cancelledAt} is null`,
        sql`${moneyOperations.opDate} >= ${first}::date and ${moneyOperations.opDate} < (${first}::date + interval '1 month')`,
      ),
    );
  return { count: row?.n ?? 0, amount: Number(row?.s ?? 0) };
}

const B = (name: string) => sql.raw(`"money_operations"."${name}"`);
const bh = alias(employees, 'bh');
const bc = alias(employees, 'bc');
const bu = alias(employees, 'bu');

/** Столбцы вкладки «Списания в бонус» (прототип staff.js, `bonus`). */
export function bonusColumns(t: ListTexts): ListColumns {
  return {
    date: { type: 'date', label: 'fin.b.col.date', value: B('op_date') },
    month: {
      type: 'enum',
      label: 'fin.b.col.month',
      value: sql`to_char(${B('op_date')}, 'YYYY-MM')`,
      display: monthText(B('op_date')),
      sort: { value: sql`to_char(${B('op_date')}, 'YYYY-MM')`, text: false },
    },
    emp: {
      type: 'enum',
      label: 'fin.b.col.emp',
      value: sql`coalesce(${B('holder_employee_id')}::text, 'org')`,
      display: sql`case when ${B('holder_kind')} = 'org' then ${lit(t, 'fin.b.org')} else coalesce(${bh.shortName}, '—') end`,
    },
    cp: {
      type: 'enum',
      label: 'fin.b.col.cp',
      value: sql`${contractors.id}::text`,
      display: contractors.name,
      sort: { value: contractors.name, text: true },
    },
    sum: { type: 'money', label: 'fin.b.col.sum', value: B('amount'), total: true },
    note: { type: 'text', label: 'fin.b.col.note', value: B('note') },
    by: {
      type: 'enum',
      label: 'fin.b.col.by',
      value: auditActorValue(B('created_by'), sql`${bc.shortName}`),
    },
    createdAt: { type: 'datetime', label: 'grid.col.created_at', value: B('created_at') },
    updatedAt: { type: 'datetime', label: 'grid.col.updated_at', value: B('updated_at') },
    createdBy: {
      type: 'enum',
      label: 'grid.col.created_by',
      value: auditActorValue(B('created_by'), sql`${bc.shortName}`),
    },
    updatedBy: {
      type: 'enum',
      label: 'grid.col.updated_by',
      value: sql`coalesce(${auditActorValue(B('updated_by'), sql`${bu.shortName}`)}, ${auditActorValue(B('created_by'), sql`${bc.shortName}`)})`,
    },
  };
}

function bonusQuery(tx: Tx, fields: Record<string, SQL>) {
  return tx
    .select(fields)
    .from(moneyOperations)
    .innerJoin(contractors, eq(contractors.id, moneyOperations.contractorId))
    .leftJoin(bh, eq(bh.id, moneyOperations.holderEmployeeId))
    .leftJoin(bc, eq(bc.userId, moneyOperations.createdBy))
    .leftJoin(bu, eq(bu.userId, moneyOperations.updatedBy))
    .$dynamic();
}

const bonusFrom =
  (tx: Tx): ListFrom =>
  (fields) =>
    bonusQuery(tx, fields);

const bonusScope = (scope: SQL | undefined) =>
  and(eq(moneyOperations.kind, 'bonus'), sql`${moneyOperations.cancelledAt} is null`, scope)!;

const BONUS_NATURAL = [moneyOperations.opDate, moneyOperations.createdAt, moneyOperations.id];

/** Строка «Списания в бонус». */
export interface BonusRow {
  id: string;
  date: IsoDate;
  contractor: { id: string; name: string };
  holder: { kind: MoneyHolderKind; name: string | null };
  amount: Tyiyn;
  note: string;
  by: string | null;
  /** Контрагент в архиве — для замков меню строки (прототип `opLock`). */
  archived: boolean;
  audit: ListRowAudit;
}

export async function listBonusPage(
  tx: Tx,
  query: ListQuery,
  o: { scope: SQL | undefined; t: ListTexts },
): Promise<ListPageResult<BonusRow>> {
  const fields = {
    id: sql<string>`${B('id')}`,
    date: sql<string>`${B('op_date')}::text`,
    contractorId: sql<string>`${contractors.id}`,
    contractorName: sql<string>`${contractors.name}`,
    holderKind: sql<string>`${B('holder_kind')}`,
    holderName: sql<string | null>`${bh.shortName}`,
    amount: sql<string>`${B('amount')}::text`,
    note: sql<string>`${B('note')}`,
    createdBy: sql<string | null>`${B('created_by')}`,
    createdByName: sql<string | null>`${bc.shortName}`,
    createdAt: sql<string>`to_json(${B('created_at')}) #>> '{}'`,
    updatedAt: sql<string | null>`to_json(${B('updated_at')}) #>> '{}'`,
    updatedBy: sql<string | null>`${B('updated_by')}`,
    updatedByName: sql<string | null>`${bu.shortName}`,
    archived: sql<boolean>`${contractors.serviceStatus} = 'archived'`,
  };
  const from = bonusFrom(tx);
  const page = await selectListPage({
    query,
    columns: bonusColumns(o.t),
    natural: BONUS_NATURAL,
    defaultSort: JOURNAL_SORT,
    scope: bonusScope(o.scope),
    select: ({ window, where, orderBy, limit, offset }) =>
      bonusQuery(tx, { ...fields, ...window } as unknown as Record<string, SQL>)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset) as unknown as Promise<
        (Record<keyof typeof fields, unknown> & {
          listTotal: number;
          listTotals: Record<string, number> | null;
          listGroups: string[] | null;
        })[]
      >,
    from,
  });
  return {
    ...page,
    rows: page.rows.map((r) => ({
      id: r.id as string,
      date: r.date as IsoDate,
      contractor: { id: r.contractorId as string, name: r.contractorName as string },
      holder: {
        kind: r.holderKind as MoneyHolderKind,
        name: (r.holderName as string | null) ?? null,
      },
      amount: Number(r.amount),
      note: (r.note as string | null) ?? '',
      by: auditActorName(r.createdBy as string | null, r.createdByName as string | null),
      archived: Boolean(r.archived),
      audit: rowAudit(r),
    })),
  };
}

export function listBonusValues(
  tx: Tx,
  key: string,
  o: { scope: SQL | undefined; t: ListTexts },
  q?: string,
) {
  return selectListValues({
    columns: bonusColumns(o.t),
    key,
    scope: bonusScope(o.scope),
    from: bonusFrom(tx),
    q,
  });
}

export function exportBonuses(
  tx: Tx,
  query: ListQuery,
  keys: readonly string[],
  o: { scope: SQL | undefined; t: ListTexts },
) {
  return selectListExport({
    query,
    columns: bonusColumns(o.t),
    keys,
    natural: BONUS_NATURAL,
    defaultSort: JOURNAL_SORT,
    scope: bonusScope(o.scope),
    from: bonusFrom(tx),
  });
}

/* ───────────── «Баланс счёта» в списке сотрудников ───────────── */

/**
 * Баланс виртуального счёта сотрудника (прототип `empBal`): поступления, возвраты по уточнённому,
 * обратные записи и переводы на его счёт — приход; оплаты, бонусы и возвраты контрагенту — расход.
 */
export const EMPLOYEE_BALANCE = sql<number>`(select coalesce(sum(case when eo.kind in ('in', 'back', 'corr', 'xfer') then eo.amount else -eo.amount end), 0)::bigint from ${moneyOperations} eo where eo.holder_kind = 'employee' and eo.holder_employee_id = "employees"."id" and eo.cancelled_at is null)`;
