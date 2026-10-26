import { redirect } from 'next/navigation';
import { ModuleStub } from '../../../../src/shell/module-stub';
import { resolveAppRoute } from '../../../../src/shell/modules';
import { requireMe } from '../../../../src/shell/server';

/**
 * Модуль без своего экрана: оболочка с меню и вкладками, вместо экрана — заглушка. Экраны модулей
 * появляются отдельными папками (app/app/<модуль>/…) и заменяют её. Модуль не из меню вошедшего или
 * неизвестная вкладка — переход на доступные (как route() прототипа).
 */
export default async function ModulePage({
  params,
}: {
  params: Promise<{ module: string; tab?: string[] }>;
}) {
  const { module, tab } = await params;
  const route = resolveAppRoute(await requireMe(), module, tab);
  if ('redirect' in route) redirect(route.redirect);
  return <ModuleStub moduleId={route.moduleId} />;
}
