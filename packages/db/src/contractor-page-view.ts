import {
  formatPhone,
  localPhoneText,
  orgMainAccount,
  type IsoDate,
  type PaymentPurpose,
  type PaysTo,
  type ReportAct,
  type ReportPeriod,
  type PageReportStatus,
  type Tyiyn,
} from '@buhuchet/domain';
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { Tx } from './client';
import { bankNamesOf } from './fees';
import { listEmployeeWallets, listOrgAccounts, type RequisiteFields } from './money';
import {
  assignments,
  authorities,
  contractors,
  employees,
  files,
  moneyOperations,
  organizations,
  platformReference,
  reportTypes,
  reports,
  roles,
} from './schema';
import { phoneCodeList } from './staff';

/*
 * Данные разделов открытой страницы контрагента (задача 2.43; ТЗ «Страница контрагента по ссылке» →
 * «Что видит контрагент»; прототип modules/cp-page.js, pubBody). Только в контексте организации
 * страницы (`withOrgContext` с её номером, без пользователя) и только после проверки кода: что
 * попадёт на страницу, решает API по показанным разделам. Здесь нет задач, истории, примечаний
 * сотрудников, счетов сотрудников и бонусов, чужих файлов — их страница не показывает никогда.
 */

/** Телефон для страницы: как показать и цифры для «Позвонить» и «WhatsApp». */
export interface PagePhoneText {
  text: string;
  digits: string;
}

type Codes = Awaited<ReturnType<typeof phoneCodeList>>;

const phoneOf = (phone: string | null, codes: Codes): PagePhoneText | null => {
  const digits = phone?.replace(/\D/g, '') ?? '';
  return digits ? { text: formatPhone(phone!, codes), digits } : null;
};

/** Контрагент глазами страницы: куда переводит деньги на налоги, ответственный, свои данные. */
export interface PageContractorFacts {
  paysTo: PaysTo;
  responsibleEmployeeId: string | null;
  oneOff: boolean;
  head: string;
  contact: string;
  phone: string;
}

export async function pageContractorFacts(
  tx: Tx,
  contractorId: string,
): Promise<PageContractorFacts | null> {
  const [row] = await tx
    .select({
      paysTo: contractors.paysTo,
      responsibleEmployeeId: contractors.responsibleEmployeeId,
      kind: contractors.kind,
      head: contractors.head,
      contact: contractors.contact,
      phone: contractors.phone,
    })
    .from(contractors)
    .where(eq(contractors.id, contractorId));
  if (!row) return null;
  return {
    paysTo: row.paysTo as PaysTo,
    responsibleEmployeeId: row.responsibleEmployeeId,
    oneOff: row.kind === 'oneoff',
    head: row.head,
    contact: row.contact,
    phone: row.phone,
  };
}

/** Сотрудник на странице: ФИО, должность (название роли), телефон. */
export interface PagePersonRecord {
  id: string;
  name: string;
  role: string;
  phone: PagePhoneText | null;
  active: boolean;
}

/**
 * Ответственный и сотрудники, указанные у действующих назначений отчётов (ТЗ «Контакты»: «ответственный
 * и сотрудники, указанные у отдельных отчётов… со списком отчётов, которые ведёт каждый»; прототип
 * `ids`, `what`): кто ведёт какие виды — по ответственному назначения, а без него — по ответственному
 * контрагента. Телефон организации — из «Моя организация».
 */
