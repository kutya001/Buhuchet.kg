import { createHash, randomBytes } from 'node:crypto';
import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  dmTokenFacts,
  dmTokenRequests,
  dmTokenTemplateHow,
  dmTokenTemplates,
  exportDmTokens,
  insertDmToken,
  listDmTokensPage,
  listDmTokenValues,
  lockDmTokens,
  orgExtApi,
  orgMenuSettings,
  orgUsage,
  replaceDmToken,
  revokeDmToken,
  takeRateLimit,
  withOrgContext,
  withUserContext,
  writeHistory,
  writePlatformHistory,
  type DmTokenFact,
  type DmTokenListRow,
  type DmTokenTemplate,
  type RateLimit,
  type Tx,
} from '@buhuchet/db';
import {
  bishkekDate,
  DM_MODULES,
  DM_TOKEN_DEFAULT_TERM,
  DM_TOKEN_NAME_MAX,
  DM_TOKEN_TERMS,
  DM_TOKENS_LIVE_MAX,
  dmExtColumns,
  dmExtUrl,
  dmTemplateTokenable,
  dmTokenFromBytes,
  dmTokenIssueRefusal,
  dmTokenLive,
  dmTokenNameProblem,
  dmTokenPrefix,
  dmTokenState,
  dmTokenTermOf,
  formatMomentRu,
  formatText,
  RecordNotFoundError,
  type AccessSubject,
  type DmModule,
  type DmTokenState,
  type DmTokenStop,
  type Feature,
  type HistoryChange,
  type IsoDate,
} from '@buhuchet/domain';
import {
  ApiError,
  DmTokenCard,
  DmTokenCreate,
  DmTokenForm,
  DmTokenIdParam,
  DmTokenIssued,
  DmTokenList,
  ListExportParams,
  ListQueryParams,
  ListValues,
  ListValuesQuery,
  type DmTokenRow,
} from '@buhuchet/shared';
import type { Context, MiddlewareHandler } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, listQueryOf, listQueryResponses } from '../../errors';
import { exportRateResponses, withExportSlot, xlsxContent, xlsxResponse } from '../../lists/export';
import { orgContextOf, requirePermission, requirePlatformAdmin } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';

/*
 * «Витрина данных» → «API Токены» (доработки 20.11.2026: Витрина данных, блок 5; блок 8, пункт 6;
 * поток Т, этап 1, П14; прототип v153–v155 `modules/vitrina.js`: `renderDmTok`, `dmNewDlg`, `dmIssue`,
 * `dmShowTok`, `dmTokDlg`, `dmRevoke`, `dmReissue`, `dmTokSt`).
 *   Организация (`/api/dm/tokens`, право «Управлять API-токенами» — оно действует только вместе с
 *   «Просматривать витрину данных»): свои токены; выпуск — к шаблону, видимому сотруднику
 *   (`dmTemplateTokenable`: со столбцом «Контрагент» — только при «Все контрагенты», п. Т-26), не в
 *   демо, при «Внешнем доступе по API», без закрытия по подписке, не больше 20 действующих; отозвать
 *   и перевыпустить можно любой свой токен — он работает и после увольнения создателя. История —
 *   `audit_log` организации (`dm_token`).
 *   Админка (`/api/admin/dm/tokens`, только администратор платформы): свои токены к шаблонам «Для
 *   администратора» и токены всех организаций; токен организации можно только отозвать. История —
 *   история платформы.
 * Токен — «bk_» и 32 случайных байта; показывается один раз в ответе выпуска, в базе — SHA-256 и
 * начало. Отметки выпуска, отзыва и перевыпуска ставит база «сейчас» по своим часам, по ним же
 * считается состояние. Ответ внешней программе по токену — `ext.ts` (этап 2, П11). Решение —
 * docs/decisions.md п. Т-19.
 */

type Side = 'org' | 'admin';
type Texts = (key: string) => string;
type Tr = (key: string, params?: Record<string, string | number>) => string;

