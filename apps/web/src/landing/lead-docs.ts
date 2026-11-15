import {
  LEAD_DOC_MAX_BYTES,
  LEAD_DOC_TEXT_KEYS,
  type LeadDocKind,
  type LeadDocsFound,
  type UiTextKey,
} from '@buhuchet/domain';
import { LeadDocsRead, LeadUploadTicket } from '@buhuchet/shared';
import { api, callApi } from '../api-client';
import type { ApiErrorLike } from '../l10n/translate';

/*
 * Документы формы «Оставить заявку» (доработки 14.11.2026, блок 1; прототип v114 modules/lead-docs.js —
 * ldDocErr, ldDocsBind, ldParse): PDF до 20 МБ проверяется в браузере, кладётся в хранилище по
 * подписанной ссылке (мимо API: документ больше предела тела запроса) и разбирается на сервере тем же
 * разбором, что «Из свидетельства и выписки»; сервер ещё раз проверяет размер и начало файла.
 */

/** Поля формы, которые заполняются из документов (прототип `LD_REG`). */
export const LEAD_REG_FIELDS = ['firm', 'inn', 'okpo', 'head', 'address'] as const;
export type LeadRegField = (typeof LEAD_REG_FIELDS)[number];

/** Ключ словаря «Приложите …» по виду документа (`land.f.doc.gns` → `land.e.doc.gns`). */
export const docMissingKey = (kind: LeadDocKind) =>
  LEAD_DOC_TEXT_KEYS[kind].replace('land.f.doc.', 'land.e.doc.') as UiTextKey;

const PDF_MAGIC = '%PDF-';

/** Только PDF, до 20 МБ; PDF — по содержимому (начало «%PDF-»), а не по имени (прототип ldDocErr). */
export async function leadDocProblem(file: File): Promise<UiTextKey | null> {
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return 'land.e.pdf';
  if (file.size > LEAD_DOC_MAX_BYTES) return 'land.e.big';
  if (file.size < PDF_MAGIC.length) return 'land.e.pdf';
  try {
    const head = new Uint8Array(await file.slice(0, PDF_MAGIC.length).arrayBuffer());
    return String.fromCharCode(...head) === PDF_MAGIC ? null : 'land.e.pdf';
  } catch {
    return 'land.e.pdf';
  }
}

export type LeadDocResult =
  | { ok: true; draft: string; read: LeadDocsRead }
  | { ok: false; error: ApiErrorLike; draft: string | null };

/**
 * Загрузить и прочитать документ: начать загрузку (черновик — прежний или новый), положить PDF в
 * хранилище, прочитать. Ответ чтения — итог по всем документам черновика.
 */
export async function uploadLeadDoc(
  draft: string | null,
  kind: LeadDocKind,
  file: File,
): Promise<LeadDocResult> {
  const started = await callApi(() =>
    api.api.leads.uploads.$post({ json: { draft, kind, name: file.name, size: file.size } }),
  );
  if (!started.ok) return { ok: false, error: started.error, draft };
  const ticket = LeadUploadTicket.parse(started.data);
  try {
    const put = await fetch(ticket.upload.url, {
      method: ticket.upload.method,
      headers: ticket.upload.headers,
      body: file,
    });
    if (!put.ok) return { ok: false, error: { code: 'network', message: '' }, draft: ticket.draft };
  } catch {
    return { ok: false, error: { code: 'network', message: '' }, draft: ticket.draft };
  }
  const read = await callApi(() =>
    api.api.leads.uploads[':id'].read.$post({
      param: { id: ticket.id },
      json: { draft: ticket.draft },
    }),
  );
  if (!read.ok) return { ok: false, error: read.error, draft: ticket.draft };
  return { ok: true, draft: ticket.draft, read: LeadDocsRead.parse(read.data) };
}

/** Ошибка документа под полем: «Только PDF», «Файл больше 20 МБ»; пределы — текст сервера. */
export function leadDocErrorKey(error: ApiErrorLike): UiTextKey | null {
  if (error.code === 'lead_doc_pdf') return 'land.e.pdf';
  if (error.code === 'lead_doc_big') return 'land.e.big';
  return null;
}

/** Строка под документами: «Читаем документы…» или что нашёл разбор (прототип ldFoundSync). */
export function foundNote(
  busy: boolean,
  found: LeadDocsFound | '',
): { key: UiTextKey; tone: 'info' | 'warn' | 'ok'; icon: 'hourglass' | 'check' | 'alert' } | null {
  if (busy) return { key: 'land.f.docs.reading', tone: 'info', icon: 'hourglass' };
  if (!found) return null;
  if (found === 'found') return { key: 'land.f.docs.found', tone: 'info', icon: 'check' };
  return { key: `land.f.docs.${found}` as UiTextKey, tone: 'warn', icon: 'alert' };
}
