import { outboxRetryRefusal, type OutboxStatus } from '@buhuchet/domain';
import type { AdminTelegramLogRow } from '@buhuchet/shared';
import type { ActionEntry } from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';

const REFUSAL_TEXT = {
  outbox_not_error: 'tgadm.retry.not_error',
  outbox_code: 'tgadm.retry.code',
  outbox_relink_code: 'tgadm.retry.relink_code',
  outbox_setup_link: 'tgadm.retry.setup_link',
  outbox_bot_cmd: 'tgadm.retry.bot_cmd',
} as const;

type RetryRow = Pick<AdminTelegramLogRow, 'src' | 'status' | 'kind'>;

/**
 * Почему строку нельзя повторить (прототип `tgNoRetry`); пусто — можно. Полученное не повторяется;
 * сообщение клиенту контрагента с ошибкой отправляют заново из карточки контрагента.
 */
export function retryRefusal(t: Translate, row: RetryRow): string {
  if (row.src === 'inbox') return t('tgadm.retry.in');
  if (row.status !== 'error') return t('tgadm.retry.not_error');
  if (row.src === 'client') return t('tgadm.retry.client');
  const refusal = outboxRetryRefusal({ status: row.status as OutboxStatus, kind: row.kind });
  return refusal ? t(REFUSAL_TEXT[refusal]) : '';
}

/**
 * Меню строки журнала (прототип admin/tg-log.js, actions): «Открыть сообщение», «Вся переписка» и
 * «Повторить отправку» — только у «Ошибки» отправленного сотруднику и не у кода; иначе пункт виден, но
 * недоступен с причиной.
 */
export function logMenu({
  t,
  open,
  chat,
  retry,
}: {
  t: Translate;
  open: (row: AdminTelegramLogRow) => void;
  chat: (row: AdminTelegramLogRow) => void;
  retry: (row: AdminTelegramLogRow) => void;
}): (row: AdminTelegramLogRow) => ActionEntry[] {
  return (row) => {
    const reason = retryRefusal(t, row);
    return [
      { id: 'open', label: t('tgadm.menu.open'), icon: 'eye', run: () => open(row) },
      { id: 'chat', label: t('tgadm.menu.chat'), icon: 'chat', run: () => chat(row) },
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
