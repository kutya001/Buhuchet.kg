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
  };
}
