import type { ReportRow } from '@buhuchet/shared';
import type { GridKanban } from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { responsibleCountsQuery } from '../contractors/contractor-data';
import { useT } from '../l10n/provider';
import { useShell } from '../shell/context';
import type { ReportActions } from './report-actions';
import { boardEmployees, reportKanban } from './report-board';
import { responsibleOptionsQuery } from './reports-data';

/**
 * Доска списка отчётов — одна для всех списков отчётов, как `repGrid` прототипа: вкладки «Отчётов для
 * сдачи», список дня «Календаря», вкладка «Отчёты» карточки контрагента. Столбцы сотрудников без
 * отчётов — тому, кто назначает отчёты: действующие сотрудники, за которыми закреплены контрагенты
 * (прототип `repKanban`, `show.resp`).
 */
export function useReportKanban(drop: ReportActions['drop']): GridKanban<ReportRow> {
  const t = useT();
  const { access } = useShell();
  const canAssign = access.can('assign');
  const staff = useQuery({ ...responsibleOptionsQuery, enabled: canAssign });
  const withCps = useQuery({
    ...responsibleCountsQuery,
    enabled: canAssign && access.can('cpView'),
  });
  return reportKanban<ReportRow>(
    t,
    boardEmployees(staff.data?.employees ?? [], withCps.data),
    drop,
  );
}
