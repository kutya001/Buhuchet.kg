import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  dmAdminTemplate,
  dmAdminTemplates,
  dmErrorOf,
  dmOrgsExist,
  dmTemplateCodes,
  dmTemplateHistory,
  dmTemplateOrgOptions,
  dmTemplateRequestOrgs,
  dmTokenFacts,
  exportDmTemplates,
  insertDmTemplate,
  lockDmTemplateCodes,
  listDmTemplatesPage,
  listDmTemplateValues,
  runDmAdmin,
  runDmOrg,
  setDmTemplateState,
  uniqueViolation,
  updateDmTemplate,
  withOrgContext,
  withUserContext,
  writeHistory,
  writePlatformHistory,
  type DmAdminTemplate,
  type DmResult,
  type DmTemplateCheckMark,
  type DmTemplateColumn,
  type DmTemplateListRow,
  type DmTemplateParam,
  type DmTemplateValues,
  type Tx,
} from '@buhuchet/db';
import {
  bishkekDate,
  DM_CHECK_ROWS,
  DM_EXTRA_PERMISSIONS,
  DM_MODULES,
  DM_NAME_MAX,
  DM_TEMPLATE_HISTORY_FIELDS,
  dmBind,
  dmColumnsProblem,
  dmCopyCode,
  dmQueryParamNames,
  dmQueryProblem,
  dmResultColumnsProblem,
  dmStateChangeAllowed,
  dmSyncColumns,
  dmSyncParams,
  dmTemplatePublished,
  dmTokenState,
  formatText,
  PLATFORM_ADMIN_NAME,
  RecordNotFoundError,
  type DmEditorColumn,
  type DmEditorParam,
  type DmModule,
  type DmQueryProblem,
  type DmTemplateState,
  type HistoryChange,
  type HistoryValue,
  type IsoDate,
} from '@buhuchet/domain';
import {
  ApiError,
  DmAdminTemplateCard,
  DmAdminTemplateList,
  DmTemplateCheckInput,
  DmTemplateCheckResult,
  DmTemplateCreate,
  DmTemplateEditorForm,
  DmTemplateIdParam,
  DmTemplateSave,
  DmTemplateStateInput,
  ListExportParams,
  ListQueryParams,
  ListValues,
  ListValuesQuery,
  type DmAdminTemplateRow,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, listQueryOf, listQueryResponses, versionedSaveResponses } from '../../errors';
import { exportRateResponses, withExportSlot, xlsxContent, xlsxResponse } from '../../lists/export';
import { requirePlatformAdmin } from '../../middleware/access';
import { guardCardRead } from '../admin/card-guard';
import { serverTexts } from '../l10n/texts';
import { withRunSlot } from './output';
import { DM_ROWS_MAX, dmSqlProblemText, withDmPoolSlot } from './run';

/*
 * Админка → «Витрина данных» → «Шаблоны» (доработки 20.11.2026: Витрина данных, блок 2, пункты 2–7;
 * блок 3, пункт 1; общий план 20.11, этап 2, П3; прототип v155 `modules/vitrina.js`: `renderDmTplAdm`,
 * `dmUse`, `dmEdit`, `dmCopy`, `dmStateDlg`). Только администратор платформы.
 *   Список (`/api/admin/dm/templates`, + `/values`, `/export`): «Организаций пользуется» — организации с
 *   действующими токенами и с запросами за 30 дней, «Токенов» — действующих (прототип `dmUse`).
 *   «Проверить» (`/check`): запрос окна как есть выполняется исполнителем Витрины на выбранной
 *   организации (сначала — демо) или, у шаблона Админки, по всем; первые 100 строк, время, число строк,
 *   ошибка — текстом базы. Проверка на данных организации пишется в её историю, как открытие карточки.
 *   «Сохранить» и «Опубликовать» (`POST`, `PUT /{id}`): «Опубликовать» и правку запроса или столбцов
 *   опубликованного шаблона сервер проверяет сам (тем же путём) и сохраняет только при успехе: клиенту
 *   на слово не верим. У опубликованного (и отключённого, и сломанного) код и вид не меняются, столбцы
 *   только добавляются; готовый шаблон не меняется — только копией. Сломанный после успешной проверки —
 *   снова «Опубликован».
 *   «Копировать», «Отключить», «Включить» (`/{id}/copy`, `/{id}/state`). Всё пишется в историю платформы.
 */

const error = { 'application/json': { schema: ApiError } };
const json = <T>(schema: T) => ({ 'application/json': { schema } });
const denied = {
  401: { description: 'Нет входа', content: error },
  403: { description: 'Не администратор платформы', content: error },
} as const;
const tags = ['admin'];
const BASE = '/admin/dm/templates' as const;
const DAY_MS = 86_400_000;
const saveFails = {
  400: { description: 'Неверное поле, запрос, параметр или состав столбцов', content: error },
  409: {
    description:
      'Проверка не прошла (`dm_check_*`), готовый шаблон (`dm_builtin`) или запись изменена',
    content: error,
  },
  429: { description: 'Предыдущий запрос администратора ещё идёт', content: error },
} as const;

