import {
  PERMISSION_GROUPS,
  searchText,
  type Feature,
  type PermissionGroupId,
  type PermissionId,
  type RoleLock,
  type Scope,
  type ScopeGroupId,
} from '@buhuchet/domain';

/** Право из справочника «Права ролей»: название и описание под ним. */
export interface CatalogPermission {
  id: PermissionId;
  group: PermissionGroupId;
  name: string;
  description: string;
}

/** Права и область роли в форме. */
export interface PermissionState {
  selected: ReadonlySet<PermissionId>;
  scopes: Readonly<Partial<Record<ScopeGroupId, Scope>>>;
}

/** Почему галочку права менять нельзя; null — можно. */
export type PermissionLockOf = (permission: PermissionId) => RoleLock | null;

/** Группа прав на экране (прототип modules/staff.js, permGroupsHtml). */
export interface PermissionGroupView {
  id: PermissionGroupId;
  /** Право «Просматривать …» группы — подсвечено первым. */
  view: PermissionId | null;
  /** Функция учётной политики группы. */
  feature: Feature | null;
  /** Права под поиском. */
  shown: readonly CatalogPermission[];
  /** «Выбрано N из M» — по всем правам группы, не только найденным. */
  count: number;
  total: number;
  open: boolean;
  /** Модуль выключен в учётной политике: группа серая и по умолчанию свёрнута. */
  off: boolean;
  /** Кнопка группы: «Выбрать все», «Снять все» или её нет (только просмотр, всё закрыто). */
  toggle: 'select' | 'clear' | null;
  /** Область группы; null — у группы её нет. */
  scope: Scope | null;
  /** Область задана правом «Видеть все отчёты и всех контрагентов» — выбора нет. */
  scopeFixed: boolean;
}

/**
 * Область группы в форме (прототип `scopeOf`): право «Видеть все отчёты и всех контрагентов» ставит
 * «Все контрагенты» во всех группах, иначе — сохранённая область, по умолчанию «Свои».
 */
export function formScope(state: PermissionState, group: ScopeGroupId): Scope {
  return state.selected.has('viewAll') ? 'all' : (state.scopes[group] ?? 'own');
}

/**
 * Права, которые меняет «Выбрать все» / «Снять все» (прототип `free`): незакрытые и закрытые только
 * тем, что нет просмотра группы, — «Выбрать все» сначала даёт просмотр. Если и просмотр дать нельзя
 * (своя роль), такие права не в счёт: в прототипе кнопка тогда видна, но ничего не делает.
 */
function freeOf(
  perms: readonly CatalogPermission[],
  view: PermissionId | null,
  lock: PermissionLockOf,
): CatalogPermission[] {
  const viewOpen = view !== null && !lock(view);
  return perms.filter((p) => {
    const why = lock(p.id);
    return !why || (viewOpen && why === 'view_required');
  });
}

/**
 * Группы прав для формы и карточки роли (прототип permGroupsHtml): в порядке меню модулей, «Общие
 * права» последней; поиск — по названию и описанию права, группа без найденных прав не показывается.
 * Группа раскрыта: при поиске — всегда; на телефоне и у выключенного модуля — только если её
 * раскрыли (`toggled`); на ПК — пока её не свернули.
 */
export function permissionGroupsView(o: {
  catalog: readonly CatalogPermission[];
  state: PermissionState;
  lock: PermissionLockOf;
  readOnly: boolean;
  query: string;
  toggled: ReadonlySet<string>;
  phone: boolean;
  feature: (feature: Feature) => boolean;
}): PermissionGroupView[] {
  const q = searchText(o.query.trim());
  return PERMISSION_GROUPS.flatMap((g): PermissionGroupView[] => {
    const perms = o.catalog.filter((p) => p.group === g.id);
    const shown = q
      ? perms.filter((p) => searchText(`${p.name} ${p.description}`).includes(q))
      : perms;
    if (shown.length === 0) return [];
    const off = g.feature !== null && !o.feature(g.feature);
    const free = freeOf(perms, g.view, o.lock);
    const allOn = free.length > 0 && free.every((p) => o.state.selected.has(p.id));
    return [
      {
        id: g.id,
        view: g.view,
        feature: g.feature,
        shown,
        count: perms.filter((p) => o.state.selected.has(p.id)).length,
        total: perms.length,
        open: q ? true : o.phone || off ? o.toggled.has(g.id) : !o.toggled.has(g.id),
        off,
        toggle: o.readOnly || free.length === 0 ? null : allOn ? 'clear' : 'select',
        scope: g.scope ? formScope(o.state, g.id) : null,
        scopeFixed: o.state.selected.has('viewAll'),
      },
    ];
  });
}

/**
 * «Выбрать все» / «Снять все» в группе (прототип permGroupsBind, `data-pall`): «Снять все» снимает
 * незакрытые права группы; «Выбрать все» сначала даёт просмотр группы (если его можно дать), потом —
 * все права, которые после этого открыты. Закрытые права (выдаёт только владелец, своя роль) не
 * меняются.
 */
export function toggleGroup(
  catalog: readonly CatalogPermission[],
  group: PermissionGroupId,
  selected: ReadonlySet<PermissionId>,
  lockWith: (selected: ReadonlySet<PermissionId>) => PermissionLockOf,
  mode: 'select' | 'clear',
): Set<PermissionId> {
  const perms = catalog.filter((p) => p.group === group);
  const view = PERMISSION_GROUPS.find((g) => g.id === group)?.view ?? null;
  // Какие права открыты — по набору до изменения: снятый просмотр не закрывает права той же кнопки.
  const openIn = (set: ReadonlySet<PermissionId>) => {
    const lock = lockWith(set);
    return perms.filter((p) => !lock(p.id)).map((p) => p.id);
  };
  const next = new Set(selected);
  if (mode === 'clear') {
    for (const id of openIn(selected)) next.delete(id);
    return next;
  }
  if (view && !lockWith(selected)(view)) next.add(view);
  for (const id of openIn(new Set(next))) next.add(id);
  return next;
}
