import { allocateInOrder, formatSom, parseSom } from '@buhuchet/domain';

/*
 * Что окно «Поступление от контрагента» распределяет сразу (прототип `inDlg`, `pre`): «Принять деньги»
 * у отчёта или — за месяц и за весь период во вкладке «Отчёты к сдаче» (прототип v110, доработки
 * 14.11.2026, блок 5) — список отчётов от старых месяцев к новым. Чистые правила окна — здесь.
 */

/**
 * Под какой отчёт сразу распределить (из карточки отчёта и «Принять» в списке) или — «Принять деньги» за
 * месяц и за весь период во вкладке «Отчёты к сдаче» (прототип v110 `inDlg` с `pre.list`) — по каким
 * отчётам от старых месяцев к новым; `note` — «Деньги за октябрь 2026».
 */
export type ReceiptPreset =
  | { reportId: string; amount: number }
  | { list: readonly { reportId: string; amount: number }[]; note: string };

/**
 * Строки распределения «за месяц» и «за весь период», которые форма может принять: отчёт ещё ждёт денег
 * (есть в строках формы), сумма — не больше его остатка в форме (данные могли измениться с открытия
 * вкладки). Порядок — как пришёл (от старых месяцев к новым).
 */
export function presetLines(
  preset: ReceiptPreset | null,
  rows: readonly { reportId: string; left: number }[],
): { reportId: string; amount: number }[] {
  if (!preset || !('list' in preset)) return [];
  const left = new Map(rows.map((r) => [r.reportId, r.left]));
  return preset.list
    .map((x) => ({ reportId: x.reportId, amount: Math.min(x.amount, left.get(x.reportId) ?? 0) }))
    .filter((x) => x.amount > 0);
}

/**
 * Детализация после правки общей суммы «за месяц» и «за весь период» (прототип v110 `inDlg`, `reAlloc`):
 * строки списка заново от старых месяцев к новым, каждой — не больше её суммы, что не хватило — пусто;
 * остальные строки детализации не трогаются.
 */
export function reallocate(
  alloc: Readonly<Record<string, string>>,
  lines: readonly { reportId: string; amount: number }[],
  total: string,
): Record<string, string> {
  const next = { ...alloc };
  for (const x of lines) delete next[x.reportId];
  for (const x of allocateInOrder(lines, parseSom(total)))
    next[x.line.reportId] = formatSom(x.amount, 'auto');
  return next;
}
