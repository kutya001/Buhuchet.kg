import {
  BENEFIT_KINDS,
  BIZ_SIZES,
  CALENDAR_DAY_KINDS,
  DECLARATION_FOR,
  DUE_FROM,
  PAYER_KINDS,
  PICK_GROUPS,
  REGIME_KINDS,
  REPORT_ACTS,
  REPORT_KINDS,
  REPORT_PERIODS,
} from '@buhuchet/domain';
import { z } from 'zod';
import { IsoDate } from './common';

/*
 * Справочники платформы для форм и списков организаций (только чтение; задачи #20, 2.01). Ссылки между
 * справочниками — постоянными кодами. Правка — Админка → «Справочники платформы» (поток Д).
 */

/** `?all=true` — со отключёнными значениями (уже созданные записи, Админка); без него — только действующие. */
export const DictListQuery = z.object({
  all: z.enum(['true', 'false']).optional(),
});
export type DictListQuery = z.infer<typeof DictListQuery>;

const Codes = z.array(z.string());

export const GkedRule = z.object({
  in: Codes,
  ex: Codes,
  warn: Codes.optional(),
  ip: Codes.optional(),
  ipEx: Codes.optional(),
  itd: Codes.optional(),
  main: z.boolean().optional(),
  hint: z.boolean().optional(),
  note: z.string().optional(),
  verify: z.string().optional(),
  who: z.string().optional(),
  strict: z.string().optional(),
});

/** «Органы». */
export const Authority = z.object({
  code: z.string(),
  name: z.string(),
  /** «Что это и что туда сдают». */
  description: z.string(),
  contacts: z.array(z.object({ label: z.string(), value: z.string() })),
  hours: z.string(),
  site: z.string(),
  contactsNote: z.string(),
  active: z.boolean(),
});
export const Authorities = z.object({ items: z.array(Authority) });
export type Authority = z.infer<typeof Authority>;

/** «Режимы налогообложения». */
export const TaxRegime = z.object({
  code: z.string(),
  name: z.string(),
  fullName: z.string(),
  kind: z.enum(REGIME_KINDS),
  frees: z.string(),
  who: z.string(),
  how: z.string(),
  combines: z.string(),
  accountantNote: z.string(),
  article: z.string(),
  gked: GkedRule.nullable(),
  active: z.boolean(),
});
export const TaxRegimes = z.object({ items: z.array(TaxRegime) });
export type TaxRegime = z.infer<typeof TaxRegime>;

/** «Основания для отчётов». */
export const ReportBase = z.object({
  code: z.string(),
  name: z.string(),
  description: z.string(),
  note: z.string(),
  /** Виды отчётов с этим основанием (без `all=true` — только действующие). */
  reportTypes: Codes,
  active: z.boolean(),
});
export const ReportBases = z.object({ items: z.array(ReportBase) });
export type ReportBase = z.infer<typeof ReportBase>;

/** «Налоговые органы (УГНС)». */
export const TaxOffice = z.object({
  code: z.string(),
  name: z.string(),
  shortName: z.string(),
  /** Код ГНС; null — ещё не сверен. */
  gnsCode: z.string().nullable(),
  region: z.string(),
  verify: z.boolean(),
  note: z.string(),
  active: z.boolean(),
});
export const TaxOffices = z.object({ items: z.array(TaxOffice) });
export type TaxOffice = z.infer<typeof TaxOffice>;

const Day = z.number().int();

