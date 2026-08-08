# 🗄️ DATABASE_DOCUMENTATION.md — Полная Детальная Документация Схемы Базы Данных Buhuchet.kg

Данный документ содержит **исчерпывающее техническое и бизнес-описание** каждого элемента СУБД PostgreSQL (Supabase) платформы **Buhuchet.kg**. Включает детальный разбор назначения каждой таблицы, её колонок, типов данных, ограничений (constraints), внешних ключей (foreign keys), RLS-политик и функций.

---

## 📋 ОГЛАВЛЕНИЕ

1. [Архитектурные принципы и Стек Данных](#1-архитектурные-принципы-и-стек-данных)
2. [Детальное описание Таблиц и Колонок](#2-детальное-описание-таблиц-и-колонок)
   - [2.1 Таблица `companies` (Организации / Арендаторы)](#21-таблица-companies-организации--арендаторы)
   - [2.2 Таблица `company_roles` (Матрица Прав и Ролей RBAC)](#22-таблица-company_roles-матрица-прав-и-ролей-rbac)
   - [2.3 Таблица `users` (Профили Пользователей и Сотрудников)](#23-таблица-users-профили-пользователей-и-сотрудников)
   - [2.4 Таблица `subscriptions` (Тарифы и Статусы Подписок)](#24-таблица-subscriptions-тарифы-и-статусы-подписок)
   - [2.5 Таблица `subscription_payments` (Реестр Транзакций Оплаты)](#25-таблица-subscription_payments-реестр-транзакций-оплаты)
   - [2.6 Таблица `company_partnerships` (Партнерская Сеть Взаимодействия B2B)](#26-таблица-company_partnerships-партнерская-сеть-взаимодействия-b2b)
   - [2.7 Таблица `counterparties` (Справочник Контрагентов Организаций)](#27-таблица-counterparties-справочник-контрагентов-организаций)
   - [2.8 Таблица `file_categories` (Справочник Категорий Сканов Первички)](#28-таблица-file_categories-справочник-категорий-сканов-первички)
   - [2.9 Таблица `documents` (Реестр Первичных Документов B2B)](#29-таблица-documents-реестр-первичных-документов-b2b)
   - [2.10 Таблица `files` (Хранилище Сканов и Документов R2)](#210-таблица-files-хранилище-сканов-и-документов-r2)
   - [2.11 Таблица `document_logs` (Журнал Аудита Движения Документов)](#211-таблица-document_logs-журнал-аудита-движения-документов)
   - [2.12 Таблицы Интеграции с Telegram-Ботом](#212-таблицы-интеграции-с-telegram-ботом)
3. [Хранимые Процедуры и Функции RLS](#3-хранимые-процедуры-и-функции-rls)
4. [Политики Безопасности Row Level Security (RLS)](#4-политики-безопасности-row-level-security-rls)

---

## 1. АРХИТЕКТУРНЫЕ ПРИНЦИПЫ И СТЕК ДАННЫХ

1. **Мультиарендность (Multi-Tenancy Isolation):** Все бизнес-данные физически изолированы на уровне таблицы с помощью колонки `company_id UUID REFERENCES companies(id)`.
2. **Row Level Security (RLS):** Включен для 100% бизнес-таблиц. Пользователи видят и модифицируют данные строго в пределах своей организации.
3. **Обход RLS для Суперадминистратора:** Административные операции выполняются через `createAdminClient()` (Service Role Key) от имени изолированных серверных экшенов `/super-admin`.

---

## 2. ДЕТАЛЬНОЕ ОПИСАНИЕ ТАБЛИЦ И КОЛОНОК

---

### 2.1 Таблица `companies` (Организации / Арендаторы)

- **Бизнес-назначение:** Хранение профилей зарегистрированных юридических лиц и ИП Кыргызской Республики. Является главным тенантом платформы.
- **Использование:** Привязка всех первичных документов, сотрудников, файлов и лимитов хранилища.

| Название Колонки | Тип Данных | Ограничения | Описание и Назначение |
| --- | --- | --- | --- |
| `id` | `UUID` | `PRIMARY KEY`, `gen_random_uuid()` | Уникальный системный идентификатор компании. |
| `name` | `TEXT` | `NOT NULL` | Официальное наименование организации (например, *ОсОО «Азия Трейд»*). |
| `legal_form` | `TEXT` | `CHECK (IN ('ИП', 'ОсОО', 'ЗАО', 'ОАО', 'КФХ'))` | Организационно-правовая форма по законодательству КР. |
| `inn` | `VARCHAR(14)` | `NOT NULL`, `UNIQUE` | ИНН организации в Кыргызстане (строго 14 цифр). |
| `industry` | `TEXT` | `DEFAULT 'Услуги / Консалтинг'` | Отрасль деятельности для статистики. |
| `director_name` | `TEXT` | `NULLABLE` | ФИО Генерального Директора / Руководителя. |
| `email` | `TEXT` | `NULLABLE` | Корпоративный e-mail организации. |
| `phone` | `VARCHAR(20)` | `NULLABLE` | Контактный номер телефона (+996). |
| `legal_address` | `TEXT` | `NULLABLE` | Официальный юридический адрес регистрации. |
| `address` | `TEXT` | `NULLABLE` | Фактический адрес расположения офиса/склада. |
| `privacy_settings`| `JSONB` | `DEFAULT '{"show_phone": true, ...}'` | Настройки видимости контактов в сети B2B. |
| `is_active` | `BOOLEAN` | `DEFAULT TRUE` | Флаг активности аккаунта организации. |
| `status` | `TEXT` | `CHECK (IN ('pending_approval', 'requires_changes', 'active', 'blocked'))` | Статус модерации суперадминистратором. |
| `moderation_comment`| `TEXT` | `NULLABLE` | Замечания модератора при отправке на доработку. |
| `storage_limit_gb`| `INT4` | `DEFAULT 10` | Выделенный лимит облачного хранилища Cloudflare R2 в ГБ. |
| `closed_period_until`| `DATE` | `DEFAULT NULL` | Дата закрытого периода (запрет редактирования документов до даты). |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Дата и время первичной регистрации компании. |
| `updated_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Дата и время последнего обновления профиля. |

---

### 2.2 Таблица `company_roles` (Матрица Прав и Ролей RBAC)

- **Бизнес-назначение:** Настройка кастомных ролей и гибкой матрицы разрешений (RBAC) внутри каждой компании.
- **Использование:** Ограничение доступа сотрудников к конкретным модулям (ЭДО, сканы, экспорт в 1С).

| Название Колонки | Тип Данных | Ограничения | Описание и Назначение |
| --- | --- | --- | --- |
| `id` | `UUID` | `PRIMARY KEY`, `gen_random_uuid()` | Уникальный идентификатор роли. |
| `company_id` | `UUID` | `FOREIGN KEY (companies.id) ON DELETE CASCADE` | Ссылка на компанию-владельца данной роли. |
| `name` | `TEXT` | `NOT NULL` | Понятное наименование роли (*Главбух, Бухгалтер по первичке*). |
| `description` | `TEXT` | `NULLABLE` | Описание служебных обязанностей роли. |
| `is_system` | `BOOLEAN` | `DEFAULT FALSE` | Системная роль (нельзя удалить владельцем). |
| `permissions` | `JSONB` | `DEFAULT '{}'::jsonb` | Дерево разрешений по модулям (`documents.view`, `files.delete` и др.). |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Дата создания роли. |
| `updated_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Дата обновления прав роли. |

---

### 2.3 Таблица `users` (Профили Пользователей и Сотрудников)

- **Бизнес-назначение:** Хранение личных профилей физических лиц, привязанных к Supabase Auth.
- **Использование:** Авторизация, определение текущей компании, привязанной роли RBAC и должности.

| Название Колонки | Тип Данных | Ограничения | Описание и Назначение |
| --- | --- | --- | --- |
| `id` | `UUID` | `PRIMARY KEY (auth.users.id) ON DELETE CASCADE` | Идентификатор пользователя в Supabase Auth. |
| `company_id` | `UUID` | `FOREIGN KEY (companies.id) ON DELETE SET NULL` | Привязанная компания (NULL = заявка в процессе). |
| `role_id` | `UUID` | `FOREIGN KEY (company_roles.id) ON DELETE SET NULL` | Назначенная ролевая матрица RBAC (NULL = не утвержден). |
| `full_name` | `TEXT` | `NOT NULL` | ФИО сотрудника. |
| `email` | `TEXT` | `NOT NULL` | E-mail адрес (совпадает с аккаунтом входа). |
| `phone` | `VARCHAR(20)` | `NULLABLE` | Личный контактный телефон (+996). |
| `position` | `VARCHAR(100)` | `DEFAULT 'Сотрудник'` | Должность сотрудника в штатном расписании. |
| `role` | `TEXT` | `CHECK (IN ('owner', 'accountant', 'manager'))` | Категория аккаунта (`owner` — Владелец). |
| `is_super_admin` | `BOOLEAN` | `DEFAULT FALSE` | Флаг глобального Суперадминистратора платформы. |
| `is_active` | `BOOLEAN` | `DEFAULT TRUE` | Флаг активности учетной записи пользователя. |
| `must_change_password` | `BOOLEAN` | `DEFAULT FALSE` | Флаг принудительной смены пароля при следующем входе. |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Дата регистрации аккаунта. |
| `updated_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Дата последнего изменения профиля. |

---

### 2.4 Таблица `subscriptions` (Тарифы и Статусы Подписок)

- **Бизнес-назначение:** Управление коммерческой подпиской организаций на сервисы Buhuchet.kg.

| Название Колонки | Тип Данных | Ограничения | Описание и Назначение |
| --- | --- | --- | --- |
| `id` | `UUID` | `PRIMARY KEY`, `gen_random_uuid()` | Уникальный идентификатор подписки. |
| `company_id` | `UUID` | `FOREIGN KEY (companies.id) UNIQUE` | Компания-подписчик. |
| `plan_type` | `TEXT` | `CHECK (IN ('basic', 'standard', 'pro'))` | Выбранный тарифный план. |
| `status` | `TEXT` | `CHECK (IN ('active', 'expired', 'trial'))` | Текущий статус коммерческого доступа. |
| `expires_at` | `TIMESTAMPTZ` | `DEFAULT NOW() + 14 days` | Дата и время окончания периода действия подписки. |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Дата активации подписки. |
| `updated_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Дата обновления условий. |

---

### 2.5 Таблица `subscription_payments` (Реестр Транзакций Оплаты)

- **Бизнес-назначение:** Фиксация платежей за продление подписки (включая QR-Mbank/Optima).

| Название Колонки | Тип Данных | Ограничения | Описание и Назначение |
| --- | --- | --- | --- |
| `id` | `UUID` | `PRIMARY KEY`, `gen_random_uuid()` | Идентификатор транзакции. |
| `company_id` | `UUID` | `FOREIGN KEY (companies.id)` | Компания, производившая оплату. |
| `amount` | `NUMERIC(12,2)`| `NOT NULL` | Сумма проведенного платежа в сомах (KGS). |
| `payment_method` | `TEXT` | `DEFAULT 'qr_mbank'` | Способ оплаты (`qr_mbank`, `qr_optima`, `manual_admin`). |
| `status` | `TEXT` | `CHECK (IN ('pending', 'completed', 'failed'))` | Статус завершения транзакции. |
| `is_mock` | `BOOLEAN` | `DEFAULT TRUE` | Флаг тестового/эмулированного платежа. |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Момент проведения операции. |

---

### 2.6 Таблица `company_partnerships` (Партнерская Сеть Взаимодействия B2B)

- **Бизнес-назначение:** Связывание независимых компаний в единую сеть виртуального обмена ЭДО.

| Название Колонки | Тип Данных | Ограничения | Описание и Назначение |
| --- | --- | --- | --- |
| `id` | `UUID` | `PRIMARY KEY`, `gen_random_uuid()` | Идентификатор партнерской связи. |
| `requester_company_id`|`UUID` | `FOREIGN KEY (companies.id)` | Компания, инициализировавшая связывание. |
| `target_company_id` |`UUID` | `FOREIGN KEY (companies.id)` | Принимающая организация. |
| `status` | `TEXT` | `CHECK (IN ('pending', 'approved', 'accepted', 'rejected', 'cancelled', 'sent', 'recalled', 'suspended'))` | Статус рассмотрения и активности партнерства. |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Дата подачи приглашения. |
| `updated_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Дата принятия/отклонения. |

---

### 2.7 Таблица `counterparties` (Справочник Контрагентов Организаций)

- **Бизнес-назначение:** Локальный справочник партнеров, покупателей и поставщиков конкретной компании.

| Название Колонки | Тип Данных | Ограничения | Описание и Назначение |
| --- | --- | --- | --- |
| `id` | `UUID` | `PRIMARY KEY`, `gen_random_uuid()` | Идентификатор записи контрагента. |
| `company_id` | `UUID` | `FOREIGN KEY (companies.id)` | Компания-владелец справочника. |
| `target_company_id` |`UUID` | `FOREIGN KEY (companies.id) NULLABLE` | Связь с зарегистрированной компанией в платформе. |
| `name` | `TEXT` | `NOT NULL` | Наименование контрагента. |
| `inn` | `VARCHAR(14)` | `NOT NULL` | ИНН контрагента. |
| `is_vat_payer` | `BOOLEAN` | `DEFAULT FALSE` | Является ли плательщиком НДС (12%). |
| `phone` | `VARCHAR(20)` | `NULLABLE` | Контактный телефон контрагента. |
| `email` | `TEXT` | `NULLABLE` | Электронная почта. |
| `comment` | `TEXT` | `NULLABLE` | Внутренний комментарий бухгалтера. |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Дата создания записи. |
| `updated_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Дата изменения контрагента. |

---

### 2.8 Таблица `file_categories` (Справочник Категорий Сканов Первички)

- **Бизнес-назначение:** Централизованный справочник системных и пользовательских категорий файлов.

| Название Колонки | Тип Данных | Ограничения | Описание и Назначение |
| --- | --- | --- | --- |
| `id` | `UUID` | `PRIMARY KEY`, `gen_random_uuid()` | Идентификатор категории. |
| `name` | `TEXT` | `NOT NULL` | Наименование (*Уставные документы, Акты сверки*). |
| `code` | `TEXT` | `UNIQUE` | Символьный системный код категории. |
| `description` | `TEXT` | `NULLABLE` | Подробное описание предназначения категории. |
| `icon` | `TEXT` | `NULLABLE` | Иконка категории (Lucide Icon name). |
| `is_active` | `BOOLEAN` | `DEFAULT TRUE` | Флаг активности категории. |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Дата внесения категории. |

---

### 2.9 Таблица `documents` (Реестр Первичных Документов B2B)

- **Бизнес-назначение:** Хранение метаданных первичных бухгалтерских документов (Акты, Накладные, Счета).

| Название Колонки | Тип Данных | Ограничения | Описание и Назначение |
| --- | --- | --- | --- |
| `id` | `UUID` | `PRIMARY KEY`, `gen_random_uuid()` | Идентификатор документа. |
| `company_id` | `UUID` | `FOREIGN KEY (companies.id)` | Компания-владелец документа. |
| `author_id` | `UUID` | `FOREIGN KEY (users.id)` | Автор/составитель документа. |
| `sender_company_id` |`UUID` | `FOREIGN KEY (companies.id)` | Организация-отправитель. |
| `receiver_company_id`|`UUID` | `FOREIGN KEY (companies.id)` | Организация-получатель. |
| `sender_user_id` | `UUID` | `FOREIGN KEY (users.id) NULLABLE` | Конкретный сотрудник-отправитель. |
| `receiver_user_id` | `UUID` | `FOREIGN KEY (users.id) NULLABLE` | Конкретный сотрудник-получатель. |
| `counterparty_id` |`UUID` | `FOREIGN KEY (counterparties.id)`| Ссылка на контрагента из справочника. |
| `doc_number` | `VARCHAR(50)`| `NULLABLE` | Номер первичного документа. |
| `doc_date` | `DATE` | `DEFAULT CURRENT_DATE` | Дата выписки документа. |
| `doc_type` | `TEXT` | `CHECK (IN ('realization', 'purchase', 'payment', 'advance'))` | Вид хозяйственной операции. |
| `status` | `TEXT` | `CHECK (IN ('draft', 'sent', 'recalled', 'accepted', 'processed', 'cancelled'))` | Статус согласования ЭДО. |
| `total_amount` | `NUMERIC(12,2)`| `DEFAULT 0.00` | Итоговая сумма документа в сомах (KGS). |
| `comment` | `TEXT` | `NULLABLE` | Примечание составления. |
| `file_path_r2` | `TEXT` | `NULLABLE` | Путь к прикрепленному скану в Cloudflare R2. |
| `mock_file_name` | `TEXT` | `NULLABLE` | Оригинальное имя загруженного файла. |
| `mock_file_size` | `BIGINT` | `NULLABLE` | Размер прикрепленного файла в байтах. |
| `mock_file_status` | `TEXT` | `NULLABLE` | Временный статус мок-файла. |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Дата формирования документа. |
| `updated_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Дата последнего изменения. |

---

### 2.10 Таблица `files` (Хранилище Сканов и Документов R2)

- **Бизнес-назначение:** Учет всех бинарных файлов и сканов первички, загруженных в Cloudflare R2.

| Название Колонки | Тип Данных | Ограничения | Описание и Назначение |
| --- | --- | --- | --- |
| `id` | `UUID` | `PRIMARY KEY`, `gen_random_uuid()` | Уникальный идентификатор файла. |
| `company_id` | `UUID` | `FOREIGN KEY (companies.id)` | Компания-владелец файла. |
| `document_id` | `UUID` | `FOREIGN KEY (documents.id) NULLABLE` | Привязанный первичный документ (если есть). |
| `category_id` | `UUID` | `FOREIGN KEY (file_categories.id)`| Справочная категория документа. |
| `file_name` | `TEXT` | `NOT NULL` | Отображаемое имя файла. |
| `size_bytes` | `BIGINT` | `NULLABLE` | Точный размер файла в байтах. |
| `file_type` | `TEXT` | `DEFAULT 'pdf'` | Формат/расширение файла (`pdf`, `png`, `jpg`). |
| `file_path_r2` | `TEXT` | `NOT NULL` | Уникальный ключ объекта в Cloudflare R2 S3. |
| `description` | `TEXT` | `NULLABLE` | Краткое аннотирование содержимого. |
| `comment` | `TEXT` | `NULLABLE` | Служебное примечание. |
| `is_internal` | `BOOLEAN` | `DEFAULT FALSE` | Флаг чисто внутреннего использования. |
| `is_legal_doc` | `BOOLEAN` | `DEFAULT FALSE` | Является ли уставным юридическим документом. |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Момент физической загрузки. |

---

### 2.11 Таблица `document_logs` (Журнал Аудита Движения Документов)

- **Бизнес-назначение:** Неизменяемый журнал аудита всех смен статусов документов в системе ЭДО.

| Название Колонки | Тип Данных | Ограничения | Описание и Назначение |
| --- | --- | --- | --- |
| `id` | `UUID` | `PRIMARY KEY`, `gen_random_uuid()` | Идентификатор записи аудита. |
| `document_id` | `UUID` | `FOREIGN KEY (documents.id)` | Затронутый первичный документ. |
| `user_id` | `UUID` | `FOREIGN KEY (users.id)` | Исполнитель операции. |
| `old_status` | `TEXT` | `NULLABLE` | Предыдущее состояние документа. |
| `new_status` | `TEXT` | `NOT NULL` | Новое установленное состояние. |
| `comment` | `TEXT` | `NULLABLE` | Причина изменения статуса. |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Время фиксации события. |

---

### 2.12 Таблицы Интеграции с Telegram-Ботом

1. **`telegram_connections`**: Привязанные аккаунты Telegram (`user_id`, `company_id`, `telegram_chat_id`, `telegram_username`).
2. **`telegram_verification_codes`**: Одноразовые 4-значные PIN-коды верификации связывания (`code`, `expires_at`).
3. **`telegram_logs`**: Журнал доставленных сообщений и ошибок отправки Telegram API (`chat_id`, `message_text`, `status`, `error_message`).

---

### 2.13 Таблица Закрытых Отчетных Периодов (`company_closed_periods`)

**Назначение:** Реестр фиксации закрытых месяцев года организации для принудительной серверной блокировки создания, редактирования, удаления первички и прикрепления файлов R2.

| Колонка | Тип Данных | Ограничения | Бизнес-Назначение |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | `PRIMARY KEY` | Уникальный идентификатор записи. |
| `company_id` | `UUID` | `FOREIGN KEY (companies.id)` | Организация, зафиксировавшая закрытие месяца. |
| `year` | `INT` | `CHECK (2000-2100)` | Календарный год закрываемого периода. |
| `month` | `INT` | `CHECK (1-12)` | Календарный месяц (1=Январь .. 12=Декабрь). |
| `status` | `VARCHAR(20)` | `CHECK ('open', 'closed')` | Статус периода (`closed` = закрыт/заблокирован, `open` = открыт). |
| `closed_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Дата и время последнего закрытия месяца. |
| `closed_by` | `UUID` | `FOREIGN KEY (users.id)` | Пользователь (Руководитель/Владелец), закрывший период. |
| `opened_at` | `TIMESTAMPTZ` | `NULLABLE` | Дата и время последней разблокировки периода. |
| `opened_by` | `UUID` | `FOREIGN KEY (users.id)` | Пользователь, разблокировавший период. |
| `comment` | `TEXT` | `NULLABLE` | Обязательная причина / комментарий при открытии периода. |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Время создания записи. |
| `updated_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Время обновления записи. |

---

## 3. ХРАНИМЫЕ ПРОЦЕДУРЫ И ФУНКЦИИ RLS

### 3.1 `public.seed_default_company_roles(target_comp_id UUID)`
- **Назначение:** Автоматический сидинг базовых системных ролей (*Главный Бухгалтер, Бухгалтер по Первичке, Менеджер*) при онбординге новой организации.

### 3.2 `public.get_auth_user_company_id()`
- **Назначение:** Высокопроизводительная `STABLE SECURITY DEFINER` функция, возвращающая `company_id` текущего авторизованного пользователя для безопасных RLS политик.

---

## 4. ПОЛИТИКИ БЕЗОПАСНОСТИ ROW LEVEL SECURITY (RLS)

- **`Public company list policy`**: Разрешает выборку публичных наименований активных организаций на этапе регистрации и Onboarding.
- **`User company isolation policy`**: Строго изолирует пользователей в рамках своей организации.
- **`Documents company isolation policy`**: Предоставляет доступ к документам только отправителю или получателю сделки.
