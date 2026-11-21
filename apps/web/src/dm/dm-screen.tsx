'use client';

import { RequestsTab } from './requests-tab';
import { TokensTab } from './tokens-tab';

/**
 * «Витрина данных» (доработки 20.11.2026: Витрина данных; прототип v155 `renderDm`). Админка —
 * «API Токены» (поток Т, этап 1, П14) и «Журнал запросов» (поток Т, этап 2, П11); «Вывод», «Шаблоны»
 * и модуль организации — поток И, этап 2.
 */
export function DmScreen({ tab, admin }: { tab: string; admin: boolean }) {
  if (admin && tab === 'log') return <RequestsTab />;
  return <TokensTab side={admin ? 'admin' : 'org'} />;
}
