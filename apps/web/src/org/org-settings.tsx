'use client';

import { isDigestTime, ORG_TIMEZONES, type OrgTimezone } from '@buhuchet/domain';
import { OrgPolicy, type UpdateOrgPolicyRequest } from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  CheckRow,
  Field,
  FormGrid,
  Hint,
  inputClass,
  Note,
  RecordChangedNotice,
  useToast,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { api, callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import { useShell } from '../shell/context';
import { policyQuery, roleOptionsQuery, useOrgRefresh } from './org-data';

type RoleOption = { id: string; name: string };

/**
 * «Моя организация» → «Настройки» (прототип modules/org.js, renderOrg → settings): часовой пояс, роль по
 * умолчанию для новых сотрудников, повтор напоминания при просрочке и время еженедельной сводки
 * (если включены «Напоминания в Telegram»); «Сохранить настройки». Без права «Настройки и учётная
 * политика» поля только для просмотра. «Хранилище файлов» появится вместе с модулем «Файлы».
 */
export function OrgSettingsTab() {
  const t = useT();
  const { access } = useShell();
  const canEdit = access.can('org');
  const policy = useQuery(policyQuery);
  const roles = useQuery({ ...roleOptionsQuery, enabled: canEdit });
  if (policy.isError || roles.isError) return <Note tone="bad">{t('org.load_error')}</Note>;
  if (!policy.data || (canEdit && !roles.data)) return null;
  const p = policy.data;
  const shown: RoleOption[] =
    roles.data ?? (p.defaultRoleId ? [{ id: p.defaultRoleId, name: p.defaultRoleName ?? '' }] : []);
  return <SettingsForm key={p.version} policy={p} roles={shown} readOnly={!canEdit} />;
}

function SettingsForm({
  policy,
  roles,
  readOnly,
}: {
  policy: OrgPolicy;
  roles: readonly RoleOption[];
  readOnly: boolean;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const refresh = useOrgRefresh();
  const id = useId();
  const [timezone, setTimezone] = useState(policy.timezone);
  const [roleId, setRoleId] = useState(policy.defaultRoleId ?? '');
  const [overdueRepeat, setOverdueRepeat] = useState(policy.overdueRepeat);
  const [digestTime, setDigestTime] = useState(policy.digestTime);
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const telegram = policy.features.telegram;
  const off = readOnly || busy || changed;

  const save = async () => {
    const patch: Omit<UpdateOrgPolicyRequest, 'version'> = {};
    if (timezone !== policy.timezone) patch.timezone = timezone as OrgTimezone;
    if (roleId && roleId !== policy.defaultRoleId) patch.defaultRoleId = roleId;
    if (telegram && overdueRepeat !== policy.overdueRepeat) patch.overdueRepeat = overdueRepeat;
    if (telegram && digestTime !== policy.digestTime && isDigestTime(digestTime)) {
      patch.digestTime = digestTime;
    }
    if (Object.keys(patch).length === 0) return toast(t('org.settings.saved'), { icon: 'check' });
    setBusy(true);
    const res = await callApi(() =>
      api.api.org.policy.$patch({ json: { version: policy.version, ...patch } }),
    );
    setBusy(false);
    if (res.ok) {
      client.setQueryData(policyQuery.queryKey, OrgPolicy.parse(res.data));
      refresh(false);
      return toast(t('org.settings.saved'), { icon: 'check' });
    }
    if (res.error.code === 'record_changed') return setChanged(true);
    toast(errorText(res.error), { bad: true, icon: 'alert' });
  };

  return (
    <div className="flex flex-col gap-3.5">
      {changed ? (
        <RecordChangedNotice
          message={t('err.record_changed')}
          reloadLabel={t('form.reload')}
          onReload={() => void client.invalidateQueries({ queryKey: policyQuery.queryKey })}
        />
      ) : null}
      <Box title={t('org.settings.general')}>
        <FormGrid>
          <Field
            id={`${id}-tz`}
            label={t('org.settings.timezone')}
            hint={t('org.settings.timezone_hint')}
          >
            {(c) => (
              <select
                {...c}
                value={timezone}
                disabled={off}
                onChange={(e) => setTimezone(e.target.value)}
                className={`${inputClass()} cursor-pointer`}
              >
                {ORG_TIMEZONES.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field id={`${id}-role`} label={t('org.settings.default_role')}>
            {(c) => (
              <select
                {...c}
                value={roleId}
                disabled={off}
                onChange={(e) => setRoleId(e.target.value)}
                className={`${inputClass()} cursor-pointer`}
              >
                {roleId ? null : <option value="">—</option>}
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </FormGrid>
      </Box>
      <Box title={t('org.settings.telegram')}>
        {telegram ? (
          <>
            <CheckRow
              plain
              checked={overdueRepeat}
              disabled={off}
              onChange={setOverdueRepeat}
              label={t('org.settings.overdue_repeat')}
            >
              <Hint>{t('org.settings.overdue_repeat_hint')}</Hint>
            </CheckRow>
            <FormGrid>
              <Field id={`${id}-digest`} label={t('org.settings.digest')}>
                {(c) => (
                  <input
                    {...c}
                    type="time"
                    value={digestTime}
                    disabled={off}
                    onChange={(e) => setDigestTime(e.target.value)}
                    className={inputClass()}
                  />
                )}
              </Field>
            </FormGrid>
            <Hint>{t('org.settings.digest_hint')}</Hint>
          </>
        ) : (
          <Note icon="info">{t('org.settings.telegram_off')}</Note>
        )}
      </Box>
      {readOnly ? null : (
        <div className="flex">
          <div className="grow" />
          <button
            type="button"
            className={buttonClass('cta')}
            disabled={busy || changed}
            onClick={() => void save()}
          >
            {t('org.settings.save')}
          </button>
        </div>
      )}
    </div>
  );
}
