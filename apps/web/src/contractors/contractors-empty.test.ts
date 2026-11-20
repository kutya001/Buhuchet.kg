import { describe, expect, it } from 'vitest';
import { contractorsEmptyView } from './contractors-empty';

// Пустой список контрагентов (прототип ui/empty.js `firstEmpty`, modules/contractors.js `empty`,
// grid.js `emptyadd`): первый вход — «Добавить контрагента» и «Загрузить из Excel» по правам на любой
// вкладке; пустая вкладка при других контрагентах — одна «Добавить» и только на «Все».

const ALL = { createCp: true, cpImport: true };
const NONE = { createCp: false, cpImport: false };

describe('contractorsEmptyView', () => {
  it('первый вход: пояснение и обе кнопки по правам на любой вкладке', () => {
    for (const tab of ['all', 'mine', 'debtors'] as const) {
      expect(contractorsEmptyView(tab, true, ALL)).toEqual({
        title: 'cp.empty.first',
        text: true,
        actions: ['add', 'import'],
        addLabel: 'cp.empty.add',
      });
    }
    expect(contractorsEmptyView('all', true, { createCp: false, cpImport: true }).actions).toEqual([
      'import',
    ]);
    expect(contractorsEmptyView('all', true, { createCp: true, cpImport: false }).actions).toEqual([
      'add',
    ]);
    expect(contractorsEmptyView('debtors', true, NONE).actions).toEqual([]);
  });

  it('пустая вкладка при других контрагентах: «Добавить» только на «Все»', () => {
    expect(contractorsEmptyView('all', false, ALL)).toEqual({
      title: 'cp.empty.all',
      text: false,
      actions: ['add'],
      addLabel: 'btn.add',
    });
    expect(contractorsEmptyView('all', false, { createCp: false, cpImport: true }).actions).toEqual(
      [],
    );
  });

  it('«Должники» и «Мои контрагенты» без кнопок, у «Моих» — свой заголовок', () => {
    expect(contractorsEmptyView('debtors', false, ALL)).toEqual({
      title: 'cp.empty.all',
      text: false,
      actions: [],
      addLabel: 'btn.add',
    });
    expect(contractorsEmptyView('mine', false, ALL)).toEqual({
      title: 'cp.empty.mine',
      text: false,
      actions: [],
      addLabel: 'btn.add',
    });
  });
});
