'use client';

import type { FileLinkInfo, FileManagerRow } from '@buhuchet/shared';
import { ConfirmDialog, useToast } from '@buhuchet/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import { api, callApi } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { FeePaymentWindowDialog } from '../finance/fee-payment-window';
import { OperationWindowDialog } from '../finance/operation-window';
import { ServiceActionDialog, type ServiceAction } from '../finance/service-card';
import { useErrorText, useT } from '../l10n/provider';
import { openProjectCard } from '../projects/project-card-store';
import {
  ProjectPaymentActionDialog,
  type ProjectPaymentAction,
} from '../projects/project-payments';
import { useReportActions } from '../reports/report-actions';
import { fileDeleteLinksList } from './file-links';
import { useFilesRefresh } from './files-data';
import { recordQueryKey } from './record-files';

/** Окно записи денег: оплата за обслуживание или операция (поступление, оплата налога и др.). */
type MoneyWindow = { fee: boolean; id: string };

/**
 * Запись ссылки в своём окне (доработки 16.11.2026, блок 2; прототип v124 `fLinkRecs` `open`):
 * поступление, оплата налога и операция — окно операции, оплата за обслуживание — её окно, отчёт — его
 * карточка, разовая услуга и проект — карточки, оплата услуги и транш проекта — окно самой оплаты (в нём
 * есть «Карточка услуги» и «Карточка проекта»). Общее для «Файлового менеджера» (меню «Перейти к
 * источнику: …», «Источник» окна файла) и вкладки «Файлы» контрагента; `dialogs` — в разметку экрана.
 */
export function useFileLinkOpen(): { open: (link: FileLinkInfo) => void; dialogs: ReactNode } {
  const reports = useReportActions();
  const [money, setMoney] = useState<DialogSlot<MoneyWindow> | null>(null);
  const [service, setService] = useState<DialogSlot<ServiceAction> | null>(null);
  const [payment, setPayment] = useState<DialogSlot<ProjectPaymentAction> | null>(null);

  const open = (link: FileLinkInfo) => {
    switch (link.kind) {
      case 'report':
        return reports.openCard({ id: link.id });
      case 'fee_payment':
        return setMoney(openSlot<MoneyWindow>({ fee: true, id: link.id }));
      case 'one_off_service':
        return setService(openSlot<ServiceAction>({ act: 'card', id: link.id }));
      case 'one_off_service_payment':
        return setService(openSlot<ServiceAction>({ act: 'payment', id: link.id }));
      case 'project':
        return openProjectCard(link.id);
      case 'project_payment':
        return setPayment(openSlot<ProjectPaymentAction>({ act: 'payment', id: link.id }));
      default:
        return setMoney(openSlot<MoneyWindow>({ fee: false, id: link.id }));
    }
  };

  const dialogs = (
    <>
      {money ? (
        money.data.fee ? (
          <FeePaymentWindowDialog
            key={`money-${money.n}`}
            id={money.data.id}
            open={money.open}
            onClose={() => setMoney(closeSlot)}
            onOpenReport={(id) => reports.openCard({ id })}
          />
        ) : (
          <OperationWindowDialog
            key={`money-${money.n}`}
            id={money.data.id}
            open={money.open}
            onClose={() => setMoney(closeSlot)}
            onOpenReport={(id) => reports.openCard({ id })}
          />
        )
      ) : null}
      {service ? (
        <ServiceActionDialog
          key={`service-${service.n}`}
          action={service.data}
          open={service.open}
          onClose={() => setService(closeSlot)}
        />
      ) : null}
      {payment ? (
        <ProjectPaymentActionDialog
          key={`payment-${payment.n}`}
          action={payment.data}
          open={payment.open}
          onClose={() => setPayment(closeSlot)}
        />
      ) : null}
      {reports.dialogs}
    </>
  );
  return { open, dialogs };
}

/**
 * «Удалить» файла (прототип v124 `fDelDlg`): у файла контрагента, прикреплённого к записям, — «Удалить
 * отовсюду?» со списком записей (которых не видно — числом); иначе — обычный вопрос. Общее для меню
 * «Файлового менеджера», окна файла и вкладки «Файлы» контрагента; `dialog` — в разметку экрана.
 * `onDeleted` — после «Удалить»: окно файла закрывается только после подтверждения (прототип
 * `fDelDlg(f, () => m.close())`). После удаления перечитываются списки файлов, история контрагента и
 * окна записей ссылок — в их истории строка «Удалён файл …» (docs/typical-mistakes.md № 44).
 */
export function useFileDelete(): {
  ask: (file: FileManagerRow, onDeleted?: () => void) => void;
  dialog: ReactNode;
} {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const refresh = useFilesRefresh();
  const client = useQueryClient();
  const [file, setFile] = useState<FileManagerRow | null>(null);
  const after = useRef<(() => void) | undefined>(undefined);

  const remove = async (target: FileManagerRow) => {
    const res = await callApi(() =>
      api.api.files[':id'].$delete({
        param: { id: target.id },
        query: { version: String(target.version) },
      }),
    );
    await refresh();
    if (target.contractor)
      void client.invalidateQueries({ queryKey: ['contractors', 'history', target.contractor.id] });
    for (const link of target.links) {
      const key = recordQueryKey({ kind: link.kind, id: link.id });
      if (key) void client.invalidateQueries({ queryKey: key });
    }
    const everywhere = target.links.length > 0 || target.hiddenLinks > 0;
    if (res.ok) toast(t(everywhere ? 'files.deleted_all' : 'files.deleted'), { icon: 'trash' });
    else toast(errorText(res.error), { bad: true, icon: 'alert' });
  };

  const linked = file !== null && (file.links.length > 0 || file.hiddenLinks > 0);
  const dialog = (
    <ConfirmDialog
      open={file !== null}
      onClose={() => setFile(null)}
      title={t('files.delete.title', { name: file?.name ?? '' })}
      text={
        linked
          ? t('files.delete.linked', {
              list: fileDeleteLinksList(t, file.links, file.hiddenLinks),
            })
          : file?.kind === 'manual'
            ? t('files.delete.manual')
            : t('files.delete.attached', { src: file?.source ?? '' })
      }
      ok={t(linked ? 'files.act.delete_all' : 'files.delete_ok')}
      danger
      onConfirm={() => {
        if (!file) return;
        after.current?.();
        void remove(file);
      }}
    />
  );
  const ask = (target: FileManagerRow, onDeleted?: () => void) => {
    after.current = onDeleted;
    setFile(target);
  };
  return { ask, dialog };
}
