// Пустой список контрагентов: какой текст и какие кнопки (прототип ui/empty.js `firstEmpty` и
// modules/contractors.js `empty`).

export interface ContractorsEmptyView {
  title: 'cp.empty.first' | 'cp.empty.mine' | 'cp.empty.all';
  /** Пояснение «Добавьте контрагентов по одному…» — только у первого входа (прототип v139). */
  text: boolean;
  /** Кнопки по порядку. */
  actions: ('add' | 'import')[];
  /** «Добавить контрагента» у первого входа, «Добавить» у пустой вкладки (прототип grid.js `emptyadd`). */
  addLabel: 'cp.empty.add' | 'btn.add';
}

/**
 * Контрагентов нет совсем — пустое состояние первого входа на любой вкладке: «Добавить контрагента» и
 * «Загрузить из Excel» по правам. Контрагенты есть, а вкладка пуста — одна кнопка «Добавить» и только
 * на «Все»: на «Должниках» и «Моих контрагентах» новый контрагент не появится.
 */
export function contractorsEmptyView(
  tab: 'all' | 'mine' | 'debtors',
  first: boolean,
  can: { createCp: boolean; cpImport: boolean },
): ContractorsEmptyView {
  if (first) {
    return {
      title: 'cp.empty.first',
      text: true,
      actions: [
        ...(can.createCp ? ['add' as const] : []),
        ...(can.cpImport ? ['import' as const] : []),
      ],
      addLabel: 'cp.empty.add',
    };
  }
  return {
    title: tab === 'mine' ? 'cp.empty.mine' : 'cp.empty.all',
    text: false,
    actions: tab === 'all' && can.createCp ? ['add'] : [],
    addLabel: 'btn.add',
  };
}
