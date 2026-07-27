# Implementation Plan - Шаг 5: Документы (Documents Core)

Шаг 5 реализует центральный модуль системы: реестр первичных документов компании, форму создания с динамической табличной частью товаров из номенклатуры, Mock-файловую дропзону с имитацией прогресса загрузки сканов (0% -> 100%), Split-screen view интерфейс просмотра для бухгалтера и статусную модель жизненного цикла документа (`draft` -> `review` -> `approved` -> `posted_1c`).

## User Review Required

> [!IMPORTANT]
> - Жизненный цикл документа управляется встроенной статусной машиной со строгими правами доступа: Менеджеры создают черновики (`draft`) и отправляют на проверку (`review`), Бухгалтеры и Владельцы одобряют (`approved`), отклоняют (`rejected`) или проводят в 1С (`posted_1c`).
> - При проведении документа в 1С (`posted_1c`) редактирование документа **полностью блокируется**.
> - Все смены статусов записываются в таблицу аудита `document_logs`.
> - Имитация загрузки файла (Dropzone) запускает реальную анимацию прогресса (1.5 сек) и сохраняет метаданные `mock_file_name` и `mock_file_size` в Supabase tanpa обращения к хранилищу.

---

## Proposed Changes

### 1. Схемы Валидации & Типы

#### [NEW] [document.types.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/types/document.types.ts)
- Zod-схемы `documentItemSchema` и `documentSchema`.
- Словари локализации типов документов (Реализация, Закуп, Оплата, Авансовый отчет) и бейджей статусов.

---

### 2. Server Actions (`/dashboard/documents`)

#### [NEW] [actions.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/(dashboard)/documents/actions.ts)
- Server Actions:
  - `createDocumentAction(data)` — вставка шапки в `documents`, строк в `document_items` и начальной записи в `document_logs`.
  - `updateDocumentAction(data)` — синхронизация шапки и позиций документа.
  - `changeDocumentStatusAction(id, newStatus, comment)` — проверка ролей, смена статуса в `documents` и запись аудита в `document_logs`.
  - `deleteDocumentAction(id)` — удаление документа (разрешено только в статусах `draft` / `rejected`).

---

### 3. Компоненты Загрузки & Сплит-просмотра

#### [NEW] [MockDropzone.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/components/documents/MockDropzone.tsx)
- Интерактивная зона прикрепления скана накладной с анимацией Progress Bar (0-100%), имитацией распознавания и сохраненными свойствами файла.

#### [NEW] [ScanViewer.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/components/documents/ScanViewer.tsx)
- Просмотрщик скана документа с функциями масштабирования (Zoom in/out), поворота изображения и полноэкранного режима.

---

### 4. Страницы Раздела Документов

#### [NEW] [page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/(dashboard)/documents/page.tsx)
- Главный реестр документов:
  - Таблица с фильтрацией по статусам (`draft`, `review`, `approved`, `rejected`, `posted_1c`), типам документов, контрагентам и периоду дат.
  - Подсветка статусов бейджами, суммы в сомах и кнопки мгновенных действий.

#### [NEW] [new/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/(dashboard)/documents/new/page.tsx)
- Форма создания документа:
  - Выбор контрагента из справочника.
  - Автоматический расчет сумм строк товаров (количество * цена).
  - Быстрый выбор позиций из Справочника Номенклатуры.
  - Прикрепление скана через Mock Dropzone.

#### [NEW] [[id]/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/(dashboard)/documents/[id]/page.tsx)
- **Split-Screen View** просмотр/редактирование для Бухгалтера и Контролера:
  - Слева: Интерактивный просмотрщик скана `ScanViewer`.
  - Справа: Поля документа, динамическая таблица товаров, история аудита `document_logs` и панель управления статусами (`Одобрить`, `Отклонить`, `Провести в 1С`).

---

## Verification Plan

### Automated Verification
1. Проверка компилятора TypeScript: `npx tsc --noEmit`
2. Сборка Next.js: `npm run build`

### Manual Verification
1. Переход на `/dashboard/documents/new`: создание документа «Реализация» с выбором контрагента, добавлением 2 товаров из номенклатуры и дропом скана -> проверка авторасчета сумм.
2. Открытие созданного документа по пути `/dashboard/documents/[id]`: проверка Split-Screen режима (слева скан, справа поля).
3. Тестирование смены статуса `draft` -> `review` -> `approved` -> `posted_1c` с записью логов.
4. Проверка блокировки редактирования в статусе `posted_1c`.
