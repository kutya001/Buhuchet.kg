import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import {
  changeService,
  ContractorArchivedError,
  lockContractor,
  readContractorFields,
  type ContractorFields,
  ContractorNotArchivedError,
  ContractorOneOffError,
  ContractorRegularError,
  getContractor,
  getContractorService,
  ServiceRefusedError,
  withOrgContext,
  type ContractorServiceRecord,
  type ServiceAction,
  type ServiceEffect as DbServiceEffect,
  type ServiceTexts,
  type Tx,
} from '@buhuchet/db';
import {
  CONTRACTOR_MESSAGES,
  periodsText,
  plannedPause,
  plannedResume,
  RecordNotFoundError,
  SERVICE_MESSAGES,
  skippedMonths,
  type AccessSubject,
  type ServiceRefusal,
  type Translate,
} from '@buhuchet/domain';
import {
  ArchiveContractorsRequest,
  ArchiveContractorsResult,
  ContractorService,
  ContractorServiceSaved,
  ContractorUnarchived,
  PauseServiceRequest,
  ResumeServiceRequest,
  RollbackPauseRequest,
  ServiceVersionRequest,
  ToRegularRequest,
  UnarchiveContractorRequest,
  Uuid,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, versionedSaveResponses } from '../../errors';
import { orgContextOf, requirePermission } from '../../middleware/access';
import { notFound } from './card';
import {
  checkContractor,
  contractorOut,
  error,
  feeVisible,
  ownEmployeeOf,
  scopeSqlOf,
  subjectOf,
  todayOf,
  translateOf,
} from './common';

/*
 * Обслуживание контрагента (задача 2.12; ТЗ «Остановка и возобновление обслуживания», «Непостоянные
 * контрагенты»; прототип cpActions, pauseDlg, resumeDlg, unpauseCp, rollbackDlg('svc'), archiveDlg,
 * unarchiveCp, toRegularDlg). Права: приостановка и возобновление — «Приостанавливать контрагентов»;
 * отмена запланированной приостановки — оно же и «Откат статусов»; откат действующей приостановки
 * шагом назад на шкале — «Откат статусов» (как у других шкал); архив и возврат — «Отправлять в архив
 * и удалять контрагентов»; перевод разового в постоянное — «Создавать и изменять контрагентов». Всё —
 * в области «Свои / Все контрагенты» (вне области — «не найден»).
 */

const IdParam = z.object({ id: Uuid });

/** Причины «Истории статусов», которые пишет система, — из словаря. */
export const serviceTextsOf = (t: Translate): ServiceTexts => ({
  pausedFrom: t('svc.hist.paused_from'),
  pausedFromResume: t('svc.hist.paused_from_resume'),
  pauseReason: t('svc.hist.pause_reason'),
  resumedFrom: t('svc.hist.resumed_from'),
  regularFrom: t('svc.hist.regular_from'),
  reportPaused: t('svc.hist.report_paused'),
  reportArchived: t('svc.hist.report_archived'),
  reportResumed: t('svc.hist.report_resumed'),
  reportFilled: t('svc.hist.report_filled'),
});

/** Обслуживание для ответа: периоды словами, запланированное, пропущенные месяцы. */
function serviceOut(r: ContractorServiceRecord, today: string): ContractorService {
  const month = today.slice(0, 7);
  const subject = { archived: r.status === 'archived', periods: r.periods };
  const paused = r.status !== 'archived' && r.kind === 'regular';
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    periods: r.periods,
    periodsText: periodsText(r.periods),
    month,
    plannedPause: r.kind === 'regular' ? plannedPause(subject, month) : null,
    plannedResume: r.kind === 'regular' ? plannedResume(subject, month) : null,
    skipped: paused ? skippedMonths(r.periods, month) : [],
    statusHistory: r.history.map((h) => ({ ...h, at: h.at.toISOString() })),
    version: r.version,
  };
}

