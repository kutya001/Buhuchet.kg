import type { ConsoleNotes } from './console-store';

/*
 * «Собрать запрос» (доработки 27.11.2026: консоль запросов, блок 6 и блок 5, пункт 3; этап 2, П9;
 * прототип v167 `dmcBuild`): окно открывают три места — «База» консоли (отмеченные таблицы), страница
 * «Схема базы» (сообщение рамки `build`) и метод API без точного SQL («Собрать запрос по таблицам
 * метода»). Окно одно: его рисует первый смонтированный `BuildHost` (`build-dialog.tsx`) — консоль и
 * «Техническая документация»; второй хост (соседняя вкладка при свайпе) молчит. Окно ничего не выполняет:
 * «Открыть в консоли» только передаёт текст.
 */

export interface BuildRequest {
  /** Номер окна: новый номер — новое окно (`dialog-slot`). */
  n: number;
  open: boolean;
  names: string[];
  /** Метод API, по таблицам которого собирается запрос (подпись окна и пометка вкладки). */
  method: string | null;
  notes: ConsoleNotes | null;
}

let req: BuildRequest | null = null;
let seq = 0;
const listeners = new Set<() => void>();
const hosts: symbol[] = [];

function emit() {
  for (const l of listeners) l();
}

export const buildStore = {
  get: () => req,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
  /** Открыть окно с этими таблицами (проверки — в окне: нет описания базы, нет таблиц). */
  open(names: readonly string[], o: { method?: string; notes?: ConsoleNotes } = {}) {
    seq += 1;
    req = {
      n: seq,
      open: true,
      names: [...names],
      method: o.method ?? null,
      notes: o.notes ?? null,
    };
    emit();
  },
  close() {
    if (!req?.open) return;
    req = { ...req, open: false };
    emit();
  },
  /** Хост окна: рисует только первый из смонтированных. */
  claim(id: symbol) {
    if (!hosts.includes(id)) hosts.push(id);
    emit();
    return () => {
      const i = hosts.indexOf(id);
      if (i >= 0) hosts.splice(i, 1);
      emit();
    };
  },
  isHost: (id: symbol) => hosts[0] === id,
};
