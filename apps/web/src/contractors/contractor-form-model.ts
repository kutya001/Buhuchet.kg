import {
  addMonths,
  FEE_DAY_MAX,
  FEE_DAY_MIN,
  firstMonthFee,
  formatSom,
  formatSomWithUnit,
  innProblem,
  joinPhone,
  monthLabel,
  monthLabelGen,
  parseSom,
  splitPhone,
  type BizSize,
  type ContractorKind,
  type FirstMonthMode,
  type PhoneCodeOption,
  type TariffPeriod,
  type ContractorRegistration,
  type Translate,
  type UiTextKey,
} from '@buhuchet/domain';
import type {
  Contractor,
  CreateContractorRequest,
  UpdateContractorRequest,
} from '@buhuchet/shared';
import type { BenefitChoice } from './benefit-pick';
import type { GkedValue } from './gked-pick';
import { EMPTY_RATES, reportsOf, type EnRow, type RateState } from './rate-rows';
import {
  registrationDraftOf,
  registrationErrors,
  registrationOf,
  type RegistrationDraft,
} from './registration-fields';
import { socfundDraftOf, socfundRequestOf, type SocfundDraft } from './socfund-fields';

/*
 * Черновик формы создания контрагента (прототип modules/contractor-form.js, addCpDlg): поля по разделам
 * «Реквизиты», «Режим и статусы», «Отчёты и обслуживание», проверки полей до отправки (те же тексты, что
 * у сервера), отметки разделов в оглавлении, подсказка о начислении за первый месяц и запрос
 * `POST /api/contractors`. Сервер проверяет всё заново.
 */

export type FormSection = 1 | 2 | 3;
export const FORM_SECTIONS: readonly FormSection[] = [1, 2, 3];

/** Поля с ошибкой под собой: ключ — как `details.field` ответа сервера. */
export type FormField =
  | 'name'
  | 'inn'
  | 'phone'
  | 'gked'
  | 'formCode'
  | 'okpo'
  | 'email'
  | 'regimeCode'
  | 'regime2Code'
  | 'benefits'
  | 'socfund.reason'
  | 'reports'
  | 'responsibleEmployeeId'
  | 'tariff'
  | 'startDate'
  | 'contractDate';

/** Раздел поля: при ошибке на телефоне форма переходит на его шаг. */
export const FIELD_SECTION: Readonly<Record<FormField, FormSection>> = {
  name: 1,
  inn: 1,
  phone: 1,
  gked: 1,
  formCode: 1,
  okpo: 1,
  email: 1,
  regimeCode: 2,
  regime2Code: 2,
  benefits: 2,
  'socfund.reason': 2,
  reports: 3,
  responsibleEmployeeId: 3,
  tariff: 3,
  startDate: 3,
  contractDate: 3,
};

/** Поле ответа сервера → поле формы (у регистрационных данных — `registration.okpo`). */
export function formFieldOf(field: unknown): FormField | null {
  if (typeof field !== 'string') return null;
  const key = field.replace(/^registration\./, '');
  if (key === 'gkedExtra') return 'gked';
  if (key === 'firstMonthMode' || key === 'feeDay') return 'tariff';
  return key in FIELD_SECTION ? (key as FormField) : null;
}

export interface ContractorDraft {
  kind: ContractorKind;
  name: string;
  inn: string;
  phone: { cc: string; local: string };
  gked: GkedValue | null;
  gkedExtra: GkedValue[];
  formCode: string;
  taxOfficeCode: string;
  head: string;
  contact: string;
  regOpen: boolean;
  registration: RegistrationDraft;
  regimeCode: string;
  regime2Code: string;
  bizSize: BizSize;
  benefits: BenefitChoice[];
  bases: string[];
  socfund: SocfundDraft;
  /** Выбранные отчёты; пока выбор не меняли (`picked`), отмечены подобранные сами. */
  reports: { sel: string[]; picked: boolean };
  /** Обязательные, снятые после подтверждения «Снять обязательный отчёт?» (в истории — почему обязателен). */
  forced: readonly string[];
  rates: RateState;
  responsibleId: string;
  startDate: string;
  fee: string;
  period: TariffPeriod;
  firstMonth: FirstMonthMode;
  contractNo: string;
  contractDate: string;
  note: string;
}

