'use client';

import type { ContractorKind } from '@buhuchet/domain';
import { useToast } from '@buhuchet/ui';
import { useEffect, useEffectEvent } from 'react';
import { useT } from '../l10n/provider';
import { useShell } from '../shell/context';

/**
 * «+ Добавить» в модуле «Контрагенты» (прототип core/registry.js, `add` модуля cps): «Контрагент» —
 * окно «Новый контрагент» на любой вкладке модуля. «Загрузить из Excel» (2.16) и «Из свидетельства и
 * выписки» (2.17) — уведомление, как у модуля без экрана, пока их задачи не подключат свои окна.
 * Вариант `oneoff` («Перейти» шага «Добавить разового контрагента») открывает форму с «Разовым».
 */
export function useContractorAddRequest(run: { contractor: (kind?: ContractorKind) => void }) {
  const t = useT();
  const toast = useToast();
  const { addRequest, clearAddRequest } = useShell();
  const request = addRequest?.moduleId === 'cps' ? addRequest : null;
  const start = useEffectEvent((actionId: string, label: string, variant?: string) => {
    if (actionId === 'contractor') run.contractor(variant === 'oneoff' ? 'oneoff' : undefined);
    else toast(t('shell.stub_add', { action: label }), { icon: 'info' });
  });
  useEffect(() => {
    if (!request) return;
    start(request.actionId, request.label, request.variant);
    clearAddRequest();
  }, [request, clearAddRequest]);
}