const error = { 'application/json': { schema: ApiError } };
const json = <T>(schema: T) => ({ 'application/json': { schema } });
const denied = {
  401: { description: 'Нет входа', content: error },
  403: { description: 'Нет права или не администратор платформы', content: error },
} as const;
const notFound = { 404: { description: 'Токен не найден', content: error } } as const;

interface SideDef {
  tags: string[];
  who: string;
  guard: MiddlewareHandler<AppEnv>[];
  exportGuard: MiddlewareHandler<AppEnv>[];
}

const SIDES: Record<Side, SideDef> = {
  org: {
    tags: ['datamart'],
    who: 'организации',
    guard: [requirePermission('dmTokens')],
    exportGuard: [requirePermission('dmTokens'), requirePermission('export')],
  },
  admin: {
    tags: ['admin'],
    who: 'Админки',
    guard: [requirePlatformAdmin],
    exportGuard: [requirePlatformAdmin],
  },
};

const STATE_RANK: Record<DmTokenState, number> = {
  active: 0,
  stopped: 1,
  expired: 2,
  revoked: 3,
};

const DAY_MS = 86_400_000;

/** Транзакция стороны: организация — в своём контексте, Админка — вне его, от администратора. */
function inSide<T>(
  deps: ApiDeps,
  c: Context<AppEnv>,
  side: Side,
  fn: (tx: Tx) => Promise<T>,
  kind: 'request' | 'export' = 'request',
): Promise<T> {
  return side === 'org'
    ? withOrgContext(deps.db, { ...orgContextOf(c), kind }, fn)
    : withUserContext(deps.db, c.get('session')!.userId, fn, kind);
}

/** «Сейчас» приложения до транзакции: «за 30 дней» и «сегодня» для подписки. */
interface Moment {
  since: Date;
  today: IsoDate;
}
const momentOf = (deps: ApiDeps): Moment => {
  const now = deps.clock.now();
  return { since: new Date(now.getTime() - 30 * DAY_MS), today: bishkekDate(now) };
};

const trOf =
  (t: Texts): Tr =>
  (key, params) =>
    formatText(t(key), params);

interface TokenView {
  fact: DmTokenFact;
  state: DmTokenState;
  stop: DmTokenStop | null;
  live: boolean;
  /** Свой: токен организации у неё, у Админки — без организации. */
  mine: boolean;
  row: DmTokenRow;
  list: DmTokenListRow;
}

/** Состояние токена по фактам базы (прототип `dmTokSt`). */
const stateOf = (f: DmTokenFact, now: Date) =>
  dmTokenState(
    {
      expiresAt: f.expiresAt,
      revokedAt: f.revokedAt,
      graceUntil: f.graceUntil,
      admin: f.orgId === null,
      templateState: f.templateState,
      templateAccess: f.templateAccess,
      orgBlocked: f.orgBlocked,
      subClosed: f.subClosed,
      extApi: f.extApi,
    },
    now,
  );

