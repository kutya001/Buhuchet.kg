export type UserRole = 'owner' | 'accountant' | 'manager';

export type SubscriptionPlan = 'basic' | 'standard' | 'pro';
export type SubscriptionStatus = 'active' | 'expired' | 'trial';

export type PaymentMethod = 'qr_mbank' | 'qr_optima' | 'manual_admin';
export type PaymentStatus = 'pending' | 'completed' | 'failed';

export type DocumentType = 'realization' | 'purchase' | 'payment' | 'advance';
export type DocumentStatus = 'draft' | 'review' | 'approved' | 'rejected' | 'posted_1c';
export type EsfStatus = 'not_checked' | 'matched' | 'mismatch';

export interface Company {
  id: string;
  name: string;
  inn: string;
  address?: string | null;
  phone?: string | null;
  is_active: boolean;
  storage_limit_gb: number;
  created_at: string;
  updated_at: string;
}

export interface UserProfile {
  id: string;
  company_id?: string | null;
  full_name: string;
  email: string;
  phone?: string | null;
  role: UserRole;
  is_super_admin: boolean;
  created_at: string;
  updated_at: string;
}

export interface Subscription {
  id: string;
  company_id: string;
  plan_type: SubscriptionPlan;
  status: SubscriptionStatus;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionPayment {
  id: string;
  company_id: string;
  amount: number;
  payment_method: PaymentMethod;
  status: PaymentStatus;
  is_mock: boolean;
  created_at: string;
}

export interface Counterparty {
  id: string;
  company_id: string;
  name: string;
  inn: string;
  is_vat_payer: boolean;
  phone?: string | null;
  comment?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Nomenclature {
  id: string;
  company_id: string;
  title: string;
  code?: string | null;
  unit: string;
  price: number;
  created_at: string;
  updated_at: string;
}

export interface Document {
  id: string;
  company_id: string;
  author_id: string;
  counterparty_id?: string | null;
  doc_number?: string | null;
  doc_date: string;
  doc_type: DocumentType;
  status: DocumentStatus;
  total_amount: number;
  comment?: string | null;
  file_path_r2?: string | null;
  mock_file_name?: string | null;
  mock_file_size?: string | null;
  mock_file_status?: string | null;
  esf_status: EsfStatus;
  created_at: string;
  updated_at: string;
}

export interface DocumentItem {
  id: string;
  document_id: string;
  nomenclature_id?: string | null;
  title: string;
  quantity: number;
  price: number;
  total: number;
  created_at: string;
}

export interface DocumentLog {
  id: string;
  document_id: string;
  user_id?: string | null;
  old_status?: string | null;
  new_status: string;
  comment?: string | null;
  created_at: string;
}

export interface ActionResponse<T = undefined> {
  success: boolean;
  data?: T;
  error?: string;
}
