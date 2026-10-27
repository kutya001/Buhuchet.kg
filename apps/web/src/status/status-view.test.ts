import { defaultUiTexts, STATUS_SCALE_DEFS, STATUS_SCALES } from '@buhuchet/domain';
import { ICONS } from '@buhuchet/ui';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import {
  confirmMarkLabel,
  historyView,
  miniView,
  rollbackTitle,
  scaleView,
  statusEvents,
  type StatusEvent,
} from './status-view';

// Шкала и «История статусов» на экранах (прототип ui/status-scale.js: scaleFull, scaleMini,
// statusHistHtml): какие шаги, даты, отметки и строки истории получают компоненты.

const t = makeTranslate(defaultUiTexts());
// Время по Бишкеку (UTC+6): 03:00Z — 09:00.
const at = (iso: string) => new Date(`${iso}+06:00`);
const ev = (time: string, from: string | null, to: string, more: Partial<StatusEvent> = {}) => ({
  at: at(time),
  from,
  to,
  rollback: false,
  reason: null,
  actor: 'Тилекова А.',
  ...more,
});

const report: StatusEvent[] = [
  ev('2026-10-01T09:00', null, 'todo', { actor: null, reason: 'Отчёт создан по назначению' }),
  ev('2026-10-05T14:20', 'todo', 'in_progress'),
  ev('2026-10-07T10:00', 'in_progress', 'submitted', { file: { name: 'квитанция.pdf' } }),
  ev('2026-10-08T11:00', 'submitted', 'in_progress', { rollback: true, reason: 'не та форма' }),
  ev('2026-10-09T16:30', 'in_progress', 'submitted'),
];

describe('полная шкала (scaleFull)', () => {
  it('шаги с датой последней установки, текущий — цветом статуса, будущих дат нет', () => {
    const view = scaleView(t, {
      scale: 'report',
      status: 'in_progress',
      history: report.slice(0, 2),
      next: ['submitted'],
    });
    expect(view.kind).toBe('scale');
    if (view.kind !== 'scale') return;
    expect(view.props.title).toBe('Сдача');
    expect(view.props.steps).toEqual([
      { code: 'todo', label: 'К сдаче', at: '01.10.2026 09:00' },
      { code: 'in_progress', label: 'В работе', at: '05.10.2026 14:20' },
      { code: 'submitted', label: 'Сдан', at: null },
    ]);
    expect(view.props.index).toBe(1);
    expect(view.props.tone).toBe('blue');
    expect(view.props.next).toEqual(['submitted']);
    expect(view.props.labels.moveTo('Сдан')).toBe('Перевести в «Сдан»');
  });

  it('после отката шаг показывает последнюю установку', () => {
    const view = scaleView(t, { scale: 'report', status: 'submitted', history: report });
    if (view.kind !== 'scale') throw new Error(view.kind);
    expect(view.props.steps.map((s) => s.at)).toEqual([
      '01.10.2026 09:00',
      '08.10.2026 11:00',
      '09.10.2026 16:30',
    ]);
    expect(view.props.tone).toBe('green');
  });

  it('отметка подтверждения: цвет шкалы по отметке, значок «ждёт» или «подтверждено»', () => {
    const waiting = scaleView(t, {
      scale: 'report',
      status: 'submitted',
      history: report,
      mark: 'waiting',
    });
    if (waiting.kind !== 'scale') throw new Error(waiting.kind);
    expect(waiting.props.tone).toBe('yellow');
    expect(waiting.props.mark).toEqual({
      label: 'Ждёт подтверждения',
      tone: 'yellow',
      icon: 'hourglass',
    });
    const confirmed = scaleView(t, {
      scale: 'report',
      status: 'submitted',
      history: report,
      mark: 'confirmed',
    });
    if (confirmed.kind !== 'scale') throw new Error(confirmed.kind);
    expect(confirmed.props.mark).toMatchObject({ label: 'Подтверждено', icon: 'check' });
  });

  it('боковой статус — на своём шаге с его датой; задача с подтверждением — четыре шага', () => {
    const fix = scaleView(t, {
      scale: 'report',
      status: 'needs_fix',
      history: [...report, ev('2026-10-10T11:00', 'submitted', 'needs_fix')],
      back: 'submitted',
    });
    if (fix.kind !== 'scale') throw new Error(fix.kind);
    expect(fix.props.index).toBe(2);
    expect(fix.props.side).toEqual({
      label: 'Требует исправления',
      tone: 'red',
      at: '10.10.2026 11:00',
    });
    expect(fix.props.back).toBe('submitted');

    const task = scaleView(t, { scale: 'task', status: 'on_confirm', history: [], confirm: true });
    if (task.kind !== 'scale') throw new Error(task.kind);
    expect(task.props.steps.map((s) => s.label)).toEqual([
      'К выполнению',
      'В работе',
      'На подтверждении',
      'Подтверждена',
    ]);
    expect(task.props.tone).toBe('purple');
  });

  it('«Не требуется» — надпись, с какого времени и «Снять», только если откат разрешён', () => {
    const history = [
      ev('2026-10-01T09:00', null, 'todo'),
      ev('2026-10-12T10:00', 'todo', 'not_required'),
    ];
    expect(
      scaleView(t, { scale: 'report', status: 'not_required', history, back: 'todo' }),
    ).toEqual({
      kind: 'none',
      title: 'Сдача',
      text: 'Не требуется — шкала не ведётся',
      since: 'с 12.10.2026 10:00',
      undo: 'Снять «Не требуется»',
    });
    const noRight = scaleView(t, { scale: 'report', status: 'not_required', history: [] });
    expect(noRight).toMatchObject({ kind: 'none', since: null, undo: null });
  });

  it('статус не с этой шкалы — просто метка', () => {
    expect(scaleView(t, { scale: 'report', status: 'waiting', history: [] })).toEqual({
      kind: 'pill',
      title: 'Сдача',
      pill: { label: 'Ждёт подтверждения', tone: 'yellow', icon: 'hourglass' },
    });
  });
});

