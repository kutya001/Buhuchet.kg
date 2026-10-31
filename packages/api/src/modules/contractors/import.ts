import { randomUUID } from 'node:crypto';
import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  connectedReportTypes,
  contractorGkedDicts,
  contractorImportData,
  createContractor,
  gkedLevels,
  gkedTemplateRows,
  officeBenefits,
  orgMenuSettings,
  releaseRateLimit,
  reportPickDict,
  takenInns,
  takeRateLimit,
  uniqueViolation,
  withOfficeBenefits,
  withOrgContext,
  writeContractorNotes,
  writeHistory,
  type ContractorFields,
  type ContractorImportData,
  type RateLimit,
  type ReportTypeRecord,
  type Tx,
} from '@buhuchet/db';
import {
  checkImportRows,
  CP_IMPORT_FIELDS,
  DEFAULT_FEE_DAY,
  defaultSingleTaxRates,
  defaultTypeRate,
  EMPLOYEES_BASE,
  gkedCheck,
  importReady,
  importValues,
  incompatibilityText,
  isSingleTaxType,
  reportPick,
  typeIncompatibility,
  type AccessSubject,
  type AssignmentEnRate,
  type CpImportField,
  type CpImportRowCheck,
  type IsoDate,
  type PickSection,
  type PickSubject,
  type Translate,
} from '@buhuchet/domain';
import {
  ContractorImportCheck,
  ContractorImportRequest,
  ContractorImportResult,
  ContractorImportTemplate,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { exportRateResponses, withExportSlot, xlsxContent } from '../../lists/export';
import { buildXlsxBook, XLSX_TYPE } from '../../lists/xlsx';
import { orgContextOf, requirePermission } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';
import { assignmentTexts } from '../reports/common';
import { error, feeVisible, subjectOf, todayOf, translateOf } from './common';
import { createNewReports } from './new-reports';
import { socfundContext, socfundPatch, socfundSubjectOf, withSocfundStatus } from './socfund-view';

/*
 * «Загрузка из Excel» в списке контрагентов (задача 2.16; ТЗ «Контрагенты» → «Загрузка текущих
 * контрагентов при переходе на систему»; прототип modules/contractor-import.js — impTemplate, importDlg):
 * шаблон, «Проверить» и «ОК». Строки разбирает экран, сервер проверяет их заново и при «ОК» — ещё раз,
 * в той же транзакции, где создаёт готовые: строки с ошибками не создаются и остаются в окне. Право —
 * «Загружать контрагентов списком» (`cpImport`).
 */

const noAuth = { description: 'Нет входа', content: error };
const noRight = {
  description: 'Нет права «Просматривать контрагентов» или «Загружать контрагентов списком»',
  content: error,
};

/**
 * Проверки и загрузки одного пользователя: одна одновременно и не больше 60 за час — проверка 500 строк
 * читает справочники и подбор отчётов для каждой строки, а повторять её можно сколько угодно. Не
 * отпущенная (сбой процесса) перестаёт мешать через 5 минут, как выгрузка.
 */
export const CP_IMPORT_RATE_LIMIT: RateLimit = {
  kind: 'cp_import',
  max: 60,
  windowSeconds: 3600,
  leaseSeconds: 300,
};

async function withImportSlot<T>(deps: ApiDeps, c: Context<AppEnv>, run: () => Promise<T>) {
  const userId = c.get('session')!.userId;
  const slot = await takeRateLimit(deps.db, CP_IMPORT_RATE_LIMIT, userId);
  if (!slot.ok) {
    if (slot.reason === 'busy') apiFail(429, 'cp_import_busy', 'Предыдущая проверка ещё идёт');
    apiFail(429, 'cp_import_limit', 'Слишком много проверок загрузки за час');
  }
  try {
    return await run();
  } finally {
    await releaseRateLimit(deps.db, CP_IMPORT_RATE_LIMIT, userId, slot.ticket).catch(
      (err: unknown) => deps.logger.error({ err }, 'проверка загрузки контрагентов не отпущена'),
    );
  }
}

const importRateResponses = {
  429: { description: 'Идёт прежняя проверка пользователя или за час их уже 60', content: error },
} as const;

/** Группы подбора, отчёты которых назначаются при пустой колонке «Виды отчётов» (ТЗ «Подбор при загрузке»). */
const AUTO_SECTIONS: ReadonlySet<PickSection> = new Set(['regime', 'status', 'all']);

/** Строка, проверенная вместе с подбором отчётов: какие виды назначить и строки ЕНС единого налога. */
interface PlannedRow {
  check: CpImportRowCheck;
  types: ReportTypeRecord[];
  enRates: AssignmentEnRate[];
}

/** Коды ГКЭД ячеек строки — основной и дополнительные, как их режет проверка. */
const gkedCellCodes = (v: Record<CpImportField, string>) =>
  [v.gked, ...v.gked2.split(/[,;]/)].map((x) => x.trim()).filter(Boolean);

/**
 * Проверка строк (прототип importDlg `check`): правила строки — `checkImportRows`; с подбором отчётов —
 * виды, которые не подходят к режиму или форме собственности (как в форме и «Подборе отчётов»), отчёты
 * для пустой колонки «Виды отчётов» («Обязательно по режиму», «По статусу», «Для всех» — по
 * справочникам окна «Подбор отчётов», со статусами по УГНС) и вопросы о праве на режим по ГКЭД
 * (предупреждение: подтверждается в «Изменить» после загрузки).
 */
async function planImport(
  tx: Tx,
  input: {
    orgId: string;
    subject: AccessSubject;
    body: ContractorImportRequest;
    today: IsoDate;
    t: Translate;
  },
): Promise<PlannedRow[]> {
  const { body, t, today } = input;
  const values = body.rows.map((cells) => importValues(body.map, cells));
  const [data, fee, taken, gked] = await Promise.all([
    contractorImportData(tx),
    feeVisible(tx, input.orgId, input.subject),
    takenInns(
      tx,
      values.map((v) => v.inn),
    ),
    gkedLevels(tx, values.flatMap(gkedCellCodes)),
  ]);
  const checked = checkImportRows(body.map, body.rows, { ...data, takenInns: taken, gked, fee }, t);
  const codes = [
    ...new Set(
      checked.flatMap((r) => [r.draft.gked, ...r.draft.gkedExtra]).filter((c): c is string => !!c),
    ),
  ];
  const [gkDicts, dict, connected] = await Promise.all([
    contractorGkedDicts(tx, codes),
    reportPickDict(tx, codes),
    connectedReportTypes(tx),
  ]);
  const byOffice = new Map<string, string[]>();
  const typeOf = (code: string) => dict.types.find((x) => x.code === code)!;
  const out: PlannedRow[] = [];
  for (const [i, r] of checked.entries()) {
    const d = r.draft;
    let benefits: string[] = [];
    if (d.taxOfficeCode) {
      if (!byOffice.has(d.taxOfficeCode)) {
        const list = await officeBenefits(tx, d.taxOfficeCode);
        byOffice.set(
          d.taxOfficeCode,
          list.map((b) => b.code),
        );
      }
      benefits = byOffice.get(d.taxOfficeCode)!;
    }
    const form = data.forms.find((x) => x.code === d.formCode);
    const regime = data.regimes.find((x) => x.code === d.regimeCode);
    const office = data.offices.find((x) => x.code === d.taxOfficeCode);
    const enRates = defaultSingleTaxRates(
      { gked: d.gked, gkedExtra: d.gkedExtra, benefits, place: office?.region ?? '' },
      gkDicts.rates,
      gkDicts.index,
    );
    const s: PickSubject = {
      form: form ? { code: form.code, declarationFor: form.declarationFor } : null,
      regimes: regime ? [regime] : [],
      singleTax: [],
      benefits,
      bases: [],
      bizSize: 'small',
      gked: d.gked,
      gkedExtra: d.gkedExtra,
      enCodes: enRates.map((e) => e.code),
      connected,
    };
    if (regime && d.gked) {
      const check = gkedCheck(
        {
          gked: d.gked,
          gkedExtra: d.gkedExtra,
          form: s.form,
          regimes: [regime.code],
          benefits,
        },
        gkDicts,
      );
      for (const need of check.confirm) {
        r.warnings.push(
          t('cp.import.warn.regime', {
            ask: need.ask || t('cp.import.warn.regime_ask', { name: need.regimeName }),
            code: need.code,
          }),
        );
      }
    }
    // ОТКЛОНЕНИЕ: docs/deviations.md#А-9 — вид, который не подходит к режиму или форме собственности,
    // — ошибка строки, как в форме создания (прототип назначал его без проверки).
    for (const code of d.typeCodes) {
      const type = typeOf(code);
      const why = typeIncompatibility(type, s, dict.rates, today, t);
      if (why) {
        r.errors.push(
          t('cp.import.err.type_off', { name: type.shortName, why: incompatibilityText(why, t) }),
        );
      }
    }
    let types = d.typeCodes;
    const listed = values[i]!.types.split(',').some((x) => x.trim());
    if (!listed) {
      const pick = reportPick(s, dict, today, t);
      types = [...pick.rec]
        .filter(([, x]) => x.pre && AUTO_SECTIONS.has(x.section))
        .map(([code]) => code);
      if (types.length) {
        r.warnings.push(
          t('cp.import.warn.auto', { list: types.map((c) => typeOf(c).shortName).join(', ') }),
        );
      } else r.errors.push(t('cp.import.err.no_types'));
    }
    out.push({ check: r, types: types.map(typeOf), enRates });
  }
  return out;
}

const rowsOut = (rows: readonly PlannedRow[]) =>
  rows.map((r) => ({ errors: r.check.errors, warnings: r.check.warnings }));

/**
 * Готовые строки — контрагентами (прототип importDlg «ОК»): постоянный, обслуживание с 1-го числа
 * текущего месяца, первый месяц — полностью, стоимость — первая запись журнала тарифов «Загрузка из
 * Excel», статусы по УГНС, отчёты с текущего периода; признаки Соцфонда или вид со взносами — основание
 * «Есть наёмные сотрудники» и тариф по условиям. Возвращает, сколько создано.
 */
async function createRows(
  tx: Tx,
  orgId: string,
  rows: readonly PlannedRow[],
  ctx: { today: IsoDate; t: Translate; texts: Awaited<ReturnType<typeof serverTexts>> },
): Promise<number> {
  const { t, today } = ctx;
  const confirm = (await orgMenuSettings(tx, orgId)).reportConfirm;
  const start = `${today.slice(0, 7)}-01`;
  let created = 0;
  for (const p of rows) {
    if (p.check.errors.length) continue;
    const d = p.check.draft;
    const office = await withOfficeBenefits(
      tx,
      [],
      { from: null, to: d.taxOfficeCode },
      { marked: t('cp.notice.ugns_marked'), dropped: t('cp.notice.ugns_dropped') },
    );
    const sf = await socfundContext(tx, d.gked, d.formCode);
    const codes = p.types.map((x) => x.code);
    const employees =
      Object.keys(d.socfund).length > 0 || codes.some((c) => sf.dict.reportTypes.includes(c));
    const fields: ContractorFields = {
      name: d.name,
      inn: d.inn,
      phone: d.phone,
      kind: 'regular',
      formCode: d.formCode!,
      regimeCode: d.regimeCode,
      regime2Code: null,
      gked: d.gked,
      gkedExtra: d.gkedExtra,
      taxOfficeCode: d.taxOfficeCode,
      bizSize: 'small',
      benefits: withSocfundStatus(office.benefits, sf.dict, false),
      bases: employees ? [EMPLOYEES_BASE] : [],
      responsibleEmployeeId: d.responsibleEmployeeId,
      head: d.head,
      contact: d.contact,
      contractNo: '',
      contractDate: null,
      note: d.note,
      registration: {},
      startDate: start,
      firstMonthMode: 'full',
      feeDay: DEFAULT_FEE_DAY,
      paysTo: 'emp',
      gkedConfirmation: null,
      socfundFlags: {},
      socfundTariff: null,
    };
    const sfSubject = socfundSubjectOf(
      {
        kind: 'regular',
        bases: fields.bases,
        gked: d.gked,
        benefits: fields.benefits.map((b) => b.code),
        flags: d.socfund,
      },
      sf.form,
      codes,
    );
    Object.assign(
      fields,
      socfundPatch(
        { ...sfSubject, flags: {} },
        null,
        { flags: d.socfund },
        sf.dict,
        fields.benefits,
      ),
    );
    const id = await createContractor(
      tx,
      orgId,
      fields,
      d.fee === null
        ? null
        : { amount: d.fee, period: 'M', validFrom: start, note: t('cp.import.tariff_note') },
      { today, reason: t('cp.import.reason') },
    );
    await writeContractorNotes(tx, id, office.notes);
    await createNewReports(
      tx,
      id,
      {
        items: p.types.map((type) => {
          const single = isSingleTaxType(type.code);
          return {
            type,
            rate: single ? null : defaultTypeRate(type),
            enRates: single ? p.enRates : [],
            rateAdditions: [],
          };
        }),
        forced: [],
      },
      { today, confirm, texts: assignmentTexts(ctx.texts) },
    );
    created++;
  }
  return created;
}

export const importCheckRoute = createRoute({
  method: 'post',
  path: '/contractors/import/check',
  tags: ['contractors'],
  summary: 'Загрузка из Excel: «Проверить»',
  middleware: [requirePermission('cpView'), requirePermission('cpImport')] as const,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: ContractorImportRequest } },
    },
  },
  responses: {
    200: {
      description: 'Строки по порядку вставки: ошибки и предупреждения; сколько готово',
      content: { 'application/json': { schema: ContractorImportCheck } },
    },
    400: {
      description: 'Не те колонки, больше 500 строк или ячейка длиннее предела',
      content: error,
    },
    401: noAuth,
    403: noRight,
    ...importRateResponses,
  },
});

