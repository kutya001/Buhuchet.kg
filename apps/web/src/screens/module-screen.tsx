'use client';

import type { MenuModuleId } from '@buhuchet/domain';
import { ModuleStub } from '../shell/module-stub';
import { StaffList } from '../staff/staff-list';

/**
 * Экран модуля на вкладке. Экраны — клиентские компоненты (данные — из API через TanStack Query),
 * поэтому оболочка показывает и соседнюю вкладку, пока палец листает вкладки свайпом. Экран модуля
 * подключается здесь по `moduleId` и вкладке; модуль без экрана — заглушка. Соседнюю вкладку оболочка рисует
 * без проверки адреса на сервере (вкладки — только видимые по правам), поэтому право на данные
 * вкладки по-прежнему проверяет API, а не скрытая вкладка.
 */
export function ModuleScreen({
  moduleId,
  tabId,
}: {
  moduleId: MenuModuleId;
  tabId: string | null;
}) {
  if (moduleId === 'staff' && (tabId ?? 'list') === 'list') return <StaffList />;
  return <ModuleStub moduleId={moduleId} />;
}

/**
 * Вкладки модулей, у экрана которых есть статистика — плашки-итоги над списком (ТЗ «Статистика
 * модуля»): только у них в ряду вкладок кнопка «Статистика». Экран с плашками добавляет сюда свою
 * вкладку («модуль/вкладка») и показывает плашки по `useModuleStats`.
 */
const SCREENS_WITH_PLATES: ReadonlySet<string> = new Set<string>();

export function screenHasPlates(moduleId: MenuModuleId, tabId: string | null): boolean {
  return SCREENS_WITH_PLATES.has(`${moduleId}/${tabId ?? ''}`);
}
