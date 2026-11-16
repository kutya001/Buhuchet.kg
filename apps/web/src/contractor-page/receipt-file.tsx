'use client';

import { SentFileDecided } from '@buhuchet/shared';
import { buttonClass, Icon } from '@buhuchet/ui';
import { useT } from '../l10n/provider';
import type { ApiErrorLike, Translate } from '../l10n/translate';
import { acceptSent } from '../files/sent-data';

/*
 * Чек из «Отправленных файлов» в окне денег (просьба заказчика 15.11.2026, прототип v119 `rcptFileRow`;
 * доработки 16.11.2026, блок 1, прототип v121 `pgRcptSave`): «Принять» у чека из Telegram или со
 * страницы контрагента открывает «Поступление от контрагента» или «Принять оплату за обслуживание», чек
 * уже стоит в поле файлов, но остаётся «Новый». «Сохранить» записывает деньги, а затем принимает чек и
 * прикрепляет его к ним одной транзакцией сервера (`POST /api/files/sent/{id}/accept` с `attach`) —
 * второй раз его не скачивают и не загружают. «Убрать» — при сохранении чек принимается только в файлы
 * контрагента; «Отменить», крестик и Esc ничего не меняют.
 */

/** Чек в окне денег: отправленный файл контрагента, его имя и версия, которую видел сотрудник. */
export type SentReceipt = { sentId: string; name: string; version: number };

/**
 * Строка чека над выбором файлов: имя, пояснение и «Убрать»; после «Убрать» — «не прикрепится: будет
 * принят только в файлы контрагента» и «Вернуть».
 */
export function SentReceiptRow({
  receipt,
  on,
  onRemove,
  onBack,
}: {
  receipt: SentReceipt;
  on: boolean;
  onRemove: () => void;
  onBack: () => void;
}) {
  const t = useT();
  if (!on)
    return (
      <div data-sent-receipt-off="" className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <span className="text-faint">{t('cppage.rcpt.file_off', { name: receipt.name })}</span>
        <span className="grow" />
        <button
          type="button"
          data-sent-receipt-back=""
          className={buttonClass('ghost', 'sm')}
          onClick={onBack}
        >
          <Icon name="refresh" size="sm" />
          {t('cppage.rcpt.file_back')}
        </button>
      </div>
    );
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

/** Что сказать после «Сохранить»: ошибка (`bad`) или чек уже решил другой сотрудник (`warn`). */
export type ReceiptTaken = { bad: string } | { warn: string } | null;

/**
 * Принять чек после сохранения записи денег: `attach` — прикрепить его к ней (иначе — «Убрать»: только в
 * файлы контрагента). Чек тем временем принял или отклонил другой сотрудник — «Чек уже принял <имя> —
 * поступление сохранено без него»; другая ошибка — «Записано, но файл … не загружен».
 */
export async function takeSentReceipt(
  t: Translate,
  errorText: (e: ApiErrorLike) => string,
  receipt: SentReceipt,
  o: { kind: 'receipt' | 'fee'; attach: { kind: 'receipt' | 'fee_payment'; id: string } | null },
): Promise<ReceiptTaken> {
  const res = await acceptSent(
    { id: receipt.sentId, version: receipt.version },
    o.attach ?? undefined,
  );
  if (res.ok) return null;
  const decided =
    res.error.code === 'sent_decided' ? SentFileDecided.safeParse(res.error.details) : null;
  if (decided?.success)
    return {
      warn: t(
        `cppage.rcpt.${decided.data.status === 'accepted' ? 'taken' : 'rejected'}.${o.kind}`,
        {
          who: decided.data.by ?? '—',
        },
      ),
    };
  return {
    bad: t('money.files_saved_partly', { name: receipt.name, error: errorText(res.error) }),
  };
}
