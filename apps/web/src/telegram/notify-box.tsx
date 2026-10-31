'use client';

import {
  notifyKindLocked,
  notifyKindsFor,
  notifyOn,
  withNotifyKind,
  withNotifyMode,
  NOTIFY_MODES,
  type NotifyKind,
  type NotifyMode,
  type UiTextKey,
} from '@buhuchet/domain';
import { NotifySettingsResponse } from '@buhuchet/shared';
import { Box, CHECKBOX_CLASS, CheckRow, Hint, Note, useToast } from '@buhuchet/ui';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, apiFailure, callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';

export const notifySettingsQuery = queryOptions({
  queryKey: ['telegram', 'notify'],
  queryFn: async () => {
    const res = await api.api.telegram.notify.$get();
    if (!res.ok) throw await apiFailure(res);
    return NotifySettingsResponse.parse(await res.json());
  },
});

/**
 * «Уведомления в Telegram» в «Мой профиль» (ТЗ «Уведомления в Telegram»; задача 2.25; прототип
 * modules/profile.js — `notifyBox`, `bindNotify`): у владельца и главного бухгалтера — режим («Все»,
 * «Только просрочки и сводка», «Только ручные задачи») и переключатели по отчётам других сотрудников;
 * у остальных — пояснение и переключатели задач. «По моим отчётам» включено всегда. Смена режима
 * сбрасывает переключатели; то, что не входит в режим, — недоступно. Сохраняется сразу, с уведомлением.
 * У администратора платформы блока нет (его ставит «Мой профиль» только сотруднику).
 */
export function NotifyBox() {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const query = useQuery(notifySettingsQuery);
  const [busy, setBusy] = useState(false);
  const data = query.data;
  if (!data) return null;
  const { boss } = data;
  const settings = { mode: data.mode, off: data.off };

  const save = async (next: { mode: NotifyMode; off: readonly NotifyKind[] }, done: string) => {
    if (busy) return;
    setBusy(true);
    const res = await callApi(() =>
      api.api.telegram.notify.$put({
        json: { version: data.version, mode: next.mode, off: [...next.off] },
      }),
    );
    setBusy(false);
    if (!res.ok) {
      void client.invalidateQueries({ queryKey: notifySettingsQuery.queryKey });
      return toast(errorText(res.error), { bad: true });
    }
    const saved = NotifySettingsResponse.safeParse(res.data);
    if (saved.success) client.setQueryData(notifySettingsQuery.queryKey, saved.data);
    toast(done, { icon: 'bell' });
  };

  return (
    <Box title={t('profile.notify')}>
      <div data-profile-notify="" className="flex flex-col">
        {boss ? (
          <div
            role="radiogroup"
            aria-label={t('profile.notify.modes')}
            className="mb-1.5 flex flex-col rounded-lg border border-line p-1"
          >
            {NOTIFY_MODES.map((mode) => (
              <label
                key={mode}
                className="flex cursor-pointer items-start gap-2 rounded-[5px] px-[7px] py-[5px] text-[13px] hover:bg-row-hover"
              >
                <input
                  type="radio"
                  name="profile-notify-mode"
                  value={mode}
                  className={`${CHECKBOX_CLASS} mt-0.5`}
                  checked={data.mode === mode}
                  disabled={busy}
                  onChange={() => void save(withNotifyMode(mode), t('profile.notify.mode_saved'))}
                />
                <span>
                  <b>{t(`profile.notify.mode.${mode}` as UiTextKey)}</b>
                  <Hint>{t(`profile.notify.mode.${mode}_hint` as UiTextKey)}</Hint>
                </span>
              </label>
            ))}
          </div>
        ) : (
          <Note icon="info">{t('profile.notify.staff_note')}</Note>
        )}
        <CheckRow
          checked
          disabled
          plain
          onChange={() => {}}
          label={t('profile.notify.mine')}
          data-notify-kind="mine"
        />
        {notifyKindsFor(boss).map((kind) => (
          <CheckRow
            key={kind}
            plain
            checked={notifyOn(settings, boss, kind)}
            disabled={busy || notifyKindLocked(settings, boss, kind)}
            onChange={(on) =>
              void save(
                withNotifyKind(settings, kind, on),
                t(on ? 'profile.notify.on' : 'profile.notify.off'),
              )
            }
            label={t(`profile.notify.kind.${kind}` as UiTextKey)}
            data-notify-kind={kind}
          />
        ))}
        <Hint>{t(boss ? 'profile.notify.boss_hint' : 'profile.notify.staff_hint')}</Hint>
      </div>
    </Box>
  );
}
