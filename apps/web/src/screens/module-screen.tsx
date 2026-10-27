'use client';

import type { MenuModuleId } from '@buhuchet/domain';
import { AccountsList } from '../admin/accounts-list';
import { L10nList } from '../admin/l10n-list';
import { OrgsList } from '../admin/orgs-list';
import { PlatformDicts } from '../dicts/platform-tab';
import { ReportTypesList } from '../dicts/report-types-list';
import { KbArticlesTab } from '../kb/kb-articles';
import { KbLessonsTab } from '../kb/kb-lessons';
import { KbLevelTab } from '../kb/kb-level';
import { KbTeamTab } from '../kb/kb-team';
import { KpiScreen } from '../kpi/kpi-screen';
import { OrgMain } from '../org/org-main';
import { OrgPolicyTab } from '../org/org-policy';
import { OrgSettingsTab } from '../org/org-settings';
import { PlatformDictsAdmin } from '../platform-dicts/pdicts-screen';
import { RolesList } from '../roles/roles-list';
import { ModuleStub } from '../shell/module-stub';
import { StaffList } from '../staff/staff-list';
import { StaffStub } from '../staff/staff-stub';

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
  if (moduleId === 'staff') {
    const tab = tabId ?? 'list';
    if (tab === 'list') return <StaffList />;
    if (tab === 'roles') return <RolesList />;
    return <StaffStub />;
  }
  if (moduleId === 'org') {
    const tab = tabId ?? 'main';
    if (tab === 'policy') return <OrgPolicyTab />;
    if (tab === 'settings') return <OrgSettingsTab />;
    return <OrgMain />;
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
    // «Новости» — задача 2.32.
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
  'kpi/',
  'kpi/month',
  'kpi/period',
  'kpi/missing',
  'orgs/',
  'l10n/',
]);

export function screenHasPlates(moduleId: MenuModuleId, tabId: string | null): boolean {
  return SCREENS_WITH_PLATES.has(`${moduleId}/${tabId ?? ''}`);
}
