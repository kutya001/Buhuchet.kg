import { hasPermission, type AccessSubject } from '../roles/access';
import type { Feature, PermissionId } from '../roles/permissions';

/**
 * Модули меню организации по порядку (прототип core/registry.js, BIZ): функция учётной политики, без
 * которой модуль выключен, и право, без которого он скрыт. «Главная», «Справочники», «Моя
 * организация» и «База знаний» видны всем (ТЗ: «модули групп без права просмотра видны всем»).
 */
export const MENU_MODULES = [
  { id: 'home', feature: null, permission: null },
  { id: 'cps', feature: null, permission: 'cpView' },
  { id: 'reports', feature: null, permission: 'repView' },
  { id: 'fin', feature: 'finops', permission: 'finView' },
  { id: 'projects', feature: 'projects', permission: 'projView' },
  { id: 'kpi', feature: 'indicators', permission: 'kpiView' },
  { id: 'tasks', feature: 'tasks', permission: null },
  { id: 'files', feature: 'files', permission: 'filesView' },
  { id: 'staff', feature: null, permission: 'staffView' },
  { id: 'dicts', feature: null, permission: null },
  { id: 'org', feature: null, permission: null },
  { id: 'kb', feature: null, permission: null },
] as const satisfies readonly {
  id: string;
  feature: Feature | null;
  permission: PermissionId | null;
}[];

export type BusinessModuleId = (typeof MENU_MODULES)[number]['id'];

/**
 * Модули Админки по порядку (прототип core/registry.js, ADM). Администратору платформы видны все:
 * прав в организации у него нет.
 */
export const ADMIN_MENU_MODULES = [
  'accounts',
  'orgs',
  'pdicts',
  'l10n',
  'kb',
  'kbadm',
  'tg',
] as const;

export type AdminModuleId = (typeof ADMIN_MENU_MODULES)[number];

/** Модуль меню — организации или Админки («База знаний» есть в обоих). */
export type MenuModuleId = BusinessModuleId | AdminModuleId;

/** Все модули меню без повторов: организации, затем Админки. */
export const MENU_MODULE_IDS: readonly MenuModuleId[] = [
  ...new Set<MenuModuleId>([...MENU_MODULES.map((m) => m.id), ...ADMIN_MENU_MODULES]),
];

/**
 * Модули, которые сотрудник видит в меню (прототип core/registry.js, mods): включена функция модуля и
 * есть его право. «Финансовые операции» видны ещё и только тому, кому есть что в них делать: учёт
 * оплаты налогов с правом «Учёт денег и оплата налогов», плата за обслуживание с правом «Видеть плату
 * за обслуживание» или право «Вести проекты и разовые услуги» (прототип modules/services.js, taxVis и
 * moneyVis).
 * Выключенный в учётной политике модуль пропадает из меню у всех, данные его не удаляются.
 */
export function menuModules(
  subject: AccessSubject,
  features: Readonly<Partial<Record<Feature, boolean>>>,
): BusinessModuleId[] {
  const on = (f: Feature) => features[f] === true;
  const can = (p: PermissionId) => hasPermission(subject, p);
  const finUseful = (on('taxpay') && can('money')) || (on('fee') && can('fee')) || can('projects');
  return MENU_MODULES.filter(
    (m) =>
      (m.feature === null || on(m.feature)) &&
      (m.permission === null || can(m.permission)) &&
      (m.id !== 'fin' || finUseful),
  ).map((m) => m.id);
}
