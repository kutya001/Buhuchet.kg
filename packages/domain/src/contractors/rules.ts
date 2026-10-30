/*
 * Правила данных контрагента (ТЗ «Контрагенты» → «Регистрация контрагентов», «Обязательные поля»,
 * «Необязательные поля», «Закрепление контрагентов за сотрудниками», «Контрагента нельзя удалить…»;
 * прототип modules/contractor-form.js, addCpDlg и editCpDlg, modules/contractors.js, cpActions).
 */

/** Тип обслуживания: постоянное (отчёты и тариф) или разовое (только разовые услуги и проекты). */
export const CONTRACTOR_KINDS = ['regular', 'oneoff'] as const;
export type ContractorKind = (typeof CONTRACTOR_KINDS)[number];

/** Начисление за первый неполный месяц: пропорционально дням, полный месяц, со следующего месяца. */
export const FIRST_MONTH_MODES = ['prorate', 'full', 'next'] as const;
export type FirstMonthMode = (typeof FIRST_MONTH_MODES)[number];

/** Периодичность тарифа обслуживания: в месяц или в год. */
export const TARIFF_PERIODS = ['M', 'Y'] as const;
export type TariffPeriod = (typeof TARIFF_PERIODS)[number];

/**
 * Статус обслуживания — шаги шкалы `service` (`STATUS_SCALE_DEFS`): «Обслуживается», «Приостановлен»,
 * «В архиве». Новый контрагент обслуживается; переходы и периоды обслуживания — задача 2.12.
 */
export const SERVICE_STATUSES = ['active', 'paused', 'archived'] as const;
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

/**
 * Регистрационные данные (ТЗ «Необязательные поля» → «Реквизиты из регистрационных документов»;
 * прототип contractor-regdocs.js, REG_F): хранятся только заполненные.
 */
export interface ContractorRegistration {
  /** Полное официальное наименование. */
  fullName?: string;
  regNo?: string;
  okpo?: string;
  /** Юридический адрес. */
  address?: string;
  email?: string;
  /** Дата первичной регистрации. */
  regDate?: string;
  /** Дата последней перерегистрации. */
  reRegDate?: string;
  /** Количество учредителей. */
  founders?: number;
  /** Иностранное участие: есть или нет. */
  foreign?: 'yes' | 'no';
}

/**
 * Подтверждение права на режим по ГКЭД, как оно хранится у контрагента: набор данных
 * (`gkedSignature`), кто подтвердил (сотрудник), дата по Бишкеку и вопрос, на который ответили «нет».
 */
export interface ContractorGkedConfirmation {
  sig: string;
  employeeId: string;
  at: string;
  ask: string;
}

/** Пределы длины текстовых полей: длиннее не бывает, а строка без предела — путь забить базу. */
export const CONTRACTOR_TEXT_MAX = {
  name: 300,
  person: 200,
  contractNo: 50,
  note: 2000,
  registration: 500,
  /** Причина ручного выбора тарифа Соцфонда. */
  socfundReason: 500,
} as const;

/** День оплаты обслуживания в месяце: с 1-го по 28-е (прототип editCpDlg: «Число от 1 до 28»). */
export const FEE_DAY_MIN = 1;
export const FEE_DAY_MAX = 28;
/** День оплаты по умолчанию (прототип addCpDlg: feeDay 10). */
export const DEFAULT_FEE_DAY = 10;

/** Форма собственности новой записи в форме создания (прототип addCpDlg: `form:'ОсОО'`). */
export const NEW_CONTRACTOR_FORM = 'ФС-01';

/** Начисление за месяц начала обслуживания — для подсказки формы (прототип addCpDlg, pro). */
export type FirstMonthFee =
  | { kind: 'full'; amount: number }
  | { kind: 'prorate'; amount: number; full: number; left: number; days: number }
  | { kind: 'next'; amount: number };

/**
 * Сколько начислится за месяц начала обслуживания при ставке «в месяц» (прототип core/org.js: с 1-го
 * числа — полная ставка; «Пропорционально дням» — ставка × оставшиеся дни / дни месяца, до целого сома;
 * «Со следующего месяца» — ничего, полная ставка со следующего). Суммы — в тыйынах.
 */
