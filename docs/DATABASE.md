# 📚 Полная Спецификация Базы Данных Buhuchet.kg (PostgreSQL / Supabase)

Документ является официальным стандартом и технической спецификацией структуры данных fullstack-платформы **Buhuchet.kg** (PostgreSQL в инфраструктуре Supabase).

---

## 🛠️ 1. Архитектурный Обзор и Принципы Проектирования

1. **Многоарендность (Multi-Tenancy)**: Изоляция данных на уровне организаций достигается путем использования обязательного столбца `company_id` (или связывающей таблицы `file_owners`) и политик **Row Level Security (RLS)**.
2. **Мемоизация контекста авторизации**: Для высокой производительности во всех RLS-политиках вызов `auth.uid()` обернут в `(SELECT auth.uid())`, исключая повторное выполнение функций безопасности на каждую строку PostgreSQL.
3. **Безопасность Copy-on-Write (CoW)**: Общий доступ к сканам и документам реализуется через промежуточную таблицу `file_owners`. При изменении или замене скана одной из компаний автоматически создается независимый физический дубликат, не затрагивающий версии других совладельцев.
4. **Аппаратная блокировка закрытых периодов**: Триггер `check_closed_period_lock()` блокирует любые операции `INSERT`, `UPDATE`, `DELETE` в таблицах `documents` и `files` для пользователей без ролей `owner` или `is_super_admin`, если дата документа входит в закрытый отчетный месяц.
5. **Специфика Кыргызстана (КР)**: Валидация ИНН (строго 14 цифр), учет плательщиков НДС (12%), расчеты в сомах (KGS), хранение сканов уставных документов.

---

## 🗄️ 2. Подробный Реестр Таблиц, Полей и Связей

Ниже описана каждая из **19 таблиц** базы данных с указанием её назначения, связей и подробного описания всех столбцов.

---

### 2.1 Таблица `companies` — Организации (Юридические лица КР)

**Описание и Назначение**: Хранит профили всех зарегистрированных на платформе организаций и ИП Кыргызской Республики. Является главным тенантом (арендатором) платформы.

**Внешние связи**:
- Ссылаются: `users.company_id`, `documents.sender_company_id/receiver_company_id`, `files.company_id`, `file_owners.company_id`, `counterparties.company_id`, `company_roles.company_id`, `subscriptions.company_id`, `company_partnerships.requester_company_id/target_company_id`.

#### Поля и столбцы таблицы `companies`:

| Столбец | Тип данных | Ограничения / Default | Описание и Назначение | Связи / FK |
|---|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY`, `gen_random_uuid()` | Уникальный идентификатор компании | — |
| `name` | `TEXT` | `NOT NULL` | Наименование компании или имя ИП | — |
| `legal_form` | `VARCHAR(10)` | `NULL` | Организационно-правовая форма (`ИП`, `ОсОО`, `ЗАО`, `ОАО`, `КФХ`) | — |
| `inn` | `VARCHAR(14)` | `NOT NULL`, `UNIQUE` | ИНН организации (строго 14 цифр в КР) | — |
| `industry` | `TEXT` | `NULL` | Отрасль деятельности (Горнодобывающая, Ритейл, Строительство и т.д.) | — |
| `status` | `VARCHAR(30)` | `DEFAULT 'pending_approval'` | Статус модерации (`pending_approval`, `requires_changes`, `active`, `blocked`) | — |
| `moderation_comment` | `TEXT` | `NULL` | Примечания суперадминистратора при модерации/отклонении | — |
| `legal_address` | `TEXT` | `NULL` | Официальный юридический адрес по документам | — |
| `director_name` | `TEXT` | `NULL` | ФИО Генерального директора / Руководителя | — |
| `email` | `TEXT` | `NULL` | Корпоративный E-mail компании | — |
| `phone` | `TEXT` | `NULL` | Контактный телефон компании | — |
| `address` | `TEXT` | `NULL` | Фактический адрес расположения/офиса | — |
| `privacy_settings` | `JSONB` | `DEFAULT '{"show_phone": true, ...}'` | Настройки видимости контактов в каталоге для партнеров | — |
| `okpo` | `VARCHAR(20)` | `NULL` | Код ОКПО (Общереспубликанский классификатор предприятий и организаций) | — |
| `checking_account` | `VARCHAR(34)` | `NULL` | Расчетный счет в банке КР (IBAN/20-значный) | — |
| `bic` | `VARCHAR(9)` | `NULL` | БИК коммерческого банка Кыргызстана (6 или 9 цифр) | — |
| `bank_name` | `TEXT` | `NULL` | Наименование банка обслуживания | — |
| `corr_account` | `VARCHAR(34)` | `NULL` | Корреспондентский счет банка | — |
| `currency` | `VARCHAR(3)` | `DEFAULT 'KGS'` | Валюта ведения учета (`KGS`, `USD`, `RUB`) | — |
| `is_active` | `BOOLEAN` | `DEFAULT TRUE` | Флаг активности аккаунта компании | — |
| `storage_limit_gb` | `INTEGER` | `DEFAULT 10` | Выделенный лимит облачного диска в Гигабайтах | — |
| `closed_period_until` | `DATE` | `NULL` | Порог закрытого периода (все операции до даты заблокированы) | — |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Дата и время создания записи | — |
| `updated_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Дата и время последнего обновления профиля | — |

```sql
CREATE TABLE public.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  legal_form VARCHAR(10),
  inn VARCHAR(14) NOT NULL UNIQUE,
  industry TEXT,
  status VARCHAR(30) DEFAULT 'pending_approval',
  moderation_comment TEXT,
  legal_address TEXT,
  director_name TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  privacy_settings JSONB DEFAULT '{"show_phone": true, "show_email": true, "show_address": true}'::jsonb,
  okpo VARCHAR(20),
  checking_account VARCHAR(34),
  bic VARCHAR(9),
  bank_name TEXT,
  corr_account VARCHAR(34),
  currency VARCHAR(3) DEFAULT 'KGS',
  is_active BOOLEAN DEFAULT TRUE,
  storage_limit_gb INTEGER DEFAULT 10,
  closed_period_until DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_companies_inn ON public.companies(inn);
CREATE INDEX idx_companies_status ON public.companies(status);
```

