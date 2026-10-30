'use client';

import { isAdminValueDict } from '@buhuchet/domain';
import { ModuleStub } from '../shell/module-stub';
import { CalendarList } from './calendar-list';
import { LoadsList } from './loads-list';
import { PdictsHead } from './pdicts-head';
import { PermsTab } from './perms-tab';
import { RequestsList } from './requests-list';
import { RoletplTab } from './roletpl-tab';
import { StatusesTab } from './statuses-tab';
import { TaxesTab } from './taxes-tab';
import { TemplatesTab } from './templates-tab';
import { ValueDictList } from './value-list';

/**
 * Админка → «Справочники платформы» (ТЗ «Админка» → «Справочники платформы»; прототип
 * admin/platform-dicts.js renderPDicts): над вкладкой — шапка справочника, под ней — список значений,
 * «Загрузки» из Excel или «Запросы» организаций. Вкладки, правку которых добавят следующие задачи,
 * пока показывают заглушку.
 */
export function PlatformDictsAdmin({ tabId }: { tabId: string }) {
  let body;
  if (tabId === 'requests') body = <RequestsList />;
  else if (tabId === 'loads') body = <LoadsList />;
  else if (isAdminValueDict(tabId)) body = <ValueDictList key={tabId} dict={tabId} />;
  else if (tabId === 'taxes') body = <TaxesTab />;
  else if (tabId === 'calendar') body = <CalendarList />;
  else if (tabId === 'statuses') body = <StatusesTab />;
  else if (tabId === 'roletpl') body = <RoletplTab />;
  else if (tabId === 'perms') body = <PermsTab />;
  else if (tabId === 'templates') body = <TemplatesTab />;
  else body = <ModuleStub moduleId="pdicts" handleAdd={false} />;
  return (
    <div className="flex flex-col gap-3.5">
      <PdictsHead tabId={tabId} />
      {body}
    </div>
  );
}
