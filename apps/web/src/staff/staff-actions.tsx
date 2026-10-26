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
import { useState, type ReactNode } from 'react';
import { api, callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import { useShell } from '../shell/context';
import { staffMenu } from './staff-menu';

/**
 * Действия над сотрудником в списке — кнопкой «⋯», долгим нажатием и правым кликом (прототип
 * modules/staff.js, empActions и blockDlg; пункты — `staffMenu`): «Сбросить пароль» — окно с
 * временным паролем; «Заблокировать» — после подтверждения; «Разблокировать» — сразу. Отказ сервера
 * (роль с правами, которые выдаёт только владелец, или шире ваших) — уведомлением с текстом из
 * словаря. «Открыть карточку», «Сменить роль» — задача #18, «Передать контрагентов» — вместе с
 * контрагентами (поток А).
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
  // Сотрудники, по которым запрос ещё идёт: повторное действие над ними не шлёт второй запрос
  // (иначе окно могло бы показать уже недействительный временный пароль).
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const once = async <T,>(e: Employee, send: () => Promise<T>): Promise<T | null> => {
    if (pending.has(e.id)) return null;
    setPending((p) => new Set(p).add(e.id));
    try {
      return await send();
    } finally {
      setPending((p) => {
        const next = new Set(p);
        next.delete(e.id);
        return next;
      });
    }
  };

  const resetPassword = async (e: Employee) => {
    const res = await once(e, () =>
      callApi(() => api.api.staff[':id']['password-reset'].$post({ param: { id: e.id } })),
    );
    if (!res) return;
    if (!res.ok) return toast(errorText(res.error), { bad: true });
    const body = TemporaryPasswordResponse.safeParse(res.data);
    if (!body.success) return toast(t('err.unknown'), { bad: true });
    setReset({ employee: e, password: body.data.temporaryPassword });
  };

  const setActive = async (e: Employee, active: boolean) => {
    const res = await once(e, () =>
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

  const actions = staffMenu({
    canManage: access.can('staff'),
    employeeId,
    t,
    run: {
      resetPassword: (e) => void resetPassword(e),
      block: setAskBlock,
      unblock: (e) => void setActive(e, true),
    },
  });

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
