# Implementation Plan - Полноценная Интеграция Telegram-Бота (Telegram Webhook, OTP Deep-Linking & RBAC Notification Engine)

**Дата создания:** 2026-07-31 20:50  
**Статус:** Ожидает утверждения пользователя  

---

## 1. База Данных & Схема PostgreSQL (`DATABASE.md` & `types/database.types.ts`)
1. **Документирование и обновление `DATABASE.md`:**
   - Таблица `telegram_connections` (`id`, `user_id`, `company_id`, `telegram_chat_id`, `telegram_user_id`, `telegram_username`, `created_at`).
   - Таблица `telegram_verification_codes` (`id`, `user_id`, `company_id`, `code`, `expires_at`, `created_at`).
   - Индексы `idx_telegram_connections_company`, `idx_telegram_connections_user`, `idx_telegram_codes_code`.
2. **Расширение TypeScript интерфейсов (`types/database.types.ts`):**
   - Добавление `TelegramConnection` и `TelegramVerificationCode`.

---

## 2. Расширение RBAC Ролевой Модели (`lib/auth/permissions.ts`)
- Добавление действий в матрицу доступов:
  - `telegram.bind` — право привязки/отвязки Telegram.
  - `notifications.documents` — получение уведомлений по движениям первички.
  - `notifications.collaboration` — получение уведомлений по изменению ролей и команды.

---

## 3. Бэкенд & Telegram Webhook

### 3.1 Server Action генерации OTP (`app/dashboard/profile/telegram-actions.ts`)
- Проверка авторизации и `telegram.bind`.
- Генерация 4-значного случайного кода с TTL 10 минут (`expires_at`).
- Формирование ссылки `https://t.me/${botUsername}?start=${code}`.

### 3.2 Webhook Route (`app/api/telegram/webhook/route.ts`)
- Обработка команды `/start XXXX` или ввода 4-значного кода.
- Проверка TTL и поиск кода в `telegram_verification_codes`.
- Запись связи в `telegram_connections`, отправка успешного сообщения в Telegram и отдача `200 OK` за < 2 секунды.

### 3.3 Сервис Диспетчера Уведомлений (`lib/telegram/notifier.ts`)
- Функция `sendTelegramNotification({ companyId, type, message, targetUserId })`.
- Проверка прав получателей по матрице RBAC.
- Безопасный асинхронный вызов `sendTelegramMessage`.

---

## 4. Системные Триггеры & UI Компоненты

1. **Триггеры в экшенах:**
   - Входящие документы (`app/dashboard/documents/actions.ts`).
   - Изменения сотрудников/ролей (`app/dashboard/employees/actions.ts`).
   - Блокировки организации суперадмином (`app/super-admin/actions.ts`).
2. **UI Компонент в Профиле (`app/dashboard/profile/page.tsx`):**
   - Блок `TelegramBindingCard` с генерацией кода, таймером и кнопкой перехода в Telegram-бота.

---

## 5. План Валидации
1. Запуск `npm run build` для проверки компиляции и отсутствия типов `any`.
2. Проверка Git коммита и обновление документации по правилу Definition of Done.
