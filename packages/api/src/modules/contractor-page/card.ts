import { randomInt } from 'node:crypto';
import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import {
  changeContractorPageCode,
  contractorPageOrg,
  disableContractorPage,
  enableContractorPage,
  enableContractorPages,
  getContractor,
  getContractorPage,
  messageTemplates,
  setContractorPageHidden,
  withOrgContext,
  writeContractorPageHistory,
  type ContractorRecord,
  type Tx,
} from '@buhuchet/db';
import {
  hasPermission,
  PAGE_MESSAGES,
  PAGE_WHATSAPP_TEMPLATE,
  pageLink,
  pageManageRefusal,
  pageOrgSections,
  pageSendRefusal,
  pageWhatsAppText,
  type AccessSubject,
  type PageActor,
  type PageRefusal,
} from '@buhuchet/domain';
import {
  ApiError,
  ContractorPage,
  ContractorPagesEnabled,
  ContractorPagesEnableInput,
  ContractorPageSectionsInput,
  Uuid,
  type ContractorPage as ContractorPageBody,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, versionedSaveResponses } from '../../errors';
import { orgContextOf, requirePermission } from '../../middleware/access';
import { scopeSqlOf, todayOf } from '../contractors/common';

/*
 * Блок «Страница контрагента» карточки (задача 2.42; ТЗ «Страница контрагента по ссылке» →
 * «Включение»; прототип modules/cp-page.js — pgBox, pgEnable, pgOffDlg, pgCodeDlg, waDlg с `page`).
 * Видит блок тот, кто видит контрагента (право «Видеть контрагентов» и область группы «Контрагенты»);
 * включить, выключить, сменить код и скрыть раздел — право «Управлять страницей контрагента»;
 * скопировать и отправить включённую ссылку — ещё и ответственный бухгалтер. Блок в карточке
 * подключает задача карточки контрагента (2.11), «Включить страницу» в списке — задача списка.
 */

const error = { 'application/json': { schema: ApiError } };
const off = 'Функция «Страница контрагента по ссылке» выключена в учётной политике';

/** Новый код доступа: 6 случайных цифр, может начинаться с нуля (прототип pgNewCode). */
const newPageCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

const subjectOf = (c: Context<AppEnv>): AccessSubject => c.get('access')!.subject;

const actorOf = (subject: AccessSubject, cp: ContractorRecord): PageActor => ({
  canManage: hasPermission(subject, 'cpPage'),
  isResponsible: cp.responsible?.id === subject.employeeId,
});

function refuse(code: PageRefusal): never {
  apiFail(code === 'page_off' || code === 'page_archived' ? 409 : 403, code, PAGE_MESSAGES[code]);
}

/** Контрагент в области сотрудника, страницы организации включены. */
async function contractorOf(tx: Tx, deps: ApiDeps, c: Context<AppEnv>, id: string) {
  const org = await contractorPageOrg(tx, orgContextOf(c).orgId);
  if (!org?.features.cppage) apiFail(403, 'cppage_off', off);
  const cp = await getContractor(tx, id, { scope: scopeSqlOf(subjectOf(c)), today: todayOf(deps) });
  if (!cp) apiFail(404, 'contractor_not_found', 'Контрагент не найден');
  return { org, cp };
}

/** Блок для ответа: код и ссылка — только у включённой страницы; сообщение WhatsApp — кто может отправить. */
async function pageOut(
  tx: Tx,
  deps: ApiDeps,
  c: Context<AppEnv>,
  id: string,
): Promise<ContractorPageBody> {
  const { org, cp } = await contractorOf(tx, deps, c, id);
  const page = await getContractorPage(tx, id);
  const archived = cp.serviceStatus === 'archived';
  const enabled = !!page?.enabled && !archived;
  const actor = actorOf(subjectOf(c), cp);
  const send = pageSendRefusal(actor, enabled);
  const link = enabled ? pageLink(deps.config.APP_BASE_URL, org.slug, cp.inn) : null;
  let whatsApp: ContractorPageBody['whatsApp'] = null;
  if (link && page && !send) {
    const template = (await messageTemplates(tx)).waPage ?? PAGE_WHATSAPP_TEMPLATE;
    whatsApp = {
      contractor: cp.name,
      phone: cp.phone,
      phoneText: cp.phoneText,
      text: pageWhatsAppText(template, { contractor: cp.name, link, code: page.code }),
    };
  }
  return {
    featureOn: true,
    enabled,
    archived,
    link,
    code: enabled ? page!.code : null,
    lastOpenAt: page?.lastOpenAt?.toISOString() ?? null,
    lastDevice: page?.lastDevice ?? null,
    sections: pageOrgSections(org.pageSections, org.features),
    hiddenSections: page?.hiddenSections ?? [],
    version: page?.version ?? null,
    manage: pageManageRefusal(actor, archived),
    send,
    whatsApp,
  };
}

