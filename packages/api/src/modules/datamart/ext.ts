import { createHash } from 'node:crypto';
import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import {
  dmExtTarget,
  dmOutputTemplate,
  dmTemplateQuery,
  dmTokenFacts,
  DM_ROWS_MAX,
  orgMenuSettings,
  releaseDmExt,
  takeDmExt,
  withOrgContext,
  withUserContext,
  type DmRequestEntry,
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
  type AccessSubject,
  type DmModule,
  type Feature,
} from '@buhuchet/domain';
import { ApiError, DmExtAnswer, DmExtCodeParam } from '@buhuchet/shared';
import type { Context } from 'hono';
import { clientIpSubject, clientIpText } from '../../client-ip';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiError } from '../../errors';
import { serverTexts } from '../l10n/texts';
import { logDmRun, runDmTemplate, type DmRunWho } from './run';

/*
 * Внешний адрес «Витрины данных» GET /api/ext/v1/<код шаблона> (доработки 20.11.2026: Витрина данных,
 * блок 6; блок 8, пункты 1, 5, 6; поток Т, этап 2, П11; прототип v155 `dmHow`; docs/decisions.md п. Т-20).
 * Метод без входа (`PUBLIC_PATTERNS` в middleware/session.ts): cookie не читаются, кто просит — токен в
 * заголовке `Authorization: Bearer bk_…`. По порядку:
 *   1. токен в адресе не принимается (400), заголовок не похож на токен — «Токен не подходит» без базы;
 *   2. `app.dm_ext_target` (0172): адрес, приславший 20 неизвестных токенов за 10 минут, ждёт (429);
 *      токен ищется по хешу; другой код шаблона — «Токен не подходит или истёк»;
 *   3. состояние — тем же правилом `dmTokenState`, что вкладка «API Токены», по фактам в контексте
 *      токена (его организация, кто создал): отозван или истёк — 401; шаблон сломан — 503; остановлен
 *      (шаблон выключен, нет доступа, блокировка, подписка, «Внешний доступ по API», функция модуля
 *      выключена) — 403 «Доступ остановлен»;
 *   4. пределы токена `app.dm_ext_take`: один одновременно, 30 в минуту, 5 000 в сутки (429);
 *   5. параметры адреса — только свои коды шаблона, по типам (`dmBind`), лишние отбрасываются;
 *   6. запуск — общим путём «Вывода» `runDmTemplate` (этап 2, П4) от имени организации токена и его
 *      создателя: только чтение, 15 с, 50 000 строк; строки всей организации, как у владельца (область
 *      «Свои» — у сотрудника, у токена её нет: выпуск строже, docs/deviations.md п. Т-26);
 *   7. строка журнала (`app.dm_request_log`) — у каждого известного токена, с итогом и адресом: исходы
 *      запуска пишет `runDmTemplate`, отказы до него — этот метод (`logDmRun`).
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

type Outcome = DmRequestEntry['outcome'];
type Tr = (key: string, params?: Record<string, string | number>) => string;

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

/** Контекст токена: его организация и кто создал; у токена Админки — администратор, создавший его. */
function inWho<T>(deps: ApiDeps, who: DmRunWho, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return who.kind === 'org'
    ? withOrgContext(deps.db, { orgId: who.orgId, userId: who.userId }, fn)
    : withUserContext(deps.db, who.adminId, fn);
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
      ip: clientIpSubject(c, deps, 'dm_ext'),
      badMax: DM_EXT_BAD_MAX,
      badWindowSeconds: DM_EXT_BAD_WINDOW_SECONDS,
    });
    if (target.outcome === 'ip_wait') return rate(target.waitSeconds);
    if (target.outcome === 'unknown') return denied();

    const now = deps.clock.now();
    const today = bishkekDate(now);
    const ip = clientIpText(c);
    const who: DmRunWho = target.orgId
      ? { kind: 'org', orgId: target.orgId, userId: target.createdBy }
      : { kind: 'admin', adminId: target.createdBy };
    let given: Record<string, string> = {};
    const log = (outcome: Outcome, error: string) =>
      logDmRun(deps, who, {
        via: 'api',
        templateId: target.templateId,
        tokenId: target.tokenId,
        params: given,
        rows: null,
        ms: null,
        outcome,
        error,
        ip,
      });

    // Токен другого шаблона — тот же ответ, что неизвестный (адрес шаблона не подтверждается).
    if (target.templateCode !== code) {
      await log('denied', tr('err.dm_ext_token'));
      return denied();
    }
    // Состояние — по часам базы и тем же фактам, что у вкладки «API Токены»; шаблон и его текст — в
    // контексте токена (доступ организации к шаблону проверяет база).
    const seen = await inWho(deps, who, async (tx) => {
      const facts = await dmTokenFacts(tx, { since: now, today, id: target.tokenId });
      const fact = facts.items[0];
      if (!fact) return null;
      const features = fact.orgId ? (await orgMenuSettings(tx, fact.orgId)).features : null;
      const template = await dmOutputTemplate(tx, code, fact.orgId ? 'org' : 'admin');
      const query = template ? await dmTemplateQuery(tx, template.id) : null;
      return { now: facts.now, fact, features, template, query };
    });
    // Токен Админки, чей создатель больше не администратор платформы: фактов в его контексте нет.
    const stopped = tr('err.dm_ext_stopped');
    if (!seen) return fail(c, 403, 'dm_ext_stopped', stopped);
    const { fact, template } = seen;
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
    if (st.state === 'revoked' || st.state === 'expired') {
      await log('denied', tr('err.dm_ext_token'));
      return denied();
    }
    const broken = tr('err.dm_ext_broken');
    if (st.stop === 'tpl_broken') {
      await log('broken', broken);
      return fail(c, 503, 'dm_ext_broken', broken);
    }
    const offByFeature =
      fact.orgId !== null &&
      (!template ||
        !dmTemplateSeen(
          {
            audience: 'org',
            state: fact.templateState,
            module: isModule(template.module) ? template.module : null,
            needPermission: template.needPermission,
            columns: template.columns,
          },
          ORG_AS_OWNER,
          (seen.features ?? {}) as Partial<Record<Feature, boolean>>,
        ));
    if (st.state === 'stopped' || offByFeature || !template) {
      await log('closed', stopped);
      return fail(c, 403, 'dm_ext_stopped', stopped);
    }
    if (!seen.query) {
      await log('broken', broken);
      return fail(c, 503, 'dm_ext_broken', broken);
    }

    const slot = await takeDmExt(deps.db, target.tokenId, {
      perMinute: DM_EXT_PER_MINUTE,
      perDay: DM_EXT_PER_DAY,
      leaseSeconds: DM_EXT_LEASE_SECONDS,
    });
    if (!slot.ok) {
      await log('rate', tr('err.dm_ext_rate', { n: slot.waitSeconds }));
      return rate(slot.waitSeconds);
    }
    try {
      const req = dmExtRequest(
        entries,
        template.params.map((p) => p.code),
      );
      const badParam = (param: string) =>
        fail(c, 400, 'dm_ext_param', tr('err.dm_ext_param', { param }));
      if (!req.ok) {
        await log('bad_param', tr('err.dm_ext_param', { param: req.param }));
        return badParam(req.param);
      }
      given = req.input;
      const out = await runDmTemplate(deps, {
        template,
        query: seen.query,
        input: req.input,
        who,
        ownContractorIds: null,
        via: 'api',
        tokenId: target.tokenId,
        ip,
        maxRows: DM_ROWS_MAX,
        today,
      });
      if (!out.ok) {
        if (out.outcome === 'bad_param') return badParam(out.param);
        if (out.outcome === 'timeout') {
          return fail(c, 504, 'dm_ext_timeout', tr('err.dm_ext_timeout'));
        }
        deps.logger.warn(
          { requestId: c.get('requestId'), template: code, db: out.adminDetail },
          'Витрина: шаблон не выполнился по токену',
        );
        return fail(c, 503, 'dm_ext_broken', broken);
      }
      // Значения параметров для ссылки на следующую страницу: из адреса или по умолчанию на сегодня.
      const shown: Record<string, string | null> = {};
      for (const p of template.params) {
        shown[p.code] = Object.hasOwn(req.input, p.code)
          ? req.input[p.code]!
          : dmParamDefault(p.default, today);
      }
      return answer(c, deps, {
        code,
        req,
        cols: dmExtColumns(out.columns),
        result: { columns: out.columns.map((col) => col.code), rows: out.rows, more: out.more },
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
    result: { columns: string[]; rows: unknown[][]; more: boolean };
    shown: Record<string, string | null>;
  },
) {
  const total = o.result.rows.length;
  const page = dmExtPage(total, o.req.page, o.req.limit);
  const rows = dmExtRows(o.result, o.cols, page.from, page.to);
  let next: string | null = null;
  if (page.hasNext) {
    const url = new URL(`${DM_EXT_PATH}${o.code}`, deps.config.APP_BASE_URL);
    for (const [k, v] of Object.entries(o.shown)) if (v) url.searchParams.set(k, v);
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
