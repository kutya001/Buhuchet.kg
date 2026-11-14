'use client';

import { ORG_TIMEZONES, type OrgTimezone } from '@buhuchet/domain';
import { OrgPolicy, type UpdateOrgPolicyRequest } from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  Field,
  FormGrid,
  inputClass,
  Note,
  RecordChangedNotice,
  useToast,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { api, callApi } from '../api-client';
import { FilesStorageBox } from '../files/storage-box';
import { useKb } from '../kb/kb-provider';
import { useErrorText, useT } from '../l10n/provider';
import { useShell } from '../shell/context';
import { TelegramNoticesBox, type NoticeSave } from '../telegram/notices';
import { policyQuery, roleOptionsQuery, useOrgRefresh } from './org-data';

type RoleOption = { id: string; name: string };

/**
 * Несохранённые поля формы: строки блока «Telegram-уведомления» сохраняются сразу, часовой пояс и роль
 * по умолчанию при этом не теряются.
 * Черновик годится только для той версии политики, которую вернуло это сохранение: пришла другая
 * версия (правка в другой вкладке, опросник) — он не применяется, иначе поверх свежей записи легли бы
 * старые значения полей мимо проверки версии.
 */
interface Drafts {
  version: number;
  timezone: string;
  roleId: string;
}

/**
 * «Моя организация» → «Настройки» (прототип modules/org.js, renderOrg → settings): часовой пояс и роль по
 * умолчанию для новых сотрудников — «Сохранить настройки»; ниже — блок «Telegram-уведомления» (пакет
 * 14.11.2026, блок 3; прототип v111): его строки сохраняются сразу. Без права «Настройки и учётная
 * политика» (оно только у владельца) всё только для просмотра. Вверху — «Хранилище файлов» (задача 2.29).
 */
export function OrgSettingsTab() {
  const t = useT();
  const { access } = useShell();
  const canEdit = access.can('org');
  const policy = useQuery(policyQuery);
  const roles = useQuery({ ...roleOptionsQuery, enabled: canEdit });
  const [drafts, setDrafts] = useState<Drafts | null>(null);
  if (policy.isError || roles.isError) return <Note tone="bad">{t('org.load_error')}</Note>;
  if (!policy.data || (canEdit && !roles.data)) return null;
  const p = policy.data;
  const shown: RoleOption[] =
    roles.data ?? (p.defaultRoleId ? [{ id: p.defaultRoleId, name: p.defaultRoleName ?? '' }] : []);
  return (
    <SettingsForm
      key={p.version}
      policy={p}
      roles={shown}
      readOnly={!canEdit}
      drafts={drafts && drafts.version === p.version ? drafts : null}
      onDrafts={setDrafts}
    />
  );
}

function SettingsForm({
  policy,
  roles,
  readOnly,
  drafts,
  onDrafts,
}: {
  policy: OrgPolicy;
  roles: readonly RoleOption[];
  readOnly: boolean;
  /** Поля, которые правили до правки блока «Telegram-уведомления» (форма после неё создаётся заново). */
  drafts: Drafts | null;
  onDrafts: (drafts: Drafts | null) => void;
}) {
  const t = useT();
  const toast = useToast();
  const kb = useKb();
  const errorText = useErrorText();
  const client = useQueryClient();
  const refresh = useOrgRefresh();
  const id = useId();
  const [timezone, setTimezone] = useState(drafts?.timezone ?? policy.timezone);
  const [roleId, setRoleId] = useState(drafts?.roleId ?? policy.defaultRoleId ?? '');
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const off = readOnly || busy || changed;

  const save = async () => {
    const patch: Omit<UpdateOrgPolicyRequest, 'version'> = {};
    if (timezone !== policy.timezone) patch.timezone = timezone as OrgTimezone;
    if (roleId && roleId !== policy.defaultRoleId) patch.defaultRoleId = roleId;
    if (Object.keys(patch).length === 0) {
      // Без изменений истории нет — шаг «Проверить часовой пояс…» засчитывается самим сохранением.
      kb.hit('settings');
      return toast(t('org.settings.saved'), { icon: 'check' });
    }
    setBusy(true);
    const res = await callApi(() =>
      api.api.org.policy.$patch({ json: { version: policy.version, ...patch } }),
    );
    setBusy(false);
    if (res.ok) {
      onDrafts(null);
      client.setQueryData(policyQuery.queryKey, OrgPolicy.parse(res.data));
      refresh(false);
      return toast(t('org.settings.saved'), { icon: 'check' });
    }
    if (res.error.code === 'record_changed') return setChanged(true);
    toast(errorText(res.error), { bad: true, icon: 'alert' });
  };

  /**
   * Строка блока «Telegram-уведомления» сохраняется сразу (прототип v111 `tgnMount`, `#st-tgact`,
   * `pgTgNoticeMount`): одно поле с версией политики; несохранённые часовой пояс и роль остаются.
   */
  const saveNow: NoticeSave = async (patch, done) => {
    if (readOnly || busy || changed) return;
    setBusy(true);
    const res = await callApi(() =>
      api.api.org.policy.$patch({ json: { version: policy.version, ...patch } }),
    );
    setBusy(false);
    if (res.ok) {
      const saved = OrgPolicy.parse(res.data);
      onDrafts({ version: saved.version, timezone, roleId });
      client.setQueryData(policyQuery.queryKey, saved);
      refresh(false);
      return toast(done, { icon: 'tg' });
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
          onReload={() => {
            onDrafts(null);
            void client.invalidateQueries({ queryKey: policyQuery.queryKey });
          }}
        />
      ) : null}
      <FilesStorageBox />
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
      <TelegramNoticesBox policy={policy} own={!readOnly} busy={off} save={saveNow} />
    </div>
  );
}
