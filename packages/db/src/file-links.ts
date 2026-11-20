import {
  FILE_LINKABLE_FILE_KINDS,
  FILE_LINK_SOURCE_KINDS,
  type FileLinkSourceKind,
  type IsoDate,
  type ReportPeriod,
} from '@buhuchet/domain';
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { Tx } from './client';
import { fileRecordColumns, fileRecordOf, type FileRecord } from './files';
import {
  contractors,
  employees,
  feePayments,
  fileLinks,
  files,
  moneyOperations,
  oneOffServicePayments,
  oneOffServices,
  projectPayments,
  projects,
  reports,
  reportTypes,
} from './schema';

/*
 * Ссылки файла контрагента на его записи (доработки 16.11.2026, блок 2, этап 1; прототип v124
 * `fLinkRecs`, `fLinkAdd`, `fUnlink`, `fDelDlg`; таблица `file_links` миграции 0157): принятый чек,
 * накладная, акт, сверка — один файл в хранилище и одна строка «Файлового менеджера», а к поступлению,
 * оплате, отчёту, услуге, проекту он прикрепляется ссылкой, без копии. Что запись — того же контрагента,
 * что её видно сотруднику и что её файлы можно менять, проверяет API (`files/links.ts`); здесь — только
 * чтение и запись ссылок.
 */

/** Запись, к которой прикреплён файл ссылкой. */
export interface FileLinkTarget {
  kind: FileLinkSourceKind;
  id: string;
}

const isLinkKind = (kind: string): kind is FileLinkSourceKind =>
  (FILE_LINK_SOURCE_KINDS as readonly string[]).includes(kind);

const UUID = /^[0-9a-f-]{36}$/i;

/** Ссылки файлов по порядку прикрепления: по номеру файла — записи. */
export async function fileLinksOf(
  tx: Tx,
  fileIds: readonly string[],
): Promise<Map<string, FileLinkTarget[]>> {
  const out = new Map<string, FileLinkTarget[]>();
  if (fileIds.length === 0) return out;
  const rows = await tx
    .select({ fileId: fileLinks.fileId, kind: fileLinks.sourceKind, id: fileLinks.sourceId })
    .from(fileLinks)
    .where(inArray(fileLinks.fileId, [...fileIds]))
    .orderBy(asc(fileLinks.createdAt), asc(fileLinks.sourceKind), asc(fileLinks.sourceId));
  for (const r of rows) {
    if (!isLinkKind(r.kind)) continue;
    const list = out.get(r.fileId) ?? [];
    list.push({ kind: r.kind, id: r.id });
    out.set(r.fileId, list);
  }
  return out;
}

/**
 * Файлы, прикреплённые к записи ссылкой: загруженные и не удалённые, по порядку прикрепления (прототип
 * `filesBox`: после своих файлов записи).
 */
export async function linkedFiles(tx: Tx, target: FileLinkTarget): Promise<FileRecord[]> {
  if (!UUID.test(target.id)) return [];
  const rows = await tx
    .select(fileRecordColumns)
    .from(fileLinks)
    .innerJoin(files, and(eq(files.id, fileLinks.fileId), eq(files.orgId, fileLinks.orgId)))
    .leftJoin(employees, eq(employees.userId, files.createdBy))
    .where(
      and(
        eq(fileLinks.sourceKind, target.kind),
        eq(fileLinks.sourceId, target.id),
        eq(files.state, 'ready'),
      ),
    )
    .orderBy(asc(fileLinks.createdAt), asc(files.id));
  return rows.map(fileRecordOf);
}

/** Свой загруженный файл контрагента — тот, что прикрепляется ссылкой (`FILE_LINKABLE_FILE_KINDS`). */
function linkable(contractorId: string): SQL {
  return and(
    eq(files.state, 'ready'),
    eq(files.contractorId, contractorId),
    inArray(files.sourceKind, [...FILE_LINKABLE_FILE_KINDS]),
    // Файл без записи: у «Загружен вручную» и «От контрагента» её нет, у документов контрагента номер —
    // сам контрагент или пусто.
    sql`(${files.sourceKind} = 'contractor' or ${files.sourceId} is null)`,
  )!;
}