---

### 2.2 Таблица `users` — Пользователи и Профили Сотрудников

**Описание и Назначение**: Хранит профили сотрудников организации, их роли, должности и флаги авторизации. Связана 1-к-1 с аутентификацией `auth.users` Supabase.

**Внешние связи**:
- `id` ➔ `auth.users.id` (ON DELETE CASCADE)
- `company_id` ➔ `companies.id` (ON DELETE SET NULL)
- `role_id` ➔ `company_roles.id` (ON DELETE SET NULL)

#### Поля и столбцы таблицы `users`:

| Столбец | Тип данных | Ограничения / Default | Описание и Назначение | Связи / FK |
|---|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY` | Идентификатор пользователя (совпадает с Supabase Auth ID) | `auth.users.id` |
| `company_id` | `UUID` | `NULL` | Ссылка на привязанную организацию | `companies.id` |
| `full_name` | `TEXT` | `NOT NULL` | Полное имя сотрудника (ФИО) | — |
| `email` | `TEXT` | `NOT NULL` | Электронная почта для входа и уведомлений | — |
| `phone` | `TEXT` | `NULL` | Контактный номер телефона сотрудника | — |
| `role` | `VARCHAR(20)` | `DEFAULT 'manager'` | Системная базовая роль (`owner`, `accountant`, `manager`) | — |
| `role_id` | `UUID` | `NULL` | Ссылка на гранулярную кастомную RBAC роль компании | `company_roles.id` |
| `position` | `TEXT` | `NULL` | Занимаемая должность (напр., "Старший бухгалтер") | — |
| `is_active` | `BOOLEAN` | `DEFAULT TRUE` | Доступ к системе (активен/деактивирован) | — |
| `must_change_password` | `BOOLEAN` | `DEFAULT FALSE` | Флаг принудительной смены пароля при следующем входе | — |
| `is_super_admin` | `BOOLEAN` | `DEFAULT FALSE` | Глобальный статус Суперадминистратора платформы | — |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Дата регистрации пользователя | — |
| `updated_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Дата последнего изменения профиля | — |

```sql
CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  role VARCHAR(20) DEFAULT 'manager',
  role_id UUID REFERENCES public.company_roles(id) ON DELETE SET NULL,
  position TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  must_change_password BOOLEAN DEFAULT FALSE,
  is_super_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_company ON public.users(company_id);
CREATE INDEX idx_users_role ON public.users(role_id);
```

---

### 2.3 Таблица `company_roles` — Роли и Права Доступа (RBAC)

**Описание и Назначение**: Хранит настроенные роли компании (как стандартные "Владелец", "Бухгалтер", "Менеджер", так и кастомные) и матрицу JSONB-прав доступа к модулям.

**Внешние связи**:
- `company_id` ➔ `companies.id` (ON DELETE CASCADE)

#### Поля и столбцы таблицы `company_roles`:

| Столбец | Тип данных | Ограничения / Default | Описание и Назначение | Связи / FK |
|---|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY`, `gen_random_uuid()` | Уникальный идентификатор роли | — |
| `company_id` | `UUID` | `NOT NULL` | Ссылка на владельца роли — компанию | `companies.id` |
| `name` | `TEXT` | `NOT NULL` | Название роли (напр., "Оператор первичной документации") | — |
| `description` | `TEXT` | `NULL` | Описание области ответственности роли | — |
| `is_system` | `BOOLEAN` | `DEFAULT FALSE` | Системная встроенная роль (запрещена к удалению) | — |
| `permissions` | `JSONB` | `NOT NULL`, `DEFAULT '{}'` | Объект гранулярных разрешений по модулям | — |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Дата создания роли | — |
| `updated_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Дата обновления прав | — |

```sql
CREATE TABLE public.company_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_system BOOLEAN DEFAULT FALSE,
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_company_roles_company ON public.company_roles(company_id);
```

---

### 2.4 Таблица `company_partnerships` — Партнерства и Связи Организаций

**Описание и Назначение**: Реестр деловых связей между организациями для авторизованного электронного документооборота.

**Внешние связи**:
- `requester_company_id` ➔ `companies.id` (ON DELETE CASCADE)
- `target_company_id` ➔ `companies.id` (ON DELETE CASCADE)

#### Поля и столбцы таблицы `company_partnerships`:

| Столбец | Тип данных | Ограничения / Default | Описание и Назначение | Связи / FK |
|---|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY`, `gen_random_uuid()` | Идентификатор записи партнерства | — |
| `requester_company_id` | `UUID` | `NOT NULL` | Компания-инициатор запроса на партнерство | `companies.id` |
| `target_company_id` | `UUID` | `NOT NULL` | Целевая компания-адресат запроса | `companies.id` |
| `status` | `VARCHAR(20)` | `DEFAULT 'pending'` | Статус запроса (`pending`, `approved`, `rejected`, `cancelled`, `suspended`) | — |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Дата отправки запроса | — |
| `updated_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Дата изменения статуса | — |

```sql
CREATE TABLE public.company_partnerships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  target_company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_partnership UNIQUE(requester_company_id, target_company_id)
);

CREATE INDEX idx_partnerships_requester ON public.company_partnerships(requester_company_id);
CREATE INDEX idx_partnerships_target ON public.company_partnerships(target_company_id);
```

---

### 2.5 Таблица `counterparties` — Контрагенты

**Описание и Назначение**: Справочник сторонних контрагентов компании (поставщиков и покупателей), созданных вручную или подтянутых из партнерств.

