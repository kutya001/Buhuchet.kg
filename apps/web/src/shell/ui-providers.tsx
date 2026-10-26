'use client';

import {
  ToastProvider,
  WindowProvider,
  type MaxPrefs,
  type ToastLabels,
  type WindowLabels,
} from '@buhuchet/ui';
import { useMemo, type ReactNode } from 'react';
import { useT } from '../l10n/provider';
import { saveMaxPrefs } from './browser';

/**
 * Окна и уведомления `@buhuchet/ui` с текстами словаря и выбором «На весь экран» на этом устройстве —
 * для оболочки и отдельных страниц (образцы компонентов).
 */
export function UiProviders({
  initialMax,
  children,
}: {
  initialMax: MaxPrefs;
  children: ReactNode;
}) {
  const t = useT();
  const windowLabels = useMemo<WindowLabels>(
    () => ({
      maximize: t('window.maximize'),
      restore: t('window.restore'),
      maximizeHint: t('window.maximize_hint'),
      close: t('window.close'),
      cancel: t('btn.cancel'),
      confirm: t('btn.confirm'),
      discardTitle: t('window.discard_title'),
      discardText: t('window.discard_text'),
      discardOk: t('window.discard_ok'),
      tabPosition: (n, total) => t('window.tab_position', { n, total }),
    }),
    [t],
  );
  const toastLabels = useMemo<ToastLabels>(
    () => ({ close: t('toast.close'), closeTitle: t('toast.close_title') }),
    [t],
  );
  return (
    <WindowProvider labels={windowLabels} initialMax={initialMax} onMaxChange={saveMaxPrefs}>
      <ToastProvider labels={toastLabels}>{children}</ToastProvider>
    </WindowProvider>
  );
}
