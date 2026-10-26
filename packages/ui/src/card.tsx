import type { ReactNode } from 'react';

/** Карточка-заготовка. Полная карточка с «На весь экран» появится в этапе 1 по прототипу. */
export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-pane p-4 shadow-pane">
      <h2 className="mt-0 mb-3 text-base font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

export function StatusDot({ state, label }: { state: 'ok' | 'error' | 'pending'; label: string }) {
  const color = state === 'ok' ? 'bg-ok' : state === 'error' ? 'bg-danger' : 'bg-faint';
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${color}`} />
      <span>{label}</span>
    </span>
  );
}
