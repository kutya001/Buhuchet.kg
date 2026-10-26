import { defaultUiTexts } from '@buhuchet/domain';
import type { Employee } from '@buhuchet/shared';
import type { ActionEntry, ActionItem } from '@buhuchet/ui';
import { describe, expect, it, vi } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { staffMenu } from './staff-menu';

// Пункты меню сотрудника в списке и кнопки «Действия» в карточке (прототип modules/staff.js,
// empActions): кому какие пункты и какие недоступны с причиной.

const t = makeTranslate(defaultUiTexts());
const ME = '00000000-0000-4000-8000-000000000001';

const employee = (over: { id?: string; active?: boolean; isOwner?: boolean } = {}) =>
  ({
    id: over.id ?? '00000000-0000-4000-8000-000000000002',
    fullName: 'Бухгалтеров Тест Тестович',
    shortName: 'Тест Б.',
    active: over.active ?? true,
    role: {
      id: '00000000-0000-4000-8000-000000000009',
      name: 'Бухгалтер',
      isOwner: !!over.isOwner,
    },
    version: 3,
  }) as Employee;

const run = () => ({
  open: vi.fn(),
  changeRole: vi.fn(),
  resetPassword: vi.fn(),
  block: vi.fn(),
  unblock: vi.fn(),
});
const items = (list: readonly ActionEntry[]) =>
  list.filter((i): i is ActionItem => !('separator' in i));
const labels = (list: readonly ActionEntry[]) =>
  list.map((i) => ('separator' in i ? '—' : i.label));

describe('меню сотрудника', () => {
  it('без права «Сотрудники и роли» — только «Открыть карточку»', () => {
    const r = run();
    const e = employee();
    const list = staffMenu({ canManage: false, employeeId: ME, t, run: r })(e);
    expect(labels(list)).toEqual(['Открыть карточку']);
    items(list)[0]!.run();
    expect(r.open).toHaveBeenCalledWith(e);
  });

  it('у владельца организации — только «Открыть карточку», в карточке «Действий» нет', () => {
    const owner = employee({ isOwner: true });
    expect(labels(staffMenu({ canManage: true, employeeId: ME, t, run: run() })(owner))).toEqual([
      'Открыть карточку',
    ]);
    expect(
      staffMenu({ canManage: true, employeeId: ME, t, run: run(), card: true })(owner),
    ).toEqual([]);
  });

  it('активному — «Открыть карточку», «Сменить роль», «Сбросить пароль», черта и красное «Заблокировать»', () => {
    const r = run();
    const e = employee();
    const list = staffMenu({ canManage: true, employeeId: ME, t, run: r })(e);
    expect(labels(list)).toEqual([
      'Открыть карточку',
      'Сменить роль',
      'Сбросить пароль',
      '—',
      'Заблокировать',
    ]);
    const [, role, reset, block] = items(list);
    expect(role).toMatchObject({ icon: 'shield', disabled: false });
    expect(block).toMatchObject({ danger: true, disabled: false, icon: 'lock' });
    role!.run();
    reset!.run();
    block!.run();
    expect(r.changeRole).toHaveBeenCalledWith(e);
    expect(r.resetPassword).toHaveBeenCalledWith(e);
    expect(r.block).toHaveBeenCalledWith(e);
  });

  it('в карточке «Действия» — те же пункты без «Открыть карточку»', () => {
    const list = staffMenu({ canManage: true, employeeId: ME, t, run: run(), card: true })(
      employee(),
    );
    expect(labels(list)).toEqual(['Сменить роль', 'Сбросить пароль', '—', 'Заблокировать']);
  });

  it('заблокированному вместо «Заблокировать» — «Разблокировать»', () => {
    const r = run();
    const e = employee({ active: false });
    const unblock = items(staffMenu({ canManage: true, employeeId: ME, t, run: r })(e)).at(-1);
    expect(unblock).toMatchObject({ label: 'Разблокировать', icon: 'key' });
    expect(unblock!.danger).toBeUndefined();
    unblock!.run();
    expect(r.unblock).toHaveBeenCalledWith(e);
  });

  it('на своей строке «Сменить роль», «Сбросить пароль» и «Заблокировать» недоступны с причиной', () => {
    const [, role, reset, block] = items(
      staffMenu({ canManage: true, employeeId: ME, t, run: run() })(employee({ id: ME })),
    );
    expect(role).toMatchObject({ disabled: true, reason: 'Свою роль меняет владелец' });
    expect(reset).toMatchObject({ disabled: true, reason: 'Свой пароль меняют в «Мой профиль»' });
    expect(block).toMatchObject({ disabled: true, reason: 'Нельзя заблокировать себя' });
  });
});
