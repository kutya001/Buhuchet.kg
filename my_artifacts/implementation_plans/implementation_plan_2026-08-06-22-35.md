# Implementation Plan - Тотальный Перенос Столбцов Действий в Right-Click Context Menu

**Дата создания:** 2026-08-06 22:35  
**Статус:** Выполнение  

---

## 1. 🎯 Цель Рефакторинга
Полное удаление служебных столбцов действий (`actions`, `action`, `moderation`, `download`, `действия`, `действие`, `модерация`, `скачивание`) из всех таблиц платформы **Buhuchet.kg** и перенос управления в контекстное меню (Right-Click Context Menu).

---

## 2. 📋 Детализация Пофайловых Изменений

### 2.1 `components/ui/unified/UnifiedDataGrid.tsx`
- Добавить автоматическую фильтрацию колонок:
  ```typescript
  const ACTION_COLUMN_KEYS = ['actions', 'action', 'moderation', 'download', 'действия', 'действие', 'модерация', 'скачивание'];
  const filteredColumns = columns.filter((col) => !ACTION_COLUMN_KEYS.includes(col.key.toLowerCase()));
  ```
- Расширить тип `RowAction<T>` полем `separatorBefore?: boolean`.
- Рендерить все контекстные действия с поддержкой разделителей и опасных операций.

### 2.2 `app/dashboard/company/page.tsx`
- Удалить колонку `actions` у файлов устава компании.
- В `getRowActions` вынести: Скачивание R2, Переименование, Удаление.

### 2.3 `app/dashboard/employees/page.tsx`
- Удалить колонку `actions` из таблицы сотрудников.
- В `getRowActions` передать: 🟢 WhatsApp, 🔵 Telegram, 📞 Звонок, ✏️ Редактировать должность/роль, ❌ Исключить из штата.

### 2.4 `app/dashboard/counterparties/page.tsx`
- Удалить столбцы `actions` из всех таблиц (Партнеры, Заявки, Каталог).
- Заполнить `getRowActions` контекстными действиями.

### 2.5 `app/dashboard/documents/page.tsx` & `app/dashboard/files/page.tsx`
- Удалить колонки `actions`/`download`, передать `getRowActions` с генерацией presigned R2 ссылок и удалением.

### 2.6 `app/super-admin/page.tsx` & `components/super-admin/SuperAdminTelegramTab.tsx`
- Удалить колонки `moderation` и `actions` из всех админских таблиц (Организации, Пользователи, Файлы, Документы, Telegram).
- В `getRowActions` перенести функции модерации, блокировки и редактирования.

---

## 3. 🧪 План Валидации
1. Запуск `npm run build` (`✓ Compiled successfully`).
2. Фиксация изменений в `git` и деплой в `main`.
