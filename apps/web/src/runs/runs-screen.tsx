'use client';

import { RunsJobs } from './runs-jobs';
import { RunsList } from './runs-list';

/**
 * Админка → «Запуски» (решение заказчика 17.11.2026; прототип v132 admin/runs.js; docs/decisions.md
 * п. Т-15): вкладки «Задачи» и «Запуски». Видит только администратор платформы; только просмотр.
 */
export function RunsScreen({ tab }: { tab: string }) {
  return tab === 'runs' ? <RunsList /> : <RunsJobs />;
}
