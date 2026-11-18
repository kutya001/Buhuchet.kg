import {
  addDays,
  bishkekDate,
  JOURNAL_DAYS,
  JOURNAL_PERIOD_DEFAULT,
  type JournalDir,
  type JournalPeriod,
} from '@buhuchet/domain';
import { useEffect, useEffectEvent, useSyncExternalStore } from 'react';

/*
 * Что показывает журнал «Телеграм» сверх поиска и фильтров (прототип v132 admin/tg-log.js, `TGL`):
 * направление, период и «Вся переписка» одного чата. Живёт, пока открыта страница: плашки, окно
 * «Сообщение» и окно «Запуск» меняют выбор, и журнал показывается уже с ним.
 */
export type JournalSide = 'all' | JournalDir;

export interface JournalView {
  dir: JournalSide;
  per: JournalPeriod;
  /** «Вся переписка»: номер строки журнала, чей чат показать (номера чата на экране нет). */
  chat: string | null;
}

const START: JournalView = { dir: 'all', per: JOURNAL_PERIOD_DEFAULT, chat: null };
let view: JournalView = START;
let pending: string | null = null;
const viewListeners = new Set<() => void>();
const messageListeners = new Set<() => void>();

export function setJournalView(next: Partial<JournalView>): void {
  view = { ...view, ...next };
  for (const listener of viewListeners) listener();
}

const subscribe = (listener: () => void) => {
  viewListeners.add(listener);
  return () => void viewListeners.delete(listener);
};
const read = () => view;

export function useJournalView(): JournalView {
  return useSyncExternalStore(subscribe, read, read);
}

/** Период, в который попадает сообщение: выбранный, а если оно старше — весь срок хранения. */
export function periodFor(at: string, per: JournalPeriod, now: Date): JournalPeriod {
  return bishkekDate(new Date(at)) >= addDays(bishkekDate(now), 1 - per) ? per : JOURNAL_DAYS;
}

/**
 * Открыть сообщение из другого окна (окно «Запуск», прототип `tgLogShow`): журнал — все направления и
 * период, в который сообщение попадает; само окно «Сообщение» откроет журнал, когда появится на
 * экране. Переход на вкладку — за вызывающим.
 */
export function requestJournalMessage(id: string, at: string, now: Date = new Date()): void {
  pending = id;
  setJournalView({ dir: 'all', chat: null, per: periodFor(at, view.per, now) });
  for (const listener of messageListeners) listener();
}

/** Журнал: открыть окно «Сообщение» по просьбе — ждавшей его появления или пришедшей при нём. */
export function useJournalMessageRequests(open: (id: string) => void): void {
  const run = useEffectEvent(open);
  useEffect(() => {
    const take = () => {
      if (!pending) return;
      const id = pending;
      pending = null;
      run(id);
    };
    take();
    messageListeners.add(take);
    return () => void messageListeners.delete(take);
  }, []);
}

/** Для тестов: вернуть выбор по умолчанию и забыть просьбу. */
export function resetJournalView(): void {
  pending = null;
  setJournalView(START);
}
