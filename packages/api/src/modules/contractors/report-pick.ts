import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import {
  activeAssignments,
  connectedReportTypes,
  contractorGkedDicts,
  createAssignment,
  getContractor,
  listReportBases,
  lockAssignee,
  lockContractor,
  orgMenuSettings,
  readContractorFields,
  removePickedTypes,
  reportPickDetails,
  reportPickDict,
  reportPickGked,
  reportPickRemovePreview,
  reportPickSubject,
  singleTaxRateRows,
  singleTaxSubject,
  socfundDict,
  socfundStatusCode,
  updateContractor,
  withOrgContext,
  type ContractorRecord,
  type PickFields,
  type Tx,
} from '@buhuchet/db';
import {
  defaultSingleTaxRates,
  defaultTypeRate,
  hasPermission,
  incompatibilityText,
  isSingleTaxType,
  isTypeOff,
  ORG_REPORT_TYPE_MESSAGES,
  RecordNotFoundError,
  reportPick,
  reportPickChanges,
  REPORT_MESSAGES,
  socfundFlagsOf,
  socfundState,
  socfundTypeNote,
  typeIncompatibility,
  type AccessSubject,
  type IsoDate,
  type SocfundChoice,
  type Translate,
} from '@buhuchet/domain';
import {
  ReportPickApplied,
  ReportPickApply,
  ReportPickContext,
  ReportPickPreview,
  ReportPickPreviewRequest,
  ReportPickRequest,
  Uuid,
} from '@buhuchet/shared';
import { and, type SQL } from 'drizzle-orm';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, versionedSaveResponses } from '../../errors';
import { orgContextOf, requireAnyPermission, requirePermission } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';
import { assigneeScopeOf, assignmentTexts, withReportErrors } from '../reports/common';
import { notFound } from './card';
import { error, scopeSqlOf, subjectOf, todayOf, translateOf } from './common';
import { redueTexts } from './save';
import { socfundContext, socfundInputOf, socfundPatch, socfundSubjectOf } from './socfund-view';

/*
 * «Подбор отчётов» (ТЗ «Контрагенты» → «Подбор отчётов и налогов, льгот и статусов»; прототип
 * modules/report-pick.js): что нужно окну о контрагенте или черновике формы, что сделает «Применить» и
 * само применение у созданного контрагента. Наборы окно считает само (`reportPick` из @buhuchet/domain по
 * справочникам каталога); сервер считает их так же, когда проверяет применение. Окно — на вкладке карточки
 * (2.11) и в форме создания (2.09).
 */

/** Менять отчёты контрагента может сотрудник с правом «Создавать и изменять контрагентов» или «Назначать отчёты». */
const canPick = (s: AccessSubject) => hasPermission(s, 'createCp') || hasPermission(s, 'assign');

/**
 * Контрагенты, у которых сотрудник меняет отчёты: видимые в карточке (область группы «Контрагенты») и,
 * если право только «Назначать отчёты», — в области группы «Отчеты для сдачи», как у назначений.
 */
function pickScopeOf(s: AccessSubject): SQL | undefined {
  const card = scopeSqlOf(s);
  return hasPermission(s, 'createCp') ? card : and(card, assigneeScopeOf(s));
}

/** Поля сохранённого контрагента для подбора. */
function fieldsOf(r: ContractorRecord, singleTax: PickFields['singleTax']): PickFields {
  return {
    formCode: r.form.code,
    regimeCode: r.regime?.code ?? null,
    regime2Code: r.regime2?.code ?? null,
    gked: r.gked?.code ?? null,
    gkedExtra: r.gkedExtra.map((x) => x.code),
    taxOfficeCode: r.taxOffice?.code ?? null,
    address: r.registration.address ?? '',
    bizSize: r.bizSize,
    benefits: r.benefits.map((b) => ({ code: b.code, validFrom: b.validFrom, validTo: b.validTo })),
    bases: r.bases.map((b) => b.code),
    enRates: singleTax,
    singleTax,
  };
}

const EMPTY_FIELDS: PickFields = {
  formCode: null,
  regimeCode: null,
  regime2Code: null,
  gked: null,
  gkedExtra: [],
  taxOfficeCode: null,
  address: '',
  bizSize: 'small',
  benefits: [],
  bases: [],
  enRates: [],
  singleTax: [],
};

