import { describe, expect, it } from 'vitest';
import {
  cronEvery,
  cronEveryMinutes,
  jobDoneKey,
  jobStateOf,
  jobTitleKey,
  jobWhatKey,
  JOB_STATE_RANK,
  runDuration,
  runImportant,
} from './runs';

/* Админка → «Запуски» (решение заказчика 17.11.2026; прототип v132 admin/runs.js). */

const at = (iso: string) => new Date(iso);

describe('состояние задачи по расписанию', () => {
  const base = { fails: 0, alert: null, lastSlot: at('2026-11-17T03:00:00Z'), overdue: null };

  it('«Падает» — три неудачи подряд или открытое оповещение о сбое, даже если запуск пропущен', () => {
    expect(jobStateOf({ ...base, fails: 2 })).toBe('ok');
    expect(jobStateOf({ ...base, fails: 3 })).toBe('failing');
    expect(jobStateOf({ ...base, alert: 'failing' })).toBe('failing');
    expect(
      jobStateOf({ ...base, fails: 5, alert: 'missed', overdue: at('2026-11-18T03:00:00Z') }),
    ).toBe('failing');
  });

  it('«Не запускалась» — пропущен запуск по расписанию или задача не запускалась ни разу', () => {
    expect(jobStateOf({ ...base, alert: 'missed' })).toBe('missed');
    expect(jobStateOf({ ...base, overdue: at('2026-11-17T04:00:00Z') })).toBe('missed');
    // Запуск, который уже должен был пройти, — тот же, что прошёл последним: всё в порядке.
    expect(jobStateOf({ ...base, overdue: at('2026-11-17T03:00:00Z') })).toBe('ok');
    expect(jobStateOf({ ...base, overdue: at('2026-11-16T03:00:00Z') })).toBe('ok');
    expect(jobStateOf({ ...base, lastSlot: null, overdue: at('2026-11-16T03:00:00Z') })).toBe(
      'missed',
    );
    // Задачу только что добавили: её первый запуск ещё не должен был пройти.
    expect(jobStateOf({ ...base, lastSlot: null })).toBe('ok');
  });

  it('в списке сначала «Падает», потом «Не запускалась»', () => {
    expect(JOB_STATE_RANK.failing).toBeLessThan(JOB_STATE_RANK.missed);
    expect(JOB_STATE_RANK.missed).toBeLessThan(JOB_STATE_RANK.ok);
  });
});

describe('«Как часто» по расписанию cron', () => {
  it('каждую минуту, каждые N минут, каждый час, каждый день, несколько раз в сутки', () => {
    expect(cronEvery('* * * * *')).toEqual({ kind: 'minute' });
    expect(cronEvery('*/1 * * * *')).toEqual({ kind: 'minute' });
    expect(cronEvery(' */5  * * * * ')).toEqual({ kind: 'minutes', n: 5 });
    expect(cronEvery('40 * * * *')).toEqual({ kind: 'hourly', minute: '40' });
    expect(cronEvery('5 * * * *')).toEqual({ kind: 'hourly', minute: '05' });
    expect(cronEvery('30 3 * * *')).toEqual({ kind: 'daily', time: '03:30' });
    expect(cronEvery('5 0,6,12,18 * * *')).toEqual({
      kind: 'times',
      n: 4,
      times: '00:05, 06:05, 12:05, 18:05',
    });
  });

  it('иное расписание — как записано', () => {
    for (const cron of [
      '0 9 * * 1',
      '0 9 1 * *',
      '0 9 * 1 *',
      '*/0 * * * *',
      '*/60 * * * *',
      '60 * * * *',
      '1-5 * * * *',
      '*/5 3 * * *',
      '0 24 * * *',
      '0 */6 * * *',
      '61 3 * * *',
      '0 9 * *',
      'каждый день',
    ]) {
      expect(cronEvery(cron), cron).toEqual({ kind: 'other', cron });
    }
  });

  it('минут между запусками — для сортировки от частых к редким', () => {
    expect(cronEveryMinutes(cronEvery('* * * * *'))).toBe(1);
    expect(cronEveryMinutes(cronEvery('*/5 * * * *'))).toBe(5);
    expect(cronEveryMinutes(cronEvery('40 * * * *'))).toBe(60);
    expect(cronEveryMinutes(cronEvery('30 3 * * *'))).toBe(1440);
    expect(cronEveryMinutes(cronEvery('5 0,6,12,18 * * *'))).toBe(360);
    expect(cronEveryMinutes(cronEvery('0 9 * * 1'))).toBe(1440);
  });
});

describe('запуск', () => {
  it('длительность: до минуты — секунды с десятыми, дольше — минуты и секунды', () => {
    expect(runDuration(0)).toEqual({ kind: 's', s: '0' });
    expect(runDuration(440)).toEqual({ kind: 's', s: '0,4' });
    expect(runDuration(3000)).toEqual({ kind: 's', s: '3' });
    expect(runDuration(59_940)).toEqual({ kind: 's', s: '59,9' });
    expect(runDuration(60_000)).toEqual({ kind: 'm', m: 1, s: 0 });
    expect(runDuration(90_500)).toEqual({ kind: 'm', m: 1, s: 31 });
    expect(runDuration(null)).toBeNull();
    expect(runDuration(-5)).toBeNull();
    expect(runDuration(Number.NaN)).toBeNull();
  });

  it('«Важный» — ошибка, ещё выполняется или что-то сделал; пустой успешный — нет', () => {
    expect(runImportant({ status: 'error', done: null })).toBe(true);
    expect(runImportant({ status: 'running', done: null })).toBe(true);
    expect(runImportant({ status: 'ok', done: 3 })).toBe(true);
    expect(runImportant({ status: 'ok', done: 0 })).toBe(false);
    expect(runImportant({ status: 'ok', done: null })).toBe(false);
  });

  it('ключи словаря задачи: точки и дефисы имени — «_»', () => {
    expect(jobTitleKey('system.cleanup-scheduler-runs')).toBe(
      'alert.job.system_cleanup_scheduler_runs',
    );
    expect(jobWhatKey('telegram.send')).toBe('runs.what.telegram_send');
    expect(jobDoneKey('kb.cleanup-video-uploads')).toBe('runs.done.kb_cleanup_video_uploads');
  });
});