**Внешние связи**:
- `company_id` ➔ `companies.id` (ON DELETE CASCADE)
- `target_company_id` ➔ `companies.id` (ON DELETE SET NULL)

#### Поля и столбцы таблицы `counterparties`:

| Столбец | Тип данных | Ограничения / Default | Описание и Назначение | Связи / FK |
|---|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY`, `gen_random_uuid()` | Идентификатор записи контрагента | — |
| `company_id` | `UUID` | `NOT NULL` | Владелец справочника — компания | `companies.id` |
| `target_company_id` | `UUID` | `NULL` | Связь с зарегистрированной в системе компанией (если есть) | `companies.id` |
| `name` | `TEXT` | `NOT NULL` | Наименование контрагента / ИП | — |
| `inn` | `VARCHAR(14)` | `NOT NULL` | ИНН контрагента (14 цифр) | — |
| `is_vat_payer` | `BOOLEAN` | `DEFAULT FALSE` | Признак плательщика НДС 12% | — |
| `phone` | `TEXT` | `NULL` | Телефон контрагента | — |
| `email` | `TEXT` | `NULL` | E-mail контрагента | — |
| `comment` | `TEXT` | `NULL` | Внутреннее примечание бухгалтера | — |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Дата внесения записи | — |
| `updated_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Дата обновления данных | — |

```sql
CREATE TABLE public.counterparties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  target_company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  inn VARCHAR(14) NOT NULL,
  is_vat_payer BOOLEAN DEFAULT FALSE,
  phone TEXT,
  email TEXT,
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_counterparties_company ON public.counterparties(company_id);
CREATE INDEX idx_counterparties_inn ON public.counterparties(inn);
```

---

### 2.6 Таблица `file_categories` — Категории Файлов

**Описание и Назначение**: Справочник категорий и типов документов (накладные, акты, уставные документы, договоры).

#### Поля и столбцы таблицы `file_categories`:

| Столбец | Тип данных | Ограничения / Default | Описание и Назначение | Связи / FK |
|---|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY`, `gen_random_uuid()` | Идентификатор категории | — |
| `name` | `TEXT` | `NOT NULL` | Понятное имя категории ("Накладные", "Уставные") | — |
| `code` | `VARCHAR(50)` | `NULL`, `UNIQUE` | Уникальный системный код категории | — |
| `description` | `TEXT` | `NULL` | Описание назначения категории | — |
| `icon` | `VARCHAR(50)` | `NULL` | Имя иконки Lucide для интерфейса | — |
| `is_active` | `BOOLEAN` | `DEFAULT TRUE` | Доступность категории при загрузке | — |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Дата создания | — |

```sql
CREATE TABLE public.file_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code VARCHAR(50) UNIQUE,
  description TEXT,
  icon VARCHAR(50),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### 2.7 Таблица `documents` — Реестр Документов (Первичка ЭДО)

**Описание и Назначение**: Центральная таблица документов первичного учета (накладные реализации, поступления, акты сверки).

**Внешние связи**:
- `company_id` ➔ `companies.id` (ON DELETE CASCADE)
- `sender_company_id` ➔ `companies.id` (ON DELETE SET NULL)
- `receiver_company_id` ➔ `companies.id` (ON DELETE SET NULL)
- `author_id` ➔ `users.id` (ON DELETE SET NULL)
- `counterparty_id` ➔ `counterparties.id` (ON DELETE SET NULL)

#### Поля и столбцы таблицы `documents`:

| Столбец | Тип данных | Ограничения / Default | Описание и Назначение | Связи / FK |
|---|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY`, `gen_random_uuid()` | Идентификатор документа | — |
| `company_id` | `UUID` | `NOT NULL` | Компания-владелец записи | `companies.id` |
| `author_id` | `UUID` | `NULL` | Автор создания документа (сотрудник) | `users.id` |
| `sender_company_id` | `UUID` | `NULL` | Организация-отправитель | `companies.id` |
| `receiver_company_id` | `UUID` | `NULL` | Организация-получатель | `companies.id` |
| `counterparty_id` | `UUID` | `NULL` | Ссылка на контрагента из справочника | `counterparties.id` |
| `doc_number` | `VARCHAR(50)` | `NOT NULL` | Номер первичного документа (напр. "ТН-1024") | — |
| `doc_date` | `DATE` | `NOT NULL` | Дата составления документа | — |
| `doc_type` | `VARCHAR(30)` | `NOT NULL` | Тип (`realization`, `purchase`, `payment`, `advance`) | — |
| `status` | `VARCHAR(20)` | `DEFAULT 'draft'` | Статус (`draft`, `sent`, `accepted`, `processed`, `cancelled`, `recalled`) | — |
| `total_amount` | `NUMERIC(15,2)` | `DEFAULT 0.00` | Итоговая сумма документа в сомах (KGS) | — |
| `comment` | `TEXT` | `NULL` | Комментарий или примечание | — |
| `mock_file_name` | `TEXT` | `NULL` | Имя прикрепленного скана по умолчанию | — |
| `mock_file_size` | `BIGINT` | `NULL` | Размер прикрепленного файла в байтах | — |
| `esf_status` | `VARCHAR(20)` | `DEFAULT 'not_checked'` | Статус ЭСФ (`not_checked`, `matched`, `mismatch`) | — |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Дата создания документа в системе | — |
| `updated_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Дата последнего редактирования | — |

```sql
CREATE TABLE public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  author_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  sender_company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  receiver_company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  counterparty_id UUID REFERENCES public.counterparties(id) ON DELETE SET NULL,
  doc_number VARCHAR(50) NOT NULL,
  doc_date DATE NOT NULL,
  doc_type VARCHAR(30) NOT NULL,
  status VARCHAR(20) DEFAULT 'draft',
  total_amount NUMERIC(15,2) DEFAULT 0.00,
  comment TEXT,
  mock_file_name TEXT,
  mock_file_size BIGINT,
  esf_status VARCHAR(20) DEFAULT 'not_checked',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_documents_company ON public.documents(company_id);
CREATE INDEX idx_documents_sender ON public.documents(sender_company_id);
CREATE INDEX idx_documents_receiver ON public.documents(receiver_company_id);
CREATE INDEX idx_documents_status ON public.documents(company_id, status);
CREATE INDEX idx_documents_doc_date ON public.documents(company_id, doc_date DESC);
```

