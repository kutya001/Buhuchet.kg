import { describe, expect, it } from 'vitest';
import type { AccessSubject } from '../roles/access';
import { FEATURES, type Feature, type PermissionId } from '../roles/permissions';
import { menuModules } from './modules';

const all = Object.fromEntries(FEATURES.map((f) => [f, true])) as Record<Feature, boolean>;
const without = (...off: Feature[]) => ({
  ...all,
  ...Object.fromEntries(off.map((f) => [f, false])),
});
const owner: AccessSubject = {
  employeeId: 'e1',
  isOwner: true,
  permissions: new Set(),
  scopes: {},
};
const role = (...permissions: PermissionId[]): AccessSubject => ({
  employeeId: 'e2',
  isOwner: false,
  permissions: new Set(permissions),
  scopes: {},
});

describe('модули в меню — как mods() прототипа', () => {
  it('владелец при всех функциях видит все модули по порядку', () => {
    expect(menuModules(owner, all)).toEqual([
      'home',
      'cps',
      'reports',
      'fin',
      'projects',
      'kpi',
      'tasks',
      'files',
      'staff',
      'dicts',
      'org',
      'kb',
    ]);
  });

  it('выключенный в учётной политике модуль пропадает и у владельца', () => {
    const modules = menuModules(owner, without('projects', 'indicators', 'tasks', 'files'));
    expect(modules).not.toContain('projects');
    expect(modules).not.toContain('kpi');
    expect(modules).not.toContain('tasks');
    expect(modules).not.toContain('files');
    expect(modules).toContain('fin');
  });

  it('без права просмотра модуль скрыт; «Главная», «Справочники», «Моя организация», «База знаний» — у всех', () => {
    expect(menuModules(role(), all)).toEqual(['home', 'tasks', 'dicts', 'org', 'kb']);
    expect(menuModules(role('cpView', 'repView', 'projView'), all)).toEqual([
      'home',
      'cps',
      'reports',
      'projects',
      'tasks',
      'dicts',
      'org',
      'kb',
    ]);
  });

  it('«Финансовые операции» — только когда в них есть что делать', () => {
    expect(menuModules(role('finView'), all)).not.toContain('fin');
    expect(menuModules(role('finView', 'money'), all)).toContain('fin');
    expect(menuModules(role('finView', 'money'), without('taxpay'))).not.toContain('fin');
    expect(menuModules(role('finView', 'cpView', 'fee'), without('taxpay'))).toContain('fin');
    expect(menuModules(role('finView', 'cpView', 'fee'), without('taxpay', 'fee'))).not.toContain(
      'fin',
    );
    expect(
      menuModules(role('finView', 'projView', 'projects'), without('taxpay', 'fee')),
    ).toContain('fin');
    expect(menuModules(owner, without('finops'))).not.toContain('fin');
  });
});
