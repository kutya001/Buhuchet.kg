import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  adminUsers,
  exportVideoViews,
  kbMembers,
  listVideoViewsPage,
  listVideoViewsValues,
  orgMenuSettings,
  roleRightsMap,
  videoGuests,
  videoRecords,
  videoSegmentsOf,
  videoSessionsOf,
  videoViewListRow,
  videoViewOf,
  videoViewRecords,
  videoViewStats,
  videoVisibilityOf,
  withOrgContext,
  withUserContext,
  type Tx,
  type VideoRecord,
  type VideoViewListRow,
  type VideoViewRecord,
  type VideoViewSubject,
} from '@buhuchet/db';
import {
  kbBusinessAccess,
  MENU_MODULES,
  videoLive,
  videoPct,
  videoSecs,
  videoSegLen,
  videoViewStatus,
  videoVisible,
  type ListQuery,
} from '@buhuchet/domain';
import {
  ApiError,
  ListExportParams,
  ListQueryParams,
  ListValues,
  ListValuesQuery,
  VideoViewHistory,
  VideoViewList,
  VideoViewParam,
} from '@buhuchet/shared';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, listQueryOf, listQueryResponses } from '../../errors';
import { exportRateResponses, withExportSlot, xlsxContent, xlsxResponse } from '../../lists/export';
import { orgContextOf, requirePermission, requirePlatformAdmin } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';

/*
 * «Просмотры видео» (решение заказчика 08.11.2026, прототип v79 `renderKbVViews`, `vidViewRows`,
 * `vidHistDlg`, `vidAdmSum`): строка — сотрудник и доступная ему видеоинструкция, в том числе ещё не
 * открытая; презентации по людям не показываются; заблокированных нет. В Базе знаний — сотрудники своей
 * организации (владелец и право «Видеть уровни сотрудников»), в Админке — все организации со сводкой по
 * видео и гостями лендинга.
 */

const error = { 'application/json': { schema: ApiError } };
const json = <T>(schema: T) => ({ 'application/json': { schema } });
const noRight = { description: 'Нет права «Видеть уровни сотрудников»', content: error };
const notAdmin = { description: 'Не администратор платформы', content: error };

type T = (key: string) => string;

const isInstr = (v: VideoRecord) => v.kind === 'instr';
/** Видеоинструкция без публикации (удалена или снята) — в статистике остаётся у тех, кто смотрел. */
const goneInstr = (v: VideoRecord) => isInstr(v) && !videoLive(videoVisibilityOf(v));

function byUser(views: readonly VideoViewRecord[]) {
  const out = new Map<string, Map<string, VideoViewRecord>>();
  for (const w of views) {
    let m = out.get(w.userId);
    if (!m) out.set(w.userId, (m = new Map()));
    m.set(w.videoId, w);
  }
  return out;
}

/** Строки организации из контекста: доступ к видео — по правам роли и функциям учётной политики. */
async function orgViewRows(tx: Tx, orgId: string, t: T): Promise<VideoViewListRow[]> {
  const members = (await kbMembers(tx)).filter((m) => m.active);
  if (!members.length) return [];
  const [{ features, reportConfirm }, rights, records, views] = await Promise.all([
    orgMenuSettings(tx, orgId),
    roleRightsMap(
      tx,
      members.map((m) => m.roleId),
    ),
    videoRecords(tx, { withDeleted: true }),
    videoViewRecords(tx),
  ]);
  const viewsOf = byUser(views);
  const rows: VideoViewListRow[] = [];
  for (const m of members) {
    const r = rights.get(m.roleId);
    const access = kbBusinessAccess(
      {
        employeeId: m.employeeId,
        isOwner: r?.isOwner ?? false,
        permissions: new Set(r?.permissions ?? []),
        scopes: r?.scopes ?? {},
      },
      features,
      { reportConfirm },
    );
    const own = viewsOf.get(m.userId) ?? new Map<string, VideoViewRecord>();
    const subject = (video: VideoRecord): VideoViewSubject => ({
      orgId,
      orgName: '',
      userId: m.userId,
      fullName: m.fullName,
      role: m.roleName,
      video,
      view: own.get(video.id) ?? null,
    });
    const available = records.filter(
      (v) => isInstr(v) && videoVisible(videoVisibilityOf(v), access),
    );
    for (const v of available) rows.push(videoViewListRow(subject(v), t));
    for (const v of records) {
      if (own.has(v.id) && goneInstr(v) && !available.includes(v)) {
        rows.push(videoViewListRow(subject(v), t));
      }
    }
  }
  return rows;
}