export const TEMPLATE_ADMIN_ROUTES = {
  list: createRoute({
    method: 'get',
    path: BASE,
    tags,
    summary: 'Шаблоны «Витрины данных» в Админке: страница списка',
    middleware: [requirePlatformAdmin] as const,
    request: { query: ListQueryParams },
    responses: {
      200: {
        description: 'Шаблоны с числом токенов и организаций',
        content: json(DmAdminTemplateList),
      },
      ...listQueryResponses,
      ...denied,
    },
  }),
  values: createRoute({
    method: 'get',
    path: `${BASE}/values`,
    tags,
    summary: 'Шаблоны «Витрины данных»: значения столбца для фильтра',
    middleware: [requirePlatformAdmin] as const,
    request: { query: ListValuesQuery },
    responses: {
      200: { description: 'Значения столбца', content: json(ListValues) },
      ...listQueryResponses,
      ...denied,
    },
  }),
  export: createRoute({
    method: 'get',
    path: `${BASE}/export`,
    tags,
    summary: 'Шаблоны «Витрины данных» в Excel',
    middleware: [requirePlatformAdmin] as const,
    request: { query: ListExportParams },
    responses: {
      200: { description: 'Файл Excel под поиском и фильтрами', content: xlsxContent },
      ...listQueryResponses,
      ...exportRateResponses,
      ...denied,
    },
  }),
  form: createRoute({
    method: 'get',
    path: `${BASE}/form`,
    tags,
    summary: 'Окно шаблона: организации для доступа и проверки (демо — первой)',
    middleware: [requirePlatformAdmin] as const,
    responses: {
      200: { description: 'Организации', content: json(DmTemplateEditorForm) },
      ...denied,
    },
  }),
  check: createRoute({
    method: 'post',
    path: `${BASE}/check`,
    tags,
    summary: '«Проверить»: выполнить запрос окна шаблона, первые 100 строк',
    middleware: [requirePlatformAdmin] as const,
    request: { body: { content: json(DmTemplateCheckInput), required: true } },
    responses: {
      200: { description: 'Итог проверки', content: json(DmTemplateCheckResult) },
      400: { description: 'Не выбрана организация', content: error },
      404: { description: 'Нет такой организации или шаблона', content: error },
      429: { description: 'Предыдущий запрос администратора ещё идёт', content: error },
      ...denied,
    },
  }),
  create: createRoute({
    method: 'post',
    path: BASE,
    tags,
    summary: '«+ Шаблон»: сохранить черновик или опубликовать',
    middleware: [requirePlatformAdmin] as const,
    request: { body: { content: json(DmTemplateCreate), required: true } },
    responses: {
      201: { description: 'Окно нового шаблона', content: json(DmAdminTemplateCard) },
      404: { description: 'Нет такой организации', content: error },
      ...saveFails,
      ...denied,
    },
  }),
  card: createRoute({
    method: 'get',
    path: `${BASE}/{id}`,
    tags,
    summary: 'Окно шаблона: запрос, параметры, столбцы, проверка, токены и история',
    middleware: [requirePlatformAdmin] as const,
    request: { params: DmTemplateIdParam },
    responses: {
      200: { description: 'Шаблон', content: json(DmAdminTemplateCard) },
      404: { description: 'Шаблон не найден', content: error },
      ...denied,
    },
  }),
  save: createRoute({
    method: 'put',
    path: `${BASE}/{id}`,
    tags,
    summary: '«Сохранить» или «Опубликовать» шаблон (с версией записи)',
    middleware: [requirePlatformAdmin] as const,
    request: {
      params: DmTemplateIdParam,
      body: { content: json(DmTemplateSave), required: true },
    },
    responses: {
      200: { description: 'Шаблон после сохранения', content: json(DmAdminTemplateCard) },
      ...versionedSaveResponses,
      ...saveFails,
      ...denied,
    },
  }),
  copy: createRoute({
    method: 'post',
    path: `${BASE}/{id}/copy`,
    tags,
    summary: '«Копировать»: новый черновик из шаблона',
    middleware: [requirePlatformAdmin] as const,
    request: { params: DmTemplateIdParam },
    responses: {
      201: { description: 'Окно копии', content: json(DmAdminTemplateCard) },
      404: { description: 'Шаблон не найден', content: error },
      ...denied,
    },
  }),
  state: createRoute({
    method: 'post',
    path: `${BASE}/{id}/state`,
    tags,
    summary: '«Отключить» или «Включить» шаблон с причиной',
    middleware: [requirePlatformAdmin] as const,
    request: {
      params: DmTemplateIdParam,
      body: { content: json(DmTemplateStateInput), required: true },
    },
    responses: {
      200: { description: 'Шаблон после смены состояния', content: json(DmAdminTemplateCard) },
      ...versionedSaveResponses,
      ...denied,
    },
  }),
} as const;

