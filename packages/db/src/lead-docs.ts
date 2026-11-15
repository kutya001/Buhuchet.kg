import {
  LEAD_DOCS_BY_FORM,
  LEAD_DOCS_KEEP_DAYS,
  LEAD_DRAFT_HOURS,
  type LeadDocKind,
  type OrgLegalForm,
} from '@buhuchet/domain';
import { asc, eq, like, sql } from 'drizzle-orm';
import { bigint, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { adminOrganizations } from './admin-orgs';
import { adminUsers } from './admin-users';
import type { Db, Tx } from './client';
import { ownershipForms } from './schema';

/*
 * Документы заявки с лендинга (доработки 14.11.2026, блок 1; прототип v114 modules/lead-docs.js;
 * миграция 0150). До отправки заявки документы — черновик (`platform_lead_uploads`): файл ложится по
 * подписанной ссылке под ключ `leads/upload/<номер>`, сервер проверяет первые байты и разбирает его.
 * Отправка переносит документы черновика в заявку (`platform_lead_docs`, ключ `leads/<заявка>/<номер>`:
 * файлы копирует API после транзакции), «Одобрить» — в файлы новой организации. Таблицы роль приложения
 * не видит: только функции базы `app.lead_upload_*`, `app.lead_submit_docs`, `app.lead_docs_*`,
 * `app.lead_purge_*`; Админка читает документы представлением `app.admin_lead_docs`.
 */

type Exec = Db | Tx;

/** Ключ хранилища загрузки черновика (до отправки заявки). */
export function leadUploadKey(id: string): string {
  return `leads/upload/${id}`;
}

/** Ключ хранилища документа заявки — как в ограничении `platform_lead_docs_key_check`. */
export function leadDocKey(leadId: string, docId: string): string {
  return `leads/${leadId}/${docId}`;
}

/**
 * Начать загрузку документа формы: строка черновика. Нет живого черновика — новый номер; прежний
 * файл того же вида заменяется (`replaced` — его номер: файл в хранилище удаляет вызывающий).
 */
export async function startLeadUpload(
  db: Exec,
  p: {
    draft: string | null;
    id: string;
    kind: LeadDocKind;
    name: string;
    size: number;
    now: Date;
  },
): Promise<{ draft: string; replaced: string | null }> {
  const rows = await db.execute<{ draft: string; replaced: string | null }>(sql`
    select draft, replaced from app.lead_upload_start(${p.draft}::uuid, ${p.id}::uuid, ${p.kind},
      ${p.name}, ${p.size}::bigint, ${p.now.toISOString()}::timestamptz, ${LEAD_DRAFT_HOURS})`);
  const row = rows[0];
  if (!row) throw new Error('app.lead_upload_start: нет ответа');
  return { draft: row.draft, replaced: row.replaced };
}

export interface LeadUpload {
  kind: LeadDocKind;
  name: string;
  sizeBytes: number;
  state: 'pending' | 'ready';
  createdAt: Date;
}

/** Загрузка черновика по номеру загрузки и черновика; нет такой — null. */
export async function leadUploadOf(
  db: Exec,
  id: string,
  draft: string,
): Promise<LeadUpload | null> {
  const rows = await db.execute<{
    kind: LeadDocKind;
    name: string;
    size_bytes: string | number;
    state: 'pending' | 'ready';
    created_at: string | Date;
  }>(sql`select * from app.lead_upload_of(${id}::uuid, ${draft}::uuid)`);
  const row = rows[0];
  return row
    ? {
        kind: row.kind,
        name: row.name,
        sizeBytes: Number(row.size_bytes),
        state: row.state,
        createdAt: new Date(row.created_at),
      }
    : null;
}

/** Файл проверен и разобран: `doc` — что нашёл разбор (null — не распознан). */
export async function markLeadUploadRead(
  db: Exec,
  id: string,
  draft: string,
  doc: unknown,
): Promise<boolean> {
  const rows = await db.execute<{ ok: boolean }>(sql`
    select app.lead_upload_read(${id}::uuid, ${draft}::uuid,
      ${doc === null ? null : JSON.stringify(doc)}::jsonb) as ok`);
  return rows[0]?.ok === true;
}

/** Файл не PDF или не загрузился: строка черновика убирается. */
export async function dropLeadUpload(db: Exec, id: string, draft: string): Promise<boolean> {
  const rows = await db.execute<{ ok: boolean }>(
    sql`select app.lead_upload_drop(${id}::uuid, ${draft}::uuid) as ok`,
  );
  return rows[0]?.ok === true;
}

export interface LeadDraftDoc {
  id: string;
  kind: LeadDocKind;
  name: string;
  sizeBytes: number;
  state: 'pending' | 'ready';
  /** Что нашёл разбор; null — не распознан или ещё не разобран. */
  doc: unknown;
}

/** Документы живого черновика по порядку выбора. */
export async function leadDraftDocs(db: Exec, draft: string, now: Date): Promise<LeadDraftDoc[]> {
  const rows = await db.execute<{
    id: string;
    kind: LeadDocKind;
    name: string;
    size_bytes: string | number;
    state: 'pending' | 'ready';
    doc: unknown;
  }>(sql`select * from app.lead_upload_docs(${draft}::uuid, ${now.toISOString()}::timestamptz,
    ${LEAD_DRAFT_HOURS})`);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    name: r.name,
    sizeBytes: Number(r.size_bytes),
    state: r.state,
    doc: r.doc ?? null,
  }));
}

