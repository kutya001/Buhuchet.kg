import { pluralForm } from '@buhuchet/domain';
import {
  FileLink,
  SentFileAccepted,
  SentFileCount,
  SentFileItem,
  SentFileList,
  SentUploadState,
} from '@buhuchet/shared';
import { queryOptions, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api, apiFailure, callApi } from '../api-client';
import type { ApiErrorLike, Translate } from '../l10n/translate';

/*
 * Файлы от контрагентов (доработки 14.11.2026, блок 2; прототип v112 `modules/cp-sent.js`): данные
 * вкладки «Файлы от контрагентов», раздела «Отправленные файлы» карточки и строки «Файлы от
 * контрагента» блока «Страница контрагента»; «Принять» и «Отклонить».
 */

export const SENT_GRID_KEY = 'files.sent';

/** Новых файлов у «Файлового менеджера» в меню и на вкладке; null — вкладки нет. */
export const sentCountQuery = queryOptions({
  queryKey: ['files', 'sent', 'count'],
  queryFn: async () => {
    const res = await api.api.files.sent.count.$get();
    if (!res.ok) throw await apiFailure(res);
    return SentFileCount.parse(await res.json()).count;
  },
});

/** «Отправленные файлы» контрагента: от новых к старым и сколько новых. */
export const contractorSentQuery = (contractorId: string) =>
  queryOptions({
    queryKey: ['files', 'sent', 'contractor', contractorId],
    queryFn: async () => {
      const res = await api.api.contractors[':id']['sent-files'].$get({
        param: { id: contractorId },
      });
      if (!res.ok) throw await apiFailure(res);
      return SentFileList.parse(await res.json());
    },
  });

/**
 * Строка «Файлы от контрагента» блока «Страница контрагента». `pageVersion` — версия страницы из блока:
 * галочка и разделы страницы меняют одну запись, после правки в блоке строка перечитывается.
 */
export const sentUploadQuery = (contractorId: string, pageVersion: number | null) =>
  queryOptions({
    queryKey: ['files', 'sent', 'upload', contractorId, pageVersion],
    queryFn: async () => {
      const res = await api.api.contractors[':id'].page['sent-upload'].$get({
        param: { id: contractorId },
      });
      if (!res.ok) throw await apiFailure(res);
      return SentUploadState.parse(await res.json());
    },
  });

/**
 * Окно просмотра (доработки 16.11.2026, блок 5): байты отправленного файла — по подписанной ссылке на
 * 15 минут вложением (`download=1`): окно разбирает любой файл само, браузер его не открывает.
 */
export async function sentViewSrc(id: string): Promise<string> {
  const res = await api.api.files.sent[':id'].link.$get({
    param: { id },
    query: { download: '1' },
  });
  if (!res.ok) throw await apiFailure(res);
  return FileLink.parse(await res.json()).url;
}

/** «Скачать» окна просмотра: метод сам переходит на подписанную ссылку-вложение. */
export const sentDownloadHref = (id: string) =>
  `/api/files/sent/${encodeURIComponent(id)}/download`;

/**
 * После «Принять», «Отклонить» и отправки: вкладка, раздел карточки, счётчик новых, файлы контрагента
 * (принятый — среди них) и история карточки.
 */
export function useSentRefresh() {
  const client = useQueryClient();
  return useCallback(
    () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ['files'] }),
        client.invalidateQueries({ queryKey: ['list', SENT_GRID_KEY] }),
        client.invalidateQueries({ queryKey: ['list', 'files.list'] }),
        client.invalidateQueries({ queryKey: ['contractors', 'history'] }),
      ]),
    [client],
  );
}

type Saved = { ok: true; item: SentFileItem } | { ok: false; status: number; error: ApiErrorLike };

/**
 * «Принять» (прототип `sntAccept`): файл становится файлом контрагента с источником «От контрагента».
 * `attach` — «Сохранить» в окне денег с чеком (доработки 16.11.2026, блок 1; прототип v121
 * `pgRcptSave`): чек принимается и прикрепляется к только что записанным деньгам одной транзакцией.
 */
export async function acceptSent(
  file: { id: string; version: number },
  attach?: { kind: 'receipt' | 'fee_payment'; id: string },
): Promise<{ ok: true; item: SentFileAccepted } | Exclude<Saved, { ok: true }>> {
  const res = await callApi(() =>
    api.api.files.sent[':id'].accept.$post({
      param: { id: file.id },
      json: { version: file.version, ...(attach ? { attach } : {}) },
    }),
  );
  return res.ok ? { ok: true, item: SentFileAccepted.parse(res.data) } : res;
}

/** «Отклонить» с причиной (прототип `sntRejectDlg`): контрагент увидит её на своей странице. */
export async function rejectSent(
  file: { id: string; version: number },
  reason: string,
): Promise<Saved> {
  const res = await callApi(() =>
    api.api.files.sent[':id'].reject.$post({
      param: { id: file.id },
      json: { version: file.version, reason },
    }),
  );
  return res.ok ? { ok: true, item: SentFileItem.parse(res.data) } : res;
}

/** «Удалится через 5 дней» / «Удалится сегодня» (прототип `sntLeftTxt`); у принятого — пусто. */
export function sentLeftText(t: Translate, daysLeft: number | null): string {
  if (daysLeft === null) return '';
  return daysLeft
    ? t(`files.sent.left.${pluralForm(daysLeft)}`, { n: daysLeft })
    : t('files.sent.left.today');
}

/** «через 5 дней» / «сегодня» — столбец «Удалится» раздела карточки (прототип: `.replace('Удалится ','')`). */
export function sentInText(t: Translate, daysLeft: number): string {
  return daysLeft
    ? t(`files.sent.in.${pluralForm(daysLeft)}`, { n: daysLeft })
    : t('files.sent.in.today');
}

/** «Откуда»: «Страница» или «Telegram» (прототип `sntSrc`). */
export const sentSourceText = (t: Translate, source: SentFileItem['source']) =>
  t(source === 'page' ? 'files.sent.src.page' : 'files.sent.src.telegram');

/** «Кто отправил»: со страницы — «Контрагент», из Telegram — имя в Telegram (прототип `sntWho`). */
export const sentWhoText = (t: Translate, file: Pick<SentFileItem, 'source' | 'senderName'>) =>
  file.source === 'page'
    ? t('files.sent.who.page')
    : (file.senderName ?? t('files.sent.src.telegram'));

const STATUS_KEY = {
  new: 'files.sent.st.new',
  accepted: 'files.sent.st.accepted',
  rejected: 'files.sent.st.rejected',
} as const;

/** Статус словами: «Новый», «Принят», «Отклонён». */
export const sentStatusText = (t: Translate, status: SentFileItem['status']) =>
  t(STATUS_KEY[status]);