/**
 * Файлы контрагента для окна «Из файлов контрагента» (прототип `fLinkable`): файлы карточки контрагента,
 * принятые от него и загруженные вручную с ним — сначала новые. `hidden` — условие над `files`, при
 * котором файл не показывается (файл оплаты за обслуживание без права её видеть).
 */
export async function linkableFiles(
  tx: Tx,
  contractorId: string,
  hidden?: SQL,
): Promise<FileRecord[]> {
  const rows = await tx
    .select(fileRecordColumns)
    .from(files)
    .leftJoin(employees, eq(employees.userId, files.createdBy))
    .where(and(linkable(contractorId), hidden ? sql`not (${hidden})` : undefined))
    .orderBy(desc(files.createdAt), asc(files.id));
  return rows.map(fileRecordOf);
}

/**
 * Прикрепить файлы ссылкой (прототип `fLinkAdd`): только загруженные свои файлы этого контрагента;
 * строки файлов блокируются до конца транзакции (одновременное удаление файла ждёт). Ответ — что
 * прикреплено (уже прикреплённые ещё раз не прикрепляются); null — какой-то номер не подходит.
 */
export async function linkFiles(
  tx: Tx,
  target: FileLinkTarget,
  contractorId: string,
  fileIds: readonly string[],
  hidden?: SQL,
): Promise<FileRecord[] | null> {
  const ids = [...new Set(fileIds)];
  if (ids.length === 0 || !UUID.test(target.id)) return null;
  const rows = await tx
    .select(fileRecordColumns)
    .from(files)
    .leftJoin(employees, eq(employees.userId, files.createdBy))
    .where(
      and(
        inArray(files.id, ids),
        linkable(contractorId),
        hidden ? sql`not (${hidden})` : undefined,
      ),
    )
    .orderBy(asc(files.createdAt), asc(files.id))
    .for('share', { of: files });
  if (rows.length !== ids.length) return null;
  const added = await tx
    .insert(fileLinks)
    .values(rows.map((r) => ({ fileId: r.id, sourceKind: target.kind, sourceId: target.id })))
    .onConflictDoNothing()
    .returning({ fileId: fileLinks.fileId });
  const done = new Set(added.map((a) => a.fileId));
  return rows.filter((r) => done.has(r.id)).map(fileRecordOf);
}

/** «Открепить» (прототип `fUnlink`): убирается только ссылка; false — ссылки не было. */
export async function unlinkFile(tx: Tx, target: FileLinkTarget, fileId: string): Promise<boolean> {
  const rows = await tx
    .delete(fileLinks)
    .where(
      and(
        eq(fileLinks.fileId, fileId),
        eq(fileLinks.sourceKind, target.kind),
        eq(fileLinks.sourceId, target.id),
      ),
    )
    .returning({ fileId: fileLinks.fileId });
  return rows.length > 0;
}

/**
 * Файл удаляется «отовсюду» (прототип `fDelDlg`): все его ссылки — в той же транзакции; ответ — записи,
 * в историю которых вызывающий пишет «Удалён файл».
 */
export async function dropFileLinks(
  tx: Tx,
  fileId: string,
): Promise<(FileLinkTarget & { createdBy: string; createdAt: Date })[]> {
  const rows = await tx.delete(fileLinks).where(eq(fileLinks.fileId, fileId)).returning({
    kind: fileLinks.sourceKind,
    id: fileLinks.sourceId,
    createdBy: fileLinks.createdBy,
    createdAt: fileLinks.createdAt,
  });
  // Кто и когда прикрепил — для «Вернуть» удалённого файла (пакет 20.11.2026, `file_trash.links`).
  return rows.flatMap((r) =>
    isLinkKind(r.kind)
      ? [{ kind: r.kind, id: r.id, createdBy: r.createdBy, createdAt: r.createdAt }]
      : [],
  );
}

/**
 * Файл прикреплён к оплате за обслуживание (не удалённой) — условие над `files` (прототип v124
 * `fFeeHid`): такой файл видит только тот, кто видит плату. `seen` — где сотрудник её видит (условие над
 * контрагентом файла `contractors`); false — нигде.
 */
export function feeLinkedHidden(seen: SQL | undefined | false): SQL | undefined {
  if (seen === undefined) return undefined;
  const linked = sql`exists (select 1 from ${fileLinks} join ${feePayments} on ${feePayments.id} = ${fileLinks.sourceId} and ${feePayments.orgId} = ${fileLinks.orgId} where ${fileLinks.fileId} = ${files.id} and ${fileLinks.sourceKind} = 'fee_payment' and ${feePayments.deletedAt} is null)`;
  return seen === false ? linked : sql`(${linked} and not (${seen}))`;
}

