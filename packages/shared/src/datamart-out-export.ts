import type { z } from 'zod';
import { DmAdminRunInput, DmRunInput } from './datamart-output';
import { ListExportParams } from './list';

/*
 * «Витрина данных» → «Вывод» → «В Excel» (доработки 20.11.2026: Витрина данных, блок 4, пункт 5; общий
 * план 20.11, этап 2, П6; прототип v155 `dmDraw`: общий список с выгрузкой). Сервер заново выполняет
 * шаблон с теми же параметрами и отдаёт файл с теми же фильтрами, поиском, сортировкой и столбцами, что
 * у таблицы на экране. Организация — `POST /api/dm/output/export` (права «Смотреть витрину данных» и
 * «Выгружать в Excel»), Админка — `POST /api/admin/dm/output/export`.
 */

/** Выгрузка организации: шаблон и параметры, как у «Показать», и запрос списка с видимыми столбцами. */
export const DmOutExport = DmRunInput.extend({ list: ListExportParams });
export type DmOutExport = z.infer<typeof DmOutExport>;

/** Выгрузка Админки: у шаблона «Для организаций» — «Глазами организации». */
export const DmAdminOutExport = DmAdminRunInput.extend({ list: ListExportParams });
export type DmAdminOutExport = z.infer<typeof DmAdminOutExport>;
