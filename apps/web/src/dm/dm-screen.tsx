'use client';

import { TokensTab } from './tokens-tab';

/**
 * «Витрина данных» (доработки 20.11.2026: Витрина данных; прототип v155 `renderDm`). Этап 1 — только
 * Админка → «API Токены» (поток Т, П14); «Вывод», «Шаблоны», «Журнал запросов» и модуль организации —
 * этап 2.
 */
export function DmScreen({ admin }: { tab: string; admin: boolean }) {
  return <TokensTab side={admin ? 'admin' : 'org'} />;
}