/** Состояние, пояснение и подписи токена (прототип `dmTokSt`, `dmWho`, `dmOrgN`). */
function viewOf(f: DmTokenFact, now: Date, side: Side, tr: Tr): TokenView {
  const { state, stop } = stateOf(f, now);
  const till = f.graceUntil && f.graceUntil < f.expiresAt ? f.graceUntil : f.expiresAt;
  const admin = tr('dm.tok.who_admin');
  const note =
    state === 'revoked' && f.revokedAt
      ? tr('dm.tok.revoked_note', {
          at: formatMomentRu(f.revokedAt),
          who: f.revokedByAdmin ? admin : (f.revokedByName ?? ''),
        })
      : state === 'stopped' && stop
        ? tr(`dm.tok.stop.${stop}`)
        : state === 'active' && f.replacedBy
          ? tr('dm.tok.reissued_note', { till: formatMomentRu(till) })
          : '';
  const byName = f.createdByAdmin
    ? admin
    : f.createdByLeft
      ? tr('dm.tok.who_left', { name: f.createdByName ?? '' })
      : (f.createdByName ?? '');
  const orgName = f.orgId === null ? admin : (f.orgName ?? '');
  const live = dmTokenLive(state);
  const mine = side === 'org' || f.orgId === null;
  const row: DmTokenRow = {
    id: f.id,
    name: f.name,
    prefix: f.prefix,
    state,
    note,
    orgName,
    tplName: f.templateName,
    byName,
    createdAt: f.createdAt.toISOString(),
    till: till.toISOString(),
    lastAt: f.lastUsedAt?.toISOString() ?? null,
    lastIp: f.lastIp,
    n30: f.requests,
    mine,
    canReissue: mine && live && !f.replacedBy,
    canRevoke: live,
  };
  return {
    fact: f,
    state,
    stop,
    live,
    mine,
    row,
    list: {
      id: f.id,
      name: f.name,
      prefix: f.prefix,
      state,
      stateText: tr(`dm.tok.state.${state}`),
      stateRank: STATE_RANK[state],
      note,
      orgName,
      tplName: f.templateName,
      byName,
      createdAt: row.createdAt,
      till: row.till,
      lastAt: row.lastAt,
      lastIp: f.lastIp,
      n30: f.requests,
    },
  };
}

/**
 * Действующих токенов в контексте (плашка «Действующих токенов» «Журнала запросов» Админки, прототип
 * `DM_TOK.filter(dmLive)`: состояние «Действует»).
 */
export async function activeTokenCount(tx: Tx, deps: ApiDeps): Promise<number> {
  const m = momentOf(deps);
  const { now, items } = await dmTokenFacts(tx, { since: m.since, today: m.today });
  return items.filter((f) => stateOf(f, now).state === 'active').length;
}

/** Все токены стороны с состоянием «сейчас» по часам базы. */
async function tokenViews(tx: Tx, side: Side, m: Moment, tr: Tr, id?: string) {
  const { now, items } = await dmTokenFacts(tx, { since: m.since, today: m.today, id });
  return { now, views: items.map((f) => viewOf(f, now, side, tr)) };
}

/** Параметры запроса журнала строкой «month=2026-11&org=…» (прототип `x.params`). */
const paramsText = (params: Record<string, unknown>) =>
  Object.entries(params)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('&');

/** Для «Как подключить»: адрес сайта и «сегодня» по Бишкеку (значения параметров по умолчанию). */
interface HowAt {
  base: string;
  today: IsoDate;
}

/**
 * «Как подключить» (прототип `dmHow`, этап 2, П12): только у своего живого токена (прототип
 * `mine && live`), пока шаблон виден в контексте токена; столбцы — без «Контрагента».
 */
async function howOf(tx: Tx, v: TokenView, at: HowAt) {
  if (!v.mine || !v.live) return null;
  const tpl = await dmTokenTemplateHow(tx, v.fact.templateId);
  if (!tpl) return null;
  return {
    url: dmExtUrl(
      at.base,
      tpl.code,
      tpl.params.map((p) => ({ k: p.code, def: p.default })),
      at.today,
    ),
    columns: dmExtColumns(tpl.columns),
  };
}

/** Окно токена: сведения, журнал запросов (последние 50), «Как подключить» и действия. */
async function cardOf(tx: Tx, v: TokenView, at: HowAt) {
  const log = await dmTokenRequests(tx, v.fact.id, 50);
  return DmTokenCard.parse({
    ...v.row,
    stop: v.stop,
    prevPrefix: v.fact.prevPrefix,
    how: await howOf(tx, v, at),
    log: {
      total: log.total,
      items: log.items.map((r) => ({
        at: r.at.toISOString(),
        params: paramsText(r.params),
        rows: r.rows,
        ms: r.ms,
        ok: r.outcome === 'ok',
        error: r.error,
        ip: r.ip,
      })),
    },
  });
}

