/**
 * Значения полей справочников платформы, на которые опираются контрагенты и отчёты (ТЗ «Справочники
 * платформы»; refDB.json). Коды — как в прототипе: по ним сверяются наполнение, база и схемы API.
 */

/** Периодичность вида отчёта: месяц, квартал, полугодие, год (справочник «Периодичность отчётов»). */
export const REPORT_PERIODS = ['M', 'Q', 'H', 'Y'] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

/** «Что нужно сделать»: «Сдача», «Уплата», «Сдача + уплата». */
export const REPORT_ACTS = ['sub', 'pay', 'both'] as const;
export type ReportAct = (typeof REPORT_ACTS)[number];

/** Тип вида отчёта: режимный, сквозной, внутренняя отчётность для самого контрагента. */
export const REPORT_KINDS = ['regime', 'cross', 'internal'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

/** «Для кого» / «Кто может применять»: организации, ИП, все. */
export const PAYER_KINDS = ['org', 'ip', 'all'] as const;
export type PayerKind = (typeof PAYER_KINDS)[number];

/**
 * «Группа подбора» вида в «Рекомендуемых»: обязательно по режиму, по статусу, по основанию, для всех,
 * по желанию, не предлагается.
 */
export const PICK_GROUPS = ['regime', 'status', 'basis', 'all', 'optional', 'disabled'] as const;
export type PickGroup = (typeof PICK_GROUPS)[number];

/** Размер бизнеса (ст. 4 НК КР): малый, средний, крупный. */
export const BIZ_SIZES = ['small', 'medium', 'large'] as const;
export type BizSize = (typeof BIZ_SIZES)[number];

/** От чего считается срок: от конца периода или от его начала. */
export const DUE_FROM = ['end', 'start'] as const;
export type DueFrom = (typeof DUE_FROM)[number];

/** Связь вида отчёта с режимом: «Применимые режимы» или «Не для режимов» (правило подбора). */
export const REGIME_RELATIONS = ['applies', 'excludes'] as const;
export type RegimeRelation = (typeof REGIME_RELATIONS)[number];

/** Тип режима налогообложения: общий или специальный. */
export const REGIME_KINDS = ['general', 'special'] as const;
export type RegimeKind = (typeof REGIME_KINDS)[number];

/** Тип записи «Налоговых льгот и особых статусов»: льгота или статус. */
export const BENEFIT_KINDS = ['benefit', 'status'] as const;
export type BenefitKind = (typeof BENEFIT_KINDS)[number];

/** «Для ЕНД» у формы собственности: контрагенту доступна ЕНД для организаций или ЕНД для ИП. */
export const DECLARATION_FOR = ['org', 'ip'] as const;
export type DeclarationFor = (typeof DECLARATION_FOR)[number];

/** Что делает статус с видом отчёта: добавляет его или делает ненужным. */
export const BENEFIT_EFFECTS = ['adds', 'removes'] as const;
export type BenefitEffect = (typeof BENEFIT_EFFECTS)[number];

/** «Тип» банковского провайдера: банк или электронный кошелёк. */
export const BANK_KINDS = ['bank', 'wallet'] as const;
export type BankKind = (typeof BANK_KINDS)[number];

/** День срока 31 и больше — последний день месяца (прототип ruleDate; «до последнего дня»). */
export const LAST_DAY_OF_MONTH = 31;

/**
 * «Виды деятельности (ГКЭД)» у режима, льготы или вида отчёта (прототип core/gked.js): коды или начала
 * кодов; пустой `in` — все виды деятельности. Признаки правила служебные, их меняет только наполнение.
 */
export interface GkedRule {
  in: string[];
  /** «Кроме». */
  ex: string[];
  /** «Предупреждать при ГКЭД». */
  warn?: string[];
  /** Перечни патента: «Для ИП», «Кроме» для ИП, «Для ИТД». */
  ip?: string[];
  ipEx?: string[];
  itd?: string[];
  /** Проверяется только основной ГКЭД. */
  main?: boolean;
  /** «Только подсказка»: совпадение подсказывает, несовпадение ни на что не влияет. */
  hint?: boolean;
  /** Примечание к перечню; `verify` — что ещё сверить. */
  note?: string;
  verify?: string;
  who?: string;
  strict?: string;
}

/** «Что уплачивается» у вида отчёта: платёж, получатель (код органа) и код бюджетной классификации. */
export interface ReportPayment {
  name: string;
  authority: string;
  kbk: string;
}

/** «Добавляемые строки ставок» налога с продаж: в назначении — галочки под основной ставкой. */
export interface RateAddition {
  k: string;
  name: string;
  short?: string;
  rate: string;
  rateCashless?: string;
  rateCash?: string;
  art?: string;
}

/** Контакт органа: подпись и телефон. */
export interface AuthorityContact {
  label: string;
  value: string;
}

/**
 * Подсказка статуса в окне «Льготы и особые статусы» (прототип reference.js, `suggest`): при каком
 * основании предлагать, отмечать ли заранее, с какими статусами не совмещается, при каких формах
 * собственности предупреждать. Управления ГНС, по которым статус ставится сам, — отдельная связь.
 */
export interface BenefitSuggest {
  basis?: string;
  preselect?: boolean;
  notWith?: string[];
  warnForms?: string[];
  note?: string;
}
