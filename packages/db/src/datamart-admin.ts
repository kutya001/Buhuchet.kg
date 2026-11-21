import {
  RecordChangedError,
  RecordNotFoundError,
  type DmTemplateState,
  type ListQuery,
  type ListSort,
} from '@buhuchet/domain';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from './client';
import type { DmTemplateColumn, DmTemplateParam } from './datamart-output';
import {
  selectListExport,
  selectListPage,
  selectListValues,
  type ListColumns,
  type ListFrom,
} from './list';

/*
 * Админка → «Витрина данных» → «Шаблоны» (доработки 20.11.2026: Витрина данных, блок 2, пункты 2–7;
 * блок 3, пункт 1; общий план 20.11, этап 2, П3; прототип v155 `modules/vitrina.js`: `renderDmTplAdm`,
 * `dmEdit`, `dmCopy`, `dmStateDlg`, `dmUse`). Всё — в `withUserContext` администратора платформы: шаблоны,
 * текст запроса (`dm_template_sql`) и выбранные организации (`dm_template_orgs`) видит и меняет только
 * он (RLS). История — история платформы (`platform_audit_log`, `dm_template`), её пишет API в той же
 * транзакции. Список — строки, посчитанные API (токены и организации по фактам), одним параметром
 * (`jsonb_to_recordset`), как «API Токены».
 */

const asDate = (v: unknown): Date | null =>
  v === null || v === undefined ? null : v instanceof Date ? v : new Date(String(v));
const mustDate = (v: unknown): Date => asDate(v) ?? new Date(NaN);

/** Шаблон в Админке целиком: с текстом запроса, итогом проверки и выбранными организациями. */
export interface DmAdminTemplate {
  id: string;
  code: string;
  name: string;
  description: string | null;
  audience: 'org' | 'admin';
  module: string | null;
  needPermission: string | null;
  access: 'all' | 'selected';
  state: DmTemplateState;
  /** Готовый шаблон платформы (блок 7): только смотреть, проверять, отключать и копировать. */
  builtin: boolean;
  copiedFrom: string | null;
  copiedFromName: string | null;
  params: DmTemplateParam[];
  columns: DmTemplateColumn[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
  query: string;
  checkedAt: Date | null;
  checkedOrgId: string | null;
  checkedOrgName: string | null;
  /** Текст базы последней неудачной проверки (у «Сломан»). */
  checkError: string | null;
  /** Выбранные организации (доступ «Выбранные»). */
  orgIds: string[];
}

type AdminRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  audience: 'org' | 'admin';
  module: string | null;
  need_permission: string | null;
  access: 'all' | 'selected';
  state: DmTemplateState;
  builtin: boolean;
  copied_from: string | null;
  copied_from_name: string | null;
  params: DmTemplateParam[];
  columns: DmTemplateColumn[];
  version: number;
  created_at: unknown;
  updated_at: unknown;
  query: string | null;
  checked_at: unknown;
  checked_org_id: string | null;
  checked_org_name: string | null;
  check_error: string | null;
  org_ids: string[] | null;
};

const adminTemplateOf = (r: AdminRow): DmAdminTemplate => ({
  id: r.id,
  code: r.code,
  name: r.name,
  description: r.description,
  audience: r.audience,
  module: r.module,
  needPermission: r.need_permission,
  access: r.access,
  state: r.state,
  builtin: r.builtin,
  copiedFrom: r.copied_from,
  copiedFromName: r.copied_from_name,
  params: r.params,
  columns: r.columns,
  version: r.version,
  createdAt: mustDate(r.created_at),
  updatedAt: mustDate(r.updated_at),
  query: r.query ?? '',
  checkedAt: asDate(r.checked_at),
  checkedOrgId: r.checked_org_id,
  checkedOrgName: r.checked_org_name,
  checkError: r.check_error,
  orgIds: r.org_ids ?? [],
});

const adminSelect = (where: SQL, lock: boolean) => sql`
  select d.id, d.code, d.name, d.description, d.audience, d.module, d.need_permission, d.access,
    d.state, d.builtin, d.copied_from, c.name as copied_from_name, d.params, d.columns, d.version,
    d.created_at, d.updated_at, s.query, s.checked_at, s.checked_org_id, o.name as checked_org_name,
    s.check_error,
    array(select x.org_id from public.dm_template_orgs x where x.template_id = d.id
      order by x.org_id) as org_ids
  from public.dm_templates d
  left join public.dm_template_sql s on s.template_id = d.id
  left join public.dm_templates c on c.id = d.copied_from
  left join app.admin_organizations o on o.id = s.checked_org_id
  where ${where}
  order by d.name, d.code
  ${lock ? sql`for update of d` : sql``}`;

