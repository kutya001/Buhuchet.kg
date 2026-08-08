import { z } from 'zod';
import type { Company } from './database.types';

export const kgInnRegex = /^\d{14}$/;

export const createCompanySchema = z.object({
  name: z.string().min(2, 'Наименование компании должно содержать не менее 2 символов'),
  legal_form: z.enum(['ИП', 'ОсОО', 'ЗАО', 'ОАО']).default('ОсОО'),
  inn: z.string().length(14, 'ИНН должен состоять строго из 14 цифр'),
  industry: z.string().optional(),
  director_name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email('Некорректный e-mail').optional().or(z.literal('')),
  address: z.string().optional(),
});

export type CreateCompanyInput = z.infer<typeof createCompanySchema>;

export interface CompanyProfileStats {
  totalFiles: number;
  totalDocuments: number;
  totalCounterparties: number;
  totalEmployees: number;
  storageUsedBytes: number;
}

export interface CompanyProfileData {
  company: Company;
  stats: CompanyProfileStats;
  isOwner: boolean;
  canEdit: boolean;
}

export interface ClosedPeriodItem {
  id?: string;
  year: number;
  month: number; // 1-12
  monthName: string;
  status: 'open' | 'closed';
  closed_at?: string | null;
  closed_by_user?: string | null;
  opened_at?: string | null;
  opened_by_user?: string | null;
  comment?: string | null;
}

export interface YearClosedPeriodsSummary {
  year: number;
  totalMonths: number;
  closedCount: number;
  openCount: number;
  periods: ClosedPeriodItem[];
}