const BUSINESS: ReadonlySet<string> = new Set(MENU_MODULES.map((m) => m.id));

/**
 * Строки Админки — все организации (прототип `vidViewRows(adm)` для других организаций): опубликованные
 * видеоинструкции «для всех» общего раздела и модулей режима Бизнес, и просмотры снятых и удалённых.
 */
async function adminViewRows(tx: Tx, t: T): Promise<VideoViewListRow[]> {
  const [people, records, views] = await Promise.all([
    tx
      .select({
        id: adminUsers.id,
        orgId: adminUsers.orgId,
        orgName: adminUsers.orgName,
        fullName: adminUsers.fullName,
        login: adminUsers.login,
        role: adminUsers.roleName,
      })
      .from(adminUsers)
      .where(
        and(
          eq(adminUsers.isPlatformAdmin, false),
          eq(adminUsers.blocked, false),
          eq(adminUsers.employeeActive, true),
          isNotNull(adminUsers.orgId),
        ),
      ),
    videoRecords(tx, { withDeleted: true }),
    videoViewRecords(tx),
  ]);
  const viewsOf = byUser(views);
  const available = records.filter(
    (v) =>
      isInstr(v) &&
      videoLive(videoVisibilityOf(v)) &&
      v.audience !== 'adm' &&
      (!v.module || BUSINESS.has(v.module)),
  );
  const rows: VideoViewListRow[] = [];
  for (const u of people) {
    const own = viewsOf.get(u.id) ?? new Map<string, VideoViewRecord>();
    const subject = (video: VideoRecord): VideoViewSubject => ({
      orgId: u.orgId!,
      orgName: u.orgName ?? '',
      userId: u.id,
      fullName: u.fullName ?? u.login,
      role: u.role ?? '',
      video,
      view: own.get(video.id) ?? null,
    });
    for (const v of available) rows.push(videoViewListRow(subject(v), t));
    for (const v of records) {
      if (own.has(v.id) && goneInstr(v)) rows.push(videoViewListRow(subject(v), t));
    }
  }
  return rows;
}

/** Сводка по видео в Админке (прототип `vidAdmSum`): кто смотрел хотя бы секунду; гости лендинга. */
async function adminSummary(tx: Tx) {
  const [records, views, guests] = await Promise.all([
    videoRecords(tx, { withDeleted: true }),
    videoViewRecords(tx),
    videoGuests(tx),
  ]);
  const watched = views.filter((w) => videoSegLen(videoSegmentsOf(w.segs)) >= 1);
  const summary = records
    .map((v) => {
      const rs = watched.filter((w) => w.videoId === v.id);
      return { v, rs };
    })
    .filter(({ v, rs }) => rs.length || guests.has(v.id))
    .map(({ v, rs }) => ({
      videoId: v.id,
      title: v.title,
      kind: v.kind as 'instr' | 'pres',
      deleted: v.deletedAt !== null,
      orgs: new Set(rs.map((w) => w.orgId)).size,
      viewers: rs.length,
      done: rs.filter((w) => w.doneAt).length,
      avgPct: rs.length
        ? Math.round(
            rs.reduce((sum, w) => sum + videoPct(v.duration, videoSegmentsOf(w.segs)), 0) /
              rs.length,
          )
        : 0,
    }));
  const guestRows = records
    .filter((v) => (guests.get(v.id)?.starts ?? 0) > 0)
    .map((v) => {
      const g = guests.get(v.id)!;
      return {
        videoId: v.id,
        title: v.title,
        starts: g.starts,
        avgPct: g.starts ? Math.round(g.pctSum / g.starts) : 0,
      };
    });
  return { summary, guests: guestRows };
}

