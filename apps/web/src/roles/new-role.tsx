'use client';

import { ROLE_NAME_MAX_LENGTH, Role, type RoleListItem } from '@buhuchet/shared';
import { buttonClass, Field, inputClass, Modal, useToast, useWindow } from '@buhuchet/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useId, useState, type ReactNode } from 'react';
import { api, callApi } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useErrorText, useT } from '../l10n/provider';
import { tabHref } from '../shell/modules';
import { allRolesQuery, useStaffRefresh } from '../staff/staff-data';

/** «Скопировать права из» по умолчанию — роль из шаблона «Бухгалтер» (прототип roleAddDlg: `'acc'`). */
const COPY_FROM_TEMPLATE = 'acc';

/** Окно, из которого создали роль: закрыть или закрыть перед переходом с заменой записи истории. */
type WindowControl = ReturnType<typeof useWindow>;

/** Адрес вкладки «Роли» с открытой формой роли. */
export const roleEditHref = (id: string) =>
  `${tabHref('staff', 'roles')}?edit=${encodeURIComponent(id)}`;

/**
 * «Новая роль» (прототип modules/staff.js, roleAddDlg): «Название» и «Скопировать права из» — по
 * умолчанию «Бухгалтер» (роль из шаблона платформы `acc`, как в прототипе). Права копирует сервер: не владелец не получит
 * права, которые выдаёт только владелец, и те, которых нет у него самого. После «Создать» — вкладка
 * «Роли», уведомление «Роль создана: отметьте её права» и форма прав новой роли.
 */
function NewRoleDialog({
  roles,
  copyFrom,
  open,
  onClose,
  onDone,
}: {
  roles: readonly RoleListItem[];
  copyFrom: string;
  open: boolean;
  onClose: () => void;
  /** Роль создана; окно закрывает получатель (`close` или `leave` перед переходом). */
  onDone: (role: Role, win: WindowControl) => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const id = useId();
  const [name, setName] = useState('');
  const [source, setSource] = useState(copyFrom);
  const [nameError, setNameError] = useState<string | undefined>();
  const [sourceError, setSourceError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const create = async (win: WindowControl) => {
    const value = name.trim();
    if (!value) {
      setNameError(t('roles.err.name'));
      return document.getElementById(`${id}-name`)?.focus();
    }
    setBusy(true);
    const res = await callApi(() =>
      api.api.roles.$post({ json: { name: value, ...(source ? { copyFromRoleId: source } : {}) } }),
    );
    setBusy(false);
    if (res.ok) {
      const role = Role.safeParse(res.data);
      if (role.success) return onDone(role.data, win);
      return onClose();
    }
    if (res.error.code === 'role_not_found') return setSourceError(errorText(res.error));
    setNameError(errorText(res.error));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      title={t('roles.new.title')}
      dirty={name.trim() !== ''}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.cancel')}
          </button>
          <CreateButton busy={busy} label={t('btn.create')} onCreate={(win) => void create(win)} />
        </>
      }
    >
      <Field id={`${id}-name`} label={t('roles.new.name')} required error={nameError}>
        {(control) => (
          <input
            {...control}
            type="text"
            className={inputClass()}
            value={name}
            maxLength={ROLE_NAME_MAX_LENGTH}
            onChange={(e) => {
              setName(e.target.value);
              setNameError(undefined);
            }}
          />
        )}
      </Field>
      <Field id={`${id}-from`} label={t('roles.new.copy')} error={sourceError}>
        {(control) => (
          <select
            {...control}
            className={`${inputClass()} cursor-pointer`}
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setSourceError(undefined);
            }}
          >
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        )}
      </Field>
    </Modal>
  );
}

/** «Создать» в нижней строке окна: знает своё окно, чтобы закрыть его перед переходом. */
function CreateButton({
  busy,
  label,
  onCreate,
}: {
  busy: boolean;
  label: string;
  onCreate: (win: WindowControl) => void;
}) {
  const win = useWindow();
  return (
    <button
      type="button"
      className={buttonClass('cta')}
      disabled={busy}
      onClick={() => onCreate(win)}
    >
      {label}
    </button>
  );
}

/**
 * «+ Добавить» → «Роль»: окно «Новая роль»; роли для выбора загружаются до открытия. Новую роль
 * открывает `onCreated` (на вкладке «Роли» — её форма), а без него — переход на вкладку «Роли» с
 * `?edit=`: окно закрывается, переход заменяет его запись в истории («Назад» не вернёт к окну).
 */
export function useNewRole(onCreated?: (role: Role) => void): {
  open: () => void;
  dialog: ReactNode;
} {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const client = useQueryClient();
  const refresh = useStaffRefresh();
  const [slot, setSlot] = useState<DialogSlot<{ roles: RoleListItem[]; copyFrom: string }> | null>(
    null,
  );

  const open = async () => {
    try {
      const roles = await client.fetchQuery(allRolesQuery);
      const copyFrom =
        roles.find((r) => r.templateCode === COPY_FROM_TEMPLATE)?.id ??
        roles.find((r) => !r.isOwner)?.id ??
        roles[0]?.id ??
        '';
      setSlot(openSlot({ roles, copyFrom }));
    } catch {
      toast(t('err.unknown'), { bad: true });
    }
  };

  const dialog = slot ? (
    <NewRoleDialog
      key={`new-role-${slot.n}`}
      roles={slot.data.roles}
      copyFrom={slot.data.copyFrom}
      open={slot.open}
      onClose={() => setSlot(closeSlot)}
      onDone={(role, win) => {
        refresh();
        toast(t('roles.new.done'), { icon: 'shield' });
        if (onCreated) {
          win.close();
          return onCreated(role);
        }
        win.leave();
        router.replace(roleEditHref(role.id), { scroll: false });
      }}
    />
  ) : null;

  return { open: () => void open(), dialog };
}
