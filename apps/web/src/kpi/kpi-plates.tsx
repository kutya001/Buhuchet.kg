'use client';

import type { UiTextKey } from '@buhuchet/domain';
import { Plate, Plates } from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../l10n/provider';
import { useModuleStats } from '../lists/stats';
import { monthQuery } from './kpi-data';
import { useKpiChoice } from './kpi-state';

/**
 * «Статистика» модуля (ТЗ «Статистика модуля: заполнено за месяц, не заполнено, просрочено заполнение,
 * проверено»; прототип `kPlates`) — за месяц, выбранный в «Вводе за месяц», на вкладках «Ввод за месяц»,
 * «За период» и «Не заполнено».
 */
export function KpiPlates() {
  const t = useT();
  const stats = useModuleStats('kpi');
  const { month } = useKpiChoice();
  const data = useQuery({ ...monthQuery(month), enabled: stats.shown }).data;
  if (!data) return null;
  const s = data.stats;
  const name = t(`month.${Number(data.month.slice(5, 7))}` as UiTextKey);
  return (
    <Plates shown={stats.shown}>
      <Plate
        id="kf"
        icon="check"
        color="blue"
        label={t('kpi.plate.filled', { month: name })}
        value={t('kpi.n_of', { n: s.filled, of: s.all })}
        sub={t('kpi.plate.filled_sub')}
      />
      <Plate
        id="ke"
        icon="alert"
        color={s.empty ? 'orange' : 'green'}
        label={t('kpi.plate.empty')}
        value={String(s.empty)}
        sub={t(s.empty ? 'kpi.plate.empty_sub' : 'kpi.plate.all_in')}
      />
      <Plate
        id="ko"
        icon="clock"
        color={s.overdue ? 'red' : 'green'}
        label={t('kpi.plate.overdue')}
        value={String(s.overdue)}
        sub={t('kpi.plate.overdue_sub')}
      />
      <Plate
        id="kc"
        icon="ok"
        color="green"
        label={t('kpi.plate.checked')}
        value={String(s.checked)}
        sub={t('kpi.plate.checked_sub')}
      />
    </Plates>
  );
}
