import { outboxRetryRefusal } from '@buhuchet/domain';
import type { AdminTelegramLogRow } from '@buhuchet/shared';
import type { ActionEntry } from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';

const REFUSAL_TEXT = {
  outbox_not_error: 'tgadm.retry.not_error',
  outbox_code: 'tgadm.retry.code',
  outbox_relink_code: 'tgadm.retry.relink_code',
} as const;

/** Почему строку нельзя повторить (прототип `tgNoRetry`); пусто — можно. */
export function retryRefusal(t: Translate, row: AdminTelegramLogRow): string {
  const refusal = outboxRetryRefusal(row);
  return refusal ? t(REFUSAL_TEXT[refusal]) : '';
}

/**
 * Меню строки журнала (прототип admin/telegram.js, actions): «Повторить отправку» — только у «Ошибки»
 * и не у кода восстановления или кода замены Telegram; иначе пункт виден, но недоступен с причиной.
 */
export function logMenu({
  t,
  retry,
}: {
  t: Translate;
  retry: (row: AdminTelegramLogRow) => void;
}): (row: AdminTelegramLogRow) => ActionEntry[] {
  return (row) => {
    const reason = retryRefusal(t, row);
    return [
      {
        id: 'retry',
        label: t('tgadm.retry'),
        icon: 'refresh',
        disabled: !!reason,
        reason: reason || undefined,
        run: () => retry(row),
      },
    ];
  };
}

/**
 * Уведомление «Повторить ошибки» (прототип: «Поставлено в очередь: N» и «; коды восстановления
 * повторно не отправляются (K)», если среди отмеченных были коды с ошибкой).
 */
export function bulkRetryToast(t: Translate, result: { queued: number; codes: number }): string {
  return (
    t('tgadm.retry.bulk_done', { n: result.queued }) +
    (result.codes ? t('tgadm.retry.bulk_codes', { n: result.codes }) : '')
  );
}