async function readService(tx: Tx, id: string, today: string) {
  const r = await getContractorService(tx, id, undefined);
  if (!r) notFound();
  return serviceOut(r, today);
}

/** Поле окна, к которому относится отказ правила (400); остальные отказы — состояние (409). */
const REFUSAL_FIELD: Partial<Record<ServiceRefusal, string>> = {
  service_month_in_past: 'from',
  service_resume_before_pause: 'resume',
  service_fill_not_skipped: 'fill',
};

/** Отказы правил и состояния контрагента — ответом API. */
function serviceFail(err: unknown): never {
  if (err instanceof ServiceRefusedError) {
    const field = REFUSAL_FIELD[err.code];
    if (field) apiFail(400, err.code, SERVICE_MESSAGES[err.code], { field });
    apiFail(409, err.code, SERVICE_MESSAGES[err.code]);
  }
  if (err instanceof ContractorArchivedError) {
    apiFail(409, 'contractor_archived', 'Контрагент в архиве — сначала верните его из архива');
  }
  if (err instanceof ContractorOneOffError) {
    apiFail(
      409,
      'service_oneoff',
      'У разового контрагента нет приостановки — сначала переведите его в постоянное обслуживание',
    );
  }
  if (err instanceof ContractorNotArchivedError) {
    apiFail(409, 'contractor_not_archived', 'Контрагент не в архиве');
  }
  if (err instanceof ContractorRegularError) {
    apiFail(409, 'contractor_regular', 'Контрагент уже на постоянном обслуживании');
  }
  if (err instanceof RecordNotFoundError && err.entity === 'contractor') notFound();
  throw err;
}

/** Выполнить действие с одним контрагентом и ответить обслуживанием и тем, что стало с отчётами. */
async function run(
  deps: ApiDeps,
  c: Context<AppEnv>,
  id: string,
  version: number | null,
  action:
    ServiceAction | ((tx: Tx, subject: AccessSubject, t: Translate) => Promise<ServiceAction>),
): Promise<{ service: ContractorService; effect: DbServiceEffect }> {
  const subject = subjectOf(c);
  const today = todayOf(deps);
  const t = await translateOf(deps);
  const scope = scopeSqlOf(subject);
  return withOrgContext(deps.db, orgContextOf(c), async (tx) => {
    try {
      const a = typeof action === 'function' ? await action(tx, subject, t) : action;
      const effect = await changeService(tx, id, a, {
        today,
        scope,
        version,
        texts: serviceTextsOf(t),
      });
      return { service: await readService(tx, id, today), effect };
    } catch (err) {
      serviceFail(err);
    }
  });
}

const savedResponses = (ok: string) =>
  ({
    200: {
      description: ok,
      content: { 'application/json': { schema: ContractorServiceSaved } },
    },
    400: {
      description: 'Неверные данные: месяц в прошлом, возобновление не позже паузы',
      content: error,
    },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права на действие', content: error },
    ...versionedSaveResponses,
    404: { description: 'Нет такого контрагента или он вне области сотрудника', content: error },
    409: {
      description:
        'Запись изменена другим пользователем; контрагент в архиве, разовый или действие не подходит к обслуживанию сейчас',
      content: error,
    },
  }) as const;

export const getServiceRoute = createRoute({
  method: 'get',
  path: '/contractors/{id}/service',
  tags: ['contractors'],
  summary: 'Обслуживание контрагента: статус, периоды, запланированное, история статусов',
  middleware: [requirePermission('cpView')] as const,
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Обслуживание для карточки',
      content: { 'application/json': { schema: ContractorService } },
    },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Видеть контрагентов»', content: error },
    404: { description: 'Нет такого контрагента или он вне области сотрудника', content: error },
  },
});

