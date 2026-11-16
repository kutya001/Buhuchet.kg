import { describe, expect, it } from 'vitest';
import { bellAgo, bellDayGroup, BELL_PANEL_TABS } from './bell-panel';

// 16.11.2026 15:30 по Бишкеку.
const NOW = new Date('2026-11-16T09:30:00Z');
const at = (bishkek: string) => new Date(`${bishkek}+06:00`);

describe('панель колокольчика — как bellAgo и bellGroup прототипа v123', () => {
  it('кнопки-фильтры по порядку, «Другого» нет', () => {
    expect(BELL_PANEL_TABS).toEqual(['all', 'reports', 'tasks', 'files', 'money', 'news']);
  });

  it('сегодня: «только что», «N мин назад», потом время', () => {
    expect(bellAgo(at('2026-11-16T15:30:40'), NOW)).toEqual({ kind: 'now' });
    expect(bellAgo(at('2026-11-16T15:29:59'), NOW)).toEqual({ kind: 'min', n: 1 });
    expect(bellAgo(at('2026-11-16T14:31:00'), NOW)).toEqual({ kind: 'min', n: 59 });
    expect(bellAgo(at('2026-11-16T14:30:00'), NOW)).toEqual({ kind: 'today', hm: '14:30' });
    // Часы сервера чуть впереди — тоже «только что».
    expect(bellAgo(at('2026-11-16T15:32:00'), NOW)).toEqual({ kind: 'now' });
  });

  it('вчера, раньше в этом году, в прошлом году — по дню в Бишкеке', () => {
    // 15.11 23:50 по Бишкеку — это 17:50 UTC, «вчера», хотя по UTC тоже 15.11.
    expect(bellAgo(new Date('2026-11-15T17:50:00Z'), NOW)).toEqual({
      kind: 'yesterday',
      hm: '23:50',
    });
    // 16.11 00:10 по Бишкеку — ещё 15.11 по UTC, но уже «сегодня».
    expect(bellAgo(new Date('2026-11-15T18:10:00Z'), NOW)).toEqual({ kind: 'today', hm: '00:10' });
    expect(bellAgo(at('2026-11-12T14:20:00'), NOW)).toEqual({
      kind: 'date',
      date: '12.11',
      hm: '14:20',
    });
    expect(bellAgo(at('2025-12-31T09:05:00'), NOW)).toEqual({
      kind: 'date',
      date: '31.12.2025',
      hm: '09:05',
    });
  });

  it('группы «Сегодня / Вчера / Раньше»', () => {
    expect(bellDayGroup(at('2026-11-16T00:00:00'), NOW)).toBe('today');
    expect(bellDayGroup(at('2026-11-15T23:59:00'), NOW)).toBe('yesterday');
    expect(bellDayGroup(at('2026-11-14T12:00:00'), NOW)).toBe('earlier');
  });
});