type Routes = typeof TEMPLATE_ADMIN_ROUTES;
type Texts = (key: string) => string;
type Tr = (key: string, params?: Record<string, string | number>) => string;

const trOf =
  (t: Texts): Tr =>
  (key, params) =>
    formatText(t(key), params);

const isModule = (m: string | null): m is DmModule =>
  m !== null && (DM_MODULES as readonly string[]).includes(m);
const extraOf = (p: string | null) =>
  (DM_EXTRA_PERMISSIONS as readonly string[]).includes(p ?? '')
    ? (p as (typeof DM_EXTRA_PERMISSIONS)[number])
    : null;

const STATE_RANK: Record<DmTemplateState, number> = { draft: 0, published: 1, off: 2, broken: 3 };

/** Столбцы шаблона в окне (без служебной отметки `contractor`: она следует из вида `cp`). */
const editorColumns = (cols: readonly DmTemplateColumn[]): DmEditorColumn[] =>
  cols.map((c) => ({
    code: c.code,
    name: c.name,
    type: c.contractor ? 'cp' : c.type,
    total: c.total,
  }));
const editorParams = (params: readonly DmTemplateParam[]): DmEditorParam[] =>
  params.map((p) => ({ ...p }));
const dbColumns = (cols: readonly DmEditorColumn[]): DmTemplateColumn[] =>
  cols.map((c) => ({ ...c, contractor: c.type === 'cp' }));

// ───── Токены и организации шаблонов (прототип `dmUse`) ─────

interface Usage {
  toks: number;
  tokOrgs: number;
  orgs: number | null;
}

/** Внутри транзакции — только `tx`: момент «сейчас» приходит значением, не `deps` (п. О-46). */
async function usageOf(
  tx: Tx,
  now: Date,
  templates: readonly DmAdminTemplate[],
): Promise<Map<string, Usage>> {
  const since = new Date(now.getTime() - 30 * DAY_MS);
  const today: IsoDate = bishkekDate(now);
  const [{ now: dbNow, items }, requests] = await Promise.all([
    dmTokenFacts(tx, { since, today }),
    dmTemplateRequestOrgs(tx, since),
  ]);
  const live = items.filter(
    (f) =>
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
        dbNow,
      ).state === 'active',
  );
  const out = new Map<string, Usage>();
  for (const t of templates) {
    const toks = live.filter((f) => f.templateId === t.id);
    const orgs = new Set(requests.get(t.id) ?? []);
    for (const f of toks) if (f.orgId) orgs.add(f.orgId);
    out.set(t.id, {
      toks: toks.length,
      tokOrgs: new Set(toks.map((f) => f.orgId ?? 'admin')).size,
      orgs: t.audience === 'admin' ? null : orgs.size,
    });
  }
  return out;
}

const NO_USAGE: Usage = { toks: 0, tokOrgs: 0, orgs: null };

function rowOf(t: DmAdminTemplate, u: Usage): DmAdminTemplateRow {
  return {
    id: t.id,
    name: t.name,
    code: t.code,
    builtin: t.builtin,
    audience: t.audience,
    state: t.state,
    orgs: u.orgs,
    toks: u.toks,
    checkedAt: t.checkedAt?.toISOString() ?? null,
    module: isModule(t.module) ? t.module : null,
    canOff: dmStateChangeAllowed(t.state, 'off'),
    canOn: dmStateChangeAllowed(t.state, 'published'),
  };
}

function listRowOf(t: DmAdminTemplate, u: Usage, tr: Tr): DmTemplateListRow {
  return {
    id: t.id,
    name: t.name,
    code: t.code,
    kind: t.audience,
    kindText: tr(`dm.tpl.kind.${t.audience}`),
    state: t.state,
    stateText: tr(`dm.tpl.state.${t.state}`),
    stateRank: STATE_RANK[t.state],
    orgs: u.orgs,
    toks: u.toks,
    checked: t.checkedAt?.toISOString() ?? null,
    mod: t.module ?? '',
    modText: t.module ? tr(`dm.mod.${t.module}`) : tr('dm.tpl.mod.none'),
  };
}

async function listRows(tx: Tx, now: Date, tr: Tr) {
  const all = await dmAdminTemplates(tx);
  const usage = await usageOf(tx, now, all);
  return all.map((t) => {
    const u = usage.get(t.id) ?? NO_USAGE;
    return { t, row: rowOf(t, u), list: listRowOf(t, u, tr) };
  });
}

// ───── История шаблона ─────

