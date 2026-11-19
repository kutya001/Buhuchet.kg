'use client';

import { statsShown, statsViewKey, type MenuModuleId } from '@buhuchet/domain';
import { PHONE_QUERY, useMediaQuery } from '@buhuchet/ui';
import { useViewSettings } from './view-settings';

/**
 * «Статистика» модуля (ТЗ «Статистика модуля (плашки-итоги)»): показаны ли плашки-итоги и
 * переключатель. На ПК выбор запоминается для пользователя и модуля, по умолчанию плашки скрыты
 * (прототип v88). На телефоне кнопки нет, плашки всегда на виду — одной строкой из трёх чисел
 * (прототип v139, решение заказчика 17.11.2026). Им пользуются кнопка в ряду вкладок и экран с
 * плашками (`Plates shown`).
 */
export function useModuleStats(moduleId: MenuModuleId) {
  const phone = useMediaQuery(PHONE_QUERY);
  const view = useViewSettings(statsViewKey(moduleId));
  const shown = phone || statsShown(view.settings, false);
  return {
    shown,
    toggle: () => {
      if (!phone) view.save({ ...view.settings, stats: !shown });
    },
  };
}