async function oneView(tx: Tx, side: Side, m: Moment, tr: Tr, id: string): Promise<TokenView> {
  const { views } = await tokenViews(tx, side, m, tr, id);
  const v = views[0];
  if (!v) throw new RecordNotFoundError('dm_token', id);
  return v;
}

/** Что знает сторона о выпуске: шаблоны, которые можно выбрать, и что мешает. */
interface IssueFacts {
  templates: DmTokenTemplate[];
  refusal: ReturnType<typeof dmTokenIssueRefusal>;
  demo: boolean;
  apiOff: boolean;
  liveNames: string[];
}

const isModule = (m: string | null): m is DmModule =>
  m !== null && (DM_MODULES as readonly string[]).includes(m);

/** Организация: права и функции вошедшего сейчас — для видимости шаблонов (прототип `dmSee`). */
interface OrgSight {
  subject: AccessSubject;
  orgId: string;
}

async function issueFacts(
  tx: Tx,
  side: Side,
  views: readonly TokenView[],
  m: Moment,
  sight: OrgSight | null,
): Promise<IssueFacts> {
  // «Действующих» — строже прототипа (`dmLive` считает только «Действует»): и «Остановлен», он оживает
  // сам, когда шаблон починят или доступ вернут; названия — у них же.
  // ОТКЛОНЕНИЕ: docs/deviations.md#Т-25
  const active = views.filter((v) => v.mine && v.live);
  const liveNames = active.map((v) => v.fact.name);
  if (side === 'admin' || !sight) {
    const templates = await dmTokenTemplates(tx, 'admin');
    return {
      templates,
      refusal: dmTokenIssueRefusal({
        admin: true,
        demo: false,
        canTokens: true,
        extApi: true,
        subClosed: false,
        liveCount: active.length,
      }),
      demo: false,
      apiOff: false,
      liveNames,
    };
  }
  const [usage, extApi, settings, all] = await Promise.all([
    orgUsage(tx, m.today, { bytes: false }),
    orgExtApi(tx),
    orgMenuSettings(tx, sight.orgId),
    dmTokenTemplates(tx, 'org'),
  ]);
  const features: Partial<Record<Feature, boolean>> = settings.features;
  // Токен отдаёт строки всей организации: шаблон со столбцом «Контрагент» — только при «Все контрагенты».
  // ОТКЛОНЕНИЕ: docs/deviations.md#Т-26
  const templates = all.filter((t) =>
    dmTemplateTokenable(
      {
        audience: 'org',
        state: 'published',
        module: isModule(t.module) ? t.module : null,
        needPermission: t.needPermission,
        columns: t.columns,
      },
      sight.subject,
      features,
    ),
  );
  const demo = usage?.demo ?? false;
  return {
    templates,
    refusal: dmTokenIssueRefusal({
      admin: false,
      demo,
      canTokens: true,
      extApi,
      subClosed: usage?.closed ?? false,
      liveCount: active.length,
    }),
    demo,
    apiOff: !extApi,
    liveNames,
  };
}

const sightOf = (c: Context<AppEnv>, side: Side): OrgSight | null =>
  side === 'org' ? { subject: c.get('access')!.subject, orgId: c.get('session')!.orgId! } : null;

/**
 * Выпусков и перевыпусков одним человеком — не больше стольких за час (защита строже прототипа: токены
 * не удаляются, поэтому «выпустить и отозвать» по кругу растило бы список и историю без конца).
 */
export const DM_TOKEN_ISSUE_RATE_LIMIT: RateLimit = {
  kind: 'dm_token_issue',
  max: 60,
  windowSeconds: 3600,
};

async function takeIssueSlot(deps: ApiDeps, c: Context<AppEnv>, tr: Tr): Promise<void> {
  const slot = await takeRateLimit(deps.db, DM_TOKEN_ISSUE_RATE_LIMIT, c.get('session')!.userId);
  if (!slot.ok) apiFail(429, 'dm_token_rate', tr('err.dm_token_rate'));
}