export function firstMonthFee(
  amount: number,
  startDate: string,
  mode: FirstMonthMode,
): FirstMonthFee {
  const [y, m, d] = startDate.split('-').map(Number) as [number, number, number];
  if (d === 1 || mode === 'full') return { kind: 'full', amount };
  if (mode === 'next') return { kind: 'next', amount };
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const left = days - d + 1;
  return {
    kind: 'prorate',
    amount: Math.round(((amount / 100) * left) / days) * 100,
    full: amount,
    left,
    days,
  };
}

export const CONTRACTOR_PROBLEMS = [
  'inn_format',
  'inn_start',
  'gked_required',
  'gked_not_subclass',
  'gked_inactive',
  'gked_extra_main',
  'regime2_without_regime',
  'regime2_same',
  'benefit_dates',
  'tariff_required',
  'responsible_required',
  'responsible_inactive',
  'value_inactive',
  'okpo_format',
  'email_format',
] as const;
export type ContractorProblem = (typeof CONTRACTOR_PROBLEMS)[number];

/** Тексты отказов (прототип addCpDlg и editCpDlg; ТЗ «Регистрация контрагентов»). */
export const CONTRACTOR_MESSAGES: Record<ContractorProblem, string> = {
  inn_format: 'ИНН — ровно 14 цифр',
  inn_start: 'ИНН в КР начинается с 0, 1 или 2',
  gked_required: 'Выберите основной вид деятельности',
  gked_not_subclass: 'Выберите код нижнего уровня — подкласс',
  gked_inactive: 'Код больше не действует: выберите другой',
  gked_extra_main: 'Основной вид деятельности не повторяется в дополнительных',
  regime2_without_regime: 'Дополнительный режим — только вместе с основным',
  regime2_same: 'Дополнительный режим совпадает с основным',
  benefit_dates: '«Действует по» раньше, чем «Действует с»',
  tariff_required: 'Введите сумму, 0 — допустимо',
  responsible_required: 'Выберите ответственного',
  responsible_inactive: 'Сотрудник заблокирован — выберите другого',
  value_inactive: 'Значение отключено в справочнике платформы — выберите другое',
  okpo_format: 'Код ОКПО — 8 цифр',
  email_format: 'Проверьте адрес почты',
};

/**
 * ИНН (ТЗ: «в КР — 14 цифр и у организаций, и у ИП, первая цифра 0, 1 или 2»; прототип addCpDlg):
 * null — подходит.
 */
export function innProblem(inn: string): 'inn_format' | 'inn_start' | null {
  if (!/^\d{14}$/.test(inn)) return 'inn_format';
  if (!/^[0-2]/.test(inn)) return 'inn_start';
  return null;
}

/** Найденный контрагент с тем же ИНН. */
export interface InnDuplicate {
  name: string;
  archived: boolean;
}

/**
 * «Такой ИНН уже есть: ОсОО «…»» (ТЗ: дубль ищется среди всех контрагентов организации, включая
 * архив; прототип addCpDlg и editCpDlg): при создании у архивного — подсказка вернуть его из архива.
 */
export function innDuplicateMessage(found: InnDuplicate, mode: 'create' | 'edit'): string {
  const archived = !found.archived
    ? ''
    : mode === 'create'
      ? ' (в архиве — верните его из архива, а не создавайте заново)'
      : ' (в архиве)';
  return `Такой ИНН уже есть: ${found.name}${archived}`;
}

/** Что есть по контрагенту: отчёты, деньги (операции и оплаты обслуживания), проекты и услуги. */
export interface ContractorUsage {
  reports: number;
  money: number;
  projects: number;
}

export const CONTRACTOR_DELETE_REFUSALS = ['has_reports', 'has_money', 'has_projects'] as const;
export type ContractorDeleteRefusal = (typeof CONTRACTOR_DELETE_REFUSALS)[number];

/** Причина, почему пункт «Удалить» неактивен (прототип cpActions). */
export const CONTRACTOR_DELETE_MESSAGES: Record<ContractorDeleteRefusal, string> = {
  has_reports: 'По контрагенту есть отчёты — его можно только отправить в архив',
  has_money: 'По контрагенту есть деньги — его можно только отправить в архив',
  has_projects: 'По контрагенту есть проекты или услуги — его можно только отправить в архив',
};

