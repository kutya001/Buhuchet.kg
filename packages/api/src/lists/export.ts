import { releaseRateLimit, takeRateLimit, type RateLimit } from '@buhuchet/db';
import {
  bishkekDate,
  EXPORT_HOURLY_LIMIT,
  formatDateRu,
  isNumericColumn,
  type ListColumnType,
} from '@buhuchet/domain';
import { ApiError } from '@buhuchet/shared';
import { z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { ApiDeps } from '../deps';
import { apiFail } from '../errors';
import { buildXlsx, XLSX_TYPE, type XlsxCell } from './xlsx';

/**
 * Ответ выгрузки списка в Excel: файл «<список> <дата>.xlsx» с заголовками из словаря. Сколько строк
 * в файле и все ли вошли — в заголовках `x-export-rows` и `x-export-more`: экран говорит об этом
 * уведомлением.
 */
export async function xlsxResponse(
  c: Context,
  options: {
    title: string;
    today: Date;
    columns: readonly { label: string; type: ListColumnType }[];
    rows: readonly XlsxCell[][];
    more: boolean;
    t: (key: string) => string;
  },
): Promise<Response> {
  const { title, columns, rows, more, t } = options;
  const file = await buildXlsx(
    title,
    columns.map((col) => ({
      title: t(col.label),
      kind: col.type === 'money' ? 'money' : isNumericColumn(col.type) ? 'number' : 'text',
    })),
    rows,
  );
  const name = `${title} ${formatDateRu(bishkekDate(options.today))}.xlsx`;
  return c.body(new Uint8Array(file), 200, {
    'content-type': XLSX_TYPE,
    'content-disposition': `attachment; filename="export.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
    'cache-control': 'no-store',
    'x-export-rows': String(rows.length),
    'x-export-more': more ? '1' : '0',
  });
}

/** Содержимое ответа 200 метода выгрузки — для описания OpenAPI (`createRoute`). */
export const xlsxContent = {
  [XLSX_TYPE]: { schema: z.string().openapi({ format: 'binary' }) },
};

/**
 * Выгрузки одного пользователя (docs/decisions.md, п. 38): одна одновременно и не больше
 * `EXPORT_HOURLY_LIMIT` за час. Выгрузка, которую не отпустили (сбой процесса), перестаёт мешать через
 * 2 минуты: запрос к базе — до 60 с, плюс сборка файла.
 */
export const EXPORT_RATE_LIMIT: RateLimit = {
  kind: 'export',
  max: EXPORT_HOURLY_LIMIT,
  windowSeconds: 3600,
  leaseSeconds: 120,
};

/**
 * Выгрузка «В Excel» по очереди: идёт прежняя выгрузка пользователя — 429 `export_busy`, за час уже
 * `EXPORT_HOURLY_LIMIT` — 429 `export_limit`; иначе `run`, и выгрузка отпускается, чем бы она ни
 * кончилась. Вызывать после разбора параметров (`listQueryOf`): запрос не в формате в счёт не идёт.
 * Запросы к базе внутри `run` — с видом работы `export` (`withOrgContext(…, { …, kind: 'export' })`).
 */
export async function withExportSlot<T>(
  deps: ApiDeps,
  userId: string,
  run: () => Promise<T>,
): Promise<T> {
  const slot = await takeRateLimit(deps.db, EXPORT_RATE_LIMIT, userId);
  if (!slot.ok) {
    if (slot.reason === 'busy') {
      apiFail(429, 'export_busy', 'Предыдущая выгрузка ещё готовится');
    }
    apiFail(429, 'export_limit', 'Слишком много выгрузок за час', { n: EXPORT_HOURLY_LIMIT });
  }
  try {
    return await run();
  } finally {
    await releaseRateLimit(deps.db, slot.ticket).catch((err: unknown) =>
      deps.logger.error({ err }, 'выгрузка не отпущена'),
    );
  }
}

/** Ответ 429 метода выгрузки — для описания OpenAPI (`createRoute`). */
export const exportRateResponses = {
  429: {
    description: 'Идёт прежняя выгрузка пользователя или за час их уже 20',
    content: { 'application/json': { schema: ApiError } },
  },
} as const;
