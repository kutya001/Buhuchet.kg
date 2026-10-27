import { describe, expect, it } from 'vitest';
import { orgReportTypeProblem } from './org-report-types';

const both = { active: true, act: 'both' as const };

describe('Подключение вида отчёта и настройки организации по виду', () => {
  it('подключают только действующий вид каталога', () => {
    expect(orgReportTypeProblem(both, null, { enabled: true })).toBeNull();
    expect(orgReportTypeProblem({ ...both, active: false }, null, { enabled: true })).toBe(
      'report_type_inactive',
    );
    // Уже подключённый до отключения в каталоге вид можно оставить и настраивать.
    expect(
      orgReportTypeProblem({ ...both, active: false }, { enabled: true }, { remindDays: [5] }),
    ).toBeNull();
  });

  it('настройки меняются только у подключённого вида', () => {
    expect(orgReportTypeProblem(both, null, { needReceipt: true })).toBe(
      'report_type_not_connected',
    );
    expect(orgReportTypeProblem(both, { enabled: false }, { needFile: true })).toBe(
      'report_type_not_connected',
    );
    expect(
      orgReportTypeProblem(both, { enabled: false }, { enabled: true, needFile: true }),
    ).toBeNull();
    expect(orgReportTypeProblem(both, { enabled: true }, { enabled: false })).toBeNull();
  });

  it('у вида «Уплата» нет «Файла при сдаче»; дни — от 1 до 60', () => {
    expect(
      orgReportTypeProblem({ active: true, act: 'pay' }, { enabled: true }, { needFile: true }),
    ).toBe('need_file_pay');
    expect(
      orgReportTypeProblem({ active: true, act: 'pay' }, { enabled: true }, { needFile: false }),
    ).toBeNull();
    expect(orgReportTypeProblem(both, { enabled: true }, { remindDays: [0] })).toBe(
      'remind_days_invalid',
    );
    expect(orgReportTypeProblem(both, { enabled: true }, { remindDays: [] })).toBeNull();
  });
});
