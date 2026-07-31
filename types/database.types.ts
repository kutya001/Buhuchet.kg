export type UserRole = 'owner' | 'accountant' | 'manager';

export type DocumentType = 'realization' | 'purchase' | 'payment' | 'advance';
export type DocumentStatus = 'draft' | 'sent' | 'recalled' | 'accepted' | 'processed' | 'cancelled';
export type EsfStatus = 'not_checked' | 'matched' | 'mismatch';
export type SubscriptionPlan = 'basic' | 'standard' | 'pro';
export type PaymentMethod = 'qr_mbank' | 'qr_optima' | 'manual_admin';

export type PartnershipStatus = 'pending' | 'sent' | 'recalled' | 'approved' | 'rejected' | 'suspended';
export type CompanyStatus = 'pending_approval' | 'requires_changes' | 'active' | 'blocked';

export const INDUSTRIES = [
  'Горнодобывающая отрасль',
  'Ритейл / Торговля',
  'Транспорт и Логистика',
  'IT и Телеком',
  'Строительство',
  'Услуги / Консалтинг',
  'Производство',
  'Прочее',
] as const;

export interface Company {
  id: string;
  name: string;
  inn: string;
  industry?: string | null;
  status: CompanyStatus;
  moderation_comment?: string | null;
  legal_address?: string | null;
  director_name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  is_active: boolean;
  storage_limit_gb: number;
  created_at: string;
  updated_at: string;
}

export interface CompanyPartnership {
  id: string;
  requester_company_id: string;
  target_company_id: string;
  status: PartnershipStatus;
  created_at: string;
  updated_at: string;
  
  requester_company?: Company | null;
  target_company?: Company | null;
}

export interface ModulePermissions {
  view?: boolean;
  view_details?: boolean;
  create?: boolean;
  edit?: boolean;
  delete?: boolean;
  send?: boolean;
  accept?: boolean;
  recall?: boolean;
  manage?: boolean;
  upload?: boolean;
  download?: boolean;
  request_partnership?: boolean;
  respond_partnership?: boolean;
  create_manual?: boolean;
  terminate?: boolean;
  create_employee?: boolean;
  edit_employee?: boolean;
  reset_password?: boolean;
  manage_roles?: boolean;
  export_excel?: boolean;
}

export interface RolePermissions {
  documents?: ModulePermissions;
  files?: ModulePermissions;
  counterparties?: ModulePermissions;
  employees?: ModulePermissions;
  company?: ModulePermissions;
  export?: ModulePermissions;
}

export interface CompanyRole {
  id: string;
  company_id: string;
  name: string;
  description?: string | null;
  is_system?: boolean;
  permissions: RolePermissions;
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
  role_id?: string | null;
  position?: string | null;
  is_active?: boolean;
  must_change_password?: boolean;
  is_super_admin: boolean;
  created_at: string;
  updated_at: string;
  companies?: Company | null;
  company_roles?: CompanyRole | null;
}

export interface FileCategory {
  id: string;
  name: string;
  code?: string | null;
  description?: string | null;
  icon?: string | null;
  is_active?: boolean;
  created_at: string;
}

export interface FileRecord {
  id: string;
  document_id?: string | null;
  company_id?: string | null;
  category_id?: string | null;
  file_name: string;
  size_bytes?: number | null;
  file_type?: string | null;
  file_path_r2?: string | null;
  description: string;
  comment?: string | null;
  is_internal?: boolean;
  is_legal_doc?: boolean;
  created_at: string;
  file_categories?: FileCategory | null;
}

export type DocumentFile = FileRecord;

export interface Counterparty {
  id: string;
  company_id: string;
  target_company_id?: string | null;
  name: string;
  inn: string;
  is_vat_payer: boolean;
  phone?: string | null;
  email?: string | null;
  comment?: string | null;
  created_at: string;
  updated_at: string;
  
  target_company?: Company | null;
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
  author_id?: string | null;
  sender_company_id?: string | null;
  receiver_company_id?: string | null;
  sender_user_id?: string | null;
  receiver_user_id?: string | null;
  counterparty_id?: string | null;
  doc_number?: string | null;
  doc_date: string;
  doc_type: DocumentType;
  status: DocumentStatus;
  total_amount: number;
  comment?: string | null;
  mock_file_name?: string | null;
  mock_file_size?: number | null;
  mock_file_status?: string | null;
  esf_status: EsfStatus;
  created_at: string;
  updated_at: string;
  
  sender_company?: Company | null;
  receiver_company?: Company | null;
  counterparties?: Counterparty | null;
  files?: FileRecord[];
  sender_user?: { full_name: string; position?: string | null } | null;
  receiver_user?: { full_name: string; position?: string | null } | null;
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

export interface FeatureFlag {
  key: string;
  title: string;
  description?: string | null;
  is_enabled: boolean;
  updated_at: string;
}

export interface Subscription {
  id: string;
  company_id: string;
  plan_type: SubscriptionPlan;
  status: 'active' | 'expired' | 'trial';
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export type ActionResponse<T = any> = {
  success: boolean;
  data?: T;
  error?: string;
};
