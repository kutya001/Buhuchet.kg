import { describe, expect, it } from 'vitest';
import { FEATURES, type Feature } from '../roles/permissions';
import {
  featureChangeProblem,
  isDigestTime,
  isValidConfirmWaitDays,
  isValidRemindDays,
  normalizePageSections,
  normalizeRemindDays,
} from './policy';

const features = (on: Feature[]) =>
  Object.fromEntries(FEATURES.map((f) => [f, on.includes(f)])) as Record<Feature, boolean>;

describe('включение и отключение функций — как в прототипе', () => {
  it('«Учёт оплаты налогов» не выключить, пока включены «Виртуальные счета и бонусы»', () => {
    expect(featureChangeProblem(features(['taxpay', 'accounts']), features(['accounts']))).toEqual({
      code: 'feature_required_by',
      feature: 'accounts',
      message:
        'Сначала отключите «Виртуальные счета и бонусы» — она работает только вместе с этой функцией',
    });
  });

  it('«Виртуальные счета и бонусы» не включить без «Учёта оплаты налогов»', () => {
    expect(featureChangeProblem(features([]), features(['accounts']))).toEqual({
      code: 'feature_requires',
      feature: 'taxpay',
      message: 'Сначала включите «Учёт оплаты налогов»',
    });
    // Включить нужную функцию и ту, что от неё зависит, можно одним сохранением (опросник).
    expect(featureChangeProblem(features([]), features(['taxpay', 'accounts']))).toBeNull();
  });

  it('выключить обе сразу и включать независимые функции можно', () => {
    expect(featureChangeProblem(features(['taxpay', 'accounts']), features([]))).toBeNull();
    expect(featureChangeProblem(features(['tasks']), features(['projects', 'cppage']))).toBeNull();
  });
});

describe('дни напоминаний и подтверждение сдачи', () => {
  it('дни — целые от 1 до 60, набор может быть пустым', () => {
    expect(isValidRemindDays([7, 3])).toBe(true);
    expect(isValidRemindDays([])).toBe(true);
    expect(isValidRemindDays([60, 1])).toBe(true);
    expect(isValidRemindDays([0])).toBe(false);
    expect(isValidRemindDays([61])).toBe(false);
    expect(isValidRemindDays([2.5])).toBe(false);
  });

  it('набор без повторов, от большего к меньшему', () => {
    expect(normalizeRemindDays([3, 7, 14, 3])).toEqual([14, 7, 3]);
  });

  it('напомнить о неподтверждённой сдаче — через 1–30 дней', () => {
    expect(isValidConfirmWaitDays(3)).toBe(true);
    expect(isValidConfirmWaitDays(30)).toBe(true);
    expect(isValidConfirmWaitDays(0)).toBe(false);
    expect(isValidConfirmWaitDays(31)).toBe(false);
  });
});

describe('настройки', () => {
  it('время сводки — ЧЧ:ММ', () => {
    expect(isDigestTime('09:00')).toBe(true);
    expect(isDigestTime('23:59')).toBe(true);
    expect(isDigestTime('24:00')).toBe(false);
    expect(isDigestTime('9:00')).toBe(false);
    expect(isDigestTime('09:00:00')).toBe(false);
  });

  it('разделы страницы контрагента — в порядке страницы', () => {
    expect(normalizePageSections(['contacts', 'pay', 'kpi'])).toEqual(['pay', 'kpi', 'contacts']);
  });
});
