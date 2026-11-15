import { randomBytes, randomUUID } from 'node:crypto';
import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import { hashPassword } from '@buhuchet/adapters/password';
import {
  adminLeadById,
  adminLeadDocs,
  adminOrgSlugs,
  adminSetOrgInnForm,
  getOrgProfile,
  leadDocsToOrganization,
  LeadLinkError,
  uniqueViolation,
  withOrgContext,
  withUserContext,
  writeHistory,
} from '@buhuchet/db';
import { createOrganization, OrganizationInputError } from '@buhuchet/db/organizations';
import {
  bishkekDate,
  FILE_LINK_SECONDS,
  isValidLogin,
  LEAD_APPROVE_MESSAGES,
  LEAD_DOC_CONTENT_TYPE,
  LEAD_MESSAGES,
  normalizeLogin,
  ORG_PROFILE_MESSAGES,
  RecordChangedError,
  RecordNotFoundError,
  slugFree,
  slugOf,
} from '@buhuchet/domain';
import {
  ApiError,
  FileLink,
  LeadApproved,
  LeadApproveRequest,
  OrgInnFormRequest,
  OrgInnFormSaved,
  Uuid,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, versionedSaveResponses } from '../../errors';
import { requirePlatformAdmin } from '../../middleware/access';
import { FILES_SECTION } from '../files/files';
import { linkLeadOwnerTelegram, sendOwnerSetup } from '../telegram/lead-link';
import { removeLeadObjects } from './lead-uploads';
import { leadApproveInfo, textsOf } from './leads-admin';

/*
 * «Одобрить» заявки с документами, файлы заявки и «ИНН и форма» организации (доработки 14.11.2026,
 * блок 1; прототип v114 modules/lead-docs.js — ldApproveDlg, ldCardBox, ldInnFormDlg). Всё — только
 * незаблокированному администратору платформы (`requirePlatformAdmin`; представления и функции базы
 * проверяют это ещё раз).
 */

const error = { 'application/json': { schema: ApiError } };
const json = <T extends z.ZodType>(schema: T) => ({ 'application/json': { schema } });
const denied = {
  401: { description: 'Нет входа', content: error },
  403: { description: 'Не администратор платформы', content: error },
} as const;

export const approveLeadRoute = createRoute({
  method: 'post',
  path: '/admin/leads/{id}/approve',
  tags: ['admin'],
  summary: '«Одобрить» заявку с документами: организация и владелец из данных заявки',
  middleware: [requirePlatformAdmin] as const,
  request: {
    params: z.object({ id: Uuid }),
    body: { required: true, content: json(LeadApproveRequest) },
  },
  responses: {
    201: {
      description: 'Организация и владелец созданы, документы — в её «Файловом менеджере»',
      content: json(LeadApproved),
    },
    400: { description: 'Логин не по формату или уже занят на платформе', content: error },
    ...denied,
    ...versionedSaveResponses,
    404: { description: 'Заявки нет', content: error },
    409: {
      description:
        '«Одобрить» неактивна (организация уже создана, отклонена, нет Telegram заявителя, файлы удалены ' +
        'или не загрузились, ИНН неверный или занят), у заявки нет документов или её изменили',
      content: error,
    },
  },
});

/** Ключ файла организации в хранилище: `org/<org_id>/files/<номер>` (ограничение files_key_check). */
const orgFileKey = (orgId: string, fileId: string) => `org/${orgId}/${FILES_SECTION}/${fileId}`;

/**
 * «Одобрить» (прототип v114 ldApproveDlg): по заявке с документами создаются организация (название,
 * ИНН, форма, ОКПО, юридический адрес и руководитель — из заявки, адрес страницы — первый свободный по
 * названию) и её владелец (ФИО и телефон заявителя, логин — из окна) без временного пароля: его
 * владелец задаёт по ссылке из Telegram. В той же транзакции заявка получает «Подключена», Telegram
 * заявителя становится Telegram владельца, документы — файлами организации с источником «Заявка на
 * подключение». Файлы копируются под ключи организации до транзакции (внешний вызов в ней не ждём,
 * п. О-48): не удалось создать — копии удаляются; создано — удаляются файлы заявки. После — владельцу
 * «Организация создана» и ссылка для пароля (поток Т). Причины, по которым «Одобрить» неактивна, — те
 * же, что в окне заявки (`leadApproveInfo`), версия заявки — та, что видел администратор.
 */