---

### 2.8 Таблица `files` — Прикрепленные Файлы и Сканы

**Описание и Назначение**: Реестр физических файлов и сканов, загруженных на Облачный диск (Cloudflare R2).

**Внешние связи**:
- `company_id` ➔ `companies.id` (ON DELETE CASCADE)
- `document_id` ➔ `documents.id` (ON DELETE CASCADE)
- `category_id` ➔ `file_categories.id` (ON DELETE SET NULL)

#### Поля и столбцы таблицы `files`:

| Столбец | Тип данных | Ограничения / Default | Описание и Назначение | Связи / FK |
|---|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY`, `gen_random_uuid()` | Идентификатор файла | — |
| `company_id` | `UUID` | `NOT NULL` | Исходная компания-загрузчик файла | `companies.id` |
| `document_id` | `UUID` | `NULL` | Привязанный первичный документ (если есть) | `documents.id` |
| `category_id` | `UUID` | `NULL` | Категория файла | `file_categories.id` |
| `file_name` | `TEXT` | `NOT NULL` | Исходное название файла | — |
| `size_bytes` | `BIGINT` | `DEFAULT 0` | Размер файла в байтах (BIGINT) | — |
| `file_type` | `VARCHAR(50)` | `DEFAULT 'pdf'` | Формат/расширение (`pdf`, `image`, `txt`, `csv`) | — |
| `file_path_r2` | `TEXT` | `NOT NULL` | Путь/Ключ объекта на облачном диске | — |
| `description` | `TEXT` | `NULL` | Описание содержимого | — |
| `comment` | `TEXT` | `NULL` | Внутреннее примечание | — |
| `is_internal` | `BOOLEAN` | `DEFAULT FALSE` | Флаг внутреннего документа компании | — |
| `is_legal_doc` | `BOOLEAN` | `DEFAULT FALSE` | Флаг уставного/юридического документа | — |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Дата загрузки | — |

```sql
CREATE TABLE public.files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE,
  category_id UUID REFERENCES public.file_categories(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  size_bytes BIGINT DEFAULT 0,
  file_type VARCHAR(50) DEFAULT 'pdf',
  file_path_r2 TEXT NOT NULL,
  description TEXT,
  comment TEXT,
  is_internal BOOLEAN DEFAULT FALSE,
  is_legal_doc BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_files_company ON public.files(company_id);
CREATE INDEX idx_files_document ON public.files(document_id);
```

---

### 2.9 Таблица `file_owners` — Совладельцы Файлов (Copy-on-Write)

**Описание и Назначение**: Таблица связей общего доступа к сканам. Позволяет нескольким организациям использовать один скан до момента редактирования (Copy-on-Write).

**Внешние связи**:
- `file_id` ➔ `files.id` (ON DELETE CASCADE)
- `company_id` ➔ `companies.id` (ON DELETE CASCADE)

#### Поля и столбцы таблицы `file_owners`:

| Столбец | Тип данных | Ограничения / Default | Описание и Назначение | Связи / FK |
|---|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY`, `gen_random_uuid()` | Идентификатор связи владения | — |
| `file_id` | `UUID` | `NOT NULL` | Ссылка на файл | `files.id` |
| `company_id` | `UUID` | `NOT NULL` | Ссылка на совладельца — компанию | `companies.id` |
| `is_original_creator` | `BOOLEAN` | `DEFAULT FALSE` | Флаг первоначального создателя/загрузчика | — |
| `added_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Дата предоставления доступа | — |

```sql
CREATE TABLE public.file_owners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id UUID NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  is_original_creator BOOLEAN DEFAULT FALSE,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_file_owner UNIQUE(file_id, company_id)
);

CREATE INDEX idx_file_owners_company ON public.file_owners(company_id);
CREATE INDEX idx_file_owners_file ON public.file_owners(file_id);
```

---

### 2.10 Таблица `document_items` — Товарные Позиции Документа

**Описание и Назначение**: Табличная часть накладных и актов (перечень товаров/услуг, количество, цена, сумма).

**Внешние связи**:
- `document_id` ➔ `documents.id` (ON DELETE CASCADE)

#### Поля и столбцы таблицы `document_items`:

| Столбец | Тип данных | Ограничения / Default | Описание и Назначение | Связи / FK |
|---|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY`, `gen_random_uuid()` | Идентификатор товарной строки | — |
| `document_id` | `UUID` | `NOT NULL` | Ссылка на родительский документ | `documents.id` |
| `title` | `TEXT` | `NOT NULL` | Наименование товара или услуги | — |
| `quantity` | `NUMERIC(15,3)` | `DEFAULT 1.000` | Количество товара/объем услуг | — |
| `price` | `NUMERIC(15,2)` | `DEFAULT 0.00` | Цена за единицу в сомах (KGS) | — |
| `total` | `NUMERIC(15,2)` | `DEFAULT 0.00` | Итоговая сумма строки (`quantity * price`) | — |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Дата добавления строки | — |

```sql
CREATE TABLE public.document_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  quantity NUMERIC(15,3) DEFAULT 1.000,
  price NUMERIC(15,2) DEFAULT 0.00,
  total NUMERIC(15,2) DEFAULT 0.00,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_document_items_doc ON public.document_items(document_id);
```

---

### 2.11 Таблица `document_logs` — Журнал Аудита и Статусов Документов

**Описание и Назначение**: Лог всех изменений статусов и согласований документов в ЭДО.

**Внешние связи**:
- `document_id` ➔ `documents.id` (ON DELETE CASCADE)
- `user_id` ➔ `users.id` (ON DELETE SET NULL)

