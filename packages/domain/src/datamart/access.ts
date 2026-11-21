import { hasPermission, scopeOf, type AccessSubject } from '../roles/access';
import {
  PERMISSION_GROUPS,
  PERMISSION_IDS,
  SCOPE_GROUPS,
  type Feature,
  type PermissionId,
  type ScopeGroupId,
} from '../roles/permissions';
import type { DM_MODULES, DM_TEMPLATE_STATES } from './datamart';
import { dmOwnScope } from './scope';

/*
 * Кому из сотрудников организации виден шаблон «Витрины данных» (доработки 20.11.2026: Витрина данных,
 * блок 2, пункт 6) — прототип v155 `modules/vitrina.js` `dmSee`. Доступ организации к шаблону
 * («Все организации» или «Выбранные») проверяет база (RLS `dm_templates_org_read`), здесь — права
 * сотрудника. Тем же правилом выбираются шаблоны окна «Новый API-токен».
 */

export type DmModule = (typeof DM_MODULES)[number];
export type DmTemplateState = (typeof DM_TEMPLATE_STATES)[number];

/** Что нужно знать о шаблоне для правила видимости. */
export interface DmTemplateSight {
  audience: 'org' | 'admin';
  state: DmTemplateState;
  module: DmModule | null;
  /** Ещё одно обязательное право из 40 (`need_permission`). */
  needPermission: string | null;
  /** Столбцы шаблона: есть ли «Контрагент» для области «Свои» (`contractor` или вид `cp`). */
  columns: unknown;
}

/** Есть ли у шаблона столбец «Контрагент» (прототип `cpCol`). */
export function dmHasContractorColumn(columns: unknown): boolean {
  return (
    Array.isArray(columns) &&
    columns.some(
      (c) =>
        typeof c === 'object' &&
        c !== null &&
        ((c as { contractor?: unknown }).contractor === true ||
          (c as { type?: unknown }).type === 'cp'),
    )
  );
}

const GROUP_OF = new Map<string, (typeof PERMISSION_GROUPS)[number]>(
  PERMISSION_GROUPS.map((g) => [g.id, g]),
);
const isScopeGroup = (id: string): id is ScopeGroupId =>
  (SCOPE_GROUPS as readonly string[]).includes(id);
/** Дополнительное право шаблона: неизвестный код не открывает шаблон никому, кроме владельца. */
const isPermission = (id: string, subject: AccessSubject): boolean =>
  (PERMISSION_IDS as readonly string[]).includes(id)
    ? hasPermission(subject, id as PermissionId)
    : subject.isOwner;

/**
 * Виден ли шаблон сотруднику (прототип `dmSee`): «Для организаций», не черновик и не выключен; функция
 * модуля шаблона включена (у «Видеть плату за обслуживание» — ещё функция «Плата за обслуживание»);
 * есть просмотр модуля и дополнительное право шаблона; шаблон без столбца «Контрагент» (итоги по всей
 * организации) — только при «Все контрагенты» в группе прав модуля (владельцу — всегда), у модуля без
 * области («Сотрудники») — в группе «Контрагенты», как его отбор «Свои» (`dmOwnScope`).
 */
export function dmTemplateSeen(
  t: DmTemplateSight,
  subject: AccessSubject,
  features: Readonly<Partial<Record<Feature, boolean>>>,
): boolean {
  if (t.audience !== 'org' || t.state === 'draft' || t.state === 'off' || !t.module) return false;
  const group = GROUP_OF.get(t.module);
  if (group?.feature && features[group.feature] !== true) return false;
  if (t.needPermission === 'fee' && features.fee !== true) return false;
  if (group?.view && !hasPermission(subject, group.view)) return false;
  if (t.needPermission && !isPermission(t.needPermission, subject)) return false;
  // ОТКЛОНЕНИЕ: docs/deviations.md#О-95 — модуль без области без «Контрагента» — по «Контрагентам».
  return (
    dmHasContractorColumn(t.columns) ||
    scopeOf(subject, isScopeGroup(t.module) ? t.module : 'cps') === 'all'
  );
}

/**
 * Можно ли выпустить или перевыпустить токен к шаблону (строже прототипа `dmNewDlg`): токен отдаёт
 * строки всей организации, как владельцу, — область «Свои контрагенты» по токену не действует
 * (организация не сотрудник). Поэтому шаблон должен быть виден сотруднику (`dmTemplateSeen`) и «Вывод»
 * не отбирал бы ему строки по «Свои» (`dmOwnScope` — то же правило, что у «Показать»: у модуля с
 * областью — группа прав модуля, у «Сотрудников» со столбцом «Контрагент» — группа «Контрагенты»):
 * иначе сотрудник с областью «Свои» вынес бы через токен строки чужих контрагентов.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Т-26
export function dmTemplateTokenable(
  t: DmTemplateSight,
  subject: AccessSubject,
  features: Readonly<Partial<Record<Feature, boolean>>>,
): boolean {
  return dmTemplateSeen(t, subject, features) && !dmOwnScope(t.module, subject, t.columns);
}
