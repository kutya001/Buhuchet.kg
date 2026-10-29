'use client';

import {
  isPermissionId,
  PERMISSION_GROUPS,
  PERMISSIONS,
  SCOPE_GROUPS,
  TEMPLATE_PERMISSION_COUNT,
  templatePermissionLock,
  type PermissionGroupId,
  type PermissionId,
  type Scope,
  type ScopeGroupId,
} from '@buhuchet/domain';
import type { AdminPermission, AdminRoleTemplate } from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  Icon,
  iconButtonClass,
  Modal,
  Note,
  RecordChangedNotice,
  useToast,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, callApi } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useErrorText, useT } from '../l10n/provider';
import { PermissionGroups } from '../roles/permission-groups';
import type { CatalogPermission, PermissionState } from '../roles/permission-view';
import { DictHistory } from './dict-history-box';
import { NameDialog, type NameTarget } from './name-dialog';
import { pdictsPermissionsQuery, pdictsRoleTemplatesQuery, usePdictsRefresh } from './pdicts-data';

const roletpl = api.api.admin['platform-dicts'].roletpl;

/** Сколько прав в группе (прототип: «Контрагенты · 3 из 4»). */
const GROUP_SIZE = new Map<PermissionGroupId, number>(
  PERMISSION_GROUPS.map((g) => [g.id, PERMISSIONS.filter(([, group]) => group === g.id).length]),
);

/** Права шаблона из каталога и область по группам — состояние формы прав. */
function stateOf(x: AdminRoleTemplate): PermissionState {
  const scopes: Partial<Record<ScopeGroupId, Scope>> = {};
  for (const g of SCOPE_GROUPS) {
    const scope = x.scopes[g];
    if (scope === 'own' || scope === 'all') scopes[g] = scope;
  }
  return { selected: new Set(x.permissions.filter(isPermissionId)), scopes };
}

const sameSet = (a: ReadonlySet<string>, b: readonly string[]) =>
  a.size === b.length && b.every((p) => a.has(p));

/** Свободное ли право для галочки: шаблону не дают права только владельца и права без просмотра. */
const lockWith = (selected: ReadonlySet<PermissionId>) => (p: PermissionId) =>
  templatePermissionLock(p, selected);

/** У шаблона учётной политики нет: все модули включены. */
const allFeatures = () => true;

/**
 * Окно «Права шаблона роли» (прототип roleTplPermsDlg): права по группам, как в форме роли
 * организации, с поиском, «Выбрать все» и областью «Свои / Все контрагенты»; права только владельца
 * закрыты, права группы — только вместе с просмотром. Внизу — «Выбрано прав: N из M». Ничего не
 * изменено — «Изменений нет».
 */
