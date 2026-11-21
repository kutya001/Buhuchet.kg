import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  adminGetOrganization,
  dmOutputTemplate,
  dmOutputTemplates,
  dmOwnContractorIds,
  dmTemplateCheckError,
  dmTemplateQuery,
  orgMenuSettings,
  orgUsage,
  releaseRateLimit,
  takeRateLimit,
  withOrgContext,
  withUserContext,
  writeHistory,
  type DmOutputTemplate,
  type RateLimit,
  type Tx,
} from '@buhuchet/db';
import {
  bishkekDate,
  DM_MODULES,
  dmOwnScope,
  dmParamDefault,
  dmTemplateSeen,
  formatText,
  hasPermission,
  RecordNotFoundError,
  type AccessSubject,
  type DmModule,
  type Feature,
  type IsoDate,
} from '@buhuchet/domain';
import {
  ApiError,
  DmAdminRunInput,
  DmCatalog,
  DmRunInput,
  DmRunResult,
  type DmTemplateCard,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiError, apiFail } from '../../errors';
import { orgContextOf, requirePermission, requirePlatformAdmin } from '../../middleware/access';
import { guardCardRead } from '../admin/card-guard';
import { serverTexts } from '../l10n/texts';
import { DM_ROWS_MAX, logDmRun, runDmTemplate, type DmRunOutcome, type DmRunWho } from './run';

/*
 * «Витрина данных» → «Вывод» и каталог «Шаблоны» (доработки 20.11.2026: Витрина данных, блоки 3–4;
 * общий план 20.11, этап 2, П3–П4; прототип v155 `modules/vitrina.js`: `dmOutList`, `dmSee`, `dmRun`,
 * `dmDraw`, `renderDmOut`, `renderDmTpl`).
 *   Организация (`/api/dm/output`, право «Смотреть витрину данных»): опубликованные и сломанные шаблоны
 *   «Для организаций» с её доступом (RLS), видимые сотруднику (`dmTemplateSeen`: модуль, право шаблона,
 *   функции, «Контрагент» при области «Свои»); «Показать» оставляет сотруднику с областью «Свои» только
 *   строки его контрагентов.
 *   Админка (`/api/admin/dm/output`): все опубликованные и сломанные шаблоны; шаблон «Для организаций» —
 *   «глазами организации», открытие пишется в её историю, как открытие карточки организации.
 * Один человек выполняет один запрос одновременно (блок 8, пункт 5). Каждый «Показать» — строка журнала.
 */

const error = { 'application/json': { schema: ApiError } };
const json = <T>(schema: T) => ({ 'application/json': { schema } });
const denied = {
  401: { description: 'Нет входа', content: error },
  403: { description: 'Нет права или не администратор платформы', content: error },
} as const;
const runFails = {
  400: {
    description: 'Неверный параметр (`dm_bad_param`) или не выбрана организация',
    content: error,
  },
  404: { description: 'Шаблон не найден или недоступен', content: error },
  409: { description: 'Шаблон временно не работает (`dm_template_broken`)', content: error },
  429: { description: 'Предыдущий запрос ещё идёт или запросов слишком много', content: error },
  503: { description: 'Запрос выполнялся слишком долго (`dm_timeout`)', content: error },
} as const;

/** Запусков «Показать» одним человеком: один одновременно, не больше 600 за час. */
export const DM_RUN_RATE_LIMIT: RateLimit = {
  kind: 'dm_run',
  max: 600,
  windowSeconds: 3600,
  leaseSeconds: 60,
};

export const OUTPUT_ROUTES = {
  catalog: createRoute({
    method: 'get',
    path: '/dm/output',
    tags: ['datamart'],
    summary: '«Вывод» и «Шаблоны» организации: шаблоны, видимые сотруднику',
    middleware: [requirePermission('dmView')] as const,
    responses: {
      200: { description: 'Шаблоны по названию', content: json(DmCatalog) },
      ...denied,
    },
  }),
  run: createRoute({
    method: 'post',
    path: '/dm/output/run',
    tags: ['datamart'],
    summary: '«Показать»: результат шаблона организации',
    middleware: [requirePermission('dmView')] as const,
    request: { body: { content: json(DmRunInput), required: true } },
    responses: {
      200: { description: 'Столбцы и строки', content: json(DmRunResult) },
      ...denied,
      ...runFails,
    },
  }),
  adminCatalog: createRoute({
    method: 'get',
    path: '/admin/dm/output',
    tags: ['admin'],
    summary: '«Вывод» Админки: опубликованные и сломанные шаблоны обоих видов',
    middleware: [requirePlatformAdmin] as const,
    responses: {
      200: { description: 'Шаблоны по названию', content: json(DmCatalog) },
      ...denied,
    },
  }),
  adminRun: createRoute({
    method: 'post',
    path: '/admin/dm/output/run',
    tags: ['admin'],
    summary: '«Показать» в Админке; шаблон организаций — «глазами организации»',
    middleware: [requirePlatformAdmin] as const,
    request: { body: { content: json(DmAdminRunInput), required: true } },
    responses: {
      200: { description: 'Столбцы и строки', content: json(DmRunResult) },
      ...denied,
      ...runFails,
    },
  }),
} as const;