export async function pagePeople(
  tx: Tx,
  o: { contractorId: string; responsibleId: string | null; orgId: string; contractorPhone: string },
): Promise<{
  people: PagePersonRecord[];
  types: { employeeId: string; short: string }[];
  orgPhone: PagePhoneText | null;
  contractorPhone: string;
}> {
  const { contractorId, responsibleId } = o;
  const [asg, org, codes] = await Promise.all([
    tx
      .select({ employeeId: assignments.responsibleEmployeeId, short: reportTypes.shortName })
      .from(assignments)
      .innerJoin(reportTypes, eq(reportTypes.code, assignments.reportTypeCode))
      .where(and(eq(assignments.contractorId, contractorId), isNull(assignments.endedOn)))
      .orderBy(asc(reportTypes.sortOrder), asc(assignments.reportTypeCode)),
    tx
      .select({ phone: organizations.phone })
      .from(organizations)
      .where(eq(organizations.id, o.orgId)),
    phoneCodeList(tx),
  ]);
  const ids = [
    ...new Set(
      [responsibleId, ...asg.map((a) => a.employeeId)].filter((x): x is string => x !== null),
    ),
  ];
  const rows = ids.length
    ? await tx
        .select({
          id: employees.id,
          name: employees.fullName,
          role: roles.name,
          phone: employees.phone,
          active: employees.active,
        })
        .from(employees)
        .innerJoin(roles, eq(roles.id, employees.roleId))
        .where(inArray(employees.id, ids))
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const people = ids.flatMap((id) => {
    const r = byId.get(id);
    return r ? [{ ...r, phone: phoneOf(r.phone, codes) }] : [];
  });
  return {
    people,
    types: asg.flatMap((a) => {
      const employeeId = a.employeeId ?? responsibleId;
      return employeeId ? [{ employeeId, short: a.short }] : [];
    }),
    orgPhone: phoneOf(org[0]?.phone ?? null, codes),
    contractorPhone: o.contractorPhone ? formatPhone(o.contractorPhone, codes) : '',
  };
}

/** Отчёт на странице с видом: без «Не требуется» и прежних версий уточнённых (прототип `all`). */
export interface PageReportRecord {
  id: string;
  typeCode: string;
  status: PageReportStatus;
  act: ReportAct;
  period: ReportPeriod;
  periodStart: IsoDate;
  eventDate: IsoDate | null;
  dueDate: IsoDate;
  payDue: IsoDate | null;
  submittedOn: IsoDate | null;
  amount: Tyiyn | null;
  paid: Tyiyn;
}

export interface PageReportTypeRecord {
  code: string;
  short: string;
  name: string;
  organ: string;
  period: ReportPeriod;
  oneOff: boolean;
  clientNote: string;
  description: string;
  eventLabel: string;
}

/**
 * Отчёты контрагента по сроку сдачи и их виды в порядке каталога; `withFiles` — с файлами отчётов
 * (загруженные, не удалённые), только при включённых «Файлах в карточках».
 */
export async function pageReports(
  tx: Tx,
  contractorId: string,
  withFiles: boolean,
): Promise<{
  reports: PageReportRecord[];
  types: PageReportTypeRecord[];
  files: Map<string, { id: string; name: string }[]>;
}> {
  const rows = await tx
    .select({
      id: reports.id,
      typeCode: reports.reportTypeCode,
      status: reports.status,
      act: reports.act,
      period: reports.period,
      periodStart: reports.periodStart,
      eventDate: reports.eventDate,
      dueDate: reports.dueDate,
      payDue: reports.payDue,
      submittedOn: reports.submittedOn,
      amount: reports.amount,
      paid: reports.paid,
    })
    .from(reports)
    .where(
      and(
        eq(reports.contractorId, contractorId),
        eq(reports.superseded, false),
        ne(reports.status, 'not_required'),
      ),
    )
    .orderBy(asc(reports.dueDate), asc(reports.createdAt), asc(reports.id));
  const codes = [...new Set(rows.map((r) => r.typeCode))];
  const [types, fileRows] = await Promise.all([
    codes.length
      ? tx
          .select({
            code: reportTypes.code,
            short: reportTypes.shortName,
            name: reportTypes.name,
            organ: authorities.name,
            period: reportTypes.period,
            oneOff: reportTypes.oneOff,
            clientNote: reportTypes.clientNote,
            description: reportTypes.description,
            eventLabel: reportTypes.eventLabel,
          })
          .from(reportTypes)
          .innerJoin(authorities, eq(authorities.code, reportTypes.authorityCode))
          .where(inArray(reportTypes.code, codes))
          .orderBy(asc(reportTypes.sortOrder), asc(reportTypes.code))
      : [],
    withFiles && rows.length
      ? tx
          .select({ id: files.id, name: files.name, reportId: files.sourceId })
          .from(files)
          .where(
            and(
              eq(files.sourceKind, 'report'),
              eq(files.contractorId, contractorId),
              eq(files.state, 'ready'),
              inArray(
                files.sourceId,
                rows.map((r) => r.id),
              ),
            ),
          )
          .orderBy(asc(files.createdAt), asc(files.id))
      : [],
  ]);
  const byReport = new Map<string, { id: string; name: string }[]>();
  for (const f of fileRows) {
    const list = byReport.get(f.reportId!) ?? [];
    list.push({ id: f.id, name: f.name });
    byReport.set(f.reportId!, list);
  }
  return {
    reports: rows.map((r) => ({
      ...r,
      // «Не требуется» отсечено условием запроса.
      status: r.status as PageReportStatus,
      amount: r.amount === null ? null : Number(r.amount),
      paid: Number(r.paid),
    })),
    types,
    files: byReport,
  };
}

