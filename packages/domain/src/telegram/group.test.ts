import { describe, expect, it } from 'vitest';
import { botPlainText } from './bot-message';
import {
  GROUP_MINE,
  GROUP_TITLE_MAX,
  groupMineMessage,
  groupStartToken,
  groupSummaryMessage,
  groupTitleClean,
} from './group';
import { groupMineOf, groupSummary, type ReminderReport } from './reminders';

// Общий чат фирмы (поток Т, задача Т8; прототип v105 modules/tg-group.js — `tgGrpRows`, `tgGrpMsg`,
// `tgAct('grpMine')`).
const TODAY = '2026-10-19';
const report = (id: string, patch: Partial<ReminderReport>): ReminderReport => ({
  id,
  label: id,
  typeShort: 'НДС',
  contractorName: 'ОсОО «Ромашка»',
  contractorResponsibleId: null,
  act: 'both',
  dueDate: TODAY,
  payDue: null,
  open: true,
  unpaid: false,
  responsibleId: 'e1',
  remindDays: [],
  waitingSince: null,
  submittedById: null,
  paused: false,
  ...patch,
});
const P = { today: TODAY, taxpay: true, reportConfirm: true } as const;
const TEXTS = {
  heading: 'Сводка на понедельник, 19 октября',
  sub: 'sub',
  employee: 'Сотрудник',
  today: 'Сегодня',
  overdue: 'Просроч.',
  unassigned: 'Без ответственного',
  mine: 'Мои',
  more: (n: number) => `ещё ${n} — на сайте`,
};

describe('сводка дня в общий чат фирмы', () => {
  const reports = [
    report('a', { responsibleId: 'e1' }),
    report('b', { responsibleId: 'e1', dueDate: '2026-10-14' }),
    // Оплата налога просрочена — тоже «просрочено».
    report('c', {
      responsibleId: 'e2',
      open: false,
      unpaid: true,
      payDue: '2026-10-16',
      dueDate: '2026-10-10',
    }),
    report('d', { responsibleId: null }),
    // Срок впереди, приостановлен, сдан и ждёт подтверждения — не в строках.
    report('e', { responsibleId: 'e3', dueDate: '2026-10-25' }),
    report('f', { responsibleId: 'e3', dueDate: '2026-10-01', paused: true }),
    report('g', { responsibleId: 'e3', open: false, waitingSince: '2026-10-18' }),
  ];

  it('числа по организации и по сотрудникам, как `tgGrpRows` прототипа', () => {
    expect(groupSummary(reports, P)).toEqual({
      today: 2,
      over: 2,
      wait: 1,
      rows: [
        { employeeId: 'e1', today: 1, over: 1 },
        { employeeId: 'e2', today: 0, over: 1 },
        { employeeId: null, today: 1, over: 0 },
      ],
    });
    // Без «Оплаты налогов» налог не считается, без подтверждения сдачи — «ждут» 0.
    expect(groupSummary(reports, { ...P, taxpay: false, reportConfirm: false })).toMatchObject({
      over: 1,
      wait: 0,
    });
  });

  it('нечего сдавать и нет просроченного — сводки нет', () => {
    expect(groupSummary([report('e', { dueDate: '2026-10-25' })], P)).toBeNull();
    expect(groupSummary([], P)).toBeNull();
  });

  it('сообщение: сначала с просроченным, потом по числу на сегодня и по имени; кнопка «Мои»; контрагентов нет', () => {
    const names = new Map([
      ['e1', 'Асанова А.'],
      ['e2', 'Бекова Б.'],
    ]);
    const message = groupSummaryMessage(groupSummary(reports, P)!, names, TEXTS);
    expect(message.tables![0]!.head).toEqual(['Сотрудник', 'Сегодня', 'Просроч.']);
    expect(message.tables![0]!.rows).toEqual([
      ['Асанова А.', '1', '1'],
      ['Бекова Б.', '0', '1'],
      ['Без ответственного', '1', '0'],
    ]);
    expect(message.buttons).toEqual([[{ text: 'Мои', action: GROUP_MINE }]]);
    expect(botPlainText(message)).not.toContain('Ромашка');
  });
});

describe('«Мои» в общем чате', () => {
  it('свои несданные со сроком сегодня и раньше и неоплаченные налоги с прошедшим сроком, давние первыми', () => {
    const list = groupMineOf(
      'e1',
      [
        report('a', { dueDate: TODAY }),
        report('b', { dueDate: '2026-10-14', unpaid: true, payDue: '2026-10-15' }),
        report('c', { dueDate: '2026-10-25' }),
        report('d', { responsibleId: 'e2', dueDate: '2026-10-01' }),
        report('e', { open: false, unpaid: true, payDue: TODAY }),
      ],
      P,
    );
    expect(list.map((x) => [x.report.id, x.due, x.pay])).toEqual([
      ['b', '2026-10-14', false],
      ['b', '2026-10-15', true],
      ['a', TODAY, false],
    ]);
  });

  it('скрытое сообщение: таблица «Контрагент | Отчёт | Срок», срок сегодня — словом', () => {
    const message = groupMineMessage(
      'Ваши отчёты',
      [
        { id: 'a', contractor: 'ОсОО «Ромашка»', report: 'НДС, сен.', due: TODAY },
        { id: 'b', contractor: 'ИП Садыков', report: '1-Т, сен.', due: '2026-10-14' },
      ],
      {
        columns: ['Контрагент', 'Отчёт', 'Срок'],
        today: 'сегодня',
        todayDay: TODAY,
        more: TEXTS.more,
      },
    );
    expect(message.heading).toBe('Ваши отчёты');
    expect(message.tables![0]!.rows.map((r) => r[2])).toEqual(['сегодня', '14.10']);
    expect(message.buttons).toBeUndefined();
  });
});

describe('ссылка подключения и название группы', () => {
  it('ключ — только из «g_<ключ>»', () => {
    expect(groupStartToken('g_abc')).toBe('abc');
    expect(groupStartToken('abc')).toBeNull();
  });

  it('название одной строкой, без управляющих знаков, не длиннее предела', () => {
    expect(groupTitleClean('  Бухгалтерия\n‮фирмы​ ')).toBe('Бухгалтерия фирмы');
    expect(groupTitleClean(undefined)).toBe('');
    expect([...groupTitleClean('я'.repeat(300))].length).toBeLessThanOrEqual(GROUP_TITLE_MAX);
  });
});
