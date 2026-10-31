'use client';

import type { ContractorKind } from '@buhuchet/domain';
import { useEffect, useEffectEvent } from 'react';
import { useShell } from '../shell/context';

/**
 * «+ Добавить» в модуле «Контрагенты» (прототип core/registry.js, `add` модуля cps): «Контрагент» —
 * окно «Новый контрагент» на любой вкладке модуля, «Загрузка из Excel» — окно «Загрузка контрагентов
 * из Excel» (2.16), «Из свидетельства и выписки» — окно загрузки документов (2.17, Бета). Вариант
 * `oneoff` («Перейти» шага «Добавить разового контрагента») открывает форму с «Разовым».
 */
export function useContractorAddRequest(run: {
  contractor: (kind?: ContractorKind) => void;
  import: () => void;
  regdocs: () => void;
}) {
  const { addRequest, clearAddRequest } = useShell();
  const request = addRequest?.moduleId === 'cps' ? addRequest : null;
  const start = useEffectEvent((actionId: string, variant?: string) => {
    if (actionId === 'contractor') run.contractor(variant === 'oneoff' ? 'oneoff' : undefined);
    else if (actionId === 'import') run.import();
    else if (actionId === 'regdocs') run.regdocs();
  });
  useEffect(() => {
    if (!request) return;
    start(request.actionId, request.variant);
    clearAddRequest();
  }, [request, clearAddRequest]);
}