#### Поля и столбцы таблицы `document_logs`:

| Столбец | Тип данных | Ограничения / Default | Описание и Назначение | Связи / FK |
|---|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY`, `gen_random_uuid()` | Идентификатор лог-записи | — |
| `document_id` | `UUID` | `NOT NULL` | Ссылка на документ | `documents.id` |
| `user_id` | `UUID` | `NULL` | Исполнитель действия (пользователь) | `users.id` |
| `old_status` | `VARCHAR(20)` | `NULL` | Статус документа до изменения | — |
| `new_status` | `VARCHAR(20)` | `NOT NULL` | Новый установленный статус | — |
| `comment` | `TEXT` | `NULL` | Причина отклонения или отзыв | — |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Дата и время действия | — |

```sql
CREATE TABLE public.document_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  old_status VARCHAR(20),
  new_status VARCHAR(20) NOT NULL,
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_document_logs_doc ON public.document_logs(document_id);
```

---

### 2.12 Таблица `company_closed_periods` — Закрытые Отчетные Периоды

**Описание и Назначение**: Журнал помесячного закрытия отчетности бухгалтерией организации.

**Внешние связи**:
- `company_id` ➔ `companies.id` (ON DELETE CASCADE)

#### Поля и столбцы таблицы `company_closed_periods`:

| Столбец | Тип данных | Ограничения / Default | Описание и Назначение | Связи / FK |
|---|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY`, `gen_random_uuid()` | Идентификатор записи закрытия | — |
| `company_id` | `UUID` | `NOT NULL` | Организация | `companies.id` |
| `year` | `INTEGER` | `NOT NULL`, `BETWEEN 2000 AND 2100` | Отчетный год (напр. 2026) | — |
| `month` | `INTEGER` | `NOT NULL`, `BETWEEN 1 AND 12` | Отчетный месяц (1-12) | — |
| `lock_documents` | `BOOLEAN` | `NOT NULL DEFAULT TRUE` | Блокировка первички по `doc_date` | — |
| `lock_files` | `BOOLEAN` | `NOT NULL DEFAULT TRUE` | Блокировка файлов по `created_at` | — |
| `status` | `VARCHAR(20)` | `DEFAULT 'closed'` | Статус периода (`closed`, `partial`, `open`) | — |
| `reason` | `TEXT` | `NULL` | Причина / комментарий закрытия | — |
| `closed_by` | `UUID` | `NULL` | Пользователь, установивший замок | `auth.users(id)` |
| `closed_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Дата фиксации закрытия | — |

```sql
CREATE TABLE public.company_closed_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  year INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  lock_documents BOOLEAN NOT NULL DEFAULT TRUE,
  lock_files BOOLEAN NOT NULL DEFAULT TRUE,
  status VARCHAR(20) DEFAULT 'closed',
  reason TEXT,
  closed_by UUID REFERENCES auth.users(id),
  closed_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_company_period UNIQUE(company_id, year, month)
);

CREATE INDEX idx_closed_periods_company ON public.company_closed_periods(company_id, year, month);
```

---

### 2.13 Таблица `subscriptions` — Подписки и Тарифные Планы

**Описание и Назначение**: Тарифные подписки организаций на сервисы платформы.

**Внешние связи**:
- `company_id` ➔ `companies.id` (ON DELETE CASCADE)

#### Поля и столбцы таблицы `subscriptions`:

| Столбец | Тип данных | Ограничения / Default | Описание и Назначение | Связи / FK |
|---|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY`, `gen_random_uuid()` | Идентификатор подписки | — |
| `company_id` | `UUID` | `NOT NULL` | Компания | `companies.id` |
| `plan_type` | `VARCHAR(20)` | `DEFAULT 'standard'` | Тариф (`basic`, `standard`, `pro`) | — |
| `status` | `VARCHAR(20)` | `DEFAULT 'active'` | Статус (`active`, `expired`, `trial`) | — |
| `expires_at` | `TIMESTAMPTZ` | `NOT NULL` | Дата окончания подписки | — |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Дата подключения | — |
| `updated_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Дата про продления | — |

```sql
CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plan_type VARCHAR(20) DEFAULT 'standard',
  status VARCHAR(20) DEFAULT 'active',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_company ON public.subscriptions(company_id);
```

---

### 2.14 Таблица `subscription_payments` — История Платежей за Сервис

**Описание и Назначение**: Реестр финансовых транзакций по оплате подписок (через MBANK / Optima QR).

**Внешние связи**:
- `subscription_id` ➔ `subscriptions.id` (ON DELETE CASCADE)
- `company_id` ➔ `companies.id` (ON DELETE CASCADE)

#### Поля и столбцы таблицы `subscription_payments`:

| Столбец | Тип данных | Ограничения / Default | Описание и Назначение | Связи / FK |
|---|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY`, `gen_random_uuid()` | Идентификатор платежа | — |
| `subscription_id` | `UUID` | `NOT NULL` | Оплаченная подписка | `subscriptions.id` |
| `company_id` | `UUID` | `NOT NULL` | Оплатившая организация | `companies.id` |
| `amount` | `NUMERIC(15,2)` | `NOT NULL` | Сумма платежа в сомах | — |
| `payment_method` | `VARCHAR(30)` | `NOT NULL` | Метод оплаты (`qr_mbank`, `qr_optima`, `manual_admin`) | — |
| `transaction_id` | `TEXT` | `NULL` | Номер транзакции платежной системы | — |
| `status` | `VARCHAR(20)` | `DEFAULT 'completed'` | Статус платежа | — |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Дата транзакции | — |