/** Все шаблоны для Админки по названию (не администратору — пусто: RLS). */
export async function dmAdminTemplates(tx: Tx): Promise<DmAdminTemplate[]> {
  const rows = await tx.execute<AdminRow>(adminSelect(sql`true`, false));
  return rows.map(adminTemplateOf);
}

/** Один шаблон; `lock` — строка шаблона блокируется до конца транзакции (правка, состояние). */
export async function dmAdminTemplate(
  tx: Tx,
  id: string,
  opts: { lock?: boolean } = {},
): Promise<DmAdminTemplate | null> {
  const [row] = await tx.execute<AdminRow>(adminSelect(sql`d.id = ${id}::uuid`, !!opts.lock));
  return row ? adminTemplateOf(row) : null;
}

/** Занятые коды шаблонов (код копии, «Такой код уже есть»). */
export async function dmTemplateCodes(tx: Tx): Promise<Set<string>> {
  const rows = await tx.execute<{ code: string }>(sql`select code from public.dm_templates`);
  return new Set(rows.map((r) => r.code));
}

/** Новые коды шаблонов — по одному до конца транзакции: две копии разом не получат один код. */
export async function lockDmTemplateCodes(tx: Tx): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('dm_templates:code', 0))`);
}

/**
 * Организации, которые пользовались шаблоном за период (прототип `dmUse`: живые токены и журнал
 * запросов по токенам): запросы журнала с `since` по токенам организаций; «Показать» с экрана (и
 * администратора «глазами организации») и запросы Админки к своим шаблонам не считаются.
 */
export async function dmTemplateRequestOrgs(
  tx: Tx,
  since: Date,
): Promise<Map<string, Set<string>>> {
  const rows = await tx.execute<{ template_id: string; org_id: string }>(sql`
    select distinct r.template_id, r.org_id
    from public.dm_requests r
    where r.at >= ${since.toISOString()}::timestamptz
      and r.via = 'api' and r.template_id is not null and r.org_id is not null`);
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = out.get(r.template_id) ?? new Set<string>();
    set.add(r.org_id);
    out.set(r.template_id, set);
  }
  return out;
}

/** Организации для доступа «Выбранные» и «Проверить на организации»: демо — первой (блок 3, пункт 1). */
export async function dmTemplateOrgOptions(
  tx: Tx,
): Promise<{ id: string; name: string; demo: boolean; blocked: boolean }[]> {
  const rows = await tx.execute<{ id: string; name: string; is_demo: boolean; status: string }>(sql`
    select o.id, o.name, o.is_demo, o.status from app.admin_organizations o
    order by o.is_demo desc, o.name collate app.ru_natural, o.id`);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    demo: r.is_demo,
    blocked: r.status === 'blocked',
  }));
}

/** Есть ли организация (для «Проверить на организации» и доступа «Выбранные»). */
export async function dmOrgsExist(tx: Tx, ids: readonly string[]): Promise<boolean> {
  if (ids.length === 0) return true;
  const [row] = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n from app.admin_organizations o
    where o.id = any(${`{${ids.join(',')}}`}::uuid[])`);
  return Number(row?.n ?? 0) === new Set(ids).size;
}

/** Поля шаблона из окна (то, что вводит администратор). */
export interface DmTemplateValues {
  code: string;
  name: string;
  description: string | null;
  audience: 'org' | 'admin';
  module: string | null;
  needPermission: string | null;
  access: 'all' | 'selected';
  params: DmTemplateParam[];
  columns: DmTemplateColumn[];
  query: string;
  orgIds: string[];
}

/** Итог проверки, который сохраняется с шаблоном («Проверен», у «Сломан» — текст базы). */
export interface DmTemplateCheckMark {
  orgId: string | null;
  error: string | null;
}

async function writeOrgs(tx: Tx, id: string, v: Pick<DmTemplateValues, 'access' | 'orgIds'>) {
  await tx.execute(sql`delete from public.dm_template_orgs where template_id = ${id}::uuid`);
  const ids = v.access === 'selected' ? [...new Set(v.orgIds)] : [];
  if (ids.length === 0) return;
  await tx.execute(sql`
    insert into public.dm_template_orgs (template_id, org_id, created_by)
    select ${id}::uuid, x, app.current_user_id()
    from unnest(${`{${ids.join(',')}}`}::uuid[]) as x`);
}

/**
 * Новый шаблон от имени администратора (готовым — только наполнение). `check` — запрос проверен сейчас
 * (при «Опубликовать»); иначе «Проверен» пусто.
 */
