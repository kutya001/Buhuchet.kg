# Implementation Plan - Модуль Управления и Мониторинга Telegram в Панели Суперадминистратора

**Дата создания:** 2026-07-31 21:20  
**Статус:** Ожидает утверждения пользователя  

---

## 1. Схема БД & Логирование (`DATABASE.md` & `types/database.types.ts`)
1. **Новая таблица `telegram_logs` (Логирование системных событий Telegram):**
   - Поля: `id`, `chat_id`, `username`, `message_text`, `status`, `error_message`, `created_at`.
2. **Обновление вебхука (`app/api/telegram/webhook/route.ts`):**
   - Логирование всех входящих сообщений и попыток привязки в `telegram_logs`.

---

## 2. Серверные функции суперадмина (`app/super-admin/telegram-actions.ts`)
1. `getTelegramAdminStatsAction()`:
   - Получение списка привязанных пользователей (`telegram_connections` + `users` + `companies`).
   - Получение истории кодов (`telegram_verification_codes`) с расчетом статусов (`active`, `expired`, `used`).
   - Получение логов сообщений (`telegram_logs`).
2. `testTelegramBotHealthAdminAction()`:
   - Запрос `getMe` и `getWebhookInfo` в Telegram Bot API.
   - Возврат статуса работы бота, `pending_update_count`, `last_error_message`, `url`.
3. `forceSetTelegramWebhookAdminAction(customUrl?: string)`:
   - Принудительный вызов `setWebhook` в Telegram API для привязки эндпоинта.
4. `sendAdminTestTelegramMessageAction(chatId: number, text: string)`:
   - Отправка ручного тестового сообщения в указанный чат.
5. `disconnectUserTelegramAdminAction(connectionId: string)`:
   - Принудительное удаление привязки пользователя суперадминистратором.

---

## 3. UI Модуль в Панели Суперадминистратора (`app/super-admin/page.tsx`)
- Добавление новой вкладки **`telegram`** («Мониторинг Telegram Бота»).
- Блок Диагностики и Тестирования («Статус бота», «Перепривязать Webhook», «Отправить тест»).
- Три подвкладки управления:
  1. **«Привязанные Пользователи»:** Таблица пользователей, компаний, Telegram usernames, Chat ID и кнопка «Отвязать».
  2. **«Реестр OTP-Кодов»:** Код, Пользователь, Компания, Дата выписки, Время жизни, Статус (Привязан / Ожидает / Истёк).
  3. **«Логи и Сообщения»:** Реестр поступающих сообщений и статусов доставки.

---

## 4. План Валидации
1. Выполнение SQL-миграции таблицы `telegram_logs` через Supabase MCP `execute_sql`.
2. Проверка сборки `npm run build`.
3. Тестирование привязки и логов в суперадминке.
