'use client';

import { useToast } from '@buhuchet/ui';
import { useEffect, useEffectEvent, useState } from 'react';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useT } from '../l10n/provider';
import { ModuleStub } from '../shell/module-stub';
import { useShell } from '../shell/context';
import { NewContractorDialog } from './contractor-form';

/**
 * «+ Добавить» в модуле «Контрагенты» (прототип core/registry.js, `add` модуля cps): «Контрагент» —
 * окно «Новый контрагент» на любой вкладке модуля. «Загрузить из Excel» (2.16) и «Из свидетельства и
 * выписки» (2.17) — уведомление, как у модуля без экрана, пока их задачи не подключат свои окна.
 */
export function useContractorAddRequest(run: { contractor: () => void }) {
  const t = useT();
  const toast = useToast();
  const { addRequest, clearAddRequest } = useShell();
  const request = addRequest?.moduleId === 'cps' ? addRequest : null;
  const start = useEffectEvent((actionId: string, label: string) => {
    if (actionId === 'contractor') run.contractor();
    else toast(t('shell.stub_add', { action: label }), { icon: 'info' });
  });
  useEffect(() => {
    if (!request) return;
    start(request.actionId, request.label);
    clearAddRequest();
  }, [request, clearAddRequest]);
}

/** Окно «Новый контрагент» по «+ Добавить» → «Контрагент». */
export function useNewContractor() {
  const [slot, setSlot] = useState<DialogSlot<null> | null>(null);
  return {
    open: () => setSlot(openSlot(null)),
    dialog: slot ? (
      <NewContractorDialog key={slot.n} open={slot.open} onClose={() => setSlot(closeSlot)} />
    ) : null,
  };
}

/**
 * Модуль «Контрагенты» до списка (задача 2.10): заглушка вместо экрана, но «+ Добавить» → «Контрагент»
 * уже открывает форму создания.
 */
export function ContractorsStub() {
  const create = useNewContractor();
  useContractorAddRequest({ contractor: create.open });
  return (
    <>
      <ModuleStub moduleId="cps" handleAdd={false} />
      {create.dialog}
    </>
  );
}