/**
 * Пустой черновик (прототип addCpDlg, `st`): «Единый налог» и ОсОО, если они действуют в справочниках,
 * малый бизнес, сегодняшняя дата начала, ответственный по умолчанию, «Пропорционально дням».
 */
export function newDraft(o: {
  kind: ContractorKind;
  today: string;
  formCode: string;
  regimeCode: string;
  responsibleId: string;
  phoneCc: string;
}): ContractorDraft {
  return {
    kind: o.kind,
    name: '',
    inn: '',
    phone: { cc: o.phoneCc, local: '' },
    gked: null,
    gkedExtra: [],
    formCode: o.formCode,
    taxOfficeCode: '',
    head: '',
    contact: '',
    regOpen: false,
    registration: registrationDraftOf(),
    regimeCode: o.regimeCode,
    regime2Code: '',
    bizSize: 'small',
    benefits: [],
    bases: [],
    socfund: socfundDraftOf(),
    reports: { sel: [], picked: false },
    forced: [],
    rates: EMPTY_RATES,
    responsibleId: o.responsibleId,
    startDate: o.today,
    fee: '',
    period: 'M',
    firstMonth: 'prorate',
    contractNo: '',
    contractDate: '',
    note: '',
  };
}

/** Выбранные отчёты: пока выбор не меняли — подобранные сами (прототип: `if(reg&&!st.picked)st.sel=…`). */
export const chosenReports = (d: ContractorDraft, auto: readonly string[] | null): string[] =>
  d.kind !== 'regular' ? [] : d.reports.picked ? d.reports.sel : [...(auto ?? [])];

/** Видно ли поле стоимости: функция включена, есть право и контрагент постоянный. */
export interface FeeAccess {
  feeOn: boolean;
  fee: boolean;
}
export const feeFieldShown = (d: ContractorDraft, a: FeeAccess) =>
  a.feeOn && a.fee && d.kind === 'regular';

export interface DraftCheckContext {
  codes: readonly PhoneCodeOption[];
  /** Выбранные отчёты (`chosenReports`). */
  reports: readonly string[];
  fee: FeeAccess;
  /** Первая ошибка сверки с ГКЭД, из-за которой режим нельзя применять (`block` ответа сервера). */
  block: string | null;
  /** Нужна причина ручного выбора тарифа Соцфонда (ответ `socfund-check`). */
  socfundReason: boolean;
}

/**
 * Ошибки полей (прототип addCpDlg: `checks`, `regCheck`, `sfValid`): текст словаря или готовый текст
 * сверки с ГКЭД. Дубль ИНН проверяет сервер — ответ ложится под поле так же.
 */
export function draftErrors(
  d: ContractorDraft,
  cx: DraftCheckContext,
  t: Translate,
): Partial<Record<FormField, string>> {
  const out: Partial<Record<FormField, string>> = {};
  if (!d.name.trim()) out.name = t('err.name_empty');
  const inn = innProblem(d.inn.trim());
  if (inn) out.inn = t(`err.${inn}`);
  const phone = joinPhone(d.phone.cc, d.phone.local, cx.codes);
  if (!phone.phone) out.phone = t('err.phone_empty');
  else if (phone.missing > 0) out.phone = t('err.phone_digits', { n: phone.need });
  if (!d.gked) out.gked = t('err.gked_required');
  if (!d.formCode) out.formCode = t('err.form_required');
  // Регистрационные данные уходят и при свёрнутом блоке, поэтому проверяются всегда (в прототипе — только
  // при раскрытом, и неверный код ОКПО из свёрнутого блока сохранялся).
  for (const [k, key] of Object.entries(registrationErrors(d.registration))) {
    out[k as 'okpo' | 'email'] = t(key);
  }
  if (cx.block) out.regimeCode = cx.block;
  if (cx.socfundReason && d.kind === 'regular' && !d.socfund.reason.trim()) {
    out['socfund.reason'] = t('err.socfund_reason_required');
  }
  if (d.kind === 'regular' && !cx.reports.length) out.reports = t('err.reports_required');
  if (!d.responsibleId) out.responsibleEmployeeId = t('err.responsible_required');
  if (feeFieldShown(d, cx.fee)) {
    const fee = parseSom(d.fee);
    if (fee === null || fee < 0) out.tariff = t('err.tariff_required');
  }
  return out;
}

