import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import {
  contractorUsage,
  createContractor,
  deleteContractor,
  deleteContractorFiles,
  findContractorByInn,
  getContractor,
  lockContractor,
  readContractorFields,
  uniqueViolation,
  updateContractor,
  withOfficeBenefits,
  withOrgContext,
  writeContractorNotes,
  type ContractorFields,
  type Tx,
} from '@buhuchet/db';
import {
  CONTRACTOR_DELETE_MESSAGES,
  CONTRACTOR_MESSAGES,
  contractorDeleteRefusal,
  DEFAULT_FEE_DAY,
  type AccessSubject,
  type Translate,
} from '@buhuchet/domain';
import {
  ContractorSaved,
  CreateContractorRequest,
  UpdateContractorRequest,
  Uuid,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, versionedSaveResponses } from '../../errors';
import { orgContextOf, requirePermission } from '../../middleware/access';
import { dropObjects } from '../files/files';
import { notFound } from './card';
import {
  checkContractor,
  checkResponsible,
  contractorOut,
  duplicateFail,
  error,
  feeVisible,
  ownEmployeeOf,
  scopeSqlOf,
  subjectOf,
  todayOf,
  translateOf,
} from './common';

const forbidden = (message: string) => apiFail(403, 'forbidden', message);

/**
 * Ответ с карточкой после сохранения: контрагент читается заново, без области (его только что
 * сохранили); `notices` — уведомления «Отмечен статус «…» по УГНС».
 */
async function savedOut(
  tx: Tx,
  id: string,
  options: {
    orgId: string;
    subject: AccessSubject;
    today: string;
    t: Translate;
    notices: string[];
  },
): Promise<ContractorSaved> {
  const r = await getContractor(tx, id, { scope: undefined, today: options.today });
  return {
    ...(await contractorOut(tx, r!, {
      fee: await feeVisible(tx, options.orgId, options.subject),
      t: options.t,
    })),
    notices: options.notices,
  };
}

/** Статусы «Ставится по УГНС» при выборе или смене УГНС (прототип ugApply). */
const officeBenefitsOf = (
  tx: Tx,
  benefits: ContractorFields['benefits'],
  offices: { from: string | null; to: string | null },
  t: Translate,
) =>
  withOfficeBenefits(tx, benefits, offices, {
    marked: t('cp.notice.ugns_marked'),
    dropped: t('cp.notice.ugns_dropped'),
  });

/** Первое число месяца даты: с него действует первая ставка обслуживания (прототип: start.slice(0, 7)). */
const monthOf = (date: string) => `${date.slice(0, 7)}-01`;

export const createContractorRoute = createRoute({
  method: 'post',
  path: '/contractors',
  tags: ['contractors'],
  summary: 'Новый контрагент',
  middleware: [requirePermission('cpView'), requirePermission('createCp')] as const,
  request: {
    body: { required: true, content: { 'application/json': { schema: CreateContractorRequest } } },
  },
  responses: {
    201: {
      description: 'Контрагент создан одним целым (с первой ставкой обслуживания и историей)',
      content: { 'application/json': { schema: ContractorSaved } },
    },
    400: {
      description:
        'Неверные данные: ИНН, телефон, поля, отключённые значения справочников, ГКЭД не подкласс, запрет режима по ГКЭД или нужен ответ на вопрос о праве на режим',
      content: error,
    },
    401: { description: 'Нет входа', content: error },
    403: {
      description:
        'Нет права «Создавать и изменять контрагентов» или стоимость, день оплаты, первый неполный месяц без права «Видеть плату за обслуживание»',
      content: error,
    },
    409: { description: 'Такой ИНН уже есть в организации (и в архиве)', content: error },
  },
});

/**
 * «Новый контрагент» (ТЗ «Регистрация контрагентов», «Обязательные поля»; прототип addCpDlg): всё —
 * одним целым в одной транзакции; при сбое не создаётся ничего (экран показывает «Не удалось
 * сохранить контрагента, ничего не создано»). Стоимость обслуживания — первая запись журнала
 * тарифов: у постоянного контрагента обязательна тому, кто видит плату за обслуживание, остальным
 * недоступна.
 */