/** «Виды отчётов». */
export const ReportType = z.object({
  code: z.string(),
  name: z.string(),
  shortName: z.string(),
  formCode: z.string(),
  statIndex: z.string(),
  respondents: z.string(),
  authorityCode: z.string(),
  period: z.enum(REPORT_PERIODS),
  dueDay: Day,
  dueAfter: Day.nullable(),
  dueMonth: Day.nullable(),
  dueFrom: z.enum(DUE_FROM),
  payDay: Day.nullable(),
  payAfter: Day.nullable(),
  payMonth: Day.nullable(),
  paySchedule: z.array(z.tuple([Day, Day])).nullable(),
  shiftToWorkday: z.boolean(),
  skipQuarters: z.array(Day),
  oneOff: z.boolean(),
  eventLabel: z.string(),
  periodPerAssignment: z.boolean(),
  act: z.enum(REPORT_ACTS),
  payments: z.array(z.object({ name: z.string(), authority: z.string(), kbk: z.string() })),
  kind: z.enum(REPORT_KINDS),
  payer: z.enum(PAYER_KINDS),
  regimes: Codes,
  notForRegimes: Codes,
  bases: Codes,
  rates: z.array(z.string()),
  rateAdditions: z.array(
    z.object({
      k: z.string(),
      name: z.string(),
      short: z.string().optional(),
      rate: z.string(),
      rateCashless: z.string().optional(),
      rateCash: z.string().optional(),
      art: z.string().optional(),
    }),
  ),
  notForEnRates: Codes,
  bizSizes: z.array(z.enum(BIZ_SIZES)),
  pickGroup: z.enum(PICK_GROUPS),
  preselect: z.boolean(),
  choiceNote: z.string(),
  pickHint: z.string(),
  description: z.string(),
  clientNote: z.string(),
  article: z.string(),
  note: z.string(),
  source: z.string(),
  verify: z.boolean(),
  verifyNote: z.string(),
  gked: GkedRule.nullable(),
  active: z.boolean(),
});
export const ReportTypes = z.object({ items: z.array(ReportType) });
export type ReportType = z.infer<typeof ReportType>;

/** «Налоговые льготы и особые статусы». */
export const TaxBenefit = z.object({
  code: z.string(),
  name: z.string(),
  kind: z.enum(BENEFIT_KINDS),
  gives: z.string(),
  article: z.string(),
  payer: z.enum(PAYER_KINDS),
  conditions: z.string(),
  confirmation: z.string(),
  combines: z.string(),
  term: z.string(),
  validUntil: IsoDate.nullable(),
  verify: z.boolean(),
  verifyNote: z.string(),
  gked: GkedRule.nullable(),
  gkedMainOnly: z.boolean(),
  taxCode: z.string(),
  suggest: z
    .object({
      basis: z.string().optional(),
      preselect: z.boolean().optional(),
      notWith: Codes.optional(),
      warnForms: Codes.optional(),
      note: z.string().optional(),
    })
    .nullable(),
  /** Добавляет виды отчётов (без `all=true` — только действующие). */
  adds: Codes,
  removes: Codes,
  /** «Ставится по УГНС». */
  taxOffices: Codes,
  /** «Меняет сроки». */
  dueRules: z.array(
    z.object({
      reportType: z.string(),
      dueDay: Day.nullable(),
      dueAfter: Day.nullable(),
      dueMonth: Day.nullable(),
      payDay: Day.nullable(),
      payAfter: Day.nullable(),
    }),
  ),
  active: z.boolean(),
});
export const TaxBenefits = z.object({ items: z.array(TaxBenefit) });
export type TaxBenefit = z.infer<typeof TaxBenefit>;

/** «Формы собственности». */
export const OwnershipForm = z.object({
  code: z.string(),
  name: z.string(),
  fullName: z.string(),
  shortName: z.string(),
  /** «Для ЕНД»: ЕНД для организаций или для ИП. */
  declarationFor: z.enum(DECLARATION_FOR),
  note: z.string(),
  active: z.boolean(),
});
export const OwnershipForms = z.object({ items: z.array(OwnershipForm) });
export type OwnershipForm = z.infer<typeof OwnershipForm>;

/** «Ставки единого налога»: строку целиком (код ЕНС) хранит назначение ЕН контрагента. */
export const SingleTaxRate = z.object({
  code: z.string(),
  activity: z.string(),
  rate: z.string(),
  /** Безналичная и наличная ставки; пусто — одна ставка на всю выручку. */
  rateCashless: z.string(),
  rateCash: z.string(),
  conditions: z.string(),
  article: z.string(),
  explanation: z.string(),
  gked: GkedRule.nullable(),
  /** «Добавляется к ставкам»: коды строк ЕНС; пусто — самостоятельная ставка. */
  addsTo: Codes,
  active: z.boolean(),
});
export const SingleTaxRates = z.object({ items: z.array(SingleTaxRate) });
export type SingleTaxRate = z.infer<typeof SingleTaxRate>;

