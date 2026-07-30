# План Имплементации: Удаление `document_items` и Переименование Таблицы Файлов в `files` с полем `size_bytes`

План включает полное удаление неиспользуемой таблицы `document_items` и связанной с ней кода в выгрузках 1С, а также рефакторинг главной таблицы хранения файлов с `document_files` ➔ `files` с колонкой `size_bytes BIGINT`.

---

## 🛠️ Перечень предлагаемых изменений

### 1. [Удаление таблицы `document_items` и связанной логики]
- **SQL Миграция:** Создание файла миграции `DROP TABLE IF EXISTS public.document_items CASCADE;`.
- **Выгрузка 1С и Экспорт ([lib/export/1c-exporter.ts](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/lib/export/1c-exporter.ts) & [app/dashboard/export/page.tsx](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/app/dashboard/export/page.tsx)):**
  - Удалить связку `.select('*, counterparties(*), document_items(*)')`.
  - Удалить свойство `document_items` из интерфейсов и цикл расчленения номенклатуры в экспорте.
- **Инспектор БД ([app/super-admin/actions.ts](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/app/super-admin/actions.ts)):** Удалить `document_items` из `allowedTables`.
- **Документация ([DATABASE.md](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/DATABASE.md)):** Удалить описание таблицы `document_items`.

---

### 2. [Переименование таблицы `document_files` ➔ `files` и колонки `size_bytes`]
- **SQL Миграция:**
  ```sql
  ALTER TABLE public.document_files RENAME TO files;
  ALTER TABLE public.files RENAME COLUMN file_size TO size_bytes;
  ```
- **TypeScript Интерфейсы ([types/database.types.ts](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/types/database.types.ts) & [types/b2b.types.ts](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/types/b2b.types.ts)):**
  - Заменить название интерфейса `DocumentFile` ➔ `FileRecord` (сохранив обратно-совместимый alias `DocumentFile`).
  - Изменить имя поля с `file_size` на `size_bytes?: number | null;`.
- **Обновление вызовов в Server Actions & UI:**
  - **[app/dashboard/documents/actions.ts](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/app/dashboard/documents/actions.ts):** Заменить `.from('document_files')` ➔ `.from('files')` и выборку `files(id, file_name, size_bytes)`.
  - **[app/dashboard/files/archive-actions.ts](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/app/dashboard/files/archive-actions.ts):** Перевести все запросы с `document_files` на `files`, поле `size_bytes`.
  - **[app/dashboard/files/actions.ts](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/app/dashboard/files/actions.ts):** Запросы `.from('files')`.
  - **[app/dashboard/counterparties/actions.ts](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/app/dashboard/counterparties/actions.ts):** Запросы `.from('files')`.
  - **[app/dashboard/documents/[id]/page.tsx](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/app/dashboard/documents/[id]/page.tsx):** Изменить обращение с `document.document_files` ➔ `document.files`.
  - **[app/dashboard/company/page.tsx](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/app/dashboard/company/page.tsx):** Изменить `doc.file_size` ➔ `doc.size_bytes`.
  - **[app/dashboard/files/page.tsx](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/app/dashboard/files/page.tsx):** Изменить `file.file_size` ➔ `file.size_bytes`.
  - **[app/super-admin/page.tsx](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/app/super-admin/page.tsx):** В Инспекторе БД заменить `document_files` ➔ `files`.

---

## 📊 План Верификации

### Компиляция & Проектная сборка
- Запуск строгого контроля типов: `npx tsc --noEmit`.
- Проверка полной сборки проекта: `npm run build`.

### Проверка работоспособности
- Убедиться, что Реестр Документов и детальная страница документа корректно загружают сканы из связи `files`.
- Убедиться, что Реестр Файлов и Профиль Организации считывают размер файла исключительно из колонки `size_bytes` и форматируют через `formatBytes(file.size_bytes)`.