export async function insertDmTemplate(
  tx: Tx,
  v: DmTemplateValues & { state: DmTemplateState; copiedFrom?: string | null },
  check: DmTemplateCheckMark | null,
): Promise<string> {
  const [row] = await tx.execute<{ id: string }>(sql`
    insert into public.dm_templates (code, name, description, audience, params, columns, module,
      need_permission, access, state, builtin, copied_from, created_by, updated_by)
    values (${v.code}, ${v.name}, ${v.description}, ${v.audience}, ${JSON.stringify(v.params)}::jsonb,
      ${JSON.stringify(v.columns)}::jsonb, ${v.module}, ${v.needPermission}, ${v.access}, ${v.state},
      false, ${v.copiedFrom ?? null}::uuid, app.current_user_id(), app.current_user_id())
    returning id`);
  const id = row!.id;
  await tx.execute(sql`
    insert into public.dm_template_sql (template_id, query, checked_at, checked_org_id, check_error,
      updated_by)
    values (${id}::uuid, ${v.query}, ${check ? sql`now()` : null}, ${check?.orgId ?? null}::uuid,
      ${check?.error ?? null}, app.current_user_id())`);
  await writeOrgs(tx, id, v);
  return id;
}

/**
 * Сохранить шаблон по версии (строка уже заблокирована `dmAdminTemplate(…, { lock: true })`): устаревшая
 * версия — `RecordChangedError`. `check`: `undefined` — проверка не менялась, `null` — запрос изменился
 * без проверки («Проверен» пусто), иначе — проверен сейчас.
 */
export async function updateDmTemplate(
  tx: Tx,
  id: string,
  version: number,
  v: DmTemplateValues & { state: DmTemplateState },
  check: DmTemplateCheckMark | null | undefined,
): Promise<number> {
  const [row] = await tx.execute<{ version: number }>(sql`
    update public.dm_templates set code = ${v.code}, name = ${v.name},
      description = ${v.description}, audience = ${v.audience},
      params = ${JSON.stringify(v.params)}::jsonb, columns = ${JSON.stringify(v.columns)}::jsonb,
      module = ${v.module}, need_permission = ${v.needPermission}, access = ${v.access},
      state = ${v.state}, updated_by = app.current_user_id(), updated_at = now(),
      version = version + 1
    where id = ${id}::uuid and version = ${version}
    returning version`);
  if (!row) await versionMiss(tx, id);
  if (check === undefined) {
    await tx.execute(sql`
      update public.dm_template_sql set query = ${v.query}, updated_by = app.current_user_id(),
        updated_at = now()
      where template_id = ${id}::uuid`);
  } else {
    await tx.execute(sql`
      update public.dm_template_sql set query = ${v.query},
        checked_at = ${check ? sql`now()` : null}, checked_org_id = ${check?.orgId ?? null}::uuid,
        check_error = ${check?.error ?? null}, updated_by = app.current_user_id(), updated_at = now()
      where template_id = ${id}::uuid`);
  }
  await writeOrgs(tx, id, v);
  return row!.version;
}

/** Состояние по версии («Отключить», «Включить»): устаревшая версия — `RecordChangedError`. */
export async function setDmTemplateState(
  tx: Tx,
  id: string,
  version: number,
  state: DmTemplateState,
): Promise<number> {
  const [row] = await tx.execute<{ version: number }>(sql`
    update public.dm_templates set state = ${state}, updated_by = app.current_user_id(),
      updated_at = now(), version = version + 1
    where id = ${id}::uuid and version = ${version}
    returning version`);
  if (!row) await versionMiss(tx, id);
  return row!.version;
}

async function versionMiss(tx: Tx, id: string): Promise<never> {
  const [cur] = await tx.execute<{ version: number }>(
    sql`select version from public.dm_templates where id = ${id}::uuid`,
  );
  if (!cur) throw new RecordNotFoundError('dm_template', id);
  throw new RecordChangedError('dm_template', id, cur.version);
}

/** Запись истории шаблона для окна (прототип `t.hist`): сначала старые. */
export interface DmTemplateHistoryRow {
  at: Date;
  action: string;
  changes: { field: string; from?: unknown; to?: unknown }[];
  reason: string | null;
  actorUserId: string | null;
}

export async function dmTemplateHistory(tx: Tx, id: string): Promise<DmTemplateHistoryRow[]> {
  const rows = await tx.execute<{
    at: unknown;
    action: string;
    changes: DmTemplateHistoryRow['changes'];
    reason: string | null;
    actor_user_id: string | null;
  }>(sql`
    select h.at, h.action, h.changes, h.reason, h.actor_user_id
    from public.platform_audit_log h
    where h.entity = 'dm_template' and h.entity_id = ${id}
    order by h.at, h.id`);
  return rows.map((r) => ({
    at: mustDate(r.at),
    action: r.action,
    changes: r.changes ?? [],
    reason: r.reason,
    actorUserId: r.actor_user_id,
  }));
}

