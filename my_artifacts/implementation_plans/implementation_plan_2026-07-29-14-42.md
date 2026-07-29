# Implementation Plan — Исправление Мобильной Загрузки R2 & Кроссплатформенная Адаптация Суперадминки

Этот план описывает устранение ошибки загрузки файлов в Cloudflare R2 на мобильных смартфонах путем нормализации MIME-типов подписи S3, а также полную адаптированность Панели Суперадмина под мобильные устройства.

## User Review Required

> [!IMPORTANT]
> - **Надежная Мобильная Загрузка R2:** Нормализация MIME-типов в `getPresignedUploadUrlAction` для предотвращения расхождений `Content-Type` и ошибок 403 / SignatureDoesNotMatch при загрузке с мобильных устройств (iOS/Android).
> - **Кроссплатформенная Мобильная Суперадминка:** Адаптация всех 6 модулей суперадминки (`companies`, `users`, `files`, `documents`, `lookups`, `database`) под смартфоны с помощью карточного вида (`< md`), удобных тач-кнопок (`min-h-[48px]`) и выезжающих снизу шторок (Mobile Bottom Sheets).

---

## Proposed Changes

### 1. Исправление Мобильной Загрузки R2

#### [MODIFY] [files/actions.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/files/actions.ts)
- Нормализация MIME-типа в `getPresignedUploadUrlAction` (очистка параметров вроде `charset=utf-8`, fallback для `heic/jpg/pdf`) и возврат `cleanContentType`.

#### [MODIFY] [MultiFileDropzone.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/components/documents/MultiFileDropzone.tsx)
- Использование `cleanContentType` в `xhr.setRequestHeader('Content-Type')` для 100% совпадения с подписью R2.

---

### 2. Кроссплатформенная Мобильная Адаптация Суперадминки

#### [MODIFY] [super-admin/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/super-admin/page.tsx)
- Адаптация всех 6 модулей для мобильных экранов:
  - На смартфонах (`< md`) — информативные мобильные карточки с высотой кнопок `min-h-[48px]`.
  - На ПК (`>= md`) — информативные таблицы.
  - Табы навигации с плавной мобильной прокруткой (`overflow-x-auto whitespace-nowrap`).
  - Перевод всех модальных окон в режим выезжающих матовых шторок (Mobile Bottom Sheets) с индикатором для пальца.

---

## Verification Plan

### Automated Verification
1. Проверка типов TypeScript: `npx tsc --noEmit`
2. Продашкн сборка Next.js: `npm run build`

### Manual Verification
1. Загрузка файла с мобильного устройства: прикрепить фото/скан на мобильном устройстве и убедиться в успешной загрузке в R2.
2. Проверка Суперадминки на мобильном экране: проверить отклик 6 модулей и выезжающих шторок.
