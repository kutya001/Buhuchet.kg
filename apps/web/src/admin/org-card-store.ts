import { useEffect, useEffectEvent } from 'react';

/*
 * Карточку организации открывают и с других экранов Админки — из заявки (прототип admin/leads.js:
 * закрыть окна, перейти в «Организации», `orgCard(id)`). Рисует её список организаций, поэтому
 * просьба открыть карточку ждёт здесь, пока список не появится на экране (или сразу, если он уже
 * открыт).
 */
let pending: string | null = null;
const listeners = new Set<() => void>();

/** Попросить «Организации» открыть карточку организации; сам переход на вкладку — за вызывающим. */
export function requestOrgCard(orgId: string): void {
  pending = orgId;
  for (const listener of listeners) listener();
}

/** Список организаций: открыть карточку по просьбе — ждавшей его появления или пришедшей при нём. */
export function useOrgCardRequests(open: (orgId: string) => void): void {
  const run = useEffectEvent(open);
  useEffect(() => {
    const take = () => {
      if (!pending) return;
      const id = pending;
      pending = null;
      run(id);
    };
    take();
    listeners.add(take);
    return () => void listeners.delete(take);
  }, []);
}
