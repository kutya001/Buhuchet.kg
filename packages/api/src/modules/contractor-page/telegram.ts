import { hashSessionToken, isSessionTokenShape, newSessionToken } from '@buhuchet/adapters/tokens';
import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import {
  contractorDebtSwitch,
  contractorPageOrg,
  contractorPageState,
  contractorTelegramDebtSettings,
  ContractorTelegramRefusedError,
  decideContractorTelegram,
  getContractor,
  getContractorPage,
  issueContractorTelegramLink,
  listContractorTelegram,
  setContractorDebtOff,
  takeRateLimit,
  withOrgContext,
  type ContractorRecord,
  type RateLimit,
  type Tx,
} from '@buhuchet/db';
import {
  CP_TG_MAX,
  CP_TG_MESSAGES,
  CP_TG_START_PREFIX,
  DEBT_TOGGLE_MESSAGES,
  debtToggleRefusal,
  hasPermission,
  isPageAddress,
  PAGE_MESSAGES,
  pageVisibleSections,
  scopeOf,
  type AccessSubject,
} from '@buhuchet/domain';
import {
  ApiError,
  ContractorTelegram,
  ContractorTelegramDebtInput,
  ContractorTelegramDecisionInput,
  PublicPageParams,
  PublicPageTelegramLink,
  Uuid,
  type ContractorTelegram as ContractorTelegramBody,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, versionedSaveResponses } from '../../errors';
import { orgContextOf, requirePermission } from '../../middleware/access';
import { scopeSqlOf, todayOf } from '../contractors/common';
import { notifyContractorTelegramClient } from '../telegram/client';
import { contractorClientDebt } from '../telegram/client/debt';
import { subjectOf } from './card';
import { pageCookieName } from './public';

/*
 * Telegram контрагента (доработки 13.11.2026, задача К3; прототип v92 modules/cp-telegram.js — pgTgBox,
 * pgTgDecide, pgTgPub). Карточка: список «Telegram контрагента» видит тот, кто видит контрагента (право
 * «Просматривать контрагентов», область группы «Контрагенты»); подтвердить, отклонить и отключить — право
 * «Управлять страницей контрагента». Страница без входа: ссылку «Подключить Telegram» получает только
 * браузер с запомненным кодом страницы — это проверяет база (`app.contractor_telegram_issue`).
 */

const error = { 'application/json': { schema: ApiError } };

/** Кто действует: организация и права сотрудника (запрос сайта или нажатие кнопки бота). */
export interface TelegramActor {
  orgId: string;
  subject: AccessSubject;
}

/**
 * Раздел «Telegram» страницы сейчас показан клиенту: бот настроен (с именем — как на самой странице),
 * страница включена и не закрыта, контрагент не в архиве, раздел включён в учётной политике (вместе с
 * «Напоминаниями в Telegram») и не скрыт у контрагента. Заодно — контрагент в области сотрудника:
 * `off` — функция «Страница контрагента по ссылке» выключена, `hidden` — контрагента нет или он вне
 * области. Одно правило для карточки и для кнопок бота под запросом на подключение.
 */
export async function telegramSectionFor(tx: Tx, deps: ApiDeps, who: TelegramActor, id: string) {
  const org = await contractorPageOrg(tx, who.orgId);
  if (!org?.features.cppage) return 'off' as const;
  const cp = await getContractor(tx, id, { scope: scopeSqlOf(who.subject), today: todayOf(deps) });
  if (!cp) return 'hidden' as const;
  const page = await getContractorPage(tx, id);
  const sectionOn =
    !!deps.telegram &&
    !!deps.config.TELEGRAM_BOT_USERNAME &&
    !!page?.enabled &&
    !page.closed &&
    cp.serviceStatus !== 'archived' &&
    pageVisibleSections(org.pageSections, org.features, page.hiddenSections).includes('tg');
  // Страница архивного контрагента не действует (прототип `pgOn`: включена и контрагент не в архиве).
  return { cp, sectionOn, pageOn: !!page?.enabled && cp.serviceStatus !== 'archived' };
}

