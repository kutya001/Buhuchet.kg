'use client';

import {
  ADMIN_STATUS_SCALES,
  statusLook,
  STATUS_TONES,
  type StatusTone,
  type UiTextKey,
} from '@buhuchet/domain';
import type { AdminPeriod, AdminStatus } from '@buhuchet/shared';
import {
  Box,
  Icon,
  iconButtonClass,
  inputClass,
  Note,
  StatusPill,
  Tag,
  useToast,
  type IconName,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, callApi } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { DictHistory } from './dict-history-box';
import { NameDialog, type NameTarget } from './name-dialog';
import { pdictsStatusesQuery, usePdictsRefresh } from './pdicts-data';

const st = api.api.admin['platform-dicts'].statuses;

/** Метка места на шкале: «Этап N», «отметка» или «боковой» с подсказкой (прототип STATUS_GROUPS). */
function placeTag(t: Translate, x: AdminStatus) {
  const place = x.place;
  if (place.kind === 'step') {
    return (
      <Tag wide title={t('pdicts.status.step_title')}>
        {t('pdicts.status.step', { n: place.n })}
      </Tag>
    );
  }
  return (
    <Tag wide title={t(`pdicts.status.${place.kind}_title`)}>
      {t(`pdicts.status.${place.kind}`)}
    </Tag>
  );
}

/**
 * Админка → «Справочники платформы» → «Статусы» (ТЗ «Справочники, на которых держится логика системы»;
 * прототип renderPDicts, вкладка statuses): состав статусов зашит в систему — у каждого статуса место
 * на шкале, метка, выбор цвета и «Переименовать»; ниже — «Периодичность отчётов» с переименованием.
 * Новое название и цвет сразу видят все организации: тексты и цвета приходят со словарём экранов,
 * поэтому после сохранения страница перечитывает словарь.
 */
export function StatusesTab() {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const router = useRouter();
  const client = useQueryClient();
  const refresh = usePdictsRefresh();
  const data = useQuery(pdictsStatusesQuery);
  const [dialog, setDialog] = useState<DialogSlot<NameTarget> | null>(null);

  const done = () => {
    refresh('statuses');
    router.refresh();
  };
  const fresh = () => client.fetchQuery({ ...pdictsStatusesQuery, staleTime: 0 });

  const setTone = async (x: AdminStatus, tone: StatusTone) => {
    const res = await callApi(() =>
      st[':scale'][':code'].tone.$put({
        param: { scale: x.scale, code: x.code },
        json: { tone, version: x.toneVersion },
      }),
    );
    if (res.ok) {
      done();
      return toast(t('pdicts.status.toast_tone'), { icon: 'check' });
    }
    // Цвет успел изменить другой администратор: показать его цвет.
    if (res.error.code === 'record_changed') refresh('statuses');
    toast(errorText(res.error), { bad: true });
  };

  const renameStatus = (x: AdminStatus) =>
    setDialog(
      openSlot<NameTarget>({
        title: t('pdicts.status.title'),
        sub: t('pdicts.status.now', { name: x.name }),
        label: t('pdicts.status.field'),
        hint: t('pdicts.status.hint'),
        name: x.name,
        version: x.nameVersion,
        save: (name, version) =>
          st[':scale'][':code'].name.$put({
            param: { scale: x.scale, code: x.code },
            json: { name, version },
          }),
        reload: async () => {
          const y = (await fresh()).statuses.find((s) => s.scale === x.scale && s.code === x.code);
          return y ? { name: y.name, version: y.nameVersion } : null;
        },
        toast: t('pdicts.status.toast_name'),
      }),
    );

  const renamePeriod = (p: AdminPeriod) =>
    setDialog(
      openSlot<NameTarget>({
        title: t('pdicts.period.title'),
        sub: t('pdicts.status.now', { name: p.name }),
        label: t('pdicts.status.field'),
        hint: t('pdicts.period.hint'),
        name: p.name,
        version: p.nameVersion,
        save: (name, version) =>
          st.periods[':code'].$put({ param: { code: p.code }, json: { name, version } }),
        reload: async () => {
          const y = (await fresh()).periods.find((q) => q.code === p.code);
          return y ? { name: y.name, version: y.nameVersion } : null;
        },
        taken: { code: 'period_taken', text: t('pdicts.err.period_taken') },
        toast: t('pdicts.period.toast'),
      }),
    );

  const statuses = data.data?.statuses ?? [];
  return (
    <div className="flex flex-col gap-3.5">
      <Note icon="lock">{t('pdicts.note.statuses')}</Note>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] items-start gap-3">
        {ADMIN_STATUS_SCALES.map((scale) => {
          const rows = statuses.filter((x) => x.scale === scale);
          if (!rows.length) return null;
          const note =
            scale === 'report' || scale === 'task' ? t(`pdicts.status.note.${scale}`) : null;
          return (
            <div key={scale} data-status-scale={scale} className="contents">
              <Box title={t(`pdicts.status.scale.${scale}`)}>
                {note ? <span className="-mt-1 text-[12px] text-faint">{note}</span> : null}
                {rows.map((x) => (
                  <div
                    key={x.code}
                    data-status={x.code}
                    className="flex flex-wrap items-center gap-2 gap-y-1.5"
                  >
                    {placeTag(t, x)}
                    <StatusPill
                      label={x.name}
                      tone={x.tone}
                      icon={statusLook(x.scale, x.code).icon as IconName}
                    />
                    {x.note ? (
                      <span className="basis-full text-[12px] text-faint">{x.note}</span>
                    ) : null}
                    <div className="flex-1" />
                    <select
                      value={x.tone}
                      aria-label={t('pdicts.status.tone_label', { name: x.name })}
                      onChange={(e) => void setTone(x, e.target.value as StatusTone)}
                      className={`${inputClass({ full: false })} w-[min(140px,100%)] cursor-pointer`}
                    >
                      {STATUS_TONES.map((tone) => (
                        <option key={tone} value={tone}>
                          {t(`pdicts.status.tone.${tone}` as UiTextKey)}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className={iconButtonClass('sm')}
                      title={t('pdicts.status.rename')}
                      aria-label={t('pdicts.status.rename_label', { name: x.name })}
                      onClick={() => renameStatus(x)}
                    >
                      <Icon name="edit" size="sm" />
                    </button>
                  </div>
                ))}
              </Box>
            </div>
          );
        })}
        <div data-periods="" className="contents">
          <Box title={t('pdicts.period.box')}>
            <span className="-mt-1 text-[12px] text-faint">{t('pdicts.period.box_hint')}</span>
            {(data.data?.periods ?? []).map((p) => (
              <div key={p.code} data-period={p.code} className="flex items-center gap-2">
                <Tag wide>{t('pdicts.period.per_year', { n: p.perYear })}</Tag>
                <span className="font-semibold">{p.name}</span>
                <div className="flex-1" />
                <button
                  type="button"
                  className={iconButtonClass('sm')}
                  title={t('pdicts.status.rename')}
                  aria-label={t('pdicts.period.rename_label', { name: p.name })}
                  onClick={() => renamePeriod(p)}
                >
                  <Icon name="edit" size="sm" />
                </button>
              </div>
            ))}
          </Box>
        </div>
      </div>
      <DictHistory dict="statuses" />
      {dialog ? (
        <NameDialog
          key={`name-${dialog.n}`}
          open={dialog.open}
          onClose={() => setDialog(closeSlot)}
          target={dialog.data}
          onDone={done}
        />
      ) : null}
    </div>
  );
}
