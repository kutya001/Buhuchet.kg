import { defaultUiTexts } from '@buhuchet/domain';
import type { Employee } from '@buhuchet/shared';
import type { ActionEntry, ActionItem } from '@buhuchet/ui';
import { describe, expect, it, vi } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { staffMenu } from './staff-menu';

// Пункты меню сотрудника в списке (прототип modules/staff.js, empActions): кому меню, какие пункты и
// какие недоступны с причиной.

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

const run = () => ({ resetPassword: vi.fn(), block: vi.fn(), unblock: vi.fn() });
const items = (list: readonly ActionEntry[]) =>
  list.filter((i): i is ActionItem => !('separator' in i));

describe('меню сотрудника в списке', () => {
  it('без права «Сотрудники и роли» меню нет', () => {
    expect(staffMenu({ canManage: false, employeeId: ME, t, run: run() })).toBeUndefined();
  });

  it('у владельца организации пунктов нет — «⋯» на его строке не показывается', () => {
    const menu = staffMenu({ canManage: true, employeeId: ME, t, run: run() })!;
    expect(menu(employee({ isOwner: true }))).toEqual([]);
  });

  it('активному — «Сбросить пароль», черта и красное «Заблокировать», которое спрашивает', () => {
    const r = run();
    const e = employee();
    const list = staffMenu({ canManage: true, employeeId: ME, t, run: r })!(e);
    expect(list.map((i) => ('separator' in i ? '—' : i.label))).toEqual([
      'Сбросить пароль',
      '—',
      'Заблокировать',
    ]);
    const [reset, block] = items(list);
    expect(block).toMatchObject({ danger: true, disabled: false, icon: 'lock' });
    reset!.run();
    block!.run();
    expect(r.resetPassword).toHaveBeenCalledWith(e);
    expect(r.block).toHaveBeenCalledWith(e);
  });

  it('заблокированному вместо «Заблокировать» — «Разблокировать»', () => {
    const r = run();
    const e = employee({ active: false });
    const [, unblock] = items(staffMenu({ canManage: true, employeeId: ME, t, run: r })!(e));
    expect(unblock).toMatchObject({ label: 'Разблокировать', icon: 'key' });
    expect(unblock!.danger).toBeUndefined();
    unblock!.run();
    expect(r.unblock).toHaveBeenCalledWith(e);
  });

  it('на своей строке «Сбросить пароль» и «Заблокировать» недоступны с причиной', () => {
    const [reset, block] = items(
      staffMenu({ canManage: true, employeeId: ME, t, run: run() })!(employee({ id: ME })),
    );
    expect(reset).toMatchObject({ disabled: true, reason: 'Свой пароль меняют в «Мой профиль»' });
    expect(block).toMatchObject({ disabled: true, reason: 'Нельзя заблокировать себя' });
  });
});
