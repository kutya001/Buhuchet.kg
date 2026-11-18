import { defaultUiTexts } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import {
  attemptStamp,
  durationText,
  jobPlateColors,
  jobStateFilter,
  momentWithSeconds,
  RUN_ERRORS_FILTER,
  runsOfJobFilter,
  tryText,
} from './runs-model';

// Админка → «Запуски» (решение заказчика 17.11.2026; прототип v132 admin/runs.js: runDur, runTry,
// плашки, переходы из задач в журнал запусков).

const t = makeTranslate(defaultUiTexts());

describe('«Запуски»: тексты строки', () => {
  it('длительность: до минуты — секунды с десятыми, дольше — минуты и секунды; идущий запуск — пусто', () => {
    expect(durationText(t, 400)).toBe('0,4 с');
    expect(durationText(t, 3000)).toBe('3 с');
    expect(durationText(t, 90_000)).toBe('1 мин 30 с');
    expect(durationText(t, null)).toBe('');
  });

  it('попытка — «N из 3»', () => {
    expect(tryText(t, 1)).toBe('1 из 3');
    expect(tryText(t, 3)).toBe('3 из 3');
  });

  it('окончание — по Бишкеку и с секундами; в ленте попыток дата и время — отдельно', () => {
    // 17.11 20:05:07 UTC — это 18.11 02:05:07 по Бишкеку.
    expect(momentWithSeconds('2026-11-17T20:05:07.000Z')).toBe('18.11.2026 02:05:07');
    expect(attemptStamp('2026-11-17T20:05:07.000Z')).toEqual({
      date: '18.11.2026',
      time: '02:05',
    });
  });
});

describe('«Запуски»: плашки и переходы', () => {
  it('всё работает — плашки зелёные', () => {
    expect(jobPlateColors({ total: 20, ok: 20, failing: 0, missed: 0, dayErrors: 0 })).toEqual({
      ok: 'green',
      fail: 'green',
      miss: 'green',
      err: 'green',
    });
  });

  it('есть падающие, пропущенные и ошибки — красные и жёлтые', () => {
    expect(jobPlateColors({ total: 20, ok: 17, failing: 1, missed: 2, dayErrors: 3 })).toEqual({
      ok: 'yellow',
      fail: 'red',
      miss: 'yellow',
      err: 'red',
    });
  });

  it('пока числа не пришли — без тревожных цветов', () => {
    expect(jobPlateColors(undefined)).toEqual({
      ok: 'green',
      fail: 'green',
      miss: 'green',
      err: 'green',
    });
  });

  it('плашка состояния — фильтр задач; задача — её запуски; «Ошибок за сутки» — запуски с ошибкой', () => {
    expect(jobStateFilter('failing')).toEqual({ st: { type: 'enum', vals: ['failing'] } });
    expect(runsOfJobFilter('telegram.send')).toEqual({
      title: { type: 'enum', vals: ['telegram.send'] },
    });
    expect(RUN_ERRORS_FILTER).toEqual({ st: { type: 'enum', vals: ['error'] } });
  });
});
