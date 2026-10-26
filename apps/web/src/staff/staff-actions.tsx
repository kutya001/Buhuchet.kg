'use client';

import { TemporaryPasswordResponse, type Employee } from '@buhuchet/shared';
import {
  buttonClass,
  ConfirmDialog,
  MONO_CLASS,
  Modal,
  useToast,
  type ActionEntry,
} from '@buhuchet/ui';
import { useRef, useState, type ReactNode } from 'react';
import { api, callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import { useShell } from '../shell/context';

/**
 * Действия над сотрудником в списке — кнопкой «⋯», долгим нажатием и правым кликом (прототип
 * modules/staff.js, empActions и blockDlg): «Сбросить пароль» — окно с временным паролем;
 * «Заблокировать» — после подтверждения; «Разблокировать» — сразу. Только с правом «Сотрудники и
 * роли»; у владельца организации действий нет. Себя заблокировать нельзя — пункт недоступен с
 * причиной. Остальные запреты (роль с правами, которые выдаёт только владелец, или шире ваших)
 * проверяет сервер: его отказ — уведомлением. «Открыть карточку», «Сменить роль» — задача #18,
 * «Передать контрагентов» — вместе с контрагентами (поток А).
 */
export function useStaffActions(onChanged: () => void): {
  actions: ((e: Employee) => ActionEntry[]) | undefined;
  dialogs: ReactNode;
} {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const { access, employeeId } = useShell();
  const [askBlock, setAskBlock] = useState<Employee | null>(null);
  const [reset, setReset] = useState<{ employee: Employee; password: string } | null>(null);
  // Повторное нажатие, пока ответ сервера не пришёл, второй запрос не шлёт.
  const busy = useRef(false);

  const send = async <T,>(run: () => Promise<T>): Promise<T | null> => {
    if (busy.current) return null;
    busy.current = true;
    try {
      return await run();
    } finally {
      busy.current = false;
    }
  };

  const resetPassword = async (e: Employee) => {
    const res = await send(() =>
      callApi(() => api.api.staff[':id']['password-reset'].$post({ param: { id: e.id } })),
    );
    if (!res) return;
    if (!res.ok) return toast(errorText(res.error), { bad: true });
    const { temporaryPassword } = TemporaryPasswordResponse.parse(res.data);
    setReset({ employee: e, password: temporaryPassword });
  };

  const setActive = async (e: Employee, active: boolean) => {
    const res = await send(() =>
      callApi(() =>
        api.api.staff[':id'][active ? 'unblock' : 'block'].$post({
          param: { id: e.id },
          json: { version: e.version },
        }),
      ),
    );
    if (!res) return;
    onChanged();
    if (!res.ok) return toast(errorText(res.error), { bad: true });
    toast(t(active ? 'staff.unblock.done' : 'staff.block.done'), {
      icon: active ? 'check' : 'lock',
    });
  };

  const actions = access.can('staff')
    ? (e: Employee): ActionEntry[] => {
        if (e.role.isOwner) return [];
        const self = e.id === employeeId;
        return [
          {
            id: 'reset-password',
            label: t('staff.action.reset_password'),
            icon: 'key',
            run: () => void resetPassword(e),
          },
          { id: 'sep', separator: true },
          e.active
            ? {
                id: 'block',
                label: t('staff.action.block'),
                icon: 'lock',
                danger: true,
                disabled: self,
                reason: self ? t('staff.action.block_self') : undefined,
                run: () => setAskBlock(e),
              }
            : {
                id: 'unblock',
                label: t('staff.action.unblock'),
                icon: 'key',
                run: () => void setActive(e, true),
              },
        ];
      }
    : undefined;

  const dialogs = (
    <>
      <ConfirmDialog
        open={askBlock !== null}
        onClose={() => setAskBlock(null)}
        title={t('staff.block.title', { name: askBlock?.shortName ?? '' })}
        text={t('staff.block.text')}
        ok={t('staff.action.block')}
        danger
        onConfirm={() => askBlock && void setActive(askBlock, false)}
      />
      <Modal
        open={reset !== null}
        onClose={() => setReset(null)}
        kind="message"
        title={t('staff.reset.title')}
        sub={reset?.employee.fullName}
        footer={
          <button type="button" className={buttonClass('cta')} onClick={() => setReset(null)}>
            {t('btn.done')}
          </button>
        }
      >
        <p className="m-0">
          {t('staff.reset.password')}{' '}
          <b data-temporary-password className={`${MONO_CLASS} text-base`}>
            {reset?.password}
          </b>
        </p>
        <p className="m-0 text-muted">{t('staff.reset.text')}</p>
      </Modal>
    </>
  );

  return { actions, dialogs };
}