const isModule = (m: string | null): m is DmModule =>
  m !== null && (DM_MODULES as readonly string[]).includes(m);

/** Карточка шаблона без текста запроса и без столбца «Контрагент». */
function cardOf(tpl: DmOutputTemplate, today: IsoDate): DmTemplateCard {
  return {
    id: tpl.id,
    code: tpl.code,
    name: tpl.name,
    description: tpl.description,
    audience: tpl.audience,
    module: isModule(tpl.module) ? tpl.module : null,
    needPermission: tpl.needPermission,
    state: tpl.state,
    params: tpl.params.map((p) => ({
      code: p.code,
      name: p.name,
      type: p.type,
      required: p.required,
      default: p.default,
      value: dmParamDefault(p.default, today),
    })),
    columns: tpl.columns
      .filter((c) => !c.contractor && c.type !== 'cp')
      .map((c) => ({ code: c.code, name: c.name, type: c.type, total: c.total })),
  };
}

/** Виден ли шаблон сотруднику (прототип `dmSee`). */
const seen = (
  tpl: DmOutputTemplate,
  subject: AccessSubject,
  features: Readonly<Partial<Record<Feature, boolean>>>,
) =>
  dmTemplateSeen(
    {
      audience: tpl.audience,
      state: tpl.state,
      module: isModule(tpl.module) ? tpl.module : null,
      needPermission: tpl.needPermission,
      columns: tpl.columns,
    },
    subject,
    features,
  );

const todayOf = (deps: ApiDeps): IsoDate => bishkekDate(deps.clock.now());

/** «Показать» по очереди (блок 8, пункт 5): идёт прежний запрос человека — 429 `dm_busy`, за час 600 — `dm_rate`. */
export async function withRunSlot<T>(
  deps: ApiDeps,
  userId: string,
  t: (key: string) => string,
  run: () => Promise<T>,
): Promise<T> {
  const slot = await takeRateLimit(deps.db, DM_RUN_RATE_LIMIT, userId);
  if (!slot.ok) {
    if (slot.reason === 'busy') apiFail(429, 'dm_busy', t('err.dm_busy'));
    apiFail(429, 'dm_rate', t('err.dm_rate'));
  }
  try {
    return await run();
  } finally {
    await releaseRateLimit(deps.db, DM_RUN_RATE_LIMIT, userId, slot.ticket).catch((err: unknown) =>
      deps.logger.error({ err }, 'витрина: запуск не отпущен'),
    );
  }
}

/** Как отвечает сторона: Админке — текст базы и название организации «глазами организации». */
export interface OutputSide {
  admin: boolean;
  orgName: string | null;
}

/**
 * Отказ запуска — ответ метода (бросает): 400 `dm_bad_param` с параметром, 503 `dm_timeout`, 409
 * `dm_template_broken` (текст базы — только Админке). Зовут «Показать» и выгрузка «В Excel».
 */
export function outputFail(
  tpl: DmOutputTemplate,
  out: Exclude<DmRunOutcome, { ok: true }>,
  t: (key: string) => string,
  side: OutputSide,
): never {
  if (out.outcome === 'bad_param') {
    const name = tpl.params.find((p) => p.code === out.param)?.name ?? out.param;
    apiFail(400, 'dm_bad_param', formatText(t('err.dm_bad_param'), { param: name }), {
      param: out.param,
      why: out.why,
    });
  }
  if (out.outcome === 'timeout') {
    throw new HTTPException(503, {
      res: Response.json(apiError('dm_timeout', t('err.dm_timeout')), { status: 503 }),
    });
  }
  // Текст базы — только администратору платформы (блок 4, пункт 4; прототип `dmDraw`).
  apiFail(
    409,
    'dm_template_broken',
    t('err.dm_template_broken'),
    side.admin ? { error: out.adminDetail } : undefined,
  );
}