export function approveLeadHandler(deps: ApiDeps): RouteHandler<typeof approveLeadRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const adminId = c.get('session')!.userId;
    const t = await textsOf(deps);
    const login = normalizeLogin(body.login);
    if (!isValidLogin(login)) {
      apiFail(400, 'invalid_login', t('leads.approve.login_invalid'), { field: 'login' });
    }
    const pre = await withUserContext(deps.db, adminId, async (tx) => {
      const lead = await adminLeadById(tx, id);
      if (!lead) apiFail(404, 'lead_not_found', LEAD_MESSAGES.lead_not_found);
      if (!lead.legalForm) apiFail(409, 'lead_no_docs', LEAD_APPROVE_MESSAGES.lead_no_docs);
      if (lead.version !== body.version) throw new RecordChangedError('lead', id, lead.version);
      const info = await leadApproveInfo(tx, lead, t);
      if (info.refusal) apiFail(409, info.refusal, info.message ?? '');
      const docs = await adminLeadDocs(tx, id);
      return { lead, docs, slugs: await adminOrgSlugs(tx) };
    });
    const { lead, docs } = pre;
    const now = deps.clock.now();
    const orgId = randomUUID();
    const files = docs.map((d) => ({ doc: d.id, file: randomUUID(), from: d.storageKey }));
    const copied: string[] = [];
    try {
      for (const f of files) {
        const to = orgFileKey(orgId, f.file);
        if (!(await deps.storage.copy(f.from, to))) {
          apiFail(409, 'lead_docs_gone', LEAD_APPROVE_MESSAGES.lead_docs_gone);
        }
        copied.push(to);
      }
    } catch (err) {
      await removeLeadObjects(deps, copied);
      throw err;
    }
    // Пароля нет: хеш случайного, который никто не знает; пароль владелец задаёт по ссылке из Telegram.
    const passwordHash = await hashPassword(randomBytes(32).toString('base64url'));
    let ownerUserId: string;
    try {
      ({ ownerUserId } = await createOrganization(deps.db, {
        id: orgId,
        name: lead.firm,
        inn: lead.inn ?? '',
        slug: slugFree(slugOf(lead.firm), pre.slugs),
        owner: { fullName: lead.name, login, passwordHash, phone: lead.phone, passwordless: true },
        profile: {
          legalForm: lead.legalForm,
          okpo: lead.okpo,
          address: lead.address,
          head: lead.head,
        },
        createdBy: adminId,
        today: bishkekDate(now),
        lead: { id, now, version: body.version },
        within: async (tx, created) => {
          if (!(await linkLeadOwnerTelegram(tx, { leadId: id, userId: created.ownerUserId }))) {
            apiFail(409, 'lead_no_telegram', LEAD_APPROVE_MESSAGES.lead_no_telegram);
          }
          await leadDocsToOrganization(tx, {
            leadId: id,
            orgId,
            ownerUserId: created.ownerUserId,
            files: files.map((f) => ({ doc: f.doc, file: f.file })),
          });
        },
      }));
    } catch (err) {
      await removeLeadObjects(deps, copied);
      if (err instanceof OrganizationInputError) approveInputFail(err, t);
      if (err instanceof LeadLinkError) {
        if (err.reason === 'not_found') apiFail(404, 'lead_not_found', LEAD_MESSAGES.lead_not_found);
        apiFail(409, 'lead_org_exists', LEAD_APPROVE_MESSAGES.lead_org_exists);
      }
      throw err;
    }
    // Документы теперь — файлы организации; копии заявки больше не нужны (не удалились — в журнал).
    await removeLeadObjects(
      deps,
      docs.map((d) => d.storageKey),
    );
    const setup = await sendOwnerSetup(deps, { userId: ownerUserId, adminId });
    deps.logger.info({ lead: id, org: orgId, setup }, 'заявка одобрена');
    return c.json({ orgId, ownerUserId, setup }, 201);
  };
}

/** Отказ в данных новой организации из заявки: логин — у поля окна, остальное — причина «Одобрить». */
function approveInputFail(err: OrganizationInputError, t: (key: string) => string): never {
  switch (err.field) {
    case 'ownerLogin':
      return err.message === 'Логин уже занят'
        ? apiFail(400, 'login_taken', t('leads.approve.login_taken'), { field: 'login' })
        : apiFail(400, 'invalid_login', t('leads.approve.login_invalid'), { field: 'login' });
    case 'inn':
      // ИНН заняли, пока открыто окно: название той организации здесь неизвестно — общий текст.
      return err.message === ORG_PROFILE_MESSAGES.inn_taken
        ? apiFail(409, 'lead_inn_taken', ORG_PROFILE_MESSAGES.inn_taken)
        : apiFail(409, 'lead_inn_invalid', LEAD_APPROVE_MESSAGES.lead_inn_invalid);
    case 'name':
    case 'ownerFullName':
    case 'slug':
    case 'templates':
      throw err;
  }
}