export function importCheckHandler(deps: ApiDeps): RouteHandler<typeof importCheckRoute, AppEnv> {
  return async (c) => {
    const body = c.req.valid('json');
    const ctx = orgContextOf(c);
    const subject = subjectOf(c);
    const today = todayOf(deps);
    const t = await translateOf(deps);
    const rows = await withImportSlot(deps, c, () =>
      withOrgContext(deps.db, ctx, (tx) =>
        planImport(tx, { orgId: ctx.orgId, subject, body, today, t }),
      ),
    );
    const out = rowsOut(rows);
    return c.json({ rows: out, ready: importReady(out) }, 200);
  };
}

export const importApplyRoute = createRoute({
  method: 'post',
  path: '/contractors/import',
  tags: ['contractors'],
  summary: 'Загрузка из Excel: «ОК» — создать готовые строки',
  middleware: [requirePermission('cpView'), requirePermission('cpImport')] as const,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: ContractorImportRequest } },
    },
  },
  responses: {
    200: {
      description:
        'Готовые строки созданы одной транзакцией вместе с отчётами; загрузка — в истории (сколько создано и пропущено)',
      content: { 'application/json': { schema: ContractorImportResult } },
    },
    400: {
      description: 'Не те колонки, больше 500 строк или ячейка длиннее предела',
      content: error,
    },
    401: noAuth,
    403: noRight,
    409: {
      description: 'ИНН из списка одновременно добавили в организацию — нужно проверить снова',
      content: error,
    },
    ...importRateResponses,
  },
});