/**
 * Сколько обязательных полей раздела не заполнено — для отметки «осталось: N» (прототип cfMarks,
 * `need`): пустые поля, а не неверные.
 */
export function leftInSection(d: ContractorDraft, sec: FormSection, cx: DraftCheckContext): number {
  const empty: boolean[] =
    sec === 1
      ? [!d.name.trim(), !d.inn.trim(), !d.phone.local.replace(/\D/g, ''), !d.gked, !d.formCode]
      : sec === 3
        ? [
            d.kind === 'regular' && !cx.reports.length,
            !d.responsibleId,
            feeFieldShown(d, cx.fee) && !d.fee.trim(),
          ]
        : [];
  return empty.filter(Boolean).length;
}

/** Ошибки по разделам — для отметки «ошибок: N». */
export const errorsInSection = (errors: Partial<Record<FormField, string>>, sec: FormSection) =>
  Object.keys(errors).filter((k) => FIELD_SECTION[k as FormField] === sec).length;

const parts = (iso: string) => iso.split('-').map(Number) as [number, number, number];

/**
 * Подсказка под стоимостью (прототип addCpDlg, `pro`): сколько начислится за месяц начала
 * обслуживания. Пусто — сумма или дата не введены.
 */
export function prorationText(
  d: Pick<ContractorDraft, 'fee' | 'startDate' | 'period' | 'firstMonth'>,
  t: Translate,
): string {
  const amount = parseSom(d.fee);
  if (amount === null || amount < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(d.startDate)) return '';
  const month = d.startDate.slice(0, 7);
  const sum = formatSomWithUnit(amount);
  if (d.period === 'Y') {
    return t('cp.form.pro.year', {
      sum,
      month: monthLabel(month),
      month_name: t(`month.${parts(d.startDate)[1]}` as UiTextKey),
    });
  }
  const fee = firstMonthFee(amount, d.startDate, d.firstMonth);
  if (fee.kind === 'full') return t('cp.form.pro.full', { month: monthLabel(month), sum });
  if (fee.kind === 'next') {
    return t('cp.form.pro.next', {
      month: monthLabel(month),
      next: monthLabelGen(addMonths(month, 1)),
      sum,
    });
  }
  return t('cp.form.pro.prorate', {
    month: monthLabel(month),
    amount: formatSom(fee.full),
    left: fee.left,
    days: fee.days,
    sum: formatSomWithUnit(fee.amount),
  });
}

/** Значения справочников и решения окон, которых нет в самом черновике. */
export interface CreateExtras {
  codes: readonly PhoneCodeOption[];
  fee: FeeAccess;
  reports: readonly string[];
  /** Строки ЕНС по ГКЭД — пока их не меняли в «Ставках налога». */
  enDefaults: readonly EnRow[];
  gkedConfirm: boolean;
  socfundConfirm: boolean;
}