export const leadDocLinkRoute = createRoute({
  method: 'get',
  path: '/admin/leads/{id}/docs/{docId}/link',
  tags: ['admin'],
  summary: 'Документ заявки: ссылка на просмотр PDF на 15 минут',
  middleware: [requirePlatformAdmin] as const,
  request: { params: z.object({ id: Uuid, docId: Uuid }) },
  responses: {
    200: { description: 'Ссылка на просмотр документа', content: json(FileLink) },
    ...denied,
    404: {
      description: 'Нет заявки или документа, файл ещё не загрузился, удалён по сроку или передан организации',
      content: error,
    },
  },
});

/**
 * «Открыть» документ в окне заявки (прототип v114 ldCardMount, `data-ld-view`): ссылка на просмотр PDF
 * на 15 минут, пока заявку не одобрили (после — файл в «Файловом менеджере» организации) и файл не
 * удалён по сроку. Тип — проверенный при загрузке PDF, файл открывается в браузере, а не скачивается.
 */
export function leadDocLinkHandler(deps: ApiDeps): RouteHandler<typeof leadDocLinkRoute, AppEnv> {
  return async (c) => {
    c.header('Cache-Control', 'no-store');
    const { id, docId } = c.req.valid('param');
    const doc = await withUserContext(deps.db, c.get('session')!.userId, async (tx) => {
      const lead = await adminLeadById(tx, id);
      if (!lead || lead.createdOrgId) return null;
      const docs = await adminLeadDocs(tx, id);
      return docs.find((d) => d.id === docId && d.state === 'ready') ?? null;
    });
    if (!doc) apiFail(404, 'not_found', 'Файл не найден');
    const expiresAt = new Date(Date.now() + FILE_LINK_SECONDS * 1000);
    const url = await deps.storage.signedDownloadUrl(doc.storageKey, {
      expiresInSeconds: FILE_LINK_SECONDS,
      fileName: doc.name,
      inline: { contentType: LEAD_DOC_CONTENT_TYPE },
    });
    return c.json({ url, expiresAt: expiresAt.toISOString() }, 200);
  };
}

export const orgInnFormRoute = createRoute({
  method: 'put',
  path: '/admin/organizations/{id}/inn-form',
  tags: ['admin'],
  summary: '«ИНН и форма» организации: меняет только администратор платформы',
  middleware: [requirePlatformAdmin] as const,
  request: {
    params: z.object({ id: Uuid }),
    body: { required: true, content: json(OrgInnFormRequest) },
  },
  responses: {
    200: { description: 'Сохранено или изменений нет', content: json(OrgInnFormSaved) },
    400: {
      description: 'ИНН не из 14 цифр, форма не выбрана или организация с таким ИНН уже есть',
      content: error,
    },
    ...denied,
    ...versionedSaveResponses,
    404: { description: 'Организации нет', content: error },
  },
});

/**
 * «ИНН и форма» (прототип v114 ldInnFormDlg): ИНН — 14 цифр и не у другой организации, форма — ОсОО или
 * ИП. Владелец организации эти поля не меняет (доработки 14.11.2026, блок 1, пункт 4). Изменение пишется
 * в историю организации от имени администратора; без изменений — «Изменений нет», версия та же.
 */
export function orgInnFormHandler(deps: ApiDeps): RouteHandler<typeof orgInnFormRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const ctx = { orgId: id, userId: c.get('session')!.userId };
    try {
      const saved = await withOrgContext(deps.db, ctx, async (tx) => {
        const org = await getOrgProfile(tx, id);
        if (!org) throw new RecordNotFoundError('organization', id);
        if (org.version !== body.version) throw new RecordChangedError('organization', id, org.version);
        const changes = [
          ...(org.inn !== body.inn ? [{ field: 'inn', from: org.inn, to: body.inn }] : []),
          ...(org.legalForm !== body.legalForm
            ? [{ field: 'legalForm', from: org.legalForm, to: body.legalForm }]
            : []),
        ];
        if (!changes.length) return { changed: false, version: org.version };
        const version = await adminSetOrgInnForm(tx, {
          orgId: id,
          inn: body.inn,
          legalForm: body.legalForm,
          version: body.version,
        });
        if (version === null) throw new RecordChangedError('organization', id, org.version);
        await writeHistory(tx, { entity: 'organization', entityId: id, action: 'update', changes });
        return { changed: true, version };
      });
      return c.json(saved, 200);
    } catch (err) {
      if (uniqueViolation(err) === 'organizations_inn_unique') {
        apiFail(400, 'inn_taken', ORG_PROFILE_MESSAGES.inn_taken, { field: 'inn' });
      }
      throw err;
    }
  };
}