export function importApplyHandler(deps: ApiDeps): RouteHandler<typeof importApplyRoute, AppEnv> {
  return async (c) => {
    const body = c.req.valid('json');
    const ctx = orgContextOf(c);
    const subject = subjectOf(c);
    const today = todayOf(deps);
    const t = await translateOf(deps);
    const texts = await serverTexts(deps);
    const out = await withImportSlot(deps, c, async () => {
      try {
        return await withOrgContext(deps.db, ctx, async (tx) => {
          const rows = await planImport(tx, { orgId: ctx.orgId, subject, body, today, t });
          const created = await createRows(tx, ctx.orgId, rows, { today, t, texts });
          const skipped = rows.length - created;
          // Прототип: запись истории «Загрузка контрагентов: создано N, пропущено M» (ent 'import').
          await writeHistory(tx, {
            entity: 'contractor_import',
            entityId: randomUUID(),
            action: 'import',
            changes: [
              { field: 'created', to: created },
              { field: 'skipped', to: skipped },
            ],
          });
          const list = rowsOut(rows);
          return { rows: list, ready: importReady(list), created, skipped };
        });
      } catch (err) {
        if (uniqueViolation(err) === 'contractors_org_inn_key') {
          apiFail(409, 'cp_import_inn_race', 'ИНН из списка только что добавили — проверьте снова');
        }
        throw err;
      }
    });
    return c.json(out, 200);
  };
}