/** Набранное в окне или форме важнее сохранённого: только переданные поля. */
function withRequest(f: PickFields, body: z.infer<typeof ReportPickRequest>): PickFields {
  const pick = <K extends keyof PickFields>(k: K, v: PickFields[K] | undefined) =>
    v === undefined ? {} : { [k]: v };
  return {
    ...f,
    ...pick('formCode', body.formCode),
    ...pick('regimeCode', body.regimeCode),
    ...pick('regime2Code', body.regime2Code),
    ...pick('gked', body.gked),
    ...pick('gkedExtra', body.gkedExtra && [...new Set(body.gkedExtra)]),
    ...pick('taxOfficeCode', body.taxOfficeCode),
    ...pick('bizSize', body.bizSize),
    ...pick(
      'benefits',
      body.benefits &&
        [...new Set(body.benefits)].map((code) => ({ code, validFrom: null, validTo: null })),
    ),
    ...pick('bases', body.bases && [...new Set(body.bases)]),
    ...pick('enRates', body.enRates),
  };
}

const gkedCodesOf = (f: Pick<PickFields, 'gked' | 'gkedExtra'>) =>
  [f.gked, ...f.gkedExtra].filter((c): c is string => !!c);

export const reportPickContextRoute = createRoute({
  method: 'post',
  path: '/contractors/report-pick',
  tags: ['contractors'],
  summary: '«Подбор отчётов»: контрагент или черновик формы для окна',
  middleware: [requirePermission('cpView')] as const,
  request: {
    body: { required: true, content: { 'application/json': { schema: ReportPickRequest } } },
  },
  responses: {
    200: {
      description:
        'Контрагент для подбора, подключённые и назначенные виды, можно ли менять, ГКЭД, сроки и ставки для описаний',
      content: { 'application/json': { schema: ReportPickContext } },
    },
    400: { description: 'Неверные данные запроса', content: error },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Просматривать контрагентов»', content: error },
    404: { description: 'Нет такого контрагента или он вне области сотрудника', content: error },
  },
});

/**
 * Что нужно окну «Подбор отчётов» (прототип pkView, pkDescHtml): ничего не сохраняет. У созданного
 * контрагента — его поля, назначенные виды и версия; переданные поля (основания из шапки окна, черновик
 * формы) важнее сохранённых. Пояснение о тарифе Соцфонда — только у созданного контрагента: у черновика
 * его показывает форма (`socfund-check`).
 */
export function reportPickContextHandler(
  deps: ApiDeps,
): RouteHandler<typeof reportPickContextRoute, AppEnv> {
  return async (c) => {
    const body = c.req.valid('json');
    const subject = subjectOf(c);
    const today = todayOf(deps);
    const t = await translateOf(deps);
    const out = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      const r = body.contractorId
        ? await getContractor(tx, body.contractorId, { scope: scopeSqlOf(subject), today })
        : null;
      if (body.contractorId && !r) notFound();
      const active = r ? await activeAssignments(tx, r.id) : { codes: [], singleTax: [] };
      const fields = withRequest(r ? fieldsOf(r, active.singleTax) : EMPTY_FIELDS, body);
      const connected = await connectedReportTypes(tx);
      const pickSubject = await reportPickSubject(tx, fields, connected);
      const [index, rates, sf, { details, enRates }, editable, socfund] = await Promise.all([
        reportPickGked(tx, gkedCodesOf(fields)),
        singleTaxRateRows(tx),
        socfundDict(tx, []),
        reportPickDetails(tx, fields, pickSubject, {
          today,
          codes: [...new Set([...connected, ...active.codes])],
          t,
        }),
        r ? inPickScope(tx, r.id, subject) : Promise.resolve(true),
        socfundNote(tx, r, fields, active.codes, body.socfund, t),
      ]);
      const open = !r || (r.serviceStatus !== 'archived' && r.kind === 'regular');
      return {
        subject: {
          form: pickSubject.form,
          regimes: [...pickSubject.regimes],
          benefits: [...pickSubject.benefits],
          bases: [...pickSubject.bases],
          bizSize: pickSubject.bizSize,
          gked: pickSubject.gked,
          gkedExtra: [...pickSubject.gkedExtra],
          enCodes: [...pickSubject.enCodes],
          singleTax: [...pickSubject.singleTax],
        },
        connected,
        assigned: active.codes,
        version: r?.version ?? null,
        edit: {
          types: open && editable && canPick(subject),
          // Основания меняет тот же, кто отмечает отчёты, как в прототипе (решение заказчика,
          // docs/deviations.md п. А-6).
          bases: open && editable && canPick(subject),
          connect: hasPermission(subject, 'dicts'),
        },
        today,
        gkedIndex: index,
        rates: rates.map((x) => ({ ...x, addsTo: [...x.addsTo] })),
        details,
        enRates,
        socfund,
        socfundStatus: socfundStatusCode(sf.dict),
      };
    });
    return c.json(out, 200);
  };
}