async function telegramSection(tx: Tx, deps: ApiDeps, c: Context<AppEnv>, id: string) {
  const found = await telegramSectionFor(
    tx,
    deps,
    { orgId: orgContextOf(c).orgId, subject: subjectOf(c) },
    id,
  );
  if (found === 'off') {
    apiFail(
      403,
      'cppage_off',
      'Функция «Страница контрагента по ссылке» выключена в учётной политике',
    );
  }
  if (found === 'hidden') apiFail(404, 'contractor_not_found', 'Контрагент не найден');
  return found;
}

/**
 * «Напоминать о долге в Telegram» у контрагента (задача К5; прототип pgDebtRow). Сумму долга видит
 * только тот, кто видит её части в карточке: долг за обслуживание — право «Видеть плату за
 * обслуживание», недостачу на налоги — «Просматривать финансовые операции» или «Учёт денег и оплата
 * налогов», и только у контрагента из своей области «Финансовые операции» (в прототипе сумму видит
 * каждый, кто открыл карточку).
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#К-5
async function debtOut(
  tx: Tx,
  deps: ApiDeps,
  subject: AccessSubject,
  cp: ContractorRecord,
): Promise<ContractorTelegramBody['debt']> {
  const settings = await contractorTelegramDebtSettings(tx);
  if (!settings.available) return null;
  const own = await contractorDebtSwitch(tx, cp.id);
  if (!own) return null;
  // Деньги контрагента закрыты ещё и областью группы «Финансовые операции» (как вкладка «Деньги»):
  // чужой контрагент при области «Свои» — без суммы, иначе недостача вычислялась бы из неё.
  const inFinScope = scopeOf(subject, 'fin') === 'all' || cp.responsible?.id === subject.employeeId;
  const seesSum =
    (!settings.fee || hasPermission(subject, 'fee')) &&
    (!settings.taxpay ||
      ((hasPermission(subject, 'finView') || hasPermission(subject, 'money')) && inFinScope));
  const sum =
    settings.on && seesSum
      ? (
          await contractorClientDebt(tx, {
            contractorId: cp.id,
            oneOff: cp.kind === 'oneoff',
            today: todayOf(deps),
            fee: settings.fee,
            taxpay: settings.taxpay,
          })
        ).sum
      : null;
  return {
    on: settings.on && !own.off,
    orgOn: settings.on,
    refusal: debtToggleRefusal({
      canManagePage: hasPermission(subject, 'cpPage'),
      orgOn: settings.on,
    }),
    sum,
    version: own.version,
  };
}

/** Список для ответа; `sectionOn` — раздел «Telegram» страницы сейчас показан клиенту. */
async function telegramOut(
  tx: Tx,
  deps: ApiDeps,
  c: Context<AppEnv>,
  id: string,
): Promise<ContractorTelegramBody> {
  const { cp, sectionOn } = await telegramSection(tx, deps, c, id);
  const items = await listContractorTelegram(tx, id);
  return {
    contractor: cp.name,
    sectionOn,
    items,
    on: items.filter((i) => i.status === 'on').length,
    wait: items.filter((i) => i.status === 'wait').length,
    max: CP_TG_MAX,
    manage: hasPermission(subjectOf(c), 'cpPage') ? null : 'page_manage_right',
    debt: await debtOut(tx, deps, subjectOf(c), cp),
  };
}

const telegramResponses = (summary: string) => ({
  200: { description: summary, content: { 'application/json': { schema: ContractorTelegram } } },
  401: { description: 'Нет входа', content: error },
  403: {
    description:
      'Функция «Страница контрагента по ссылке» выключена; нет права «Видеть контрагентов» или «Управлять страницей контрагента»',
    content: error,
  },
  404: { description: 'Нет такого контрагента или он вне области сотрудника', content: error },
});

export const getPageTelegramRoute = createRoute({
  method: 'get',
  path: '/contractors/{id}/page/telegram',
  tags: ['contractor-page'],
  summary: 'Список «Telegram контрагента» блока «Страница контрагента»',
  middleware: [requirePermission('cpView')] as const,
  request: { params: z.object({ id: Uuid }) },
  responses: telegramResponses('Запросы и подключения: имя в Telegram, статус, кто и когда решил'),
});

