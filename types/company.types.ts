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

export interface ClosedPeriod {
  id?: string;
  company_id: string;
  year: number;
  month: number; // 1-12
  monthName?: string;
  lock_documents: boolean;
  lock_files: boolean;
  reason?: string | null;
  comment?: string | null;
  closed_by?: string | null;
  closed_by_user?: string | null;
  created_at?: string;
  updated_at?: string;
  status?: 'open' | 'partial' | 'closed';
}

export interface SaveClosedPeriodInput {
  companyId?: string;
  periodId?: string;
  year: number;
  month: number;
  lockDocuments: boolean;
  lockFiles: boolean;
  reason?: string;
}

export interface ClosedPeriodItem {
  id?: string;
  year: number;
  month: number; // 1-12
  monthName: string;
  lock_documents?: boolean;
  lock_files?: boolean;
  status: 'open' | 'partial' | 'closed';
  closed_at?: string | null;
  closed_by_user?: string | null;
  opened_at?: string | null;
  opened_by_user?: string | null;
  comment?: string | null;
  reason?: string | null;
}

export interface YearClosedPeriodsSummary {
  year: number;
  totalMonths: number;
  closedCount: number;
  openCount: number;
  periods: ClosedPeriodItem[];
}