/** Контрагент в области, где сотрудник меняет отчёты (`pickScopeOf`). */
async function inPickScope(tx: Tx, id: string, subject: AccessSubject): Promise<boolean> {
  if (!canPick(subject)) return false;
  try {
    await lockAssignee(tx, id, pickScopeOf(subject), 'share');
    return true;
  } catch (e) {
    if (e instanceof RecordNotFoundError) return false;
    throw e;
  }
}

/**
 * Пояснение к виду со взносами (прототип sfTypeNote): тариф по основаниям окна — включённые «Наёмные
 * сотрудники» делают тариф нужным; признаки и выбор тарифа — из формы, если она их передала, иначе
 * сохранённые. null — тариф контрагенту не нужен или у черновика формы признаков ещё нет.
 */
async function socfundNote(
  tx: Tx,
  r: ContractorRecord | null,
  f: PickFields,
  types: readonly string[],
  input: z.infer<typeof ReportPickRequest>['socfund'],
  t: Translate,
) {
  if (!r && !input) return null;
  const { dict, form } = await socfundContext(tx, f.gked, f.formCode);
  const stored = r?.socfundTariff ?? null;
  // Выбор в форме, как у `socfund-check`: не тронут — сохранённый, «Определить автоматически» — нет выбора.
  const choice: SocfundChoice | null =
    input?.tariff === undefined
      ? stored
      : input.tariff && {
          id: input.tariff,
          manual: input.tariff === stored?.id ? stored.manual : true,
          reason: input.tariff === stored?.id ? stored.reason : null,
        };
  const st = socfundState(
    socfundSubjectOf(
      {
        kind: r?.kind ?? 'regular',
        bases: f.bases,
        gked: f.gked,
        benefits: f.benefits.map((b) => b.code),
        flags: input ? socfundFlagsOf(input.flags) : r!.socfundFlags,
      },
      form,
      types,
    ),
    choice,
    dict,
  );
  if (!st) return null;
  const tariff = (id: string | null | undefined) => dict.tariffs.find((x) => x.id === id) ?? null;
  return {
    types: [...dict.reportTypes],
    ...socfundTypeNote(tariff(st.choice?.id), tariff(st.auto.tariff), t),
  };
}

const pickResponses = {
  400: { description: 'Неверные данные запроса', content: error },
  401: { description: 'Нет входа', content: error },
  403: {
    description:
      'Нет права «Создавать и изменять контрагентов» или «Назначать отчёты контрагентам»',
    content: error,
  },
  404: { description: 'Нет такого контрагента или он вне области сотрудника', content: error },
} as const;

export const reportPickPreviewRoute = createRoute({
  method: 'post',
  path: '/contractors/{id}/report-pick/preview',
  tags: ['contractors'],
  summary: 'Что сделает «Применить» в подборе отчётов',
  middleware: [requirePermission('cpView'), requireAnyPermission('createCp', 'assign')] as const,
  request: {
    params: z.object({ id: Uuid }),
    body: { required: true, content: { 'application/json': { schema: ReportPickPreviewRequest } } },
  },
  responses: {
    200: {
      description:
        'Какие виды добавятся и снимутся, сколько отчётов «К сдаче» удалится и сколько несданных останется',
      content: { 'application/json': { schema: ReportPickPreview } },
    },
    ...pickResponses,
  },
});

/** Подтверждение «Изменить отчёты контрагента?» (прототип pkConfirm, pkChangesHtml): ничего не меняет. */
export function reportPickPreviewHandler(
  deps: ApiDeps,
): RouteHandler<typeof reportPickPreviewRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { codes } = c.req.valid('json');
    const subject = subjectOf(c);
    const today = todayOf(deps);
    const out = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      // Вне области — «не найден» (общий обработчик `RecordNotFoundError`).
      await lockAssignee(tx, id, pickScopeOf(subject), 'share');
      const active = await activeAssignments(tx, id);
      const { add, remove } = reportPickChanges(active.codes, [...new Set(codes)]);
      return { add, remove, ...(await reportPickRemovePreview(tx, id, remove, today)) };
    });
    return c.json(out, 200);
  };
}