export function createContractorHandler(
  deps: ApiDeps,
): RouteHandler<typeof createContractorRoute, AppEnv> {
  return async (c) => {
    const body = c.req.valid('json');
    const subject = subjectOf(c);
    const ctx = orgContextOf(c);
    const today = todayOf(deps);
    const t = await translateOf(deps);
    try {
      const out = await withOrgContext(deps.db, ctx, async (tx) => {
        const fee = await feeVisible(tx, ctx.orgId, subject);
        if (
          !fee &&
          (body.tariff || body.feeDay !== undefined || body.firstMonthMode !== undefined)
        ) {
          forbidden(FEE_ONLY);
        }
        if (body.tariff && body.kind === 'oneoff') {
          apiFail(400, 'validation_failed', 'У разового контрагента нет тарифа', {
            field: 'tariff',
          });
        }
        if (!body.tariff && fee && body.kind === 'regular') {
          apiFail(400, 'tariff_required', CONTRACTOR_MESSAGES.tariff_required, {
            field: 'tariff',
          });
        }
        await checkResponsible(tx, body.responsibleEmployeeId);
        const fields: ContractorFields = {
          name: body.name,
          inn: body.inn,
          phone: body.phone,
          kind: body.kind,
          formCode: body.formCode,
          regimeCode: body.regimeCode,
          regime2Code: body.regime2Code,
          gked: body.gked,
          gkedExtra: [...new Set(body.gkedExtra)],
          taxOfficeCode: body.taxOfficeCode,
          bizSize: body.bizSize,
          benefits: uniqueBy(body.benefits),
          bases: [...new Set(body.bases)],
          responsibleEmployeeId: body.responsibleEmployeeId,
          head: body.head,
          contact: body.contact,
          contractNo: body.contractNo,
          contractDate: body.contractDate,
          note: body.note,
          registration: body.registration,
          startDate: body.startDate,
          // ОТКЛОНЕНИЕ: docs/deviations.md#А-1 — поле есть у того, кто видит плату, при ставке «в месяц»
          // (по умолчанию «Пропорционально дням»); без поля — «Полный месяц», как в прототипе.
          firstMonthMode:
            body.firstMonthMode ?? (fee && body.tariff?.period === 'M' ? 'prorate' : 'full'),
          feeDay: body.feeDay ?? DEFAULT_FEE_DAY,
          paysTo: body.paysTo,
          gkedConfirmation: null,
        };
        const office = await officeBenefitsOf(
          tx,
          fields.benefits,
          { from: null, to: fields.taxOfficeCode },
          t,
        );
        fields.benefits = office.benefits;
        fields.gkedConfirmation = await checkContractor(tx, fields, {
          before: null,
          gkedConfirm: body.gkedConfirm ?? false,
          employeeId: subject.employeeId,
          ownEmployeeId: ownEmployeeOf(subject),
          today,
          t,
        });
        const id = await createContractor(
          tx,
          ctx.orgId,
          fields,
          body.tariff && {
            amount: body.tariff.amount,
            period: body.tariff.period,
            validFrom: monthOf(body.startDate),
            note: t('cp.tariff.first'),
          },
        );
        await writeContractorNotes(tx, id, office.notes);
        return savedOut(tx, id, { orgId: ctx.orgId, subject, today, t, notices: office.notes });
      });
      return c.json(out, 201);
    } catch (err) {
      await innRace(deps, c, err, body.inn, null);
      throw err;
    }
  };
}

const FEE_ONLY =
  'Стоимость, день оплаты и первый неполный месяц задаёт тот, кто видит плату за обслуживание';

/**
 * Одновременное сохранение того же ИНН: уникальный ключ базы отклоняет второе, и оно получает тот же
 * ответ, что и при проверке.
 */
async function innRace(
  deps: ApiDeps,
  c: Context<AppEnv>,
  err: unknown,
  inn: string | undefined,
  exceptId: string | null,
): Promise<void> {
  if (!inn || uniqueViolation(err) !== 'contractors_org_inn_key') return;
  const found = await withOrgContext(deps.db, orgContextOf(c), (tx) =>
    findContractorByInn(tx, inn, exceptId ?? undefined),
  );
  if (found) duplicateFail(found, exceptId ? 'edit' : 'create', ownEmployeeOf(subjectOf(c)));
}

/** Льготы без повторов: у одной льготы — один срок (последний переданный). */
function uniqueBy(list: ContractorFields['benefits']): ContractorFields['benefits'] {
  return [...new Map(list.map((b) => [b.code, b])).values()];
}

export const updateContractorRoute = createRoute({
  method: 'patch',
  path: '/contractors/{id}',
  tags: ['contractors'],
  summary: 'Изменить контрагента',
  middleware: [requirePermission('cpView'), requirePermission('createCp')] as const,
  request: {
    params: z.object({ id: Uuid }),
    body: { required: true, content: { 'application/json': { schema: UpdateContractorRequest } } },
  },
  responses: {
    200: {
      description: 'Контрагент сохранён; изменения — в истории «было → стало»',
      content: { 'application/json': { schema: ContractorSaved } },
    },
    400: {
      description:
        'Неверные данные, отключённые значения справочников, запрет режима по ГКЭД или нужен ответ на вопрос о праве на режим',
      content: error,
    },
    401: { description: 'Нет входа', content: error },
    403: {
      description:
        'Нет права «Создавать и изменять контрагентов» или день оплаты без права «Видеть плату за обслуживание»',
      content: error,
    },
    ...versionedSaveResponses,
    404: { description: 'Нет такого контрагента или он вне области сотрудника', content: error },
    409: {
      description:
        'Запись изменена другим пользователем, такой ИНН уже есть или контрагент в архиве',
      content: error,
    },
  },
});

/**
 * «Изменить» (прототип editCpDlg): те же проверки, что при создании; неизменённое значение, которое
 * уже отключено в справочнике, сохраняется как есть, а основной ГКЭД у контрагента без него нужно
 * указать (ТЗ: «при следующем сохранении карточки поле нужно заполнить»). Архивного не меняют.
 */
