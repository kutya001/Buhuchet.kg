import { defaultUiTexts } from '@buhuchet/domain';
import type { AdminUser } from '@buhuchet/shared';
import type { ActionItem } from '@buhuchet/ui';
import { describe, expect, it, vi } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { accountHeadActions, accountMenu } from './accounts-menu';

// Меню учётной записи в Админке (прототип admin/accounts-orgs.js, accActions): «Сбросить пароль»,
// «Заблокировать» или «Разблокировать»; на своей строке — «Это вы»; у других администраторов платформы
// пунктов нет.

const t = makeTranslate(defaultUiTexts());
const ME = '00000000-0000-4000-8000-0000000000a1';

const account = (over: Partial<AdminUser> = {}) =>
  ({
    id: '00000000-0000-4000-8000-000000000001',
    login: 'asanov',
    isPlatformAdmin: false,
    blocked: false,
    status: 'active',
    version: 2,
    ...over,
  }) as AdminUser;

const run = () => ({ resetPassword: vi.fn(), block: vi.fn(), unblock: vi.fn() });

describe('меню учётной записи в Админке', () => {
  it('активная: «Сбросить пароль», черта, «Заблокировать» красным', () => {
    const r = run();
    const items = accountMenu({ userId: ME, t, run: r })(account());
    expect(items.map((i) => i.id)).toEqual(['reset-password', 'sep', 'block']);
    const [reset, , block] = items as ActionItem[];
    expect(reset).toMatchObject({ label: 'Сбросить пароль', icon: 'key' });
    expect(block).toMatchObject({ label: 'Заблокировать', danger: true });
    reset!.run();
    block!.run();
    expect(r.resetPassword).toHaveBeenCalledWith(expect.objectContaining({ login: 'asanov' }));
    expect(r.block).toHaveBeenCalledOnce();
  });

  it('заблокированная администратором: «Разблокировать»; заблокированная владельцем — «Заблокировать»', () => {
    const r = run();
    const blocked = accountMenu({ userId: ME, t, run: r })(
      account({ blocked: true, status: 'blocked' }),
    ) as ActionItem[];
    expect(blocked[2]).toMatchObject({ id: 'unblock', label: 'Разблокировать' });
    blocked[2]!.run();
    expect(r.unblock).toHaveBeenCalledOnce();
    const byOwner = accountMenu({ userId: ME, t, run: r })(
      account({ status: 'owner_blocked' }),
    ) as ActionItem[];
    expect(byOwner[2]).toMatchObject({ id: 'block' });
  });

  it('своя строка — недоступное «Это вы»; другой администратор платформы — без меню', () => {
    const menu = accountMenu({ userId: ME, t, run: run() });
    expect(menu(account({ id: ME, isPlatformAdmin: true }))).toEqual([
      expect.objectContaining({ id: 'self', label: 'Это вы', disabled: true }),
    ]);
    expect(menu(account({ isPlatformAdmin: true }))).toEqual([]);
  });

  it('меню строки списка (прототип v83): первым «Открыть карточку», затем черта и действия', () => {
    const open = vi.fn();
    const menu = accountMenu({ userId: ME, t, run: { ...run(), open } });
    const items = menu(account());
    expect(items.map((i) => i.id)).toEqual(['card', 'sep-card', 'reset-password', 'sep', 'block']);
    expect(items[0]).toMatchObject({ label: 'Открыть карточку', icon: 'user' });
    (items[0] as ActionItem).run();
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ login: 'asanov' }));
    // Своя строка — карточка и «Это вы»; другой администратор платформы — только карточка.
    expect(menu(account({ id: ME, isPlatformAdmin: true })).map((i) => i.id)).toEqual([
      'card',
      'sep-card',
      'self',
    ]);
    expect(menu(account({ isPlatformAdmin: true })).map((i) => i.id)).toEqual(['card']);
  });

  it('кнопки шапки карточки: действия без черт; у своей записи кнопок нет', () => {
    const menu = accountMenu({ userId: ME, t, run: run() });
    expect(accountHeadActions(menu(account())).map((a) => a.id)).toEqual([
      'reset-password',
      'block',
    ]);
    expect(accountHeadActions(menu(account({ id: ME, isPlatformAdmin: true })))).toEqual([]);
    expect(accountHeadActions(menu(account({ isPlatformAdmin: true })))).toEqual([]);
  });
});
