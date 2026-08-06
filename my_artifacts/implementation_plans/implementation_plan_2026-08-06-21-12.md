# Implementation Plan - Реструктуризация Модулей «Сотрудники» и «Мой Профиль»

**Дата создания:** 2026-08-06 21:12  
**Статус:** Ожидает утверждения пользователя  

---

## 1. 🎯 Цель Проекта
Четкое логическое разделение зон ответственности:
- Модуль **«Сотрудники» (`/dashboard/employees`)** превращается в чистый функционал управления штатом организации и ролевой матрицей (вкладки «Мои сотрудники» и «Роли и доступы»). Вкладка «Мой профиль» полностью удаляется.
- Страница **«Мой профиль» (`/dashboard/profile`)** становится единой точкой управления учетной записью пользователя с блоками:
  1. Личные данные пользователя (`PersonalInfoForm.tsx`).
  2. Безопасность и смена пароля (`ChangePasswordForm.tsx`).
  3. Интеграция с Telegram (`TelegramBindingCard.tsx`).

---

## 2. 🛠️ Архитектура Изменений по Компонентам

### 2.1 Модуль «Сотрудники» (`app/dashboard/employees/page.tsx` & `actions.ts`)
- [MODIFY] `app/dashboard/employees/page.tsx`:
  - Удалить `'profile'` из `activeTab`. Установить дефолт `activeTab = 'employees'`.
  - Удалить переключатель вкладки «Мой профиль» и весь сопутствующий JSX код формы смены личного пароля.
- [MODIFY] `app/dashboard/employees/actions.ts`:
  - Очистить неиспользуемые экшены изменения собственных личных данных.

### 2.2 Страница «Мой профиль» (`app/dashboard/profile/page.tsx` & `actions.ts`)
- [NEW] `components/profile/PersonalInfoForm.tsx`:
  - Форма просмотра и редактирования ФИО, телефона, email и отображения роли в компании.
- [NEW] `components/profile/ChangePasswordForm.tsx`:
  - Форма смены пароля с валидацией длины (>8 символов) и подтверждения.
- [MODIFY] `app/dashboard/profile/actions.ts`:
  - Добавить `updatePasswordAction({ newPassword, confirmPassword })` через `supabase.auth.updateUser({ password })`.
  - Добавить `updatePersonalProfileDataAction({ full_name, phone })`.
- [MODIFY] `app/dashboard/profile/page.tsx`:
  - Скомпоновать единый интерфейс из 3 блоков: `PersonalInfoForm`, `ChangePasswordForm`, `TelegramBindingCard`.

---

## 3. 🧪 План Валидации
1. Запуск сборки `npm run build` (`✓ Compiled successfully`).
2. Проверка изоляции страницы `/dashboard/employees` (отображение только реестра сотрудников и ролей).
3. Проверка функционала смены пароля и обновления ФИО/телефона на `/dashboard/profile`.
4. Коммит и деплой в `main` (`git push origin main`).
