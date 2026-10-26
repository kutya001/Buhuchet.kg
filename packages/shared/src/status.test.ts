import { ROLLBACK_REASON_MAX } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import { StatusHistoryEntry, StatusRollback, StatusScaleKey } from './status';

describe('схемы статусов', () => {
  it('шкала — только из шкал продукта', () => {
    expect(StatusScaleKey.parse('report')).toBe('report');
    expect(StatusScaleKey.safeParse('reports').success).toBe(false);
  });

  it('откат: причина обязательна, обрезается и не длиннее предела; лишних полей нет', () => {
    expect(StatusRollback.parse({ to: 'in_progress', reason: '  по ошибке ' })).toEqual({
      to: 'in_progress',
      reason: 'по ошибке',
    });
    const empty = StatusRollback.safeParse({ to: 'in_progress', reason: '   ' });
    expect(empty.success).toBe(false);
    expect(empty.error?.issues[0]?.message).toBe('status.rollback_reason_required');
    const invisible = StatusRollback.safeParse({ to: 'todo', reason: '\u200b\u2060' });
    expect(invisible.error?.issues[0]?.message).toBe('status.rollback_reason_required');
    expect(
      StatusRollback.safeParse({ to: 'todo', reason: 'я'.repeat(ROLLBACK_REASON_MAX) }).success,
    ).toBe(true);
    expect(
      StatusRollback.safeParse({ to: 'todo', reason: 'я'.repeat(ROLLBACK_REASON_MAX + 1) }).success,
    ).toBe(false);
    expect(StatusRollback.safeParse({ to: 'todo', reason: 'a\u0000b' }).success).toBe(false);
    expect(StatusRollback.safeParse({ to: 'Сдан', reason: 'x' }).success).toBe(false);
    expect(StatusRollback.safeParse({ to: 'todo', reason: 'x', version: 1 }).success).toBe(false);
  });

  it('запись истории в ответе API', () => {
    const entry = {
      at: '2026-10-26T08:05:00.000Z',
      from: null,
      to: 'todo',
      rollback: false,
      reason: null,
      actor: null,
    };
    expect(StatusHistoryEntry.parse(entry)).toEqual(entry);
    expect(StatusHistoryEntry.safeParse({ ...entry, at: 'вчера' }).success).toBe(false);
  });
});