const pageResponses = (summary: string) => ({
  200: { description: summary, content: { 'application/json': { schema: ContractorPage } } },
  401: { description: 'Нет входа', content: error },
  403: {
    description: `${off}; нет права «Видеть контрагентов» или нужного для действия права`,
    content: error,
  },
  404: { description: 'Нет такого контрагента или он вне области сотрудника', content: error },
});

const idParams = { params: z.object({ id: Uuid }) };

export const getPageRoute = createRoute({
  method: 'get',
  path: '/contractors/{id}/page',
  tags: ['contractor-page'],
  summary: 'Блок «Страница контрагента» карточки',
  middleware: [requirePermission('cpView')] as const,
  request: idParams,
  responses: pageResponses('Состояние страницы, ссылка и код, разделы, что можно сотруднику'),
});

export function getPageHandler(deps: ApiDeps): RouteHandler<typeof getPageRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const body = await withOrgContext(deps.db, orgContextOf(c), (tx) => pageOut(tx, deps, c, id));
    return c.json(body, 200);
  };
}

export const enablePageRoute = createRoute({
  method: 'post',
  path: '/contractors/{id}/page/enable',
  tags: ['contractor-page'],
  summary: '«Включить»: страница с новым кодом доступа',
  middleware: [requirePermission('cpView')] as const,
  request: idParams,
  responses: {
    ...pageResponses('Страница включена (или уже была включена) — блок с кодом'),
    409: { description: 'Контрагент в архиве', content: error },
  },
});

export function enablePageHandler(deps: ApiDeps): RouteHandler<typeof enablePageRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const body = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      const { cp } = await contractorOf(tx, deps, c, id);
      const refusal = pageManageRefusal(actorOf(subjectOf(c), cp), cp.serviceStatus === 'archived');
      if (refusal) refuse(refusal);
      await enableContractorPage(tx, id, newPageCode());
      return pageOut(tx, deps, c, id);
    });
    return c.json(body, 200);
  };
}

export const disablePageRoute = createRoute({
  method: 'post',
  path: '/contractors/{id}/page/disable',
  tags: ['contractor-page'],
  summary: '«Выключить»: ссылка перестаёт открываться',
  middleware: [requirePermission('cpView')] as const,
  request: idParams,
  responses: pageResponses('Страница выключена (или уже была выключена)'),
});

export function disablePageHandler(deps: ApiDeps): RouteHandler<typeof disablePageRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const body = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      const { cp } = await contractorOf(tx, deps, c, id);
      if (!hasPermission(subjectOf(c), 'cpPage')) refuse('page_manage_right');
      await disableContractorPage(tx, cp.id);
      return pageOut(tx, deps, c, id);
    });
    return c.json(body, 200);
  };
}

export const changePageCodeRoute = createRoute({
  method: 'post',
  path: '/contractors/{id}/page/code',
  tags: ['contractor-page'],
  summary: '«Сменить код»: старый код и запомненные браузеры перестают действовать',
  middleware: [requirePermission('cpView')] as const,
  request: idParams,
  responses: {
    ...pageResponses('Новый код — в блоке'),
    409: { description: 'Страница выключена или контрагент в архиве', content: error },
  },
});

export function changePageCodeHandler(
  deps: ApiDeps,
): RouteHandler<typeof changePageCodeRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const body = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      const { cp } = await contractorOf(tx, deps, c, id);
      const archived = cp.serviceStatus === 'archived';
      const refusal = pageManageRefusal(actorOf(subjectOf(c), cp), archived);
      if (refusal) refuse(refusal);
      if (!(await changeContractorPageCode(tx, id, newPageCode()))) refuse('page_off');
      return pageOut(tx, deps, c, id);
    });
    return c.json(body, 200);
  };
}