/** Черновик не стал документами заявки: строки убираются; номера — чтобы удалить файлы. */
export async function discardLeadDraft(db: Exec, draft: string): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(
    sql`select id from app.lead_upload_discard(${draft}::uuid) as id`,
  );
  return rows.map((r) => r.id);
}

export interface LeadDocsSubmission {
  leadId: string;
  /** Момент заявки — тот же, что у `submitLead`: документы получает только только что созданная заявка. */
  now: Date;
  form: OrgLegalForm;
  inn: string;
  okpo: string;
  address: string;
  head: string;
  draft: string;
}

/**
 * Новая заявка с документами (в транзакции `submitLead`, сразу после `app.lead_submit`): форма и данные
 * из документов, документы черновика — в заявку строками `pending` (файлы копирует вызывающий после
 * транзакции), лишние файлы черновика — `dropped`. Не все документы формы проверены — `missing`
 * (вызывающий откатывает заявку).
 */
export async function submitLeadDocs(
  tx: Tx,
  p: LeadDocsSubmission,
): Promise<{ missing: true } | { missing: false; docs: string[]; dropped: string[] }> {
  const need = LEAD_DOCS_BY_FORM[p.form];
  const rows = await tx.execute<{ outcome: 'missing' | 'doc' | 'drop'; upload_id: string | null }>(
    sql`select outcome, upload_id from app.lead_submit_docs(${p.leadId}::uuid,
      ${p.now.toISOString()}::timestamptz, ${p.form}, ${p.inn}, ${p.okpo}, ${p.address}, ${p.head},
      ${p.draft}::uuid, ${sql`array[${sql.join(
        need.map((k) => sql`${k}`),
        sql`, `,
      )}]::text[]`}, ${LEAD_DOCS_KEEP_DAYS}, ${LEAD_DRAFT_HOURS})`,
  );
  if (rows.some((r) => r.outcome === 'missing')) return { missing: true };
  return {
    missing: false,
    docs: rows.filter((r) => r.outcome === 'doc').map((r) => r.upload_id!),
    dropped: rows.filter((r) => r.outcome === 'drop').map((r) => r.upload_id!),
  };
}

/**
 * Файлы документов скопированы под ключи заявки и проверены: документы — `ready`. Ответ — состояние
 * документов заявки (`ready`, когда загружены все).
 */
export async function leadDocsReady(
  db: Exec,
  leadId: string,
  ids: readonly string[],
): Promise<'ready' | 'pending' | null> {
  const rows = await db.execute<{ state: 'ready' | 'pending' | null }>(sql`
    select app.lead_docs_ready(${leadId}::uuid, ${sql`array[${sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    )}]::uuid[]`}) as state`);
  return rows[0]?.state ?? null;
}

const uuidArray = (ids: readonly string[]) =>
  ids.length
    ? sql`array[${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )}]::uuid[]`
    : sql`'{}'::uuid[]`;

/** Что пора удалить: черновики старше суток и документы заявок с наступившим сроком хранения. */
export async function leadPurgeDue(
  db: Exec,
  now: Date,
  limit: number,
): Promise<{ kind: 'upload' | 'doc'; id: string; storageKey: string }[]> {
  const rows = await db.execute<{ kind: 'upload' | 'doc'; id: string; storage_key: string }>(sql`
    select kind, id, storage_key from app.lead_purge_due(${now.toISOString()}::timestamptz,
      ${LEAD_DRAFT_HOURS}, ${limit})`);
  return rows.map((r) => ({ kind: r.kind, id: r.id, storageKey: r.storage_key }));
}

/**
 * Файлы удалены из хранилища — строки тоже; заявка без документов получает «файлы удалены» и запись
 * истории. Ответ — у скольких заявок удалены файлы.
 */
