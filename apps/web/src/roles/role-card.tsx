'use client';

import { PERMISSION_IDS } from '@buhuchet/domain';
import type { RoleListItem } from '@buhuchet/shared';
import { buttonClass, Icon, Modal, Note } from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../l10n/provider';
import { PermissionGroups } from './permission-groups';
import { permissionCatalogQuery, roleQuery } from './role-data';

const NO_LOCK = () => () => null;

/**
 * Карточка роли (прототип modules/staff.js, roleCard): права по группам модулей только для чтения —
 * зелёная галочка у выданного, серый крестик у остального; область групп — ярлыком. Под названием —
 * сколько активных сотрудников с ролью и сколько у неё прав. У роли владельца — пояснение, что её
 * права не меняются, и нет «Изменить».
 */
export function RoleCard({
  role,
  open,
  onClose,
  onEdit,
}: {
  /** Строка списка: название и счётчики видны, пока роль загружается. */
  role: RoleListItem;
  open: boolean;
  onClose: () => void;
  /** «Изменить» — открыть форму роли; нет — кнопки нет. */
  onEdit: ((role: RoleListItem) => void) | null;
}) {
  const t = useT();
  const full = useQuery(roleQuery(role.id));
  const catalog = useQuery(permissionCatalogQuery);
  const shown = full.data ?? role;
  const failed = full.isError || catalog.isError;

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="card"
      size="wide"
      title={shown.name}
      sub={t('roles.card.sub', {
        n: shown.employees,
        k: shown.permissionCount,
        total: PERMISSION_IDS.length,
      })}
      footer={
        <>
          {onEdit && !role.isOwner ? (
            <button type="button" className={buttonClass('default')} onClick={() => onEdit(shown)}>
              <Icon name="edit" size="sm" />
              {t('roles.action.edit')}
            </button>
          ) : null}
          <div className="flex-1" />
          <button type="button" className={buttonClass('cta')} onClick={onClose}>
            {t('btn.done')}
          </button>
        </>
      }
    >
      <div data-role-card={role.id} className="flex flex-col gap-3.5">
        {role.isOwner ? <Note icon="lock">{t('roles.card.owner_note')}</Note> : null}
        {failed ? <Note tone="bad">{t('roles.load_error')}</Note> : null}
        {full.data && catalog.data ? (
          <PermissionGroups
            catalog={catalog.data}
            state={{ selected: new Set(full.data.permissions), scopes: full.data.scopes }}
            lockWith={NO_LOCK}
          />
        ) : null}
      </div>
    </Modal>
  );
}