function TemplatePermsDialog({
  open,
  onClose,
  item,
  catalog,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  item: AdminRoleTemplate;
  catalog: readonly CatalogPermission[];
  onDone: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const [base, setBase] = useState(item);
  const [state, setState] = useState(() => stateOf(item));
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(false);
  const [reloading, setReloading] = useState(false);
  const scopes = Object.fromEntries(
    SCOPE_GROUPS.flatMap((g) => (state.scopes[g] ? [[g, state.scopes[g]]] : [])),
  ) as Record<string, Scope>;
  const dirty =
    !sameSet(state.selected, base.permissions) ||
    SCOPE_GROUPS.some((g) => (state.scopes[g] ?? 'own') !== (base.scopes[g] ?? 'own'));

  const reload = async () => {
    setReloading(true);
    const all = await client
      .fetchQuery({ ...pdictsRoleTemplatesQuery, staleTime: 0 })
      .catch(() => null);
    setReloading(false);
    const fresh = all?.find((x) => x.code === item.code);
    if (!fresh) return toast(t('err.unknown'), { bad: true });
    setBase(fresh);
    setState(stateOf(fresh));
    setChanged(false);
  };

  const save = async () => {
    if (!dirty) {
      onClose();
      return toast(t('pdicts.roletpl.no_changes'));
    }
    setSaving(true);
    const res = await callApi(() =>
      roletpl[':code'].$put({
        param: { code: item.code },
        json: {
          name: base.name,
          permissions: [...state.selected],
          scopes,
          version: base.version,
        },
      }),
    );
    setSaving(false);
    if (res.ok) {
      onDone();
      onClose();
      return toast(t('pdicts.roletpl.toast'), { icon: 'check' });
    }
    const code = res.error.code;
    if (code === 'record_changed') return setChanged(true);
    if (code === 'roletpl_view_required' || code === 'roletpl_owner_only') {
      return toast(
        t(code === 'roletpl_owner_only' ? 'pdicts.err.owner_only' : 'pdicts.err.view_required'),
        {
          bad: true,
        },
      );
    }
    toast(errorText(res.error), { bad: true });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      size="wide"
      title={t('pdicts.roletpl.perms_title')}
      sub={base.name}
      dirty={dirty}
      footer={
        <>
          <span className="text-[12px] text-faint">
            {t('pdicts.roletpl.selected', {
              n: state.selected.size,
              m: TEMPLATE_PERMISSION_COUNT,
            })}
          </span>
          <div className="flex-1" />
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.cancel')}
          </button>
          <button
            type="button"
            className={buttonClass('cta')}
            disabled={saving || changed}
            onClick={() => void save()}
          >
            {t('btn.save')}
          </button>
        </>
      }
    >
      {changed ? (
        <RecordChangedNotice
          message={t('err.record_changed')}
          reloadLabel={t('form.reload')}
          onReload={() => void reload()}
          reloading={reloading}
        />
      ) : null}
      <PermissionGroups
        catalog={catalog}
        state={state}
        lockWith={lockWith}
        feature={allFeatures}
        onChange={setState}
      />
    </Modal>
  );
}

type Dialog = { kind: 'name'; target: NameTarget } | { kind: 'perms'; item: AdminRoleTemplate };

/**
 * Админка → «Справочники платформы» → «Шаблоны ролей» (ТЗ «Шаблоны для организаций»; прототип
 * renderPDicts, вкладка roletpl): карточка шаблона — название с «Переименовать», «N из M прав», права
 * по группам и «Права». Новая организация получает копии этих ролей; роли уже созданных организаций
 * правка шаблона не меняет.
 */
export function RoletplTab() {
  const t = useT();
  const client = useQueryClient();
  const refresh = usePdictsRefresh();
  const templates = useQuery(pdictsRoleTemplatesQuery);
  const permissions = useQuery(pdictsPermissionsQuery);
  const [dialog, setDialog] = useState<DialogSlot<Dialog> | null>(null);
  const catalog = useMemo(
    () =>
      (permissions.data ?? []).flatMap((p: AdminPermission): CatalogPermission[] =>
        isPermissionId(p.id)
          ? [
              {
                id: p.id,
                group: p.group as PermissionGroupId,
                name: p.name,
                description: p.description,
              },
            ]
          : [],
      ),
    [permissions.data],
  );

  const rename = (x: AdminRoleTemplate) =>
    setDialog(
      openSlot<Dialog>({
        kind: 'name',
        target: {
          title: t('pdicts.roletpl.title'),
          label: t('pdicts.col.name'),
          name: x.name,
          version: x.version,
          save: (name, version) =>
            roletpl[':code'].$put({
              param: { code: x.code },
              json: {
                name,
                permissions: x.permissions,
                scopes: x.scopes as Record<string, Scope>,
                version,
              },
            }),
          reload: async () => {
            const all = await client.fetchQuery({ ...pdictsRoleTemplatesQuery, staleTime: 0 });
            const y = all.find((z) => z.code === x.code);
            return y ? { name: y.name, version: y.version } : null;
          },
          taken: { code: 'roletpl_taken', text: t('pdicts.err.roletpl_taken') },
          toast: t('pdicts.toast.saved'),
        },
      }),
    );

  return (
    <div className="flex flex-col gap-3.5">
      <Note icon="info">{t('pdicts.note.roletpl')}</Note>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(320px,100%),1fr))] items-start gap-3">
        {(templates.data ?? []).map((x) => {
          const own = new Set(x.permissions);
          return (
            <div key={x.code} data-role-template={x.code} className="contents">
              <Box>
                <div className="flex items-center gap-2">
                  <h3 className="m-0 text-[15px] font-bold">{x.name}</h3>
                  <div className="flex-1" />
                  <button
                    type="button"
                    className={iconButtonClass('sm')}
                    title={t('pdicts.status.rename')}
                    aria-label={t('pdicts.roletpl.rename_label', { name: x.name })}
                    onClick={() => rename(x)}
                  >
                    <Icon name="edit" size="sm" />
                  </button>
                </div>
                <span className="text-[12px] text-faint">
                  {t('pdicts.roletpl.count', {
                    n: x.permissions.filter(isPermissionId).length,
                    m: TEMPLATE_PERMISSION_COUNT,
                  })}
                </span>
                {PERMISSION_GROUPS.map((g) => {
                  const n = PERMISSIONS.filter(([p, group]) => group === g.id && own.has(p)).length;
                  return n ? (
                    <div key={g.id} className="text-[12.5px] text-muted">
                      {t('pdicts.roletpl.group', {
                        group: t(`roles.group.${g.id}`),
                        n,
                        m: GROUP_SIZE.get(g.id) ?? 0,
                      })}
                    </div>
                  ) : null;
                })}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className={buttonClass('default', 'sm')}
                    disabled={!catalog.length}
                    onClick={() => setDialog(openSlot<Dialog>({ kind: 'perms', item: x }))}
                  >
                    <Icon name="shield" size="sm" />
                    {t('pdicts.roletpl.perms')}
                  </button>
                </div>
              </Box>
            </div>
          );
        })}
      </div>
      <DictHistory dict="roletpl" />
      {dialog?.data.kind === 'name' ? (
        <NameDialog
          key={`name-${dialog.n}`}
          open={dialog.open}
          onClose={() => setDialog(closeSlot)}
          target={dialog.data.target}
          onDone={() => refresh('roletpl')}
        />
      ) : null}
      {dialog?.data.kind === 'perms' ? (
        <TemplatePermsDialog
          key={`perms-${dialog.n}`}
          open={dialog.open}
          onClose={() => setDialog(closeSlot)}
          item={dialog.data.item}
          catalog={catalog}
          onDone={() => refresh('roletpl')}
        />
      ) : null}
    </div>
  );
}
