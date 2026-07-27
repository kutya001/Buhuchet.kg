# Implementation Plan - Шаг 3: Организация и Подписки

Шаг 3 реализует процесс первого входа / онбординга пользователя (создание компании с привязкой роли `Owner` и триальной подписки 14 дней), а также экран управления подпиской организации со встроенным модальным окном имитации QR-оплаты через мобильные банки КР (MBank, Оптима Банк, Элсом).

## User Review Required

> [!IMPORTANT]
> - Валидация ИНН организации в Кыргызстане выполняется строго на 14 цифр (`^\d{14}$`).
> - При создании организации пользователю автоматически присваивается роль `role = 'owner'` и генерируется триальный период на 14 дней (`subscriptions.status = 'trial'`).
> - Модалка QR-оплаты включает генерацию динамического SVG QR-кода, таймер отсчета 30 секунд и кнопку «Имитировать успешную оплату», которая создает запись в `subscription_payments` (`is_mock: true`) и обновляет `expires_at` в `subscriptions`.

---

## Proposed Changes

### 1. Схемы Валидации & Типы

#### [NEW] [company.types.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/types/company.types.ts)
- Zod-схема `createCompanySchema`: Название, ИНН (строго 14 цифр), телефон КР (`+996`), адрес.

#### [NEW] [subscription.types.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/types/subscription.types.ts)
- Zod-схема `mockPaymentSchema`: Выбор тарифного плана (`basic`, `standard`, `pro`) и периода подписки (1, 3, 6, 12 месяцев).

---

### 2. Модуль Онбординга (`/onboarding`)

#### [NEW] [actions.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/onboarding/actions.ts)
- Server Action `createCompanyAction(formData)`:
  1. Валидирует реквизиты компании (ИНН 14 цифр, телефон).
  2. Создает запись в `companies`.
  3. Создает записи в `subscriptions` (триал 14 дней, тариф `basic`).
  4. Привязывает `company_id` к пользователю в `users` и ставит роль `owner`.

#### [NEW] [page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/onboarding/page.tsx)
- Страница онбординга первого входа со стильной формой и подсказками по реквизитам КР.

---

### 3. Модуль Управления Подпиской (`/dashboard/subscription`)

#### [NEW] [actions.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/(dashboard)/subscription/actions.ts)
- Server Action `processMockPaymentAction(formData)`:
  1. Проверяет права (роль `owner` или суперадмин).
  2. Фиксирует запись в `subscription_payments` (`is_mock = true`, `payment_method = 'qr_mbank'`).
  3. Обновляет запись в `subscriptions` (статус = `active`, продление `expires_at` на нужный период в месяцах).

#### [NEW] [page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/(dashboard)/subscription/page.tsx)
- Страница подписки:
  - Карточка текущего статуса подписки и счетчик дней.
  - Тарифные карточки (Базовый 3 000 сом, Стандарт 7 000 сом, Профи 15 000 сом).
  - Интерактивное модальное окно QR-оплаты:
    - Выбор периода (1, 3, 6, 12 месяцев со скидками).
    - Динамический SVG QR-код (симуляция MBank / Оптима).
    - Обратный отсчет (30 секунд).
    - Кнопка «Имитировать успешную оплату».

---

### 4. Middleware & Navigation Updates

#### [MODIFY] [middleware.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/lib/supabase/middleware.ts)
- Логика проверки: если у авторизованного пользователя `company_id` равен `null` и он заходит на роуты `/dashboard/*`, автоматически редиректить на `/onboarding`.

#### [MODIFY] [layout.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/(dashboard)/layout.tsx)
- Обновить пункт меню сайдбара «Организация» -> с переходом на подписки и реквизиты.

---

## Verification Plan

### Automated Verification
1. Проверка компилятора TypeScript: `npx tsc --noEmit`
2. Сборка Next.js: `npm run build`

### Manual Verification
1. Регистрация/вход пользователем без компании -> проверять редирект на `/onboarding`.
2. Заполнение формы онбординга с ИНН 14 цифр (`20101202310050`) -> успешное создание компании и переход в дашборд.
3. Переход на `/dashboard/subscription` -> открытие модалки QR-оплаты, запуск таймера 30 сек и нажитие «Имитировать успешную оплату».
4. Проверка обновления статуса подписки на `Active` и продления даты окончания в интерфейсе.
