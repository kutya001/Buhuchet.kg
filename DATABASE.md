# DATABASE.md — Схема базы данных, RLS и правила безопасности (PostgreSQL / Supabase)

Этот документ содержит полную физическую схему базы данных PostgreSQL (Supabase), описание таблиц, связей (Foreign Keys), индексов и правил безопасности на уровне строк (Row Level Security — RLS) для проекта Buhuchet.kg.

---

## 1. АРХИТЕКТУРА И ПРИНЦИПЫ ДАННЫХ

1. **Multi-Tenancy (Мультиарендность):** Каждая бизнес-таблица содержит поле `company_id` (UUID), ссылающееся на таблицу `companies`.
2. **Row Level Security (RLS):** Включен на всех таблицах. Прямой доступ без авторизации заблокирован. Пользователь получает доступ только к записям с `company_id`, совпадающим с его профилем.
3. **Изоляция Супер-админа:** Права суперадминистратора определяются через флаг `is_super_admin = true` в таблице `users` и переопределяют RLS при использовании клиентом `lib/supabase/admin.ts` (`SUPABASE_SERVICE_ROLE_KEY`).
4. **Связи Модерации и Партнерства:** Статусы модерации организаций (`pending_approval`, `requires_changes`, `active`, `blocked`) и связывание партнёрских компаний через `target_company_id`.

---

## 2. ПОЛНАЯ СХЕМА ТАБЛИЦ (SQL DDL)

### 2.1 Таблица `companies` (Организации / Арендаторы)

```sql
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  inn VARCHAR(14) NOT NULL UNIQUE,
  industry TEXT DEFAULT 'Услуги / Консалтинг',
  director_name TEXT,
  email TEXT,
  phone VARCHAR(20),
  legal_address TEXT,
  address TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  status TEXT CHECK (status IN ('pending_approval', 'requires_changes', 'active', 'blocked')) DEFAULT 'pending_approval',
  moderation_comment TEXT,
  storage_limit_gb INT4 DEFAULT 10,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_companies_inn ON companies(inn);
CREATE INDEX idx_companies_status ON companies(status);
```

### 2.2 Таблица `users` (Профиль пользователя)

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone VARCHAR(20),
  role TEXT CHECK (role IN ('owner', 'accountant', 'manager')) DEFAULT 'manager',
  is_super_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_users_company_id ON users(company_id);
CREATE INDEX idx_users_role ON users(role);
```

### 2.3 Таблица `subscriptions` (Тарифы и Подписки)

```sql
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE UNIQUE,
  plan_type TEXT CHECK (plan_type IN ('basic', 'standard', 'pro')) DEFAULT 'basic',
  status TEXT CHECK (status IN ('active', 'expired', 'trial')) DEFAULT 'trial',
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '14 days'),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### 2.4 Таблица `subscription_payments` (Реестр Оплат / QR Имитация)

```sql
CREATE TABLE subscription_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL,
  payment_method TEXT DEFAULT 'qr_mbank', -- qr_mbank, qr_optima, manual_admin
  status TEXT CHECK (status IN ('pending', 'completed', 'failed')) DEFAULT 'completed',
  is_mock BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_sub_payments_company ON subscription_payments(company_id);
```

### 2.5 Таблица `company_partnerships` (Заявки на Партнерство Сейти КР)

```sql
CREATE TABLE company_partnerships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_company_id UUID REFERENCES companies(id) ON DELETE CASCADE NOT NULL,
  target_company_id UUID REFERENCES companies(id) ON DELETE CASCADE NOT NULL,
  status TEXT CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (requester_company_id, target_company_id)
);

CREATE INDEX idx_partnerships_requester ON company_partnerships(requester_company_id);
CREATE INDEX idx_partnerships_target ON company_partnerships(target_company_id);
```

### 2.6 Таблица `counterparties` (Справочник Контрагентов & Привязка Компаний)

```sql
CREATE TABLE counterparties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE NOT NULL,
  target_company_id UUID REFERENCES companies(id) ON DELETE SET NULL, -- Связь с зарегистрированной компанией
  name TEXT NOT NULL,
  inn VARCHAR(14) NOT NULL,
  is_vat_payer BOOLEAN DEFAULT FALSE, -- Плательщик НДС (12%)
  phone VARCHAR(20),
  email TEXT,
  comment TEXT, -- Внутреннее примечание компании
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (company_id, inn)
);

CREATE INDEX idx_counterparties_company ON counterparties(company_id);
CREATE INDEX idx_counterparties_inn ON counterparties(company_id, inn);
CREATE INDEX idx_counterparties_target ON counterparties(target_company_id);
```

### 2.7 Таблица `file_categories` (Справочник Категорий Сканов)

```sql
CREATE TABLE file_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT UNIQUE, -- Символьный код (например: statute_docs, realization_scans)
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### 2.8 Таблица `documents` (Реестр Первичных B2B Документов)

```sql
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE NOT NULL,
  author_id UUID REFERENCES users(id) ON DELETE SET NULL NOT NULL,
  sender_company_id UUID REFERENCES companies(id) ON DELETE CASCADE NOT NULL,
  receiver_company_id UUID REFERENCES companies(id) ON DELETE CASCADE NOT NULL,
  doc_number VARCHAR(50),
  doc_date DATE DEFAULT CURRENT_DATE,
  doc_type TEXT CHECK (doc_type IN ('realization', 'purchase', 'payment', 'advance')) NOT NULL,
  status TEXT CHECK (status IN ('draft', 'sent', 'accepted', 'processed', 'cancelled')) DEFAULT 'draft',
  total_amount NUMERIC(12, 2) DEFAULT 0.00,
  comment TEXT,
  
  -- Сканы первички R2
  file_path_r2 TEXT,
  mock_file_name TEXT,
  mock_file_size TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_documents_company ON documents(company_id);
CREATE INDEX idx_documents_sender ON documents(sender_company_id);
CREATE INDEX idx_documents_receiver ON documents(receiver_company_id);
CREATE INDEX idx_documents_status ON documents(company_id, status);
```

### 2.9 Таблица `document_files` (Связаные Сканы и Уставные Документы R2)

```sql
CREATE TABLE document_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE NOT NULL,
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  category_id UUID REFERENCES file_categories(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  file_size TEXT,
  file_type TEXT DEFAULT 'pdf',
  file_path_r2 TEXT NOT NULL,
  description TEXT,
  comment TEXT,
  is_internal BOOLEAN DEFAULT FALSE,
  is_legal_doc BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_doc_files_company ON document_files(company_id);
CREATE INDEX idx_doc_files_document ON document_files(document_id);
```

### 2.10 Таблица `document_logs` (Журнал Аудита и Статусов)

```sql
CREATE TABLE document_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  old_status TEXT,
  new_status TEXT NOT NULL,
  comment TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_doc_logs_document ON document_logs(document_id);
```

---

## 3. ПОЛИТИКИ БЕЗОПАСНОСТИ ROW LEVEL SECURITY (RLS)

```sql
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_partnerships ENABLE ROW LEVEL SECURITY;
ALTER TABLE counterparties ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_logs ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION get_auth_user_company_id()
RETURNS UUID AS $$SELECT company_id FROM users WHERE id = auth.uid();$$ LANGUAGE sql STABLE SECURITY DEFINER;
```