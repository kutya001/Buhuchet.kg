import { defaultUiTexts } from '@buhuchet/domain';
import type { RoleListItem } from '@buhuchet/shared';
import type { ActionEntry, ActionItem } from '@buhuchet/ui';
import { describe, expect, it, vi } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { roleMenu } from './roles-menu';

// Пункты меню роли (прототип modules/staff.js, roleActions; «Удалить» — docs/deviations.md, п. 16):
// кому какие пункты и когда «Удалить» недоступно с причиной.

const t = makeTranslate(defaultUiTexts());
const DEFAULT = '00000000-0000-4000-8000-000000000007';

const role = (over: Partial<RoleListItem> = {}) =>
  ({
    id: '00000000-0000-4000-8000-000000000009',
    name: 'Кадры',
    isOwner: false,
    templateCode: null,
    employees: 0,
    permissionCount: 5,
    version: 2,
    ...over,
  }) as RoleListItem;

const run = () => ({ open: vi.fn(), edit: vi.fn(), remove: vi.fn() });
const items = (list: readonly ActionEntry[]) =>
  list.filter((i): i is ActionItem => !('separator' in i));
const labels = (list: readonly ActionEntry[]) =>
  list.map((i) => ('separator' in i ? '—' : i.label));
const removeOf = (list: readonly ActionEntry[]) => items(list).find((i) => i.id === 'delete');

describe('меню роли', () => {
  it('без права «Сотрудники и роли» — «Открыть» и «Изменить», без «Удалить»', () => {
    const list = roleMenu({ canDelete: false, defaultRoleId: DEFAULT, t, run: run() })(role());
    expect(labels(list)).toEqual(['Открыть', 'Изменить']);
  });

  it('с правом — черта и красное «Удалить»; роль без сотрудников удаляется после вопроса', () => {
    const r = run();
    const target = role();
    const list = roleMenu({ canDelete: true, defaultRoleId: DEFAULT, t, run: r })(target);
    expect(labels(list)).toEqual(['Открыть', 'Изменить', '—', 'Удалить']);
    const remove = removeOf(list)!;
    expect(remove).toMatchObject({ icon: 'trash', danger: true, disabled: false });
    expect(remove.reason).toBeUndefined();
    remove.run();
    expect(r.remove).toHaveBeenCalledWith(target);
  });

  it('«Удалить» недоступно с причиной у роли владельца, роли с сотрудниками и роли новых сотрудников', () => {
    const menu = roleMenu({ canDelete: true, defaultRoleId: DEFAULT, t, run: run() });
    expect(removeOf(menu(role({ isOwner: true })))).toMatchObject({
      disabled: true,
      reason: 'Роль владельца не удаляется',
    });
    expect(removeOf(menu(role({ employees: 3 })))).toMatchObject({
      disabled: true,
      reason: 'Роль назначена сотрудникам: сначала смените им роль',
    });
    expect(removeOf(menu(role({ id: DEFAULT })))).toMatchObject({
      disabled: true,
      reason:
        'Эту роль получают новые сотрудники: сначала выберите другую в «Моя организация» → «Настройки»',
    });
  });

  it('у роли владельца «Изменить» недоступно: её права не меняются', () => {
    const r = run();
    const [open, edit] = items(
      roleMenu({ canDelete: false, defaultRoleId: null, t, run: r })(role({ isOwner: true })),
    );
    expect(edit).toMatchObject({ disabled: true, reason: 'Права владельца не меняются' });
    open!.run();
    expect(r.open).toHaveBeenCalled();
  });
});
