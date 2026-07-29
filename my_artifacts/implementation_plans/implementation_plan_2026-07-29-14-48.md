# Implementation Plan — Двухуровневая Загрузка R2: Прямой XHR + Серверный Прокси-Фоллбэк для Мобильных Браузеров

Этот план описывает устранение ошибки «Сетевой сбой при отправке в Cloudflare R2» путем внедрения серверного прокси-фоллбэка, который гарантирует загрузку 100% сканов с мобильных устройств вне зависимости от CORS ограничений мобильных браузеров.

## User Review Required

> [!IMPORTANT]
> - **Двухуровневая Загрузка (Dual-Layer Upload):** При попытке прямой отправки файлов с мобильного устройства в R2 сначала используется XHR. Если мобильный браузер блокирует запрос по CORS или мобильный оператор сбрасывает соединение (Network Error / status 0), система **автоматически без ошибок для пользователя переключается на серверный роут `/api/r2-upload`**, который мгновенно загружает файл в R2 через Node.js backend.

---

## Proposed Changes

### 1. Серверный Метод Загрузки в R2 (Server Proxy Upload)

#### [MODIFY] [files/actions.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/files/actions.ts)
- Добавление `uploadFileDirectlyServerAction(formData: FormData)` для прямой надежной загрузки файлов в Cloudflare R2 из серверного контекста Next.js.

---

### 2. Автоматический Фоллбэк в Дропзоне Загрузки

#### [MODIFY] [MultiFileDropzone.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/components/documents/MultiFileDropzone.tsx)
- Модификация `uploadFileToR2`: при перехвате `Network Error` или статуса ошибки XHR переключаться на `uploadFileDirectlyServerAction(formData)` и завершать загрузку сканов без ошибок для пользователя.

---

## Verification Plan

### Automated Verification
1. Проверка типов TypeScript: `npx tsc --noEmit`
2. Продашкн сборка Next.js: `npm run build`

### Manual Verification
1. Загрузка большого фото (3.0 MB) с мобильного телефона: убедиться в отработке прогресс-бара и успешном появлении зелёной галочки `✅ Готов к сохранению (R2)`.
