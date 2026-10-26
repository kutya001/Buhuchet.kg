'use client';

import { useEffect, useEffectEvent } from 'react';
import { useShell } from '../shell/context';

/**
 * «+ Добавить» в модуле «Сотрудники» (прототип modules/staff.js, staffAdd): «Сотрудник» — окно «Новый
 * сотрудник», «Роль» — окно «Новая роль»; оба способа есть на любой вкладке модуля.
 */
export function useStaffAddRequest(run: { employee: () => void; role: () => void }) {
  const { addRequest, clearAddRequest } = useShell();
  const request = addRequest?.moduleId === 'staff' ? addRequest : null;
  const start = useEffectEvent((actionId: string) => {
    if (actionId === 'employee') run.employee();
    if (actionId === 'role') run.role();
  });
  useEffect(() => {
    if (!request) return;
    start(request.actionId);
    clearAddRequest();
  }, [request, clearAddRequest]);
}