const REFUSAL_STATUS = {
  dm_token_demo: 403,
  dm_token_no_right: 403,
  dm_token_api_off: 403,
  dm_token_sub_closed: 403,
  dm_token_limit: 409,
} as const;

/** Новый токен: случайные байты, хеш для базы, начало для списка. */
function newToken() {
  const token = dmTokenFromBytes(new Uint8Array(randomBytes(32)));
  return {
    token,
    tokenHash: createHash('sha256').update(token).digest('hex'),
    prefix: dmTokenPrefix(token),
  };
}

/** Запись истории: у организации — её история, у Админки — история платформы. */
async function history(
  tx: Tx,
  side: Side,
  entityId: string,
  action: 'create' | 'dm_reissue' | 'dm_revoke',
  changes: HistoryChange[],
) {
  const entry = { entity: 'dm_token' as const, entityId, action, changes };
  if (side === 'org') await writeHistory(tx, entry);
  else await writePlatformHistory(tx, entry);
}

// ───── Маршруты ─────

/** Путь — постоянной строкой (`B`): со строкой вообще клиент сайта теряет типы всех путей API. */
function routes<B extends string>(side: Side, base: B) {
  const s = SIDES[side];
  const mw = s.guard;
  return {
    list: createRoute({
      method: 'get',
      path: base,
      tags: s.tags,
      summary: `API-токены ${s.who}: страница списка`,
      middleware: mw,
      request: { query: ListQueryParams },
      responses: {
        200: { description: 'Токены с состоянием', content: json(DmTokenList) },
        ...listQueryResponses,
        ...denied,
      },
    }),
    values: createRoute({
      method: 'get',
      path: `${base}/values` as const,
      tags: s.tags,
      summary: `API-токены ${s.who}: значения столбца для фильтра`,
      middleware: mw,
      request: { query: ListValuesQuery },
      responses: {
        200: { description: 'Значения столбца', content: json(ListValues) },
        ...listQueryResponses,
        ...denied,
      },
    }),
    export: createRoute({
      method: 'get',
      path: `${base}/export` as const,
      tags: s.tags,
      summary: `API-токены ${s.who} в Excel`,
      middleware: s.exportGuard,
      request: { query: ListExportParams },
      responses: {
        200: { description: 'Файл Excel с токенами под поиском и фильтрами', content: xlsxContent },
        ...listQueryResponses,
        ...exportRateResponses,
        ...denied,
      },
    }),
    form: createRoute({
      method: 'get',
      path: `${base}/form` as const,
      tags: s.tags,
      summary: `«Новый API-токен» ${s.who}: шаблоны, сроки и что мешает выпуску`,
      middleware: mw,
      responses: {
        200: { description: 'Данные окна', content: json(DmTokenForm) },
        ...denied,
      },
    }),
    create: createRoute({
      method: 'post',
      path: base,
      tags: s.tags,
      summary: `Выпустить API-токен ${s.who}`,
      middleware: mw,
      request: { body: { content: json(DmTokenCreate), required: true } },
      responses: {
        201: { description: 'Токен — один раз — и его окно', content: json(DmTokenIssued) },
        400: { description: 'Неверное название, срок или шаблон', content: error },
        ...denied,
        409: { description: 'Действующих уже 20 или название уже действует', content: error },
        429: { description: 'Слишком много новых токенов за час', content: error },
      },
    }),
    card: createRoute({
      method: 'get',
      path: `${base}/{id}` as const,
      tags: s.tags,
      summary: `Окно API-токена ${s.who} с журналом запросов`,
      middleware: mw,
      request: { params: DmTokenIdParam },
      responses: {
        200: { description: 'Токен, журнал и действия', content: json(DmTokenCard) },
        ...denied,
        ...notFound,
      },
    }),
    revoke: createRoute({
      method: 'post',
      path: `${base}/{id}/revoke` as const,
      tags: s.tags,
      summary: `Отозвать API-токен ${s.who}`,
      middleware: mw,
      request: { params: DmTokenIdParam },
      responses: {
        200: { description: 'Токен отозван', content: json(DmTokenCard) },
        ...denied,
        ...notFound,
        409: { description: 'Уже отозван или истёк', content: error },
      },
    }),
    reissue: createRoute({
      method: 'post',
      path: `${base}/{id}/reissue` as const,
      tags: s.tags,
      summary: `Перевыпустить API-токен ${s.who}: прежний работает ещё сутки`,
      middleware: mw,
      request: { params: DmTokenIdParam },
      responses: {
        201: { description: 'Новый токен — один раз — и его окно', content: json(DmTokenIssued) },
        ...denied,
        ...notFound,
        409: {
          description: 'Отозван, истёк, уже перевыпущен или шаблон недоступен',
          content: error,
        },
        429: { description: 'Слишком много новых токенов за час', content: error },
      },
    }),
  };
}