export const pageSectionsRoute = createRoute({
  method: 'put',
  path: '/contractors/{id}/page/sections',
  tags: ['contractor-page'],
  summary: '«Разделы страницы»: скрыть раздел у этого контрагента',
  middleware: [requirePermission('cpView')] as const,
  request: {
    ...idParams,
    body: { content: { 'application/json': { schema: ContractorPageSectionsInput } } },
  },
  responses: {
    ...pageResponses('Разделы сохранены'),
    ...versionedSaveResponses,
    400: { description: 'Раздел не из учётной политики или повтор', content: error },
  },
});

export function pageSectionsHandler(deps: ApiDeps): RouteHandler<typeof pageSectionsRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const body = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      const { org, cp } = await contractorOf(tx, deps, c, id);
      const refusal = pageManageRefusal(actorOf(subjectOf(c), cp), cp.serviceStatus === 'archived');
      if (refusal) refuse(refusal);
      const page = await getContractorPage(tx, id);
      if (!page) apiFail(404, 'not_found', 'Страницу ещё не включали');
      // Скрыть можно только раздел, который организация показывает (прототип: галочки pgSecOrg).
      const allowed = pageOrgSections(org.pageSections, org.features);
      if (input.hiddenSections.some((s) => !allowed.includes(s))) {
        apiFail(400, 'validation_failed', 'Такого раздела на странице нет');
      }
      // Скрытые раньше разделы, которые организация сейчас не показывает, остаются скрытыми.
      const kept = page.hiddenSections.filter((s) => !allowed.includes(s));
      await setContractorPageHidden(tx, id, [...kept, ...input.hiddenSections], input.version);
      return pageOut(tx, deps, c, id);
    });
    return c.json(body, 200);
  };
}

/** «Скопировать ссылку» и «Открыть WhatsApp» — только запись в историю (прототип log('cp', …)). */
function logRoute(path: 'copied' | 'sent', summary: string) {
  return createRoute({
    method: 'post',
    path: `/contractors/{id}/page/${path}`,
    tags: ['contractor-page'],
    summary,
    middleware: [requirePermission('cpView')] as const,
    request: idParams,
    responses: {
      ...pageResponses('Записано в историю контрагента'),
      409: { description: 'Страница выключена', content: error },
    },
  });
}

export const pageCopiedRoute = logRoute('copied', '«Скопировать ссылку»: запись в историю');
export const pageSentRoute = logRoute('sent', '«Отправить в WhatsApp»: запись в историю');

export function pageLogHandler(
  deps: ApiDeps,
  action: 'page_copy' | 'page_send',
): RouteHandler<typeof pageCopiedRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const body = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      const { cp } = await contractorOf(tx, deps, c, id);
      const page = await getContractorPage(tx, id);
      const enabled = !!page?.enabled && cp.serviceStatus !== 'archived';
      const refusal = pageSendRefusal(actorOf(subjectOf(c), cp), enabled);
      if (refusal) refuse(refusal);
      await writeContractorPageHistory(tx, id, action);
      return pageOut(tx, deps, c, id);
    });
    return c.json(body, 200);
  };
}

export const enablePagesRoute = createRoute({
  method: 'post',
  path: '/contractor-pages/enable',
  tags: ['contractor-page'],
  summary: '«Включить страницу» у выбранных контрагентов: у каждого свой код',
  middleware: [requirePermission('cpView'), requirePermission('cpPage')] as const,
  request: {
    body: { content: { 'application/json': { schema: ContractorPagesEnableInput } } },
  },
  responses: {
    200: {
      description:
        'У скольких включено и сколько пропущено (уже включена, в архиве или вне области сотрудника)',
      content: { 'application/json': { schema: ContractorPagesEnabled } },
    },
    400: { description: 'Пустой список, повторы или больше 500', content: error },
    401: { description: 'Нет входа', content: error },
    403: { description: `${off}; нет права «Управлять страницей контрагента»`, content: error },
  },
});

export function enablePagesHandler(deps: ApiDeps): RouteHandler<typeof enablePagesRoute, AppEnv> {
  return async (c) => {
    const { ids } = c.req.valid('json');
    const scope = scopeSqlOf(subjectOf(c));
    const body = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      const org = await contractorPageOrg(tx, orgContextOf(c).orgId);
      if (!org?.features.cppage) apiFail(403, 'cppage_off', off);
      const enabled = await enableContractorPages(tx, ids, scope, newPageCode);
      return { enabled, skipped: ids.length - enabled };
    });
    return c.json(body, 200);
  };
}
