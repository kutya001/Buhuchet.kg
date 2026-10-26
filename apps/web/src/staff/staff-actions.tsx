'use client';

import {
  TemporaryPasswordResponse,
  type Employee,
  type PhoneCodes,
  type RoleListItem,
} from '@buhuchet/shared';
import {
  buttonClass,
  ConfirmDialog,
  MONO_CLASS,
  Modal,
  useToast,
  type ActionEntry,
} from '@buhuchet/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { api, callApi } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useErrorText, useT } from '../l10n/provider';
import { useShell } from '../shell/context';
import { EmployeeCard } from './employee-card';
import { ChangeRoleDialog, NewEmployeeDialog } from './employee-forms';
import { allRolesQuery, phoneCodesQuery, policyQuery, useStaffRefresh } from './staff-data';
import { staffMenu } from './staff-menu';

interface NewEmployeeData {
  roles: RoleListItem[];
  defaultRoleId: string | null;
  codes: PhoneCodes['items'];
}

/**
 * Действия над сотрудником (прототип modules/staff.js, empActions, empCard, empAddDlg, blockDlg;
 * пункты — `staffMenu`): в списке — кнопкой «⋯», долгим нажатием и правым кликом; в карточке —
 * кнопкой «Действия». «Открыть карточку»; «Сменить роль»; «Сбросить пароль» — окно с временным
 * паролем; «Заблокировать» — после подтверждения; «Разблокировать» — сразу; «Новый сотрудник».
 * Отказ сервера (роль с правами, которые выдаёт только владелец, или шире ваших) — уведомлением с
 * текстом из словаря. «Передать контрагентов» — вместе с контрагентами (поток А).
 */
export function useStaffActions(): {
  actions: (e: Employee) => ActionEntry[];
  openCard: (e: Employee) => void;
  newEmployee: () => void;
  dialogs: ReactNode;
} {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const refresh = useStaffRefresh();
  const { access, employeeId } = useShell();
  const canManage = access.can('staff');
  const [card, setCard] = useState<DialogSlot<Employee> | null>(null);
  const [role, setRole] = useState<DialogSlot<{
    employee: Employee;
    roles: RoleListItem[];
  }> | null>(null);
  const [hire, setHire] = useState<DialogSlot<NewEmployeeData> | null>(null);
  const [askBlock, setAskBlock] = useState<Employee | null>(null);
  const [reset, setReset] = useState<{ employee: Employee; password: string } | null>(null);
  // Сотрудники, по которым запрос ещё идёт: повторное действие над ними не шлёт второй запрос
  // (иначе окно могло бы показать уже недействительный временный пароль).
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const once = async <T,>(key: string, send: () => Promise<T>): Promise<T | null> => {
    if (pending.has(key)) return null;
    setPending((p) => new Set(p).add(key));
    try {
      return await send();
    } finally {
      setPending((p) => {
        const next = new Set(p);
        next.delete(key);
        return next;
      });
    }
  };
  /** Данные окна загружаются до открытия: поля сразу на месте и фокус — в первом. */
  const load = async <T,>(key: string, fetch: () => Promise<T>): Promise<T | null> => {
    try {
      return await once(key, fetch);
    } catch {
      toast(t('err.unknown'), { bad: true });
      return null;
    }
  };

  const resetPassword = async (e: Employee) => {
    const res = await once(e.id, () =>
      callApi(() => api.api.staff[':id']['password-reset'].$post({ param: { id: e.id } })),
    );
    if (!res) return;
    if (!res.ok) return toast(errorText(res.error), { bad: true });
    const body = TemporaryPasswordResponse.safeParse(res.data);
    if (!body.success) return toast(t('err.unknown'), { bad: true });
    setReset({ employee: e, password: body.data.temporaryPassword });
  };

  const setActive = async (e: Employee, active: boolean) => {
    const res = await once(e.id, () =>
      callApi(() =>
        api.api.staff[':id'][active ? 'unblock' : 'block'].$post({
          param: { id: e.id },
          json: { version: e.version },
        }),
      ),
    );
    if (!res) return;
    refresh();
    if (!res.ok) return toast(errorText(res.error), { bad: true });
    toast(t(active ? 'staff.unblock.done' : 'staff.block.done'), {
      icon: active ? 'check' : 'lock',
    });
  };

  const changeRole = async (e: Employee) => {
    const roles = await load('roles', () => client.fetchQuery(allRolesQuery));
    if (roles) setRole(openSlot({ employee: e, roles }));
  };

  const newEmployee = async () => {
    const data = await load('new', () =>
      Promise.all([
        client.fetchQuery(allRolesQuery),
        client.fetchQuery(policyQuery),
        client.fetchQuery(phoneCodesQuery),
      ]),
    );
    if (data)
      setHire(openSlot({ roles: data[0], defaultRoleId: data[1].defaultRoleId, codes: data[2] }));
  };

  // В карточке — свежая запись (версия для «Заблокировать»); в списке — строка списка.
  const run = {
    open: (e: Employee) => setCard(openSlot(e)),
    changeRole: (e: Employee) => void changeRole(e),
    resetPassword: (e: Employee) => void resetPassword(e),
    block: setAskBlock,
    unblock: (e: Employee) => void setActive(e, true),
  };
  const actions = staffMenu({ canManage, employeeId, t, run });
  const cardActions = staffMenu({ canManage, employeeId, t, run, card: true });

  const dialogs = (
    <>
      {card ? (
        <EmployeeCard
          key={`card-${card.n}`}
          id={card.data.id}
          initial={card.data}
          open={card.open}
          onClose={() => setCard(closeSlot)}
          actions={cardActions}
        />
      ) : null}
      {role ? (
        <ChangeRoleDialog
          key={`role-${role.n}`}
          employee={role.data.employee}
          roles={role.data.roles}
          open={role.open}
          onClose={() => setRole(closeSlot)}
          onDone={refresh}
        />
      ) : null}
      {hire ? (
        <NewEmployeeDialog
          key={`hire-${hire.n}`}
          roles={hire.data.roles}
          defaultRoleId={hire.data.defaultRoleId}
          codes={hire.data.codes}
          open={hire.open}
          onClose={() => setHire(closeSlot)}
          onDone={refresh}
        />
      ) : null}
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

  return {
    actions,
    openCard: run.open,
    newEmployee: () => void newEmployee(),
    dialogs,
  };
}