/** Блок «Статус обслуживания» карточки (прототип contractor-card: pill, «Периоды обслуживания», шкала). */
export function getServiceHandler(deps: ApiDeps): RouteHandler<typeof getServiceRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const scope = scopeSqlOf(subjectOf(c));
    const out = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      const r = await getContractorService(tx, id, scope);
      if (!r) notFound();
      return serviceOut(r, todayOf(deps));
    });
    return c.json(out, 200);
  };
}

export const pauseServiceRoute = createRoute({
  method: 'post',
  path: '/contractors/{id}/pause',
  tags: ['contractors'],
  summary: 'Приостановить обслуживание',
  middleware: [requirePermission('cpView'), requirePermission('cpPause')] as const,
  request: {
    params: IdParam,
    body: { required: true, content: { 'application/json': { schema: PauseServiceRequest } } },
  },
  responses: savedResponses(
    'Обслуживание приостановлено с месяца; несданные отчёты за месяцы паузы — «Не требуется»',
  ),
});

/**
 * «Приостановить» (прототип pauseDlg): с месяца не раньше идущего, возобновление — необязательно и
 * позже, причина — в историю. Приостановка с идущего месяца сразу меняет статус; будущая — когда
 * наступит месяц (задача по расписанию).
 */
export function pauseServiceHandler(deps: ApiDeps): RouteHandler<typeof pauseServiceRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const out = await run(deps, c, id, body.version, {
      kind: 'pause',
      from: body.from,
      resume: body.resume,
      reason: body.reason,
    });
    return c.json(out, 200);
  };
}

export const resumeServiceRoute = createRoute({
  method: 'post',
  path: '/contractors/{id}/resume',
  tags: ['contractors'],
  summary: 'Возобновить обслуживание или изменить месяц возобновления',
  middleware: [requirePermission('cpView'), requirePermission('cpPause')] as const,
  request: {
    params: IdParam,
    body: { required: true, content: { 'application/json': { schema: ResumeServiceRequest } } },
  },
  responses: savedResponses(
    'Обслуживание возобновится с месяца; отчёты за него и дальше создаются, «Не требуется» от приостановки возвращаются',
  ),
});

/** «Возобновить» и «Изменить возобновление: сейчас с …» (прототип resumeDlg). */
export function resumeServiceHandler(
  deps: ApiDeps,
): RouteHandler<typeof resumeServiceRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    return c.json(await run(deps, c, id, body.version, { kind: 'resume', from: body.from }), 200);
  };
}

export const cancelPauseRoute = createRoute({
  method: 'post',
  path: '/contractors/{id}/pause/cancel',
  tags: ['contractors'],
  summary: 'Отменить запланированную приостановку',
  middleware: [
    requirePermission('cpView'),
    requirePermission('cpPause'),
    requirePermission('rollback'),
  ] as const,
  request: {
    params: IdParam,
    body: { required: true, content: { 'application/json': { schema: ServiceVersionRequest } } },
  },
  responses: savedResponses(
    'Запланированная приостановка и её возобновление отменены, обслуживание идёт без перерыва',
  ),
});

/**
 * «Отменить приостановку» (ТЗ «Откат приостановки»; прототип unpauseCp): только с правом «Откат
 * статусов» — без него пункт виден, но недоступен.
 */
export function cancelPauseHandler(deps: ApiDeps): RouteHandler<typeof cancelPauseRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { version } = c.req.valid('json');
    return c.json(await run(deps, c, id, version, { kind: 'cancel_pause' }), 200);
  };
}

export const rollbackPauseRoute = createRoute({
  method: 'post',
  path: '/contractors/{id}/pause/rollback',
  tags: ['contractors'],
  summary: 'Откатить действующую приостановку',
  middleware: [requirePermission('cpView'), requirePermission('rollback')] as const,
  request: {
    params: IdParam,
    body: { required: true, content: { 'application/json': { schema: RollbackPauseRequest } } },
  },
  responses: savedResponses(
    'Приостановка откачена шагом назад на шкале; за отмеченные пропущенные месяцы досозданы отчёты',
  ),
});

