'use client';

import type { MenuModuleId } from '@buhuchet/domain';
import { ModuleStub } from '../shell/module-stub';

/**
 * Экран модуля на вкладке. Экраны — клиентские компоненты (данные — из API через TanStack Query),
 * поэтому оболочка показывает и соседнюю вкладку, пока палец листает вкладки свайпом. Экран модуля
 * подключается здесь по `moduleId`; пока экранов нет — заглушка. Соседнюю вкладку оболочка рисует
 * без проверки адреса на сервере (вкладки — только видимые по правам), поэтому право на данные
 * вкладки по-прежнему проверяет API, а не скрытая вкладка.
 */
export function ModuleScreen({
  moduleId,
  tabId: _tabId,
}: {
  moduleId: MenuModuleId;
  tabId: string | null;
}) {
  return <ModuleStub moduleId={moduleId} />;
}