export const ORG_TOKEN_ROUTES = routes('org', '/dm/tokens');
export const ADMIN_TOKEN_ROUTES = routes('admin', '/admin/dm/tokens');
type Routes = typeof ORG_TOKEN_ROUTES;

/** Обработчики стороны: одни и те же правила, разные контекст, права и история. */
export function tokenHandlers(deps: ApiDeps, side: Side) {
  const texts = async () => trOf(await serverTexts(deps));
  const howAt = (m: Moment): HowAt => ({ base: deps.config.APP_BASE_URL, today: m.today });

  const list: RouteHandler<Routes['list'], AppEnv> = async (c) => {
    const m = momentOf(deps);
    const query = listQueryOf(c.req.valid('query'));
    const tr = await texts();
    const { page, views } = await inSide(deps, c, side, async (tx) => {
      const { views } = await tokenViews(tx, side, m, tr);
      return {
        views,
        page: await listDmTokensPage(
          tx,
          views.map((v) => v.list),
          query,
        ),
      };
    });
    const byId = new Map(views.map((v) => [v.fact.id, v.row]));
    return c.json(
      {
        items: page.rows.map((r) => byId.get(r.id)!),
        total: page.total,
        page: page.page,
        size: page.size,
        totals: page.totals,
        ...(page.groups ? { groups: page.groups, rowGroups: page.rowGroups } : {}),
      },
      200,
    );
  };

  const values: RouteHandler<Routes['values'], AppEnv> = async (c) => {
    const m = momentOf(deps);
    const { col, q } = c.req.valid('query');
    const tr = await texts();
    const res = await inSide(deps, c, side, async (tx) => {
      const { views } = await tokenViews(tx, side, m, tr);
      return listDmTokenValues(
        tx,
        views.map((v) => v.list),
        col,
        q,
      );
    });
    return c.json(res, 200);
  };

  const exportList: RouteHandler<Routes['export'], AppEnv> = async (c) => {
    const m = momentOf(deps);
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    const userId = c.get('session')!.userId;
    return withExportSlot(deps, userId, async () => {
      const t = await serverTexts(deps);
      const tr = trOf(t);
      const result = await inSide(
        deps,
        c,
        side,
        async (tx) => {
          const { views } = await tokenViews(tx, side, m, tr);
          return exportDmTokens(
            tx,
            views.map((v) => v.list),
            query,
            keys,
          );
        },
        'export',
      );
      return xlsxResponse(c, {
        title: `${t('nav.dm')} — ${t('tab.dm.tok')}`,
        today: deps.clock.now(),
        columns: result.columns,
        rows: result.rows,
        more: result.more,
        total: result.total,
        t,
      });
    });
  };

  const form: RouteHandler<Routes['form'], AppEnv> = async (c) => {
    const m = momentOf(deps);
    const tr = await texts();
    const sight = sightOf(c, side);
    const facts = await inSide(deps, c, side, async (tx) => {
      const { views } = await tokenViews(tx, side, m, tr);
      return issueFacts(tx, side, views, m, sight);
    });
    return c.json(
      {
        refusal: facts.refusal ?? (facts.templates.length ? null : 'dm_token_no_templates'),
        demo: facts.demo,
        apiOff: facts.apiOff,
        owner: side === 'org' && !!sight?.subject.isOwner,
        max: DM_TOKENS_LIVE_MAX,
        templates: facts.templates.map((t) => ({
          id: t.id,
          code: t.code,
          name: t.name,
          module: isModule(t.module) ? t.module : null,
        })),
        terms: [...DM_TOKEN_TERMS],
        defaultTerm: DM_TOKEN_DEFAULT_TERM,
      },
      200,
    );
  };

  const create: RouteHandler<Routes['create'], AppEnv> = async (c) => {
    const body = c.req.valid('json');
    const m = momentOf(deps);
    const tr = await texts();
    const sight = sightOf(c, side);
    const name = body.name.trim();
    if (!(DM_TOKEN_TERMS as readonly number[]).includes(body.term)) {
      apiFail(400, 'dm_token_term', tr('err.dm_token_term'), { field: 'term' });
    }
    await takeIssueSlot(deps, c, tr);
    const made = newToken();
    const item = await inSide(deps, c, side, async (tx) => {
      await lockDmTokens(tx, sight?.orgId ?? null);
      const { views } = await tokenViews(tx, side, m, tr);
      const facts = await issueFacts(tx, side, views, m, sight);
      if (facts.refusal) {
        apiFail(REFUSAL_STATUS[facts.refusal], facts.refusal, tr(`err.${facts.refusal}`), {
          max: DM_TOKENS_LIVE_MAX,
        });
      }
      const problem = dmTokenNameProblem(name, facts.liveNames);
      if (problem) {
        apiFail(problem === 'dm_token_name_taken' ? 409 : 400, problem, tr(`err.${problem}`), {
          field: 'name',
          max: DM_TOKEN_NAME_MAX,
        });
      }
      const tpl = facts.templates.find((t) => t.id === body.templateId);
      if (!tpl) {
        apiFail(400, 'dm_token_template', tr('err.dm_token_template'), { field: 'templateId' });
      }
      const row = await insertDmToken(tx, {
        templateId: tpl.id,
        name,
        tokenHash: made.tokenHash,
        prefix: made.prefix,
        termDays: body.term,
      });
      await history(tx, side, row.id, 'create', [
        { field: 'name', to: name },
        { field: 'template', to: tpl.name },
        { field: 'term', to: body.term },
        { field: 'prefix', to: made.prefix },
      ]);
      return cardOf(tx, await oneView(tx, side, m, tr, row.id), howAt(m));
    });
    return c.json({ token: made.token, item }, 201);
  };

  const card: RouteHandler<Routes['card'], AppEnv> = async (c) => {
    const { id } = c.req.valid('param');
    const m = momentOf(deps);
    const tr = await texts();
    const item = await inSide(deps, c, side, async (tx) =>
      cardOf(tx, await oneView(tx, side, m, tr, id), howAt(m)),
    );
    return c.json(item, 200);
  };

  const revoke: RouteHandler<Routes['revoke'], AppEnv> = async (c) => {
    const { id } = c.req.valid('param');
    const m = momentOf(deps);
    const tr = await texts();
    const { item, orgCopy } = await inSide(deps, c, side, async (tx) => {
      const v = await oneView(tx, side, m, tr, id);
      await lockDmTokens(tx, v.fact.orgId);
      if (!v.live || !(await revokeDmToken(tx, id))) {
        apiFail(409, 'dm_token_dead', tr('err.dm_token_dead'));
      }
      const changes: HistoryChange[] = [
        { field: 'name', to: v.fact.name },
        { field: 'prefix', to: v.fact.prefix },
      ];
      await history(tx, side, id, 'dm_revoke', [
        ...changes,
        ...(side === 'admin' && v.fact.orgId ? [{ field: 'org', to: v.fact.orgName ?? '' }] : []),
      ]);
      return {
        item: await cardOf(tx, await oneView(tx, side, m, tr, id), howAt(m)),
        orgCopy: side === 'admin' && v.fact.orgId ? { orgId: v.fact.orgId, changes } : null,
      };
    });
    // Администратор отозвал токен организации — запись и в истории организации (для разбора: кто и
    // когда остановил её выгрузки), от его имени в контексте этой организации, как открытие карточки.
    if (orgCopy) {
      await withOrgContext(
        deps.db,
        { orgId: orgCopy.orgId, userId: c.get('session')!.userId },
        (tx) =>
          writeHistory(tx, {
            entity: 'dm_token',
            entityId: id,
            action: 'dm_revoke',
            changes: orgCopy.changes,
          }),
      );
    }
    return c.json(item, 200);
  };

  const reissue: RouteHandler<Routes['reissue'], AppEnv> = async (c) => {
    const { id } = c.req.valid('param');
    const m = momentOf(deps);
    const tr = await texts();
    const sight = sightOf(c, side);
    await takeIssueSlot(deps, c, tr);
    const made = newToken();
    const item = await inSide(deps, c, side, async (tx) => {
      const before = await oneView(tx, side, m, tr, id);
      if (!before.mine) apiFail(403, 'dm_token_not_mine', tr('err.dm_token_not_mine'));
      await lockDmTokens(tx, before.fact.orgId);
      const { views } = await tokenViews(tx, side, m, tr);
      const v = views.find((x) => x.fact.id === id) ?? before;
      if (!v.live) apiFail(409, 'dm_token_dead', tr('err.dm_token_dead'));
      if (v.fact.replacedBy) apiFail(409, 'dm_token_reissued', tr('err.dm_token_reissued'));
      // Новый токен — только к шаблону, который вошедший может выбрать и сейчас (защита строже
      // прототипа: шаблон выключили или права сотрудника сузились — перевыпуска нет).
      // ОТКЛОНЕНИЕ: docs/deviations.md#Т-25
      // Те же отказы, что у выпуска (демо, внешний доступ выключен, доступ закрыт по подписке), кроме
      // предела: перевыпуск заменяет токен, прежний доживает сутки.
      const facts = await issueFacts(tx, side, views, m, sight);
      if (facts.refusal && facts.refusal !== 'dm_token_limit') {
        apiFail(REFUSAL_STATUS[facts.refusal], facts.refusal, tr(`err.${facts.refusal}`));
      }
      const tpl = facts.templates.find((t) => t.id === v.fact.templateId);
      if (!tpl) apiFail(409, 'dm_token_template', tr('err.dm_token_template'));
      const term = dmTokenTermOf(v.fact.createdAt, v.fact.expiresAt);
      const row = await insertDmToken(tx, {
        templateId: tpl.id,
        name: v.fact.name,
        tokenHash: made.tokenHash,
        prefix: made.prefix,
        termDays: term,
      });
      if (!(await replaceDmToken(tx, id, row.id))) {
        apiFail(409, 'dm_token_reissued', tr('err.dm_token_reissued'));
      }
      await history(tx, side, row.id, 'dm_reissue', [
        { field: 'name', to: v.fact.name },
        { field: 'template', to: tpl.name },
        { field: 'term', to: term },
        { field: 'prefix', from: v.fact.prefix, to: made.prefix },
      ]);
      return cardOf(tx, await oneView(tx, side, m, tr, row.id), howAt(m));
    });
    return c.json({ token: made.token, item }, 201);
  };

  return { list, values, exportList, form, create, card, revoke, reissue };
}
