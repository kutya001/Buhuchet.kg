# Implementation Plan — Масштабирование Суперадминки: Полный CRUD & Модуль БД (Read-Only)

Этот план описывает расширение Панели Суперадмина полным CRUD-доступом ко всем сущностям системы (Пользователи, Организации, Файлы, Документы, Справочники) и внедрение модуля визуального просмотра базы данных Supabase.

## User Review Required

> [!IMPORTANT]
> - **Полный CRUD доступ на ВСЁ:** Суперадмин получает возможность просматривать, создавать, редактировать и удалять любые Пользователи, Организации, Файлы R2, B2B Документы и Справочники.
> - **Интерактивный Модуль БД (Read-Only):** Возможность переключать таблицы базы данных (`users`, `companies`, `documents`, `document_files`, `counterparties`, `file_categories`, `company_partnerships`), просматривать схему полей и текущие записи.

---

## Proposed Changes

### 1. Серверные Экшены Суперадмина

#### [MODIFY] [super-admin/actions.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/super-admin/actions.ts)
- Добавление `getAllDocumentsAdminAction()`, `updateDocumentAdminAction()`, `deleteDocumentAdminAction()`.
- Добавление CRUD методов для справочников `file_categories`.
- Добавление `inspectTableDataAdminAction(tableName)` для чтения записей любых таблиц БД.

---

### 2. Интерфейс Панели Суперадмина

#### [MODIFY] [super-admin/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/super-admin/page.tsx)
- Перевод интерфеса на 6 полнофункциональных модулей:
  1. 🏢 **Организации** (Верификация, Редактирование, Создание).
  2. 👤 **Пользователи** (Полное управление записями и ролями).
  3. 📁 **Файлы R2** (Скачивание, Редактирование, Замена в R2, Удаление).
  4. 📄 **Все Документы** (Управление всеми B2B накладными и актами).
  5. 📚 **Справочники** (CRUD категорий сканов и классификаторов).
  6. 🗄️ **Модуль БД (Read-Only)** (Выбор любой таблицы Supabase, просмотр схемы и записей).

---

## Verification Plan

### Automated Verification
1. Проверка типов TypeScript: `npx tsc --noEmit`
2. Продашкн сборка Next.js: `npm run build`

### Manual Verification
1. Проверка модулей: переключение между 6 вкладками суперадминки.
2. Проверка Модуля БД: выбор таблицы `companies` или `documents` и просмотр реальных строк из Supabase.
3. Проверка CRUD операций над документами и справочниками.