const stateText = (tr: Tr, s: unknown) =>
  typeof s === 'string' && s ? tr(`dm.tpl.state.${s}`) : '';

async function historyOf(tx: Tx, id: string, tr: Tr) {
  const rows = await dmTemplateHistory(tx, id);
  return rows
    .map((h) => {
      const by = (f: string) => h.changes.find((c) => c.field === f);
      const st = by('state');
      const what =
        h.action === 'create'
          ? tr('dm.tpl.hist.create', { state: stateText(tr, st?.to) })
          : h.action === 'dm_copy'
            ? tr('dm.tpl.hist.copy', {
                name: String(by('copiedFrom')?.to ?? ''),
                state: stateText(tr, st?.to),
              })
            : h.action === 'dm_state'
              ? h.reason
                ? tr('dm.tpl.hist.state_reason', {
                    from: stateText(tr, st?.from),
                    to: stateText(tr, st?.to),
                    reason: h.reason,
                  })
                : tr('dm.tpl.hist.state', {
                    from: stateText(tr, st?.from),
                    to: stateText(tr, st?.to),
                  })
              : tr('dm.tpl.hist.update', {
                  fields: h.changes.map((c) => tr(fieldKey(c.field))).join(', '),
                });
      return {
        at: h.at.toISOString(),
        who: h.actorUserId ? PLATFORM_ADMIN_NAME : tr('status.system'),
        what,
      };
    })
    .reverse();
}

async function cardOf(tx: Tx, now: Date, id: string, tr: Tr) {
  const t = await dmAdminTemplate(tx, id);
  if (!t) throw new RecordNotFoundError('dm_template', id);
  const [usage, history] = await Promise.all([usageOf(tx, now, [t]), historyOf(tx, id, tr)]);
  const u = usage.get(t.id) ?? NO_USAGE;
  return DmAdminTemplateCard.parse({
    id: t.id,
    code: t.code,
    name: t.name,
    description: t.description,
    audience: t.audience,
    module: isModule(t.module) ? t.module : null,
    needPermission: extraOf(t.needPermission),
    access: t.access,
    orgIds: t.orgIds,
    state: t.state,
    builtin: t.builtin,
    locked: dmTemplatePublished(t.state),
    query: t.query,
    params: editorParams(t.params),
    columns: editorColumns(t.columns),
    version: t.version,
    checkedAt: t.checkedAt?.toISOString() ?? null,
    checkedOrgName: t.checkedOrgName,
    checkError: t.checkError,
    copiedFromName: t.copiedFromName,
    toks: u.toks,
    tokOrgs: u.tokOrgs,
    orgs: u.orgs,
    canOff: dmStateChangeAllowed(t.state, 'off'),
    canOn: dmStateChangeAllowed(t.state, 'published'),
    history,
  });
}

// ───── «Проверить» ─────

/** Текст отказа по тексту запроса (прототип `dmSqlErr`). */
const sqlMessage = (tr: Tr, p: DmQueryProblem) => dmSqlProblemText(tr, p);

interface CheckRequest {
  audience: 'org' | 'admin';
  query: string;
  params: readonly DmEditorParam[];
  columns: readonly DmEditorColumn[];
  /** Столбцы опубликованного шаблона: ни один не должен пропасть. */
  published: readonly DmEditorColumn[] | null;
  orgId: string | null;
  /**
   * Название шаблона для записи в историю организации: только шаблона «Для организаций», доступного
   * ей; иначе (новый, шаблон Админки, «Выбранные» без неё) — запись без названия.
   */
  nameFor: (orgId: string) => string | null;
}

/** Название шаблона в истории организации — только если шаблон для неё. */
const nameForOrg =
  (
    t: {
      audience: 'org' | 'admin';
      access: 'all' | 'selected';
      orgIds: readonly string[];
      name: string;
    } | null,
  ) =>
  (orgId: string): string | null =>
    t && t.audience === 'org' && t.name && (t.access === 'all' || t.orgIds.includes(orgId))
      ? t.name
      : null;

type CheckOutcome =
  | {
      ok: true;
      orgId: string | null;
      orgName: string | null;
      res: DmResult;
      params: DmEditorParam[];
      columns: DmEditorColumn[];
    }
  | {
      ok: false;
      problem: 'sql' | 'no_columns' | 'bad_name' | 'dup_name' | 'removed' | 'timeout' | 'failed';
      code: string;
      message: string;
      params: DmEditorParam[];
    };

const QUERY_CANCELED = '57014';

/** Организация проверки: выбранная или демо (блок 3, пункт 1: «сначала стоит демо-организация»). */
async function checkOrg(
  deps: ApiDeps,
  adminId: string,
  orgId: string | null,
  tr: Tr,
): Promise<{ id: string; name: string }> {
  const orgs = await withUserContext(deps.db, adminId, (tx) => dmTemplateOrgOptions(tx));
  const org = orgId ? orgs.find((o) => o.id === orgId) : orgs.find((o) => o.demo);
  if (orgId && !org) throw new RecordNotFoundError('organization', orgId);
  if (!org) apiFail(400, 'dm_org_required', tr('err.dm_org_required'));
  return org;
}

