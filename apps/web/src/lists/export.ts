'use client';

import { formatCount, pluralForm } from '@buhuchet/domain';
import { ApiError } from '@buhuchet/shared';
import { useToast } from '@buhuchet/ui';
import { useCallback, useState } from 'react';
import { useErrorText, useT } from '../l10n/provider';
import type { ApiErrorLike, Translate } from '../l10n/translate';
import { limitFailureText } from './limit-text';

/**
 * Ответ метода выгрузки: файл и заголовки (`content-disposition`, `x-export-rows`, `x-export-more`,
 * `x-export-total`); отказ — ошибка в общем формате API.
 */
interface ExportResponse {
  ok: boolean;
  headers: Headers;
  blob(): Promise<Blob>;
  json(): Promise<unknown>;
}

/**
 * Текст уведомления об отказе в выгрузке: предел сервера по словарю («Предыдущая выгрузка в Excel ещё
 * готовится», «Не больше 20 выгрузок в Excel за час», «Запрос выполнялся слишком долго…»,
 * `limitFailureText`); другая ошибка или ответ не в общем формате — `fallback`.
 */
export function exportFailureText(
  body: unknown,
  t: Translate,
  errorText: (error: ApiErrorLike) => string,
  fallback: string,
): string {
  const parsed = ApiError.safeParse(body);
  return limitFailureText(parsed.success ? parsed.data.error : null, t, errorText) ?? fallback;
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

/**
 * Уведомление после выгрузки: «Скачан файл Excel: 120 строк»; если вошли не все — «Выгружено 50 000
 * строк из 62 300 — сузьте фильтр, чтобы выгрузить остальные» (ТЗ «Списки», решение заказчика
 * 26.10.2026; прототип ui/grid.js).
 */
export function exportDoneText(headers: Pick<Headers, 'get'>, t: Translate): string {
  const rows = Number(headers.get('x-export-rows') ?? 0);
  if (headers.get('x-export-more') !== '1') {
    return t(`grid.exported.${pluralForm(rows)}`, { n: rows });
  }
  const total = Number(headers.get('x-export-total') ?? 0);
  return t('grid.export_more', { n: formatCount(rows), total: formatCount(Math.max(total, rows)) });
}

/** Отдать файл браузеру на скачивание. */
export function saveFile(blob: Blob, name: string) {
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
 * браузер его только скачивает. Уведомление — сколько строк в файле (`exportDoneText`). Отказ сервера —
 * уведомление с причиной (`exportFailureText`), обрыв связи — «Не удалось выгрузить список».
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
        toast(exportFailureText(body, t, errorText, t('grid.export_failed')), {
          icon: 'alert',
          bad: true,
        });
        return;
      }
      const blob = await res.blob();
      saveFile(blob, exportFileName(res.headers.get('content-disposition')));
      toast(exportDoneText(res.headers, t), {
        icon: res.headers.get('x-export-more') === '1' ? 'alert' : 'download',
      });
    } catch {
      toast(t('grid.export_failed'), { icon: 'alert', bad: true });
    } finally {
      setExporting(false);
    }
  }, [send, toast, t, errorText]);

  return { exporting, run };
}
