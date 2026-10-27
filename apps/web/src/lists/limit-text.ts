import type { ApiErrorLike, Translate } from '../l10n/translate';

// ОТКЛОНЕНИЕ: docs/deviations.md#42 — в прототипе сервера нет: ошибка списка всегда «Проверьте
// подключение…», у «В Excel» отказов нет.
/**
 * Причина отказа сервера для списка, значений его фильтров и «В Excel» — только пределы «Защиты
 * тяжёлых запросов» (docs/decisions.md, п. 38): запрос дольше предела — «Сузьте список…», идёт прежняя
 * выгрузка или их за час уже 20 — тексты `err.export_*`. Другая ошибка — null: экран пишет свой текст
 * про подключение, как прототип.
 */
export function limitFailureText(
  failure: ApiErrorLike | null,
  t: Translate,
  errorText: (error: ApiErrorLike) => string,
): string | null {
  if (failure?.code === 'query_timeout') return t('grid.query_timeout');
  if (failure?.code === 'export_busy' || failure?.code === 'export_limit') {
    return errorText(failure);
  }
  return null;
}
