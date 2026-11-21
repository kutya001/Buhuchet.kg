import { createHash } from 'node:crypto';
import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import {
  dmErrorOf,
  dmExtTarget,
  dmRequestLog,
  dmTokenFacts,
  DM_ROWS_MAX,
  orgMenuSettings,
  queryTimedOut,
  releaseDmExt,
  runDmAdmin,
  runDmOrg,
  takeDmExt,
  withOrgContext,
  withUserContext,
  type DmExtTarget,
  type DmRequestLogEntry,
  type DmResult,
  type Tx,
} from '@buhuchet/db';
import {
  bishkekDate,
  DM_EXT_BAD_MAX,
  DM_EXT_BAD_WINDOW_SECONDS,
  DM_EXT_LEASE_SECONDS,
  DM_EXT_PAGE,
  DM_EXT_PATH,
  DM_EXT_PER_DAY,
  DM_EXT_PER_MINUTE,
  DM_MODULES,
  DM_TOKEN_RE,
  dmBind,
  dmExtColumns,
  dmExtCsv,
  dmExtPage,
  dmExtRequest,
  dmExtRows,
  dmExtTokenInQuery,
  dmParamDefault,
  dmTemplateSeen,
  dmTokenState,
  formatText,
  isDmParamType,
  type AccessSubject,
  type DmModule,
  type DmParamDef,
  type Feature,
} from '@buhuchet/domain';
import { ApiError, DmExtAnswer, DmExtCodeParam } from '@buhuchet/shared';
import type { Context } from 'hono';
import { clientIpSubject, clientIpText } from '../../client-ip';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiError } from '../../errors';
import { serverTexts } from '../l10n/texts';

/*
 * Внешний адрес «Витрины данных» GET /api/ext/v1/<код шаблона> (доработки 20.11.2026: Витрина данных,
 * блок 6; блок 8, пункты 1, 5, 6; поток Т, этап 2, П11; прототип v155 `dmHow`; docs/decisions.md п. Т-20).
 * Метод без входа (`PUBLIC_PATTERNS` в middleware/session.ts): cookie не читаются, кто просит — токен в
 * заголовке `Authorization: Bearer bk_…`. По порядку:
 *   1. токен в адресе не принимается (400), заголовок не похож на токен — «Токен не подходит» без базы;
 *   2. `app.dm_ext_target`: адрес, приславший 20 неизвестных токенов за 10 минут, ждёт (429); токен
 *      ищется по хешу; другой код шаблона — «Токен не подходит или истёк»;
 *   3. состояние — тем же правилом `dmTokenState`, что вкладка «API Токены», по фактам в контексте
 *      токена (его организация, кто создал): отозван или истёк — 401; шаблон сломан — 503; остановлен
 *      (шаблон выключен, нет доступа, блокировка, подписка, «Внешний доступ по API», функция модуля
 *      выключена) — 403 «Доступ остановлен»;
 *   4. пределы токена `app.dm_ext_take`: один одновременно, 30 в минуту, 5 000 в сутки (429);
 *   5. параметры адреса — только свои коды шаблона, по типам (`dmBind`), лишние отбрасываются;
 *   6. запуск — исполнителем 0166 (`runDmOrg` от имени организации токена / `runDmAdmin`): только чтение,
 *      15 с, 50 000 строк; строки всей организации, как у владельца (область «Свои» — у сотрудника, у
 *      токена её нет: выпуск строже, docs/deviations.md п. Т-26);
 *   7. строка журнала (`app.dm_request_log`) — у каждого известного токена, с итогом и адресом.
 * Ответ — JSON прототипа (столбцы, строки, всего, следующая страница) или CSV.
 */

const error = { 'application/json': { schema: ApiError } };

export const EXT_ROUTE = createRoute({
  method: 'get',
  path: '/ext/v1/{code}',
  tags: ['datamart'],
  summary: 'Витрина данных: результат шаблона по API-токену (только чтение)',
  description:
    'Токен — только в заголовке Authorization: Bearer bk_…; параметры шаблона — в адресе (?month=2026-11), format=csv — таблица, page и limit — страница (1 000 строк, до 5 000).',
  request: { params: DmExtCodeParam },
  responses: {
    200: {
      description: 'Страница результата',
      content: {
        'application/json': { schema: DmExtAnswer },
        'text/csv': { schema: z.string() },
      },
    },
    400: { description: 'Неверный параметр или токен в адресе', content: error },
    401: { description: 'Токен не подходит или истёк', content: error },
    403: { description: 'Доступ остановлен', content: error },
    429: { description: 'Слишком часто: повторить через Retry-After секунд', content: error },
    503: { description: 'Шаблон временно не работает', content: error },
    504: { description: 'Запрос выполнялся слишком долго', content: error },
  },
});

type Outcome = DmRequestLogEntry['outcome'];
type Tr = (key: string, params?: Record<string, string | number>) => string;
type Known = Extract<DmExtTarget, { outcome: 'ok' }>;

