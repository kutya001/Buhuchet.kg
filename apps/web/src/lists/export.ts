'use client';

import { EXPORT_ROWS_LIMIT, formatCount, pluralForm } from '@buhuchet/domain';
import { useToast } from '@buhuchet/ui';
import { useCallback, useState } from 'react';
import { useT } from '../l10n/provider';

/** Ответ метода выгрузки: файл и заголовки (`content-disposition`, `x-export-rows`, `x-export-more`). */
interface ExportResponse {
  ok: boolean;
  headers: Headers;
  blob(): Promise<Blob>;
}

/** Имя файла из `filename*=UTF-8''…` (русское название списка и дата); нет — `export.xlsx`. */
export function exportFileName(disposition: string | null): string {
  const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition ?? '');
  if (!match) return 'export.xlsx';
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return 'export.xlsx';
  }
}

/** Отдать файл браузеру на скачивание. */
function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * «В Excel» (ТЗ «Экспорт в Excel всех отфильтрованных записей; файл формируется на сервере»): файл
 * собирает сервер по тем же поиску, фильтрам и сортировке, что у списка, со столбцами экрана;
 * браузер его только скачивает. Уведомление — сколько строк в файле; если все не вошли — «В файл
 * вошли первые 50 000 записей». Ошибка — уведомление.
 */
export function useListExport(send: () => Promise<ExportResponse>) {
  const toast = useToast();
  const t = useT();
  const [exporting, setExporting] = useState(false);

  const run = useCallback(async () => {
    setExporting(true);
    try {
      const res = await send();
      if (!res.ok) throw new Error('export');
      const blob = await res.blob();
      saveFile(blob, exportFileName(res.headers.get('content-disposition')));
      const rows = Number(res.headers.get('x-export-rows') ?? 0);
      if (res.headers.get('x-export-more') === '1') {
        toast(t('grid.export_more', { n: formatCount(EXPORT_ROWS_LIMIT) }), { icon: 'info' });
      } else {
        toast(t(`grid.exported.${pluralForm(rows)}`, { n: rows }), { icon: 'download' });
      }
    } catch {
      toast(t('grid.export_failed'), { icon: 'alert', bad: true });
    } finally {
      setExporting(false);
    }
  }, [send, toast, t]);

  return { exporting, run };
}
