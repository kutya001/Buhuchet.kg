import { defaultUiTexts } from '@buhuchet/domain';
import type { Employee } from '@buhuchet/shared';
import type { ActionEntry, ActionItem } from '@buhuchet/ui';
import { describe, expect, it, vi } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { canEditEmployee, staffMenu } from './staff-menu';

// Пункты меню сотрудника в списке и кнопки «Действия» в карточке (прототип modules/staff.js,
// empActions): кому какие пункты и какие недоступны с причиной.

const t = makeTranslate(defaultUiTexts());
const ME = '00000000-0000-4000-8000-000000000001';

const employee = (
  over: { id?: string; active?: boolean; isOwner?: boolean; manageable?: boolean } = {},
) =>
  ({
    id: over.id ?? '00000000-0000-4000-8000-000000000002',
    fullName: 'Бухгалтеров Тест Тестович',
    shortName: 'Тест Б.',
    active: over.active ?? true,
    // Сервер: владельца организации и себя вести нельзя.
    manageable: over.manageable ?? (!over.isOwner && over.id !== ME),
    role: {
      id: '00000000-0000-4000-8000-000000000009',
      name: 'Бухгалтер',
      isOwner: !!over.isOwner,
    },
    version: 3,
  }) as Employee;

const run = () => ({
  open: vi.fn(),
  edit: vi.fn(),
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
    const list = staffMenu({ canManage: false, isOwner: true, employeeId: ME, t, run: r })(e);
    expect(labels(list)).toEqual(['Открыть карточку']);
    items(list)[0]!.run();
    expect(r.open).toHaveBeenCalledWith(e);
  });

  it('у владельца организации — только «Открыть карточку», в карточке «Действий» нет', () => {
    const owner = employee({ isOwner: true });
    expect(
      labels(staffMenu({ canManage: true, isOwner: true, employeeId: ME, t, run: run() })(owner)),
    ).toEqual(['Открыть карточку']);
    expect(
      staffMenu({ canManage: true, isOwner: true, employeeId: ME, t, run: run(), card: true })(
        owner,
      ),
    ).toEqual([]);
  });

  it('сам владелец на своей строке может «Изменить» ФИО и телефон; в карточке «Действий» нет', () => {
    const r = run();
    const owner = employee({ id: ME, isOwner: true });
    const list = staffMenu({ canManage: true, isOwner: true, employeeId: ME, t, run: r })(owner);
    expect(labels(list)).toEqual(['Открыть карточку', 'Изменить']);
    const edit = items(list)[1]!;
    expect(edit).toMatchObject({ label: 'Изменить', icon: 'edit' });
    edit.run();
    expect(r.edit).toHaveBeenCalledWith(owner);
    expect(
      staffMenu({ canManage: true, isOwner: true, employeeId: ME, t, run: r, card: true })(owner),
    ).toEqual([]);
  });

  it('кнопка «Изменить» в карточке: с правом — у любого не владельца и у себя; владельца — только сам он', () => {
    expect(canEditEmployee(true, ME, employee())).toBe(true);
    expect(canEditEmployee(true, ME, employee({ id: ME }))).toBe(true);
    expect(canEditEmployee(true, ME, employee({ id: ME, isOwner: true }))).toBe(true);
    expect(canEditEmployee(true, ME, employee({ isOwner: true }))).toBe(false);
    expect(canEditEmployee(false, ME, employee())).toBe(false);
    expect(canEditEmployee(false, ME, employee({ id: ME, isOwner: true }))).toBe(false);
  });

  it('активному — «Открыть карточку», «Изменить», «Сменить роль», «Сбросить пароль», черта и красное «Заблокировать»', () => {
    const r = run();
    const e = employee();
    const list = staffMenu({ canManage: true, isOwner: true, employeeId: ME, t, run: r })(e);
    expect(labels(list)).toEqual([
      'Открыть карточку',
      'Изменить',
      'Сменить роль',
      'Сбросить пароль',
      '—',
      'Заблокировать',
    ]);
    const [, edit, role, reset, block] = items(list);
    expect(role).toMatchObject({ icon: 'shield' });
    expect(role!.disabled).toBeFalsy();
    expect(block).toMatchObject({ danger: true, icon: 'lock' });
    expect(block!.disabled).toBeFalsy();
    edit!.run();
    expect(r.edit).toHaveBeenCalledWith(e);
    role!.run();
    reset!.run();
    block!.run();
    expect(r.changeRole).toHaveBeenCalledWith(e);
    expect(r.resetPassword).toHaveBeenCalledWith(e);
    expect(r.block).toHaveBeenCalledWith(e);
  });

  it('в карточке «Действия» — те же пункты без «Открыть карточку» и «Изменить» (это отдельная кнопка)', () => {
    const list = staffMenu({
      canManage: true,
      isOwner: true,
      employeeId: ME,
      t,
      run: run(),
      card: true,
    })(employee());
    expect(labels(list)).toEqual(['Сменить роль', 'Сбросить пароль', '—', 'Заблокировать']);
  });

  it('заблокированному вместо «Заблокировать» — «Разблокировать»', () => {
    const r = run();
    const e = employee({ active: false });
    const unblock = items(
      staffMenu({ canManage: true, isOwner: true, employeeId: ME, t, run: r })(e),
    ).at(-1);
    expect(unblock).toMatchObject({ label: 'Разблокировать', icon: 'key' });
    expect(unblock!.danger).toBeUndefined();
    unblock!.run();
    expect(r.unblock).toHaveBeenCalledWith(e);
  });

  it('не владельцу «Сбросить пароль» не показывается: пароль сотрудника сбрасывает владелец (п. 11)', () => {
    const menu = staffMenu({ canManage: true, isOwner: false, employeeId: ME, t, run: run() });
    expect(labels(menu(employee()))).toEqual([
      'Открыть карточку',
      'Изменить',
      'Сменить роль',
      '—',
      'Заблокировать',
    ]);
    const card = staffMenu({
      canManage: true,
      isOwner: false,
      employeeId: ME,
      t,
      run: run(),
      card: true,
    });
    expect(labels(card(employee()))).toEqual(['Сменить роль', '—', 'Заблокировать']);
  });

  it('у себя и у того, кого вести нельзя, «Сменить роль», «Сбросить пароль» и «Заблокировать» скрыты', () => {
    const menu = staffMenu({ canManage: true, isOwner: true, employeeId: ME, t, run: run() });
    expect(labels(menu(employee({ id: ME })))).toEqual(['Открыть карточку', 'Изменить']);
    // Сотрудник с правами «выдаёт только владелец» или с ролью шире своей: только «Изменить».
    expect(labels(menu(employee({ manageable: false })))).toEqual(['Открыть карточку', 'Изменить']);
    expect(labels(menu(employee({ manageable: false, active: false })))).toEqual([
      'Открыть карточку',
      'Изменить',
    ]);
    // В карточке «Действий» тогда нет: пусто.
    const card = staffMenu({
      canManage: true,
      isOwner: true,
      employeeId: ME,
      t,
      run: run(),
      card: true,
    });
    expect(card(employee({ manageable: false }))).toEqual([]);
  });
});