export async function leadPurgeDone(
  db: Exec,
  now: Date,
  uploads: readonly string[],
  docs: readonly string[],
): Promise<number> {
  const rows = await db.execute<{ n: number }>(sql`
    select app.lead_purge_done(${now.toISOString()}::timestamptz, ${LEAD_DRAFT_HOURS},
      ${uuidArray(uploads)}, ${uuidArray(docs)}) as n`);
  return Number(rows[0]?.n ?? 0);
}

/**
 * «Одобрить»: документы заявки — файлы новой организации с источником «Заявка на подключение», загрузил
 * — владелец. Только в транзакции создания организации администратором платформы, после
 * `connectLeadToOrganization`; `files` — пары «документ — номер нового файла» (файлы уже скопированы
 * вызывающим под ключи организации). Ответ — ключи документов заявки (их файлы удаляются после
 * транзакции).
 */
export async function leadDocsToOrganization(
  tx: Tx,
  p: { leadId: string; orgId: string; ownerUserId: string; files: { doc: string; file: string }[] },
): Promise<{ docId: string; storageKey: string }[]> {
  const rows = await tx.execute<{ doc_id: string; storage_key: string }>(sql`
    select doc_id, storage_key from app.lead_docs_to_org(${p.leadId}::uuid, ${p.orgId}::uuid,
      ${p.ownerUserId}::uuid, ${JSON.stringify(p.files)}::jsonb)`);
  return rows.map((r) => ({ docId: r.doc_id, storageKey: r.storage_key }));
}

const app = pgSchema('app');

/** Документы заявок для Админки (только администратору платформы). */
export const adminLeadDocsView = app
  .view('admin_lead_docs', {
    id: uuid('id').notNull(),
    leadId: uuid('lead_id').notNull(),
    kind: text('kind').$type<LeadDocKind>().notNull(),
    name: text('name').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    state: text('state').$type<'pending' | 'ready'>().notNull(),
    storageKey: text('storage_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  })
  .existing();

export type AdminLeadDoc = typeof adminLeadDocsView.$inferSelect;

/** Документы заявки по порядку видов формы; не администратору — пусто. */
export async function adminLeadDocs(tx: Tx, leadId: string): Promise<AdminLeadDoc[]> {
  const v = adminLeadDocsView;
  return tx
    .select()
    .from(v)
    .where(eq(v.leadId, leadId))
    .orderBy(
      sql`array_position(array['gns_cert', 'extract', 'minjust_cert']::text[], ${v.kind})`,
      asc(v.createdAt),
    );
}

/**
 * «ИНН и форма» организации — только администратор платформы (функция базы сверяет его и версию).
 * Новая версия; null — не администратор, организации нет или её уже изменили. Занятый ИНН — ошибка
 * уникальности `organizations_inn_unique`.
 */
export async function adminSetOrgInnForm(
  tx: Tx,
  p: { orgId: string; inn: string; legalForm: OrgLegalForm; version: number },
): Promise<number | null> {
  const rows = await tx.execute<{ v: number | null }>(sql`
    select app.admin_set_org_inn_form(${p.orgId}::uuid, ${p.inn}, ${p.legalForm},
      ${p.version}::integer) as v`);
  return rows[0]?.v ?? null;
}

/**
 * Организация платформы с этим ИНН (причина «Одобрить» неактивна, прототип v114 ldApproveWhy); null —
 * нет или в контексте не администратор платформы.
 */
export async function adminOrgByInn(
  tx: Tx,
  inn: string,
): Promise<{ id: string; name: string } | null> {
  const [row] = await tx
    .select({ id: adminOrganizations.id, name: adminOrganizations.name })
    .from(adminOrganizations)
    .where(eq(adminOrganizations.inn, inn))
    .limit(1);
  return row ?? null;
}

/** Логины платформы, которые начинаются с `base` (логин владельца в окне «Одобрить» — без повтора). */
export async function adminLoginsLike(tx: Tx, base: string): Promise<Set<string>> {
  const pattern = `${base.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const rows = await tx
    .select({ login: adminUsers.login })
    .from(adminUsers)
    .where(like(adminUsers.login, pattern));
  return new Set(rows.map((r) => r.login));
}

/**
 * Формы собственности для разбора документов заявки (прототип v114 ldParse → rdToCp): справочник
 * платформы читается без организации; налоговые и ГКЭД заявке не нужны.
 */
export async function leadRdForms(db: Db) {
  return db
    .select({
      code: ownershipForms.code,
      name: ownershipForms.name,
      fullName: ownershipForms.fullName,
      shortName: ownershipForms.shortName,
      active: ownershipForms.active,
    })
    .from(ownershipForms)
    .orderBy(asc(ownershipForms.sortOrder));
}
