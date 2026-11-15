import type { Translate } from '../l10n/translate';

/** Запись истории контрагента об отправленном файле (как её отдаёт `/api/contractors/{id}/history`). */
export interface SentHistoryEntry {
  action: string;
  actor: string | null;
  changes: readonly { field: string; from?: unknown; to?: unknown }[];
  reason: string | null;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const changeOf = (e: SentHistoryEntry, field: string) =>
  e.changes.find((c) => c.field === field)?.to;

/**
 * Что произошло с файлом от контрагента — строкой, как в прототипе v112 (`pubUpDlg`, `sntAccept`,
 * `sntRejectDlg`, `sntPurge`) и v115 (`pgFileIn`): «Контрагент отправил со страницы файлы: ….
 * Комментарий: …», «Контрагент отправил через Telegram («@имя») чек: …», «Принят файл
 * от контрагента «…» (сохранён как «…»)», «Отклонён файл от контрагента «…»: причина», «Удалён
 * непринятый файл от контрагента «…»: прошло 30 дней после отправки».
 */
export function sentHistoryText(t: Translate, e: SentHistoryEntry): string {
  const name = str(changeOf(e, 'file'));
  switch (e.action) {
    case 'sent_file_send': {
      const files = changeOf(e, 'files');
      const names = Array.isArray(files) ? files.map(str) : [];
      const form = names.length > 1 ? 'many' : 'one';
      // Из Telegram — с именем чата и «чек» у чека (прототип v115 `pgFileIn`).
      const who = str(changeOf(e, 'sender'));
      const text =
        changeOf(e, 'source') === 'telegram'
          ? t(
              `files.sent.hist.${who ? 'send_tg' : 'send_tg_anon'}.${changeOf(e, 'receipt') === true ? 'receipt' : form}`,
              { names: names.join(', '), who },
            )
          : t(`files.sent.hist.send.${form}`, { names: names.join(', ') });
      const note = str(changeOf(e, 'comment'));
      return note ? t('files.sent.hist.note', { text, note }) : text;
    }
    case 'sent_file_accept': {
      const saved = str(changeOf(e, 'savedAs'));
      return saved
        ? t('files.sent.hist.accept_as', { name, saved })
        : t('files.sent.hist.accept', { name });
    }
    case 'sent_file_reject':
      return t('files.sent.hist.reject', { name, reason: e.reason ?? '' });
    case 'sent_file_purge':
      return t('files.sent.hist.purge', { name });
    default:
      return '';
  }
}

/** Кто: отправку сделал контрагент (без автора), удаление через 30 дней — система (прототип `who`). */
export function sentHistoryActor(t: Translate, e: Pick<SentHistoryEntry, 'action' | 'actor'>) {
  if (e.actor) return e.actor;
  return e.action === 'sent_file_send' ? t('cppage.hist.client') : t('status.system');
}
