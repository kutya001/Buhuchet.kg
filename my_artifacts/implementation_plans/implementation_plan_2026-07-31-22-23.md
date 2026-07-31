# Implementation Plan - ОПФ Организаций, Настройки Приватности, Коммуникации Сотрудников и Профиль

**Дата создания:** 2026-07-31 22:23  
**Статус:** Ожидает утверждения пользователя  

---

## 1. База Данных & Типы (`DATABASE.md` & `types/database.types.ts`)
- Выполнение SQL-миграции через Supabase MCP `execute_sql`:
  - Добавление колонки `legal_form CHECK (legal_form IN ('ИП', 'ОсОО', 'ЗАО', 'ОАО')) DEFAULT 'ОсОО'`.
  - Добавление колонки `privacy_settings JSONB DEFAULT '{"show_phone": true, "show_email": true, "show_address": true}'::jsonb`.
  - Создание индекса `idx_companies_legal_form`.
- Обновление интерфейсов `Company` и `CompanyPrivacySettings` в `types/database.types.ts`.

---

## 2. Модуль «Моя Организация» (`app/dashboard/company/page.tsx`)
- Выбор ОПФ (ИП, ОсОО, ЗАО, ОАО) при редактировании профиля компании.
- Чекбоксы управления приватностью публичных контактов (`Показывать телефон`, `Показывать Email`, `Показывать юридический адрес`).
- Сохранение через `updateCompanyAdminAction` / `updateCompanyProfileAction`.

---

## 3. Модуль «Мой Профиль» & Telegram (`app/dashboard/profile/page.tsx` & `TelegramBindingCard.tsx`)
- Перевод карточки «Личные данные» в режим просмотра по умолчанию с кнопкой **«Изменить»**.
- Обновленный адаптивный вид карточки привязки `TelegramBindingCard` под десктоп.

---

## 4. Модуль «Сотрудники» (`app/dashboard/employees/page.tsx`)
- Полноценное редактирование данных сотрудника через модальное окно при клике на карандаш.
- Кнопки быстрой связи: **WhatsApp** (`https://wa.me/...`), **Telegram** (`https://t.me/...`), **Позвонить** (`tel:...`).

---

## 5. Модуль «Контрагенты» (`app/dashboard/counterparties/page.tsx`)
- Просмотр карточки контрагента с автоматической проверкой его `privacy_settings`.
- При `false` отображение бейджа **«Информация скрыта»** и скрытие кнопок прямой связи.

---

## 6. План Валидации
1. Выполнение SQL миграции в Supabase.
2. Валидация типов и сборка `npm run build`.
3. Пуш в Git (`git push origin main`).
