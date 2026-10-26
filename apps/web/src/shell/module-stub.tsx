'use client';

import type { MenuModuleId } from '@buhuchet/domain';
import { EmptyState, useToast } from '@buhuchet/ui';
import { useEffect } from 'react';
import { useT } from '../l10n/provider';
import { MODULES } from './modules';
import { useShell } from './context';

/**
 * Модуль, у которого ещё нет экрана: оболочка (меню, вкладки, «+ Добавить») уже работает, а вместо
 * экрана — пояснение (вид пустого состояния прототипа `.state`). Выбранный способ добавления
 * подтверждается уведомлением внизу экрана: само действие появится вместе с экраном модуля.
 */
export function ModuleStub({ moduleId }: { moduleId: MenuModuleId }) {
  const t = useT();
  const toast = useToast();
  const { addRequest, clearAddRequest } = useShell();
  const def = MODULES[moduleId];
  const request = addRequest?.moduleId === moduleId ? addRequest : null;

  useEffect(() => {
    if (!request) return;
    toast(t('shell.stub_add', { action: request.label }), { icon: 'info' });
    clearAddRequest();
  }, [request, toast, t, clearAddRequest]);

  return (
    <EmptyState
      icon={def.icon}
      title={t('shell.stub_title', { module: t(def.title) })}
      text={t('shell.stub_text')}
    />
  );
}
