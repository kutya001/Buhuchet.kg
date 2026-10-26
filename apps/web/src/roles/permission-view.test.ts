import {
  PERMISSION_GROUPS,
  PERMISSIONS,
  rolePermissionLock,
  type Feature,
  type PermissionId,
  type RoleEditor,
} from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import {
  formScope,
  permissionGroupsView,
  toggleGroup,
  type CatalogPermission,
  type PermissionState,
} from './permission-view';

// Группы прав в форме и карточке роли (прототип modules/staff.js, permGroupsHtml и permGroupsBind;
// core/org.js, roleLock): порядок, раскрытие на ПК и телефоне, поиск, «Выбрать все» и область.

const catalog: CatalogPermission[] = PERMISSIONS.map(([id, group]) => ({
  id,
  group,
  name: `Право ${id}`,
  description: id === 'tasksAll' ? 'Видит задачи всех сотрудников, ёлки' : `Описание ${id}`,
}));

const OWNER: RoleEditor = { isOwner: true, roleId: 'owner' };
const MANAGER: RoleEditor = { isOwner: false, roleId: 'manager' };
const role = { id: 'acc', isOwner: false };
const lockWith =
  (editor: RoleEditor) => (selected: ReadonlySet<PermissionId>) => (p: PermissionId) =>
    rolePermissionLock(editor, role, p, selected);

const state = (selected: PermissionId[], scopes: PermissionState['scopes'] = {}) => ({
  selected: new Set(selected),
  scopes,
});

const view = (over: Partial<Parameters<typeof permissionGroupsView>[0]> = {}) =>
  permissionGroupsView({
    catalog,
    state: state(['cpView', 'createCp', 'tasksCreate']),
    lock: lockWith(OWNER)(new Set(['cpView', 'createCp', 'tasksCreate'])),
    readOnly: false,
    query: '',
    toggled: new Set(),
    phone: false,
    feature: () => true,
    ...over,
  });

