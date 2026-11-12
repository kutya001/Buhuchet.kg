'use client';

import type { MenuModuleId } from '@buhuchet/domain';
import { AccountsList } from '../admin/accounts-list';
import { ContractorsList } from '../contractors/contractors-list';
import { L10nList } from '../admin/l10n-list';
import { LeadsList } from '../admin/leads-list';
import { OrgsActivity } from '../admin/orgs-activity';
import { OrgsList } from '../admin/orgs-list';
import { TechDocsScreen } from '../admin/techdocs-screen';
import { PlatformDicts } from '../dicts/platform-tab';
import { ReportTypesList } from '../dicts/report-types-list';
import { FilesManager } from '../files/files-manager';
import { BonusTab } from '../finance/bonus-tab';
import { FinanceScreen } from '../finance/finance-screen';
import { KbArticlesTab } from '../kb/kb-articles';
import { KbLessonsTab } from '../kb/kb-lessons';
import { KbLevelTab } from '../kb/kb-level';
import { KbTeamTab } from '../kb/kb-team';
import { KbVideoTab } from '../kb/video/kb-video-tab';
import { VideoViewsTab } from '../kb/video/video-views';
import { KpiScreen } from '../kpi/kpi-screen';
import { KbAdmArtsTab } from '../kbadm/kbadm-arts';
import { KbAdmNewsTab } from '../kbadm/kbadm-io';
import { KbAdmLevelsTab } from '../kbadm/kbadm-levels';
import { KbAdmShowsTab } from '../kbadm/kbadm-shows';
import { KbAdmStepsTab } from '../kbadm/kbadm-steps';
import { KbAdmVideoTab } from '../kbadm/kbadm-video';
import { HomeActivityTab } from '../home/home-activity';
import { HomeAnalyticsTab } from '../home/home-analytics';
import { HomeSummaryTab } from '../home/home-summary';
import { KbNewsTab } from '../news/news-tab';
import { OrgMain } from '../org/org-main';
import { OrgPolicyTab } from '../org/org-policy';
import { OrgSettingsTab } from '../org/org-settings';
import { PlatformDictsAdmin } from '../platform-dicts/pdicts-screen';
import { ProjectsList, type ProjectTab } from '../projects/projects-list';
import { ReportCalendarTab } from '../reports/report-calendar';
import { ReportMatrixTab } from '../reports/report-matrix';
import { REPORT_LIST_TABS, type ReportListTab } from '../reports/reports-data';
import { ReportsList } from '../reports/reports-list';
import { RolesList } from '../roles/roles-list';
import { ModuleStub } from '../shell/module-stub';
import { StaffList } from '../staff/staff-list';
import { TasksList, type TaskTab } from '../tasks/tasks-list';
import { TgAdmScreen } from '../tgadm/tgadm-screen';

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
  // «Главная»: «Сводка» и «Аналитика» (задача 2.34), «Активность» (прототип v84).
  if (moduleId === 'home') {
    if (tabId === 'analytics') return <HomeAnalyticsTab />;
    if (tabId === 'act') return <HomeActivityTab />;
    return <HomeSummaryTab />;
  }
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
  // «Проекты контрагентов»: «Активные», «Все», «Мои» (задача 2.26).
  if (moduleId === 'projects') {
    const tab = (tabId ?? 'active') as ProjectTab;
    return <ProjectsList key={tab} tab={PROJECT_TABS.includes(tab) ? tab : 'active'} />;
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
    if (tab === 'video') return <KbVideoTab />;
    if (tab === 'vviews') return <VideoViewsTab admin={false} />;
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
    if (tab === 'video') return <KbAdmVideoTab />;
    if (tab === 'vviews') return <VideoViewsTab admin />;
    return <ModuleStub moduleId={moduleId} />;
  }
  if (moduleId === 'accounts') return <AccountsList />;
  if (moduleId === 'orgs') {
    if (tabId === 'act') return <OrgsActivity />;
    return tabId === 'leads' ? <LeadsList /> : <OrgsList />;
  }
  if (moduleId === 'pdicts') return <PlatformDictsAdmin tabId={tabId ?? 'types'} />;
  if (moduleId === 'l10n') return <L10nList />;
  if (moduleId === 'tdocs') return <TechDocsScreen tab={tabId ?? 'db'} />;
  if (moduleId === 'tg') return <TgAdmScreen tab={tabId ?? 'log'} />;
  return <ModuleStub moduleId={moduleId} />;
}

/**
 * Вкладки модулей, у экрана которых есть статистика — плашки-итоги над списком (ТЗ «Статистика
 * модуля»): только у них в ряду вкладок кнопка «Статистика». Экран с плашками добавляет сюда свою
 * вкладку («модуль/вкладка») и показывает плашки по `useModuleStats`.
 */
const SCREENS_WITH_PLATES: ReadonlySet<string> = new Set<string>([
  'home/',
  'home/today',
  'home/analytics',
  'home/act',
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
  'projects/',
  'projects/active',
  'projects/all',
  'projects/mine',
  'files/',
  // Видео платформы (прототип v79: «Не просмотренные», «Не смотрел / Начал / Просмотрено»).
  'kb/video',
  'kb/vviews',
  'kbadm/vviews',
  'orgs/',
  'orgs/list',
  'orgs/act',
  'l10n/',
  'tg/',
  'tg/log',
]);

const TASK_TABS: readonly TaskTab[] = ['mine', 'byme', 'all', 'overdue'];
const PROJECT_TABS: readonly ProjectTab[] = ['active', 'all', 'mine'];

export function screenHasPlates(moduleId: MenuModuleId, tabId: string | null): boolean {
  return SCREENS_WITH_PLATES.has(`${moduleId}/${tabId ?? ''}`);
}
