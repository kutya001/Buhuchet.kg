import { defaultUiTexts } from '@buhuchet/domain';
import type { ReportRow } from '@buhuchet/shared';
import type { ActionEntry, ActionItem, ShellModule } from '@buhuchet/ui';
import { describe, expect, it, vi } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { withTabCounts } from '../shell/tab-counts';
import {
  amountText,
  dueMovedTitle,
  reportColumns,
  reportDefaultVisible,
  reportMark,
  reportMarkText,
  reportTone,
} from './report-columns';
import {
  reportCardButtons,
  reportMenuEntries,
  reportRollbackEffect,
  reportScaleBack,
  reportScaleSteps,
  type ReportActor,
  type ReportMenuRow,
  type ReportMenuRun,
} from './report-menu';
import { rowNeedsFile, rowNeedsReceipt } from './report-status-dialogs';
import { isPlateFilter, monthEnd, plateFilters } from './report-plates';
import { noTypesHint, reportTabCounts } from './reports-data';

// Список «Отчетов для сдачи» (задача 2.13; прототип modules/reports.js — reportCols, reportActions,
// repMark, renderReports): меню строки, отметки подтверждения, суммы, переносы срока, плашки.

const t = makeTranslate(defaultUiTexts());

const report = (over: Partial<ReportRow> = {}) =>
  ({
    id: '00000000-0000-4000-8000-000000000100',
    contractor: { id: '00000000-0000-4000-8000-000000000001', name: 'ОсОО «Ала-Тоо Трейд»' },
    type: { code: 'nds', name: 'НДС', shortName: 'НДС' },
    act: 'both',
    periodLabel: '09.2026',
    periodFull: 'сентябрь 2026',
    revision: 0,
    dueDate: '2026-10-26',
    dueBase: '2026-10-25',
    dueManual: false,
    dueHoliday: '',
    status: 'todo',
    overdue: false,
    amount: null,
    amountAuto: false,
    waitDays: null,
    confirmedAt: null,
    confirmedBy: null,
    submittedBy: null,
    needFile: false,
    needReceipt: false,
    hasFiles: false,
    version: 1,
    ...over,
  }) as ReportRow;

const ME = '00000000-0000-4000-8000-0000000000e1';
const OTHER = { id: '00000000-0000-4000-8000-0000000000e2', shortName: 'Айбек С.' };

const actor = (
  over: Partial<ReportActor['can']> = {},
  o: Partial<ReportActor> = {},
): ReportActor => ({
  employeeId: ME,
  isOwner: false,
  confirmOn: true,
  filesOn: true,
  can: {
    changeStatus: true,
    repDue: true,
    repConfirm: true,
    changeSum: true,
    rollback: true,
    filesUpload: true,
    ...over,
  },
  ...o,
});

const menu = (r: ReportMenuRow, who: ReportActor = actor(), card = false) => {
  const run = Object.fromEntries(
    [
      'open',
      'submit',
      'start',
      'confirm',
      'fix',
      'reject',
      'due',
      'amount',
      'file',
      'revision',
      'rollback',
      'not_required',
    ].map((k) => [k, vi.fn()]),
  ) as unknown as ReportMenuRun & Record<string, ReturnType<typeof vi.fn>>;
  return { run, entries: reportMenuEntries({ t, actor: who, run, card })(r) };
};
const items = (list: readonly ActionEntry[]) =>
  list.filter((x): x is ActionItem => !('separator' in x));
const labels = (list: readonly ActionEntry[]) => items(list).map((x) => x.label);
const entry = (list: readonly ActionEntry[], id: string) => items(list).find((x) => x.id === id);