describe('группы прав роли', () => {
  it('в порядке меню модулей, «Общие права» последней; «Выбрано N из M» по всем правам группы', () => {
    const groups = view();
    expect(groups.map((g) => g.id)).toEqual(PERMISSION_GROUPS.map((g) => g.id));
    expect(groups.at(-1)!.id).toBe('common');
    const cps = groups.find((g) => g.id === 'cps')!;
    expect({ count: cps.count, total: cps.total, view: cps.view }).toEqual({
      count: 2,
      total: 9,
      view: 'cpView',
    });
    expect(groups.find((g) => g.id === 'tasks')).toMatchObject({ count: 1, total: 3 });
  });

  it('на ПК группы раскрыты, пока их не свернули; на телефоне свёрнуты, пока не раскрыли', () => {
    expect(view().every((g) => g.open)).toBe(true);
    expect(view({ toggled: new Set(['cps']) }).find((g) => g.id === 'cps')!.open).toBe(false);
    expect(view({ phone: true }).some((g) => g.open)).toBe(false);
    const opened = view({ phone: true, toggled: new Set(['tasks']) });
    expect(opened.filter((g) => g.open).map((g) => g.id)).toEqual(['tasks']);
  });

  it('модуль выключен в учётной политике — группа серая и свёрнута, пока её не раскрыли', () => {
    const feature = (f: Feature) => f !== 'projects';
    const projects = view({ feature }).find((g) => g.id === 'projects')!;
    expect(projects).toMatchObject({ off: true, open: false, feature: 'projects' });
    expect(
      view({ feature, toggled: new Set(['projects']) }).find((g) => g.id === 'projects')!.open,
    ).toBe(true);
    expect(view({ feature }).find((g) => g.id === 'cps')!.off).toBe(false);
  });

  it('поиск — по названию и описанию права, «ё» = «е»; группы с найденным раскрыты, без найденного скрыты', () => {
    const found = view({ query: '  ЕЛКИ ', phone: true });
    expect(found.map((g) => g.id)).toEqual(['tasks']);
    expect(found[0]!.open).toBe(true);
    expect(found[0]!.shown.map((p) => p.id)).toEqual(['tasksAll']);
    // Счётчик — по всей группе, а не по найденному.
    expect(found[0]!.total).toBe(3);
    expect(view({ query: 'Право cpView' }).map((g) => g.id)).toEqual(['cps']);
    expect(view({ query: 'нет такого права' })).toEqual([]);
  });

  it('кнопка группы: «Выбрать все», когда выбраны не все открытые права, иначе «Снять все»; в карточке её нет', () => {
    const tasks = (selected: PermissionId[]) =>
      view({ state: state(selected), lock: lockWith(OWNER)(new Set(selected)) }).find(
        (g) => g.id === 'tasks',
      )!.toggle;
    expect(tasks(['tasksCreate'])).toBe('select');
    expect(tasks(['tasksCreate', 'tasksAll', 'tasksConfirm'])).toBe('clear');
    expect(view({ readOnly: true }).every((g) => g.toggle === null)).toBe(true);
    // «Моя организация» — только у владельца: открытых прав нет, кнопки нет.
    expect(view().find((g) => g.id === 'org')!.toggle).toBeNull();
  });

  it('у своей роли все галочки закрыты — кнопок «Выбрать все» нет', () => {
    const own = { id: 'manager', isOwner: false };
    const groups = view({ lock: (p) => rolePermissionLock(MANAGER, own, p, new Set()) });
    expect(groups.every((g) => g.toggle === null)).toBe(true);
  });

  it('область группы: сохранённая или «Свои»; право «Видеть все…» ставит «Все контрагенты» без выбора', () => {
    const groups = view({ state: state(['cpView'], { cps: 'all' }) });
    expect(groups.find((g) => g.id === 'cps')).toMatchObject({ scope: 'all', scopeFixed: false });
    expect(groups.find((g) => g.id === 'reports')).toMatchObject({ scope: 'own' });
    expect(groups.find((g) => g.id === 'tasks')!.scope).toBeNull();
    const all = state(['viewAll'], { cps: 'own' });
    expect(formScope(all, 'cps')).toBe('all');
    expect(view({ state: all }).find((g) => g.id === 'kpi')).toMatchObject({
      scope: 'all',
      scopeFixed: true,
    });
  });
});

describe('«Выбрать все» и «Снять все» в группе', () => {
  it('«Выбрать все» в «Задачах» отмечает три права', () => {
    const next = toggleGroup(catalog, 'tasks', new Set(), lockWith(OWNER), 'select');
    expect([...next].sort()).toEqual(['tasksAll', 'tasksConfirm', 'tasksCreate']);
  });

  it('«Выбрать все» сначала даёт просмотр группы, потом остальные права', () => {
    const next = toggleGroup(catalog, 'reports', new Set(['cpView']), lockWith(OWNER), 'select');
    expect([...next].sort()).toEqual(
      ['cpView', 'repView', 'assign', 'repDue', 'changeStatus', 'changeSum', 'repConfirm'].sort(),
    );
  });

  it('не владельцу — без прав, которые выдаёт только владелец, и без «Моей организации»', () => {
    const next = toggleGroup(catalog, 'cps', new Set(), lockWith(MANAGER), 'select');
    expect(next.has('cpView')).toBe(true);
    expect(next.has('archiveRest')).toBe(false);
    expect(next.size).toBe(8);
    expect(toggleGroup(catalog, 'org', new Set(), lockWith(OWNER), 'select').size).toBe(0);
  });

  it('«Снять все» снимает и просмотр, и права группы; закрытые для вас остаются', () => {
    const all = new Set<PermissionId>(['cpView', 'createCp', 'archiveRest', 'repView']);
    expect([...toggleGroup(catalog, 'cps', all, lockWith(OWNER), 'clear')]).toEqual(['repView']);
    expect([...toggleGroup(catalog, 'cps', all, lockWith(MANAGER), 'clear')].sort()).toEqual([
      'archiveRest',
      'repView',
    ]);
  });
});
