import { defaultUiTexts, isScaleStatus, scalePosition } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import {
  buildSamples,
  moveSample,
  rollbackFrom,
  rollbackSample,
  SAMPLE_IDS,
  sampleBack,
  sampleNext,
  type SampleId,
} from './status-samples-data';

// Демо-записи страницы образцов: история сходится со статусом, переходы и откаты пишут историю.

const t = makeTranslate(defaultUiTexts());
const NOW = Date.parse('2026-10-26T08:00:00Z');
const samples = buildSamples(t, NOW, 'Бекзат Т.');
const scaleOf = (id: SampleId, i = 0) => samples.find((s) => s.id === id)!.scales[i]!;
const at = new Date(NOW + 60_000);

describe('демо-записи', () => {
  it('по записи на каждый образец; история по порядку и кончается текущим статусом', () => {
    expect(samples.map((s) => s.id)).toEqual(SAMPLE_IDS);
    for (const sample of samples)
      for (const s of sample.scales) {
        expect(isScaleStatus(s.scale, s.status)).toBe(true);
        const times = s.history.map((e) => e.at.getTime());
        expect(times).toEqual([...times].sort((a, b) => a - b));
        expect(Math.max(...times)).toBeLessThan(NOW);
        // Последняя запись — текущий статус или отметка подтверждения на нём.
        expect([s.status, s.mark]).toContain(s.history.at(-1)!.to);
        for (const [i, e] of s.history.entries())
          expect(e.from, `${sample.id} ${i}`).toBe(i === 0 ? null : s.history[i - 1]!.to);
      }
  });

  it('есть боковой статус, «Не требуется», отметка подтверждения и откат в истории', () => {
    expect(scalePosition('report', scaleOf('report_fix').status)?.side).toBeTruthy();
    expect(scaleOf('report_none').status).toBe('not_required');
    expect(scaleOf('report_confirmed').mark).toBe('confirmed');
    expect(scaleOf('task_failed').history.some((e) => e.rollback && e.reason)).toBe(true);
  });
});

describe('переходы и откаты', () => {
  it('следующий шаг — новая строка истории от вошедшего; «Сдан» с подтверждением — ждёт', () => {
    const report = scaleOf('report_confirmed');
    const back = rollbackSample(report, 'waiting', 'ошибка', at, 'Бекзат Т.');
    const inWork = rollbackSample(back, 'in_progress', 'не та форма', at, 'Бекзат Т.');
    expect(sampleNext(inWork)).toEqual(['submitted']);
    const moved = moveSample(inWork, 'submitted', at, 'Бекзат Т.');
    expect(moved.mark).toBe('waiting');
    expect(moved.history.at(-1)).toEqual({
      at,
      from: 'in_progress',
      to: 'submitted',
      rollback: false,
      reason: null,
      actor: 'Бекзат Т.',
    });
  });

  it('снять подтверждение — откат отметки, статус «Сдан» остаётся; дальше — откат в «В работе»', () => {
    const report = scaleOf('report_confirmed');
    expect(sampleBack(report, true)).toBe('waiting');
    expect(rollbackFrom(report, 'waiting')).toBe('confirmed');
    const back = rollbackSample(report, 'waiting', 'подтвердили по ошибке', at, 'Бекзат Т.');
    expect(back).toMatchObject({ status: 'submitted', mark: 'waiting' });
    expect(back.history.at(-1)).toMatchObject({
      from: 'confirmed',
      to: 'waiting',
      rollback: true,
      reason: 'подтвердили по ошибке',
    });
    expect(sampleBack(back, true)).toBe('in_progress');
    expect(rollbackFrom(back, 'in_progress')).toBe('submitted');
    expect(rollbackSample(back, 'in_progress', 'x', at, 'Бекзат Т.')).toMatchObject({
      status: 'in_progress',
      mark: null,
    });
  });

  it('без права «Откат статусов» откатывать некуда; «Требует исправления» — назад в «Сдан» с ожиданием', () => {
    expect(sampleBack(scaleOf('task_failed'), false)).toBeNull();
    expect(sampleBack(scaleOf('task_failed'), true)).toBe('in_progress');
    const fix = scaleOf('report_fix');
    expect(rollbackSample(fix, 'submitted', 'x', at, 'Бекзат Т.')).toMatchObject({
      status: 'submitted',
      mark: 'waiting',
    });
  });

  it('оплата: откат отменяет последнюю оплату', () => {
    const unpaid = scaleOf('report', 1);
    expect(sampleBack(unpaid, true)).toBeNull();
    const partial = moveSample(unpaid, 'partial', at, 'Бекзат Т.');
    expect(sampleBack(partial, true)).toBe('unpaid');
    expect(sampleBack(moveSample(partial, 'paid', at, 'Бекзат Т.'), true)).toBe('partial');
    expect(sampleBack(moveSample(unpaid, 'paid', at, 'Бекзат Т.'), true)).toBe('unpaid');
  });
});
