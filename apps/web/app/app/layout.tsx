import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import {
  MAX_COOKIE,
  NAV_COOKIE,
  parseMaxPrefs,
  parseNavHidden,
  parseTree,
  TREE_COOKIE,
} from '../../src/shell/prefs';
import { requestNow, requireMe } from '../../src/shell/server';
import { Shell } from '../../src/shell/shell';

/**
 * Страницы за входом: /app/<модуль>/<вкладка>. Кто вошёл и выбор на этом устройстве (скрытая левая
 * панель, раскрытые ветки, развёрнутые окна) читаются на сервере — страница сразу приходит с меню, без мигания; часы
 * первого показа — время сервера, дальше их ведут часы устройства.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await requireMe();
  const store = await cookies();
  return (
    <Shell
      me={me}
      initialNavHidden={parseNavHidden(store.get(NAV_COOKIE)?.value)}
      initialOpen={parseTree(store.get(TREE_COOKIE)?.value, me.modules)}
      initialMax={parseMaxPrefs(store.get(MAX_COOKIE)?.value)}
      serverNow={requestNow()}
    >
      {children}
    </Shell>
  );
}
