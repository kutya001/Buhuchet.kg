# Implementation Plan — Личный Архив Файлов & Учредительные Документы

Этот план описывает внедрение личного архива сканов компании без отправки сторонним лицам, модуля хранения уставных/учредительных документов организации и возможности повторного прикрепления ранее загруженных R2-файлов при создании B2B документов.

## User Review Required

> [!IMPORTANT]
> - **Гибкость структуры `document_files`:** Поле `document_id` становится необязательным (`NULLABLE`). Добавляется колонка `company_id` для прямой привязки файлов к личному архиву компании (`is_internal = true`) и уставным документам (`is_legal_doc = true`).
> - **Учредительные документы (`/dashboard/company`):** Вкладка для загрузки и хранения устава, свидетельства ЮЛ, патентов, справок ГНС/Соцфонда и паспорта руководителя.
> - **Повторное использование R2-сканов без дублирования трафика:** При создании B2B документа пользователь может выбрать ранее загруженный файл из своего архива — система скопирует метаданные и использует имеющийся `file_path_r2` в Cloudflare R2.

---

## Proposed Changes

### 1. Серверные Миграции DDL Supabase (PostgreSQL)

#### SQL Execution via Supabase MCP:
- Сделать `document_id` в `document_files` необязательным (`ALTER TABLE document_files ALTER COLUMN document_id DROP NOT NULL`).
- Добавить поля: `company_id UUID REFERENCES companies(id) ON DELETE CASCADE`, `is_internal BOOLEAN DEFAULT FALSE`, `is_legal_doc BOOLEAN DEFAULT FALSE`.
- Обновить RLS-политики `document_files` для свободного просмотра и загрузки личных файлов компании.
- Наполнение категорий учредительных документов: *Устав компании, Свидетельство ЮЛ, Паспорт руководителя, Паспорт учредителя, Справка ГНС / Соцфонда*.

---

### 2. Типы & Валидация Zod

#### [MODIFY] [database.types.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/types/database.types.ts)
- Обновление интерфейса `DocumentFile` с полями `company_id`, `is_internal`, `is_legal_doc`.

#### [MODIFY] [b2b.types.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/types/b2b.types.ts)
- Поддержка необязательного `file_path_r2` при прикреплении ранее имеющегося файла.

---

### 3. Server Actions Личного Архива & Устава

#### [NEW] [app/dashboard/files/archive-actions.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/files/archive-actions.ts)
- `uploadFileToArchiveAction`: Сохранение файла в личный архив организации (`is_internal = true`, `document_id = null`).
- `uploadLegalDocumentAction`: Сохранение учредительного документа компании (`is_legal_doc = true`).
- `getCompanyFilesArchiveAction`: Получение списка всех ранее загруженных R2-файлов компании для диалога выбора.

---

### 4. Потребительский Интерфейс & Компоненты

#### [MODIFY] [app/dashboard/company/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/company/page.tsx)
- Добавление вкладки **«Учредительные документы»**:
  - Карточки загруженных уставных файлов (Устав, Свидетельство, Паспорта).
  - Форма быстрой загрузки сканов с нативной камеры/файлов в R2.

#### [MODIFY] [app/dashboard/files/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/files/page.tsx)
- Кнопка **«+ Загрузить в личный архив»** с вызовом модального окна прямой загрузки скана.
- Фильтр личных файлов компании.

#### [MODIFY] [app/dashboard/documents/new/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/documents/new/page.tsx)
- Третья опция прикрепления: **«Выбрать из личного архива»**.
- Интерактивное модальное окно со списком ранее загруженных файлов R2, быстрым поиском и прикреплением без дублирования загрузки.

---

## Verification Plan

### Automated Verification
1. Проверка компиляции TypeScript: `npx tsc --noEmit`
2. Продашкн сборка Next.js: `npm run build`

### Manual Verification
1. Открытие `/dashboard/company` -> вкладка «Учредительные документы» -> загрузка Устава компании через R2.
2. Открытие `/dashboard/files` -> нажатие «+ Загрузить в личный архив» -> загрузка скана с описанием.
3. Открытие `/dashboard/documents/new` -> клик «Выбрать из личного архива» -> выбор загруженного файла Устава -> быстрая отправка B2B документа.
