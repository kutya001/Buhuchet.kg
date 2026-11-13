import { describe, expect, it } from 'vitest';
import {
  bulkConnectStep,
  bulkDisconnectStep,
  bulkSetupEmpty,
  bulkSetupStep,
  orgReportTypeProblem,
  type OrgReportTypeState,
} from './org-report-types';

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

  it('вид, назначенный действующим контрагентам, не отключается', () => {
    expect(orgReportTypeProblem(both, { enabled: true }, { enabled: false }, 2)).toBe(
      'report_type_assigned',
    );
    expect(orgReportTypeProblem(both, { enabled: true }, { enabled: false }, 0)).toBeNull();
    // Уже отключённый вид и правка настроек назначенного вида — можно.
    expect(orgReportTypeProblem(both, { enabled: false }, { enabled: false }, 2)).toBeNull();
    expect(orgReportTypeProblem(both, { enabled: true }, { needReceipt: true }, 2)).toBeNull();
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

describe('Массовые изменения видов отчётов (прототип v84: typesBulkOn, typesBulkDlg)', () => {
  const pay = { active: true, act: 'pay' as const };
  const on: OrgReportTypeState = {
    enabled: true,
    remindDays: [7, 3],
    needFile: false,
    needReceipt: false,
  };
  const off: OrgReportTypeState = { ...on, enabled: false, remindDays: [5], needReceipt: true };
  const POLICY = [3, 7];

  it('«Подключить»: новый вид — с днями учётной политики, отключённый — с прежними настройками, подключённый и отключённый в каталоге — пропуск', () => {
    expect(bulkConnectStep(both, null, POLICY)).toEqual({
      kind: 'create',
      values: { enabled: true, remindDays: [7, 3], needFile: false, needReceipt: false },
    });
    expect(bulkConnectStep(both, off, POLICY)).toEqual({ kind: 'patch', patch: { enabled: true } });
    expect(bulkConnectStep(both, on, POLICY)).toBeNull();
    expect(bulkConnectStep({ active: false }, null, POLICY)).toBeNull();
    expect(bulkConnectStep({ active: false }, off, POLICY)).toBeNull();
  });

  it('«Отключить»: назначенный действующим контрагентам остаётся подключённым, неподключённый — пропуск', () => {
    expect(bulkDisconnectStep(on, 0)).toEqual({ kind: 'patch', patch: { enabled: false } });
    expect(bulkDisconnectStep(on, 2)).toEqual({ kind: 'busy' });
    expect(bulkDisconnectStep(off, 0)).toBeNull();
    expect(bulkDisconnectStep(null, 0)).toBeNull();
  });

  it('«Настроить»: меняется только то, что отличается; «Не менять» ничего не трогает', () => {
    expect(bulkSetupStep(both, on, { needFile: true, connect: false }, POLICY)).toEqual({
      kind: 'patch',
      patch: { needFile: true },
    });
    expect(
      bulkSetupStep(
        both,
        on,
        { needFile: false, needReceipt: true, remindDays: [1, 10, 10], connect: false },
        POLICY,
      ),
    ).toEqual({ kind: 'patch', patch: { needReceipt: true, remindDays: [10, 1] } });
    // Всё уже так — вид не считается изменённым; порядок дней не важен.
    expect(
      bulkSetupStep(
        both,
        on,
        { needFile: false, needReceipt: false, remindDays: [3, 7], connect: true },
        POLICY,
      ),
    ).toBeNull();
    // Пустой набор — только в день срока.
    expect(bulkSetupStep(both, on, { remindDays: [], connect: false }, POLICY)).toEqual({
      kind: 'patch',
      patch: { remindDays: [] },
    });
  });

  it('«Настроить»: «Файл при сдаче» у вида «только оплата» не ставится, остальное меняется', () => {
    expect(bulkSetupStep(pay, on, { needFile: true, connect: false }, POLICY)).toBeNull();
    expect(
      bulkSetupStep(pay, on, { needFile: true, needReceipt: true, connect: false }, POLICY),
    ).toEqual({ kind: 'patch', patch: { needReceipt: true } });
  });

  it('«Настроить»: неподключённый вид — только с «Подключить неподключённые»', () => {
    expect(bulkSetupStep(both, null, { needFile: true, connect: false }, POLICY)).toBeNull();
    expect(bulkSetupStep(both, off, { needFile: true, connect: false }, POLICY)).toBeNull();
    // Новая строка: дни учётной политики, если дни не заданы заново.
    expect(bulkSetupStep(both, null, { needFile: true, connect: true }, POLICY)).toEqual({
      kind: 'create',
      values: { enabled: true, remindDays: [7, 3], needFile: true, needReceipt: false },
    });
    expect(bulkSetupStep(both, null, { remindDays: [2], connect: true }, POLICY)).toEqual({
      kind: 'create',
      values: { enabled: true, remindDays: [2], needFile: false, needReceipt: false },
    });
    // Отключённый раньше вид возвращается с прежними настройками; меняется только отличие.
    expect(bulkSetupStep(both, off, { needReceipt: true, connect: true }, POLICY)).toEqual({
      kind: 'patch',
      patch: { enabled: true },
    });
    expect(bulkSetupStep(both, off, { needReceipt: false, connect: true }, POLICY)).toEqual({
      kind: 'patch',
      patch: { enabled: true, needReceipt: false },
    });
    // Отключённый в каталоге вид не подключается, но подключённый раньше — настраивается.
    expect(
      bulkSetupStep({ ...both, active: false }, null, { needFile: true, connect: true }, POLICY),
    ).toBeNull();
    expect(
      bulkSetupStep({ ...both, active: false }, on, { needFile: true, connect: true }, POLICY),
    ).toEqual({ kind: 'patch', patch: { needFile: true } });
  });

  it('в окне ничего не выбрано — всё «Не менять» и подключать нечего', () => {
    expect(bulkSetupEmpty({ connect: false })).toBe(true);
    expect(bulkSetupEmpty({ connect: true })).toBe(false);
    expect(bulkSetupEmpty({ needFile: false, connect: false })).toBe(false);
    expect(bulkSetupEmpty({ remindDays: [], connect: false })).toBe(false);
  });
});
