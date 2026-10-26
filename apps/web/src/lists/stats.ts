'use client';

import { statsShown, statsViewKey, type MenuModuleId } from '@buhuchet/domain';
import { PHONE_QUERY, useMediaQuery } from '@buhuchet/ui';
import { useViewSettings } from './view-settings';

/**
 * «Статистика» модуля (ТЗ «Статистика модуля (плашки-итоги)»): показаны ли плашки-итоги и
 * переключатель. Выбор запоминается для пользователя и модуля, отдельно на ПК и на телефоне; по
 * умолчанию на ПК показаны, на телефоне скрыты. Им пользуются кнопка в ряду вкладок и экран с плашками
 * (`Plates shown`).
 */
export function useModuleStats(moduleId: MenuModuleId) {
  const phone = useMediaQuery(PHONE_QUERY);
  const view = useViewSettings(statsViewKey(moduleId));
  const shown = statsShown(view.settings, phone);
  return {
    shown,
    toggle: () =>
      view.save(
        phone ? { ...view.settings, phoneStats: !shown } : { ...view.settings, stats: !shown },
      ),
  };
}