/** Колонки с подсказкой в шаблоне; у остальных — «текст» (прототип impTemplate `hint`). */
const HINTED = [
  'inn',
  'phone',
  'types',
  'fee',
  'resp',
  'ugns',
  'regime',
  'form',
  'gked',
  'gked2',
  'sfc',
  'sfr',
  'sfp',
  'sfg',
] as const satisfies readonly CpImportField[];
type HintedField = (typeof HINTED)[number];
const isHinted = (k: CpImportField): k is HintedField =>
  (HINTED as readonly CpImportField[]).includes(k);

/** Строка-пример шаблона (прототип impTemplate `ex`): данные, а не тексты экрана. */
const EXAMPLE: Partial<Record<CpImportField, string>> = {
  inn: '01234567890123',
  phone: '+996 555 123 456',
  fee: '15000',
  gked: '69.20.0',
  gked2: '62.01.0, 47.91.0',
};

/**
 * Шаблон (ТЗ «Кнопка «Выгрузить шаблон»»; прототип impTemplate): колонки по порядку, обязательные —
 * название, ИНН, телефон, ответственный и стоимость (если видна плата); строка-пример с логином
 * первого бухгалтера (роль из шаблона «Бухгалтер»), а без бухгалтеров — своим; подсказки со списками
 * видов отчётов, логинов и режимов этой организации; коды ГКЭД — действующие подклассы.
 */
