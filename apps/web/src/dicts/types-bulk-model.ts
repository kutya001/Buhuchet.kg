import { normalizeRemindDays } from '@buhuchet/domain';
import type { OrgReportTypeRow, OrgReportTypesBulk } from '@buhuchet/shared';

/*
 * Массовые изменения видов отчётов (прототип v84 modules/dicts.js: typesBulkOn, typesBulkDlg): что
 * спросить и что отправить по отмеченным строкам списка. Сами изменения решает сервер по тем же
 * правилам домена — здесь только то, что видно в окне до отправки.
 */

/** Выбор «Не менять / Обязательно / Не обязательно». */
export type BulkTri = '' | '1' | '0';

/** Окно «Настроить виды отчётов». `days: null` — «Не менять», набор — «Задать заново». */
export interface BulkDraft {
  file: BulkTri;
  receipt: BulkTri;
  days: readonly number[] | null;
  connect: boolean;
}

export const EMPTY_BULK_DRAFT: BulkDraft = { file: '', receipt: '', days: null, connect: true };

type Row = Pick<OrgReportTypeRow, 'code' | 'shortName' | 'enabled' | 'assigned' | 'act'>;

/** Сколько видов показать в подзаголовке окна по именам; остальные — «и ещё N». */
export const BULK_NAMES_SHOWN = 6;

/** Отмеченные виды для подзаголовка окна: первые шесть кратких названий и сколько ещё. */
export function bulkNames(rows: readonly Row[]): { names: string; more: number } {
  return {
    names: rows
      .slice(0, BULK_NAMES_SHOWN)
      .map((r) => r.shortName)
      .join(', '),
    more: Math.max(0, rows.length - BULK_NAMES_SHOWN),
  };
}

/** «Отключить»: подключённые среди отмеченных — назначенные действующим контрагентам и остальные. */
export function disconnectPlan<R extends Row>(rows: readonly R[]): { on: R[]; busy: R[]; ok: R[] } {
  const on = rows.filter((r) => r.enabled);
  return {
    on,
    busy: on.filter((r) => r.assigned > 0),
    ok: on.filter((r) => r.assigned === 0),
  };
}

/** Числа для окна «Настроить»: неподключённых и видов «только оплата» среди отмеченных. */
export function setupCounts(rows: readonly Row[]): { off: number; pay: number } {
  return {
    off: rows.filter((r) => !r.enabled).length,
    pay: rows.filter((r) => r.act === 'pay').length,
  };
}

const tri = (v: BulkTri): boolean | undefined => (v === '' ? undefined : v === '1');

/**
 * Запрос «Применить»; null — «Ничего не выбрано для изменения» (всё «Не менять», а подключать нечего
 * или галочка «Подключить неподключённые» снята).
 */
export function setupBody(rows: readonly Row[], draft: BulkDraft): OrgReportTypesBulk | null {
  const connect = setupCounts(rows).off > 0 && draft.connect;
  if (draft.file === '' && draft.receipt === '' && !draft.days && !connect) return null;
  const needFile = tri(draft.file);
  const needReceipt = tri(draft.receipt);
  return {
    action: 'setup',
    codes: rows.map((r) => r.code),
    ...(needFile === undefined ? {} : { needFile }),
    ...(needReceipt === undefined ? {} : { needReceipt }),
    ...(draft.days ? { remindDays: normalizeRemindDays(draft.days) } : {}),
    connect,
  };
}