const rowBody = (r: VideoViewListRow) => ({
  ...r,
  firstAt: r.firstAt?.toISOString() ?? null,
  lastAt: r.lastAt?.toISOString() ?? null,
});

async function pageBody(
  tx: Tx,
  rows: readonly VideoViewListRow[],
  query: ListQuery,
  t: T,
  admin: boolean,
) {
  const page = await listVideoViewsPage(tx, rows, query, t, admin);
  return {
    items: page.rows.map(rowBody),
    total: page.total,
    page: page.page,
    size: page.size,
    totals: page.totals,
    ...(page.groups ? { groups: page.groups, rowGroups: page.rowGroups } : {}),
    stats: videoViewStats(rows),
  };
}

/** История просмотров сотрудника по видео (прототип `vidHistDlg`). */
async function historyBody(
  tx: Tx,
  who: { fullName: string; orgName: string },
  video: VideoRecord,
  userId: string,
  t: T,
) {
  const [view, sessions] = await Promise.all([
    videoViewOf(tx, userId, video.id),
    videoSessionsOf(tx, userId, video.id),
  ]);
  const segs = videoSegmentsOf(view?.segs);
  const deleted = video.deletedAt !== null;
  return {
    fullName: who.fullName,
    orgName: who.orgName,
    videoTitle: video.title + (deleted ? t('video.deleted') : ''),
    duration: video.duration,
    segs: segs.map((s) => [s[0], s[1]] as [number, number]),
    secs: Math.round(videoSecs(video.duration, segs) * 10) / 10,
    pct: videoPct(video.duration, segs),
    status: videoViewStatus(view ? { done: view.doneAt !== null, segs } : null),
    doneAt: view?.doneAt?.toISOString() ?? null,
    sessions: sessions.map((s) => {
      const ss = videoSegmentsOf(s.segs);
      return {
        at: s.openedAt.toISOString(),
        segs: ss.map((x) => [x[0], x[1]] as [number, number]),
        secs: Math.round(videoSegLen(ss) * 10) / 10,
      };
    }),
  };
}

/* ───────────── База знаний → «Просмотры видео» ───────────── */

const orgRows = (deps: ApiDeps, c: Context<AppEnv>, t: T, kind?: 'export') => {
  const ctx = orgContextOf(c);
  return {
    ctx,
    run: <R>(fn: (tx: Tx, rows: VideoViewListRow[]) => Promise<R>) =>
      withOrgContext(deps.db, kind ? { ...ctx, kind } : ctx, async (tx) =>
        fn(tx, await orgViewRows(tx, ctx.orgId, t)),
      ),
  };
};

export const kbVideoViewsRoute = createRoute({
  method: 'get',
  path: '/kb/video-views',
  tags: ['kb'],
  summary: '«Просмотры видео»: страница списка',
  middleware: [requirePermission('kbLevels')] as const,
  request: { query: ListQueryParams },
  responses: {
    200: { description: 'Строки и сводка над списком', content: json(VideoViewList) },
    ...listQueryResponses,
    401: { description: 'Нет входа', content: error },
    403: noRight,
  },
});

export function kbVideoViewsHandler(deps: ApiDeps): RouteHandler<typeof kbVideoViewsRoute, AppEnv> {
  return async (c) => {
    const query = listQueryOf(c.req.valid('query'));
    const t = await serverTexts(deps);
    const body = await orgRows(deps, c, t).run((tx, rows) => pageBody(tx, rows, query, t, false));
    return c.json(body, 200);
  };
}

export const kbVideoViewsValuesRoute = createRoute({
  method: 'get',
  path: '/kb/video-views/values',
  tags: ['kb'],
  summary: 'Значения столбца «Просмотров видео» для фильтра',
  middleware: [requirePermission('kbLevels')] as const,
  request: { query: ListValuesQuery },
  responses: {
    200: { description: 'Значения столбца с числом записей', content: json(ListValues) },
    ...listQueryResponses,
    401: { description: 'Нет входа', content: error },
    403: noRight,
  },
});