export function getPageTelegramHandler(
  deps: ApiDeps,
): RouteHandler<typeof getPageTelegramRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const body = await withOrgContext(deps.db, orgContextOf(c), (tx) =>
      telegramOut(tx, deps, c, id),
    );
    return c.json(body, 200);
  };
}

export const decidePageTelegramRoute = createRoute({
  method: 'post',
  path: '/contractors/{id}/page/telegram/{linkId}',
  tags: ['contractor-page'],
  summary: '«Подтвердить», «Отклонить», «Отключить» Telegram контрагента',
  middleware: [requirePermission('cpView')] as const,
  request: {
    params: z.object({ id: Uuid, linkId: Uuid }),
    body: {
      required: true,
      content: { 'application/json': { schema: ContractorTelegramDecisionInput } },
    },
  },
  responses: {
    ...telegramResponses('Решение записано — обновлённый список'),
    ...versionedSaveResponses,
    409: {
      description:
        'Запрос уже рассмотрен, Telegram уже не подключён, уже подключено 5, раздел «Telegram» страницы не действует или список изменился',
      content: error,
    },
  },
});

/**
 * Решение сотрудника. Право «Управлять страницей контрагента» и область «Свои / Все контрагенты»
 * проверяются до изменения; строка ищется только у этого контрагента. «Подтвердить» — только пока
 * раздел «Telegram» страницы действует. Клиенту бот пишет после записи
 * решения — сообщение не дошло, решение остаётся.
 */
export function decidePageTelegramHandler(
  deps: ApiDeps,
): RouteHandler<typeof decidePageTelegramRoute, AppEnv> {
  return async (c) => {
    const { id, linkId } = c.req.valid('param');
    const input = c.req.valid('json');
    const result = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      const { sectionOn } = await telegramSection(tx, deps, c, id);
      if (!hasPermission(subjectOf(c), 'cpPage')) {
        apiFail(403, 'page_manage_right', PAGE_MESSAGES.page_manage_right);
      }
      // Защита строже прототипа: новое подключение — только пока раздел «Telegram» действует (архив,
      // выключенная или закрытая страница, скрытый раздел — отказ). Отклонить и отключить можно всегда.
      if (input.action === 'approve' && !sectionOn) {
        apiFail(409, 'cp_tg_section_off', CP_TG_MESSAGES.cp_tg_section_off);
      }
      try {
        const decision = await decideContractorTelegram(tx, {
          contractorId: id,
          linkId,
          action: input.action,
          version: input.version,
        });
        return { decision, body: await telegramOut(tx, deps, c, id) };
      } catch (err) {
        if (err instanceof ContractorTelegramRefusedError) {
          apiFail(409, err.code, CP_TG_MESSAGES[err.code]);
        }
        throw err;
      }
    });
    const { decision } = result;
    await notifyContractorTelegramClient(
      deps,
      decision.chatId,
      decision.status === 'on' ? 'tgCpOn' : decision.status === 'no' ? 'tgCpNo' : 'tgCpOff',
      decision.contractor,
    );
    return c.json(result.body, 200);
  };
}

export const debtPageTelegramRoute = createRoute({
  method: 'post',
  path: '/contractors/{id}/page/telegram/debt',
  tags: ['contractor-page'],
  summary: '«Напоминать о долге в Telegram» у контрагента: включить или выключить',
  middleware: [requirePermission('cpView')] as const,
  request: {
    params: z.object({ id: Uuid }),
    body: {
      required: true,
      content: { 'application/json': { schema: ContractorTelegramDebtInput } },
    },
  },
  responses: {
    ...telegramResponses('Сохранено — обновлённый список'),
    ...versionedSaveResponses,
    409: {
      description:
        'Напоминания о долге выключены для всей организации (`page_debt_org_off`) или запись изменена',
      content: error,
    },
  },
});

/**
 * Сотрудник включает или выключает напоминание о долге у контрагента (прототип pgTgBoxClick, `debt`).
 * Право «Управлять страницей контрагента» и область «Свои / Все контрагенты» проверяются до изменения;
 * пока напоминания выключены у организации, переключатель не работает. История — в той же транзакции.
 */