/**
 * Выполнить запрос окна (не сохраняя шаблон): тем же исполнителем, что «Вывод», без области «Свои»;
 * обязательные параметры без значения по умолчанию уходят пустыми. Проверка на данных организации —
 * запись в её историю, как открытие карточки (сторож частоты открытий — у вызывающего).
 */
async function runCheck(
  deps: ApiDeps,
  c: Context<AppEnv>,
  r: CheckRequest,
  tr: Tr,
): Promise<CheckOutcome> {
  const adminId = c.get('session')!.userId;
  const problem = dmQueryProblem(r.query);
  const names = dmQueryParamNames(r.query);
  const params = Array.isArray(names) ? dmSyncParams(names, r.params) : [...r.params];
  if (problem) {
    return {
      ok: false,
      problem: 'sql',
      code: `dm_sql_${problem.code}`,
      message: sqlMessage(tr, problem),
      params,
    };
  }
  const bound = dmBind(
    r.query,
    params.map((p) => ({ k: p.code, type: p.type, req: false, def: p.default })),
    {},
    bishkekDate(deps.clock.now()),
  );
  if (!bound.ok) {
    const message =
      bound.error === 'sql'
        ? tr('err.dm_check_failed', { error: dmSqlProblemText(tr, bound) })
        : tr('err.dm_bad_param', {
            param: params.find((p) => p.code === bound.param)?.name ?? bound.param,
          });
    return { ok: false, problem: 'failed', code: 'dm_check_failed', message, params };
  }
  let org: { id: string; name: string } | null = null;
  if (r.audience === 'org') {
    org = await checkOrg(deps, adminId, r.orgId, tr);
    await guardCardRead(deps, c, false);
  }
  const q = { text: bound.text, params: bound.params, maxRows: DM_ROWS_MAX };
  let res: DmResult;
  try {
    const on = org;
    // Запись в историю организации — когда место запуска уже взято: без запуска её нет.
    res = await withDmPoolSlot(deps, tr, async () => {
      if (!on) return runDmAdmin(deps.db, adminId, q);
      const name = r.nameFor(on.id);
      await withOrgContext(deps.db, { orgId: on.id, userId: adminId }, (tx) =>
        writeHistory(tx, {
          entity: 'organization',
          entityId: on.id,
          action: 'card_view',
          reason: name ? tr('dm.tpl.history_check', { name }) : tr('dm.tpl.history_check_new'),
        }),
      );
      return runDmOrg(deps.db, { orgId: on.id, userId: adminId }, q);
    });
  } catch (err) {
    const pg = dmErrorOf(err);
    if (!pg) throw err;
    if (pg.code === QUERY_CANCELED) {
      return {
        ok: false,
        problem: 'timeout',
        code: 'dm_timeout',
        message: tr('err.dm_timeout'),
        params,
      };
    }
    // Текст базы — администратору платформы (блок 3, пункт 1: «ошибка запроса показывается текстом базы»).
    return {
      ok: false,
      problem: 'failed',
      code: 'dm_check_failed',
      message: tr('err.dm_check_failed', { error: `${pg.code}: ${pg.message}` }),
      params,
    };
  }
  const cols = dmResultColumnsProblem(res.columns, r.published);
  if (cols) {
    return {
      ok: false,
      problem: cols.code,
      code: `dm_check_${cols.code}`,
      message: tr(`err.dm_check_${cols.code}`, 'column' in cols ? { column: cols.column } : {}),
      params,
    };
  }
  return {
    ok: true,
    orgId: org?.id ?? null,
    orgName: org?.name ?? null,
    res,
    params,
    columns: dmSyncColumns(res.columns, r.columns),
  };
}

// ───── Сохранение ─────

type FormInput = DmTemplateCreate & { version?: number };