async function templateOf(
  tx: Tx,
  input: { orgId: string; subject: AccessSubject; t: Translate },
): Promise<ContractorImportTemplate> {
  const { t } = input;
  const [data, fee, gked]: [ContractorImportData, boolean, ContractorImportTemplate['gked']] =
    await Promise.all([
      contractorImportData(tx),
      feeVisible(tx, input.orgId, input.subject),
      gkedTemplateRows(tx),
    ]);
  const required = new Set<CpImportField>(['name', 'inn', 'phone', 'resp']);
  if (fee) required.add('fee');
  const resp =
    data.employees.find((e) => e.accountant) ??
    data.employees.find((e) => e.id === input.subject.employeeId);
  const example: Partial<Record<CpImportField, string>> = {
    ...EXAMPLE,
    name: t('cp.import.tpl.ex_name'),
    types: t('cp.import.tpl.ex_types'),
    resp: resp?.login ?? '',
  };
  const lists: Partial<Record<CpImportField, string[]>> = {
    types: data.types.map((x) => x.shortName),
    resp: data.employees.map((e) => e.login),
    regime: data.regimes.map((x) => x.name),
  };
  return {
    columns: CP_IMPORT_FIELDS.filter((k) => k !== 'fee' || fee).map((key) => {
      const hint = t(isHinted(key) ? `cp.import.hint.${key}` : 'cp.import.hint.text');
      const list = lists[key];
      return {
        key,
        title: t(`cp.import.col.${key}`),
        required: required.has(key),
        example: example[key] ?? '',
        hint: list ? `${hint}: ${list.join(', ')}` : hint,
      };
    }),
    gked,
  };
}

