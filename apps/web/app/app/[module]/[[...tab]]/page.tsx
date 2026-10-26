import { redirect } from 'next/navigation';
import { ModuleScreen } from '../../../../src/screens/module-screen';
import { resolveAppRoute } from '../../../../src/shell/modules';
import { requireMe } from '../../../../src/shell/server';

/**
 * Страница модуля на вкладке: оболочка с меню и вкладками, внутри — экран модуля из реестра
 * `src/screens` (пока экранов нет — заглушка). Модуль не из меню вошедшего или неизвестная вкладка —
 * переход на доступные (как route() прототипа).
 */
export default async function ModulePage({
  params,
}: {
  params: Promise<{ module: string; tab?: string[] }>;
}) {
  const { module, tab } = await params;
  const route = resolveAppRoute(await requireMe(), module, tab);
  if ('redirect' in route) redirect(route.redirect);
  return <ModuleScreen moduleId={route.moduleId} tabId={route.tabId} />;
}