/**
 * Файл отчёта контрагента для скачивания со страницы: загружен, не удалён, отчёт — этого контрагента,
 * не «Не требуется» и не прежняя версия уточнённого (только такие файлы страница показывает).
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Е-4 — только загруженные файлы показанных отчётов.
export async function pageReportFile(
  tx: Tx,
  contractorId: string,
  fileId: string,
): Promise<{ name: string; storageKey: string; contentType: string } | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fileId)) return null;
  const [row] = await tx
    .select({ name: files.name, storageKey: files.storageKey, contentType: files.contentType })
    .from(files)
    .innerJoin(reports, eq(reports.id, files.sourceId))
    .where(
      and(
        eq(files.id, fileId),
        eq(files.sourceKind, 'report'),
        eq(files.state, 'ready'),
        eq(files.contractorId, contractorId),
        eq(reports.contractorId, contractorId),
        eq(reports.superseded, false),
        ne(reports.status, 'not_required'),
      ),
    );
  return row ?? null;
}

/** Реквизит для «Как оплатить» (прототип pubPay, `rqNum`, `rqKindL`). */
export interface PagePayRecord {
  kind: 'phone' | 'account' | 'wallet';
  /** Банк счёта, кошелёк или банк реквизита сотрудника; у перевода по номеру — пусто. */
  bank: string;
  /** Номер, как его набирают: «0555 123 456», номер счёта или кошелька. */
  number: string;
  /** Что копирует «Скопировать»: номер без пробелов. */
  copy: string;
  /** Банки и кошельки перевода по номеру. */
  banks: string[];
  /** БИК — у расчётного счёта организации. */
  bik: string | null;
  holder: string;
}

async function payRecord(
  tx: Tx,
  a: RequisiteFields,
  owner: 'org' | 'employee',
  codes: Codes,
): Promise<PagePayRecord> {
  const names = await bankNamesOf(
    tx,
    a.kind === 'phone' ? a.phoneBanks : a.bankCode ? [a.bankCode] : [],
  );
  const number =
    a.kind === 'phone' ? (a.phone ? localPhoneText(a.phone, codes) : '') : (a.accountNo ?? '');
  const bank = a.bankCode ? (names.get(a.bankCode) ?? a.bankCode) : '';
  return {
    kind: a.kind === 'phone' ? 'phone' : owner === 'org' ? 'account' : 'wallet',
    bank: a.kind === 'phone' ? '' : bank,
    number,
    copy: number.replace(/\s/g, ''),
    banks: a.kind === 'phone' ? a.phoneBanks.map((c) => names.get(c) ?? c) : [],
    bik: a.kind !== 'phone' && owner === 'org' && bank && a.bik ? a.bik : null,
    holder: a.holderName,
  };
}

