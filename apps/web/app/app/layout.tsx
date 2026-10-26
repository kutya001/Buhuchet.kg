import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { NAV_COOKIE, parseNavHidden, parseTree, TREE_COOKIE } from '../../src/shell/prefs';
import { requireMe } from '../../src/shell/server';
import { Shell } from '../../src/shell/shell';

/**
 * Страницы за входом: /app/<модуль>/<вкладка>. Кто вошёл и выбор на этом устройстве (скрытая левая
 * панель, раскрытые ветки) читаются на сервере — страница сразу приходит с меню, без мигания.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await requireMe();
  const store = await cookies();
  return (
    <Shell
      me={me}
      initialNavHidden={parseNavHidden(store.get(NAV_COOKIE)?.value)}
      initialOpen={parseTree(store.get(TREE_COOKIE)?.value, me.modules)}
    >
      {children}
    </Shell>
  );
}
