import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTIFY_SETTINGS,
  NOTIFY_KINDS,
  notifyKindLocked,
  notifyKindsFor,
  notifyOn,
  outboxRetryDelaySeconds,
  withNotifyKind,
  withNotifyMode,
  type NotifySettings,
} from './notify';

const on = (s: NotifySettings, boss: boolean) => NOTIFY_KINDS.filter((k) => notifyOn(s, boss, k));

describe('«Уведомления в Telegram» в профиле (прототип notifyBox)', () => {
  it('режим «Все» — всё; «Только просрочки и сводка» — просрочки, ручные задачи, сводка; «Только ручные задачи» — задачи', () => {
    expect(on(DEFAULT_NOTIFY_SETTINGS, true)).toEqual(NOTIFY_KINDS);
    expect(on(withNotifyMode('digest'), true)).toEqual(['over', 'tasks', 'week']);
    expect(on(withNotifyMode('manual'), true)).toEqual(['tasks']);
  });

  it('у сотрудника без режима — только переключатели задач; по своим отчётам напоминания не отключаются', () => {
    expect(notifyKindsFor(false)).toEqual(['tasks', 'regtasks']);
    expect(notifyKindsFor(true)).toEqual(NOTIFY_KINDS);
    // Режим сотрудника не действует: «за N дней» и просрочки других ему не приходят никогда.
    expect(on(DEFAULT_NOTIFY_SETTINGS, false)).toEqual(['tasks', 'regtasks']);
    expect(on(withNotifyKind(DEFAULT_NOTIFY_SETTINGS, 'tasks', false), false)).toEqual([
      'regtasks',
    ]);
  });

  it('отключённый переключатель — то, что не входит в режим; смена режима сбрасывает переключатели', () => {
    const digest = withNotifyMode('digest');
    expect(notifyKindLocked(digest, true, 'before')).toBe(true);
    expect(notifyKindLocked(digest, true, 'over')).toBe(false);
    expect(notifyKindLocked(digest, false, 'before')).toBe(false);
    const off = withNotifyKind(withNotifyKind(DEFAULT_NOTIFY_SETTINGS, 'week', false), 'over', false);
    // Порядок — как в каталоге, повторное выключение не дублирует.
    expect(withNotifyKind(off, 'week', false).off).toEqual(['over', 'week']);
    expect(withNotifyKind(off, 'over', true).off).toEqual(['week']);
    expect(withNotifyMode('all')).toEqual({ mode: 'all', off: [] });
  });
});

describe('очередь отправки', () => {
  it('повтор: пауза от Telegram (429) главнее, иначе 1, 2, 4, 8 минут', () => {
    expect([1, 2, 3, 4].map((n) => outboxRetryDelaySeconds(n))).toEqual([60, 120, 240, 480]);
    expect(outboxRetryDelaySeconds(3, 17)).toBe(17);
  });
});
