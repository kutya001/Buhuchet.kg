import { z } from 'zod';
import { DocumentType, DocumentStatus } from './database.types';

export const DOCUMENT_TYPES: Record<DocumentType, { label: string; color: string }> = {
  realization: { label: 'Реализация (Продажа)', color: 'text-blue-400 border-blue-500/30 bg-blue-500/10' },
  purchase: { label: 'Закуп (Поступление)', color: 'text-purple-400 border-purple-500/30 bg-purple-500/10' },
  payment: { label: 'Оплата (Перевод / Чек)', color: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' },
  advance: { label: 'Авансовый отчет', color: 'text-amber-400 border-amber-500/30 bg-amber-500/10' },
};

export const DOCUMENT_STATUSES: Record<
  DocumentStatus,
  { label: string; variant: 'default' | 'secondary' | 'warning' | 'success' | 'destructive' }
> = {
  draft: { label: 'Черновик', variant: 'secondary' },
  sent: { label: 'Отправлен', variant: 'warning' },
  recalled: { label: 'Отозван', variant: 'destructive' },
  accepted: { label: 'Принят', variant: 'success' },
  processed: { label: 'Обработан', variant: 'default' },
  cancelled: { label: 'Отменён', variant: 'destructive' },
};

export const documentItemSchema = z.object({
  id: z.string().uuid().optional(),
  nomenclature_id: z.string().uuid().optional().nullable(),
  title: z.string().min(1, { message: 'Укажите наименование товара или услуги' }),
  quantity: z.coerce.number().positive().default(1),
  price: z.coerce.number().min(0).default(0),
  total: z.coerce.number().min(0).default(0),
});

export const documentSchema = z.object({
  id: z.string().uuid().optional(),
  receiver_company_id: z.string().uuid({ message: 'Выберите компанию-получателя' }),
  doc_number: z.string().optional().nullable(),
  doc_date: z.string().default(() => new Date().toISOString().split('T')[0]),
  doc_type: z.enum(['realization', 'purchase', 'payment', 'advance'] as [DocumentType, ...DocumentType[]]),
  status: z.enum(['draft', 'sent', 'recalled', 'accepted', 'processed', 'cancelled'] as [DocumentStatus, ...DocumentStatus[]]).default('draft'),
  comment: z.string().optional().nullable(),
});

export type DocumentInput = z.infer<typeof documentSchema>;
