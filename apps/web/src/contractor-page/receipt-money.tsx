'use client';

import { bishkekDate, currentPlanMonth } from '@buhuchet/domain';
import type { SentFilePay } from '@buhuchet/shared';
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
 * Что сделал `take`: `opened` — окно денег открыто (чек «Новый», пока деньги не сохранены);
 * `received` — деньги месяца уже получены (`text` — почему окна нет); `none` — принять эти деньги
 * сотрудник не может; `failed` — форма окна не загрузилась.
 */
export type ReceiptMoneyTake =
  { kind: 'opened' } | { kind: 'received'; text: string } | { kind: 'none' } | { kind: 'failed' };

/**
 * «Принять» у чека из Telegram или со страницы контрагента (доработки 14.11.2026, блок 4, пункт 4, и
 * блок 6; прототип v115–v116 `pgRcptMoney`): «Принять деньги» с суммой из оплаченного сообщения (налоги
 * месяца, без месяца — все месяцы с остатком) или «Принять оплату за обслуживание». Что оплачено, сервер
 * отдаёт только тому, кто может принять эти деньги (`pay` строки). Чек (`receipt`) стоит в поле файлов
 * окна, а принимается только при «Сохранить» — вместе с деньгами (доработки 16.11.2026, блок 1; прототип
 * v121): «Отменить», крестик и Esc ничего не меняют. `take` — по «Принять», `dialogs` — в разметку,
 * `onSaved` — после сохранения денег (перечитать «Отправленные файлы»).
 */
export function useReceiptMoney(onSaved?: () => void): {
  take: (contractorId: string, pay: SentFilePay, receipt: SentReceipt) => Promise<ReceiptMoneyTake>;
  dialogs: ReactNode;
} {
  const t = useT();
  const client = useQueryClient();
  const { access } = useShell();
  const moneyRefresh = useMoneyRefresh();
  const feesRefresh = useFeesRefresh();
  const [tax, setTax] = useState<DialogSlot<TaxSlot> | null>(null);
  const [fee, setFee] = useState<DialogSlot<FeeSlot> | null>(null);
  const filesOn = access.feature('files');

  const take = useCallback(
    async (
      contractorId: string,
      pay: SentFilePay,
      receipt: SentReceipt,
    ): Promise<ReceiptMoneyTake> => {
      // Окно с полями открывается, когда его форма загружена (apps/web/CLAUDE.md, № 28): иначе оно
      // рисуется дважды. Не загрузилось — чек остаётся «Новый», «Принять» можно нажать ещё раз.
      if (pay.purpose === 'fee') {
        if (!access.feature('fee') || !access.can('fee') || !access.can('tariff')) {
          return { kind: 'none' };
        }
        try {
          await client.fetchQuery({ ...feePaymentFormQuery(contractorId), staleTime: 0 });
        } catch {
          return { kind: 'failed' };
        }
        setFee(
          openSlot<FeeSlot>({
            contractorId,
            preset: { amount: pay.amount, note: feeReceiptNote(t, pay), receipt },
          }),
        );
        return { kind: 'opened' };
      }
      if (!access.feature('taxpay') || !access.can('money')) return { kind: 'none' };
      let rows;
      try {
        [rows] = await Promise.all([
          client.fetchQuery({ ...contractorMonthReportsQuery(contractorId), staleTime: 0 }),
          client.fetchQuery({ ...receiptFormQuery(contractorId), staleTime: 0 }),
        ]);
      } catch {
        return { kind: 'failed' };
      }
      const lastMonth = currentPlanMonth(bishkekDate(new Date()));
      const preset = taxReceiptPreset(t, rows, pay, lastMonth);
      // Деньги месяца уже получены — окна нет, чек принимается сразу (прототип `pgRcptPlan` → `got`).
      if (!preset) return { kind: 'received', text: taxReceivedText(t, pay.month) };
      // Чек — только у списка месяцев (пресет чека всегда такой).
      setTax(
        openSlot<TaxSlot>({
          contractorId,
          preset: 'list' in preset ? { ...preset, receipt } : preset,
        }),
      );
      return { kind: 'opened' };
    },
    [access, client, t],
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
          onDone={() => {
            moneyRefresh();
            onSaved?.();
          }}
        />
      ) : null}
      {fee ? (
        <FeePaymentDialog
          key={`receipt-fee-${fee.n}`}
          contractorId={fee.data.contractorId}
          preset={fee.data.preset}
          open={fee.open}
          onClose={() => setFee(closeSlot)}
          onDone={() => {
            feesRefresh();
            onSaved?.();
          }}
        />
      ) : null}
    </>
  );

  return { take, dialogs };
}