describe('меню отчёта (прототип reportActions)', () => {
  it('у «К сдаче» со сдачей и уплатой — открыть, сдать, взять в работу, срок, сумма, файл, «Не требуется»', () => {
    const r = report();
    const { run, entries } = menu(r);
    expect(labels(entries)).toEqual([
      'Открыть карточку',
      'Отметить сданным',
      'Взять в работу',
      'Изменить срок',
      'Указать сумму',
      'Прикрепить файл',
      'Не требуется',
    ]);
    entry(entries, 'submit')!.run();
    expect(run.submit).toHaveBeenCalledWith(r);
    // В карточке «Открыть карточку» нет.
    expect(labels(menu(r, actor(), true).entries)[0]).toBe('Отметить сданным');
  });

  it('без прав пункты видны бледными с причиной', () => {
    const { entries } = menu(
      report(),
      actor({ changeStatus: false, repDue: false, changeSum: false }),
    );
    expect(entry(entries, 'submit')).toMatchObject({
      disabled: true,
      reason: 'Нет права менять статус',
    });
    expect(entry(entries, 'due')).toMatchObject({
      disabled: true,
      reason: 'Нужно право «Изменять срок отчёта»',
    });
    expect(entry(entries, 'amount')).toMatchObject({
      disabled: true,
      reason: 'Нет права менять сумму',
    });
    expect(entry(menu(report(), actor({ filesUpload: false })).entries, 'file')).toBeUndefined();
    expect(entry(menu(report(), actor({}, { filesOn: false })).entries, 'file')).toBeUndefined();
  });

  it('п. 3: у вида «Сдача» (статистика) суммы нет; у «Уплаты» нет сдачи и срока', () => {
    expect(entry(menu(report({ act: 'sub' })).entries, 'amount')).toBeUndefined();
    const pay = labels(menu(report({ act: 'pay' })).entries);
    expect(pay).not.toContain('Отметить сданным');
    expect(pay).not.toContain('Изменить срок');
    expect(pay).toContain('Указать сумму');
  });

  it('п. 62: ждущий подтверждения — «Подтвердить» и «На исправление»; свой — бледные с причиной, владельцу можно', () => {
    const waiting = report({ status: 'submitted', submittedBy: OTHER });
    const list = labels(menu(waiting).entries);
    expect(list).toEqual([
      'Открыть карточку',
      'Подтвердить',
      'На исправление',
      'Требует исправления',
      'Указать сумму',
      'Прикрепить файл',
      'Создать уточнённый',
      'Откатить в «В работе»',
      'Не требуется',
    ]);
    const own = report({ status: 'submitted', submittedBy: { id: ME, shortName: 'Я' } });
    expect(entry(menu(own).entries, 'confirm')).toMatchObject({
      disabled: true,
      reason: 'Свой сданный отчёт подтвердить нельзя: подтверждает другой сотрудник с правом',
    });
    expect(entry(menu(own, actor({}, { isOwner: true })).entries, 'confirm')?.disabled).toBeFalsy();
    expect(entry(menu(waiting, actor({ repConfirm: false })).entries, 'fix')).toMatchObject({
      disabled: true,
      reason: 'Нужно право «Подтверждать сдачу отчётов»',
    });
  });

  it('подтверждённый — «Снять подтверждение», «Не требуется» нет; без подтверждения в политике отметок нет', () => {
    const confirmed = report({
      status: 'submitted',
      submittedBy: OTHER,
      confirmedAt: '2026-10-20T05:00:00.000Z',
    });
    const list = labels(menu(confirmed).entries);
    expect(list).toContain('Снять подтверждение');
    expect(list).not.toContain('Подтвердить');
    expect(list).not.toContain('Не требуется');
    const off = labels(
      menu(report({ status: 'submitted' }), actor({}, { confirmOn: false })).entries,
    );
    expect(off).not.toContain('Подтвердить');
    expect(off).toContain('Откатить в «В работе»');
    expect(entry(menu(confirmed, actor({ rollback: false })).entries, 'rollback')).toMatchObject({
      disabled: true,
      reason: 'Нужно право «Откат статусов»',
    });
  });

  it('прежняя версия: только «Прикрепить файл» и откат с причиной', () => {
    const old = { ...report({ status: 'submitted' }), superseded: true };
    const { entries } = menu(old, actor(), true);
    expect(labels(entries)).toEqual(['Прикрепить файл', 'Откатить в «—»']);
    expect(entry(entries, 'rollback')).toMatchObject({
      disabled: true,
      reason: 'Сначала откатите уточнённую версию отчёта',
    });
  });
});