/**
 * Можно ли удалить контрагента (ТЗ: «только для контрагента, по которому ещё нет отчётов, денег и
 * проектов»); null — можно. Отчёты проверяются первыми, как в прототипе.
 */
export function contractorDeleteRefusal(usage: ContractorUsage): ContractorDeleteRefusal | null {
  if (usage.reports > 0) return 'has_reports';
  if (usage.money > 0) return 'has_money';
  if (usage.projects > 0) return 'has_projects';
  return null;
}

/** Льгота или статус контрагента со сроком действия. */
export interface ContractorBenefitInput {
  code: string;
  validFrom: string | null;
  validTo: string | null;
}

/** Поля формы, которые проверяются вместе (ТЗ «Необязательные поля»; прототип addCpDlg, editCpDlg). */
export interface ContractorFieldsInput {
  gked: string | null;
  gkedExtra: readonly string[];
  regimeCode: string | null;
  regime2Code: string | null;
  benefits: readonly ContractorBenefitInput[];
  registration?: Pick<ContractorRegistration, 'okpo' | 'email'>;
}

/** Отказ по полю: поле формы и что не так. */
export interface ContractorFieldProblem {
  field: string;
  problem: ContractorProblem;
}

/**
 * Проверки полей, общие для создания и изменения: основной ГКЭД обязателен и не повторяется в
 * дополнительных; дополнительный режим — только с основным и не тот же; «Действует по» не раньше
 * «Действует с»; ОКПО — 8 цифр, почта — с «@» и доменом. Пустой список — всё подходит.
 */
export function contractorFieldProblems(input: ContractorFieldsInput): ContractorFieldProblem[] {
  const out: ContractorFieldProblem[] = [];
  if (!input.gked) out.push({ field: 'gked', problem: 'gked_required' });
  else if (input.gkedExtra.includes(input.gked)) {
    out.push({ field: 'gkedExtra', problem: 'gked_extra_main' });
  }
  if (input.regime2Code && !input.regimeCode) {
    out.push({ field: 'regime2Code', problem: 'regime2_without_regime' });
  } else if (input.regime2Code && input.regime2Code === input.regimeCode) {
    out.push({ field: 'regime2Code', problem: 'regime2_same' });
  }
  if (input.benefits.some((b) => b.validFrom && b.validTo && b.validTo < b.validFrom)) {
    out.push({ field: 'benefits', problem: 'benefit_dates' });
  }
  const okpo = input.registration?.okpo ?? '';
  if (okpo && !/^\d{8}$/.test(okpo))
    out.push({ field: 'registration.okpo', problem: 'okpo_format' });
  const email = input.registration?.email ?? '';
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    out.push({ field: 'registration.email', problem: 'email_format' });
  }
  return out;
}

/**
 * «№ 160/24 от 16.07.2024» прототипа → номер и дата договора (прототип editCpDlg разбирает так же):
 * «—» и пусто — договора нет; «Без номера от 01.02.2026» — только дата.
 */
export function parseContract(text: string): { no: string; date: string | null } {
  const s = text.trim();
  const m = /^(?:№\s*(\S+)|Без номера)(?:\s+от\s+(\d\d)\.(\d\d)\.(\d{4}))?$/.exec(s);
  if (!m) return { no: s === '—' ? '' : s, date: null };
  return { no: m[1] ?? '', date: m[2] ? `${m[4]}-${m[3]}-${m[2]}` : null };
}

/**
 * Статусы «Ставится по УГНС» при выборе или смене УГНС (ТЗ «Окно «Льготы и особые статусы»»; прототип
 * ugAuto и ugDrop): отмечаются статусы, которые ставит новое УГНС, а снимаются те, что ставит прежнее и
 * не ставит новое; поставленные вручную при другом УГНС не трогаются.
 */
export function officeBenefitChanges(
  current: readonly string[],
  byOldOffice: readonly string[],
  byNewOffice: readonly string[],
): { add: string[]; drop: string[] } {
  const keep = new Set(byNewOffice);
  return {
    add: byNewOffice.filter((code) => !current.includes(code)),
    drop: byOldOffice.filter((code) => current.includes(code) && !keep.has(code)),
  };
}
