# План разграничения и восстановления видимости вкладок в разделах «Организации», «Моя организация» и «Сотрудники»

## Описание задачи
Пользователь зафиксировал скрытие или видимое «пропадание» встроенных вкладок внутри основных модулей системы:
1. **Раздел «Организации» (`/dashboard/counterparties`)**: вкладки *«Мои контрагенты»*, *«Заявки на партнерство»*, *«Каталог организаций КР»*.
2. **Раздел «Моя организация» (`/dashboard/company`)**: вкладки *«Профиль & Реквизиты»*, *«Учредительные документы»*, *«Закрытие месяца»*.
3. **Раздел «Сотрудники» (`/dashboard/employees`)**: вкладки *«Мои сотрудники»*, *«Заявки в штат»*, *«Роли и доступы (RBAC)»*.

## Корневая причина
В движке прав `hasPermission` в [`lib/auth/permissions.ts`](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/lib/auth/permissions.ts) список разрешений по умолчанию при отсутствии кастомного `role_id` проверял точечный набор вкладок (`tab_counterparties`, `tab_profile`, `tab_legal_docs`), пропуская `tab_partnerships`, `tab_catalog`, `tab_employees`, `tab_roles`. При загрузке профиля на клиенте `hasPermission(null, ...)` возвращал `false`, приводя к убиранию кнопок вкладок из DOM.

## Proposed Changes

### 1. Permissions System
#### [MODIFY] [lib/auth/permissions.ts](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/lib/auth/permissions.ts)
- Расширить правило по умолчанию для профилей без явного `role_id`: любые проверки вкладок `action.startsWith('tab_')` возвращают `true`.

### 2. Employees Module
#### [MODIFY] [app/dashboard/employees/page.tsx](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/app/dashboard/employees/page.tsx)
- Явно добавить в таб-бар выделенную вкладку *«Заявки в штат ({count})»* со статусом ожидающих кандидатов.
- Добавить обработку состояния `activeTab === 'requests'` для прямой работы со списком заявок кандидатов.

## Verification Plan
1. Перейти во все 3 раздела (`/dashboard/counterparties`, `/dashboard/company`, `/dashboard/employees`).
2. Проверить наглядность и работоспособность всех 3 вкладок в каждом из трех модулей.
