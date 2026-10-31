import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import {
  activeReportTypes,
  attachRegdocs,
  contractorUsage,
  createContractor,
  deleteContractor,
  deleteContractorFiles,
  findContractorByInn,
  getContractor,
  lockContractor,
  orgMenuSettings,
  pendingRegdocs,
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
  RD_MAX_BYTES,
  type AccessSubject,
  type Translate,
} from '@buhuchet/domain';
import {
  ContractorCreated,
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
import { serverTexts } from '../l10n/texts';
import { assignmentTexts } from '../reports/common';
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
import { createNewReports, planNewReports } from './new-reports';
import {
  requireSocfundConfirm,
  requireSocfundReason,
  socfundContext,
  socfundInputOf,
  socfundPatch,
  socfundSubjectOf,
  withSocfundStatus,
} from './socfund-view';

const forbidden = (message: string) => apiFail(403, 'forbidden', message);

/**
 * Ответ с карточкой после сохранения: контрагент читается заново, без области (его только что
 * сохранили); `notices` — уведомления «Отмечен статус «…» по УГНС», `redued` — у скольких несданных
 * отчётов статусы изменили срок.
 */
export async function savedOut(
  tx: Tx,
  id: string,
  options: {
    orgId: string;
    subject: AccessSubject;
    today: string;
    t: Translate;
    notices: string[];
    redued?: number;
  },
): Promise<ContractorSaved> {
  const r = await getContractor(tx, id, { scope: undefined, today: options.today });
  return {
    ...(await contractorOut(tx, r!, {
      fee: await feeVisible(tx, options.orgId, options.subject),
      t: options.t,
    })),
    notices: options.notices,
    redued: options.redued ?? 0,
  };
}

/**
 * Статусы «Ставится по УГНС» при выборе или смене УГНС (прототип ugApply). `chosen` — льготы и статусы
 * пришли в запросе: их выбрали в форме, где статусы по УГНС ставятся и снимаются сами и снятый вручную
 * не возвращается; без них (карточка, загрузка) статусы по УГНС ставит и снимает сервер.
 */
const officeBenefitsOf = (
  tx: Tx,
  benefits: ContractorFields['benefits'],
  offices: { from: string | null; to: string | null },
  t: Translate,
  chosen?: ContractorFields['benefits'],
) =>
  withOfficeBenefits(
    tx,
    benefits,
    offices,
    { marked: t('cp.notice.ugns_marked'), dropped: t('cp.notice.ugns_dropped') },
    chosen,
  );

/** Причины пересчёта сроков несданных отчётов при смене статусов контрагента (прототип cpRedue). */
export const redueTexts = (t: Translate) => ({
  byStatus: t('report.reason.due_status'),
  byCatalog: t('report.reason.due_catalog'),
  byCatalogDropped: t('report.reason.due_catalog_dropped'),
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
      description:
        'Контрагент создан одним целым (с первой ставкой обслуживания, отчётами и историей); сколько отчётов создано',
      content: { 'application/json': { schema: ContractorCreated } },
    },
    400: {
      description:
        'Неверные данные: ИНН, телефон, поля, отключённые значения справочников, ГКЭД не подкласс, запрет режима по ГКЭД, нужен ответ на вопрос о праве на режим, нет ни одного отчёта, отчёт не подходит к режиму или неверная ставка',
      content: error,
    },
    401: { description: 'Нет входа', content: error },
    403: {
      description:
        'Нет права «Создавать и изменять контрагентов» или стоимость, день оплаты, первый неполный месяц без права «Видеть плату за обслуживание»',
      content: error,
    },
    409: {
      description:
        'Такой ИНН уже есть в организации (и в архиве); вид отчёта не подключён или отключён',
      content: error,
    },
  },
});

