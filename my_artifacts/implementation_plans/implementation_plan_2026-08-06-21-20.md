# Implementation Plan - Реструктуризация Регистрации, Подачи Заявок и Управления Сотрудниками

**Дата создания:** 2026-08-06 21:20  
**Статус:** Ожидает утверждения пользователя  

---

## 1. 🎯 Цель Проекта
Полная переработка бизнес-процесса вступления сотрудников в организацию и управления штатом:
1. **Самостоятельная регистрация сотрудников:** Ручное создание учётных записей владельцем и забивание паролей удаляются.
2. **Onboarding и подача заявок:** На этапе Onboarding новый сотрудник выбирает компанию из выпадающего списка и отправляет заявку со статусом `'pending'`.
3. **Защита маршрутов и Экран Ожидания (`/dashboard/pending`):** Сотрудники со статусом заявки `'pending'` или `'rejected'` перенаправляются на экран ожидания с возможностью отзыва заявки.
4. **Управление заявками и штатом (`/dashboard/employees`):** Владелец компании подтверждает или отклоняет заявки, назначая Роль и Должность. Редактирование личных данных и паролей других сотрудников полностью заблокировано на бэкенде и UI.

---

## 2. 🛠️ Архитектура Изменений по Компонентам

### 2.1 Схема БД и RLS (`DATABASE.md`)
- Обновление структуры `company_users`: добавление полей `status` (`'pending'`, `'active'`, `'rejected'`, `'blocked'`), `position` и `created_at`.
- RLS политики для публичного чтения списка компаний `{ id, name }` и управления заявками владельцем (`owner_id = auth.uid()`).
- Строгая блокировка `UPDATE` над профилями других пользователей в `users`.

### 2.2 Onboarding и Выбор Роли (`app/onboarding/`)
- Переключатель роли: **«Владелец бизнеса»** (создание компании) или **«Сотрудник»** (выбор из списка `getPublicCompaniesListAction()` ➔ `submitJoinCompanyRequestAction()`).

### 2.3 Защита Маршрутов Middleware (`middleware.ts`) & Экран Ожидания (`app/dashboard/pending/page.tsx`)
- В `middleware.ts` добавить проверку статуса сотрудника в `company_users`. При статусах `'pending'` / `'rejected'` — редирект на `/dashboard/pending`.
- На `/dashboard/pending/page.tsx` отображать текущую заявку, статус и кнопку «Отозвать заявку / Выбрать другую компанию».

### 2.4 Серверные Экшены Модуля «Сотрудники» (`app/dashboard/employees/actions.ts`)
- ❌ Удалить `createEmployeeAction` и `resetEmployeePasswordAction`.
- ✅ Добавить:
  - `getPendingRequestsAction(companyId: string)`
  - `approveEmployeeRequestAction({ companyUserId, roleId, position })`
  - `rejectEmployeeRequestAction(companyUserId: string)`
  - `updateEmployeeRoleAndPositionAction({ companyUserId, roleId, position })` — изменение строго **только** Роли и Должности.
  - `removeEmployeeAction(companyUserId: string)` — исключение из компании.

### 2.5 Интерфейс Управления Сотрудниками (`app/dashboard/employees/page.tsx`)
- **Блок «Заявки на вступление»:** Таблица/карточки поступающих заявок с выпадающим списком ролей, полем должности и кнопками `[ Принять ]` / `[ Отклонить ]`.
- **Блок «Штат сотрудников»:** Список активных сотрудников с панелью быстрых коммуникаций (🟢 WhatsApp, 🔵 Telegram, 📞 Звонок) и модальным окном редактирования **только** Роли и Должности.

---

## 3. 🧪 План Валидации
1. Запуск сборки `npm run build` (`✓ Compiled successfully`).
2. Проверка Onboarding процесса подачи заявки.
3. Проверка экрана ожидания `/dashboard/pending` и middleware.
4. Проверка приема/отклонения заявок и сохранения WhatsApp/Telegram/Звонок коммуникаций на `/dashboard/employees`.
5. Коммит и деплой в `main` (`git push origin main`).