/** Запрос `POST /api/contractors` (прототип addCpDlg, сохранение `c`). */
export function createRequestOf(d: ContractorDraft, x: CreateExtras): CreateContractorRequest {
  const regular = d.kind === 'regular';
  const showFee = feeFieldShown(d, x.fee);
  const registration: ContractorRegistration = registrationOf(d.registration);
  const amount = showFee ? parseSom(d.fee) : null;
  const reports = regular ? reportsOf(x.reports, d.rates, x.enDefaults) : undefined;
  return {
    kind: d.kind,
    name: d.name.trim(),
    inn: d.inn.trim(),
    phone: joinPhone(d.phone.cc, d.phone.local, x.codes).phone ?? '',
    formCode: d.formCode,
    regimeCode: d.regimeCode || null,
    regime2Code: (d.regimeCode && d.regime2Code) || null,
    gked: d.gked?.code ?? null,
    gkedExtra: d.gkedExtra.map((g) => g.code),
    taxOfficeCode: d.taxOfficeCode || null,
    bizSize: d.bizSize,
    benefits: d.benefits.map((b) => ({ ...b })),
    bases: regular ? [...d.bases] : [],
    responsibleEmployeeId: d.responsibleId,
    head: d.head.trim(),
    contact: d.contact.trim(),
    contractNo: d.contractNo.trim(),
    contractDate: d.contractDate || null,
    note: d.note.trim(),
    registration,
    startDate: d.startDate,
    ...(showFee
      ? {
          tariff: { amount: amount ?? 0, period: d.period },
          firstMonthMode: d.period === 'M' ? d.firstMonth : 'full',
        }
      : {}),
    ...(regular ? { socfund: socfundRequestOf(d.socfund) } : {}),
    ...(reports ? { reports } : {}),
    reportsForced: regular ? d.forced.filter((code) => !x.reports.includes(code)) : [],
    ...(x.gkedConfirm ? { gkedConfirm: true } : {}),
    ...(x.socfundConfirm ? { socfundConfirm: true } : {}),
  };
}

/** Черновик «Изменить» (прототип editCpDlg, `st`): без типа обслуживания, отчётов, тарифа и ответственного. */
export interface EditDraft {
  name: string;
  inn: string;
  phone: { cc: string; local: string };
  gked: GkedValue | null;
  gkedExtra: GkedValue[];
  formCode: string;
  taxOfficeCode: string;
  regimeCode: string;
  regime2Code: string;
  bizSize: BizSize;
  benefits: BenefitChoice[];
  bases: string[];
  socfund: SocfundDraft;
  head: string;
  contact: string;
  contractNo: string;
  contractDate: string;
  feeDay: string;
  note: string;
  registration: RegistrationDraft;
}

export function editDraftOf(c: Contractor, codes: readonly PhoneCodeOption[]): EditDraft {
  return {
    name: c.name,
    inn: c.inn,
    phone: splitPhone(c.phone, codes),
    gked: c.gked,
    gkedExtra: c.gkedExtra.map((g) => ({ ...g })),
    formCode: c.form.code,
    taxOfficeCode: c.taxOffice?.code ?? '',
    regimeCode: c.regime?.code ?? '',
    regime2Code: c.regime2?.code ?? '',
    bizSize: c.bizSize,
    benefits: c.benefits.map((b) => ({ code: b.code, validFrom: b.validFrom, validTo: b.validTo })),
    bases: c.bases.map((b) => b.code),
    socfund: {
      ...socfundDraftOf(c.socfund.flags, c.socfund.tariff?.manual ? c.socfund.tariff.id : ''),
      reason: c.socfund.tariff?.reason ?? '',
    },
    head: c.head,
    contact: c.contact,
    contractNo: c.contractNo,
    contractDate: c.contractDate ?? '',
    feeDay: c.feeDay === null ? '' : String(c.feeDay),
    note: c.note,
    registration: registrationDraftOf(c.registration),
  };
}