/**
 * «Новый контрагент» (ТЗ «Регистрация контрагентов», «Обязательные поля»; прототип addCpDlg): всё —
 * одним целым в одной транзакции, вместе с отчётами; при сбое не создаётся ничего (экран показывает
 * «Не удалось сохранить контрагента, ничего не создано»). Стоимость обслуживания — первая запись
 * журнала тарифов: у постоянного контрагента обязательна тому, кто видит плату за обслуживание,
 * остальным недоступна.
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
    const texts = await serverTexts(deps);
    const regdocs = body.regdocs ? await storedRegdocs(deps, c, body.regdocs.files) : [];
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
          benefits: uniqueBy(body.benefits ?? []),
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
          socfundFlags: {},
          socfundTariff: null,
        };
        const sf = await socfundContext(tx, fields.gked, fields.formCode);
        // Статус СПиНО ставит тариф, а не окно «Льготы и особые статусы».
        fields.benefits = withSocfundStatus(fields.benefits, sf.dict, false);
        const office = await officeBenefitsOf(
          tx,
          body.benefits ? [] : fields.benefits,
          { from: null, to: fields.taxOfficeCode },
          t,
          body.benefits ? fields.benefits : undefined,
        );
        fields.benefits = office.benefits;
        const sfInput = socfundInputOf(body.socfund, {});
        const reportCodes =
          fields.kind === 'regular' ? (body.reports ?? []).map((r) => r.code) : [];
        const sfSubject = socfundSubjectOf(
          { ...fields, benefits: fields.benefits.map((b) => b.code), flags: sfInput.flags },
          sf.form,
          [...new Set(reportCodes)],
        );
        requireSocfundReason(sfSubject, sfInput, sf.dict, t);
        fields.gkedConfirmation = await checkContractor(tx, fields, {
          before: null,
          gkedConfirm: body.gkedConfirm ?? false,
          employeeId: subject.employeeId,
          ownEmployeeId: ownEmployeeOf(subject),
          today,
          t,
        });
        requireSocfundConfirm(sfSubject, null, sfInput, sf.dict, body.socfundConfirm ?? false, t);
        Object.assign(
          fields,
          socfundPatch({ ...sfSubject, flags: {} }, null, sfInput, sf.dict, fields.benefits),
        );
        // Без поля `reports` — без отчётов, как до формы 2.09 (docs/decisions.md п. А-5).
        const plan = body.reports
          ? await planNewReports(
              tx,
              fields,
              { reports: body.reports, forced: body.reportsForced },
              { today, t },
            )
          : null;
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
          {
            today,
            ...(body.regdocs?.recognized ? { reason: t('cp.rd.reason') } : {}),
          },
        );
        if (regdocs.length) {
          // Документы окна «Из свидетельства и выписки» — к контрагенту, той же транзакцией.
          const files = await pendingRegdocs(tx, regdocs, ctx.userId!, { lock: true });
          await attachRegdocs(
            tx,
            files.map((f) => f.id),
            id,
          );
        }
        await writeContractorNotes(tx, id, office.notes);
        const reportsCreated = plan
          ? await createNewReports(tx, id, plan, {
              today,
              confirm: (await orgMenuSettings(tx, ctx.orgId)).reportConfirm,
              texts: assignmentTexts(texts),
            })
          : 0;
        return {
          ...(await savedOut(tx, id, {
            orgId: ctx.orgId,
            subject,
            today,
            t,
            notices: office.notes,
          })),
          reportsCreated,
        };
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
 * Документы «Из свидетельства и выписки», которые прикрепятся к новому контрагенту (прототип addCpDlg:
 * `pre.files`): загруженные этим пользователем и ещё ни к кому не прикреплённые, которые дошли до
 * хранилища того размера и типа, что заявлены (PDF не больше 10 МБ). Остальные не прикрепляются — контрагент
 * создаётся без них, незаконченные загрузки убирает задача очистки.
 */
async function storedRegdocs(
  deps: ApiDeps,
  c: Context<AppEnv>,
  ids: readonly string[],
): Promise<string[]> {
  const ctx = orgContextOf(c);
  const files = await withOrgContext(deps.db, ctx, (tx) =>
    pendingRegdocs(tx, [...new Set(ids)], ctx.userId!),
  );
  const out: string[] = [];
  for (const f of files) {
    const stored = await deps.storage.stat(f.storageKey);
    if (
      stored &&
      stored.size === f.sizeBytes &&
      stored.size <= RD_MAX_BYTES &&
      stored.contentType === 'application/pdf'
    )
      out.push(f.id);
  }
  return out;
}

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
    const { version, gkedConfirm, socfund, socfundConfirm, ...patch } = c.req.valid('json');
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
        const [sf, types] = await Promise.all([
          socfundContext(tx, next.gked, next.formCode),
          activeReportTypes(tx, id),
        ]);
        if (patch.gkedExtra) next.gkedExtra = [...new Set(patch.gkedExtra)];
        // Статус СПиНО ставит тариф, а не окно «Льготы и особые статусы»: до решения о тарифе — как был.
        if (patch.benefits) {
          next.benefits = withSocfundStatus(
            uniqueBy(patch.benefits),
            sf.dict,
            before.socfundTariff?.id === 'spino',
          );
        }
        if (patch.bases) next.bases = [...new Set(patch.bases)];
        const office = await officeBenefitsOf(
          tx,
          patch.benefits ? before.benefits : next.benefits,
          { from: before.taxOfficeCode, to: next.taxOfficeCode },
          t,
          patch.benefits ? next.benefits : undefined,
        );
        next.benefits = office.benefits;
        const sfInput = socfundInputOf(socfund, before.socfundFlags ?? {});
        const sfSubject = socfundSubjectOf(
          { ...next, benefits: next.benefits.map((b) => b.code), flags: sfInput.flags },
          sf.form,
          types,
        );
        requireSocfundReason(sfSubject, sfInput, sf.dict, t);
        const confirmation = await checkContractor(tx, next, {
          before: { id, fields: before },
          gkedConfirm: gkedConfirm ?? false,
          employeeId: subject.employeeId,
          ownEmployeeId: ownEmployeeOf(subject),
          today,
          t,
        });
        requireSocfundConfirm(
          sfSubject,
          before.socfundTariff ?? null,
          sfInput,
          sf.dict,
          socfundConfirm ?? false,
          t,
        );
        const sfPatch = socfundPatch(
          { ...sfSubject, flags: before.socfundFlags ?? {} },
          before.socfundTariff ?? null,
          sfInput,
          sf.dict,
          next.benefits,
        );
        const { redued } = await updateContractor(
          tx,
          ctx.orgId,
          id,
          version,
          {
            ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
            ...(patch.gkedExtra ? { gkedExtra: next.gkedExtra } : {}),
            ...(patch.benefits || office.notes.length || sfPatch.benefits !== next.benefits
              ? { benefits: sfPatch.benefits }
              : {}),
            ...(patch.bases ? { bases: next.bases } : {}),
            gkedConfirmation: confirmation,
            socfundFlags: sfPatch.socfundFlags,
            socfundTariff: sfPatch.socfundTariff,
          },
          scope,
          { today, texts: redueTexts(t) },
        );
        await writeContractorNotes(tx, id, office.notes);
        return savedOut(tx, id, {
          orgId: ctx.orgId,
          subject,
          today,
          t,
          notices: office.notes,
          redued,
        });
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
