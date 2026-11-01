import { useSyncExternalStore } from 'react';

/** Открытая карточка проекта: номер проекта и счётчик открытий. */
export interface ProjectCardRequest {
  id: string;
  open: boolean;
  n: number;
}

/*
 * Карточку проекта открывают из многих мест (список проектов, вкладка «Проекты» контрагента, карточка
 * задачи, «Файловый менеджер», история контрагента; прототип `openProject`), а рисует её одна —
 * `ProjectCardHost` в оболочке. Поэтому открыть карточку — просто вызвать `openProjectCard`, без
 * импорта самой карточки (и без кольца «карточка задачи ↔ карточка проекта»).
 */
let now: ProjectCardRequest | null = null;
const listeners = new Set<() => void>();
const set = (next: ProjectCardRequest | null) => {
  now = next;
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** Открыть карточку проекта (поверх открытых окон); открытая карточка заменяется новой. */
export function openProjectCard(id: string): void {
  set({ id, open: true, n: (now?.n ?? 0) + 1 });
}

export function closeProjectCard(): void {
  if (now?.open) set({ ...now, open: false });
}

export function useProjectCardRequest(): ProjectCardRequest | null {
  return useSyncExternalStore(
    subscribe,
    () => now,
    () => null,
  );
}