describe('отметка подтверждения сдачи (repConfTxt)', () => {
  it('«Ждёт подтверждения · N дн.» с последней сдачи; «Подтвердил …» по последнему подтверждению', () => {
    expect(confirmMarkLabel(t, report, 'waiting', at('2026-10-12T08:00'))).toBe(
      'Ждёт подтверждения · 3 дн.',
    );
    expect(confirmMarkLabel(t, [], 'waiting', at('2026-10-12T08:00'))).toBe(
      'Ждёт подтверждения · 0 дн.',
    );
    const confirmed = [...report, ev('2026-10-10T09:00', 'submitted', 'confirmed')];
    expect(confirmMarkLabel(t, confirmed, 'confirmed', at('2026-10-12T08:00'))).toBe(
      'Подтвердил Тилекова А.',
    );
    const bySystem = [...report, ev('2026-10-10T09:00', 'submitted', 'confirmed', { actor: null })];
    expect(confirmMarkLabel(t, bySystem, 'confirmed', at('2026-10-12T08:00'))).toBe('Подтверждено');
  });

  it('текст отметки — на шаге «Сдан» и в подсказке компактной шкалы', () => {
    const view = scaleView(t, {
      scale: 'report',
      status: 'submitted',
      history: report,
      mark: 'waiting',
      markLabel: 'Ждёт подтверждения · 3 дн.',
    });
    if (view.kind !== 'scale') throw new Error(view.kind);
    expect(view.props.mark?.label).toBe('Ждёт подтверждения · 3 дн.');
    const mini = miniView(t, {
      scale: 'report',
      status: 'submitted',
      history: report,
      mark: 'waiting',
      markLabel: 'Ждёт подтверждения · 3 дн.',
    });
    if (mini.kind !== 'mini') throw new Error(mini.kind);
    expect(mini.props.title).toBe('Этап 3 из 3: Сдан · Ждёт подтверждения · 3 дн.');
  });
});

describe('компактная шкала (scaleMini)', () => {
  it('«Этап 2 из 3», время последней смены и кто в подсказке; система — «Система»', () => {
    const view = miniView(t, {
      scale: 'report',
      status: 'in_progress',
      history: report.slice(0, 2),
    });
    expect(view).toEqual({
      kind: 'mini',
      props: {
        count: 3,
        index: 1,
        tone: 'blue',
        label: 'В работе',
        side: false,
        title: 'Этап 2 из 3: В работе',
        at: '05.10.2026 14:20',
        atTitle: 'Установлен 05.10.2026 14:20, Тилекова А.',
        mark: null,
      },
    });
    const first = miniView(t, { scale: 'report', status: 'todo', history: report.slice(0, 1) });
    if (first.kind !== 'mini') throw new Error(first.kind);
    expect(first.props.atTitle).toBe('Установлен 01.10.2026 09:00, Система');
  });

  it('отметка — в подсказке; без истории — без времени; «Не требуется» — серая надпись', () => {
    const marked = miniView(t, {
      scale: 'report',
      status: 'submitted',
      history: [],
      mark: 'waiting',
    });
    if (marked.kind !== 'mini') throw new Error(marked.kind);
    expect(marked.props.title).toBe('Этап 3 из 3: Сдан · Ждёт подтверждения');
    expect(marked.props.at).toBeNull();
    expect(marked.props.atTitle).toBeUndefined();
    expect(miniView(t, { scale: 'payment', status: 'not_required', history: [] })).toEqual({
      kind: 'none',
      label: 'Не требуется',
      title: 'Не требуется: шкала не ведётся',
    });
    const failed = miniView(t, { scale: 'task', status: 'failed', history: [] });
    if (failed.kind !== 'mini') throw new Error(failed.kind);
    expect(failed.props).toMatchObject({ index: 2, side: true, label: 'Не выполнена' });
  });
});

