'use client';

import type { MenuModuleId } from '@buhuchet/domain';
import { Icon } from '@buhuchet/ui';
import { useT } from '../l10n/provider';
import { MODULES } from './modules';
import { useShell } from './shell';

/**
 * Модуль, у которого ещё нет экрана: оболочка (меню, вкладки, «+ Добавить») уже работает, а вместо
 * экрана — пояснение (вид пустого состояния прототипа `.state`). Выбранный способ добавления
 * показывается строкой: само действие появится вместе с экраном модуля.
 */
export function ModuleStub({ moduleId }: { moduleId: MenuModuleId }) {
  const t = useT();
  const { addRequest } = useShell();
  const def = MODULES[moduleId];
  const request = addRequest?.moduleId === moduleId ? addRequest : null;
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line-strong bg-pane-alt px-4 py-[42px] text-center text-muted">
      <Icon name={def.icon} size="lg" className="text-faint" />
      <b className="text-[15px] text-ink">{t('shell.stub_title', { module: t(def.title) })}</b>
      <span className="max-w-[420px]">{t('shell.stub_text')}</span>
      {request && (
        <span role="status" key={request.n} className="max-w-[420px] font-[550] text-ink">
          {t('shell.stub_add', { action: request.label })}
        </span>
      )}
    </div>
  );
}
