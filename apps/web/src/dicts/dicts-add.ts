'use client';

import { useToast } from '@buhuchet/ui';
import { useEffect, useEffectEvent } from 'react';
import { useT } from '../l10n/provider';
import { useShell } from '../shell/context';

/**
 * «+ Добавить» в модуле «Справочники» (прототип core/registry.js, `add` модуля dicts): «Подключить из
 * каталога» — окно «Выбор налогов», «Попросить добавить» — запрос администратору платформы, «Мои
 * запросы» — что с запросами стало; все — на любой вкладке модуля. Другой способ — уведомление, как у
 * модуля без экрана.
 */
export function useDictsAddRequest(run: {
  catalog: () => void;
  request: () => void;
  mine: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const { addRequest, clearAddRequest } = useShell();
  const request = addRequest?.moduleId === 'dicts' ? addRequest : null;
  const start = useEffectEvent((actionId: string, label: string) => {
    if (actionId === 'catalog') run.catalog();
    else if (actionId === 'request') run.request();
    else if (actionId === 'mine') run.mine();
    else toast(t('shell.stub_add', { action: label }), { icon: 'info' });
  });
  useEffect(() => {
    if (!request) return;
    start(request.actionId, request.label);
    clearAddRequest();
  }, [request, clearAddRequest]);
}
