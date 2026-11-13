import { defaultUiTexts } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { staffKanban, staffMove } from './staff-board';

// Доска сотрудников (прототип v85 modules/staff.js, `staffKanban`): перетаскиванием меняется только
// роль — с правом, не у владельца, в роль, которую можно назначить.

const t = makeTranslate(defaultUiTexts());
const OWNER = '00000000-0000-4000-8000-0000000000c1';
const ACC = '00000000-0000-4000-8000-0000000000c2';
const SENIOR = '00000000-0000-4000-8000-0000000000c3';
const WIDE = '00000000-0000-4000-8000-0000000000c4';
const OWN = '00000000-0000-4000-8000-0000000000c5';
const BEYOND = '00000000-0000-4000-8000-0000000000c6';
const ROLES = [
  { id: OWNER, isOwner: true, readOnly: null },
  { id: ACC, isOwner: false, readOnly: null },
  { id: SENIOR, isOwner: false, readOnly: null },
  { id: WIDE, isOwner: false, readOnly: 'owner_granted_role' as const },
  { id: OWN, isOwner: false, readOnly: 'own_role' as const },
  { id: BEYOND, isOwner: false, readOnly: 'beyond_own_role' as const },
];
const employee = (roleId = ACC, manageable = true) => ({
  role: { id: roleId, name: 'Роль', isOwner: roleId === OWNER },
  manageable,
});

describe('доска сотрудников', () => {
  it('столбцы: роль по умолчанию, роли организации видны и пустыми, по порядку списка ролей', () => {
    const roles = [
      { key: OWNER, label: 'Владелец' },
      { key: SENIOR, label: 'Старший бухгалтер' },
      { key: ACC, label: 'Бухгалтер' },
    ];
    const kanban = staffKanban(roles, () => {});
    expect(kanban.def).toBe('role');
    expect(kanban.by).toEqual(['role', 'active', 'telegram']);
    expect(kanban.order?.role).toEqual([OWNER, SENIOR, ACC]);
    expect(kanban.order?.active).toEqual(['active', 'blocked']);
    expect(kanban.show?.role).toEqual(roles);
    // Сумм у сотрудников нет.
    expect(kanban.sum).toBeUndefined();
    expect(kanban.drop).toBeTypeOf('function');
    expect(staffKanban(roles, undefined).drop).toBeUndefined();
  });

  it('по роли: другая роль — вопрос о смене, свой столбец — ничего', () => {
    expect(staffMove(employee(), true, 'role', SENIOR, ROLES)).toEqual({
      kind: 'role',
      roleId: SENIOR,
    });
    expect(staffMove(employee(), true, 'role', ACC, ROLES)).toEqual({ kind: 'none' });
    // Список ролей ещё не загружен — роль проверит сервер.
    expect(staffMove(employee(), true, 'role', SENIOR)).toEqual({ kind: 'role', roleId: SENIOR });
  });

  it('не по роли — отказ: блокировка и остальное только из меню сотрудника', () => {
    for (const key of ['active', 'telegram', 'login'])
      expect(staffMove(employee(), true, key, 'blocked', ROLES)).toEqual({
        kind: 'refusal',
        key: 'staff.board.only',
      });
    // Причина «не роль» важнее отсутствия права — как в прототипе.
    expect(staffMove(employee(), false, 'active', 'blocked', ROLES)).toEqual({
      kind: 'refusal',
      key: 'staff.board.only',
    });
  });

  it('отказы: нет права, владелец, сотрудник, которого вести нельзя', () => {
    expect(staffMove(employee(), false, 'role', SENIOR, ROLES)).toEqual({
      kind: 'refusal',
      key: 'staff.board.no_right',
    });
    expect(staffMove(employee(OWNER), true, 'role', ACC, ROLES)).toEqual({
      kind: 'refusal',
      key: 'staff.board.owner',
    });
    expect(staffMove(employee(ACC, false), true, 'role', SENIOR, ROLES)).toEqual({
      kind: 'refusal',
      key: 'staff.board.locked',
    });
  });

  it('отказы по роли: роль владельца, своя роль, роль с правами «выдаёт только владелец» или шире своей, неизвестная роль', () => {
    expect(staffMove(employee(), true, 'role', OWNER, ROLES)).toEqual({
      kind: 'refusal',
      key: 'staff.board.owner_one',
    });
    for (const id of [WIDE, OWN, BEYOND])
      expect(staffMove(employee(), true, 'role', id, ROLES)).toEqual({
        kind: 'refusal',
        key: 'staff.board.role_locked',
      });
    expect(staffMove(employee(), true, 'role', 'x', ROLES)).toEqual({
      kind: 'refusal',
      key: 'staff.board.role_locked',
    });
  });

  it('тексты отказов и вопроса — в словаре', () => {
    expect(t('staff.board.only')).toBe(
      'Перетаскиванием меняется только роль. Блокировка и остальное — в меню сотрудника',
    );
    expect(t('staff.board.owner_one')).toBe('Владелец в организации один');
    expect(t('staff.board.confirm.title')).toBe('Сменить роль?');
    expect(
      t('staff.board.confirm.text', { name: 'Айбек С.', from: 'Бухгалтер', to: 'Старший' }),
    ).toBe('Айбек С.: Бухгалтер → Старший. Права сотрудника изменятся сразу.');
  });
});