export function kbVideoViewsValuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof kbVideoViewsValuesRoute, AppEnv> {
  return async (c) => {
    const { col, q } = c.req.valid('query');
    const t = await serverTexts(deps);
    const values = await orgRows(deps, c, t).run((tx, rows) =>
      listVideoViewsValues(tx, rows, col, t, false, q),
    );
    return c.json(values, 200);
  };
}

export const kbVideoViewsExportRoute = createRoute({
  method: 'get',
  path: '/kb/video-views/export',
  tags: ['kb'],
  summary: '«Просмотры видео» в Excel',
  middleware: [requirePermission('kbLevels'), requirePermission('export')] as const,
  request: { query: ListExportParams },
  responses: {
    200: {
      description: 'Файл Excel со всеми строками под поиском и фильтрами',
      content: xlsxContent,
    },
    ...listQueryResponses,
    ...exportRateResponses,
    401: { description: 'Нет входа', content: error },
    403: {
      description: 'Нет права «Видеть уровни сотрудников» или «Выгружать в Excel»',
      content: error,
    },
  },
});

export function kbVideoViewsExportHandler(
  deps: ApiDeps,
): RouteHandler<typeof kbVideoViewsExportRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    return withExportSlot(deps, c.get('session')!.userId, async () => {
      const t = await serverTexts(deps);
      const result = await orgRows(deps, c, t, 'export').run((tx, rows) =>
        exportVideoViews(tx, rows, query, keys, t, false),
      );
      return xlsxResponse(c, {
        title: t('tab.kb.vviews'),
        today: deps.clock.now(),
        columns: result.columns,
        rows: result.rows,
        more: result.more,
        total: result.total,
        t,
      });
    });
  };
}

export const kbVideoViewHistoryRoute = createRoute({
  method: 'get',
  path: '/kb/video-views/{userId}/{videoId}',
  tags: ['kb'],
  summary: '«История просмотров» сотрудника по видео',
  middleware: [requirePermission('kbLevels')] as const,
  request: { params: VideoViewParam },
  responses: {
    200: { description: 'Просмотр и открытия, сначала новые', content: json(VideoViewHistory) },
    401: { description: 'Нет входа', content: error },
    403: noRight,
    404: { description: 'Сотрудника или видео нет', content: error },
  },
});

export function kbVideoViewHistoryHandler(
  deps: ApiDeps,
): RouteHandler<typeof kbVideoViewHistoryRoute, AppEnv> {
  return async (c) => {
    const { userId, videoId } = c.req.valid('param');
    const t = await serverTexts(deps);
    const ctx = orgContextOf(c);
    const body = await withOrgContext(deps.db, ctx, async (tx) => {
      const member = (await kbMembers(tx)).find((m) => m.userId === userId);
      const video = (await videoRecords(tx, { withDeleted: true })).find((v) => v.id === videoId);
      if (!member || !video) apiFail(404, 'not_found', 'Сотрудник или видео не найдены');
      return historyBody(tx, { fullName: member.fullName, orgName: '' }, video, userId, t);
    });
    return c.json(body, 200);
  };
}

/* ───────────── Админка → «Просмотры видео» ───────────── */

const adminRows = (deps: ApiDeps, c: Context<AppEnv>, t: T, kind?: 'export') => ({
  run: <R>(fn: (tx: Tx, rows: VideoViewListRow[]) => Promise<R>) =>
    withUserContext(
      deps.db,
      c.get('session')!.userId,
      async (tx) => fn(tx, await adminViewRows(tx, t)),
      kind ?? 'request',
    ),
});

export const adminVideoViewsRoute = createRoute({
  method: 'get',
  path: '/admin/video-views',
  tags: ['kb'],
  summary: 'Админка → «Просмотры видео»: страница списка, сводка по видео и гости лендинга',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListQueryParams },
  responses: {
    200: { description: 'Строки всех организаций и сводки', content: json(VideoViewList) },
    ...listQueryResponses,
    401: { description: 'Нет входа', content: error },
    403: notAdmin,
  },
});

