'use client';

import { kbLevelsProblem, type KbLevelSet, type UiTextKey } from '@buhuchet/domain';
import { AdminKbLevelsSaved, type AdminKbLevels } from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  EmptyState,
  inputClass,
  Note,
  RecordChangedNotice,
  useToast,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import { kb, kbAdminLevelsQuery, refreshKbAdmin } from './kbadm-data';
import { KbAdmHistory } from './kbadm-history';

type Level = AdminKbLevels['business'][number];

/** Шапка и ячейки маленькой таблицы (прототип `table.mini`). */
const TH = 'border-b border-line px-2 py-1.5 text-[11.5px] font-[650] text-faint';
const TD = 'px-2 py-[7px] align-middle';

/**
 * Админка → «База знаний (содержимое)» → «Уровни» (ТЗ; прототип admin/kb-content.js, вкладка
 * `levels`): названия и пороги уровней пользователей организаций и администраторов платформы — для
 * всех сразу, полученные уровни не отнимаются. Число уровней не меняется: строк не добавить и не удалить, как в прототипе.
 */
export function KbAdmLevelsTab() {
  const t = useT();
  const levels = useQuery(kbAdminLevelsQuery);
  return (
    <div className="flex flex-col gap-3.5">
      <Note icon="info">{t('kbadm.levels.note')}</Note>
      {levels.data ? (
        <>
          <LevelsBox
            key={`b-${levels.data.version}`}
            set="business"
            data={levels.data}
            onReload={() => void levels.refetch()}
          />
          <LevelsBox
            key={`a-${levels.data.version}`}
            set="admin"
            data={levels.data}
            onReload={() => void levels.refetch()}
          />
        </>
      ) : levels.isError ? (
        <EmptyState icon="alert" title={t('err.unknown')} />
      ) : null}
      <KbAdmHistory section="kblevels" />
    </div>
  );
}

/** Блок уровней одной программы: таблица «№ / Название уровня / Порог, %», «Сохранить». */
function LevelsBox({
  set,
  data,
  onReload,
}: {
  set: KbLevelSet;
  data: AdminKbLevels;
  onReload: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const [rows, setRows] = useState<Level[]>(() => data[set]);
  const [error, setError] = useState('');
  const [changed, setChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const title = t(set === 'business' ? 'kbadm.levels.business' : 'kbadm.levels.admin');
  const edit = (j: number, patch: Partial<Level>) =>
    setRows((list) => list.map((l, k) => (k === j ? { ...l, ...patch } : l)));

  const save = async () => {
    const next = rows.map((l, j) => ({ n: l.n.trim(), p: j === 0 ? 0 : l.p }));
    const problem = kbLevelsProblem(next);
    setError(problem ? t(`kbadm.err.${problem}`) : '');
    if (problem) return;
    setSaving(true);
    const res = await callApi(() =>
      kb.levels[':set'].$put({ param: { set }, json: { levels: next, version: data.version } }),
    );
    setSaving(false);
    if (!res.ok) {
      if (res.error.code === 'record_changed') return setChanged(true);
      if (res.error.code.startsWith('kb_level')) {
        return setError(t(`kbadm.err.${res.error.code}` as UiTextKey));
      }
      return toast(errorText(res.error), { bad: true });
    }
    if (!AdminKbLevelsSaved.parse(res.data).changed) return toast(t('kbadm.levels.no_changes'));
    refreshKbAdmin(client);
    toast(t('kbadm.levels.saved'), { icon: 'check' });
  };

  return (
    <div data-kbadm-levels={set}>
      <Box title={title}>
        {changed ? (
          <RecordChangedNotice
            message={t('err.record_changed')}
            reloadLabel={t('form.reload')}
            onReload={onReload}
            reloading={false}
          />
        ) : null}
        {/* Таблица и на телефоне (прототип `table.mini` без карточек): поля в строке. */}
        <table aria-label={title} className="w-full border-collapse text-[13px] tabular-nums">
          <thead>
            <tr>
              <th scope="col" className={`${TH} w-10 text-left`}>
                {t('kbadm.levels.col.n')}
              </th>
              <th scope="col" className={`${TH} text-left`}>
                {t('kbadm.levels.col.name')}
              </th>
              <th scope="col" className={`${TH} w-[110px] text-right`}>
                {t('kbadm.levels.col.pct')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l, j) => (
              <tr key={j} className="[&>td]:border-b [&>td]:border-line last:[&>td]:border-b-0">
                <td className={TD}>{j + 1}</td>
                <td className={TD}>
                  <input
                    value={l.n}
                    onChange={(e) => edit(j, { n: e.target.value })}
                    aria-label={t('kbadm.levels.name_aria', { n: j + 1 })}
                    className={`${inputClass()} max-w-[540px]`}
                  />
                </td>
                <td className={`${TD} text-right`}>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={l.p}
                    disabled={j === 0}
                    onChange={(e) => edit(j, { p: Number(e.target.value) })}
                    aria-label={t('kbadm.levels.pct_aria', { n: j + 1 })}
                    className={`${inputClass()} max-w-[90px] text-right`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <span className="flex-1 text-[11.5px] leading-[1.4] text-faint">
            {t('kbadm.levels.hint')}
          </span>
          <button
            type="button"
            className={buttonClass('cta', 'sm')}
            disabled={saving || changed}
            onClick={() => void save()}
          >
            {t('btn.save')}
          </button>
        </div>
        {error ? (
          <div role="alert" className="mt-1.5 text-[11.5px] leading-[1.4] text-danger">
            {error}
          </div>
        ) : null}
      </Box>
    </div>
  );
}
