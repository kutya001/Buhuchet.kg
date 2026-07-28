# Implementation Plan — Регистрация и Модерация Организаций Суперадмином

Этот план описывает внедрение полноценного цикла онбординга и проверки новых юридических лиц Суперадмином перед предоставлением доступа к B2B платформе.

## User Review Required

> [!IMPORTANT]
> - **Статусная модель организации (`status`):** `pending_approval` (Ожидает модерации) $\rightarrow$ `active` (Одобрена) OR `requires_changes` (Замечания/Доработка) OR `blocked` (Заблокирована).
> - **Защита доступа (Middleware / Layout Guardian):** Организации со статусами `pending_approval` и `requires_changes` не имеют доступа к рабочим разделам (Документы, Файлы, Каталог).
> - **Итеративный цикл доработки:** Если Суперадмин возвращает заявку на доработку с текстом замечаний (`moderation_comment`), представитель компании видит причину отклонения, исправляет поля и повторно отправляет заявку на модерацию (`pending_approval`). Этот цикл повторяется до одобрения.

---

## Proposed Changes

### 1. Серверные Миграции DDL Supabase (PostgreSQL)

#### SQL Execution via Supabase MCP:
- Добавление полей в `companies`: `status TEXT DEFAULT 'pending_approval'`, `moderation_comment TEXT`, `legal_address TEXT`, `director_name TEXT`, `email TEXT`, `phone TEXT`.
- Чек-ограничение `CHECK (status IN ('pending_approval', 'requires_changes', 'active', 'blocked'))`.

---

### 2. Типы & Валидация Zod

#### [MODIFY] [database.types.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/types/database.types.ts)
- `CompanyStatus` = `'pending_approval' | 'requires_changes' | 'active' | 'blocked'`.
- Расширение интерфейса `Company` новыми полями модерации.

---

### 3. Server Actions & Модерация

#### [NEW] [app/(auth)/onboarding/actions.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/(auth)/onboarding/actions.ts)
- `createCompanyOnboardingAction`: Первичная регистрация компании с заполнением всех реквизитов и уставным статусом `pending_approval`.
- `resubmitCompanyForModerationAction`: Повторная отправка исправленных реквизитов компании на модерацию (`status = 'pending_approval'`).

#### [MODIFY] [app/super-admin/actions.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/super-admin/actions.ts)
- `approveCompanyAction(companyId)`: Активация компании (`status = 'active'`).
- `rejectCompanyWithCommentAction(companyId, comment)`: Возврат компании на доработку (`status = 'requires_changes'`, `moderation_comment = comment`).

---

### 4. Потребительский Интерфейс & Защита Маршрутов

#### [MODIFY] [app/(auth)/onboarding/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/(auth)/onboarding/page.tsx)
- Расширенная форма: Название, ИНН (14 цифр), Отрасль КР, Email, Телефон, Юридический адрес, ФИО руководителя.

#### [NEW] [app/dashboard/pending/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/pending/page.tsx)
- Экран статуса модерации компании:
  - **Для `pending_approval`:** Иллюстрация ожидания и статус-бар проверки.
  - **Для `requires_changes`:** Баннер с текстом замечаний модератора и интерактивная форма редактирования данных с кнопкой *"Отправить на повторную модерацию"*.

#### [MODIFY] [app/dashboard/layout.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/layout.tsx)
- Проверка статуса компании: если `status !== 'active'`, перенаправлять пользователя на экран модерации `/dashboard/pending`.

#### [MODIFY] [app/super-admin/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/super-admin/page.tsx)
- Вкладка **«Заявки на модерацию»**:
  - Сводная таблица поступающих компаний в статусах `pending_approval` и `requires_changes`.
  - Карточка детального просмотра всех реквизитов (ИНН, Отрасль, Директор, Адрес, Email).
  - Кнопка **«Одобрить и Активировать»** и кнопка **«Вернуть на доработку»** с модальным окном ввода текстового комментария.

---

## Verification Plan

### Automated Verification
1. Проверка компиляции TypeScript: `npx tsc --noEmit`
2. Продашкн сборка Next.js: `npm run build`

### Manual Verification
1. Прохождение онбординга `/onboarding` нового пользователя: заполнение всех реквизитов -> сохранение со статусом `pending_approval`.
2. Попытка зайти в `/dashboard/documents`: автоматический редирект на экран ожидания `/dashboard/pending`.
3. Вход под Суперадмином (`/super-admin`): переход во вкладку «Заявки на модерацию» -> нажатие «Вернуть на доработку» с вводом комментария.
4. Возврат под пользователем организации: проверка экрана `/dashboard/pending` -> отображение текста замечания -> исправление полей -> клик «Отправить на повторную модерацию».
5. Повторный вход Суперадмина: клик «Одобрить и Активировать» -> проверка разблокировки полного доступа пользователя.
