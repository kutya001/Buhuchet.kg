import { z } from 'zod';
import { DocumentType, DocumentStatus } from './database.types';

export const exportFilterSchema = z.object({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  docType: z.string().default('all'),
  status: z.string().default('approved_or_posted'),
});

export type ExportFilterInput = z.infer<typeof exportFilterSchema>;

export interface Export1CRow {
  'Дата Документа': string;
  'Номер Документа': string;
  'Тип Операции': string;
  'ИНН Контрагента': string;
  'Наименование Контрагента': string;
  'Товар / Услуга': string;
  'Кол-во': number;
  'Ед. изм.': string;
  'Цена (сом)': number;
  'Сумма (сом)': number;
  'Учет НДС (12%)': string;
  'Статус Документа': string;
}
