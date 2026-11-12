import { defaultUiTexts } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { contractorKanban, contractorMove } from './contractor-board';

// Доска контрагентов (прототип modules/contractors.js, `cpKanban`): перетаскиванием меняется только
// ответственный — с правом, не у архивного, в столбец сотрудника.

const t = makeTranslate(defaultUiTexts());
const ME = '00000000-0000-4000-8000-0000000000e1';
const OTHER = '00000000-0000-4000-8000-0000000000e2';
const cp = (serviceStatus: 'active' | 'paused' | 'archived' = 'active', responsible = ME) => ({
  serviceStatus,
  responsible: responsible ? { id: responsible, shortName: 'Я' } : null,
});
const ALL = { assign: true, createCp: true };

describe('доска контрагентов', () => {
  it('столбцы: ответственный по умолчанию; «Обслуживается» и «Приостановлен» видны и пустыми', () => {
    const kanban = contractorKanban(t, [{ key: OTHER, label: 'Айбек С.' }], () => {});
    expect(kanban.def).toBe('responsible');
    expect(kanban.by).toEqual([
      'responsible',
      'service',
      'regime',
      'kind',
      'form',
      'taxOffice',
      'socfund',
    ]);
    expect(kanban.order?.service).toEqual(['active', 'paused', 'archived']);
    expect(kanban.show?.service).toEqual([
      { key: 'active', label: 'Обслуживается' },
      { key: 'paused', label: 'Приостановлен' },
    ]);
    expect(kanban.show?.responsible).toEqual([{ key: OTHER, label: 'Айбек С.' }]);
    // Сумма в шапке столбца — целыми сомами, как в прототипе.
    expect(kanban.sum?.(125050)).toBe('1\u00a0251');
    expect(contractorKanban(t, [], undefined).drop).toBeUndefined();
  });

  it('по ответственному: вопрос о смене; свой столбец — ничего', () => {
    expect(contractorMove(cp(), ALL, 'responsible', OTHER)).toEqual({
      kind: 'responsible',
      employeeId: OTHER,
    });
    expect(contractorMove(cp('paused', ''), ALL, 'responsible', OTHER).kind).toBe('responsible');
    expect(contractorMove(cp(), ALL, 'responsible', ME)).toEqual({ kind: 'none' });
    // Достаточно одного из двух прав.
    for (const rights of [
      { assign: true, createCp: false },
      { assign: false, createCp: true },
    ])
      expect(contractorMove(cp(), rights, 'responsible', OTHER).kind).toBe('responsible');
  });

  it('отказы: не ответственный, нет права, архив, не столбец сотрудника', () => {
    for (const key of ['service', 'regime', 'kind', 'form', 'taxOffice', 'socfund'])
      expect(contractorMove(cp(), ALL, key, 'x')).toEqual({
        kind: 'refusal',
        key: 'cp.board.only',
      });
    expect(contractorMove(cp(), { assign: false, createCp: false }, 'responsible', OTHER)).toEqual({
      kind: 'refusal',
      key: 'cp.board.no_right',
    });
    expect(contractorMove(cp('archived'), ALL, 'responsible', OTHER)).toEqual({
      kind: 'refusal',
      key: 'cp.board.archived',
    });
    expect(contractorMove(cp(), ALL, 'responsible', '')).toEqual({
      kind: 'refusal',
      key: 'cp.board.pick_employee',
    });
    expect(contractorMove(cp(), ALL, 'responsible', OTHER, [ME])).toEqual({
      kind: 'refusal',
      key: 'cp.board.pick_employee',
    });
    expect(t('cp.board.only')).toBe(
      'Перетаскиванием меняется только ответственный. Остальное — в карточке контрагента',
    );
  });
});