// ───── Список «Шаблоны» Админки ─────

/** Строка списка шаблонов: значения и подписи, как на экране (посчитаны API). */
export interface DmTemplateListRow {
  id: string;
  name: string;
  code: string;
  kind: string;
  kindText: string;
  state: string;
  stateText: string;
  stateRank: number;
  /** «Организаций пользуется»; у шаблона «Для администратора» — пусто. */
  orgs: number | null;
  toks: number;
  checked: string | null;
  mod: string;
  modText: string;
}

const field = (key: string) => sql.raw(`"r"."${key}"`);

const TEMPLATE_DEFS = [
  'id uuid',
  'name text',
  'code text',
  'kind text',
  'kind_text text',
  'state text',
  'state_text text',
  'state_rank integer',
  'orgs integer',
  'toks integer',
  'checked timestamptz',
  'mod text',
  'mod_text text',
].join(', ');

function templateRecordset(rows: readonly DmTemplateListRow[]): SQL {
  const json = rows.map((r) => ({
    id: r.id,
    name: r.name,
    code: r.code,
    kind: r.kind,
    kind_text: r.kindText,
    state: r.state,
    state_text: r.stateText,
    state_rank: r.stateRank,
    orgs: r.orgs,
    toks: r.toks,
    checked: r.checked,
    mod: r.mod,
    mod_text: r.modText,
  }));
  return sql`jsonb_to_recordset(${JSON.stringify(json)}::jsonb) as r(${sql.raw(TEMPLATE_DEFS)})`;
}

/** Столбцы списка «Шаблоны» (прототип grid `dm-tpl`): ключи — как у столбцов экрана. */
export const DM_TEMPLATE_COLUMNS: ListColumns = {
  name: { type: 'text', label: 'dm.tpl.col.name', value: field('name') },
  code: { type: 'text', label: 'dm.tpl.col.code', value: field('code') },
  kind: {
    type: 'enum',
    label: 'dm.tpl.col.kind',
    value: field('kind'),
    display: field('kind_text'),
  },
  state: {
    type: 'enum',
    label: 'dm.tpl.col.state',
    value: field('state'),
    display: field('state_text'),
    sort: { value: field('state_rank'), text: false },
  },
  orgs: { type: 'int', label: 'dm.tpl.col.orgs', value: field('orgs') },
  toks: { type: 'int', label: 'dm.tpl.col.toks', value: field('toks') },
  checked: { type: 'datetime', label: 'dm.tpl.col.checked', value: field('checked') },
  mod: { type: 'enum', label: 'dm.tpl.col.mod', value: field('mod'), display: field('mod_text') },
};

/** По названию (прототип `sort: {key: 'name', dir: 1}`). */
const TEMPLATE_SORT: ListSort = { key: 'name', dir: 'asc' };
const TEMPLATE_NATURAL = [field('name'), field('code')];

const fromOf =
  (tx: Tx, source: SQL): ListFrom =>
  (fields) =>
    tx.select(fields).from(source).$dynamic();

/** Страница списка шаблонов: номера строк по порядку страницы (остальное API берёт из своих строк). */
export function listDmTemplatesPage(tx: Tx, rows: readonly DmTemplateListRow[], query: ListQuery) {
  const source = templateRecordset(rows);
  return selectListPage({
    query,
    columns: DM_TEMPLATE_COLUMNS,
    natural: TEMPLATE_NATURAL,
    defaultSort: TEMPLATE_SORT,
    scope: undefined,
    select: ({ window, where, orderBy, limit, offset }) =>
      tx
        .select({ id: sql<string>`${field('id')}`, ...window })
        .from(source)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset),
    from: fromOf(tx, source),
  });
}

export function listDmTemplateValues(
  tx: Tx,
  rows: readonly DmTemplateListRow[],
  key: string,
  q?: string,
) {
  return selectListValues({
    columns: DM_TEMPLATE_COLUMNS,
    key,
    scope: undefined,
    from: fromOf(tx, templateRecordset(rows)),
    q,
  });
}

export function exportDmTemplates(
  tx: Tx,
  rows: readonly DmTemplateListRow[],
  query: ListQuery,
  keys: readonly string[],
) {
  return selectListExport({
    query,
    columns: DM_TEMPLATE_COLUMNS,
    keys,
    natural: TEMPLATE_NATURAL,
    defaultSort: TEMPLATE_SORT,
    scope: undefined,
    from: fromOf(tx, templateRecordset(rows)),
  });
}