/**
 * Откат действующей приостановки (ТЗ «Уже действующую приостановку можно откатить шагом назад на
 * шкале…»; прототип rollbackDlg('svc')): причина обязательна, `fill` — отмеченные пропущенные месяцы.
 */
export function rollbackPauseHandler(
  deps: ApiDeps,
): RouteHandler<typeof rollbackPauseRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const fill = [...new Set(body.fill)].sort();
    return c.json(
      await run(deps, c, id, body.version, { kind: 'rollback', reason: body.reason, fill }),
      200,
    );
  };
}

export const toRegularRoute = createRoute({
  method: 'post',
  path: '/contractors/{id}/to-regular',
  tags: ['contractors'],
  summary: 'Перевести разового контрагента в постоянное обслуживание',
  middleware: [requirePermission('cpView'), requirePermission('createCp')] as const,
  request: {
    params: IdParam,
    body: { required: true, content: { 'application/json': { schema: ToRegularRequest } } },
  },
  responses: savedResponses(
    'Контрагент на постоянном обслуживании с месяца: период, режим и ставка обслуживания',
  ),
});

/**
 * «Перевести в постоянное обслуживание» (ТЗ «Разового контрагента можно перевести в постоянное
 * обслуживание: тогда заполняются тариф и виды отчётов»; прототип toRegularDlg): ставка с месяца
 * начала — обязательна тому, кто видит плату за обслуживание, остальным недоступна; виды отчётов
 * экран выбирает следующим шагом («Подбор отчётов»).
 */
export function toRegularHandler(deps: ApiDeps): RouteHandler<typeof toRegularRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const out = await run(deps, c, id, body.version, async (tx, subject, t) => {
      const row = await lockContractor(tx, id, scopeSqlOf(subject));
      if (!row) notFound();
      if (row.kind !== 'oneoff' || row.serviceStatus === 'archived') {
        // Отказ состояния — тем же ответом, что у правил обслуживания.
        return { kind: 'to_regular', from: body.from, tariff: null };
      }
      const fee = await feeVisible(tx, orgContextOf(c).orgId, subject);
      if (!fee && body.tariff) {
        apiFail(
          403,
          'forbidden',
          'Стоимость обслуживания задаёт тот, кто видит плату за обслуживание',
        );
      }
      if (fee && !body.tariff) {
        apiFail(400, 'tariff_required', CONTRACTOR_MESSAGES.tariff_required, { field: 'tariff' });
      }
      // Постоянный контрагент проверяется как при сохранении карточки: режим из справочника и сверка
      // с ГКЭД (запрет режима, вопрос о праве на режим).
      const before = await readContractorFields(tx, row);
      const next: ContractorFields = {
        ...before,
        kind: 'regular',
        ...(body.regimeCode !== undefined ? { regimeCode: body.regimeCode } : {}),
      };
      const confirmation = await checkContractor(tx, next, {
        before: { id, fields: before },
        gkedConfirm: body.gkedConfirm ?? false,
        employeeId: subject.employeeId,
        ownEmployeeId: ownEmployeeOf(subject),
        today: todayOf(deps),
        t,
      });
      return {
        kind: 'to_regular',
        from: body.from,
        ...(body.regimeCode !== undefined ? { regimeCode: body.regimeCode } : {}),
        gkedConfirmation: confirmation,
        tariff: body.tariff ? { ...body.tariff, note: t('svc.regular.tariff_note') } : null,
      };
    });
    return c.json(out, 200);
  };
}

