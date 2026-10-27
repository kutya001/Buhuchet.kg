'use client';

import { EXPORT_ROWS_LIMIT, formatCount, pluralForm } from '@buhuchet/domain';
import { ApiError } from '@buhuchet/shared';
import { useToast } from '@buhuchet/ui';
import { useCallback, useState } from 'react';
import { useErrorText, useT } from '../l10n/provider';
import type { ApiErrorLike } from '../l10n/translate';

/**
 * Ответ метода выгрузки: файл и заголовки (`content-disposition`, `x-export-rows`, `x-export-more`);
 * отказ — ошибка в общем формате API.
 */
interface ExportResponse {
  ok: boolean;
  headers: Headers;
  blob(): Promise<Blob>;
  json(): Promise<unknown>;
}

/**
 * Текст уведомления об отказе в выгрузке: причина из ответа сервера по словарю («Предыдущая выгрузка
 * в Excel ещё готовится», «Не больше 20 выгрузок в Excel за час», «Запрос выполнялся слишком долго»);
 * ответ не в общем формате — `fallback`.
 */
export function exportFailureText(
  body: unknown,
  errorText: (error: ApiErrorLike) => string,
  fallback: string,
): string {
  const parsed = ApiError.safeParse(body);
  return parsed.success ? errorText(parsed.data.error) : fallback;
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
 * вошли первые 50 000 записей». Отказ сервера — уведомление с причиной (`exportFailureText`), обрыв
 * связи — «Не удалось выгрузить список».
 */
export function useListExport(send: () => Promise<ExportResponse>) {
  const toast = useToast();
  const t = useT();
  const errorText = useErrorText();
  const [exporting, setExporting] = useState(false);

  const run = useCallback(async () => {
    setExporting(true);
    try {
      const res = await send();
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => null);
        toast(exportFailureText(body, errorText, t('grid.export_failed')), {
          icon: 'alert',
          bad: true,
        });
        return;
      }
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
  }, [send, toast, t, errorText]);

  return { exporting, run };
}