```sql
CREATE TABLE public.subscription_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  amount NUMERIC(15,2) NOT NULL,
  payment_method VARCHAR(30) NOT NULL,
  transaction_id TEXT,
  status VARCHAR(20) DEFAULT 'completed',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### 2.15 Таблица `telegram_connections` — Привязанные Telegram Аккаунты

**Описание и Назначение**: Связь пользователей платформы с их Telegram Chat ID для отправки быстрых уведомлений.

**Внешние связи**:
- `user_id` ➔ `users.id` (ON DELETE CASCADE)
- `company_id` ➔ `companies.id` (ON DELETE CASCADE)

#### Поля и столбцы таблицы `telegram_connections`:

| Столбец | Тип данных | Ограничения / Default | Описание и Назначение | Связи / FK |
|---|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY`, `gen_random_uuid()` | Идентификатор привязки | — |
| `user_id` | `UUID` | `NOT NULL` | Пользователь | `users.id` |
| `company_id` | `UUID` | `NOT NULL` | Компания | `companies.id` |
| `telegram_chat_id` | `BIGINT` | `NOT NULL` | Уникальный Chat ID в Telegram | — |
| `telegram_user_id` | `BIGINT` | `NULL` | Telegram User ID | — |
| `telegram_username` | `TEXT` | `NULL` | Никнейм в Telegram (напр., `@accountant_kg`) | — |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Дата привязки | — |

```sql
CREATE TABLE public.telegram_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  telegram_chat_id BIGINT NOT NULL,
  telegram_user_id BIGINT,
  telegram_username TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_telegram_connections_user ON public.telegram_connections(user_id);
```

---

### 2.16 Таблица `telegram_verification_codes` — Коды Подтверждения Telegram

**Описание и Назначение**: Одноразовые 4-значные цифровые коды верификации для безопасного связывания профиля с Telegram ботом.

**Внешние связи**:
- `user_id` ➔ `users.id` (ON DELETE CASCADE)
- `company_id` ➔ `companies.id` (ON DELETE CASCADE)

#### Поля и столбцы таблицы `telegram_verification_codes`:

| Столбец | Тип данных | Ограничения / Default | Описание и Назначение | Связи / FK |
|---|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY`, `gen_random_uuid()` | Идентификатор кода | — |
| `user_id` | `UUID` | `NOT NULL` | Ссылка на пользователя | `users.id` |
| `company_id` | `UUID` | `NOT NULL` | Ссылка на компанию | `companies.id` |
| `code` | `VARCHAR(4)` | `NOT NULL` | Одноразовый 4-значный код (напр., "8492") | — |
| `expires_at` | `TIMESTAMPTZ` | `NOT NULL` | Время истечения кода (15 минут) | — |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Время создания | — |

```sql
CREATE TABLE public.telegram_verification_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code VARCHAR(4) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_pending_verification UNIQUE (user_id, company_id)
);
```

---

### 2.17 Таблица `telegram_logs` — Журнал Telegram Уведомлений

**Описание и Назначение**: Лог всех исходящих системных сообщений, доставленных через Telegram Webhook.

#### Поля и столбцы таблицы `telegram_logs`:

| Столбец | Тип данных | Ограничения / Default | Описание и Назначение | Связи / FK |
|---|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY`, `gen_random_uuid()` | Идентификатор записи | — |
| `chat_id` | `BIGINT` | `NULL` | ID чата получателя | — |
| `username` | `TEXT` | `NULL` | Никнейм получателя | — |
| `message_text` | `TEXT` | `NULL` | Текст отправленного сообщения | — |
| `status` | `VARCHAR(20)` | `NULL` | Статус доставки (`sent`, `failed`) | — |
| `error_message` | `TEXT` | `NULL` | Текст ошибки API Telegram при сбое | — |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Время отправки | — |

```sql
CREATE TABLE public.telegram_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id BIGINT,
  username TEXT,
  message_text TEXT,
  status VARCHAR(20),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### 2.18 Таблица `pending_file_deletions` — Очередь Физического Удаления Файлов R2

**Описание и Назначение**: Буферная очередь необработанных ключей Cloudflare R2, подлежащих физическому списанию/удалению при срабатывании триггера `enqueue_deleted_file()`.

#### Поля и столбцы таблицы `pending_file_deletions`:

| Столбец | Тип данных | Ограничения / Default | Описание и Назначение | Связи / FK |
|---|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY`, `gen_random_uuid()` | Идентификатор записи очереди | — |
| `storage_key` | `TEXT` | `NOT NULL` | Ключ пути к файлу на облачном диске | — |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Дата добавления в очередь | — |

```sql
CREATE TABLE public.pending_file_deletions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_key TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pending_file_deletions_created ON public.pending_file_deletions(created_at);
```

---

### 2.19 Таблица `company_join_requests` — Заявки Сотрудников на Вступление в Организацию

**Описание и Назначение**: Хранит входящие заявки пользователей, выбравших конкретную компанию КР при регистрации или из личного кабинета гостя (`/dashboard/pending`). Обеспечивает разделение потока регистрации на владельцев и сотрудников с последующим утверждением роли и должности владельцем организации.

**Внешние связи**:
- `company_id` ➔ `companies.id` (ON DELETE CASCADE)
- `user_id` ➔ `users.id` (ON DELETE CASCADE)
- `reviewed_by` ➔ `users.id` (ON DELETE SET NULL)

#### Поля и столбцы таблицы `company_join_requests`:

| Столбец | Тип данных | Ограничения / Default | Описание и Назначение | Связи / FK |
|---|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY`, `gen_random_uuid()` | Уникальный идентификатор заявки | — |
| `company_id` | `UUID` | `NOT NULL` | Организация, в которую подана заявка | `companies.id` |
| `user_id` | `UUID` | `NOT NULL` | Пользователь/соискатель, подавший заявку | `users.id` |
| `position_note` | `TEXT` | `NULL` | Желаемая должность или сопроводительное примечание кандидата | — |
| `status` | `VARCHAR(30)` | `DEFAULT 'pending'`, `CHECK IN ('pending', 'approved', 'rejected', 'cancelled')` | Статус заявки | — |
| `reviewed_by` | `UUID` | `NULL` | Идентификатор владельца/админа, рассмотревшего заявку | `users.id` |
| `reviewed_at` | `TIMESTAMPTZ` | `NULL` | Дата и время рассмотрения заявки | — |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Время подачи заявки | — |
| `updated_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Время последнего обновления статуса | — |

