import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  bellPage,
  bellRead,
  bellReadAll,
  bellSeenAll,
  bellSyncLeads,
  bellSyncNews,
  bellUnseen,
  markNewsRead,
  orgMenuSettings,
  type BellSight,
  type Tx,
} from '@buhuchet/db';
import { hasPermission } from '@buhuchet/domain';
import {
  ApiError,
  BellCount,
  BellDone,
  BellPage,
  BellQuery,
  BellReadParams,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { asSessionUser } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';
import { reportScopeOf } from '../reports/common';
import { cpScopeOf, taskAccessOf } from '../tasks/common';

/*
 * Панель колокольчика — чтение (доработки 16.11.2026, блок 3; поток Т; экран — поток И): строки
 * вошедшего, которые он видит по правам сейчас (`BellSight`), счётчик, «просмотрено», «прочитано».
 * Новости и заявки (режим Админка) кладутся при чтении: так выпущенная новость появляется у каждого, кто
 * её видит, без рассылки по всем пользователям.
 */

const error = { 'application/json': { schema: ApiError } };
const denied = {
  401: { description: 'Нет входа', content: error },
  403: { description: 'Не сотрудник организации и не администратор платформы', content: error },
} as const;

/** Сотрудник организации или администратор платформы (режим Админка); иначе — 403. */
function bellUser(c: Context<AppEnv>): boolean {
  return !!c.get('access') || !!c.get('session')?.isPlatformAdmin;
}

const forbidden = (c: Context<AppEnv>) =>
  c.json({ error: { code: 'forbidden', message: 'Нет права' } }, 403);

/** Что вошедший видит сейчас: права, области, функции учётной политики. */
async function sightOf(c: Context<AppEnv>, tx: Tx): Promise<BellSight> {
  const access = c.get('access');
  const orgId = c.get('session')?.orgId;
  if (!access || !orgId) {
    return {
      permissions: [],
      contractors: undefined,
      reports: undefined,
      tasks: null,
      cpSent: false,
      cpFee: false,
      staff: false,
    };
  }
  const s = access.subject;
  const { features } = await orgMenuSettings(tx, orgId);
  return {
    permissions: [...s.permissions],
    contractors: cpScopeOf(s),
    reports: reportScopeOf(s),
    tasks: features.tasks ? taskAccessOf(s) : null,
    cpSent: features.cppage,
    cpFee: features.fee && hasPermission(s, 'fee'),
    staff: hasPermission(s, 'staffView'),
  };
}

/** Новости вошедшего и — администратору платформы — новые заявки: до чтения строк. */
async function syncReadTime(deps: ApiDeps, c: Context<AppEnv>, tx: Tx, lead: string) {
  const now = deps.clock.now();
  await bellSyncNews(tx, now);
  if (c.get('session')?.isPlatformAdmin) await bellSyncLeads(tx, lead);
}

export const bellPageRoute = createRoute({
  method: 'get',
  path: '/bell',
  tags: ['telegram'],
  summary: 'Колокольчик: строки вошедшего, по 30, от новых к старым',
  request: { query: BellQuery },
  responses: {
    200: {
      description:
        'Только строки, которые вошедший видит по правам сейчас; контрагент — с нынешним именем; open — что открыть по нажатию',
      content: { 'application/json': { schema: BellPage } },
    },
    400: { description: 'Неверная вкладка или номер строки', content: error },
    ...denied,
  },
});

export function bellPageHandler(deps: ApiDeps): RouteHandler<typeof bellPageRoute, AppEnv> {
  return async (c) => {
    if (!bellUser(c)) return forbidden(c);
    const q = c.req.valid('query');
    const t = await serverTexts(deps);
    const page = await asSessionUser(deps, c.get('session')!, async (tx) => {
      await syncReadTime(deps, c, tx, t('bell.line.lead'));
      return bellPage(tx, await sightOf(c, tx), { tab: q.tab, before: q.before ?? null });
    });
    return c.json(
      {
        items: page.items.map((x) => ({
          id: x.id,
          kind: x.kind,
          event: x.event,
          contractor:
            x.contractorId && x.contractorName !== null
              ? { id: x.contractorId, name: x.contractorName }
              : null,
          text: x.text,
          at: x.at.toISOString(),
          read: x.read,
          open: x.targetKind && x.targetId ? { kind: x.targetKind, id: x.targetId } : null,
        })),
        more: page.more,
      },
      200,
    );
  };
}

export const bellCountRoute = createRoute({
  method: 'get',
  path: '/bell/count',
  tags: ['telegram'],
  summary: 'Колокольчик: сколько строк вошедший ещё не видел (значок)',
  responses: {
    200: { description: 'Число непросмотренных', content: { 'application/json': { schema: BellCount } } },
    ...denied,
  },
});

export function bellCountHandler(deps: ApiDeps): RouteHandler<typeof bellCountRoute, AppEnv> {
  return async (c) => {
    if (!bellUser(c)) return forbidden(c);
    const t = await serverTexts(deps);
    const unseen = await asSessionUser(deps, c.get('session')!, async (tx) => {
      await syncReadTime(deps, c, tx, t('bell.line.lead'));
      return bellUnseen(tx, await sightOf(c, tx));
    });
    return c.json({ unseen }, 200);
  };
}

export const bellSeenRoute = createRoute({
  method: 'post',
  path: '/bell/seen',
  tags: ['telegram'],
  summary: 'Колокольчик открыт: все строки вошедшего просмотрены (счётчик гаснет на всех устройствах)',
  responses: {
    200: { description: 'Готово', content: { 'application/json': { schema: BellDone } } },
    ...denied,
  },
});

export function bellSeenHandler(deps: ApiDeps): RouteHandler<typeof bellSeenRoute, AppEnv> {
  return async (c) => {
    if (!bellUser(c)) return forbidden(c);
    await asSessionUser(deps, c.get('session')!, (tx) => bellSeenAll(tx, deps.clock.now()));
    return c.json({ ok: true as const }, 200);
  };
}

export const bellReadRoute = createRoute({
  method: 'post',
  path: '/bell/{id}/read',
  tags: ['telegram'],
  summary: 'Строка колокольчика прочитана (новость — и в «Новостях»)',
  request: { params: BellReadParams },
  responses: {
    200: { description: 'Готово', content: { 'application/json': { schema: BellDone } } },
    400: { description: 'Неверный номер строки', content: error },
    404: { description: 'Строки нет или она не вошедшего', content: error },
    ...denied,
  },
});

export function bellReadHandler(deps: ApiDeps): RouteHandler<typeof bellReadRoute, AppEnv> {
  return async (c) => {
    if (!bellUser(c)) return forbidden(c);
    const { id } = c.req.valid('param');
    const found = await asSessionUser(deps, c.get('session')!, async (tx) => {
      const row = await bellRead(tx, id, deps.clock.now());
      if (row?.newsId) await markNewsRead(tx, [row.newsId]);
      return row !== null;
    });
    if (!found) return c.json({ error: { code: 'not_found', message: 'Не найдено' } }, 404);
    return c.json({ ok: true as const }, 200);
  };
}

export const bellReadAllRoute = createRoute({
  method: 'post',
  path: '/bell/read-all',
  tags: ['telegram'],
  summary: '«Прочитать все»: все строки вошедшего, без вкладки (новости — и в «Новостях»)',
  responses: {
    200: { description: 'Готово', content: { 'application/json': { schema: BellDone } } },
    ...denied,
  },
});

export function bellReadAllHandler(deps: ApiDeps): RouteHandler<typeof bellReadAllRoute, AppEnv> {
  return async (c) => {
    if (!bellUser(c)) return forbidden(c);
    await asSessionUser(deps, c.get('session')!, async (tx) => {
      const ids = await bellReadAll(tx, deps.clock.now());
      if (ids.length) await markNewsRead(tx, ids);
    });
    return c.json({ ok: true as const }, 200);
  };
}
