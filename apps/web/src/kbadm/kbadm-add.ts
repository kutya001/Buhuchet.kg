'use client';

import { useEffect, useEffectEvent } from 'react';
import { useShell } from '../shell/context';

/**
 * «+ Добавить» модуля «База знаний (содержимое)» на своей вкладке (прототип kbAdmAdd): «Шаг урока» на
 * «Шагах уроков», «Статья» на «Статьях». Экран показывает одну вкладку, поэтому запрос забирает тот,
 * кто сейчас на экране (у «Новостей» — свой обработчик).
 */
export function useKbAdmAdd(actionId: string, run: () => void) {
  const { addRequest, clearAddRequest } = useShell();
  const request = addRequest?.moduleId === 'kbadm' ? addRequest : null;
  const start = useEffectEvent((id: string) => {
    if (id === actionId) run();
  });
  useEffect(() => {
    if (!request) return;
    start(request.actionId);
    clearAddRequest();
  }, [request, clearAddRequest]);
}