describe('кнопки и шкала карточки', () => {
  it('несданный — «Отметить сданным» (без права — недоступна); ждущий — «Подтвердить» и «На исправление»', () => {
    expect(reportCardButtons(report(), actor())).toEqual({
      primary: 'submit',
      disabled: false,
      fix: false,
    });
    expect(reportCardButtons(report(), actor({ changeStatus: false })).disabled).toBe(true);
    expect(reportCardButtons(report({ status: 'submitted', submittedBy: OTHER }), actor())).toEqual(
      { primary: 'confirm', disabled: false, fix: true },
    );
    expect(
      reportCardButtons(
        report({ status: 'submitted', submittedBy: { id: ME, shortName: 'Я' } }),
        actor(),
      ).primary,
    ).toBeNull();
  });

  it('шаги шкалы: «В работе» — сразу, «Сдан» — окном; откат — с правом', () => {
    expect(reportScaleSteps(report(), actor())).toEqual({
      in_progress: 'start',
      submitted: 'submit',
    });
    expect(reportScaleSteps(report({ status: 'needs_fix' }), actor())).toEqual({
      submitted: 'submit',
    });
    expect(reportScaleSteps(report(), actor({ changeStatus: false }))).toEqual({});
    expect(reportScaleBack(report({ status: 'in_progress' }), actor())).toBe('todo');
    expect(
      reportScaleBack(report({ status: 'in_progress' }), actor({ rollback: false })),
    ).toBeNull();
  });

  it('последствия отката (прототип rollbackDlg)', () => {
    const o = { confirmOn: true, today: '2026-10-28' };
    expect(reportRollbackEffect(t, report({ status: 'submitted' }), 'in_progress', o)).toBe(
      'Регулярная задача по отчёту снова станет открытой. Срок уже прошёл — отчёт снова попадёт в просроченные, пойдут напоминания. Дата сдачи будет снята. Приложенные файлы не удаляются.',
    );
    expect(reportRollbackEffect(t, report({ status: 'needs_fix' }), 'submitted', o)).toBe(
      'Регулярная задача по отчёту снова станет открытой. Отчёт снова будет ждать подтверждения сдачи. Приложенные файлы не удаляются.',
    );
    expect(
      reportRollbackEffect(t, report({ status: 'not_required', dueDate: '2026-11-25' }), 'todo', o),
    ).toBe('Отчёт и его регулярная задача снова станут активными. Приложенные файлы не удаляются.');
    expect(
      reportRollbackEffect(t, report({ status: 'submitted', confirmedBy: OTHER }), 'waiting', o),
    ).toMatch(/^Подтверждение Айбек С\. будет снято/);
  });
});

describe('массовые окна', () => {
  const on = { confirmOn: true, filesOn: true };
  it('нужен файл — при обязательном файле без файлов; квитанция — при выключенном подтверждении', () => {
    expect(rowNeedsFile(report({ needFile: true, hasFiles: false }), on)).toBe(true);
    expect(rowNeedsFile(report({ needFile: true, hasFiles: true }), on)).toBe(false);
    expect(rowNeedsFile(report({ needReceipt: true }), on)).toBe(false);
    expect(rowNeedsFile(report({ needReceipt: true }), { ...on, confirmOn: false })).toBe(true);
    expect(rowNeedsFile(report({ needFile: true }), { ...on, filesOn: false })).toBe(false);
    expect(rowNeedsReceipt(report({ needReceipt: true }), on)).toBe(true);
  });
});

describe('отметка подтверждения сдачи', () => {
  it('только у сданного отчёта со сдачей и при подтверждении в учётной политике', () => {
    expect(reportMark(report({ status: 'submitted' }), false)).toBeNull();
    expect(reportMark(report({ status: 'in_progress' }), true)).toBeNull();
    expect(reportMark(report({ act: 'pay', status: 'submitted' }), true)).toBeNull();
    expect(reportMark(report({ status: 'submitted' }), true)).toBe('waiting');
    expect(
      reportMark(report({ status: 'submitted', confirmedAt: '2026-10-20T05:00:00.000Z' }), true),
    ).toBe('confirmed');
  });

  it('«Ждёт подтверждения · N дн.» и «Подтвердил …»', () => {
    expect(reportMarkText(t, report({ status: 'submitted', waitDays: 4 }), true)).toBe(
      'Ждёт подтверждения · 4 дн.',
    );
    expect(
      reportMarkText(
        t,
        report({
          status: 'submitted',
          confirmedAt: '2026-10-20T05:00:00.000Z',
          confirmedBy: { id: '00000000-0000-4000-8000-00000000000a', shortName: 'Мээрим К.' },
        }),
        true,
      ),
    ).toBe('Подтвердил Мээрим К.');
    expect(reportMarkText(t, report({ status: 'submitted' }), false)).toBe('');
  });
});

describe('строка отчёта', () => {
  it('сумма: у «Сдача» и у не указанной — пусто, иначе в сомах', () => {
    expect(amountText(report({ act: 'sub', amount: 500_000 }))).toBe('');
    expect(amountText(report({ amount: null }))).toBe('');
    expect(amountText(report({ amount: 125_050 }))).toMatch(/^1\s250,50$/);
  });

  it('подсказка у «перенос»: праздник, выходной или срок, изменённый вручную', () => {
    expect(
      dueMovedTitle(t, report({ dueHoliday: 'День независимости', dueBase: '2026-08-31' })),
    ).toBe('Перенесён с 31.08.2026: День независимости');
    expect(dueMovedTitle(t, report({ dueHoliday: '' }))).toBe(
      'Перенесён с 25.10.2026: выходной день',
    );
    expect(dueMovedTitle(t, report({ dueManual: true, dueHoliday: null }))).toBe(
      'Срок изменён вручную; по закону — 25.10.2026',
    );
  });

  it('просроченный — красным, «Не требуется» — приглушённо', () => {
    expect(reportTone(report({ overdue: true }))).toBe('overdue');
    expect(reportTone(report({ status: 'not_required' }))).toBe('muted');
    expect(reportTone(report())).toBeUndefined();
  });
});