export const applyReportPickRoute = createRoute({
  method: 'put',
  path: '/contractors/{id}/report-pick',
  tags: ['contractors'],
  summary: '«Применить» подбор отчётов: виды и основания контрагента',
  middleware: [requirePermission('cpView'), requireAnyPermission('createCp', 'assign')] as const,
  request: {
    params: z.object({ id: Uuid }),
    body: { required: true, content: { 'application/json': { schema: ReportPickApply } } },
  },
  responses: {
    200: {
      description:
        'Добавлены и сняты виды, удалены отчёты «К сдаче» снятых видов, сохранены основания',
      content: { 'application/json': { schema: ReportPickApplied } },
    },
    ...pickResponses,
    400: {
      description:
        'Неверные данные; вид не подходит контрагенту; снятие обязательного вида не подтверждено',
      content: error,
    },
    403: {
      description:
        'Нет права менять отчёты контрагента; основания — без права «Создавать и изменять контрагентов»',
      content: error,
    },
    ...versionedSaveResponses,
    409: {
      description:
        'Отчёты или запись контрагента изменил другой пользователь; вид не подключён или отключён; контрагент в архиве или разовый',
      content: error,
    },
  },
});

/**
 * «Применить» (ТЗ «Изменение у существующего контрагента»; прототип pkCpMount, pkApply): основания — с
 * правом «Создавать и изменять контрагентов» и версией записи (тариф Соцфонда пересчитывается, как при
 * «Изменить»); снятые виды — назначение заканчивается сегодня, текущие и будущие отчёты «К сдаче» без
 * движения удаляются; обязательный вид снимается только после подтверждения (`forced`), в истории — «снял,
 * хотя отчёт обязателен…»; добавленные — назначение с текущего периода, как обычное (ставка ЕН — по ГКЭД,
 * ставка другого вида — как в прототипе assignTypes, остальное задают «Ставки»).
 */
export function applyReportPickHandler(
  deps: ApiDeps,
): RouteHandler<typeof applyReportPickRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const subject = subjectOf(c);
    const ctx = orgContextOf(c);
    const today = todayOf(deps);
    const t = await translateOf(deps);
    const texts = await serverTexts(deps);
    const scope = pickScopeOf(subject);
    const out = await withOrgContext(deps.db, ctx, async (tx) => {
      const row = await lockContractor(tx, id, scope);
      if (!row) notFound();
      if (row.serviceStatus === 'archived') {
        apiFail(409, 'contractor_archived', t('err.contractor_archived'));
      }
      if (row.kind === 'oneoff') {
        apiFail(409, 'contractor_oneoff', REPORT_MESSAGES.contractor_oneoff);
      }
      const active = await activeAssignments(tx, id);
      if (!sameSet(active.codes, body.assigned)) {
        apiFail(409, 'report_pick_changed', t('err.report_pick_changed'));
      }
      const fields = await readContractorFields(tx, row);
      const bases = body.bases ? [...new Set(body.bases)] : fields.bases;
      let version = row.version;
      if (!sameSet(bases, fields.bases)) {
        if (body.version === undefined) {
          apiFail(400, 'validation_failed', t('err.report_pick_version'), {
            field: 'version',
          });
        }
        await saveBases(tx, {
          orgId: ctx.orgId,
          id,
          version: body.version,
          bases,
          fields,
          scope,
          today,
          t,
        });
        version = body.version + 1;
      }
      const pickFields: PickFields = {
        formCode: fields.formCode,
        regimeCode: fields.regimeCode,
        regime2Code: fields.regime2Code,
        gked: fields.gked,
        gkedExtra: fields.gkedExtra,
        taxOfficeCode: fields.taxOfficeCode,
        address: fields.registration.address ?? '',
        bizSize: fields.bizSize,
        benefits: fields.benefits,
        bases,
        enRates: active.singleTax,
        singleTax: active.singleTax,
      };
      const connected = await connectedReportTypes(tx);
      const s = await reportPickSubject(tx, pickFields, connected);
      const dict = await reportPickDict(tx, gkedCodesOf(pickFields));
      const pick = reportPick(s, dict, today, t);
      const { add, remove } = reportPickChanges(active.codes, [...new Set(body.codes)]);

      const must = new Map(remove.map((code) => [code, pick.rec.get(code)?.must ?? '']));
      const unconfirmed = remove.filter((code) => must.get(code) && !body.forced.includes(code));
      if (unconfirmed.length) {
        const names = unconfirmed.map((code) => dict.types.find((x) => x.code === code)!.shortName);
        apiFail(400, 'report_pick_must', t('err.report_pick_must', { names: names.join(', ') }), {
          field: 'forced',
          codes: unconfirmed,
        });
      }
      const added = add.map((code) => {
        const type = dict.types.find((x) => x.code === code);
        if (!type)
          apiFail(400, 'validation_failed', t('err.report_pick_unknown'), { field: 'codes' });
        if (!connected.includes(code)) {
          apiFail(
            409,
            'report_type_not_connected',
            ORG_REPORT_TYPE_MESSAGES.report_type_not_connected,
            {
              field: 'codes',
            },
          );
        }
        // Отключённый в каталоге и «Не предлагается» — как в окне (`isTypeOff`).
        if (isTypeOff(type)) {
          apiFail(409, 'report_type_inactive', ORG_REPORT_TYPE_MESSAGES.report_type_inactive, {
            field: 'codes',
          });
        }
        const why = typeIncompatibility(type, s, dict.rates, today, t);
        if (why) {
          apiFail(400, 'report_type_incompatible', incompatibilityText(why, t), { field: 'codes' });
        }
        return type;
      });

      const deleted = await removePickedTypes(tx, id, remove, {
        today,
        reason: (code, n) =>
          t('cp.pick.history.removed') +
          (n ? t('cp.pick.history.deleted_n', { n }) : '') +
          (must.get(code) ? t('cp.pick.history.forced', { must: must.get(code)! }) : ''),
        deleteReason: t('cp.pick.history.report_deleted'),
      });
      const { reportConfirm } = await orgMenuSettings(tx, ctx.orgId);
      const enRates = added.some((x) => isSingleTaxType(x.code))
        ? await singleTaxByGked(tx, id, pickFields)
        : [];
      for (const type of added) {
        await withReportErrors(() =>
          createAssignment(
            tx,
            {
              contractorId: id,
              reportTypeCode: type.code,
              fromMonth: null,
              untilMonth: null,
              responsibleEmployeeId: null,
              // Ставка по умолчанию — как в форме прототипа (defRate) и у демо-контрагентов.
              rate: isSingleTaxType(type.code) ? null : defaultTypeRate(type),
              enRates: isSingleTaxType(type.code) ? enRates : [],
              rateAdditions: [],
              dueDay: null,
              ownPeriod: null,
              ownDay: null,
              ownMonth: null,
              fixedAmount: null,
              note: '',
            },
            {
              today,
              scope,
              markPast: false,
              confirm: reportConfirm,
              texts: assignmentTexts(texts),
            },
          ),
        );
      }
      return { add, remove, deleted, version };
    });
    return c.json(out, 200);
  };
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  new Set(a).size === new Set(b).size && a.every((x) => b.includes(x));

