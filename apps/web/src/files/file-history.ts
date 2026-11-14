import { fileSizeParts } from '@buhuchet/domain';
import type { Translate } from '../l10n/translate';

interface FileHistoryEntry {
  action: string;
  changes: readonly { field: string; from?: unknown; to?: unknown }[];
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

function sizeText(t: Translate, v: unknown): string {
  const { value, unit } = fileSizeParts(typeof v === 'number' ? v : Number(v ?? 0) || 0);
  return t(`files.size.${unit}`, { n: value });
}

/**
 * Записи истории о файле, одинаковые во всех карточках (прототип v95 modules/files.js `fileEditDlg`,
 * `fNoteLog`): прикрепление с примечанием — «Прикреплён файл: … Примечание: …»; «Изменить файл» —
 * «Файл «a» переименован в «b»», «Примечание к файлу «b»: …» или «… убрано», «Файл «b» заменён: было
 * X, стало Y» (одна запись на сохранение, части через «; »). Остальные записи — null: их пишет карточка.
 */
export function fileHistoryText(t: Translate, entry: FileHistoryEntry): string | null {
  const change = (field: string) => entry.changes.find((c) => c.field === field);
  const name = str(change('file')?.to);
  if (entry.action === 'file_attach') {
    const note = str(change('note')?.to);
    return note ? t('files.hist.attach_note', { name, note }) : null;
  }
  if (entry.action !== 'file_edit') return null;
  const parts: string[] = [];
  const renamed = change('name');
  if (renamed)
    parts.push(t('files.hist.renamed', { from: str(renamed.from), to: str(renamed.to) }));
  const noted = change('note');
  if (noted) {
    const note = str(noted.to);
    parts.push(note ? t('files.hist.note', { name, note }) : t('files.hist.note_off', { name }));
  }
  const replaced = change('size');
  if (replaced)
    parts.push(
      t('files.hist.replaced', {
        name,
        from: sizeText(t, replaced.from),
        to: sizeText(t, replaced.to),
      }),
    );
  return parts.join('; ');
}
