# DATABASE.md — Схема базы данных, RLS и правила безопасности (PostgreSQL / Supabase)

Этот документ содержит полную физическую схему базы данных PostgreSQL (Supabase), описание таблиц, связей (Foreign Keys), индексов и правил безопасности на уровне строк (Row Level Security — RLS) для проекта Buhuchet.kg.

---

## 1. АРХИТЕКТУРА И ПРИНЦИПЫ ДАННЫХ

1. **Multi-Tenancy (Мультиарендность):** Каждая бизнес-таблица содержит поле `company_id` (UUID), ссылающееся на таблицу `companies`.
2. **Row Level Security (RLS):** Включен на всех таблицах. Прямой доступ без авторизации заблокирован. Пользователь получает доступ только к записям с `company_id`, совпадающим с его профилем.
3. **Изоляция Супер-админа:** Права суперадминистратора определяются через флаг `is_super_admin = true` в таблице `users` и переопределяют RLS при использовании клиентом `lib/supabase/admin.ts` (`SUPABASE_SERVICE_ROLE_KEY`).

---

## 2. ПОЛНАЯ СХЕМА ТАБЛИЦ (SQL DDL)

### 2.1 Таблица `companies` (Организации / Арендаторы)

```sql
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  inn VARCHAR(14) NOT NULL UNIQUE,
  address TEXT,
  phone VARCHAR(20),
  is_active BOOLEAN DEFAULT TRUE,
  storage_limit_gb INT4 DEFAULT 10,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_companies_inn ON companies(inn);
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

### 2.5 Таблица `counterparties` (Справочник Контрагентов)

```sql
CREATE TABLE counterparties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  inn VARCHAR(14) NOT NULL,
  is_vat_payer BOOLEAN DEFAULT FALSE, -- Плательщик НДС (12%)
  phone VARCHAR(20),
  comment TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_counterparties_company ON counterparties(company_id);
CREATE INDEX idx_counterparties_inn ON counterparties(company_id, inn);
```

### 2.6 Таблица `nomenclature` (Справочник Номенклатуры / Товаров)

```sql
CREATE TABLE nomenclature (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  code TEXT, -- Код 1С / Артикул
  unit TEXT DEFAULT 'шт',
  price NUMERIC(12, 2) DEFAULT 0.00,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_nomenclature_company ON nomenclature(company_id);
```

### 2.7 Таблица `documents` (Реестр Первичных Документов)

```sql
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE NOT NULL,
  author_id UUID REFERENCES users(id) ON DELETE SET NULL NOT NULL,
  counterparty_id UUID REFERENCES counterparties(id) ON DELETE SET NULL,
  doc_number VARCHAR(50),
  doc_date DATE DEFAULT CURRENT_DATE,
  doc_type TEXT CHECK (doc_type IN ('realization', 'purchase', 'payment', 'advance')) NOT NULL,
  status TEXT CHECK (status IN ('draft', 'review', 'approved', 'rejected', 'posted_1c')) DEFAULT 'draft',
  total_amount NUMERIC(12, 2) DEFAULT 0.00,
  comment TEXT,
  
  -- Поля файла (Имитация / Production Cloudflare R2)
  file_path_r2 TEXT,
  mock_file_name TEXT,
  mock_file_size TEXT,
  mock_file_status TEXT DEFAULT 'uploaded_mock',
  
  esf_status TEXT CHECK (esf_status IN ('not_checked', 'matched', 'mismatch')) DEFAULT 'not_checked',
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_documents_company ON documents(company_id);
CREATE INDEX idx_documents_status ON documents(company_id, status);
CREATE INDEX idx_documents_date ON documents(company_id, doc_date DESC);
```

### 2.8 Таблица `document_items` (Позиции Документа)

```sql
CREATE TABLE document_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE NOT NULL,
  nomenclature_id UUID REFERENCES nomenclature(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  quantity NUMERIC(10, 3) DEFAULT 1.000,
  price NUMERIC(12, 2) DEFAULT 0.00,
  total NUMERIC(12, 2) DEFAULT 0.00,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_doc_items_document ON document_items(document_id);
```

### 2.9 Таблица `document_logs` (Журнал Аудита и Статусов)

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
ALTER TABLE counterparties ENABLE ROW LEVEL SECURITY;
ALTER TABLE nomenclature ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_logs ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION get_auth_user_company_id()
RETURNS UUID AS $$SELECT company_id FROM users WHERE id = auth.uid();$$ LANGUAGE sql STABLE SECURITY DEFINER;
```