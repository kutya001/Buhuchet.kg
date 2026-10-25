import type { ReactNode } from 'react';

/** Карточка-заготовка. Полная карточка с «На весь экран» появится в этапе 1 по прототипу. */
export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <h2 className="mb-3 text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
      {children}
    </section>
  );
}

export function StatusDot({ state, label }: { state: 'ok' | 'error' | 'pending'; label: string }) {
  const color =
    state === 'ok' ? 'bg-emerald-500' : state === 'error' ? 'bg-rose-500' : 'bg-slate-400';
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${color}`} />
      <span>{label}</span>
    </span>
  );
}
