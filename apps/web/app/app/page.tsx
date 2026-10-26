import { redirect } from 'next/navigation';
import { moduleHref, shellAccess } from '../../src/shell/modules';
import { requireMe } from '../../src/shell/server';

/** /app — первый модуль меню на первой вкладке. */
export default async function AppHome() {
  const me = await requireMe();
  redirect(moduleHref(me.modules[0]!, shellAccess(me)));
}
