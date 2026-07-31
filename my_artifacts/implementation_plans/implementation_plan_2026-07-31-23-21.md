# Implementation Plan - Компактные Иконки Действий (ActionIcons), Фикс Дублирующих Кнопок FAB и Очистка Таблиц

**Дата создания:** 2026-07-31 23:21  
**Статус:** Ожидает утверждения пользователя  

---

## 1. Компонент Иконных Действий (`components/ui/unified/ActionIcons.tsx`)
- Создание `ActionIcons.tsx`:
  - `ActionIconButton` (квадратная иконка `h-8 w-8` с всплывающим `Tooltip` при наведении).
  - `ActionRowGroup` (группа стандартизированных иконок для таблиц: `Eye`, `FolderDown`, `FileText`, `Send`, `RotateCcw`, `PauseCircle`, `Pencil`, `Trash2`, `UserX`).

---

## 2. Устранение Конфликта Двух Кнопок `+` на Мобильных (`components/ui/MobileFAB.tsx`)
- Добавление флага `hasBottomNav?: boolean` (по умолчанию `true`).
- При рендеринге `FloatingBottomNav` на смартфонах `MobileFAB` возвращает `null`, исключая наложение двух плюсов в правом нижнем углу.

---

## 3. Внедрение Иконных Действий во Все Таблицы Платформы
- Интеграция `ActionRowGroup` в:
  - `app/dashboard/documents/page.tsx`
  - `app/dashboard/counterparties/page.tsx`
  - `app/dashboard/employees/page.tsx`
  - `app/dashboard/files/page.tsx`
  - `app/super-admin/page.tsx`

---

## 4. План Валидации
1. Проверка типов и сборка `npm run build`.
2. Фиксация обновлений в Git (`git push origin main`).
