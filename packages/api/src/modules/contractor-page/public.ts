import { hashSessionToken, isSessionTokenShape, newSessionToken } from '@buhuchet/adapters/tokens';
import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  contractorPageHeader,
  contractorPageOrg,
  contractorPageState,
  getContractorPage,
  tryContractorPageCode,
  withOrgContext,
  writeContractorPageOpen,
} from '@buhuchet/db';
import {
  isPageAddress,
  pageDevice,
  pageIpSubject,
  pageVisibleSections,
  PAGE_COOKIE,
  PAGE_COOKIE_SECURE,
  PAGE_REMEMBER_DAYS,
} from '@buhuchet/domain';
import {
  ApiError,
  PublicPage,
  PublicPageCodeInput,
  PublicPageCodeOk,
  PublicPageParams,
  type PublicPage as PublicPageBody,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { createHash } from 'node:crypto';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { logoLink } from '../org/logo-link';

/*
 * Страница контрагента по ссылке без входа (задача 2.42; ТЗ «Страница контрагента по ссылке» →
 * «Защита»; прототип modules/cp-page.js, pubDraw). Единственные методы API без сеанса, которые
 * отдают данные организации (`PUBLIC_PATTERNS` в middleware/session.ts): страницу находит и код сверяет
 * база (`app.contractor_page_*`), данные одного контрагента читаются в контексте его организации уже
 * после этого. Выключенная страница, неизвестный адрес или ИНН, архивный контрагент — одинаково
 * «Страница недоступна». Ответы не кэшируются и не индексируются. Разделы страницы — задача 2.43.
 */

const error = { 'application/json': { schema: ApiError } };

/**
 * Cookie страницы (ТЗ «Верный код запоминается в этом браузере на 30 дней»): своя у каждой ссылки
 * (путь /<адрес организации>/inn/<ИНН>), HttpOnly, SameSite=Lax; по https — Secure. В базе — только
 * хеш токена и номер кода, при котором он выдан.
 */
function pageCookie(deps: ApiDeps) {
  const secure =
    deps.config.APP_ENV === 'staging' ||
    deps.config.APP_ENV === 'production' ||
    deps.config.APP_BASE_URL.startsWith('https:');
  return { name: secure ? PAGE_COOKIE_SECURE : PAGE_COOKIE, secure };
}

export function pageCookieName(deps: ApiDeps): string {
  return pageCookie(deps).name;
}

function pageTokenHash(c: Context<AppEnv>, deps: ApiDeps): string | null {
  const value = getCookie(c, pageCookie(deps).name);
  return value && isSessionTokenShape(value) ? hashSessionToken(value) : null;
}

/**
 * Чей счёт неверных кодов по адресу: первый адрес X-Forwarded-For — его ставит Vercel и Caddy на VPS
 * (входящий от клиента они заменяют); IPv6 — по сети /64 (`pageIpSubject`). В базе — SHA-256 адреса:
 * это маскировка, а не тайна (адрес IPv4 подбирается перебором), сам адрес нигде не хранится. Без
 * заголовка (локально, в тестах) — общий счёт «unknown»; на стенде и рабочем сайте это ошибка
 * настройки прокси — пишется предупреждение.
 */
function clientIpHash(c: Context<AppEnv>, deps: ApiDeps): string {
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  if (!forwarded && (deps.config.APP_ENV === 'staging' || deps.config.APP_ENV === 'production')) {
    deps.logger.warn(
      { requestId: c.get('requestId') },
      'нет X-Forwarded-For: предел неверных кодов по адресу общий для всех',
    );
  }
  const subject = forwarded ? pageIpSubject(forwarded) : 'unknown';
  return createHash('sha256').update(`cp-page:${subject}`, 'utf8').digest('hex');
}

/**
 * Не кэшировать нигде по дороге: ответ зависит от cookie браузера. «Не индексировать» (ТЗ «страница не
 * индексируется поисковиками») ставит всем ответам API общий слой, страница сайта — свои метаданные.
 */
function privateHeaders(c: Context<AppEnv>) {
  c.header('Cache-Control', 'no-store');
}

const timeOf = (d: Date) => d.toISOString();

export const publicPageRoute = createRoute({
  method: 'get',
  path: '/page/{slug}/{inn}',
  tags: ['contractor-page'],
  summary: 'Страница контрагента по ссылке (без входа)',
  request: { params: PublicPageParams },
  responses: {
    200: {
      description:
        '«Страница недоступна», ввод кода, ввод закрыт после неверных кодов или открытая страница (браузер с запомненным кодом)',
      content: { 'application/json': { schema: PublicPage } },
    },
  },
});

/**
 * Что показать по ссылке. Открытая страница — шапка и разделы организации и контрагента; каждое
 * открытие пишется в историю контрагента с устройством (ТЗ «каждое открытие страницы (дата, время,
 * устройство) пишутся в историю контрагента»).
 */
export function publicPageHandler(deps: ApiDeps): RouteHandler<typeof publicPageRoute, AppEnv> {
  return async (c) => {
    const { slug, inn } = c.req.valid('param');
    privateHeaders(c);
    if (!isPageAddress(slug, inn)) return c.json({ state: 'unavailable' } as PublicPageBody, 200);
    const state = await contractorPageState(deps.db, slug, inn, pageTokenHash(c, deps));
    if (state.state === 'unavailable' || state.state === 'code') {
      return c.json({ state: state.state } as PublicPageBody, 200);
    }
    if (state.state === 'locked') {
      return c.json(
        { state: 'locked', lockedUntil: timeOf(state.lockedUntil) } as PublicPageBody,
        200,
      );
    }
    const { orgId, contractorId } = state;
    const device = pageDevice(c.req.header('user-agent') ?? '');
    const page = await withOrgContext(deps.db, { orgId, userId: null }, async (tx) => {
      const [header, org, own] = await Promise.all([
        contractorPageHeader(tx, contractorId),
        contractorPageOrg(tx, orgId),
        getContractorPage(tx, contractorId),
      ]);
      if (!header || !org || !own) return null;
      await writeContractorPageOpen(tx, contractorId, device);
      return {
        asOf: deps.clock.now().toISOString(),
        contractor: { name: header.name, inn: header.inn, regime: header.regime },
        org: { name: header.orgName, logo: await logoLink(deps, orgId, header.orgLogoKey) },
        sections: pageVisibleSections(org.pageSections, org.features, own.hiddenSections),
      };
    });
    if (!page) return c.json({ state: 'unavailable' } as PublicPageBody, 200);
    return c.json({ state: 'open', page } as PublicPageBody, 200);
  };
}

export const publicPageCodeRoute = createRoute({
  method: 'post',
  path: '/page/{slug}/{inn}/code',
  tags: ['contractor-page'],
  summary: 'Ввести код доступа страницы контрагента (без входа)',
  request: {
    params: PublicPageParams,
    body: { content: { 'application/json': { schema: PublicPageCodeInput } } },
  },
  responses: {
    200: {
      description: 'Верный код: браузер получает cookie страницы на 30 дней',
      content: { 'application/json': { schema: PublicPageCodeOk } },
    },
    400: { description: 'Не 6 цифр', content: error },
    403: {
      description: 'Неверный код: в `details.triesLeft` — сколько попыток осталось до перерыва',
      content: error,
    },
    404: { description: '«Страница недоступна»', content: error },
    429: {
      description:
        'Ввод закрыт: 5 неверных кодов подряд по ссылке (`page_locked`, 15 минут) или 30 неверных за час с адреса (`page_ip_locked`, час); до какого момента — `details.lockedUntil`',
      content: error,
    },
  },
});

export function publicPageCodeHandler(
  deps: ApiDeps,
): RouteHandler<typeof publicPageCodeRoute, AppEnv> {
  return async (c) => {
    const { slug, inn } = c.req.valid('param');
    const { code } = c.req.valid('json');
    privateHeaders(c);
    const unavailable = () =>
      apiFail(404, 'page_unavailable', 'Страница недоступна. Обратитесь к вашему бухгалтеру.');
    if (!isPageAddress(slug, inn)) unavailable();
    const token = newSessionToken();
    const result = await tryContractorPageCode(deps.db, {
      slug,
      inn,
      code,
      ipHash: clientIpHash(c, deps),
      tokenHash: hashSessionToken(token),
    });
    switch (result.outcome) {
      case 'ok': {
        const { name, secure } = pageCookie(deps);
        setCookie(c, name, token, {
          httpOnly: true,
          secure,
          sameSite: 'Lax',
          path: `/${slug}/inn/${inn}`,
          maxAge: PAGE_REMEMBER_DAYS * 24 * 60 * 60,
        });
        return c.json({ ok: true as const }, 200);
      }
      case 'wrong':
        return apiFail(
          403,
          'page_code_wrong',
          `Неверный код. Осталось попыток: ${result.triesLeft}`,
          {
            triesLeft: result.triesLeft,
          },
        );
      case 'locked':
        return apiFail(429, 'page_locked', 'Ввод кода временно закрыт', {
          lockedUntil: timeOf(result.lockedUntil),
        });
      case 'ip_locked':
        return apiFail(429, 'page_ip_locked', 'Ввод кода временно закрыт', {
          lockedUntil: timeOf(result.lockedUntil),
        });
      default:
        return unavailable();
    }
  };
}
