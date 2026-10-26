'use client';

import {
  PERMISSION_IDS,
  rolePermissionLock,
  SCOPE_GROUPS,
  type PermissionId,
  type UiTextKey,
} from '@buhuchet/domain';
import { ROLE_NAME_MAX_LENGTH, Role } from '@buhuchet/shared';
import {
  buttonClass,
  Field,
  inputClass,
  Modal,
  Note,
  RecordChangedNotice,
  useToast,
} from '@buhuchet/ui';
import { useId, useState } from 'react';
import { api, callApi } from '../api-client';
import type { ApiErrorLike } from '../l10n/translate';
import { useErrorText, useT } from '../l10n/provider';
import { useShell } from '../shell/context';
import { PermissionGroups } from './permission-groups';
import type { CatalogPermission, PermissionState } from './permission-view';

/** Почему галочка закрыта (`RoleLock`) — текст `roles.lock.<код>`. */
const LOCK_CODES = new Set([
  'owner_role',
  'view_required',
  'owner_only',
  'own_role',
  'owner_granted',
]);
/** Почему роль не сохранить сверх галочек (`RoleChangeLock`) — текст `roles.err.<код>`. */
const SAVE_CODES = new Set(['owner_granted_role', 'beyond_own', 'beyond_own_scope']);

/**
 * Отказ сервера в сохранении роли — своими текстами: коды совпадают с отказами в действиях над
 * сотрудником («Роль с правами шире ваших назначает и снимает владелец»), а речь о правах роли.
 */
export function roleSaveErrorKey(code: string): UiTextKey | null {
  if (LOCK_CODES.has(code)) return `roles.lock.${code}` as UiTextKey;
  if (SAVE_CODES.has(code)) return `roles.err.${code}` as UiTextKey;
  return null;
}

const stateOf = (role: Role): PermissionState => ({
  selected: new Set(role.permissions),
  scopes: role.scopes,
});

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every((x) => b.has(x));

/**
 * Форма роли «Права роли» (ТЗ «Сотрудники» → «Вкладка Роли»; прототип modules/staff.js, roleForm):
 * «Название роли», поиск и права по группам модулей с областью «Свои / Все контрагенты»; внизу —
 * «Выбрано прав: N из 39», «Отмена» и «Сохранить». Галочки закрыты по тем же правилам, что проверяет
 * сервер (`rolePermissionLock`: права владельца, «Сначала дайте просмотр», право только владельца,
 * своя роль, право выдаёт только владелец); остальные отказы сервера (docs/deviations.md, п. 15) —
 * текстом над правами. Запись изменили другие — «Запись изменена другим пользователем» и «Перечитать».
 */
export function RoleForm({
  role: initial,
  catalog,
  open,
  onClose,
  onDone,
}: {
  role: Role;
  catalog: readonly CatalogPermission[];
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const { role: mine } = useShell();
  const id = useId();
  const [role, setRole] = useState(initial);
  const [name, setName] = useState(initial.name);
  const [state, setState] = useState(() => stateOf(initial));
  const [nameError, setNameError] = useState<string | undefined>();
  const [refusal, setRefusal] = useState<string | undefined>();
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const editor = { isOwner: mine?.isOwner ?? false, roleId: mine?.id ?? '' };
  const lockWith = (selected: ReadonlySet<PermissionId>) => (p: PermissionId) =>
    rolePermissionLock(editor, role, p, selected);
  const scopes = Object.fromEntries(SCOPE_GROUPS.map((g) => [g, state.scopes[g] ?? 'own']));
  const dirty =
    name !== role.name ||
    !sameSet(state.selected, new Set(role.permissions)) ||
    SCOPE_GROUPS.some((g) => scopes[g] !== (role.scopes[g] ?? 'own'));

  const showError = (error: ApiErrorLike) => {
    if (error.code === 'role_name_taken') return setNameError(errorText(error));
    const key = roleSaveErrorKey(error.code);
    setRefusal(key ? t(key) : errorText(error));
  };

  const reload = async () => {
    setBusy(true);
    const res = await callApi(() => api.api.roles[':id'].$get({ param: { id: role.id } }));
    setBusy(false);
    const fresh = res.ok ? Role.safeParse(res.data) : null;
    if (!fresh?.success) return toast(t('err.unknown'), { bad: true });
    setRole(fresh.data);
    setName(fresh.data.name);
    setState(stateOf(fresh.data));
    setChanged(false);
    setRefusal(undefined);
    setNameError(undefined);
  };

  const save = async () => {
    const value = name.trim();
    if (!value) {
      setNameError(t('roles.err.name'));
      return document.getElementById(`${id}-name`)?.focus();
    }
    if (!dirty) return onClose();
    setBusy(true);
    setRefusal(undefined);
    const res = await callApi(() =>
      api.api.roles[':id'].$patch({
        param: { id: role.id },
        json: {
          version: role.version,
          name: value,
          permissions: PERMISSION_IDS.filter((p) => state.selected.has(p)),
          scopes,
        },
      }),
    );
    setBusy(false);
    if (res.ok) {
      onDone();
      onClose();
      return toast(t('roles.form.done'), { icon: 'shield' });
    }
    if (res.error.code === 'record_changed') return setChanged(true);
    showError(res.error);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      size="wide"
      title={t('roles.form.title')}
      sub={role.name}
      dirty={dirty}
      footer={
        <>
          <span data-role-count="" className="text-[11.5px] leading-[1.4] text-faint">
            {t('roles.form.count', { n: state.selected.size, total: PERMISSION_IDS.length })}
          </span>
          <div className="flex-1" />
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.cancel')}
          </button>
          <button
            type="button"
            className={buttonClass('cta')}
            disabled={busy || changed}
            onClick={() => void save()}
          >
            {t('btn.save')}
          </button>
        </>
      }
    >
      <div data-role-form={role.id} className="flex flex-col gap-3.5">
        {changed ? (
          <RecordChangedNotice
            message={t('err.record_changed')}
            reloadLabel={t('form.reload')}
            onReload={() => void reload()}
            reloading={busy}
          />
        ) : null}
        <Field id={`${id}-name`} label={t('roles.form.name')} required error={nameError}>
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
        {refusal ? (
          <Note tone="bad" alert>
            {refusal}
          </Note>
        ) : null}
        <PermissionGroups
          catalog={catalog}
          state={state}
          lockWith={lockWith}
          onChange={(next) => {
            setState(next);
            setRefusal(undefined);
          }}
        />
      </div>
    </Modal>
  );
}
