# План Имплементации: Столбец «Вид» в Документах и Числовой Учет Размеров Файлов в Байтах (`BIGINT`)

План предусматривает добавление явного столбца **«Вид»** (Входящий / Исходящий) в Реестре Документооборота и перевод поля размера файла в базе данных Supabase PostgreSQL с текстового формата (`TEXT`) на чистый числовой формат в байтах (`BIGINT`), с созданием умной утилиты форматирования размера файлов (`formatBytes`).

---

## 🛠️ Перечень предлагаемых изменений

### 1. [Столбец «Вид» в Реестре Документов]
- **Компонент:** [app/dashboard/documents/page.tsx](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/app/dashboard/documents/page.tsx)
- **Изменение:** Добавление отдельного столбца `columns` с ключом `'direction'`, вычисляющего признак:
  - `receiver_company_id === currentCompanyId` ➔ Badge **«Входящий»** (зелёная плашка + иконка `Inbox`).
  - `sender_company_id === currentCompanyId` ➔ Badge **«Исходящий»** (синяя плашка + иконка `Send`).
- **Сортировка:** Включение `sortable: true` с `getValue: (d) => ...`.

---

## 2. [Перевод хранения размера файлов на `BIGINT` в Байтах]
- **Схема БД ([DATABASE.md](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/DATABASE.md)):**
  - Таблица `document_files`: поле `file_size` ➔ тип `BIGINT` (хранение в байтах).
  - Таблица `documents`: поле `mock_file_size` ➔ тип `BIGINT` (хранение в байтах).
- **TypeScript Типы:**
  - [types/database.types.ts](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/types/database.types.ts): `file_size?: number | null;`, `mock_file_size?: number | null;`
  - [types/b2b.types.ts](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/types/b2b.types.ts): `file_size: z.number().optional()`
  - [components/documents/MultiFileDropzone.tsx](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/components/documents/MultiFileDropzone.tsx): `file_size: number` (передача `file.size` прямо из объекта `File`).

---

## 3. [Умная утилита форматирования файлов `formatBytes` & Агрегация]
- **Вспомогательная утилита:** [lib/utils.ts](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/lib/utils.ts)
  - Создание функции `formatBytes(bytes?: number | null): string`, которая автоматически выполняет динамическое округление до `Б`, `КБ`, `МБ`, `ГБ`, `ТБ`.
- **Обновление реестров и панелей агрегации:**
  - [app/dashboard/files/page.tsx](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/app/dashboard/files/page.tsx) — Учет общей массы и статистики файлов через математическое суммирование чисел `SUM(file_size)` и вывод через `formatBytes()`.
  - [app/dashboard/company/page.tsx](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/app/dashboard/company/page.tsx) — Вывод размеров документов организации через `formatBytes(doc.file_size)`.
  - [app/super-admin/page.tsx](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/app/super-admin/page.tsx) — Отображение размеров файлов системного R2-архива.

---

## 📊 План Верификации

### Автоматические тесты & Компиляция
- Проверка типов TypeScript: `npx tsc --noEmit`.
- Полная производственная сборка Next.js: `npm run build`.

### Ручная проверка
- Проверка отображения столбца **«Вид»** (Входящий / Исходящий) в Реестре Документов на ПК и мобильных.
- Загрузка скана в Dropzone и проверка, что в БД пишется числовое значение (например, `1572864`), а в интерфейсах красиво отображается `"1.5 МБ"`.
