# Implementation Plan - Стандартизация UI/UX, Единый FloatingTopbar, Режимы Ширины Таблиц и Исправление Островка Telegram

**Дата создания:** 2026-07-31 22:44  
**Статус:** Ожидает утверждения пользователя  

---

## 1. Регламент Иконной Граники (Удаление Эмодзи)
- Проверка и замена всех эмодзи на профессиональные векторные иконки `lucide-react` во всех модулях платформы (`/super-admin`, `/dashboard/profile`, `/dashboard/company`, `/dashboard/counterparties`, `TelegramBindingCard`).

---

## 2. Единая Верхняя Панель (`components/ui/FloatingTopbar.tsx`)
- Создание `FloatingTopbar` со следующими элементами:
  - Часы и дата Кыргызской Республики (реальное время с минутным/секундным таймером).
  - Отображение текущей компании и бэйджа `Super Admin`.
  - Поисковая строка `Search`.
  - Переключатель темы (Light / Dark / System).
- Интеграция `FloatingTopbar` в `app/super-admin/page.tsx` и `components/dashboard/DashboardShell.tsx`.

---

## 3. Исправление Островка Telegram (`components/dashboard/TelegramBindingCard.tsx`)
- Переработка островка `TelegramBindingCard`: развертка на 100% ширины контейнера под блоком реквизитов профиля.
- Использование аккуратных линейных икон `Send`, `CheckCircle2`, `ShieldAlert`, `Unlink`, `ExternalLink`.

---

## 4. Контроль Ширины Реестров & Компактные Действия (`UnifiedDataGrid.tsx` & `LayoutWidthToggle.tsx`)
- Создание компонента `LayoutWidthToggle.tsx` (переключение «По центру» / «На всю ширину» с сохранением состояния в `localStorage`).
- Интеграция переключателя ширины в `UnifiedDataGrid.tsx`.
- Замена громоздких текстовых кнопок в колонках действий на компактные линейные иконки с подсказками (`Eye`, `Pencil`, `Trash2`, `FileText`, `Send`, `MessageCircle`).
- Поддержка открытия модального окна просмотра `View Form` по клику на строку.

---

## 5. План Валидации
1. Проверка типов и сборка `npm run build`.
2. Фиксация обновлений в Git (`git push origin main`).