/** Организация смотрит «глазами владельца»: функции модулей, а не права сотрудника (у токена их нет). */
const ORG_AS_OWNER: AccessSubject = {
  employeeId: '',
  isOwner: true,
  permissions: new Set(),
  scopes: {},
};

const isModule = (m: string | null): m is DmModule =>
  m !== null && (DM_MODULES as readonly string[]).includes(m);

/** Токен из заголовка «Authorization: Bearer bk_…»; другое — null. */
function bearerOf(header: string | undefined): string | null {
  const m = /^Bearer[ ]+(\S+)[ ]*$/i.exec(header ?? '');
  return m && DM_TOKEN_RE.test(m[1]!) ? m[1]! : null;
}

/** Параметры шаблона из базы (`[{ code, type, required, default }]`) — в вид `dmBind`. */
function paramDefsOf(raw: unknown): DmParamDef[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((p: unknown) => {
    if (typeof p !== 'object' || p === null) return [];
    const { code, type, required, default: def } = p as Record<string, unknown>;
    if (typeof code !== 'string' || typeof type !== 'string' || !isDmParamType(type)) return [];
    return [{ k: code, type, req: required === true, def: typeof def === 'string' ? def : null }];
  });
}

/** Контекст токена: его организация и кто создал; у токена Админки — администратор, создавший его. */
function inToken<T>(deps: ApiDeps, k: Known, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return k.orgId
    ? withOrgContext(deps.db, { orgId: k.orgId, userId: k.createdBy }, fn)
    : withUserContext(deps.db, k.createdBy, fn);
}

function fail(
  c: Context<AppEnv>,
  status: 400 | 401 | 403 | 429 | 503 | 504,
  code: string,
  message: string,
  wait?: number,
) {
  if (status === 401) c.header('www-authenticate', 'Bearer');
  if (wait !== undefined) c.header('retry-after', String(wait));
  return c.json(apiError(code, message, wait === undefined ? undefined : { wait }), status);
}

