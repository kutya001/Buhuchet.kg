# Implementation Plan — Интеграция Cloudflare R2 Хранилища Сканов

Этот план описывает подключение реального S3-совместимого облачного хранилища **Cloudflare R2** через SDK `@aws-sdk/client-s3` и `@aws-sdk/s3-request-presigner` вместо моковой загрузки файлов.

## User Review Required

> [!IMPORTANT]
> - **Безопасная прямая загрузка (Presigned URLs):** Загрузка файлов выполняется прямо из браузера пользователя в Cloudflare R2 по временной ссылке (Presigned PUT URL). Это исключает прохождение бинарного трафика через сервер Vercel и обходит ограничения на размер тела запроса (10 МБ limit).
> - **Структура путей хранения:** Все сканы изолируются по тенанту: `companies/{company_id}/{YYYY}/{MM}/{uuid}-{fileName}`.
> - **Предпросмотр и скачивание:** В `ScanViewer` и реестре файлов генерируются безопасные временные ссылки просмотра (Presigned GET URLs) с поддержкой изображений и PDF-документов.

---

## Proposed Changes

### 1. Зависимости & S3-Клиент Cloudflare R2

#### [NEW] [package.json](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/package.json)
- Добавление зависимостей `@aws-sdk/client-s3` и `@aws-sdk/s3-request-presigner`.

#### [NEW] [lib/r2.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/lib/r2.ts)
- Инициализация `S3Client` для Cloudflare R2 на основе переменных окружения:
  - `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`.

---

### 2. Server Actions для Генерации Presigned URLs

#### [NEW] [app/dashboard/files/actions.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/files/actions.ts)
- `getPresignedUploadUrlAction(fileName, fileType)` — проверка прав авторизации, формирование ключа `companies/{company_id}/{YYYY}/{MM}/{uuid}-{fileName}` и генерация `getSignedUrl` на 15 минут.
- `getPresignedDownloadUrlAction(fileKey)` — генерация подписанного URL просмотра/скачивания скана из R2.

---

### 3. Интеграция Реальной Загрузки в `MultiFileDropzone.tsx`

#### [MODIFY] [components/documents/MultiFileDropzone.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/components/documents/MultiFileDropzone.tsx)
- Перевод компонента на реальную загрузку:
  1. Запрос Presigned PUT URL у сервера.
  2. Загрузка файла через `XMLHttpRequest` или `fetch` с отображением реального процента прогресса (0-100%).
  3. Передача в форму `file_path_r2` (ключ файла в R2), `file_name`, `file_size`, `file_type`.

---

### 4. Интеграция Просмотра в `ScanViewer.tsx` & Реестрах

#### [MODIFY] [components/documents/ScanViewer.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/components/documents/ScanViewer.tsx)
- Поддержка отображения оригинального изображения/PDF скана из Cloudflare R2 через Presigned GET URL.
- Кнопка поворота, зума и полноэкранного режима с оригинальным файлом.

#### [MODIFY] [app/dashboard/files/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/files/page.tsx)
- Добавление кнопок «Просмотреть скан» и «Скачать из R2» по подписанным ссылкам.

#### [MODIFY] [app/super-admin/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/super-admin/page.tsx)
- Добавление возможности скачивания любого файла из глобального реестра суперадмином.

---

### 5. Переменные Окружения

#### [NEW] [.env.example](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/.env.example)
- Шаблон конфигурации для переменных Cloudflare R2 и Supabase.

---

## Verification Plan

### Automated Verification
1. Проверка компиляции TypeScript: `npx tsc --noEmit`
2. Продашкн сборка Next.js: `npm run build`

### Manual Verification
1. Вход под пользователем организации: выбор файла в `MultiFileDropzone` -> проверка генерации Presigned URL и реальной загрузки в R2 по XHR прогрессу (0% -> 100%).
2. Сохранение B2B документа: проверка записи `file_path_r2` в таблице `document_files`.
3. Открытие документа по пути `/dashboard/documents/[id]`: проверка загрузки и масштабирования скана из R2 в `ScanViewer`.
4. Скачивание файла в реестре `/dashboard/files`.
