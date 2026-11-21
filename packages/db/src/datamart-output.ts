import type { DM_COLUMN_TYPES, DmParamDef } from '@buhuchet/domain';
import { sql } from 'drizzle-orm';
import type { Tx } from './client';

/*
 * «Витрина данных» → «Вывод» и «Шаблоны» (доработки 20.11.2026: Витрина данных, блоки 3–4; блок 8,
 * пункт 1; общий план 20.11, этап 2, П3–П4): какие шаблоны видны, текст запроса шаблона для
 * исполнителя, контрагенты области «Свои» и журнал запросов. Права сотрудника на шаблон (`dmTemplateSeen`)
 * проверяет API, доступ организации к шаблону — база (RLS `dm_templates_org_read`).
 */

/** Параметр шаблона в базе (`dm_templates.params`). */
export interface DmTemplateParam {
  code: string;
  name: string;
  type: DmParamDef['type'];
  required: boolean;
  default: string | null;
}

/** Столбец шаблона в базе (`dm_templates.columns`); `contractor` — столбец «Контрагент» области «Свои». */
export interface DmTemplateColumn {
  code: string;
  name: string;
  type: (typeof DM_COLUMN_TYPES)[number];
  total: boolean;
  contractor: boolean;
}

/** Параметры шаблона из базы — в вид `dmBind` (`@buhuchet/domain`). */
export const dmParamDefsOf = (params: readonly DmTemplateParam[]): DmParamDef[] =>
  params.map((p) => ({ k: p.code, type: p.type, req: p.required, def: p.default }));

/** Шаблон «Вывода»: всё, кроме текста запроса. */
export interface DmOutputTemplate {
  id: string;
  code: string;
  name: string;
  description: string | null;
  audience: 'org' | 'admin';
  module: string | null;
  needPermission: string | null;
  state: 'published' | 'broken';
  params: DmTemplateParam[];
  columns: DmTemplateColumn[];
}

type TemplateRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  audience: 'org' | 'admin';
  module: string | null;
  need_permission: string | null;
  state: 'published' | 'broken';
  params: DmTemplateParam[];
  columns: DmTemplateColumn[];
};

const asTemplate = (r: TemplateRow): DmOutputTemplate => ({
  id: r.id,
  code: r.code,
  name: r.name,
  description: r.description,
  audience: r.audience,
  module: r.module,
  needPermission: r.need_permission,
  state: r.state,
  params: r.params,
  columns: r.columns,
});

/**
 * Шаблоны «Вывода» по названию (прототип `dmOutList`): опубликованные и сломанные. В контексте
 * организации база отдаёт только шаблоны «Для организаций» с её доступом; администратору платформы — все
 * (`audience` — только шаблоны этого вида: у Админки «глазами организации» — `org`).
 */
export async function dmOutputTemplates(
  tx: Tx,
  audience?: 'org' | 'admin',
): Promise<DmOutputTemplate[]> {
  const rows = await tx.execute<TemplateRow>(sql`
    select d.id, d.code, d.name, d.description, d.audience, d.module, d.need_permission, d.state,
      d.params, d.columns
    from public.dm_templates d
    where d.state in ('published', 'broken')
      and (${audience ?? null}::text is null or d.audience = ${audience ?? null}::text)
    order by d.name, d.code`);
  return rows.map(asTemplate);
}

/** Шаблон «Вывода» по коду (те же правила, что у списка); нет или не виден — null. */
export async function dmOutputTemplate(
  tx: Tx,
  code: string,
  audience?: 'org' | 'admin',
): Promise<DmOutputTemplate | null> {
  const [row] = await tx.execute<TemplateRow>(sql`
    select d.id, d.code, d.name, d.description, d.audience, d.module, d.need_permission, d.state,
      d.params, d.columns
    from public.dm_templates d
    where d.code = ${code} and d.state in ('published', 'broken')
      and (${audience ?? null}::text is null or d.audience = ${audience ?? null}::text)`);
  return row ? asTemplate(row) : null;
}

/**
 * Текст запроса шаблона для исполнителя (`app.dm_template_query`, миграция 0171): организации — только
 * опубликованного шаблона с её доступом, администратору платформы — любого; иначе null. Наружу текст не
 * отдаётся.
 */
export async function dmTemplateQuery(tx: Tx, templateId: string): Promise<string | null> {
  const [row] = await tx.execute<{ query: string | null }>(
    sql`select app.dm_template_query(${templateId}::uuid) as query`,
  );
  return row?.query ?? null;
}

/** Текст ошибки последней проверки шаблона — только администратору платформы (RLS `dm_template_sql`). */
export async function dmTemplateCheckError(tx: Tx, templateId: string): Promise<string | null> {
  const [row] = await tx.execute<{ check_error: string | null }>(
    sql`select check_error from public.dm_template_sql where template_id = ${templateId}::uuid`,
  );
  return row?.check_error ?? null;
}

/**
 * Контрагенты области «Свои» (прототип `dmRun`: `CPM[r._cp].resp === S.me`): ответственный — этот
 * сотрудник; правило то же, что у списка контрагентов (`contractorScope`).
 */
export async function dmOwnContractorIds(tx: Tx, employeeId: string): Promise<string[]> {
  const rows = await tx.execute<{ id: string }>(
    sql`select id from public.contractors where responsible_employee_id = ${employeeId}::uuid`,
  );
  return rows.map((r) => r.id);
}

/** Строка журнала запросов (блок 6, пункт 7). */
export interface DmRequestEntry {
  /** `screen` — «Вывод», `api` — внешний адрес по токену. */
  via: 'screen' | 'api';
  templateId: string | null;
  tokenId: string | null;
  /** Параметры запроса как пришли (после отбора по шаблону). */
  params: Record<string, string | null>;
  rows: number | null;
  ms: number | null;
  outcome: 'ok' | 'denied' | 'bad_param' | 'rate' | 'timeout' | 'broken' | 'closed' | 'error';
  /** Текст ошибки для журнала (до 300 знаков); без текста запроса. */
  error: string | null;
  ip: string | null;
}

/**
 * Записать запрос в журнал (`app.dm_request_log`, миграция 0171): организация и сотрудник — из контекста
 * транзакции. Запуск шаблона откатывается целиком, поэтому журнал пишется своей транзакцией после него.
 */
export async function logDmRequest(tx: Tx, e: DmRequestEntry): Promise<number> {
  const [row] = await tx.execute<{ id: string | number }>(sql`
    select app.dm_request_log(${e.via}, ${e.templateId}::uuid, ${e.tokenId}::uuid,
      ${JSON.stringify(e.params)}::jsonb, ${e.rows}::integer, ${e.ms}::integer, ${e.outcome},
      ${e.error}, ${e.ip}) as id`);
  return Number(row!.id);
}
