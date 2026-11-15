'use client';

import { buttonClass, Icon } from '@buhuchet/ui';
import { api, callApi } from '../api-client';
import { useT } from '../l10n/provider';
import type { ApiErrorLike, Translate } from '../l10n/translate';

/*
 * Принятый чек — сразу в окне денег (просьба заказчика 15.11.2026, прототип v119 `rcptFileRow`): «Принять»
 * у чека из Telegram или со страницы контрагента открывает «Поступление от контрагента» или «Принять оплату
 * за обслуживание», и чек уже стоит в поле файлов. После сохранения записи денег окно прикрепляет к ней
 * копию принятого файла (`POST /api/files/sent/{id}/attach`) — второй раз его не скачивают и не загружают.
 */

/** Принятый чек: отправленный файл контрагента и его имя. */
export type SentReceipt = { sentId: string; name: string };

/** Строка чека над выбором файлов: имя, пояснение и «Убрать» (тогда чек к деньгам не прикрепляется). */
export function SentReceiptRow({
  receipt,
  onRemove,
}: {
  receipt: SentReceipt;
  onRemove: () => void;
}) {
  const t = useT();
  return (
    <div data-sent-receipt="" className="mb-1.5 flex flex-wrap items-center gap-1.5">
      <Icon name="clip" size="sm" />
      <b className="text-ink">{receipt.name}</b>
      <span className="text-faint">{t('cppage.rcpt.file_hint')}</span>
      <span className="grow" />
      <button
        type="button"
        data-sent-receipt-remove=""
        title={t('cppage.rcpt.file_remove_title')}
        className={buttonClass('ghost', 'sm')}
        onClick={onRemove}
      >
        <Icon name="x" size="sm" />
        {t('cppage.rcpt.file_remove')}
      </button>
    </div>
  );
}

/**
 * Прикрепить принятый чек к сохранённой записи денег. Не вышло — текст для уведомления («Записано, но
 * файл … не загружен»), как у файлов, выбранных в окне; вышло — null.
 */
export async function attachSentReceipt(
  t: Translate,
  errorText: (e: ApiErrorLike) => string,
  receipt: SentReceipt,
  source: { kind: 'receipt' | 'fee_payment'; id: string },
): Promise<string | null> {
  const res = await callApi(() =>
    api.api.files.sent[':id'].attach.$post({
      param: { id: receipt.sentId },
      json: { source },
    }),
  );
  return res.ok
    ? null
    : t('money.files_saved_partly', { name: receipt.name, error: errorText(res.error) });
}
