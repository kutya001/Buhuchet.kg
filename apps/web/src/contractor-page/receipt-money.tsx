'use client';

import { bishkekDate, currentPlanMonth } from '@buhuchet/domain';
import type { SentFilePay } from '@buhuchet/shared';
import { useToast } from '@buhuchet/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState, type ReactNode } from 'react';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { FeePaymentDialog, type FeePaymentPreset } from '../fees/fee-dialogs';
import { feePaymentFormQuery, useFeesRefresh } from '../fees/fees-data';
import { useT } from '../l10n/provider';
import { receiptFormQuery, useMoneyRefresh } from '../money/tax-data';
import { ReceiptDialog, type ReceiptPreset } from '../money/tax-dialogs';
import { contractorMonthReportsQuery } from '../reports/reports-data';
import { useShell } from '../shell/context';
import { feeReceiptNote, taxReceiptPreset, taxReceivedText } from './receipt-money-model';
import type { SentReceipt } from './receipt-file';

type TaxSlot = { contractorId: string; preset: ReceiptPreset };
type FeeSlot = { contractorId: string; preset: FeePaymentPreset };

/**
 * «Принять» у чека из Telegram или со страницы контрагента (доработки 14.11.2026, блок 4, пункт 4, и
 * блок 6; прототип v115–v116 `pgRcptMoney`): после «Принять» файла — сразу «Принять деньги» с суммой из
 * оплаченного сообщения (налоги месяца, без месяца — все месяцы с остатком) или «Принять оплату за
 * обслуживание». Что оплачено, сервер отдаёт только тому, кто
 * может принять эти деньги; нет — файл просто принят. `take` — после принятия, `dialogs` — в разметку.
 * Сам чек (`receipt`) уже стоит в поле файлов окна и прикрепляется к деньгам после сохранения (прототип
 * v119, просьба заказчика 15.11.2026).
 */
export function useReceiptMoney(): {
  take: (contractorId: string, pay: SentFilePay, receipt?: SentReceipt) => Promise<void>;
  dialogs: ReactNode;
} {
  const t = useT();
  const toast = useToast();
  const client = useQueryClient();
  const { access } = useShell();
  const moneyRefresh = useMoneyRefresh();
  const feesRefresh = useFeesRefresh();
  const [tax, setTax] = useState<DialogSlot<TaxSlot> | null>(null);
  const [fee, setFee] = useState<DialogSlot<FeeSlot> | null>(null);
  const filesOn = access.feature('files');

  const take = useCallback(
    async (contractorId: string, pay: SentFilePay, receipt?: SentReceipt) => {
      // Окно с полями открывается, когда его форма загружена (apps/web/CLAUDE.md, № 28): иначе оно
      // рисуется дважды. Не загрузилось — файл всё равно принят, деньги можно принять во вкладке.
      if (pay.purpose === 'fee') {
        if (!access.feature('fee') || !access.can('fee') || !access.can('tariff')) return;
        try {
          await client.fetchQuery({ ...feePaymentFormQuery(contractorId), staleTime: 0 });
        } catch {
          return;
        }
        setFee(
          openSlot({
            contractorId,
            preset: {
              amount: pay.amount,
              note: feeReceiptNote(t, pay),
              ...(receipt ? { receipt } : {}),
            },
          }),
        );
        return;
      }
      if (!access.feature('taxpay') || !access.can('money')) return;
      let rows;
      try {
        [rows] = await Promise.all([
          client.fetchQuery({ ...contractorMonthReportsQuery(contractorId), staleTime: 0 }),
          client.fetchQuery({ ...receiptFormQuery(contractorId), staleTime: 0 }),
        ]);
      } catch {
        return;
      }
      const lastMonth = currentPlanMonth(bishkekDate(new Date()));
      const preset = taxReceiptPreset(t, rows, pay, lastMonth);
      // Чек — только у списка месяцев (пресет чека всегда такой).
      if (preset)
        setTax(
          openSlot({
            contractorId,
            preset: receipt && 'list' in preset ? { ...preset, receipt } : preset,
          }),
        );
      else toast(taxReceivedText(t, pay.month), { icon: 'info' });
    },
    [access, client, t, toast],
  );

  const dialogs: ReactNode = (
    <>
      {tax ? (
        <ReceiptDialog
          key={`receipt-money-${tax.n}`}
          contractorId={tax.data.contractorId}
          preset={tax.data.preset}
          filesOn={filesOn}
          canUpload={filesOn && access.can('filesUpload')}
          open={tax.open}
          onClose={() => setTax(closeSlot)}
          onDone={moneyRefresh}
        />
      ) : null}
      {fee ? (
        <FeePaymentDialog
          key={`receipt-fee-${fee.n}`}
          contractorId={fee.data.contractorId}
          preset={fee.data.preset}
          open={fee.open}
          onClose={() => setFee(closeSlot)}
          onDone={feesRefresh}
        />
      ) : null}
    </>
  );

  return { take, dialogs };
}
