import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dueJobs,
  isAuthorizedCronCall,
  latestDueSlot,
  parseCron,
  startMinuteRunner,
  type JobDefinition,
} from './scheduler';

// 2026-10-19 — понедельник. 03:00 UTC = 09:00 в Бишкеке.
const at = (iso: string) => new Date(iso);

describe('parseCron (время Бишкека)', () => {
  it('ежедневно в 09:00 по Бишкеку — это 03:00 UTC', () => {
    const s = parseCron('0 9 * * *');
    expect(s.matches(at('2026-10-19T03:00:00Z'))).toBe(true);
    expect(s.matches(at('2026-10-19T09:00:00Z'))).toBe(false);
  });

  it('шаги, диапазоны и списки', () => {
    const s = parseCron('*/15 8-18 * * 1-5');
    expect(s.matches(at('2026-10-19T02:45:00Z'))).toBe(true); // пн 08:45
    expect(s.matches(at('2026-10-19T02:50:00Z'))).toBe(false);
    expect(s.matches(at('2026-10-25T02:45:00Z'))).toBe(false); // вс
    expect(parseCron('0 0 1,15 * *').matches(at('2026-10-14T18:00:00Z'))).toBe(true); // 15-е 00:00
    expect(parseCron('5/20 * * * *').matches(at('2026-10-19T03:45:00Z'))).toBe(true);
  });

  it('7 — тоже воскресенье; день месяца ИЛИ день недели', () => {
    expect(parseCron('0 9 * * 7').matches(at('2026-10-25T03:00:00Z'))).toBe(true);
    const either = parseCron('0 9 1 * 1');
    expect(either.matches(at('2026-10-19T03:00:00Z'))).toBe(true); // понедельник
    expect(either.matches(at('2026-10-01T03:00:00Z'))).toBe(true); // 1-е число
    expect(either.matches(at('2026-10-20T03:00:00Z'))).toBe(false);
  });

  it.each(['* * * *', '60 * * * *', '* * 0 * *', 'a * * * *', '*/0 * * * *', '5-1 * * * *'])(
    'отказывает «%s»',
    (bad) => {
      expect(() => parseCron(bad)).toThrow(SyntaxError);
    },
  );
});

describe('latestDueSlot и dueJobs', () => {
  const daily = parseCron('0 9 * * *');

  it('находит пропущенный запуск в пределах окна', () => {
    expect(latestDueSlot(daily, at('2026-10-19T03:40:30Z'), 60)?.toISOString()).toBe(
      '2026-10-19T03:00:00.000Z',
    );
    expect(latestDueSlot(daily, at('2026-10-19T04:30:00Z'), 60)).toBeNull();
  });

  const noop = async () => {};
  const jobs: JobDefinition<unknown>[] = [
    { name: 'reports.generate', cron: '0 9 * * *', lookbackMinutes: 1440, run: noop },
    { name: 'telegram.flush', cron: '* * * * *', run: noop },
    { name: 'kpi.weekly', cron: '0 9 * * 1', run: noop },
  ];

  it('возвращает задачи, которым пора, со слотом', () => {
    const due = dueJobs(jobs, at('2026-10-20T03:00:20Z')); // вторник 09:00
    expect(due.map((d) => [d.job.name, d.slot.toISOString()])).toEqual([
      ['reports.generate', '2026-10-20T03:00:00.000Z'],
      ['telegram.flush', '2026-10-20T03:00:00.000Z'],
    ]);
  });

  it('не допускает двух задач с одним именем', () => {
    expect(() => dueJobs([...jobs, jobs[0]!], at('2026-10-20T03:00:00Z'))).toThrow(/дважды/);
  });
});

describe('isAuthorizedCronCall', () => {
  it('принимает только точный Bearer-секрет', () => {
    const secret = 'local-cron-secret-0000';
    expect(isAuthorizedCronCall(`Bearer ${secret}`, secret)).toBe(true);
    expect(isAuthorizedCronCall(`Bearer ${secret}x`, secret)).toBe(false);
    expect(isAuthorizedCronCall(secret, secret)).toBe(false);
    expect(isAuthorizedCronCall(null, secret)).toBe(false);
  });
});

describe('startMinuteRunner', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('вызывает tick в начале каждой минуты и останавливается', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(at('2026-10-19T03:00:30Z'));
    const tick = vi.fn(async () => {});
    const onError = vi.fn();
    const runner = startMinuteRunner({ tick, onError, offsetMs: 0 });
    await vi.advanceTimersByTimeAsync(29_000);
    expect(tick).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tick).toHaveBeenCalledTimes(2);
    await runner.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(tick).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();
  });

  it('ошибка tick не останавливает цикл', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(at('2026-10-19T03:00:00Z'));
    const tick = vi.fn(async () => {
      throw new Error('сбой');
    });
    const onError = vi.fn();
    const runner = startMinuteRunner({ tick, onError });
    await vi.advanceTimersByTimeAsync(62_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onError).toHaveBeenCalledTimes(2);
    await runner.stop();
  });
});