/** Поля шаблона из окна, приведённые к правилам вида: у шаблона Админки нет модуля, права и доступа. */
function valuesOf(f: FormInput, tr: Tr): DmTemplateValues {
  const org = f.audience === 'org';
  if (org && !f.module) apiFail(400, 'dm_module_required', tr('err.dm_module_required'));
  const access = org ? f.access : 'all';
  const orgIds = access === 'selected' ? [...new Set(f.orgIds)] : [];
  if (access === 'selected' && orgIds.length === 0) {
    apiFail(400, 'dm_orgs_required', tr('err.dm_orgs_required'));
  }
  const problem = dmQueryProblem(f.query);
  if (problem) apiFail(400, `dm_sql_${problem.code}`, sqlMessage(tr, problem), { field: 'query' });
  const names = dmQueryParamNames(f.query) as string[];
  const missing = names.find((n) => !f.params.some((p) => p.code === n));
  if (missing) {
    apiFail(400, 'dm_param_missing', tr('err.dm_param_missing', { param: missing }), {
      param: missing,
    });
  }
  return {
    code: f.code,
    name: f.name,
    description: f.description?.trim() ? f.description : null,
    audience: f.audience,
    module: org ? f.module : null,
    needPermission: org ? f.needPermission : null,
    access,
    // Параметры — те, что есть в запросе, по его порядку.
    params: names.map((n) => f.params.find((p) => p.code === n)!),
    columns: dbColumns(f.columns),
    query: f.query,
    orgIds,
  };
}

/**
 * Параметры и столбцы с постоянным порядком ключей: из `jsonb` база отдаёт ключи в своём порядке, а
 * сравнение идёт строкой JSON.
 */
const paramsOf = (ps: readonly DmEditorParam[]) =>
  ps.map((p) => ({
    code: p.code,
    name: p.name,
    type: p.type,
    required: p.required,
    default: p.default ?? null,
  }));
const columnsOf = (cs: readonly DmEditorColumn[]) =>
  cs.map((col) => ({ code: col.code, name: col.name, type: col.type, total: col.total }));