/** Прикреплён ли файл к оплате за обслуживание (не удалённой). */
export async function fileFeeLinked(tx: Tx, fileId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: fileLinks.fileId })
    .from(fileLinks)
    .innerJoin(
      feePayments,
      and(eq(feePayments.id, fileLinks.sourceId), eq(feePayments.orgId, fileLinks.orgId)),
    )
    .where(
      and(
        eq(fileLinks.fileId, fileId),
        eq(fileLinks.sourceKind, 'fee_payment'),
        isNull(feePayments.deletedAt),
      ),
    )
    .limit(1);
  return !!row;
}

/**
 * Что нужно для подписи ссылки (прототип `fLinkRecs`: «Поступление 16.11.2026, 1 250 сом», «отчёта НДС ·
 * 10.2026», «разовой услуги «Аудит» от …»): дата и сумма записи, название услуги или проекта, вид
 * операции, отчёт оплаты налога. Текст собирает экран по словарю. `parentId` — услуга оплаты услуги,
 * проект транша. Отменённой или удалённой записи в ответе нет (прототип: такие записи не в ссылках).
 */
export interface FileLinkLabel {
  date: IsoDate | null;
  /** Сумма, тыйыны; у поступления — часть на налоги, `total` — вся сумма с обслуживанием. */
  amount: number | null;
  total: number | null;
  name: string | null;
  parentId: string | null;
  /** Вид финансовой операции (`MONEY_OP_KINDS`). */
  op: string | null;
  report: { short: string; period: ReportPeriod; start: IsoDate; event: IsoDate | null } | null;
}

const keyOf = (t: FileLinkTarget) => `${t.kind}:${t.id}`;