export function adminVideoViewsHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminVideoViewsRoute, AppEnv> {
  return async (c) => {
    const query = listQueryOf(c.req.valid('query'));
    const t = await serverTexts(deps);
    const body = await adminRows(deps, c, t).run(async (tx, rows) => ({
      ...(await pageBody(tx, rows, query, t, true)),
      ...(await adminSummary(tx)),
    }));
    return c.json(body, 200);
  };
}

export const adminVideoViewsValuesRoute = createRoute({
  method: 'get',
  path: '/admin/video-views/values',
  tags: ['kb'],
  summary: 'Значения столбца «Просмотров видео» Админки для фильтра',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListValuesQuery },
  responses: {
    200: { description: 'Значения столбца с числом записей', content: json(ListValues) },
    ...listQueryResponses,
    401: { description: 'Нет входа', content: error },
    403: notAdmin,
  },
});

export function adminVideoViewsValuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminVideoViewsValuesRoute, AppEnv> {
  return async (c) => {
    const { col, q } = c.req.valid('query');
    const t = await serverTexts(deps);
    const values = await adminRows(deps, c, t).run((tx, rows) =>
      listVideoViewsValues(tx, rows, col, t, true, q),
    );
    return c.json(values, 200);
  };
}

export const adminVideoViewsExportRoute = createRoute({
  method: 'get',
  path: '/admin/video-views/export',
  tags: ['kb'],
  summary: 'Админка → «Просмотры видео» в Excel',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListExportParams },
  responses: {
    200: {
      description: 'Файл Excel со всеми строками под поиском и фильтрами',
      content: xlsxContent,
    },
    ...listQueryResponses,
    ...exportRateResponses,
    401: { description: 'Нет входа', content: error },
    403: notAdmin,
  },
});

export function adminVideoViewsExportHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminVideoViewsExportRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    return withExportSlot(deps, c.get('session')!.userId, async () => {
      const t = await serverTexts(deps);
      const result = await adminRows(deps, c, t, 'export').run((tx, rows) =>
        exportVideoViews(tx, rows, query, keys, t, true),
      );
      return xlsxResponse(c, {
        title: t('tab.kbadm.vviews'),
        today: deps.clock.now(),
        columns: result.columns,
        rows: result.rows,
        more: result.more,
        total: result.total,
        t,
      });
    });
  };
}

export const adminVideoViewHistoryRoute = createRoute({
  method: 'get',
  path: '/admin/video-views/{userId}/{videoId}',
  tags: ['kb'],
  summary: 'Админка: «История просмотров» сотрудника по видео',
  middleware: [requirePlatformAdmin] as const,
  request: { params: VideoViewParam },
  responses: {
    200: { description: 'Просмотр и открытия, сначала новые', content: json(VideoViewHistory) },
    401: { description: 'Нет входа', content: error },
    403: notAdmin,
    404: { description: 'Пользователя или видео нет', content: error },
  },
});

export function adminVideoViewHistoryHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminVideoViewHistoryRoute, AppEnv> {
  return async (c) => {
    const { userId, videoId } = c.req.valid('param');
    const t = await serverTexts(deps);
    const body = await withUserContext(deps.db, c.get('session')!.userId, async (tx) => {
      const [who] = await tx
        .select({
          fullName: adminUsers.fullName,
          login: adminUsers.login,
          orgName: adminUsers.orgName,
        })
        .from(adminUsers)
        .where(and(eq(adminUsers.id, userId), eq(adminUsers.isPlatformAdmin, false)));
      const video = (await videoRecords(tx, { withDeleted: true })).find((v) => v.id === videoId);
      if (!who || !video) apiFail(404, 'not_found', 'Пользователь или видео не найдены');
      return historyBody(
        tx,
        { fullName: who.fullName ?? who.login, orgName: who.orgName ?? '' },
        video,
        userId,
        t,
      );
    });
    return c.json(body, 200);
  };
}