/** Ключ словаря названия поля в строке истории: ключи словаря — в нижнем регистре. */
const fieldKey = (field: string) =>
  `dm.tpl.field.${field.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`)}`;

/** Что изменилось (прототип `ch` в `dmEdit`): поле — было и стало. */
function changesOf(before: DmAdminTemplate, v: DmTemplateValues): HistoryChange[] {
  const was: Record<(typeof DM_TEMPLATE_HISTORY_FIELDS)[number], unknown> = {
    name: before.name,
    code: before.code,
    description: before.description,
    audience: before.audience,
    query: before.query,
    module: before.module,
    needPermission: before.needPermission,
    access: before.access === 'selected' ? [...before.orgIds].sort() : 'all',
    params: paramsOf(before.params),
    columns: columnsOf(before.columns),
  };
  const now: typeof was = {
    ...v,
    access: v.access === 'selected' ? [...v.orgIds].sort() : 'all',
    params: paramsOf(v.params),
    columns: columnsOf(v.columns),
  };
  return DM_TEMPLATE_HISTORY_FIELDS.filter(
    (k) => JSON.stringify(was[k] ?? null) !== JSON.stringify(now[k] ?? null),
  ).map((k) => ({
    field: k,
    from: (was[k] ?? null) as HistoryValue,
    to: (now[k] ?? null) as HistoryValue,
  }));
}

/** Проверка окна перед публикацией или правкой опубликованного: не прошла — отказ 409 с её текстом. */
function checkFail(out: Extract<CheckOutcome, { ok: false }>): never {
  apiFail(out.problem === 'sql' ? 400 : 409, out.code, out.message, { problem: out.problem });
}

export function templateAdminHandlers(deps: ApiDeps) {
  const texts = async () => trOf(await serverTexts(deps));
  const admin = (c: Context<AppEnv>) => c.get('session')!.userId;

  const list: RouteHandler<Routes['list'], AppEnv> = async (c) => {
    const query = listQueryOf(c.req.valid('query'));
    const tr = await texts();
    const { page, rows } = await withUserContext(deps.db, admin(c), async (tx) => {
      const rows = await listRows(tx, deps.clock.now(), tr);
      return {
        rows,
        page: await listDmTemplatesPage(
          tx,
          rows.map((r) => r.list),
          query,
        ),
      };
    });
    const byId = new Map(rows.map((r) => [r.t.id, r.row]));
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
    const { col, q } = c.req.valid('query');
    const tr = await texts();
    const res = await withUserContext(deps.db, admin(c), async (tx) =>
      listDmTemplateValues(
        tx,
        (await listRows(tx, deps.clock.now(), tr)).map((r) => r.list),
        col,
        q,
      ),
    );
    return c.json(res, 200);
  };

  const exportList: RouteHandler<Routes['export'], AppEnv> = async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    const userId = admin(c);
    return withExportSlot(deps, userId, async () => {
      const t = await serverTexts(deps);
      const tr = trOf(t);
      const result = await withUserContext(
        deps.db,
        userId,
        async (tx) =>
          exportDmTemplates(
            tx,
            (await listRows(tx, deps.clock.now(), tr)).map((r) => r.list),
            query,
            keys,
          ),
        'export',
      );
      return xlsxResponse(c, {
        title: `${t('nav.dm')} — ${t('dm.tpl.title')}`,
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
    const orgs = await withUserContext(deps.db, admin(c), (tx) => dmTemplateOrgOptions(tx));
    return c.json(DmTemplateEditorForm.parse({ orgs }), 200);
  };

  /** Столбцы опубликованного шаблона (у черновика и нового — нет). */
  const publishedOf = async (adminId: string, id: string | null) => {
    if (!id) return { tpl: null, published: null };
    const tpl = await withUserContext(deps.db, adminId, (tx) => dmAdminTemplate(tx, id));
    if (!tpl) throw new RecordNotFoundError('dm_template', id);
    return {
      tpl,
      published: dmTemplatePublished(tpl.state) ? editorColumns(tpl.columns) : null,
    };
  };

  const check: RouteHandler<Routes['check'], AppEnv> = async (c) => {
    const input = c.req.valid('json');
    const adminId = admin(c);
    const t = await serverTexts(deps);
    const tr = trOf(t);
    return withRunSlot(deps, adminId, t, async () => {
      const { tpl, published } = await publishedOf(adminId, input.templateId);
      const out = await runCheck(
        deps,
        c,
        {
          audience: input.audience,
          query: input.query,
          params: input.params,
          columns: input.columns,
          published,
          orgId: input.checkOrgId,
          // Вид окна и сохранённого шаблона приходят порознь: название — только если оба «Для организаций».
          nameFor: nameForOrg(input.audience === 'org' ? tpl : null),
        },
        tr,
      );
      const body = out.ok
        ? {
            ok: true,
            orgName: out.orgName,
            n: out.res.rows.length,
            more: out.res.more,
            ms: out.res.ms,
            params: out.params,
            columns: out.columns,
            rows: out.res.rows.slice(0, DM_CHECK_ROWS),
          }
        : { ok: false, problem: out.problem, message: out.message, params: out.params };
      return c.json(DmTemplateCheckResult.parse(body), 200);
    });
  };

  /**
   * Проверка при сохранении: нужна у «Опубликовать» и у правки запроса, параметров или столбцов
   * опубликованного; столбцы окна должны быть в ответе базы (иначе окно не проверяли).
   */
  async function checkForSave(
    c: Context<AppEnv>,
    v: DmTemplateValues,
    before: DmAdminTemplate | null,
    checkOrgId: string | null,
    tr: Tr,
  ): Promise<DmTemplateCheckMark> {
    const out = await runCheck(
      deps,
      c,
      {
        audience: v.audience,
        query: v.query,
        params: v.params,
        columns: editorColumns(v.columns),
        published:
          before && dmTemplatePublished(before.state) ? editorColumns(before.columns) : null,
        orgId: checkOrgId,
        nameFor: nameForOrg(v),
      },
      tr,
    );
    if (!out.ok) checkFail(out);
    const got = new Set(out.res.columns);
    if (v.columns.length === 0 || v.columns.some((col) => !got.has(col.code))) {
      apiFail(409, 'dm_check_required', tr('err.dm_check_required'));
    }
    return { orgId: out.orgId, error: null };
  }

  /** Сохранить окно: общая часть «+ Шаблон» и «Сохранить». */
  async function save(c: Context<AppEnv>, f: FormInput, id: string | null) {
    const adminId = admin(c);
    const t = await serverTexts(deps);
    const tr = trOf(t);
    const v = valuesOf(f, tr);
    const before = id ? (await publishedOf(adminId, id)).tpl : null;
    if (before?.builtin) apiFail(409, 'dm_builtin', tr('err.dm_builtin'));
    const locked = !!before && dmTemplatePublished(before.state);
    if (locked && before.code !== v.code) {
      apiFail(400, 'dm_code_locked', tr('err.dm_code_locked'), { field: 'code' });
    }
    if (locked && before.audience !== v.audience) {
      apiFail(400, 'dm_kind_locked', tr('err.dm_kind_locked'), { field: 'audience' });
    }
    const cols = dmColumnsProblem(
      editorColumns(v.columns),
      locked ? editorColumns(before.columns) : null,
    );
    if (cols) {
      apiFail(
        400,
        `dm_check_${cols.code}`,
        tr(`err.dm_check_${cols.code}`, 'column' in cols ? { column: cols.column } : {}),
        { field: 'columns' },
      );
    }
    const ok = await withUserContext(deps.db, adminId, (tx) => dmOrgsExist(tx, v.orgIds));
    if (!ok) throw new RecordNotFoundError('organization', v.orgIds.join(','));
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    const queryChanged =
      !before ||
      before.query !== v.query ||
      !same(paramsOf(before.params), paramsOf(v.params)) ||
      !same(
        before.columns.map((col) => col.code),
        v.columns.map((col) => col.code),
      );
    const needCheck = f.publish || (locked && queryChanged);
    const run = async (): Promise<DmTemplateCheckMark | null | undefined> => {
      if (needCheck) return checkForSave(c, v, before, f.checkOrgId, tr);
      // Черновик с новым запросом — «Проверен» пусто; без правки запроса — как было.
      return queryChanged ? null : undefined;
    };
    const mark = needCheck ? await withRunSlot(deps, adminId, t, run) : await run();
    try {
      return await withUserContext(deps.db, adminId, async (tx) => {
        if (!id) {
          const state: DmTemplateState = f.publish ? 'published' : 'draft';
          const newId = await insertDmTemplate(tx, { ...v, state }, mark ?? null);
          await writePlatformHistory(tx, {
            entity: 'dm_template',
            entityId: newId,
            action: 'create',
            changes: [{ field: 'state', to: state }],
          });
          return { id: newId, card: await cardOf(tx, deps.clock.now(), newId, tr) };
        }
        const cur = await dmAdminTemplate(tx, id, { lock: true });
        if (!cur) throw new RecordNotFoundError('dm_template', id);
        const state: DmTemplateState =
          f.publish || (cur.state === 'broken' && mark) ? 'published' : cur.state;
        await updateDmTemplate(tx, id, f.version!, { ...v, state }, mark);
        const changes = changesOf(cur, v);
        if (changes.length) {
          await writePlatformHistory(tx, {
            entity: 'dm_template',
            entityId: id,
            action: 'update',
            changes,
          });
        }
        if (state !== cur.state) {
          await writePlatformHistory(tx, {
            entity: 'dm_template',
            entityId: id,
            action: 'dm_state',
            changes: [{ field: 'state', from: cur.state, to: state }],
          });
        }
        return { id, card: await cardOf(tx, deps.clock.now(), id, tr) };
      });
    } catch (err) {
      if (uniqueViolation(err) === 'dm_templates_code_unique') {
        apiFail(400, 'dm_code_taken', tr('err.dm_code_taken'), { field: 'code' });
      }
      throw err;
    }
  }

  const create: RouteHandler<Routes['create'], AppEnv> = async (c) => {
    const { card } = await save(c, c.req.valid('json'), null);
    return c.json(card, 201);
  };

  const update: RouteHandler<Routes['save'], AppEnv> = async (c) => {
    const { id } = c.req.valid('param');
    const { card } = await save(c, c.req.valid('json'), id);
    return c.json(card, 200);
  };

  const card: RouteHandler<Routes['card'], AppEnv> = async (c) => {
    const { id } = c.req.valid('param');
    const tr = await texts();
    return c.json(
      await withUserContext(deps.db, admin(c), (tx) => cardOf(tx, deps.clock.now(), id, tr)),
      200,
    );
  };

  const copy: RouteHandler<Routes['copy'], AppEnv> = async (c) => {
    const { id } = c.req.valid('param');
    const tr = await texts();
    const res = await withUserContext(deps.db, admin(c), async (tx) => {
      const src = await dmAdminTemplate(tx, id);
      if (!src) throw new RecordNotFoundError('dm_template', id);
      // Коды выдаются по одному: две копии одного шаблона разом не получат один код.
      await lockDmTemplateCodes(tx);
      const code = dmCopyCode(src.code, await dmTemplateCodes(tx));
      const newId = await insertDmTemplate(
        tx,
        {
          code,
          name: tr('dm.tpl.copy_name', { name: src.name }).slice(0, DM_NAME_MAX),
          description: src.description,
          audience: src.audience,
          module: src.module,
          needPermission: src.needPermission,
          access: src.access,
          params: src.params,
          columns: src.columns,
          query: src.query,
          orgIds: src.orgIds,
          state: 'draft',
          copiedFrom: src.id,
        },
        null,
      );
      await writePlatformHistory(tx, {
        entity: 'dm_template',
        entityId: newId,
        action: 'dm_copy',
        changes: [
          { field: 'copiedFrom', to: src.name },
          { field: 'state', to: 'draft' },
        ],
      });
      return cardOf(tx, deps.clock.now(), newId, tr);
    });
    return c.json(res, 201);
  };

  const state: RouteHandler<Routes['state'], AppEnv> = async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const tr = await texts();
    const res = await withUserContext(deps.db, admin(c), async (tx) => {
      const cur = await dmAdminTemplate(tx, id, { lock: true });
      if (!cur) throw new RecordNotFoundError('dm_template', id);
      if (!dmStateChangeAllowed(cur.state, input.to)) {
        apiFail(409, 'dm_state_bad', tr('err.dm_state_bad'));
      }
      await setDmTemplateState(tx, id, input.version, input.to);
      await writePlatformHistory(tx, {
        entity: 'dm_template',
        entityId: id,
        action: 'dm_state',
        changes: [{ field: 'state', from: cur.state, to: input.to }],
        reason: input.reason,
      });
      return cardOf(tx, deps.clock.now(), id, tr);
    });
    return c.json(res, 200);
  };

  return { list, values, exportList, form, check, create, card, update, copy, state };
}
