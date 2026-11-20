import { hashSessionToken, isSessionTokenShape } from '@buhuchet/adapters/tokens';
import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  adminCpHelp,
  adminCpHelpEdit,
  readCpHelp,
  takeRateLimit,
  withOrgContext,
  withUserContext,
  writeContractorPageTour,
  type RateLimit,
} from '@buhuchet/db';
import { isPageAddress } from '@buhuchet/domain';
import {
  AdminCpHelp,
  AdminCpHelpEdit,
  ApiError,
  PublicPageParams,
  PublicPageTourInput,
  PublicPageTourOk,
} from '@buhuchet/shared';
import { getCookie } from 'hono/cookie';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { requirePlatformAdmin } from '../../middleware/access';
import { pageAccess } from './org-closed';
import { pageCookieName } from './public';

/*
 * Подсказки и обучение на странице контрагента (доработки 15.11.2026; прототип v120 modules/cp-help.js,
 * admin/cp-help-admin.js). Тексты страница получает вместе с собой (`help` открытой страницы, на экране
 * кода — только «Что это за страница?»). Здесь — конец обзора страницы («Контрагент посмотрел обзор
 * страницы» в историю контрагента) и вкладка Админки «База знаний (содержимое)» → «Страница
 * контрагента»: тексты с версией раздела и правка одной записи.
 */

const error = { 'application/json': { schema: ApiError } };
const json = <T>(schema: T) => ({ 'application/json': { schema } });

/**
 * Записей «посмотрел обзор» из одного браузера — не больше стольких за час: запрос без входа, иначе
 * знающий код засыплет историю контрагента одинаковыми строками.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#К-16
export const PAGE_TOUR_RATE_LIMIT: RateLimit = { kind: 'cp_tour', max: 10, windowSeconds: 3600 };

/**
 * И на контрагента из всех браузеров — не больше стольких за час: новый ввод кода даёт новый браузер
 * и новый счёт, а история контрагента одна.
 */
export const PAGE_TOUR_CONTRACTOR_RATE_LIMIT: RateLimit = {
  kind: 'cp_tour_cp',
  max: 30,
  windowSeconds: 3600,
};

export const publicPageTourRoute = createRoute({
  method: 'post',
  path: '/page/{slug}/{inn}/tour',
  tags: ['contractor-page'],
  summary: 'Конец обзора страницы контрагента — запись в историю (без входа)',
  request: {
    params: PublicPageParams,
    body: { required: true, content: json(PublicPageTourInput) },
  },
  responses: {
    200: { description: 'Записано', content: json(PublicPageTourOk) },
    400: { description: 'Шаг не число или больше числа шагов обзора', content: error },
    404: {
      description: 'Страница недоступна или код в этом браузере не запомнен',
      content: error,
    },
    429: {
      description: 'Слишком много записей за час из этого браузера или у этого контрагента',
      content: error,
    },
  },
});

/**
 * Конец обзора (прототип `cphTourEnd`): «Контрагент посмотрел обзор страницы» или «…закрыл обзор
 * страницы на шаге N из M». Только браузеру с запомненным кодом этой страницы; от клиента — только
 * числа, и «из M» не больше облачков обзора в справочнике. Без кода, для выключенной страницы —
 * одинаково «Страница недоступна».
 */
