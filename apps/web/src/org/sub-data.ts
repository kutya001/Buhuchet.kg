'use client';

import {
  subscriptionReceiptProblem,
  subscriptionReceiptSniff,
  type SubscriptionMessageCode,
} from '@buhuchet/domain';
import {
  FileLink,
  OrgSubscriptionView,
  SubscriptionPayDone,
  SubscriptionUploadTicket,
  type SubscriptionPayChoice,
} from '@buhuchet/shared';
import { queryOptions } from '@tanstack/react-query';
import { api, apiFailure, callApi } from '../api-client';
import { putToStorage } from '../files/files-data';
import type { ApiErrorLike } from '../l10n/translate';

/*
 * Данные экрана «Подписка» (доработки 20.11.2026, блок 5; этап 1, П7, поток И): экран целиком одним
 * запросом, заявка с чеком (начать → `PUT` чека в хранилище → закончить), «Заменить файл чека», ссылка
 * на чек. Сумму заявки считает сервер, из окна уходит только выбор.
 */

export const SUB_QUERY_KEY = ['org', 'subscription'] as const;

/** Экран «Подписка» владельца (`GET /api/org/subscription`). */
export const orgSubQuery = queryOptions({
  queryKey: SUB_QUERY_KEY,
  queryFn: async () => {
    const res = await api.api.org.subscription.$get();
    if (!res.ok) throw await apiFailure(res);
    return OrgSubscriptionView.parse(await res.json());
  },
});

/**
 * Что мешает начать загрузку чека (прототип `subFileErr`): имя, пустой, больше 20 МБ, не PDF и не
 * JPG/PNG по первым байтам. Сервер проверяет то же по загруженному файлу.
 */
export async function receiptFileProblem(file: File): Promise<SubscriptionMessageCode | null> {
  const problem = subscriptionReceiptProblem({ name: file.name, size: file.size });
  if (problem) return problem;
  try {
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    if (subscriptionReceiptSniff(head)) return null;
  } catch {
    // Файл не читается (удалён с диска после выбора) — как чужой тип.
  }
  return 'sub_receipt_type';
}

type Done<T> = { ok: true; data: T } | { ok: false; status: number; error: ApiErrorLike };

const fileOf = (file: File) => ({ name: file.name, size: file.size });

/** «Отправить на проверку» (прототип `subPaySend`): заявка «Ждёт подтверждения» с чеком. */
export async function sendSubPay(
  pay: SubscriptionPayChoice,
  file: File,
): Promise<Done<SubscriptionPayDone>> {
  const started = await callApi(() =>
    api.api.org.subscription.payments.start.$post({ json: { pay, file: fileOf(file) } }),
  );
  if (!started.ok) return started;
  const ticket = SubscriptionUploadTicket.parse(started.data);
  const failed = await putToStorage(ticket, file);
  if (failed) return { ok: false, status: 0, error: failed };
  const done = await callApi(() =>
    api.api.org.subscription.payments.complete.$post({
      json: { id: ticket.id, pay, file: fileOf(file) },
    }),
  );
  if (!done.ok) return done;
  return { ok: true, data: SubscriptionPayDone.parse(done.data) };
}

/** «Заменить файл чека» (прототип `subFileDlg`, `subPayFile`): только у чека на проверке, с версией. */
export async function replaceSubReceipt(
  pay: { id: string; version: number },
  file: File,
): Promise<Done<null>> {
  const started = await callApi(() =>
    api.api.org.subscription.payments[':id'].receipt.$post({
      param: { id: pay.id },
      json: { file: fileOf(file), version: pay.version },
    }),
  );
  if (!started.ok) return started;
  const ticket = SubscriptionUploadTicket.parse(started.data);
  const failed = await putToStorage(ticket, file);
  if (failed) return { ok: false, status: 0, error: failed };
  const done = await callApi(() =>
    api.api.org.subscription.payments[':id'].receipt.complete.$post({
      param: { id: pay.id },
      json: { uploadId: ticket.id, file: fileOf(file), version: pay.version },
    }),
  );
  if (!done.ok) return done;
  return { ok: true, data: null };
}

/** Байты чека для окна просмотра: подписанная ссылка-вложение (окно проверит тип по содержимому). */
export async function subReceiptViewSrc(id: string): Promise<string> {
  const res = await api.api.org.subscription.payments[':id'].receipt.link.$get({
    param: { id },
    query: { download: '1' },
  });
  if (!res.ok) throw await apiFailure(res);
  return FileLink.parse(await res.json()).url;
}

/** «Скачать» чека: метод сам переходит на подписанную ссылку. */
export const subReceiptDownloadHref = (id: string) =>
  `/api/org/subscription/payments/${encodeURIComponent(id)}/receipt/download`;