describe('столбцы', () => {
  const keys = (o: Parameters<typeof reportColumns>[1]) => reportColumns(t, o).map((c) => c.key);
  const base = { waiting: false, confirm: true, waitDays: 3, phone: false };

  it('порядок прототипа: «Что сделать» сразу за видом отчёта; на ПК — отдельным столбцом', () => {
    const list = keys(base);
    expect(list.slice(0, 5)).toEqual(['cp', 'inn', 'taxOffice', 'type', 'act']);
    expect(list).toEqual(expect.arrayContaining(['confirm', 'confirmedOn']));
    expect(reportColumns(t, base).find((c) => c.key === 'act')?.desktopOnly).toBe(true);
  });

  it('«Ждёт, дней» и «Сдал» — только во вкладке «Ожидают подтверждения»; без подтверждения — без его столбцов', () => {
    expect(keys(base)).not.toContain('wait');
    const waiting = keys({ ...base, waiting: true });
    expect(waiting.indexOf('wait')).toBe(waiting.indexOf('status') + 1);
    expect(waiting.indexOf('submittedBy')).toBe(waiting.indexOf('status') + 2);
    expect(keys({ ...base, confirm: false })).not.toContain('confirm');
    expect(reportDefaultVisible(true)).toEqual([
      'cp',
      'type',
      'act',
      'period',
      'due',
      'status',
      'wait',
      'submittedBy',
      'amount',
      'responsible',
    ]);
  });

  it('«К уплате» — строкой сумм на плитке телефона, у вида «Сдача» строки нет', () => {
    const amount = reportColumns(t, { ...base, phone: true }).find((c) => c.key === 'amount')!;
    expect(amount.tileLine).toBeDefined();
    expect(amount.text(report({ act: 'sub' }))).toBe('');
  });
});

describe('плашки и счётчики', () => {
  it('«Сдано в этом месяце» — статус «Сдан» и дата сдачи в месяце; «К уплате» — срок оплаты в месяце', () => {
    expect(plateFilters('submitted', '2026-10-01')).toEqual({
      status: { type: 'enum', vals: ['submitted'] },
      submitted: { type: 'date', from: '2026-10-01', to: '2026-10-31' },
    });
    expect(plateFilters('to_pay', '2026-12-01')).toEqual({
      payDue: { type: 'date', from: '2026-12-01', to: '2026-12-31' },
    });
    expect(monthEnd('2028-02-01')).toBe('2028-02-29');
    expect(isPlateFilter('to_pay')).toBe(true);
    expect(isPlateFilter('overdue')).toBe(false);
  });

  it('у вкладок — «На неделе», «Просрочено» красным и «Ожидают подтверждения»; ноль тоже виден', () => {
    expect(reportTabCounts({ week: 4, overdue: 53, waiting: 0 })).toEqual({
      week: { value: 4 },
      overdue: { value: 53, tone: 'red' },
      waiting: { value: 0 },
    });
  });

  it('«Подключите виды отчётов» — пока нет подключённых видов: с правом справочников — «Выбрать налоги», без него — «Подключает владелец»', () => {
    expect(noTypesHint([], true)).toBe('pick');
    expect(noTypesHint([{ enabled: false }], false)).toBe('owner');
    expect(noTypesHint([{ enabled: false }, { enabled: true }], true)).toBeNull();
    expect(noTypesHint([{ enabled: true }], false)).toBeNull();
  });

  it('у модуля в левой панели — число просроченных, только когда оно больше нуля', () => {
    const module = {
      id: 'reports',
      title: 'Отчеты для сдачи',
      tabs: [{ id: 'overdue', label: 'Просрочено' }],
    } as unknown as ShellModule;
    expect(
      withTabCounts(module, reportTabCounts({ week: 0, overdue: 3, waiting: 0 })).count,
    ).toEqual({ value: 3, tone: 'red' });
    expect(
      withTabCounts(module, reportTabCounts({ week: 0, overdue: 0, waiting: 0 })).count,
    ).toBeUndefined();
  });
});
