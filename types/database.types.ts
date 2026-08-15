export type UserRole = 'owner' | 'accountant' | 'manager';

export type DocumentType = 'realization' | 'purchase' | 'payment' | 'advance';
export type DocumentStatus = 'draft' | 'sent' | 'recalled' | 'accepted' | 'processed' | 'cancelled';
export type EsfStatus = 'not_checked' | 'matched' | 'mismatch';
export type SubscriptionPlan = 'basic' | 'standard' | 'pro';
export type PaymentMethod = 'qr_mbank' | 'qr_optima' | 'manual_admin';

export type PartnershipStatus = 'pending' | 'sent' | 'recalled' | 'approved' | 'rejected' | 'accepted' | 'cancelled' | 'suspended';
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

export type LegalForm = 'ИП' | 'ОсОО' | 'ЗАО' | 'ОАО' | 'КФХ';

export interface CompanyPrivacySettings {
  show_phone: boolean;
  show_email: boolean;
  show_address: boolean;
}

export interface Company {
  id: string;
  name: string;
  legal_form?: LegalForm;
  inn: string;
  industry?: string | null;
  status: CompanyStatus;
  moderation_comment?: string | null;
  legal_address?: string | null;
  director_name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  privacy_settings?: CompanyPrivacySettings;
  okpo?: string | null;
  checking_account?: string | null;
  bic?: string | null;
  bank_name?: string | null;
  corr_account?: string | null;
  currency?: string | null;
  is_active: boolean;
  storage_limit_gb: number;
  closed_period_until?: string | null;
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

  // Расширенные гранулярные права вкладок и статусов
  export?: boolean;
  view_all_statuses?: boolean;
  view_draft_only?: boolean;
  view_sent_only?: boolean;
  view_accepted_only?: boolean;

  tab_counterparties?: boolean;
  tab_partnerships?: boolean;
  tab_catalog?: boolean;

  tab_profile?: boolean;
  tab_legal_docs?: boolean;
  tab_periods?: boolean;
  periods_view?: boolean;
  periods_manage?: boolean;
  upload_legal_doc?: boolean;
  add_legal_doc?: boolean;
  edit_legal_doc?: boolean;
  delete_legal_doc?: boolean;

  tab_my_profile?: boolean;
  tab_employees?: boolean;
  tab_roles?: boolean;
  edit_my_profile?: boolean;
  create_role?: boolean;
  edit_role?: boolean;
  delete_role?: boolean;
  telegram_bind?: boolean;
  notify_documents?: boolean;
  notify_collaboration?: boolean;
  manage_subscription?: boolean;
}

export interface RolePermissions {
  dashboard?: ModulePermissions;
  documents?: ModulePermissions;
  files?: ModulePermissions;
  counterparties?: ModulePermissions;
  employees?: ModulePermissions;
  company?: ModulePermissions;
  subscription?: ModulePermissions;
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

export type JoinRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface CompanyJoinRequest {
  id: string;
  company_id: string;
  user_id: string;
  position_note?: string | null;
  status: JoinRequestStatus;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  created_at: string;
  updated_at: string;
  companies?: Company | null;
  users?: UserProfile | null;
  reviewer?: UserProfile | null;
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
  description?: string | null;
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
  total_amount?: number;
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

export interface TelegramConnection {
  id: string;
  user_id: string;
  company_id: string;
  telegram_chat_id: number;
  telegram_user_id?: number | null;
  telegram_username?: string | null;
  created_at: string;
}

export interface TelegramVerificationCode {
  id: string;
  user_id: string;
  company_id: string;
  code: string;
  expires_at: string;
  created_at: string;
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
