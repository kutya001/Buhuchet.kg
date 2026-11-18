import { RUN_PERIOD_DEFAULT, type RunPeriod } from '@buhuchet/domain';
import { useSyncExternalStore } from 'react';

/*
 * Что показывает журнал запусков сверх поиска и фильтров (прототип v132 admin/runs.js, `RUNS_V`):
 * «Важные · Все» и период. Живёт, пока открыта страница: плашка «Ошибок за сутки» и нажатие на задачу
 * меняют выбор до перехода на вкладку «Запуски», и журнал открывается уже с ним.
 */
export interface RunsView {
  /** Только важные: ошибки, идущие сейчас и запуски, которые что-то сделали. */
  imp: boolean;
  per: RunPeriod;
}

let view: RunsView = { imp: true, per: RUN_PERIOD_DEFAULT };
const listeners = new Set<() => void>();

export function setRunsView(next: Partial<RunsView>): void {
  view = { ...view, ...next };
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const read = () => view;

export function useRunsView(): RunsView {
  return useSyncExternalStore(subscribe, read, read);
}

/** Для тестов: вернуть выбор по умолчанию. */
export function resetRunsView(): void {
  setRunsView({ imp: true, per: RUN_PERIOD_DEFAULT });
}
