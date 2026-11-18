import { hashSessionToken, isSessionTokenShape, newSessionToken } from '@buhuchet/adapters/tokens';
import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  contractorPageHeader,
  contractorTelegramCounts,
  contractorPageOrg,
  contractorPageTarget,
  cpCodeHelp,
  cpHelpForPage,
  contractorPageState,
  getContractorPage,
  listContractorSentFiles,
  pageContractorFacts,
  pageFiles,
  pageReportFile,
  readCpHelp,
  sentUploadState,
  tryContractorPageCode,
  withOrgContext,
  writeContractorPageOpen,
  type Tx,
} from '@buhuchet/db';
import {
  bishkekDate,
  CP_TG_MAX,
  filePreviewKind,
  isPageAddress,
  pageDevice,
  pageFileCategories,
  PAGE_FILE_LINK_SECONDS,
  pageIpSubject,
  pageVisibleSections,
  PAGE_COOKIE,
  PAGE_COOKIE_SECURE,
  PAGE_REMEMBER_DAYS,
  sentFileDaysLeft,
  sentUploadOn,
  type IsoDate,
} from '@buhuchet/domain';
import {
  ApiError,
  PublicPage,
  PublicPageCodeInput,
  PublicPageCodeOk,
  PublicPageFileParams,
  PublicPageFileQuery,
  PublicPageParams,
  type PageGateOrg,
  type PublicPage as PublicPageBody,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { createHash } from 'node:crypto';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { translateOf } from '../contractors/common';
import { logoLink } from '../org/logo-link';
import { notifyPageClosed } from './closed';
import { contractorPageBody } from './view';

/*
 * Страница контрагента по ссылке без входа (задача 2.42; ТЗ «Страница контрагента по ссылке» →
 * «Защита»; прототип modules/cp-page.js, pubDraw). Единственные методы API без сеанса, которые
 * отдают данные организации (`PUBLIC_PATTERNS` в middleware/session.ts): страницу находит и код сверяет
 * база (`app.contractor_page_*`), данные одного контрагента читаются в контексте его организации уже
 * после этого. Выключенная страница, неизвестный адрес или ИНН, архивный контрагент — одинаково
 * «Страница недоступна». Ответы не кэшируются и не индексируются. Разделы страницы (задача 2.43) —
 * `contractorPageBody`: скрытые разделы в ответ не попадают.
 */

const error = { 'application/json': { schema: ApiError } };

/**
 * Cookie страницы (верный код запоминается в этом браузере на `PAGE_REMEMBER_DAYS` — 1 день с момента
 * ввода, доработки 14.11.2026, блок 6; было 30 дней): своя у каждой ссылки
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

export function pageTokenHash(c: Context<AppEnv>, deps: ApiDeps): string | null {
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
export function clientIpHash(c: Context<AppEnv>, deps: ApiDeps): string {
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

/**
 * Чья страница — для экранов кода (прототип v135 `pubBrand`): название и логотип организации. Только у
 * страницы, которая есть (включена, контрагент не в архиве, организация не заблокирована) — у
 * «Страницы недоступна» организации нет. О контрагенте до кода страница не сообщает ничего.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#К-21
async function pageGateOrg(deps: ApiDeps, slug: string, inn: string): Promise<PageGateOrg | null> {
  const target = await contractorPageTarget(deps.db, slug, inn);
  if (!target) return null;
  const header = await withOrgContext(deps.db, { orgId: target.orgId, userId: null }, (tx) =>
    contractorPageHeader(tx, target.contractorId),
  );
  if (!header) return null;
  return {
    name: header.orgName,
    logo: await logoLink(deps, target.orgId, header.orgLogoKey),
  };
}

export const publicPageRoute = createRoute({
  method: 'get',
  path: '/page/{slug}/{inn}',
  tags: ['contractor-page'],
  summary: 'Страница контрагента по ссылке (без входа)',
  request: { params: PublicPageParams },
  responses: {
    200: {
      description:
        '«Страница недоступна», ввод кода, ввод закрыт после неверных кодов, «Страница закрыта» после 5 неверных кодов за сутки (до «Сменить код») или открытая страница (браузер с запомненным кодом)',
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
    // Экран кода — только «Что это за страница?» и объяснение (доработки 15.11.2026, прототип v120
    // `cphCodeWhat`): остальные подсказки страница получает после кода.
    if (state.state === 'unavailable')
      return c.json({ state: 'unavailable' } as PublicPageBody, 200);
    if (state.state !== 'open') {
      // Экраны кода — с названием и логотипом организации (прототип v135 `pubBrand`).
      const org = await pageGateOrg(deps, slug, inn);
      if (state.state === 'code') {
        return c.json(
          { state: 'code', org, help: await cpCodeHelp(deps.db) } as PublicPageBody,
          200,
        );
      }
      if (state.state === 'closed') return c.json({ state: 'closed', org } as PublicPageBody, 200);
      return c.json(
        { state: 'locked', org, lockedUntil: timeOf(state.lockedUntil) } as PublicPageBody,
        200,
      );
    }
    const { orgId, contractorId } = state;
    const device = pageDevice(c.req.header('user-agent') ?? '');
    const t = await translateOf(deps);
    const now = deps.clock.now();
    const today = bishkekDate(now);
    const page = await withOrgContext(deps.db, { orgId, userId: null }, async (tx) => {
      const [header, org, own, help] = await Promise.all([
        contractorPageHeader(tx, contractorId),
        contractorPageOrg(tx, orgId),
        getContractorPage(tx, contractorId),
        readCpHelp(tx),
      ]);
      if (!header || !org || !own) return null;
      // Раздел «Telegram» есть, только когда бот подключён (задача К3).
      const sections = pageVisibleSections(
        org.pageSections,
        org.features,
        own.hiddenSections,
      ).filter((s) => s !== 'tg' || (!!deps.telegram && !!deps.config.TELEGRAM_BOT_USERNAME));
      const body = await contractorPageBody(tx, {
        orgId,
        contractorId,
        sections,
        features: org.features,
        today,
        t,
      });
      if (!body) return null;
      await writeContractorPageOpen(tx, contractorId, device);
      const tg = sections.includes('tg') ? await contractorTelegramCounts(tx, contractorId) : null;
      // «Удалится через N дней» — по настоящим часам: время отправки ставит база (как `files/sent.ts`).
      const sent = sections.includes('files')
        ? await pageSent(tx, contractorId, bishkekDate(new Date()))
        : null;
      const { orgPhone, ...rest } = body;
      return {
        ...rest,
        asOf: now.toISOString(),
        contractor: { name: header.name, inn: header.inn, regime: header.regime },
        org: {
          name: header.orgName,
          logo: await logoLink(deps, orgId, header.orgLogoKey),
          phone: orgPhone,
        },
        sections,
        telegram: tg && { ...tg, full: tg.on + tg.wait >= CP_TG_MAX },
        sent,
        // Подсказки и обучение (доработки 15.11.2026): включённые облачка, вопросы и слова.
        help: cpHelpForPage(help),
      };
    });
    if (!page) return c.json({ state: 'unavailable' } as PublicPageBody, 200);
    return c.json({ state: 'open', page } as PublicPageBody, 200);
  };
}

/**
 * «Отправить файл» и «Отправленные вами» раздела «Файлы» (доработки 14.11.2026, блок 2; прототип v112
 * `pubSentHtml`): отправлять можно — кнопка, отправленные со страницы и из Telegram — от новых к старым
 * со статусом, причиной отказа и «Удалится через N дней». Нечего показать — null. Кто принял или
 * отклонил, комментарий сотрудника и имя в Telegram странице не отдаются.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#И-7
async function pageSent(tx: Tx, contractorId: string, today: IsoDate) {
  const state = await sentUploadState(tx, contractorId);
  const upload = !!state && sentUploadOn(state);
  const items = await listContractorSentFiles(tx, contractorId);
  if (!upload && !items.length) return null;
  return {
    upload,
    items: items.map((x) => ({
      id: x.id,
      name: x.name,
      sentAt: x.createdAt.toISOString(),
      telegram: x.source === 'telegram',
      comment: x.comment,
      status: x.status,
      reason: x.status === 'rejected' ? x.rejectReason : null,
      daysLeft: sentFileDaysLeft(x, today),
    })),
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
      description: 'Верный код: браузер получает cookie страницы на 1 день',
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
        'Ввод закрыт: 5 неверных кодов подряд по ссылке (`page_locked`, 15 минут) или 3 неверных за час с адреса (`page_ip_locked`, час) — до какого момента, в `details.lockedUntil`; 5 неверных кодов за сутки по ссылке с любых адресов — страница закрыта до «Сменить код» (`page_closed`)',
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
      case 'closed':
        if (result.justClosed) {
          await notifyPageClosed(deps, result.justClosed.orgId, result.justClosed.contractorId);
        }
        return apiFail(429, 'page_closed', 'Страница закрыта');
      default:
        return unavailable();
    }
  };
}

export const publicPageFileRoute = createRoute({
  method: 'get',
  path: '/page/{slug}/{inn}/files/{id}',
  tags: ['contractor-page'],
  summary: 'Открыть файл со страницы контрагента (без входа)',
  request: { params: PublicPageFileParams, query: PublicPageFileQuery },
  responses: {
    302: {
      description:
        'Переход на подписанную ссылку на 5 минут: картинка и PDF открываются в браузере (с `download=1` — скачиваются), остальное скачивается',
    },
    400: { description: 'Номер файла неверного вида', content: error },
    404: {
      description:
        'Страница не открыта в этом браузере (нет кода), «Файлы в карточках» выключены, файла нет у показанных отчётов и в показанном разделе «Файлы» этого контрагента, файл скрыт со страницы',
      content: error,
    },
  },
});

/**
 * Файл со страницы (ТЗ «файлы, приложенные при сдаче (отчёт, квитанция), открываются для просмотра и
 * скачивания»; раздел «Файлы» — решение заказчика 06.11.2026): только в браузере, где страница открыта
 * по коду (cookie этой ссылки), только при включённых «Файлах в карточках», только файл этого
 * контрагента, который страница показывает: у отчёта показанного раздела «Отчёты» или в показанном
 * разделе «Файлы», не скрытый со страницы. Ссылка — на 5 минут (ТЗ «Файлы»). Всё остальное —
 * одинаково «Страница недоступна».
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Е-4 — файлы только при «Файлах в карточках».
export function publicPageFileHandler(
  deps: ApiDeps,
): RouteHandler<typeof publicPageFileRoute, AppEnv> {
  return async (c) => {
    const { slug, inn, id } = c.req.valid('param');
    const { download } = c.req.valid('query');
    privateHeaders(c);
    const unavailable = () =>
      apiFail(404, 'page_unavailable', 'Страница недоступна. Обратитесь к вашему бухгалтеру.');
    if (!isPageAddress(slug, inn)) return unavailable();
    const state = await contractorPageState(deps.db, slug, inn, pageTokenHash(c, deps));
    if (state.state !== 'open') return unavailable();
    const { orgId, contractorId } = state;
    const file = await withOrgContext(deps.db, { orgId, userId: null }, async (tx) => {
      const [org, own, facts] = await Promise.all([
        contractorPageOrg(tx, orgId),
        getContractorPage(tx, contractorId),
        pageContractorFacts(tx, contractorId),
      ]);
      if (!org || !own || !facts || !org.features.files) return null;
      const sections = pageVisibleSections(org.pageSections, org.features, own.hiddenSections);
      if (sections.includes('reports')) {
        const found = await pageReportFile(tx, contractorId, id);
        if (found) return found;
      }
      if (!sections.includes('files')) return null;
      const categories = pageFileCategories(sections, {
        projects: org.features.projects,
        fee: sections.includes('fee') && !facts.oneOff,
      });
      const [found] = await pageFiles(tx, contractorId, categories, id);
      return found ?? null;
    });
    if (!file) return unavailable();
    const url = await deps.storage.signedDownloadUrl(file.storageKey, {
      expiresInSeconds: PAGE_FILE_LINK_SECONDS,
      fileName: file.name,
      ...(filePreviewKind(file.contentType) && download !== '1'
        ? { inline: { contentType: file.contentType } }
        : {}),
    });
    return c.redirect(url, 302);
  };
}