export function debtPageTelegramHandler(
  deps: ApiDeps,
): RouteHandler<typeof debtPageTelegramRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const body = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      await telegramSection(tx, deps, c, id);
      const settings = await contractorTelegramDebtSettings(tx);
      const refusal = debtToggleRefusal({
        canManagePage: hasPermission(subjectOf(c), 'cpPage'),
        orgOn: settings.on,
      });
      if (refusal) {
        apiFail(refusal === 'page_debt_right' ? 403 : 409, refusal, DEBT_TOGGLE_MESSAGES[refusal]);
      }
      await setContractorDebtOff(tx, id, !input.on, input.version);
      return telegramOut(tx, deps, c, id);
    });
    return c.json(body, 200);
  };
}

/** Ссылок «Подключить Telegram» из одного браузера — не больше стольких за час. */
export const CP_TG_LINK_RATE_LIMIT: RateLimit = {
  kind: 'cp_tg_link',
  max: 20,
  windowSeconds: 3600,
};

/**
 * И на одного контрагента из всех браузеров: знающий код страницы не обойдёт предел новыми браузерами
 * и не «погасит» ссылку настоящего клиента бесконечной выдачей новых.
 */
export const CP_TG_LINK_CONTRACTOR_RATE_LIMIT: RateLimit = {
  kind: 'cp_tg_link_cp',
  max: 30,
  windowSeconds: 3600,
};

export const publicPageTelegramRoute = createRoute({
  method: 'post',
  path: '/page/{slug}/{inn}/telegram',
  tags: ['contractor-page'],
  summary: '«Подключить Telegram» на странице контрагента: одноразовая ссылка на бота (без входа)',
  request: { params: PublicPageParams },
  responses: {
    200: {
      description: 'Ссылка на бота: действует 24 часа и один раз',
      content: { 'application/json': { schema: PublicPageTelegramLink } },
    },
    404: {
      description:
        'Страница недоступна, код в этом браузере не запомнен, раздел «Telegram» выключен или бот не подключён',
      content: error,
    },
    409: { description: 'Мест нет: подключено или ждёт подтверждения 5 Telegram', content: error },
    429: { description: 'Слишком много ссылок за час', content: error },
  },
});

/**
 * Ссылка «Подключить Telegram». Без запомненного кода страницы, для выключенной страницы и скрытого
 * раздела — одинаково «Страница недоступна»: по ответу не узнать, есть ли такая страница. В базе —
 * только хеш токена ссылки; сам токен уходит в ответе один раз.
 */
export function publicPageTelegramHandler(
  deps: ApiDeps,
): RouteHandler<typeof publicPageTelegramRoute, AppEnv> {
  return async (c) => {
    const { slug, inn } = c.req.valid('param');
    c.header('Cache-Control', 'no-store');
    const unavailable = () => apiFail(404, 'page_unavailable', 'Страница недоступна');
    const bot = deps.config.TELEGRAM_BOT_USERNAME;
    const cookie = getCookie(c, pageCookieName(deps));
    if (!deps.telegram || !bot || !isPageAddress(slug, inn)) return unavailable();
    if (!cookie || !isSessionTokenShape(cookie)) return unavailable();
    const grantHash = hashSessionToken(cookie);
    // Сначала — только чтение: без запомненного кода запрос ничего не пишет в базу.
    const state = await contractorPageState(deps.db, slug, inn, grantHash);
    if (state.state !== 'open') return unavailable();
    const slot = await takeRateLimit(deps.db, CP_TG_LINK_RATE_LIMIT, grantHash);
    const cpSlot = slot.ok
      ? await takeRateLimit(deps.db, CP_TG_LINK_CONTRACTOR_RATE_LIMIT, state.contractorId)
      : slot;
    if (!slot.ok || !cpSlot.ok) {
      apiFail(429, 'cp_tg_link_limit', CP_TG_MESSAGES.cp_tg_link_limit);
    }
    const token = newSessionToken();
    const outcome = await issueContractorTelegramLink(deps.db, {
      slug,
      inn,
      grantHash,
      tokenHash: hashSessionToken(token),
    });
    if (outcome === 'unavailable') return unavailable();
    if (outcome === 'full') {
      apiFail(409, 'cp_tg_full', CP_TG_MESSAGES.cp_tg_full);
    }
    return c.json({ url: `https://t.me/${bot}?start=${CP_TG_START_PREFIX}${token}` }, 200);
  };
}