/** Итог запуска — ответ «Показать»: результат или отказ со своим кодом. */
function respond(
  c: Context<AppEnv>,
  tpl: DmOutputTemplate,
  out: DmRunOutcome,
  t: (key: string) => string,
  side: OutputSide,
) {
  if (!out.ok) outputFail(tpl, out, t, side);
  return c.json(
    DmRunResult.parse({
      columns: out.columns.map((col) => ({
        code: col.code,
        name: col.name,
        type: col.type,
        total: col.total,
      })),
      rows: out.rows,
      more: out.more,
      max: DM_ROWS_MAX,
      ms: out.ms,
      orgName: side.orgName,
    }),
    200,
  );
}

/** Сломанный шаблон не выполняется: строка журнала и «Шаблон временно не работает». */
async function brokenFail(
  deps: ApiDeps,
  who: DmRunWho,
  tpl: DmOutputTemplate,
  t: (key: string) => string,
  error: string | null,
): Promise<never> {
  await logDmRun(deps, who, {
    via: 'screen',
    templateId: tpl.id,
    tokenId: null,
    params: {},
    rows: null,
    ms: null,
    outcome: 'broken',
    error: t('err.dm_template_broken'),
    ip: null,
  });
  apiFail(409, 'dm_template_broken', t('err.dm_template_broken'), error ? { error } : undefined);
}

/** Что нужно организации для «Показать»: шаблон, текст и область — одной транзакцией. */
interface OrgRunFacts {
  tpl: DmOutputTemplate;
  query: string | null;
  own: string[] | null;
}

async function orgRunFacts(
  tx: Tx,
  orgId: string,
  code: string,
  subject: AccessSubject,
): Promise<OrgRunFacts | null> {
  const tpl = await dmOutputTemplate(tx, code, 'org');
  if (!tpl) return null;
  const { features } = await orgMenuSettings(tx, orgId);
  if (!seen(tpl, subject, features)) return null;
  if (tpl.state === 'broken') return { tpl, query: null, own: null };
  const query = await dmTemplateQuery(tx, tpl.id);
  if (query === null) return null;
  const module = isModule(tpl.module) ? tpl.module : null;
  const own = dmOwnScope(module, subject, tpl.columns)
    ? await dmOwnContractorIds(tx, subject.employeeId)
    : null;
  return { tpl, query, own };
}

/** Запуск шаблона и всё, что нужно для ответа (у отказа до запуска — бросает ответ метода). */
export interface OutputRun {
  tpl: DmOutputTemplate;
  out: DmRunOutcome;
  side: OutputSide;
}

/**
 * Запуск шаблона организации от вошедшего сотрудника (право «Смотреть витрину данных» — у маршрута):
 * шаблон виден ему (иначе 404 `dm_template_not_found`), сломанный — 409 `dm_template_broken`, область
 * «Свои» — по группе прав модуля шаблона, строка журнала. Общий для «Показать» и выгрузки «В Excel»
 * (поток И); очередь запусков человека — у вызывающего.
 */
export async function orgOutput(
  deps: ApiDeps,
  c: Context<AppEnv>,
  input: DmRunInput,
  maxRows: number = DM_ROWS_MAX,
): Promise<OutputRun> {
  const ctx = orgContextOf(c);
  const userId = c.get('session')!.userId;
  const subject = c.get('access')!.subject;
  const t = await serverTexts(deps);
  const facts = await withOrgContext(deps.db, ctx, (tx) =>
    orgRunFacts(tx, ctx.orgId, input.code, subject),
  );
  if (!facts) apiFail(404, 'dm_template_not_found', t('err.dm_template_not_found'));
  const who: DmRunWho = { kind: 'org', orgId: ctx.orgId, userId };
  if (facts.query === null) return brokenFail(deps, who, facts.tpl, t, null);
  const out = await runDmTemplate(deps, {
    template: facts.tpl,
    query: facts.query,
    input: input.params,
    who,
    ownContractorIds: facts.own,
    via: 'screen',
    tokenId: null,
    ip: null,
    maxRows,
    today: todayOf(deps),
  });
  return { tpl: facts.tpl, out, side: { admin: false, orgName: null } };
}

/**
 * Запуск в Админке (только администратор платформы — у маршрута): шаблон «Для администратора» — по всем
 * организациям; «Для организаций» — «глазами организации» `orgId` (нет — 400 `dm_org_required`, нет
 * такой организации — 404), открытие — в её историю, как открытие карточки организации. Общий для
 * «Показать» и выгрузки «В Excel».
 */