/** «Причины изменения срока отчёта». */
export const DueChangeReason = z.object({
  code: z.string(),
  name: z.string(),
  /** «Пояснение». */
  note: z.string(),
  active: z.boolean(),
});
export const DueChangeReasons = z.object({ items: z.array(DueChangeReason) });
export type DueChangeReason = z.infer<typeof DueChangeReason>;

/** Год производственного календаря. */
export const CalendarQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
});
export type CalendarQuery = z.infer<typeof CalendarQuery>;

/** Праздники, переносы и рабочие субботы года (выходные — по дню недели, их в ответе нет). */
export const ProductionCalendarYear = z.object({
  year: z.number().int(),
  days: z.array(
    z.object({
      date: IsoDate,
      kind: z.enum(CALENDAR_DAY_KINDS),
      name: z.string(),
      everyYear: z.boolean(),
    }),
  ),
});
export type ProductionCalendarYear = z.infer<typeof ProductionCalendarYear>;

/** Тариф по фондам у налога со страховыми взносами: общий тариф, доли, раскладка, предельная база. */
export const TaxTariff = z.object({
  name: z.string(),
  total: z.string(),
  who: z.string(),
  since: z.string(),
  law: z.string(),
  verify: z.boolean(),
  verifyNote: z.string(),
  parts: z.array(
    z.object({
      payer: z.string(),
      rate: z.string(),
      funds: z.array(z.object({ fund: z.string(), rate: z.string() })),
    }),
  ),
  cap: z.object({ amount: z.string(), since: z.string(), note: z.string() }).nullable(),
});

/**
 * Форма просмотра налога (ТЗ «Форма просмотра налога»; прототип taxGuideHtml): «Что это», «Кто платит и
 * с чего», «Ставки», «Сроки», «Связи», «Освобождения», «Важно знать», «Как проверить», «Статья НК»,
 * «Источники». Связи — кодами: льготы, основания, виды отчётов, ГКЭД.
 */
const TaxGuide = z.object({
  about: z.string(),
  payers: z.string(),
  base: z.string(),
  rates: z.array(z.object({ rate: z.string(), when: z.string() })),
  tariffs: z.array(TaxTariff),
  exceptions27: z.array(z.string()),
  admin: z.array(z.object({ organ: z.string(), what: z.string() })),
  period: z.string(),
  reportDue: z.string(),
  payDue: z.string(),
  pays: z.string(),
  form: z.string(),
  organ: z.string(),
  art: z.string(),
  reportTypes: Codes,
  regimesPay: z.string(),
  regimesFree: z.string(),
  benefits: Codes,
  bases: Codes,
  gked: Codes,
  gkedExclude: Codes,
  exemptions: z.string(),
  notes: z.array(z.string()),
  check: z
    .object({
      title: z.string(),
      ways: z.array(z.object({ name: z.string(), steps: z.array(z.string()) })),
    })
    .nullable(),
  verifyNote: z.string(),
  sources: z.array(z.object({ title: z.string(), url: z.string() })),
});

/** «Налоги и ставки»: налог или платёж и его форма просмотра. */
export const Tax = z.object({
  code: z.string(),
  name: z.string(),
  group: z.string(),
  level: z.string(),
  organ: z.string(),
  period: z.string(),
  payers: z.string(),
  base: z.string(),
  rates: z.string(),
  reportDue: z.string(),
  payDue: z.string(),
  form: z.string(),
  art: z.string(),
  reportTypes: Codes,
  verify: z.boolean(),
  active: z.boolean(),
  guide: TaxGuide,
});
/** Налоги и названия кодов ГКЭД из их связей («Виды деятельности (ГКЭД)», «Кроме ГКЭД»). */
export const Taxes = z.object({
  items: z.array(Tax),
  gkedNames: z.record(z.string(), z.string()),
});
export type Taxes = z.infer<typeof Taxes>;
export type Tax = z.infer<typeof Tax>;
