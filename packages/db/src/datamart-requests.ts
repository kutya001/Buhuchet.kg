import type { ListQuery } from '@buhuchet/domain';
import { eq, sql, type SQL } from 'drizzle-orm';
import { adminOrganizations } from './admin-orgs';
import type { Tx } from './client';
import {
  selectListExport,
  selectListPage,
  selectListValues,
  type ListColumns,
  type ListFrom,
  type ListPageResult,
  type ListTexts,
  type ListWindowFields,
} from './list';
import { dmRequests, dmTemplates, dmTokens } from './schema';

/*
 * Админка → «Витрина данных» → «Журнал запросов» (доработки 20.11.2026: Витрина данных, блок 6,
 * пункт 7; поток Т, этап 2, П11; прототип v155 `renderDmLog`): все запросы внешних программ по токенам
 * (`via = 'api'`) за 90 дней — когда, итог, организация, токен, шаблон, параметры, строк, время, ошибка,
 * адрес. Видит только администратор платформы (RLS `dm_requests_admin_read`, `dm_tokens_admin`,
 * `dm_templates_admin`, `app.admin_organizations`) — в `withUserContext`; остальным списки пусты.
 */

const r = dmRequests;
const k = dmTokens;
const tpl = dmTemplates;
const o = adminOrganizations;

/** Параметры строкой «month=2026-11&status=…» в порядке хранения (прототип `x.params`). */
const PARAMS_TEXT = sql`coalesce((select string_agg(e.key || '=' || coalesce(e.value, ''), '&' order by e.n) from jsonb_each_text(${r.params}) with ordinality as e(key, value, n)), '')`;

const RES_VALUE = sql`(case when ${r.outcome} = 'ok' then 'ok' else 'err' end)`;

/** Организация запроса; у токена Админки — «Администратор платформы» (как в «API Токенах»). */
function orgDisplay(t: ListTexts): SQL {
  return sql`coalesce(${o.name}, ${t('dm.tok.who_admin')}::text)`;
}

/** Столбцы журнала (прототип grid `dm-log`): ключи — как у столбцов экрана. */
export function dmRequestColumns(t: ListTexts): ListColumns {
  return {
    at: { type: 'datetime', label: 'dm.log.col.at', value: r.at },
    res: {
      type: 'enum',
      label: 'dm.log.col.res',
      value: RES_VALUE,
      display: sql`(case when ${r.outcome} = 'ok' then ${t('dm.res.ok')}::text else ${t('dm.res.error')}::text end)`,
    },
    org: {
      type: 'enum',
      label: 'dm.log.col.org',
      value: sql`coalesce(${r.orgId}::text, 'admin')`,
      display: orgDisplay(t),
      sort: { value: o.name, text: true },
    },
    tok: {
      type: 'text',
      label: 'dm.log.col.tok',
      value: k.name,
      searchDisplay: sql`concat_ws(' ', ${k.name}, ${k.prefix})`,
    },
    tpl: { type: 'enum', label: 'dm.log.col.tpl', value: tpl.name },
    params: { type: 'text', label: 'dm.log.col.params', value: PARAMS_TEXT },
    rows: { type: 'int', label: 'dm.log.col.rows', value: r.rowCount },
    ms: { type: 'int', label: 'dm.log.col.ms', value: r.durationMs },
    err: { type: 'text', label: 'dm.log.col.err', value: r.error },
    ip: { type: 'text', label: 'dm.log.col.ip', value: r.ip },
  };
}

/** Только запросы по токенам: «Вывод» сотрудника сюда не попадает. */
const SCOPE = eq(r.via, 'api');
const NATURAL = [r.at, r.id];
const DEFAULT_SORT = { key: 'at', dir: 'desc' } as const;

function requestsFrom(tx: Tx): ListFrom {
  return (f) =>
    tx
      .select(f)
      .from(r)
      .leftJoin(k, eq(k.id, r.tokenId))
      .leftJoin(tpl, eq(tpl.id, r.templateId))
      .leftJoin(o, eq(o.id, r.orgId))
      .$dynamic();
}

/** Строка журнала для экрана: подписи — готовым текстом, как в ячейках. */
export interface DmRequestListRow {
  id: number;
  at: Date;
  outcome: string;
  orgName: string;
  tokenId: string | null;
  tokenName: string | null;
  prefix: string | null;
  tplName: string | null;
  params: string;
  rows: number | null;
  ms: number | null;
  error: string | null;
  ip: string | null;
}

/** Страница журнала. Не администратору платформы — пусто. */
export async function listDmRequestsPage(
  tx: Tx,
  query: ListQuery,
  t: ListTexts,
): Promise<ListPageResult<DmRequestListRow>> {
  const page = await selectListPage({
    query,
    columns: dmRequestColumns(t),
    natural: NATURAL,
    defaultSort: DEFAULT_SORT,
    scope: SCOPE,
    select: ({ window, where, orderBy, limit, offset }) =>
      tx
        .select({
          id: r.id,
          at: r.at,
          outcome: r.outcome,
          orgName: orgDisplay(t),
          tokenId: r.tokenId,
          tokenName: k.name,
          prefix: k.prefix,
          tplName: tpl.name,
          params: PARAMS_TEXT,
          rows: r.rowCount,
          ms: r.durationMs,
          error: r.error,
          ip: r.ip,
          ...(window as ListWindowFields),
        })
        .from(r)
        .leftJoin(k, eq(k.id, r.tokenId))
        .leftJoin(tpl, eq(tpl.id, r.templateId))
        .leftJoin(o, eq(o.id, r.orgId))
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset) as unknown as Promise<
        (DmRequestListRow & {
          listTotal: number;
          listTotals: Record<string, number> | null;
          listGroups: string[] | null;
        })[]
      >,
    from: requestsFrom(tx),
  });
  return {
    ...page,
    rows: page.rows.map((x) => ({
      ...x,
      id: Number(x.id),
      orgName: String(x.orgName ?? ''),
      params: String(x.params ?? ''),
    })),
  };
}

export function listDmRequestValues(tx: Tx, key: string, t: ListTexts, q?: string) {
  return selectListValues({
    columns: dmRequestColumns(t),
    key,
    scope: SCOPE,
    from: requestsFrom(tx),
    ...(q !== undefined ? { q } : {}),
  });
}

export function exportDmRequests(tx: Tx, query: ListQuery, keys: readonly string[], t: ListTexts) {
  return selectListExport({
    query,
    columns: dmRequestColumns(t),
    keys,
    natural: NATURAL,
    defaultSort: DEFAULT_SORT,
    scope: SCOPE,
    from: requestsFrom(tx),
  });
}

/**
 * Плашки «Запросов сегодня» и «Ошибок сегодня» (прототип `renderDmLog`): день — по Бишкеку и по часам
 * базы, как отметки `at` строк журнала.
 */
export async function dmRequestsToday(tx: Tx): Promise<{ today: number; errors: number }> {
  const [row] = await tx.execute<{ n: number; errors: number }>(sql`
    select count(*)::integer as n, count(*) filter (where outcome <> 'ok')::integer as errors
    from public.dm_requests
    where via = 'api'
      and at >= date_trunc('day', now() at time zone 'Asia/Bishkek') at time zone 'Asia/Bishkek'`);
  return { today: Number(row?.n ?? 0), errors: Number(row?.errors ?? 0) };
}
