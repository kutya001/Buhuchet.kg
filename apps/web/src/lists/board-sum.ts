import { formatSom } from '@buhuchet/domain';

/**
 * Сумма в шапке столбца «Доски» — целыми сомами, как в прототипе (ui/grid.js: `fmtM(…, false)`);
 * задаётся доске списка настройкой `GridKanban.sum`.
 */
export const boardSumText = (tyiyn: number) => formatSom(Math.round(tyiyn / 100) * 100, 'auto');
