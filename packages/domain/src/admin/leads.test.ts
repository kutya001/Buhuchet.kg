import { describe, expect, it } from 'vitest';
import { scaleStatuses } from '../common/status';
import { appendLeadNote, LEAD_NOTE_TOTAL_MAX, LEAD_STATUSES, leadSizeOptions } from './leads';

describe('заявки с лендинга', () => {
  it('статусы заявки — те же, что у шкалы «Заявка» справочника «Статусы»', () => {
    expect([...LEAD_STATUSES]).toEqual(scaleStatuses('lead'));
  });

  it('варианты «Сколько клиентов ведёте» — из текста словаря через «|»', () => {
    expect(leadSizeOptions('До 20|21–50| 51–100 |Больше 100|')).toEqual([
      'До 20',
      '21–50',
      '51–100',
      'Больше 100',
    ]);
    expect(leadSizeOptions('')).toEqual([]);
  });

  it('повторная заявка дописывает комментарий с новой строки, пустой — не меняет', () => {
    expect(appendLeadNote(null, ' Перезвоните после обеда ')).toBe('Перезвоните после обеда');
    expect(appendLeadNote('Первый', 'Второй')).toBe('Первый\nВторой');
    expect(appendLeadNote('Первый', '  ')).toBe('Первый');
    expect(appendLeadNote(null, '')).toBeNull();
    expect(appendLeadNote('x'.repeat(LEAD_NOTE_TOTAL_MAX), 'ещё')).toHaveLength(
      LEAD_NOTE_TOTAL_MAX,
    );
  });
});
