import {
  auditActorName,
  DICT_REQUEST_DICTS,
  DICT_REQUEST_STATUSES,
  type DictRequestAnswer,
  type DictRequestDict,
  type DictRequestStatus,
  type ListQuery,
} from '@buhuchet/domain';
import { eq, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { Tx } from './client';
import {
  auditActorValue,
  selectListExport,
  selectListPage,
  selectListValues,
  type ListColumns,
  type ListFrom,
  type ListPageResult,
  type ListTexts,
} from './list';
import { writePlatformHistory } from './platform-history';
import { textLiteral } from './sql-text';

/**
 * Запросы «Попросить добавить» всех организаций для Админки → «Справочники платформы» → «Запросы»
 * (миграция 0035): представление от владельца схемы, строки — только администратору платформы.
 * Объявлено здесь, а не в `schema/`: представление создаёт SQL-миграция, drizzle-kit его не ведёт.
 */
export const adminDictChangeRequests = pgSchema('app')
  .view('admin_dict_change_requests', {
    id: uuid('id').notNull(),
    orgId: uuid('org_id').notNull(),
    orgName: text('org_name').notNull(),
    dict: text('dict').notNull(),
    what: text('what').notNull(),
    comment: text('comment').notNull(),
    status: text('status').notNull(),
    answer: text('answer').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    createdBy: uuid('created_by').notNull(),
    createdByName: text('created_by_name'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedBy: uuid('decided_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    version: integer('version').notNull(),
  })
  .existing();

const v = adminDictChangeRequests;

/** Запрос в списке Админки: организация, справочник, что просили, кто отправил, статус и ответ. */
export interface AdminDictRequestRecord {
  id: string;
  orgName: string;
  dict: DictRequestDict;
  what: string;
  comment: string;
  status: DictRequestStatus;
  answer: string;
  decidedAt: Date | null;
  audit: { createdAt: Date; createdBy: string | null; updatedAt: Date; updatedBy: string | null };
  version: number;
}

const fields = {
  id: v.id,
  orgName: v.orgName,
  dict: v.dict,
  what: v.what,
  comment: v.comment,
  status: v.status,
  answer: v.answer,
  createdAt: v.createdAt,
  createdBy: v.createdBy,
  createdByName: v.createdByName,
  decidedAt: v.decidedAt,
  decidedBy: v.decidedBy,
  updatedAt: v.updatedAt,
  version: v.version,
};

type Row = { [K in keyof typeof fields]: (typeof fields)[K]['_']['data'] | null };

/** «Создал» — сотрудник, который отправил запрос; «Изменил» — ответивший администратор платформы. */
function toRecord(r: Row): AdminDictRequestRecord {
  const createdBy = auditActorName(r.createdBy, r.createdByName);
  return {
    id: r.id!,
    orgName: r.orgName!,
    dict: r.dict as DictRequestDict,
    what: r.what!,
    comment: r.comment!,
    status: r.status as DictRequestStatus,
    answer: r.answer!,
    decidedAt: r.decidedAt,
    audit: {
      createdAt: r.createdAt!,
      createdBy,
      updatedAt: r.updatedAt!,
      updatedBy: auditActorName(r.decidedBy, null) ?? createdBy,
    },
    version: r.version!,
  };
}

const CREATED_BY = auditActorValue(v.createdBy, v.createdByName);
const NO_NAME: SQL = sql`null::text`;

/** Подпись кода по словарю (только в `display`: тексты словаря — параметрами запроса). */
const labelCase = (
  column: AnyColumn,
  codes: readonly string[],
  key: (c: string) => string,
  t: ListTexts,
) =>
  sql`case ${column} ${sql.join(
    codes.map((c) => sql`when ${textLiteral(c)} then ${t(key(c))}`),
    sql` `,
  )} else ${column} end`;

/** Порядок кодов для сортировки: место в списке (коды — постоянные из домена). */
const orderCase = (column: AnyColumn, codes: readonly string[]) =>
  sql`case ${column} ${sql.join(
    codes.map((c, i) => sql`when ${textLiteral(c)} then ${sql.raw(String(i))}`),
    sql` `,
  )} end`;

/**
 * Столбцы «Запросов» на сервере (прототип v59 renderPDicts0 и reqCols): «Дата», «Организация»,
 * «Справочник», «Что добавить», «Комментарий», «Отправил», «Статус» («Новый» выше «Добавлено» и
 * «Отклонено»), «Ответ»; служебные — общие.
 */
export function adminDictRequestListColumns(t: ListTexts): ListColumns {
  return {
    at: { type: 'date', label: 'pdicts.req.col.at', value: v.createdAt },
    org: { type: 'enum', label: 'pdicts.req.col.org', value: v.orgName },
    dict: {
      type: 'enum',
      label: 'pdicts.req.col.dict',
      value: v.dict,
      display: labelCase(v.dict, DICT_REQUEST_DICTS, (d) => `dicts.platform.dict.${d}`, t),
      sort: { value: orderCase(v.dict, DICT_REQUEST_DICTS), text: false },
    },
    what: { type: 'text', label: 'pdicts.req.col.what', value: v.what },
    comment: { type: 'text', label: 'pdicts.req.col.comment', value: v.comment },
    by: { type: 'enum', label: 'pdicts.req.col.by', value: CREATED_BY },
    status: {
      type: 'enum',
      label: 'pdicts.req.col.status',
      value: v.status,
      display: labelCase(v.status, DICT_REQUEST_STATUSES, (x) => `dicts.req.status.${x}`, t),
      sort: { value: orderCase(v.status, DICT_REQUEST_STATUSES), text: false },
    },
    answer: { type: 'text', label: 'pdicts.req.col.answer', value: v.answer },
    createdAt: { type: 'datetime', label: 'grid.col.created_at', value: v.createdAt },
    updatedAt: { type: 'datetime', label: 'grid.col.updated_at', value: v.updatedAt },
    createdBy: { type: 'enum', label: 'grid.col.created_by', value: CREATED_BY },
    updatedBy: {
      type: 'enum',
      label: 'grid.col.updated_by',
      value: sql`coalesce(${auditActorValue(v.decidedBy, NO_NAME)}, ${CREATED_BY})`,
    },
  };
}

const NATURAL = [v.createdAt, v.id];

function requestsFrom(tx: Tx): ListFrom {
  return (f) => tx.select(f).from(v).$dynamic();
}

/** Страница «Запросов»: сортировка, страница, фильтры, поиск и группы — на сервере. */
export async function listAdminDictRequestsPage(
  tx: Tx,
  query: ListQuery,
  t: ListTexts,
): Promise<ListPageResult<AdminDictRequestRecord>> {
  const page = await selectListPage({
    query,
    columns: adminDictRequestListColumns(t),
    natural: NATURAL,
    scope: undefined,
    select: ({ window, where, orderBy, limit, offset }) =>
      tx
        .select({ ...fields, ...window })
        .from(v)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset),
    from: requestsFrom(tx),
  });
  return { ...page, rows: page.rows.map((r) => toRecord(r)) };
}

/** Значения столбца «Запросов» для фильтра-галочек; `q` — «Найти значение». */
export function listAdminDictRequestValues(tx: Tx, key: string, t: ListTexts, q?: string) {
  return selectListValues({
    columns: adminDictRequestListColumns(t),
    key,
    scope: undefined,
    from: requestsFrom(tx),
    q,
  });
}

/** «Запросы» для выгрузки в Excel. */
export function exportAdminDictRequests(
  tx: Tx,
  query: ListQuery,
  keys: readonly string[],
  t: ListTexts,
) {
  return selectListExport({
    query,
    columns: adminDictRequestListColumns(t),
    keys,
    natural: NATURAL,
    scope: undefined,
    from: requestsFrom(tx),
  });
}

/** Один запрос; нет такого или не администратор — null. */
export async function getAdminDictRequest(
  tx: Tx,
  id: string,
): Promise<AdminDictRequestRecord | null> {
  const [row] = await tx.select(fields).from(v).where(eq(v.id, id));
  return row ? toRecord(row) : null;
}

/** Сколько новых запросов — число на вкладке «Запросы» (прототип pdTabs). */
export async function countNewDictRequests(tx: Tx): Promise<number> {
  return tx.$count(v, eq(v.status, 'new'));
}

export type AdminDictRequestAnswerResult =
  { ok: true; record: AdminDictRequestRecord } | { ok: false; reason: 'not_found' | 'changed' };

/**
 * «Добавлено» / «Отклонить» (прототип v59 reqAnswerDlg): статус и ответ организации; ответ при отказе
 * проверяет вызывающий (`dictRequestAnswerProblem`). «Было → стало» — в историю платформы
 * (`dict_request`, ключ — номер запроса). Устаревшая версия — `changed`.
 */
export async function adminAnswerDictRequest(
  tx: Tx,
  input: { id: string; status: DictRequestAnswer; answer: string; version: number },
): Promise<AdminDictRequestAnswerResult> {
  const before = await getAdminDictRequest(tx, input.id);
  if (!before) return { ok: false, reason: 'not_found' };
  if (before.version !== input.version) return { ok: false, reason: 'changed' };
  const answer = input.answer.trim();
  const [row] = await tx.execute<{ version: number | null }>(
    sql`select app.admin_answer_dict_request(${input.id}, ${input.status}, ${answer}, ${input.version}) as version`,
  );
  if (row?.version == null) return { ok: false, reason: 'changed' };
  await writePlatformHistory(tx, {
    entity: 'dict_request',
    entityId: input.id,
    action: 'update',
    changes: [
      { field: 'status', from: before.status, to: input.status },
      ...(before.answer === answer ? [] : [{ field: 'answer', from: before.answer, to: answer }]),
    ],
  });
  const after = await getAdminDictRequest(tx, input.id);
  return after ? { ok: true, record: after } : { ok: false, reason: 'not_found' };
}