export function updateContractorHandler(
  deps: ApiDeps,
): RouteHandler<typeof updateContractorRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { version, gkedConfirm, ...patch } = c.req.valid('json');
    const subject = subjectOf(c);
    const ctx = orgContextOf(c);
    const today = todayOf(deps);
    const t = await translateOf(deps);
    const scope = scopeSqlOf(subject);
    try {
      return c.json(await update(), 200);
    } catch (err) {
      await innRace(deps, c, err, patch.inn, id);
      throw err;
    }

    async function update() {
      return withOrgContext(deps.db, ctx, async (tx) => {
        const row = await lockContractor(tx, id, scope);
        if (!row) notFound();
        if (row.serviceStatus === 'archived') {
          apiFail(
            409,
            'contractor_archived',
            'Контрагент в архиве — сначала верните его из архива',
          );
        }
        if (patch.feeDay !== undefined && !(await feeVisible(tx, ctx.orgId, subject))) {
          forbidden(FEE_ONLY);
        }
        const before = await readContractorFields(tx, row);
        const next: ContractorFields = {
          ...before,
          ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
        };
        if (patch.gkedExtra) next.gkedExtra = [...new Set(patch.gkedExtra)];
        if (patch.benefits) next.benefits = uniqueBy(patch.benefits);
        if (patch.bases) next.bases = [...new Set(patch.bases)];
        const office = await officeBenefitsOf(
          tx,
          next.benefits,
          { from: before.taxOfficeCode, to: next.taxOfficeCode },
          t,
        );
        next.benefits = office.benefits;
        const confirmation = await checkContractor(tx, next, {
          before: { id, fields: before },
          gkedConfirm: gkedConfirm ?? false,
          employeeId: subject.employeeId,
          ownEmployeeId: ownEmployeeOf(subject),
          today,
          t,
        });
        await updateContractor(
          tx,
          ctx.orgId,
          id,
          version,
          {
            ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
            ...(patch.gkedExtra ? { gkedExtra: next.gkedExtra } : {}),
            ...(patch.benefits || office.notes.length ? { benefits: next.benefits } : {}),
            ...(patch.bases ? { bases: next.bases } : {}),
            gkedConfirmation: confirmation,
          },
          scope,
          {
            today,
            texts: {
              byStatus: t('report.reason.due_status'),
              byCatalog: t('report.reason.due_catalog'),
              byCatalogDropped: t('report.reason.due_catalog_dropped'),
            },
          },
        );
        await writeContractorNotes(tx, id, office.notes);
        return savedOut(tx, id, { orgId: ctx.orgId, subject, today, t, notices: office.notes });
      });
    }
  };
}

export const deleteContractorRoute = createRoute({
  method: 'delete',
  path: '/contractors/{id}',
  tags: ['contractors'],
  summary: 'Удалить контрагента без отчётов, денег и проектов',
  middleware: [requirePermission('cpView'), requirePermission('cpArchive')] as const,
  request: { params: z.object({ id: Uuid }) },
  responses: {
    204: { description: 'Контрагент удалён вместе с дочерними записями; история осталась' },
    401: { description: 'Нет входа', content: error },
    403: {
      description: 'Нет права «Отправлять в архив и удалять контрагентов»',
      content: error,
    },
    404: { description: 'Нет такого контрагента или он вне области сотрудника', content: error },
    409: {
      description:
        'По контрагенту есть отчёты, деньги или проекты — его можно только отправить в архив; контрагент в архиве',
      content: error,
    },
  },
});

/**
 * «Удалить» (ТЗ «Контрагента нельзя удалить, если по нему есть отчёты»; прототип cpActions): только
 * без отчётов, денег и проектов, иначе — отказ с причиной (`details.variant`: has_reports, has_money,
 * has_projects; текст — `err.contractor_in_use.<вариант>`).
 */
export function deleteContractorHandler(
  deps: ApiDeps,
): RouteHandler<typeof deleteContractorRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const subject = subjectOf(c);
    const keys = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      const row = await lockContractor(tx, id, scopeSqlOf(subject));
      if (!row) notFound();
      // «Удалить» у архивного нет (прототип cpActions): сначала вернуть из архива.
      if (row.serviceStatus === 'archived') {
        apiFail(409, 'contractor_archived', 'Контрагент в архиве — сначала верните его из архива');
      }
      const refusal = contractorDeleteRefusal(await contractorUsage(tx, id));
      if (refusal) {
        apiFail(409, 'contractor_in_use', CONTRACTOR_DELETE_MESSAGES[refusal], {
          variant: refusal,
        });
      }
      // Файлы контрагента удаляются вместе с ним, а не становятся общими файлами организации.
      const fileKeys = await deleteContractorFiles(tx, id);
      await deleteContractor(tx, row);
      return fileKeys;
    });
    await dropObjects(deps, keys);
    return c.body(null, 204);
  };
}