export function extHandler(deps: ApiDeps): RouteHandler<typeof EXT_ROUTE, AppEnv> {
  return async (c) => {
    const { code } = c.req.valid('param');
    const t = await serverTexts(deps);
    const tr: Tr = (key, params) => formatText(t(key), params);
    const entries = [...new URL(c.req.url).searchParams.entries()];
    if (dmExtTokenInQuery(entries)) {
      return fail(c, 400, 'dm_ext_token_in_url', tr('err.dm_ext_token_in_url'));
    }
    const token = bearerOf(c.req.header('authorization'));
    const denied = () => fail(c, 401, 'dm_ext_token', tr('err.dm_ext_token'));
    const rate = (n: number) => fail(c, 429, 'dm_ext_rate', tr('err.dm_ext_rate', { n }), n);
    if (!token) return denied();
    const target = await dmExtTarget(deps.db, {
      tokenHash: createHash('sha256').update(token, 'utf8').digest('hex'),
      code,
      ip: clientIpSubject(c, deps, 'dm_ext'),
      badMax: DM_EXT_BAD_MAX,
      badWindowSeconds: DM_EXT_BAD_WINDOW_SECONDS,
    });
    if (target.outcome === 'ip_wait') return rate(target.waitSeconds);
    if (target.outcome === 'unknown') return denied();

    const now = deps.clock.now();
    const today = bishkekDate(now);
    const ip = clientIpText(c);
    const defs = paramDefsOf(target.template?.params);
    const shown: Record<string, string | null> = {};
    const log = (outcome: Outcome, extra: Partial<DmRequestLogEntry> = {}) =>
      inToken(deps, target, (tx) =>
        dmRequestLog(tx, {
          via: 'api',
          templateId: target.templateId,
          tokenId: target.tokenId,
          params: shown,
          rows: null,
          ms: null,
          outcome,
          error: null,
          ip,
          ...extra,
        }),
      );

    // Состояние — по часам базы и тем же фактам, что у вкладки «API Токены».
    const seen = await inToken(deps, target, async (tx) => {
      const facts = await dmTokenFacts(tx, { since: now, today, id: target.tokenId });
      const fact = facts.items[0];
      if (!fact) return null;
      const features = fact.orgId ? (await orgMenuSettings(tx, fact.orgId)).features : null;
      return { now: facts.now, fact, features };
    });
    // Токен Админки, чей создатель больше не администратор платформы: фактов в его контексте нет.
    const stopped = tr('err.dm_ext_stopped');
    if (!seen) return fail(c, 403, 'dm_ext_stopped', stopped);
    const { fact } = seen;
    const st = dmTokenState(
      {
        expiresAt: fact.expiresAt,
        revokedAt: fact.revokedAt,
        graceUntil: fact.graceUntil,
        admin: fact.orgId === null,
        templateState: fact.templateState,
        templateAccess: fact.templateAccess,
        orgBlocked: fact.orgBlocked,
        subClosed: fact.subClosed,
        extApi: fact.extApi,
      },
      seen.now,
    );
    const tpl = target.template;
    if (st.state === 'revoked' || st.state === 'expired' || !tpl) {
      await log('denied', { error: tr('err.dm_ext_token') });
      return denied();
    }
    const broken = tr('err.dm_ext_broken');
    if (st.stop === 'tpl_broken' || !tpl.query) {
      await log('broken', { error: broken });
      return fail(c, 503, 'dm_ext_broken', broken);
    }
    const offByFeature =
      fact.orgId !== null &&
      !dmTemplateSeen(
        {
          audience: 'org',
          state: fact.templateState,
          module: isModule(target.module) ? target.module : null,
          needPermission: target.needPermission,
          columns: tpl.columns,
        },
        ORG_AS_OWNER,
        (seen.features ?? {}) as Partial<Record<Feature, boolean>>,
      );
    if (st.state === 'stopped' || offByFeature) {
      await log('closed', { error: stopped });
      return fail(c, 403, 'dm_ext_stopped', stopped);
    }

    const slot = await takeDmExt(deps.db, target.tokenId, {
      perMinute: DM_EXT_PER_MINUTE,
      perDay: DM_EXT_PER_DAY,
      leaseSeconds: DM_EXT_LEASE_SECONDS,
    });
    if (!slot.ok) {
      await log('rate', { error: tr('err.dm_ext_rate', { n: slot.waitSeconds }) });
      return rate(slot.waitSeconds);
    }
    try {
      const req = dmExtRequest(
        entries,
        defs.map((d) => d.k),
      );
      const badParam = async (param: string) => {
        const message = tr('err.dm_ext_param', { param });
        await log('bad_param', { error: message });
        return fail(c, 400, 'dm_ext_param', message);
      };
      if (!req.ok) return await badParam(req.param);
      for (const d of defs) {
        const v = Object.hasOwn(req.input, d.k) ? req.input[d.k]! : dmParamDefault(d.def, today);
        shown[d.k] = v === '' ? null : v;
      }
      const bound = dmBind(tpl.query, defs, req.input, today);
      if (!bound.ok) {
        if (bound.error === 'param') return await badParam(bound.param);
        await log('broken', { error: broken });
        return fail(c, 503, 'dm_ext_broken', broken);
      }
      let result: DmResult;
      try {
        const q = { text: bound.text, params: bound.params, maxRows: DM_ROWS_MAX };
        result = target.orgId
          ? await runDmOrg(deps.db, { orgId: target.orgId, userId: target.createdBy }, q)
          : await runDmAdmin(deps.db, target.createdBy, q);
      } catch (err) {
        if (queryTimedOut(err)) {
          const message = tr('err.dm_ext_timeout');
          await log('timeout', { error: message });
          return fail(c, 504, 'dm_ext_timeout', message);
        }
        if (dmErrorOf(err)) {
          deps.logger.warn(
            { requestId: c.get('requestId'), template: target.templateCode, db: dmErrorOf(err) },
            'Витрина: шаблон не выполнился по токену',
          );
          await log('broken', { error: broken });
          return fail(c, 503, 'dm_ext_broken', broken);
        }
        await log('error');
        throw err;
      }
      await log('ok', { rows: result.rows.length, ms: result.ms });
      return answer(c, deps, {
        code,
        req,
        cols: dmExtColumns(tpl.columns),
        result,
        shown,
      });
    } finally {
      await releaseDmExt(deps.db, target.tokenId, slot.ticket);
    }
  };
}

/** Ответ страницы: JSON прототипа или CSV; ссылка на следующую — от адреса сайта, не от заголовка Host. */
function answer(
  c: Context<AppEnv>,
  deps: ApiDeps,
  o: {
    code: string;
    req: Extract<ReturnType<typeof dmExtRequest>, { ok: true }>;
    cols: ReturnType<typeof dmExtColumns>;
    result: DmResult;
    shown: Record<string, string | null>;
  },
) {
  const total = o.result.rows.length;
  const page = dmExtPage(total, o.req.page, o.req.limit);
  const rows = dmExtRows(o.result, o.cols, page.from, page.to);
  let next: string | null = null;
  if (page.hasNext) {
    const url = new URL(`${DM_EXT_PATH}${o.code}`, deps.config.APP_BASE_URL);
    for (const [k, v] of Object.entries(o.shown)) if (v !== null) url.searchParams.set(k, v);
    if (o.req.format === 'csv') url.searchParams.set('format', 'csv');
    if (o.req.limit !== DM_EXT_PAGE) url.searchParams.set('limit', String(o.req.limit));
    url.searchParams.set('page', String(o.req.page + 1));
    next = url.href;
  }
  if (o.result.more) c.header('x-dm-more', 'true');
  if (o.req.format === 'csv') {
    if (next) c.header('link', `<${next}>; rel="next"`);
    c.header('x-dm-total', String(total));
    return c.body(dmExtCsv(o.cols, rows), 200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `inline; filename="${o.code}.csv"`,
    });
  }
  return c.json(
    {
      columns: o.cols,
      rows,
      total,
      next,
      ...(o.result.more ? { more: true as const } : {}),
    },
    200,
  );
}
