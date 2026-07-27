import { z } from 'zod';
import { DocumentType, DocumentStatus, EsfStatus } from './database.types';

export const DOCUMENT_TYPES: Record<DocumentType, { label: string; color: string }> = {
  realization: { label: 'Реализация (Продажа)', color: 'text-blue-400 border-blue-500/30 bg-blue-500/10' },
  purchase: { label: 'Закуп (Поступление)', color: 'text-purple-400 border-purple-500/30 bg-purple-500/10' },
  payment: { label: 'Оплата (Чек / Перевод)', color: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' },
  advance: { label: 'Авансовый отчет', color: 'text-amber-400 border-amber-500/30 bg-amber-500/10' },
};

export const DOCUMENT_STATUSES: Record<DocumentStatus, { label: string; variant: 'default' | 'secondary' | 'warning' | 'success' | 'destructive' }> = {
  draft: { label: 'Черновик', variant: 'secondary' },
  review: { label: 'На проверке', variant: 'warning' },
  approved: { label: 'Одобрен', variant: 'success' },
  rejected: { label: 'Отклонен', variant: 'destructive' },
  posted_1c: { label: 'Проведен в 1С', variant: 'default' },
};

export const documentItemSchema = z.object({
  id: z.string().uuid().optional(),
  nomenclature_id: z.string().uuid().optional().nullable(),
  title: z.string().min(1, { message: 'Укажите наименование товара или услуги' }),
  quantity: z.coerce.number().positive({ message: 'Количество должно быть больше 0' }).default(1),
  price: z.coerce.number().min(0, { message: 'Цена не может быть отрицательной' }).default(0),
  total: z.coerce.number().min(0).default(0),
});

export const documentSchema = z.object({
  id: z.string().uuid().optional(),
  counterparty_id: z.string().uuid().optional().nullable(),
  doc_number: z.string().optional().nullable(),
  doc_date: z.string().default(() => new Date().toISOString().split('T')[0]),
  doc_type: z.enum(['realization', 'purchase', 'payment', 'advance'] as [DocumentType, ...DocumentType[]]),
  status: z.enum(['draft', 'review', 'approved', 'rejected', 'posted_1c'] as [DocumentStatus, ...DocumentStatus[]]).default('draft'),
  comment: z.string().optional().nullable(),
  mock_file_name: z.string().optional().nullable(),
  mock_file_size: z.string().optional().nullable(),
  mock_file_status: z.string().optional().nullable(),
  items: z.array(documentItemSchema).default([]),
});

export type DocumentItemInput = z.infer<typeof documentItemSchema>;
export type DocumentInput = z.infer<typeof documentSchema>;