/** Ошибки «Изменить» (прототип editCpDlg, `ok`): те же тексты, у ГКЭД — «Укажите основной вид деятельности (ГКЭД)». */
export function editErrors(
  d: EditDraft,
  cx: Pick<DraftCheckContext, 'codes' | 'block' | 'socfundReason'> & { feeDay: boolean },
  t: Translate,
): Partial<Record<FormField | 'feeDay', string>> {
  const out: Partial<Record<FormField | 'feeDay', string>> = {};
  if (!d.name.trim()) out.name = t('err.name_empty');
  const inn = innProblem(d.inn.trim());
  if (inn) out.inn = t(`err.${inn}`);
  const phone = joinPhone(d.phone.cc, d.phone.local, cx.codes);
  if (!phone.phone) out.phone = t('err.phone_empty');
  else if (phone.missing > 0) out.phone = t('err.phone_digits', { n: phone.need });
  if (cx.feeDay) {
    const day = Number(d.feeDay);
    if (!/^\d+$/.test(d.feeDay.trim()) || day < FEE_DAY_MIN || day > FEE_DAY_MAX) {
      out.feeDay = t('err.fee_day');
    }
  }
  if (!d.gked) out.gked = t('err.gked_required.edit');
  if (cx.block) out.regimeCode = cx.block;
  for (const [k, key] of Object.entries(registrationErrors(d.registration))) {
    out[k as 'okpo' | 'email'] = t(key);
  }
  if (cx.socfundReason && !d.socfund.reason.trim()) {
    out['socfund.reason'] = t('err.socfund_reason_required');
  }
  return out;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Что изменилось в «Изменить» (прототип editCpDlg, `ch`): только изменённые поля; признаки и выбор
 * тарифа Соцфонда — если их меняли. Пусто — «Изменений нет».
 */
export function updatePatchOf(
  before: EditDraft,
  d: EditDraft,
  x: { codes: readonly PhoneCodeOption[]; feeDay: boolean; socfund: boolean },
): Omit<UpdateContractorRequest, 'version'> {
  const out: Omit<UpdateContractorRequest, 'version'> = {};
  const text = (k: 'name' | 'inn' | 'head' | 'contact' | 'contractNo' | 'note') => {
    if (d[k].trim() !== before[k].trim()) out[k] = d[k].trim();
  };
  text('name');
  text('inn');
  const phone = joinPhone(d.phone.cc, d.phone.local, x.codes).phone ?? '';
  if (phone !== (joinPhone(before.phone.cc, before.phone.local, x.codes).phone ?? '')) {
    out.phone = phone;
  }
  if (d.formCode !== before.formCode) out.formCode = d.formCode;
  if (d.regimeCode !== before.regimeCode) out.regimeCode = d.regimeCode || null;
  const regime2 = (d.regimeCode && d.regime2Code) || '';
  if (regime2 !== before.regime2Code) out.regime2Code = regime2 || null;
  if ((d.gked?.code ?? '') !== (before.gked?.code ?? '')) out.gked = d.gked?.code ?? null;
  const extra = d.gkedExtra.map((g) => g.code);
  if (
    !same(
      extra,
      before.gkedExtra.map((g) => g.code),
    )
  )
    out.gkedExtra = extra;
  if (d.taxOfficeCode !== before.taxOfficeCode) out.taxOfficeCode = d.taxOfficeCode || null;
  if (d.bizSize !== before.bizSize) out.bizSize = d.bizSize;
  // При смене УГНС список уходит всегда: статусы по УГНС форма уже поставила или сняла, и сервер берёт
  // список как есть (снятый вручную не вернётся).
  if (!same(d.benefits, before.benefits) || 'taxOfficeCode' in out) {
    out.benefits = d.benefits.map((b) => ({ ...b }));
  }
  if (!same([...d.bases].sort(), [...before.bases].sort())) out.bases = [...d.bases];
  text('head');
  text('contact');
  text('contractNo');
  if (d.contractDate !== before.contractDate) out.contractDate = d.contractDate || null;
  if (x.feeDay && d.feeDay.trim() !== before.feeDay) out.feeDay = Number(d.feeDay);
  text('note');
  const registration = registrationOf(d.registration);
  if (!same(registration, registrationOf(before.registration))) out.registration = registration;
  if (
    x.socfund &&
    (!same(d.socfund.flags, before.socfund.flags) ||
      (d.socfund.touched && d.socfund.tariff !== before.socfund.tariff) ||
      d.socfund.reason.trim() !== before.socfund.reason.trim())
  ) {
    // Все четыре признака в черновике есть всегда: запрос подходит и под выходной тип схемы.
    out.socfund = socfundRequestOf(d.socfund) as UpdateContractorRequest['socfund'];
  }
  return out;
}
