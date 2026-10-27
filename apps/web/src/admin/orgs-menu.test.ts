import { defaultUiTexts } from '@buhuchet/domain';
import type { AdminOrganization } from '@buhuchet/shared';
import type { ActionItem } from '@buhuchet/ui';
import { describe, expect, it, vi } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { orgMenu } from './orgs-menu';

// Меню организации в Админке (прототип admin/accounts-orgs.js, renderOrgs): «Заблокировать» у
// активной, «Разблокировать» у заблокированной, демо-организацию стенда не блокируют.

const t = makeTranslate(defaultUiTexts());

const org = (over: Partial<AdminOrganization> = {}) =>
  ({
    id: '00000000-0000-4000-8000-000000000001',
    name: 'ОсОО «Альфа»',
    active: true,
    isDemo: false,
    version: 2,
    ...over,
  }) as AdminOrganization;

const run = () => ({ block: vi.fn(), unblock: vi.fn() });

describe('меню организации в Админке', () => {
  it('активная: «Заблокировать» красным, запускает вопрос о блокировке', () => {
    const r = run();
    const [item] = orgMenu({ t, run: r })(org()) as ActionItem[];
    expect(item).toMatchObject({ id: 'block', label: 'Заблокировать', danger: true });
    expect(item!.disabled).toBeFalsy();
    item!.run();
    expect(r.block).toHaveBeenCalledWith(expect.objectContaining({ name: 'ОсОО «Альфа»' }));
  });

  it('заблокированная: «Разблокировать»', () => {
    const r = run();
    const [item] = orgMenu({ t, run: r })(org({ active: false })) as ActionItem[];
    expect(item).toMatchObject({ id: 'unblock', label: 'Разблокировать' });
    item!.run();
    expect(r.unblock).toHaveBeenCalledOnce();
  });

  it('демо-организация стенда: «Заблокировать» недоступно с причиной', () => {
    const [item] = orgMenu({ t, run: run() })(org({ isDemo: true })) as ActionItem[];
    expect(item).toMatchObject({
      id: 'block',
      disabled: true,
      reason: 'Демо-организация стенда',
    });
  });
});