```sql
CREATE TABLE public.company_join_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  position_note TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'pending' 
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Частичный уникальный индекс: только 1 активная заявка на компанию от пользователя
CREATE UNIQUE INDEX idx_join_requests_active_unique 
  ON public.company_join_requests(user_id, company_id) 
  WHERE status = 'pending';

CREATE INDEX idx_company_join_requests_company ON public.company_join_requests(company_id);
CREATE INDEX idx_company_join_requests_user ON public.company_join_requests(user_id);
CREATE INDEX idx_company_join_requests_status ON public.company_join_requests(status);
```

---

## ⚙️ 3. Хранимые Функции и Триггеры PostgreSQL

### 3.1 Замок Закрытых Отчетных Периодов `check_closed_period_lock()`
Срабатывает перед `INSERT`, `UPDATE`, `DELETE` на таблицах `documents` и `files`. Проверяет права текущего пользователя через мемоизированный `(SELECT auth.uid())`. Пользователи с ролями `owner` и `is_super_admin` пропускаются. Для остальных проверяется наличие записи в `company_closed_periods` или превышение порога `companies.closed_period_until`.

```sql
CREATE OR REPLACE FUNCTION public.check_closed_period_lock()
RETURNS TRIGGER AS $$
DECLARE
    v_user_role TEXT;
    v_is_super BOOLEAN;
    v_company_id UUID;
    v_target_date DATE;
    v_year INT;
    v_month INT;
    v_is_closed BOOLEAN := FALSE;
    v_closed_until DATE;
BEGIN
    SELECT role, COALESCE(is_super_admin, FALSE)
    INTO v_user_role, v_is_super
    FROM public.users
    WHERE id = (SELECT auth.uid());

    IF v_user_role = 'owner' OR v_is_super = TRUE THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        v_company_id := OLD.company_id;
        v_target_date := COALESCE(OLD.created_at::DATE, NOW()::DATE);
    ELSE
        v_company_id := NEW.company_id;
        v_target_date := COALESCE(NEW.created_at::DATE, NOW()::DATE);
    END IF;

    IF v_company_id IS NULL OR v_target_date IS NULL THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    v_year := EXTRACT(YEAR FROM v_target_date);
    v_month := EXTRACT(MONTH FROM v_target_date);

    SELECT EXISTS (
        SELECT 1 FROM public.company_closed_periods
        WHERE company_id = v_company_id AND year = v_year AND month = v_month AND status = 'closed'
    ) INTO v_is_closed;

    IF v_is_closed THEN
        RAISE EXCEPTION 'Отчетный период %-% закрыт. Операция заблокирована.', v_year, v_month;
    END IF;

    SELECT closed_period_until INTO v_closed_until
    FROM public.companies WHERE id = v_company_id;

    IF v_closed_until IS NOT NULL AND v_target_date <= v_closed_until THEN
        RAISE EXCEPTION 'Дата документа (%) входит в закрытый период до %. Операция запрещена.', v_target_date, v_closed_until;
    END IF;

    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

### 3.2 Авто-очистка Осиротевших Файлов `cleanup_orphaned_files()`
Срабатывает `AFTER DELETE` на таблице `file_owners`. Если у удаленного из `file_owners` файла не осталось ни одного совладельца — скан автоматически удаляется из основной таблицы `files`.

```sql
CREATE OR REPLACE FUNCTION public.cleanup_orphaned_files()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.file_owners WHERE file_id = OLD.file_id) THEN
    DELETE FROM public.files WHERE id = OLD.file_id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

### 3.4 Постановка Ключа R2 в Очередь `enqueue_deleted_file()`
Срабатывает `AFTER DELETE` на таблице `files`. При удалении записи из `public.files` берет значение `OLD.file_path_r2` и помещает в очередь `public.pending_file_deletions` для последующей обработки серверной функцией `processPendingFileDeletionsAction`.