/** Подписи ссылок одним запросом на вид записи; ключ — `вид:номер`. */
export async function fileLinkLabels(
  tx: Tx,
  targets: readonly FileLinkTarget[],
): Promise<Map<string, FileLinkLabel>> {
  const out = new Map<string, FileLinkLabel>();
  const byKind = new Map<FileLinkSourceKind, string[]>();
  for (const t of targets) {
    if (!UUID.test(t.id)) continue;
    byKind.set(t.kind, [...(byKind.get(t.kind) ?? []), t.id]);
  }
  const base = {
    date: null,
    amount: null,
    total: null,
    name: null,
    parentId: null,
    op: null,
    report: null,
  };
  const reportOf = (r: {
    short: string | null;
    period: string | null;
    start: string | null;
    event: string | null;
  }) =>
    r.short && r.period && r.start
      ? {
          short: r.short,
          period: r.period as ReportPeriod,
          start: r.start as IsoDate,
          event: (r.event as IsoDate | null) ?? null,
        }
      : null;
  for (const [kind, ids] of byKind) {
    if (kind === 'receipt' || kind === 'tax_payment' || kind === 'money_operation') {
      const opKind =
        kind === 'receipt'
          ? eq(moneyOperations.kind, 'in')
          : kind === 'tax_payment'
            ? eq(moneyOperations.kind, 'pay')
            : sql`${moneyOperations.kind} not in ('in', 'pay')`;
      const rows = await tx
        .select({
          id: moneyOperations.id,
          op: moneyOperations.kind,
          date: moneyOperations.opDate,
          amount: moneyOperations.amount,
          total: moneyOperations.total,
          short: reportTypes.shortName,
          period: reports.period,
          start: reports.periodStart,
          event: reports.eventDate,
        })
        .from(moneyOperations)
        .leftJoin(reports, eq(reports.id, moneyOperations.reportId))
        .leftJoin(reportTypes, eq(reportTypes.code, reports.reportTypeCode))
        .where(and(inArray(moneyOperations.id, ids), opKind, isNull(moneyOperations.cancelledAt)));
      for (const r of rows) {
        out.set(keyOf({ kind, id: r.id }), {
          ...base,
          date: r.date as IsoDate,
          amount: Math.abs(Number(r.amount)),
          total: r.total === null ? null : Number(r.total),
          op: r.op,
          report: kind === 'tax_payment' ? reportOf(r) : null,
        });
      }
    } else if (kind === 'fee_payment') {
      const rows = await tx
        .select({ id: feePayments.id, date: feePayments.paidOn, amount: feePayments.amount })
        .from(feePayments)
        .where(and(inArray(feePayments.id, ids), isNull(feePayments.deletedAt)));
      for (const r of rows) {
        out.set(keyOf({ kind, id: r.id }), {
          ...base,
          date: r.date as IsoDate,
          amount: Number(r.amount),
        });
      }
    } else if (kind === 'report') {
      const rows = await tx
        .select({
          id: reports.id,
          short: reportTypes.shortName,
          period: reports.period,
          start: reports.periodStart,
          event: reports.eventDate,
        })
        .from(reports)
        .innerJoin(reportTypes, eq(reportTypes.code, reports.reportTypeCode))
        .where(inArray(reports.id, ids));
      for (const r of rows) out.set(keyOf({ kind, id: r.id }), { ...base, report: reportOf(r) });
    } else if (kind === 'one_off_service') {
      const rows = await tx
        .select({ id: oneOffServices.id, name: oneOffServices.name })
        .from(oneOffServices)
        .where(and(inArray(oneOffServices.id, ids), isNull(oneOffServices.deletedAt)));
      for (const r of rows) out.set(keyOf({ kind, id: r.id }), { ...base, name: r.name });
    } else if (kind === 'one_off_service_payment') {
      const rows = await tx
        .select({
          id: oneOffServicePayments.id,
          date: oneOffServicePayments.paidOn,
          amount: oneOffServicePayments.amount,
          name: oneOffServices.name,
          parentId: oneOffServices.id,
        })
        .from(oneOffServicePayments)
        .innerJoin(oneOffServices, eq(oneOffServices.id, oneOffServicePayments.serviceId))
        .where(
          and(
            inArray(oneOffServicePayments.id, ids),
            isNull(oneOffServicePayments.deletedAt),
            isNull(oneOffServices.deletedAt),
          ),
        );
      for (const r of rows) {
        out.set(keyOf({ kind, id: r.id }), {
          ...base,
          date: r.date as IsoDate,
          amount: Number(r.amount),
          name: r.name,
          parentId: r.parentId,
        });
      }
    } else if (kind === 'project') {
      const rows = await tx
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(inArray(projects.id, ids));
      for (const r of rows) {
        out.set(keyOf({ kind, id: r.id }), { ...base, name: r.name, parentId: r.id });
      }
    } else if (kind === 'project_payment') {
      const rows = await tx
        .select({
          id: projectPayments.id,
          date: projectPayments.paidOn,
          amount: projectPayments.amount,
          name: projects.name,
          parentId: projects.id,
        })
        .from(projectPayments)
        .innerJoin(projects, eq(projects.id, projectPayments.projectId))
        .where(and(inArray(projectPayments.id, ids), isNull(projectPayments.deletedAt)));
      for (const r of rows) {
        out.set(keyOf({ kind, id: r.id }), {
          ...base,
          date: r.date as IsoDate,
          amount: Number(r.amount),
          name: r.name,
          parentId: r.parentId,
        });
      }
    }
  }
  return out;
}

export const fileLinkKey = keyOf;

/**
 * Контрагент формы новой записи для окна «Из файлов контрагента» (прототип v124 `fPickBind`: записи ещё
 * нет, файлы прикрепятся после её сохранения): только в области `scope` (группа «Файловый менеджер»);
 * нет или вне области — null.
 */
export async function linkContractor(
  tx: Tx,
  id: string,
  scope: SQL | undefined,
): Promise<{ id: string; name: string; responsibleEmployeeId: string | null } | null> {
  const [row] = await tx
    .select({
      id: contractors.id,
      name: contractors.name,
      responsibleEmployeeId: contractors.responsibleEmployeeId,
    })
    .from(contractors)
    .where(and(eq(contractors.id, id), scope));
  return row ?? null;
}

/** Название контрагента для заголовка окна «Из файлов контрагента». */
export async function linkContractorName(tx: Tx, id: string): Promise<string> {
  const [row] = await tx
    .select({ name: contractors.name })
    .from(contractors)
    .where(eq(contractors.id, id));
  return row?.name ?? '';
}
