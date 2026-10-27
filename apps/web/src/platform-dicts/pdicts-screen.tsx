'use client';

import { isAdminValueDict } from '@buhuchet/domain';
import { ModuleStub } from '../shell/module-stub';
import { PdictsHead } from './pdicts-head';
import { RequestsList } from './requests-list';
import { ValueDictList } from './value-list';

/**
 * Админка → «Справочники платформы» (ТЗ «Админка» → «Справочники платформы»; прототип
 * admin/platform-dicts.js renderPDicts): над вкладкой — шапка справочника, под ней — список значений
 * или «Запросы» организаций. Вкладки, правку которых добавят следующие части задачи 2.36 и задачи
 * других потоков, пока показывают заглушку.
 */
export function PlatformDictsAdmin({ tabId }: { tabId: string }) {
  let body;
  if (tabId === 'requests') body = <RequestsList />;
  else if (isAdminValueDict(tabId)) body = <ValueDictList key={tabId} dict={tabId} />;
  else body = <ModuleStub moduleId="pdicts" handleAdd={false} />;
  return (
    <div className="flex flex-col gap-3.5">
      <PdictsHead tabId={tabId} />
      {body}
    </div>
  );
}
