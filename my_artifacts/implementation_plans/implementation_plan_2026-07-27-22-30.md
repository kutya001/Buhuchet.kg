# Implementation Plan - Шаг 6: Модуль Экспорта в 1С / Excel и Финализация MVP

Шаг 6 завершает разработку Core MVP системы автоматизации первичной документации. Включает разработку клиентского модуля выгрузки документов в строго форматированный Excel-файл для «1С: Бухгалтерия» (библиотека `xlsx` / SheetJS) без нагрузки на сервер Vercel, а также актуализацию управляющих документов (`ARCHITECTURE.md`, `DATABASE.md`, `SYSTEM_PROMPT.md`).

## User Review Required

> [!IMPORTANT]
> - Генерация `.xlsx` файла выполняется строго **на стороне клиента (Client-Side)** с помощью библиотеки `xlsx` (SheetJS). Это исключает риски падения функции по 10-секундному таймауту Vercel при больших объемах выгрузки.
> - Название сгенерированного файла формируется автоматически: `export_1c_[company_name]_[date].xlsx`.
> - Все 3 файла системной документации (`ARCHITECTURE.md`, `DATABASE.md`, `SYSTEM_PROMPT.md`) будут приведены в полное соответствие с итоговой кодовой базой для соблюдения Definition of Done (DoD).

---

## Proposed Changes

### 1. Зависимости & Модули Экспорта

#### [NEW] [package.json](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/package.json)
- Добавление зависимости `xlsx` (SheetJS).

#### [NEW] [export.types.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/types/export.types.ts)
- Схема фильтров выгрузки в 1С: диапозон дат (с... по...), выбор типов документов (Реализация, Закуп, Оплата), выбор статусов (`approved`, `posted_1c`).
- Интерфейс строки экспортируемого массива 1С.

---

### 2. Модуль Клиентского Экспорта (`/dashboard/export`)

#### [NEW] [1c-exporter.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/lib/export/1c-exporter.ts)
- Функция `generate1CExcel(documentsData, companyName, fileName)`:
  1. Трансформирует массив документов и строк `document_items` в плоскую таблицу.
  2. Колонки: `Дата Документа`, `Номер Документа`, `Тип Операции`, `ИНН Контрагента`, `Наименование Контрагента`, `Товар / Услуга`, `Кол-во`, `Ед. изм.`, `Цена (сом)`, `Сумма (сом)`, `Учет НДС (12%)`, `Статус`.
  3. Генерирует книга Excel (`XLSX.utils.book_new()`), применяет автоширину колонок и инициирует скачивание `XLSX.writeFile()`.

#### [NEW] [ExportModal.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/components/documents/ExportModal.tsx)
- Интерактивное модальное окно быстрых настроек экспорта (период, статусы, типы) для внедрения в реестр документов.

#### [NEW] [page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/(dashboard)/export/page.tsx)
- Выделенный раздел экспорта бухгалтера с кастомными фильтрами периода, предварительным просмотром количества записей к выгрузке и кнопкой скачивания.

---

### 3. Актуализация Документации (DoD Requirement)

#### [MODIFY] [ARCHITECTURE.md](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/ARCHITECTURE.md)
- Внесение описания Data Flow клиентского экспорта в Excel и завершенной структуры компонентов Next.js.

#### [MODIFY] [DATABASE.md](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/DATABASE.md)
- Актуализация физической схемы таблиц (`companies`, `users`, `subscriptions`, `subscription_payments`, `counterparties`, `nomenclature`, `documents`, `document_items`, `document_logs`).

#### [MODIFY] [SYSTEM_PROMPT.md](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/SYSTEM_PROMPT.md)
- Отражение реализованного продуктового функционала (онбординг, имитация QR-оплаты, ролевая модель, 1С выгрузка).

---

## Verification Plan

### Automated Verification
1. Проверка компилятора TypeScript: `npx tsc --noEmit`
2. Полная продуктовая сборка Next.js: `npm run build`

### Manual Verification
1. Переход на `/dashboard/export` или нажатие кнопки «Выгрузить в Excel / 1С» в реестре документов.
2. Выбор периода и статуса `Одобрен` / `Проведен в 1С`.
3. Скачивание файла `export_1c_[company_name]_[date].xlsx` -> проверка заполнения всех колонок (ИНН контрагента 14 цифр, номенклатура, кол-во, сумма).
