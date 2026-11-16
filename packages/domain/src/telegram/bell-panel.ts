import { addDays, bishkekDate, bishkekTime, type IsoDate } from '../common/dates';

/*
 * Панель «Уведомления» колокольчика (доработки 16.11.2026, блок 3; поток И; прототип v123
 * `ui/bell-panel.js`): кнопки-фильтры, время строки и группы «Сегодня / Вчера / Раньше» — по Бишкеку.
 */

/** Кнопки-фильтры панели по порядку («Другое» — только во «Все»). */
export const BELL_PANEL_TABS = ['all', 'reports', 'tasks', 'files', 'money', 'news'] as const;
export type BellPanelTab = (typeof BELL_PANEL_TABS)[number];

/** Как часто значок спрашивает число непросмотренных (и при возврате на вкладку браузера). */
export const BELL_POLL_MS = 60_000;

/** Группа строки по дню в Бишкеке. */
export type BellDayGroup = 'today' | 'yesterday' | 'earlier';

/** Время строки словами (прототип `bellAgo`). */
export type BellAgo =
  | { kind: 'now' }
  | { kind: 'min'; n: number }
  | { kind: 'today'; hm: string }
  | { kind: 'yesterday'; hm: string }
  /** `date` — «12.11» в этом году, «12.11.2025» — в прошлом. */
  | { kind: 'date'; date: string; hm: string };

const minutes = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

/** «Сегодня», «Вчера» или «Раньше» — по дню строки в Бишкеке (прототип `bellGroup`). */
export function bellDayGroup(at: Date, now: Date): BellDayGroup {
  const day = bishkekDate(at);
  const today = bishkekDate(now);
  if (day === today) return 'today';
  return day === addDays(today, -1) ? 'yesterday' : 'earlier';
}

/**
 * Время строки (прототип `bellAgo`): сегодня — «только что» (меньше минуты), «N мин назад» (меньше
 * часа) или «14:20»; вчера — «вчера 14:20»; раньше — «12.11 14:20», в прошлом году — с годом. Минуты
 * считаются по часам и минутам, как в прототипе.
 */
export function bellAgo(at: Date, now: Date): BellAgo {
  const day: IsoDate = bishkekDate(at);
  const today = bishkekDate(now);
  const hm = bishkekTime(at);
  if (day === today) {
    const m = minutes(bishkekTime(now)) - minutes(hm);
    if (m < 1) return { kind: 'now' };
    return m < 60 ? { kind: 'min', n: m } : { kind: 'today', hm };
  }
  if (day === addDays(today, -1)) return { kind: 'yesterday', hm };
  const dm = `${day.slice(8, 10)}.${day.slice(5, 7)}`;
  return {
    kind: 'date',
    date: day.slice(0, 4) === today.slice(0, 4) ? dm : `${dm}.${day.slice(0, 4)}`,
    hm,
  };
}