describe('«История статусов» (statusHistHtml)', () => {
  it('было → стало, кто, причина отката, файл, время в статусе до следующей смены и итоги', () => {
    const { rows, totals } = historyView(t, 'report', report, at('2026-10-12T16:30'));
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({
      at: '01.10.2026 09:00',
      from: null,
      to: { label: 'К сдаче', tone: 'gray', icon: 'circle' },
      actor: 'Система',
      note: 'Отчёт создан по назначению',
      duration: '4 дня',
      now: false,
    });
    expect(rows[2]).toMatchObject({ from: 'В работе', file: { name: 'квитанция.pdf' } });
    expect(rows[3]).toMatchObject({
      from: 'Сдан',
      to: { label: 'В работе' },
      rollback: true,
      note: 'не та форма',
      duration: '1 день',
    });
    expect(rows[4]).toMatchObject({ duration: '3 дня', now: true });
    expect(new Set(rows.map((r) => r.key)).size).toBe(5);
    expect(totals).toEqual([
      { label: 'К сдаче', duration: '4 дня' },
      { label: 'В работе', duration: '3 дня' },
      { label: 'Сдан', duration: '4 дня' },
    ]);
  });

  it('меньше часа и часы', () => {
    const { rows } = historyView(
      t,
      'task',
      [ev('2026-10-01T09:00', null, 'todo'), ev('2026-10-01T09:40', 'todo', 'in_progress')],
      at('2026-10-01T14:40'),
    );
    expect(rows.map((r) => r.duration)).toEqual(['меньше часа', '5 ч']);
  });

  it('из ответа API — время строкой; заголовок отката — названия статусов', () => {
    const [e] = statusEvents([
      {
        at: '2026-10-05T08:20:00.000Z',
        from: 'todo',
        to: 'in_progress',
        rollback: false,
        reason: null,
        actor: null,
      },
    ]);
    expect(e!.at.toISOString()).toBe('2026-10-05T08:20:00.000Z');
    expect(e!.file).toBeNull();
    const id = '00000000-0000-4000-8000-0000000000f1';
    const entry = { at: '2026-10-05T08:20:00.000Z', from: null, to: 'todo' } as const;
    const withFile = statusEvents([
      {
        ...entry,
        rollback: false,
        reason: null,
        actor: null,
        file: { id, name: 'чек.pdf', available: true },
      },
      {
        ...entry,
        rollback: false,
        reason: null,
        actor: null,
        file: { id, name: 'чек.pdf', available: false },
      },
    ]);
    // Файл к смене статуса — ссылка на скачивание; удалённый — только имя.
    expect(withFile.map((x) => x.file)).toEqual([
      { name: 'чек.pdf', href: `/api/files/${id}/download` },
      { name: 'чек.pdf', href: undefined },
    ]);
    expect(rollbackTitle(t, 'report', 'submitted', 'in_progress')).toBe(
      'Откатить: «Сдан» → «В работе»',
    );
  });
});

describe('словарь и значки', () => {
  it('у каждого статуса каждой шкалы есть название в словаре и значок в наборе', () => {
    const texts = defaultUiTexts();
    for (const scale of STATUS_SCALES) {
      expect(texts[`status.scale.${scale}`]).toBeTruthy();
      for (const [code, look] of Object.entries(STATUS_SCALE_DEFS[scale].look)) {
        expect(texts[`status.${scale}.${code}`], `${scale}.${code}`).toBeTruthy();
        expect(Object.hasOwn(ICONS, look.icon), look.icon).toBe(true);
      }
    }
  });
});