/**
 * «Как оплатить» (ТЗ: «Налоги» — основной реквизит ответственного бухгалтера или основной счёт
 * организации для налогов, смотря что выбрано у контрагента; «Обслуживание» — основной счёт
 * организации для обслуживания): `tax`, `fee` — какие карточки нужны. Реквизит ответственного без
 * отметки «Основной» — первый (прототип `ws.find(w=>w.main)||ws[0]`).
 */
export async function pagePayRequisites(
  tx: Tx,
  o: { paysTo: PaysTo; responsibleId: string | null; tax: boolean; fee: boolean },
): Promise<{ tax: PagePayRecord | null; fee: PagePayRecord | null }> {
  const needOrg = o.fee || (o.tax && o.paysTo === 'org');
  const needWallets = o.tax && o.paysTo === 'emp' && o.responsibleId !== null;
  const [accounts, wallets, codes] = await Promise.all([
    needOrg ? listOrgAccounts(tx) : Promise.resolve([]),
    needWallets ? listEmployeeWallets(tx, o.responsibleId!) : Promise.resolve([]),
    phoneCodeList(tx),
  ]);
  const main = (what: PaymentPurpose) => orgMainAccount(accounts, what);
  let tax: PagePayRecord | null = null;
  if (o.tax) {
    if (o.paysTo === 'org') {
      const a = main('tax');
      tax = a ? await payRecord(tx, a, 'org', codes) : null;
    } else {
      const w = wallets.find((x) => x.isMain) ?? wallets[0];
      tax = w ? await payRecord(tx, { ...w, bik: null }, 'employee', codes) : null;
    }
  }
  const feeAccount = o.fee ? main('fee') : null;
  return { tax, fee: feeAccount ? await payRecord(tx, feeAccount, 'org', codes) : null };
}

/**
 * Итоги года «Деньги на налоги» (прототип pubMoney: `got`, `paid`): поступило от контрагента —
 * поступления, возвраты по уточнённому и обратные записи; оплачено в бюджет — все оплаты налогов, с
 * «Оплатил контрагент сам». Отменённые операции не входят.
 */
export async function pageYearMoney(
  tx: Tx,
  contractorId: string,
  year: string,
): Promise<{ got: Tyiyn; paid: Tyiyn }> {
  const sum = (kinds: string) =>
    sql<number>`coalesce(sum(${moneyOperations.amount}) filter (where ${moneyOperations.kind} in (${sql.raw(kinds)})), 0)`.mapWith(
      Number,
    );
  const [row] = await tx
    .select({ got: sum(`'in', 'back', 'corr'`), paid: sum(`'pay'`) })
    .from(moneyOperations)
    .where(
      and(
        eq(moneyOperations.contractorId, contractorId),
        isNull(moneyOperations.cancelledAt),
        sql`to_char(${moneyOperations.opDate}, 'YYYY') = ${year}`,
      ),
    );
  return { got: row?.got ?? 0, paid: row?.paid ?? 0 };
}

/**
 * Пояснения страницы из «Текстов элементов экрана» (refDB `kbUi.page`; прототип `PGT`): группа →
 * подпись → текст. Нет раздела или он не читается — без пояснений.
 */
export async function pageScreenTexts(tx: Tx): Promise<Record<string, Record<string, string>>> {
  const [row] = await tx
    .select({ payload: platformReference.payload })
    .from(platformReference)
    .where(eq(platformReference.key, 'kbUi'));
  const page = (row?.payload as { page?: unknown } | undefined)?.page;
  if (!page || typeof page !== 'object') return {};
  const out: Record<string, Record<string, string>> = {};
  for (const [group, items] of Object.entries(page as Record<string, unknown>)) {
    if (!items || typeof items !== 'object') continue;
    const texts = Object.entries(items as Record<string, unknown>).filter(
      (e): e is [string, string] => typeof e[1] === 'string',
    );
    if (texts.length) out[group] = Object.fromEntries(texts);
  }
  return out;
}
