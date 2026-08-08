# План исправления верификации организаций в суперадминке и ошибки привязки пользователя

## Описание проблемы
1. **Отсутствие действия одобрения компании в Суперадминке**:
   - В выпадающем меню действий `getRowActions` реестра организаций (`/super-admin`) отсутствовал пункт «Одобрить и активировать компанию».
   - В модальном окне редактирования профиля компании значения `<select>` статуса содержали невалидные строки (`pending` вместо `pending_approval`, `needs_changes` вместо `requires_changes`).
2. **Ошибка «Пользователь не привязан к организации»**:
   - В серверных контекстах `getUserContext()` (модули Документов, Сотрудников, Контрагентов, Файлов) выборка профиля выполнялась через клиенсткий клиент `supabase` с неявным вложенным JOIN `companies(*)`.
   - При неявном связывании или сбоях PostgREST контекст терял `companyId`, возвращая ошибку *«Пользователь не привязан к организации»*.

## Proposed Changes

### 1. Super-Admin Module
#### [MODIFY] [app/super-admin/page.tsx](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/app/super-admin/page.tsx)
- Добавить в `getRowActions` организации вызов `handleApprove(c)` (Пункт *«✅ Одобрить и активировать»* для компаний со статусом, отличным от `active`).
- Исправить значения `<select>` статуса модерации в модальном окне редактирования организации на корректные: `pending_approval`, `requires_changes`, `active`, `blocked`.

### 2. Dashboard Server Contexts & Actions
#### [MODIFY] [app/dashboard/documents/actions.ts](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/app/dashboard/documents/actions.ts)
- Использовать `adminSupabase` в `getUserContext()` для гарантированного чтения `profile` и `company` по `company_id`.

#### [MODIFY] [app/dashboard/employees/actions.ts](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/app/dashboard/employees/actions.ts)
- Использовать `adminSupabase` в `getUserContext()` для надежного извлечения `companyId`.

#### [MODIFY] [app/dashboard/counterparties/actions.ts](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/app/dashboard/counterparties/actions.ts)
- Использовать `adminSupabase` в `getUserContext()` для получения `companyId`.

#### [MODIFY] [app/dashboard/company/actions.ts](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/app/dashboard/company/actions.ts)
- Использовать `adminSupabase` для считывания `profile.company_id`.

## Verification Plan
1. В суперадминке (`/super-admin`) открыть выпадающее меню действий у организации «На проверке» и проверить наличие кнопки «✅ Одобрить и активировать».
2. Выполнить одобрение компании и убедиться, что статус меняется на `active`.
3. Зайти под пользователем данной компании в раздел `/dashboard/documents` и убедиться, что ошибка «Пользователь не привязан к организации» отсутствует, а реестр работает штатно.
