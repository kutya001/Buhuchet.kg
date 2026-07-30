import { z } from 'zod';

export type B2BDocumentStatus = 'draft' | 'sent' | 'recalled' | 'accepted' | 'processed' | 'cancelled';

export const B2B_DOCUMENT_STATUSES: Record<
  B2BDocumentStatus,
  { label: string; variant: 'default' | 'secondary' | 'warning' | 'success' | 'destructive' }
> = {
  draft: { label: 'Черновик', variant: 'secondary' },
  sent: { label: 'Отправлен', variant: 'warning' },
  recalled: { label: 'Отозван', variant: 'destructive' },
  accepted: { label: 'Принят', variant: 'success' },
  processed: { label: 'Обработан', variant: 'default' },
  cancelled: { label: 'Отменён', variant: 'destructive' },
};

// Zod-схема прикрепленного файла
export const fileAttachmentSchema = z.object({
  id: z.string().optional(),
  category_id: z.string().min(1, { message: 'Выберите категорию файла' }),
  file_name: z.string().min(1, { message: 'Название файла обязательно' }),
  file_size: z.string().optional(),
  file_type: z.string().optional(),
  file_path_r2: z.string().optional().nullable(),
  description: z.string().min(3, { message: 'Описание файла обязательно (минимум 3 символа)' }),
  comment: z.string().optional().nullable(),
});

// Zod-схема B2B документа
export const b2bDocumentSchema = z.object({
  id: z.string().uuid().optional(),
  receiver_company_id: z.string().uuid({ message: 'Выберите компанию-получателя' }),
  doc_number: z.string().optional().nullable(),
  doc_date: z.string().default(() => new Date().toISOString().split('T')[0]),
  doc_type: z.enum(['realization', 'purchase', 'payment', 'advance']).default('realization'),
  status: z.enum(['draft', 'sent', 'recalled', 'accepted', 'processed', 'cancelled'] as [B2BDocumentStatus, ...B2BDocumentStatus[]]).default('draft'),
  comment: z.string().optional().nullable(),
  files: z.array(fileAttachmentSchema).min(1, { message: 'Прикрепите хотя бы один файл' }),
});

export type FileAttachmentInput = z.infer<typeof fileAttachmentSchema>;
export type B2BDocumentInput = z.infer<typeof b2bDocumentSchema>;