export function publicPageTourHandler(
  deps: ApiDeps,
): RouteHandler<typeof publicPageTourRoute, AppEnv> {
  return async (c) => {
    const { slug, inn } = c.req.valid('param');
    const tour = c.req.valid('json');
    c.header('Cache-Control', 'no-store');
    const unavailable = () => apiFail(404, 'page_unavailable', 'Страница недоступна');
    const cookie = getCookie(c, pageCookieName(deps));
    if (!isPageAddress(slug, inn) || !cookie || !isSessionTokenShape(cookie)) return unavailable();
    const grantHash = hashSessionToken(cookie);
    // Сначала — только чтение: без запомненного кода запрос ничего не пишет в базу.
    const state = await pageAccess(deps, slug, inn, grantHash);
    if (state.state !== 'open') return unavailable();
    const help = await readCpHelp(deps.db);
    // Считаются только включённые облачка: с прототипа v135 выключается и последнее (`end`).
    const steps = help.tour.filter((s) => s.on).length;
    if (tour.of > steps) apiFail(400, 'validation_failed', 'Шаг обзора больше числа шагов');
    const { orgId, contractorId } = state;
    const slot = await takeRateLimit(deps.db, PAGE_TOUR_RATE_LIMIT, grantHash);
    const cpSlot = slot.ok
      ? await takeRateLimit(deps.db, PAGE_TOUR_CONTRACTOR_RATE_LIMIT, contractorId)
      : slot;
    if (!slot.ok || !cpSlot.ok) apiFail(429, 'rate_limited', 'Слишком много запросов');
    await withOrgContext(deps.db, { orgId, userId: null }, (tx) =>
      writeContractorPageTour(tx, contractorId, tour),
    );
    return c.json({ ok: true as const }, 200);
  };
}

/* ───────────── Админка ───────────── */

const P = '/admin/kb/cppage';

const denied = {
  401: { description: 'Нет входа', content: error },
  403: { description: 'Не администратор платформы', content: error },
} as const;

export const adminCpHelpRoute = createRoute({
  method: 'get',
  path: P,
  tags: ['kb'],
  summary: '«Страница контрагента»: тексты подсказок и обучения с версией раздела',
  middleware: [requirePlatformAdmin] as const,
  responses: {
    200: { description: 'Тексты и версия', content: json(AdminCpHelp) },
    404: { description: 'Раздела нет (справочник не наполнен)', content: error },
    ...denied,
  },
});

export function adminCpHelpHandler(deps: ApiDeps): RouteHandler<typeof adminCpHelpRoute, AppEnv> {
  return async (c) => {
    const ref = await withUserContext(deps.db, c.get('session')!.userId, (tx) => adminCpHelp(tx));
    if (!ref) return apiFail(404, 'not_found', 'Запись не найдена');
    return c.json({ help: ref.help, version: ref.version }, 200);
  };
}

export const adminCpHelpEditRoute = createRoute({
  method: 'post',
  path: P,
  tags: ['kb'],
  summary:
    '«Страница контрагента»: изменить текст, облачко, вопрос или слово той версии, что видел администратор',
  middleware: [requirePlatformAdmin] as const,
  request: { body: { required: true, content: json(AdminCpHelpEdit) } },
  responses: {
    200: { description: 'Тексты после записи', content: json(AdminCpHelp) },
    400: {
      description: 'Неверные данные; `cph_word_taken` — такое слово уже есть (поле `w`)',
      content: error,
    },
    404: { description: 'Нет такого облачка, вопроса или слова', content: error },
    409: { description: 'Раздел изменён другим пользователем', content: error },
    ...denied,
  },
});

/**
 * Правка одной записи (прототип cphTextDlg, cphTourDlg, cphFaqDlg, cphGlossDlg, «Выше» / «Ниже»,
 * «Выключить», «Удалить»): функция базы пишет раздел той версии, что видел администратор, и строку
 * «Истории изменений» в той же транзакции.
 */
export function adminCpHelpEditHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminCpHelpEditRoute, AppEnv> {
  return async (c) => {
    const edit = c.req.valid('json');
    const view = await withUserContext(deps.db, c.get('session')!.userId, async (tx) => {
      const r = await adminCpHelpEdit(tx, edit, deps.clock.now().getTime());
      if (r.ok) return r.value;
      if (r.reason === 'invalid') {
        return apiFail(400, r.problem, 'Такое слово уже есть в «Словарике»', { field: r.field });
      }
      if (r.reason === 'not_found') return apiFail(404, 'not_found', 'Запись не найдена');
      return apiFail(409, 'record_changed', 'Запись изменена другим пользователем');
    });
    return c.json({ help: view.help, version: view.version }, 200);
  };
}
