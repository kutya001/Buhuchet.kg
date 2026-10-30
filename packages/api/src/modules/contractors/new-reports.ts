import {
  connectedReportTypes,
  createAssignment,
  draftSingleTaxRates,
  reportPickDict,
  reportPickSubject,
  writeContractorNotes,
  type AssignmentTexts,
  type ContractorFields,
  type PickFields,
  type ReportTypeRecord,
  type Tx,
} from '@buhuchet/db';
import {
  ASSIGNMENT_MESSAGES,
  assignmentProblem,
  defaultTypeRate,
  incompatibilityText,
  isSingleTaxType,
  isTypeOff,
  ORG_REPORT_TYPE_MESSAGES,
  reportPick,
  typeIncompatibility,
  type AssignmentEnRate,
  type IsoDate,
  type Translate,
} from '@buhuchet/domain';
import type { ContractorNewReport } from '@buhuchet/shared';
import type { z } from 'zod';
import { apiFail } from '../../errors';
import { withReportErrors } from '../reports/common';

/*
 * Отчёты нового контрагента (ТЗ «Обязательные поля при регистрации»: виды из подключённых организацией,
 * «нужен хотя бы один»; «Сохранение контрагента — одно целое действие: либо создаются контрагент и все
 * его отчёты, либо … не создаётся ничего»; прототип addCpDlg: assignTypes, st.forced). Сначала всё
 * проверяется (`planNewReports`), потом, после записи контрагента в той же транзакции, назначается
 * (`createNewReports`): сбой любого шага откатывает всё.
 */

type NewReport = z.infer<typeof ContractorNewReport>;

/** Назначение, которое создаст форма: вид и ставки, уже проверенные и с подставленными по умолчанию. */
interface PlannedReport {
  type: ReportTypeRecord;
  rate: string | null;
  enRates: AssignmentEnRate[];
  rateAdditions: string[];
}

export interface NewReportsPlan {
  items: PlannedReport[];
  /** «Не назначен отчёт …, хотя он …» — обязательные, снятые с подтверждением (в историю контрагента). */
  forced: string[];
}

function fail(status: 400 | 409, code: string, message: string): never {
  apiFail(status, code, message, { field: 'reports' });
}

/**
 * Проверка отчётов формы по тем же правилам, что и в окне «Подбор отчётов»: вид есть в каталоге,
 * подключён, не отключён и не «Не предлагается», подходит к режиму и форме собственности; ставка — из
 * ставок вида (не выбрана — по умолчанию, как `defRate` прототипа), строки ЕНС — из справочника (не
 * выбраны — по ГКЭД и статусам, как `enAuto`), добавляемые строки — из ставок вида.
 */
export async function planNewReports(
  tx: Tx,
  fields: ContractorFields,
  input: { reports: readonly NewReport[]; forced: readonly string[] },
  ctx: { today: IsoDate; t: Translate },
): Promise<NewReportsPlan> {
  const { t } = ctx;
  if (fields.kind === 'oneoff') {
    if (input.reports.length) fail(400, 'validation_failed', t('err.reports_oneoff'));
    return { items: [], forced: [] };
  }
  if (!input.reports.length) fail(400, 'reports_required', t('err.reports_required'));
  const list = [...new Map(input.reports.map((r) => [r.code, r])).values()];
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
    bases: fields.bases,
    // Как у черновика в окне подбора: строки ЕНС формы, действующего назначения ещё нет.
    enRates: list.find((r) => isSingleTaxType(r.code))?.enRates ?? [],
    singleTax: [],
  };
  const connected = await connectedReportTypes(tx);
  const [s, dict] = await Promise.all([
    reportPickSubject(tx, pickFields, connected),
    reportPickDict(
      tx,
      [fields.gked, ...fields.gkedExtra].filter((c): c is string => !!c),
    ),
  ]);
  const items: PlannedReport[] = [];
  for (const r of list) {
    const type = dict.types.find((x) => x.code === r.code);
    if (!type) fail(400, 'validation_failed', t('err.report_pick_unknown'));
    if (!connected.includes(r.code)) {
      fail(409, 'report_type_not_connected', ORG_REPORT_TYPE_MESSAGES.report_type_not_connected);
    }
    if (isTypeOff(type)) {
      fail(409, 'report_type_inactive', ORG_REPORT_TYPE_MESSAGES.report_type_inactive);
    }
    const why = typeIncompatibility(type, s, dict.rates, ctx.today, t);
    if (why) fail(400, 'report_type_incompatible', incompatibilityText(why, t));
    const single = isSingleTaxType(r.code);
    const planned: PlannedReport = {
      type: type,
      rate: single ? r.rate : (r.rate ?? defaultTypeRate(type)),
      enRates: single && !r.enRates.length ? await draftSingleTaxRates(tx, pickFields) : r.enRates,
      rateAdditions: [...r.rateAdditions],
    };
    const problem = assignmentProblem(
      {
        fromMonth: ctx.today,
        untilMonth: null,
        rate: planned.rate,
        enRates: planned.enRates,
        rateAdditions: planned.rateAdditions,
        dueDay: null,
        ownPeriod: null,
        ownDay: null,
        ownMonth: null,
        fixedAmount: null,
      },
      type,
      dict.rates,
    );
    if (problem) fail(400, problem.problem, ASSIGNMENT_MESSAGES[problem.problem]);
    items.push(planned);
  }
  // Снятый обязательный — по подбору сервера (прототип pkMustWhy): отмеченный формой «снят», но не
  // обязательный по подбору, в историю не пишется.
  const pick = reportPick(s, dict, ctx.today, t);
  const chosen = new Set(list.map((r) => r.code));
  const forced = [...new Set(input.forced)]
    .filter((code) => !chosen.has(code) && pick.rec.get(code)?.must)
    .map((code) =>
      t('cp.history.not_assigned', {
        name: dict.types.find((x) => x.code === code)!.name,
        must: pick.rec.get(code)!.must,
      }),
    );
  return { items, forced };
}

/**
 * Назначения нового контрагента — с текущего периода, как обычные (`createAssignment`): отчёты на
 * сегодня создаются сразу, ответственный — ответственный контрагента. Возвращает, сколько отчётов
 * создано («Контрагент добавлен, отчётов создано: N»).
 */
export async function createNewReports(
  tx: Tx,
  contractorId: string,
  plan: NewReportsPlan,
  ctx: { today: IsoDate; confirm: boolean; texts: AssignmentTexts },
): Promise<number> {
  let created = 0;
  for (const p of plan.items) {
    const { effect } = await withReportErrors(() =>
      createAssignment(
        tx,
        {
          contractorId,
          reportTypeCode: p.type.code,
          fromMonth: null,
          untilMonth: null,
          responsibleEmployeeId: null,
          rate: p.rate,
          enRates: p.enRates,
          rateAdditions: p.rateAdditions,
          dueDay: null,
          ownPeriod: null,
          ownDay: null,
          ownMonth: null,
          fixedAmount: null,
          note: '',
        },
        {
          today: ctx.today,
          scope: undefined,
          markPast: false,
          confirm: ctx.confirm,
          texts: ctx.texts,
        },
      ),
    );
    created += effect.created + effect.past;
  }
  await writeContractorNotes(tx, contractorId, plan.forced);
  return created;
}