```sql
CREATE OR REPLACE FUNCTION public.enqueue_deleted_file()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.file_path_r2 IS NOT NULL AND OLD.file_path_r2 <> '' THEN
    INSERT INTO public.pending_file_deletions (storage_key)
    VALUES (OLD.file_path_r2);
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

### 3.3 Инициализация Стандартных Системных Ролей `seed_default_company_roles(p_company_id)`
Автоматически создает 3 стандартные системные роли (Владелец, Бухгалтер, Менеджер) со всеми предустановленными JSONB разрешениями при успешной регистрации новой компании.

---

### 3.5 Безопасный Поиск Организаций Соискателями `search_companies_for_join(search_query)`
Выполняет безопасный полнотекстовый поиск активных организаций по ИНН (префиксное совпадение) или наименованию (ILIKE) для соискателей в процессе онбординга гостя без раскрытия конфиденциальных полей.

```sql
CREATE OR REPLACE FUNCTION public.search_companies_for_join(search_query TEXT)
RETURNS TABLE (
  id UUID,
  name TEXT,
  inn VARCHAR,
  legal_address TEXT,
  director_name TEXT,
  status VARCHAR
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT 
    c.id,
    c.name,
    c.inn,
    c.legal_address,
    c.director_name,
    c.status
  FROM public.companies c
  WHERE 
    c.status = 'active'
    AND (
      c.name ILIKE '%' || trim(search_query) || '%'
      OR c.inn ILIKE trim(search_query) || '%'
    )
  ORDER BY c.name ASC
  LIMIT 20;
$$;
```

---

## 📜 4. Полный Реестр Миграционных Скриптов (`supabase/migrations/`)

Все изменения схемы базы данных строго версионируются в папке `supabase/migrations/`. Ниже приведен полный список всех **27 примененных миграционных файлов**:

| Файл миграции | Дата / Время | Назначение и Ключевые Операции |
|---|---|---|
| `20260730130000_performance_indexes.sql` | 30.07.2026 13:00 | Создание первичных высокопроизводительных индексов для поиска по ИНН и компаниям |
| `20260730131500_missing_foreign_indexes.sql` | 30.07.2026 13:15 | Добавление недостающих индексов внешних ключей для таблиц документов и логов |
| `20260730214600_rename_files_and_drop_items.sql` | 30.07.2026 21:46 | Рефакторинг структуры хранения сканов R2 и устаревших таблиц |
| `20260730221200_employees_rbac_and_doc_users.sql` | 30.07.2026 22:12 | Внедрение полей ролевой модели RBAC сотрудникам (`position`, `role_id`) |
| `20260731080500_performance_optimization_indexes.sql` | 31.07.2026 08:05 | Добавление составных индексов по статусам документов и датам |
| `20260731083600_seed_default_company_roles.sql` | 31.07.2026 08:36 | Хранимая функция `seed_default_company_roles` для автосоздания RBAC ролей |
| `20260731094000_fix_duplicate_company_roles.sql` | 31.07.2026 09:40 | Дедупликация системных ролей и добавление `UNIQUE(company_id, name)` |
| `20260808000001_initial_schema.sql` | 08.08.2026 00:00 | Базовая схема таблиц `companies`, `users`, `documents`, `files` |
| `20260808000002_add_company_roles_rbac.sql` | 08.08.2026 00:00 | Привязка таблицы `company_roles` к пользователям через `role_id` |
| `20260808000003_company_users_status_and_position.sql` | 08.08.2026 00:00 | Расширение статусов сотрудников (`is_active`, `must_change_password`) |
| `20260808000004_fix_company_partnerships_status_check.sql` | 08.08.2026 00:00 | Расширение перечня допустимых статусов партнерств (`suspended`, `cancelled`) |
| `20260808000005_add_foreign_key_indexes.sql` | 08.08.2026 00:00 | Покрытие всех FK столбцов B-tree индексами |
| `20260808000006_sync_schema_with_frontend_types.sql` | 08.08.2026 00:00 | Синхронизация названий столбцов и типов данных с TypeScript |
| `20260808000007_company_closed_periods.sql` | 08.08.2026 00:00 | Создание таблицы `company_closed_periods` и столбца `closed_period_until` |
| `20260808000008_superadmin_approval_and_inspector.sql` | 08.08.2026 00:00 | Добавление столбца `moderation_comment` и флага `is_super_admin` |
| `20260808000009_rls_and_closed_period_triggers.sql` | 08.08.2026 00:00 | Создание триггера `check_closed_period_lock()` и RLS-политик |
| `20260809000010_optimize_rls_and_composite_indexes.sql` | 09.08.2026 00:00 | Добавление составных индексов `(company_id, status)` для быстрых фильтраций |
| `20260809000011_copy_on_write_file_owners.sql` | 09.08.2026 00:00 | Таблица `file_owners` и триггер `cleanup_orphaned_files` для Copy-on-Write |
| `20260809120000_optimize_rls_and_closed_periods.sql` | 09.08.2026 12:00 | Мемоизация `(SELECT auth.uid())` во всех RLS-политиках и замок периодов |
| `20260810000000_file_cleanup_queue.sql` | 10.08.2026 00:00 | Таблица `pending_file_deletions` и триггер `enqueue_deleted_file()` для асинхронного удаления сканов |
| `20260811000000_view_form_indexes.sql` | 11.08.2026 00:00 | Индексы ускорения выборок для форм просмотра и фильтрации первички |
| `20260812000000_optimize_documents_and_superadmin_rls.sql` | 12.08.2026 00:00 | Оптимизация прав суперадминистратора и документов в RLS |
| `20260815000000_sec01_security_definer_search_path.sql` | 15.08.2026 00:00 | Харденинг всех хранимых процедур SECURITY DEFINER с явным `search_path = public, pg_temp` |
| `20260815000001_data02_immutable_audit_log.sql` | 15.08.2026 00:00 | Неизменяемый журнал аудита `document_logs` и защита от модификаций |
| `20260815000002_arch01_atomic_document_creation.sql` | 15.08.2026 00:00 | Атомарное создание документов и привязка совладельцев |
| `20260815000003_employee_registration_and_join_requests.sql` | 15.08.2026 00:00 | Создание таблицы `company_join_requests`, RPC `search_companies_for_join`, RLS политик |
| `20260815120000_fix_join_requests_and_profile_rls.sql` | 15.08.2026 12:00 | Расширение RLS `companies` (поиск) и `users` (просмотр соискателей владельцами компаний) |
| `20260816000000_performance_core_fix.sql` | 16.08.2026 00:00 | Оптимизация RLS политик без correlated subqueries, составные B-Tree индексы, STABLE процедуры |
| `20260817000000_rbac_hardening_and_closed_periods.sql` | 17.08.2026 00:00 | Харденинг RBAC, защита роли Owner триггером, права на закрытые периоды и экспорт |
| `20260818000000_refactor_closed_periods_schema.sql` | 18.08.2026 00:00 | Рефакторинг закрытых периодов: `lock_documents`, `lock_files`, триггер по модулям |
| `20260818100000_fix_closed_periods_users_fk.sql` | 18.08.2026 10:00 | Исправление внешних ключей `closed_by` / `opened_by` на `public.users` для PostgREST |
| `20260818110000_fix_closed_periods_status_check.sql` | 18.08.2026 11:00 | Расширение CHECK-ограничения статусов с поддержкой статуса `partial` (частично закрыт) |
| `20260818200000_superadmin_hardening_and_atomicity.sql` | 18.08.2026 20:00 | Таблица `admin_audit_logs`, атомарная процедура `admin_approve_company_atomic`, `get_platform_summary_stats` |