/** Строки ЕНС нового назначения единого налога — по ГКЭД, статусам и месту деятельности (прототип enAuto). */
async function singleTaxByGked(tx: Tx, id: string, f: PickFields) {
  const [st, dicts] = await Promise.all([
    singleTaxSubject(tx, id),
    contractorGkedDicts(tx, gkedCodesOf(f)),
  ]);
  return defaultSingleTaxRates(st, dicts.rates, dicts.index);
}

/**
 * Основания из шапки подбора (прототип pkCpMount: «Основания: …» в истории): только действующие значения
 * справочника (прежние отключённые остаются); тариф Соцфонда пересчитывается по новым основаниям, как при
 * «Изменить» без правки тарифа.
 */
async function saveBases(
  tx: Tx,
  a: {
    orgId: string;
    id: string;
    version: number;
    bases: string[];
    fields: Awaited<ReturnType<typeof readContractorFields>>;
    scope: SQL | undefined;
    today: IsoDate;
    t: Translate;
  },
) {
  const known = new Set((await listReportBases(tx)).map((b) => b.code));
  if (a.bases.some((b) => !known.has(b) && !a.fields.bases.includes(b))) {
    apiFail(400, 'value_inactive', a.t('err.value_inactive'), { field: 'bases' });
  }
  const [{ dict, form }, types] = await Promise.all([
    socfundContext(tx, a.fields.gked, a.fields.formCode),
    activeAssignments(tx, a.id).then((x) => x.codes),
  ]);
  const sfSubject = socfundSubjectOf(
    {
      ...a.fields,
      bases: a.bases,
      benefits: a.fields.benefits.map((b) => b.code),
      flags: a.fields.socfundFlags ?? {},
    },
    form,
    types,
  );
  const patch = socfundPatch(
    sfSubject,
    a.fields.socfundTariff ?? null,
    socfundInputOf(undefined, a.fields.socfundFlags ?? {}),
    dict,
    a.fields.benefits,
  );
  await updateContractor(
    tx,
    a.orgId,
    a.id,
    a.version,
    {
      bases: a.bases,
      socfundFlags: patch.socfundFlags,
      socfundTariff: patch.socfundTariff,
      ...(patch.benefits !== a.fields.benefits ? { benefits: patch.benefits } : {}),
    },
    a.scope,
    { today: a.today, texts: redueTexts(a.t) },
  );
}
