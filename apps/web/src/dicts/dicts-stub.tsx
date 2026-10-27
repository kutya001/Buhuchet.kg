'use client';

import { ModuleStub } from '../shell/module-stub';
import { useDictsAddRequest } from './dicts-add';
import { useTaxPick } from './tax-pick';

/**
 * Вкладка «Справочники платформы» до своего экрана (задача 2.03): заглушка, но «+ Добавить» →
 * «Подключить из каталога» работает, как на вкладке «Виды отчётов».
 */
export function DictsStub() {
  const pick = useTaxPick();
  useDictsAddRequest({ catalog: pick.open });
  return (
    <>
      <ModuleStub moduleId="dicts" handleAdd={false} />
      {pick.dialog}
    </>
  );
}