export async function adminOutput(
  deps: ApiDeps,
  c: Context<AppEnv>,
  input: DmAdminRunInput,
  maxRows: number = DM_ROWS_MAX,
): Promise<OutputRun> {
  const adminId = c.get('session')!.userId;
  const t = await serverTexts(deps);
  const found = await withUserContext(deps.db, adminId, async (tx) => {
    const tpl = await dmOutputTemplate(tx, input.code);
    if (!tpl) return null;
    const [query, checkError] = await Promise.all([
      tpl.state === 'published' ? dmTemplateQuery(tx, tpl.id) : null,
      tpl.state === 'broken' ? dmTemplateCheckError(tx, tpl.id) : null,
    ]);
    const org =
      tpl.audience === 'org' && input.orgId ? await adminGetOrganization(tx, input.orgId) : null;
    return { tpl, query, checkError, orgName: org?.name ?? null };
  });
  if (!found) apiFail(404, 'dm_template_not_found', t('err.dm_template_not_found'));
  const { tpl } = found;
  let who: DmRunWho = { kind: 'admin', adminId };
  if (tpl.audience === 'org') {
    if (!input.orgId) apiFail(400, 'dm_org_required', t('err.dm_org_required'));
    if (found.orgName === null) throw new RecordNotFoundError('organization', input.orgId);
    // Открытие «глазами организации» — в её историю, как открытие карточки: только запрос своего сайта
    // и предел частоты открытий.
    await guardCardRead(deps, c, false);
    const orgId = input.orgId;
    await withOrgContext(deps.db, { orgId, userId: adminId }, (tx) =>
      writeHistory(tx, {
        entity: 'organization',
        entityId: orgId,
        action: 'card_view',
        reason: formatText(t('dm.out.history_porg'), { name: tpl.name }),
      }),
    );
    who = { kind: 'org', orgId, userId: adminId };
  }
  if (found.query === null) return brokenFail(deps, who, tpl, t, found.checkError);
  const out = await runDmTemplate(deps, {
    template: tpl,
    query: found.query,
    input: input.params,
    who,
    ownContractorIds: null,
    via: 'screen',
    tokenId: null,
    ip: null,
    maxRows,
    today: todayOf(deps),
  });
  return { tpl, out, side: { admin: true, orgName: found.orgName } };
}

export function outputHandlers(deps: ApiDeps) {
  const catalog: RouteHandler<typeof OUTPUT_ROUTES.catalog, AppEnv> = async (c) => {
    const ctx = orgContextOf(c);
    const subject = c.get('access')!.subject;
    const today = todayOf(deps);
    const { items, demo } = await withOrgContext(deps.db, ctx, async (tx) => {
      const [all, settings, usage] = await Promise.all([
        dmOutputTemplates(tx, 'org'),
        orgMenuSettings(tx, ctx.orgId),
        orgUsage(tx, today, { bytes: false }),
      ]);
      return {
        items: all.filter((tpl) => seen(tpl, subject, settings.features)),
        demo: usage?.demo ?? false,
      };
    });
    return c.json(
      DmCatalog.parse({
        items: items.map((tpl) => cardOf(tpl, today)),
        canExport: hasPermission(subject, 'export'),
        canTokens: hasPermission(subject, 'dmTokens') && !demo,
      }),
      200,
    );
  };

  const run: RouteHandler<typeof OUTPUT_ROUTES.run, AppEnv> = async (c) => {
    const input = c.req.valid('json');
    const t = await serverTexts(deps);
    return withRunSlot(deps, c.get('session')!.userId, t, async () => {
      const { tpl, out, side } = await orgOutput(deps, c, input);
      return respond(c, tpl, out, t, side);
    });
  };

  const adminCatalog: RouteHandler<typeof OUTPUT_ROUTES.adminCatalog, AppEnv> = async (c) => {
    const adminId = c.get('session')!.userId;
    const today = todayOf(deps);
    const all = await withUserContext(deps.db, adminId, (tx) => dmOutputTemplates(tx));
    return c.json(
      DmCatalog.parse({
        items: all.map((tpl) => cardOf(tpl, today)),
        canExport: true,
        canTokens: true,
      }),
      200,
    );
  };

  const adminRun: RouteHandler<typeof OUTPUT_ROUTES.adminRun, AppEnv> = async (c) => {
    const input = c.req.valid('json');
    const t = await serverTexts(deps);
    return withRunSlot(deps, c.get('session')!.userId, t, async () => {
      const { tpl, out, side } = await adminOutput(deps, c, input);
      return respond(c, tpl, out, t, side);
    });
  };

  return { catalog, run, adminCatalog, adminRun };
}