export const archiveContractorsRoute = createRoute({
  method: 'post',
  path: '/contractors/archive',
  tags: ['contractors'],
  summary: 'Отправить в архив одного или нескольких контрагентов',
  middleware: [requirePermission('cpView'), requirePermission('cpArchive')] as const,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: ArchiveContractorsRequest } },
    },
  },
  responses: {
    200: {
      description:
        'Отправлены в архив; несданные отчёты за периоды после текущего месяца — «Не требуется»',
      content: { 'application/json': { schema: ArchiveContractorsResult } },
    },
    400: { description: 'Неверные данные', content: error },
    401: { description: 'Нет входа', content: error },
    403: {
      description: 'Нет права «Отправлять в архив и удалять контрагентов»',
      content: error,
    },
    404: {
      description: 'Кого-то из контрагентов нет или он вне области сотрудника',
      content: error,
    },
  },
});

/**
 * «В архив» из меню карточки и выбранным в списке (ТЗ «Контрагента нельзя удалить, если по нему есть
 * отчёты; его можно отправить в архив»; прототип archiveDlg): все или никто; уже архивные пропускаются.
 * Остаток денег при архивировании решают задачи денег (2.20, 2.21).
 */
export function archiveContractorsHandler(
  deps: ApiDeps,
): RouteHandler<typeof archiveContractorsRoute, AppEnv> {
  return async (c) => {
    const { ids } = c.req.valid('json');
    const subject = subjectOf(c);
    const today = todayOf(deps);
    const texts = serviceTextsOf(await translateOf(deps));
    const scope = scopeSqlOf(subject);
    const out = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      const result = { archived: 0, skipped: 0, notRequired: 0 };
      for (const id of [...new Set(ids)].sort()) {
        try {
          const effect = await changeService(
            tx,
            id,
            { kind: 'archive' },
            {
              today,
              scope,
              version: null,
              texts,
            },
          );
          result.archived++;
          result.notRequired += effect.notRequired;
        } catch (err) {
          if (err instanceof ContractorArchivedError) {
            result.skipped++;
            continue;
          }
          serviceFail(err);
        }
      }
      return result;
    });
    return c.json(out, 200);
  };
}

export const unarchiveContractorRoute = createRoute({
  method: 'post',
  path: '/contractors/{id}/unarchive',
  tags: ['contractors'],
  summary: 'Вернуть контрагента из архива',
  middleware: [requirePermission('cpView'), requirePermission('cpArchive')] as const,
  request: {
    params: IdParam,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: UnarchiveContractorRequest,
        },
      },
    },
  },
  responses: {
    ...savedResponses(''),
    200: {
      description:
        'Контрагент возвращён: обслуживание с текущего месяца, отчёты по действующим назначениям; ответ — карточка',
      content: { 'application/json': { schema: ContractorUnarchived } },
    },
  },
});

/**
 * «Вернуть из архива» (ТЗ: «назначения и отчёты продолжают создаваться с текущего периода… после
 * возврата система показывает, сколько открытых отчётов»; прототип unarchiveCp). Ответ — карточка
 * (`ContractorSaved`): форма «Новый контрагент» после него открывает «Изменить» (docs/decisions.md
 * п. А-5); версия — необязательна (форма знает только номер найденного по ИНН).
 */
export function unarchiveContractorHandler(
  deps: ApiDeps,
): RouteHandler<typeof unarchiveContractorRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { version } = c.req.valid('json');
    const subject = subjectOf(c);
    const ctx = orgContextOf(c);
    const today = todayOf(deps);
    const t = await translateOf(deps);
    const out = await withOrgContext(deps.db, ctx, async (tx) => {
      try {
        const effect = await changeService(
          tx,
          id,
          { kind: 'unarchive' },
          {
            today,
            scope: scopeSqlOf(subject),
            version: version ?? null,
            texts: serviceTextsOf(t),
          },
        );
        const card = await getContractor(tx, id, { scope: undefined, today });
        return {
          ...(await contractorOut(tx, card!, {
            fee: await feeVisible(tx, ctx.orgId, subject),
            t,
          })),
          notices: [],
          service: await readService(tx, id, today),
          effect,
        };
      } catch (err) {
        serviceFail(err);
      }
    });
    return c.json(out, 200);
  };
}
