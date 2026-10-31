'use client';

import type { MenuModuleId } from '@buhuchet/domain';
import { AccountsList } from '../admin/accounts-list';
import { ContractorsList } from '../contractors/contractors-list';
import { L10nList } from '../admin/l10n-list';
import { OrgsList } from '../admin/orgs-list';
import { PlatformDicts } from '../dicts/platform-tab';
import { ReportTypesList } from '../dicts/report-types-list';
import { FilesManager } from '../files/files-manager';
import { BonusTab } from '../finance/bonus-tab';
import { FinanceScreen } from '../finance/finance-screen';
import { KbArticlesTab } from '../kb/kb-articles';
import { KbLessonsTab } from '../kb/kb-lessons';
import { KbLevelTab } from '../kb/kb-level';
import { KbTeamTab } from '../kb/kb-team';
import { KpiScreen } from '../kpi/kpi-screen';
import { KbAdmArtsTab } from '../kbadm/kbadm-arts';
import { KbAdmNewsTab } from '../kbadm/kbadm-io';
import { KbAdmLevelsTab } from '../kbadm/kbadm-levels';
import { KbAdmShowsTab } from '../kbadm/kbadm-shows';
import { KbAdmStepsTab } from '../kbadm/kbadm-steps';
import { KbNewsTab } from '../news/news-tab';
import { OrgMain } from '../org/org-main';
import { OrgPolicyTab } from '../org/org-policy';
import { OrgSettingsTab } from '../org/org-settings';
import { PlatformDictsAdmin } from '../platform-dicts/pdicts-screen';
import { ReportCalendarTab } from '../reports/report-calendar';
import { ReportMatrixTab } from '../reports/report-matrix';
import { REPORT_LIST_TABS, type ReportListTab } from '../reports/reports-data';
import { ReportsList } from '../reports/reports-list';
import { RolesList } from '../roles/roles-list';
import { ModuleStub } from '../shell/module-stub';
import { StaffList } from '../staff/staff-list';
import { TasksList, type TaskTab } from '../tasks/tasks-list';

/**
 * Экран модуля на вкладке. Экраны — клиентские компоненты (данные — из API через TanStack Query),
 * поэтому оболочка показывает и соседнюю вкладку, пока палец листает вкладки свайпом. Экран модуля
 * подключается здесь по `moduleId` и вкладке; модуль без экрана — заглушка. Соседнюю вкладку оболочка рисует
 * без проверки адреса на сервере (вкладки — только видимые по правам), поэтому право на данные
 * вкладки по-прежнему проверяет API, а не скрытая вкладка.
 */
export function ModuleScreen({
  moduleId,
  tabId,
}: {
  moduleId: MenuModuleId;
  tabId: string | null;
}) {
  if (moduleId === 'kpi') return <KpiScreen tab={tabId ?? 'month'} />;
  if (moduleId === 'files') return <FilesManager />;
  if (moduleId === 'staff') {
    const tab = tabId ?? 'list';
    if (tab === 'list') return <StaffList />;
    if (tab === 'roles') return <RolesList />;
    if (tab === 'bonus') return <BonusTab />;
    return <StaffList />;
  }
  if (moduleId === 'fin') return <FinanceScreen tab={tabId ?? 'all'} />;
  // «Контрагенты»: «Все», «Мои контрагенты» и «Должники».
  if (moduleId === 'cps') {
    const tab = tabId ?? 'all';
    if (tab === 'all' || tab === 'mine' || tab === 'debtors')
      return <ContractorsList key={tab} tab={tab} />;
    return <ModuleStub moduleId={moduleId} />;
  }
  if (moduleId === 'org') {
    const tab = tabId ?? 'main';
    if (tab === 'policy') return <OrgPolicyTab />;
    if (tab === 'settings') return <OrgSettingsTab />;
    return <OrgMain />;
  }
  if (moduleId === 'reports') {
    const tab = (tabId ?? 'week') as ReportListTab;
    if (REPORT_LIST_TABS.includes(tab)) return <ReportsList key={tab} tab={tab} />;
    if (tabId === 'matrix') return <ReportMatrixTab />;
    if (tabId === 'calendar') return <ReportCalendarTab />;
    return <ModuleStub moduleId={moduleId} />;
  }
  if (moduleId === 'tasks') {
    const tab = (tabId ?? 'mine') as TaskTab;
    return <TasksList key={tab} tab={TASK_TABS.includes(tab) ? tab : 'mine'} />;
  }
  if (moduleId === 'dicts') {
    const tab = tabId ?? 'types';
    if (tab === 'types') return <ReportTypesList />;
    return <PlatformDicts />;
  }
  if (moduleId === 'kb') {
    const tab = tabId ?? 'level';
    if (tab === 'level') return <KbLevelTab />;
    if (tab === 'lessons') return <KbLessonsTab />;
    if (tab === 'arts') return <KbArticlesTab />;
    if (tab === 'team') return <KbTeamTab />;
    if (tab === 'news') return <KbNewsTab />;
    return <ModuleStub moduleId={moduleId} />;
  }
  // Админка → «База знаний (содержимое)»: «Новости» (задача 2.32), остальные вкладки — задача 2.39.
  if (moduleId === 'kbadm') {
    const tab = tabId ?? 'steps';
    if (tab === 'steps') return <KbAdmStepsTab />;
    if (tab === 'shows') return <KbAdmShowsTab />;
    if (tab === 'arts') return <KbAdmArtsTab />;
    if (tab === 'levels') return <KbAdmLevelsTab />;
    if (tab === 'news') return <KbAdmNewsTab />;
    return <ModuleStub moduleId={moduleId} />;
  }
  if (moduleId === 'accounts') return <AccountsList />;
  if (moduleId === 'orgs') return <OrgsList />;
  if (moduleId === 'pdicts') return <PlatformDictsAdmin tabId={tabId ?? 'types'} />;
  if (moduleId === 'l10n') return <L10nList />;
  return <ModuleStub moduleId={moduleId} />;
}

/**
 * Вкладки модулей, у экрана которых есть статистика — плашки-итоги над списком (ТЗ «Статистика
 * модуля»): только у них в ряду вкладок кнопка «Статистика». Экран с плашками добавляет сюда свою
 * вкладку («модуль/вкладка») и показывает плашки по `useModuleStats`.
 */
const SCREENS_WITH_PLATES: ReadonlySet<string> = new Set<string>([
  'cps/',
  'cps/all',
  'cps/mine',
  'reports/',
  'reports/week',
  'reports/overdue',
  'reports/waiting',
  'reports/all',
  'tasks/',
  'tasks/mine',
  'tasks/byme',
  'tasks/all',
  'tasks/overdue',
  'kpi/',
  'kpi/month',
  'kpi/period',
  'kpi/missing',
  'fin/',
  'fin/all',
  'fin/tax',
  'fin/fee',
  'fin/wo',
  'files/',
  'orgs/',
  'l10n/',
]);

const TASK_TABS: readonly TaskTab[] = ['mine', 'byme', 'all', 'overdue'];

export function screenHasPlates(moduleId: MenuModuleId, tabId: string | null): boolean {
  return SCREENS_WITH_PLATES.has(`${moduleId}/${tabId ?? ''}`);
}
