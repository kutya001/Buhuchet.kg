import {
  BENEFIT_KINDS,
  BIZ_SIZES,
  CALENDAR_DAY_KINDS,
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
 * Справочники платформы для форм и списков организаций (только чтение; задача #20). Ссылки между
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
  /** Виды отчётов с этим основанием. */
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
  gnsCheckedAt: IsoDate.nullable(),
  gnsCheckedBy: z.string(),
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
