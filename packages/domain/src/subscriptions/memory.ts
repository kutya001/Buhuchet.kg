import { subscriptionGbText } from './notify';

/*
 * Память заполнена — новые файлы не загружаются (доработки 20.11.2026, блок 2, пункт 5; прототип v155
 * `subMemFullDlg`): пока организация не купит память или не удалит лишнее. Просмотр и скачивание
 * остаются. Предела нет у демо-организации и у организации без подписки (`bytesLimit` пусто — как
 * `isFinite(m.limit)` прототипа); администратор платформы в организацию файлы не загружает.
 */

/** Занятая память и предел организации, байт (`orgUsage` из `@buhuchet/db`). */
export interface MemoryUsage {
  bytesUsed: number | null;
  bytesLimit: number | null;
}

/** Заполнена ли память: занято не меньше предела (прототип `m.used < m.limit` — ещё можно). */
export function memoryFull(u: MemoryUsage | null): boolean {
  if (!u || u.bytesLimit === null || u.bytesUsed === null) return false;
  return u.bytesUsed >= u.bytesLimit;
}

/** Отказ сотруднику (сайт, бот): тексты прототипа `subMemFullDlg`, `{used}` и `{limit}` — ГБ. */
export const MEMORY_FULL_MESSAGE =
  'Память организации заполнена: занято {used} из {limit} ГБ. Купите память или удалите лишние файлы.';

/** Что видит контрагент на странице по ссылке и в Telegram (блок 2, пункт 5). */
export const MEMORY_FULL_CONTRACTOR_MESSAGE =
  'Сейчас файл отправить нельзя. Сообщите вашему бухгалтеру';

/** Подстановки отказа: ГБ словами и байты — для окна «Память организации заполнена». */
export function memoryFullParams(u: { bytesUsed: number; bytesLimit: number }): {
  used: string;
  limit: string;
  usedBytes: number;
  limitBytes: number;
} {
  return {
    used: subscriptionGbText(u.bytesUsed),
    limit: subscriptionGbText(u.bytesLimit),
    usedBytes: u.bytesUsed,
    limitBytes: u.bytesLimit,
  };
}

/** Текст отказа сотруднику с подстановками. */
export function memoryFullText(u: { bytesUsed: number; bytesLimit: number }): string {
  const p = memoryFullParams(u);
  return MEMORY_FULL_MESSAGE.replace('{used}', p.used).replace('{limit}', p.limit);
}
