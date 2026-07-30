# План Имплементации: Модуль «Сотрудники» (Ролевая Модель RBAC) и Учет Сотрудников в B2B Документах

Этот документ описывает технический план реализации модуля **«Сотрудники»** с гибкой ролевой моделью доступов (RBAC/ACL), созданием аккаунтов сотрудников и 3 вкладками, а также отслеживанием сотрудников-отправителей и сотрудников-получателей в B2B документообороте.

---

## 🛠️ Перечень Предлагаемых Изменений

### 1. [База Данных & SQL Миграция]
**Файл миграции:** `supabase/migrations/20260730221200_employees_rbac_and_doc_users.sql`

- **Таблица `company_roles` (Роли Организации):**
  ```sql
  CREATE TABLE public.company_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    is_system BOOLEAN DEFAULT FALSE,
    permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );
  ```
- **Расширение таблицы `users` (Сотрудники):**
  - `role_id UUID REFERENCES public.company_roles(id) ON DELETE SET NULL`
  - `position TEXT` (Должность сотрудника, например *"Главный бухгалтер"*, *"Менеджер по продажам"*)
  - `is_active BOOLEAN DEFAULT TRUE` (Статус учетной записи)
  - `must_change_password BOOLEAN DEFAULT FALSE` (Флаг обязательной смены пароля при входе)

- **Расширение таблицы `documents` (B2B Документооборот):**
  - `sender_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL` (Отправитель - сотрудник)
  - `receiver_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL` (Получатель - сотрудник, фиксируется при нажатии на **«Принять»**)

---

### 2. [Типы TypeScript & Zod Схемы]
**Файлы:** `types/database.types.ts`, `types/b2b.types.ts`

- Определение интерфейсов `CompanyRole`, `RolePermissions`, `EmployeeUser`.
- Поля `sender_user_id` и `receiver_user_id` в интерфейсах `Document` и Zod-схеме `b2bDocumentSchema`.

---

### 3. [Новый Модуль «Сотрудники» (`/dashboard/employees`)]
**Файлы:**
- `app/dashboard/employees/page.tsx` (Клиентская страница с 3 вкладками)
- `app/dashboard/employees/actions.ts` (Server Actions для создания пользователей, изменения ролей, прав и смены паролей)

#### Вкладка 1: «Мой профиль» (`my-profile`)
- Просмотр личной информации авторизованного сотрудника (ФИО, Email, Телефон, Организация, Должность, Роль).
- Форма обновления личных данных.
- **Форма смены пароля** (Текущий пароль / Новый пароль / Подтверждение пароля) через `supabase.auth.updateUser`.

#### Вкладка 2: «Мои сотрудники» (`employees-list`)
- Реестр всех сотрудников текущей компании с пагинацией (25-50-100) и поиском.
- Модальное окно **«+ Добавить сотрудника»**:
  - Поля: ФИО, Логин/Email, Должность, Выбор Роли (`company_roles`), Временный пароль.
  - Сохранение через `adminSupabase.auth.admin.createUser({ email, password, email_confirm: true })` и привязка к компании и роли.
- Действия: Редактирование должности/роли сотрудника, сброс пароля, деактивация/активация.

#### Вкладка 3: «Роли и доступы» (`roles-matrix`)
- Реестр ролей организации + кнопка **«+ Создать роль»**.
- **Матричный редактор разрешений (ACL Matrix):**
  - Настройка галочек доступов по каждому модулю платформы (Документы, Файлы, Организации, Сотрудники, Экспорт 1С, Профиль).
  - Разграничение по действиям: просмотр (`view`), создание (`create`), редактирование (`edit`), удаление (`delete`), отправка (`send`), принятие (`accept`).

---

### 4. [Фиксация Сотрудника в B2B Документах]
**Файлы:**
- `app/dashboard/documents/actions.ts`
- `app/dashboard/documents/page.tsx`
- `app/dashboard/documents/[id]/page.tsx`

- **При отправке/создании документа:** В поле `sender_user_id` автоматически запишется `ctx.userId` текущего авторизованного сотрудника.
- **При нажатии кнопки «Принять» / «Обработать»:** В Server Action `updateB2BDocumentStatusAction` автоматически записывается `receiver_user_id = ctx.userId`.
- **На детальной странице просмотра документа:** Отображаются наглядные карточки/бейджи:
  - 📤 **Отправитель - сотрудник:** ФИО сотрудника, отправившего документ.
  - 📥 **Получатель - сотрудник:** ФИО сотрудника, принявшего документ (появляется при принятии).

---

### 5. [Обновление Навигации & Сайбара]
**Файлы:**
- `components/dashboard/DashboardShell.tsx`
- `components/ui/FloatingTopbar.tsx`
- `components/ui/FloatingBottomNav.tsx`

Добавление пункта **«Сотрудники»** (иконка `Users`) во все навигационные панели дашборда.

---

## 📊 План Верификации

### Проверка типиизации и сборки
- Запуск проверки TypeScript: `npx tsc --noEmit`.
- Проверка полноценного билда приложения: `npm run build`.

### Ручная функциональная проверка
1. Создание роли (например, *"Менеджер по отгрузкам"*) с ограниченными правами.
2. Создание нового сотрудника с логином и временным паролем.
3. Проверка успешного входа под созданным сотрудником и возможности смены пароля во вкладке **«Мой профиль»**.
4. Проверка автоматического фиксирования ФИО сотрудника при отправке B2B документа и при клике по кнопке **«Принять»**.
