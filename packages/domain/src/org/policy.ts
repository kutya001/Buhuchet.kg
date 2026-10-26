import { FEATURES, type Feature } from '../roles/permissions';

/** Учётная политика организации (ТЗ «Моя организация» → «Учётная политика»; таблица org_settings). */
export interface OrgPolicy {
  features: Record<Feature, boolean>;
  /** Напоминать за N дней до срока; в день срока — всегда. */
  remindDays: number[];
  overdueRepeat: boolean;
  /** Время сводки, ЧЧ:ММ по часовому поясу организации. */
  digestTime: string;
  timezone: string;
  /** Через сколько дней напоминать о неподтверждённой сдаче. */
  confirmWaitDays: number;
  taskConfirm: boolean;
  reportConfirm: boolean;
  /** «Сдан» только после оплаты (действует при включённом «Учёте оплаты налогов»). */
  payBeforeSubmit: boolean;
  /** Разделы страницы контрагента по ссылке для всех контрагентов (при включённой `cppage`). */
  pageSections: PageSection[];
}

/** Функции, включённые у новой организации; остальные включаются в учётной политике. */
const ENABLED_FOR_NEW_ORG: readonly Feature[] = ['tasks', 'calendar', 'telegram', 'files'];

/** Учётная политика новой организации — как TemDB.json прототипа. */
export function defaultOrgPolicy(): OrgPolicy {
  return {
    features: Object.fromEntries(
      FEATURES.map((f) => [f, ENABLED_FOR_NEW_ORG.includes(f)]),
    ) as Record<Feature, boolean>,
    remindDays: [7, 3],
    overdueRepeat: true,
    digestTime: '09:00',
    timezone: 'Asia/Bishkek',
    confirmWaitDays: 3,
    taskConfirm: true,
    reportConfirm: true,
    payBeforeSubmit: true,
    pageSections: [...PAGE_SECTIONS],
  };
}

/** Названия функций в учётной политике (прототип core/org.js, FEATURES). */
export const FEATURE_TITLES: Record<Feature, string> = {
  tasks: 'Задачи',
  calendar: 'Календарь отчётов',
  fee: 'Плата за обслуживание',
  taxpay: 'Учёт оплаты налогов',
  accounts: 'Виртуальные счета и бонусы',
  telegram: 'Напоминания в Telegram',
  files: 'Файлы в карточках',
  finops: 'Финансовые операции по контрагентам',
  projects: 'Проекты контрагентов',
  indicators: 'Показатели контрагентов',
  cppage: 'Страница контрагента по ссылке',
};

/** Функции, которые работают только вместе с другими (прототип core/org.js, FEATURES[3]). */
export const FEATURE_REQUIRES: Readonly<Partial<Record<Feature, readonly Feature[]>>> = {
  accounts: ['taxpay'],
};

/** Почему нельзя так включить и выключить функции. */
export interface FeatureChangeProblem {
  /** feature_required_by — выключают функцию, которая нужна включённой; feature_requires — наоборот. */
  code: 'feature_required_by' | 'feature_requires';
  /** Функция, которую нужно сначала выключить или включить. */
  feature: Feature;
  message: string;
}

/**
 * Можно ли перейти от одного набора функций к другому (ТЗ: «Если функция нужна другой, включённой
 * функции, система не даёт её отключить и объясняет почему»). Тексты — как во всплывающих сообщениях
 * прототипа (modules/org.js, renderOrg → policy). Проверяется итоговый набор, поэтому опросник может
 * включить функцию и то, что ей нужно, одним сохранением.
 */
export function featureChangeProblem(
  before: Readonly<Record<Feature, boolean>>,
  after: Readonly<Record<Feature, boolean>>,
): FeatureChangeProblem | null {
  for (const feature of FEATURES) {
    if (!after[feature]) continue;
    for (const needed of FEATURE_REQUIRES[feature] ?? []) {
      if (after[needed]) continue;
      if (before[feature] && before[needed]) {
        return {
          code: 'feature_required_by',
          feature,
          message: `Сначала отключите «${FEATURE_TITLES[feature]}» — она работает только вместе с этой функцией`,
        };
      }
      return {
        code: 'feature_requires',
        feature: needed,
        message: `Сначала включите «${FEATURE_TITLES[needed]}»`,
      };
    }
  }
  return null;
}

/** Напоминания о сроках по умолчанию: за сколько дней, от 1 до 60 (прототип: поле «+ день»). */
export const REMIND_DAY_MAX = 60;
export const REMIND_DAYS_MESSAGE = `От 1 до ${REMIND_DAY_MAX} дней`;

/** Набор дней напоминаний: целые от 1 до 60. В день срока напоминание приходит всегда, его здесь нет. */
export function isValidRemindDays(days: readonly number[]): boolean {
  return days.every((d) => Number.isInteger(d) && d >= 1 && d <= REMIND_DAY_MAX);
}

/** Набор дней как в прототипе: без повторов, от большего к меньшему («за 7, 3 дн.»). */
export function normalizeRemindDays(days: readonly number[]): number[] {
  return [...new Set(days)].sort((a, b) => b - a);
}

/** Напомнить о неподтверждённой сдаче через N дней: от 1 до 30 (прототип: поле «pol-wd»). */
export const CONFIRM_WAIT_DAYS_MAX = 30;
export const CONFIRM_WAIT_DAYS_MESSAGE = `От 1 до ${CONFIRM_WAIT_DAYS_MAX} дней`;

export function isValidConfirmWaitDays(days: number): boolean {
  return Number.isInteger(days) && days >= 1 && days <= CONFIRM_WAIT_DAYS_MAX;
}

/** Часовые пояса на вкладке «Настройки» (прототип modules/org.js, st-tz). */
export const ORG_TIMEZONES = [
  { id: 'Asia/Bishkek', label: 'Asia/Bishkek (UTC+6)' },
  { id: 'Asia/Almaty', label: 'Asia/Almaty (UTC+5)' },
  { id: 'Asia/Tashkent', label: 'Asia/Tashkent (UTC+5)' },
  { id: 'Asia/Dushanbe', label: 'Asia/Dushanbe (UTC+5)' },
  { id: 'Europe/Moscow', label: 'Europe/Moscow (UTC+3)' },
] as const;
export type OrgTimezone = (typeof ORG_TIMEZONES)[number]['id'];
export const ORG_TIMEZONE_IDS = ORG_TIMEZONES.map((t) => t.id) as OrgTimezone[];

/** Время еженедельной сводки — ЧЧ:ММ. */
export function isDigestTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/**
 * Разделы страницы контрагента по ссылке (прототип modules/cp-page.js, PG_SECS); у раздела с
 * функцией он виден, только когда функция включена.
 */
export const PAGE_SECTIONS = ['pay', 'reports', 'money', 'fee', 'kpi', 'contacts'] as const;
export type PageSection = (typeof PAGE_SECTIONS)[number];

export const PAGE_SECTION_TITLES: Record<PageSection, string> = {
  pay: 'Как оплатить',
  reports: 'Отчёты',
  money: 'Деньги на налоги',
  fee: 'Оплата за обслуживание',
  kpi: 'Показатели',
  contacts: 'Контакты',
};

export const PAGE_SECTION_FEATURE: Readonly<Partial<Record<PageSection, Feature>>> = {
  money: 'taxpay',
  fee: 'fee',
  kpi: 'indicators',
};

/** Разделы в порядке страницы, без повторов (прототип: ORG.pageSec после переключения). */
export function normalizePageSections(sections: readonly PageSection[]): PageSection[] {
  return PAGE_SECTIONS.filter((s) => sections.includes(s));
}