export const importTemplatePreviewRoute = createRoute({
  method: 'get',
  path: '/contractors/import/template/preview',
  tags: ['contractors'],
  summary: 'Загрузка из Excel: что будет в шаблоне',
  middleware: [requirePermission('cpView'), requirePermission('cpImport')] as const,
  responses: {
    200: {
      description: 'Колонки с подсказками и строкой-примером, коды ГКЭД',
      content: { 'application/json': { schema: ContractorImportTemplate } },
    },
    401: noAuth,
    403: noRight,
  },
});

export function importTemplatePreviewHandler(
  deps: ApiDeps,
): RouteHandler<typeof importTemplatePreviewRoute, AppEnv> {
  return async (c) => {
    const ctx = orgContextOf(c);
    const subject = subjectOf(c);
    const t = await translateOf(deps);
    const body = await withOrgContext(deps.db, ctx, (tx) =>
      templateOf(tx, { orgId: ctx.orgId, subject, t }),
    );
    return c.json(body, 200);
  };
}

export const importTemplateRoute = createRoute({
  method: 'get',
  path: '/contractors/import/template',
  tags: ['contractors'],
  summary: 'Загрузка из Excel: скачать шаблон .xlsx',
  middleware: [requirePermission('cpView'), requirePermission('cpImport')] as const,
  responses: {
    200: {
      description: 'Шаблон: листы «Контрагенты», «Подсказки» и «Коды ГКЭД»',
      content: xlsxContent,
    },
    401: noAuth,
    403: noRight,
    ...exportRateResponses,
  },
});

export function importTemplateHandler(
  deps: ApiDeps,
): RouteHandler<typeof importTemplateRoute, AppEnv> {
  return async (c) => {
    const ctx = orgContextOf(c);
    const subject = subjectOf(c);
    return withExportSlot(deps, c.get('session')!.userId, async () => {
      const t = await translateOf(deps);
      const tpl = await withOrgContext(deps.db, { ...ctx, kind: 'export' }, (tx) =>
        templateOf(tx, { orgId: ctx.orgId, subject, t }),
      );
      const text = (title: string, width?: number) => ({
        title,
        kind: 'text' as const,
        ...(width ? { width } : {}),
      });
      const file = await buildXlsxBook([
        {
          name: t('cp.import.tpl.sheet_cps'),
          columns: tpl.columns.map((col) => text(col.required ? `${col.title} *` : col.title)),
          rows: [tpl.columns.map((col) => col.example)],
        },
        {
          name: t('cp.import.tpl.sheet_tips'),
          columns: [
            text(t('cp.import.tpl.col'), 26),
            text(t('cp.import.tpl.required'), 14),
            text(t('cp.import.tpl.format'), 100),
          ],
          rows: tpl.columns.map((col) => [
            col.title,
            t(col.required ? 'cp.import.tpl.yes' : 'cp.import.tpl.no'),
            col.hint,
          ]),
        },
        {
          name: t('cp.import.tpl.sheet_gked'),
          columns: [
            text(t('cp.import.tpl.code'), 12),
            text(t('cp.import.tpl.activity'), 90),
            text(t('cp.import.tpl.section'), 10),
          ],
          rows: tpl.gked.map((g) => [g.code, g.name, g.section]),
        },
      ]);
      const name = `${t('cp.import.tpl.file')}.xlsx`;
      return c.body(new Uint8Array(file), 200, {
        'content-type': XLSX_TYPE,
        'content-disposition': `attachment; filename="template.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
        'cache-control': 'no-store',
      });
    });
  };
}
