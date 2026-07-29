# Implementation Plan — Исправление Загрузки Файлов, Доступа к Документам & Намертво Зафиксированного Верхнего Островка

Этот план описывает устранение трех проблем в мобильной версии:
1. Ошибка "Документ не найден" у получателей во входящих из-за RLS блокировок.
2. Невозможность загрузить файлы с мобильной камеры/галереи из-за несоответствия MIME-типа в Presigned URL R2.
3. Абсолютная фиксация верхней панели-островка (`fixed top-2`), чтобы она никогда не уходила при скролле.

## User Review Required

> [!IMPORTANT]
> - **Исправление Доступа Получателей:** Внедрение серверного вызова `getB2BDocumentByIdAction(docId)` через `createAdminClient()`. Получатель сможет открыть любой входящий документ по прямой ссылке.
> - **Исправление Мобильной Загрузки в R2:** В `MultiFileDropzone.tsx` гарантируется точное совпадение `Content-Type` между Presigned URL и XMLHttpRequest на смартфонах.
> - **100% Неподвижный Верхний Островок:** Верхний островок переведен в режим `fixed top-2 left-2 right-2`, намертво оставаясь на виду при любом скролле экрана.

---

## Proposed Changes

### 1. Исправление Доступа к Документам Получателя

#### [MODIFY] [documents/actions.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/documents/actions.ts)
- Создание `getB2BDocumentByIdAction(docId)` через `createAdminClient()`.

#### [MODIFY] [documents/[id]/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/documents/[id]/page.tsx)
- Замена прямого запроса на вызов `getB2BDocumentByIdAction(docId)`.

---

### 2. Исправление Мобильной Загрузки Сканов R2

#### [MODIFY] [components/documents/MultiFileDropzone.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/components/documents/MultiFileDropzone.tsx)
- Гарантированный фоллбэк MIME-типов для мобильных камер и галерей (`file.type || 'image/jpeg'`).

---

### 3. Абсолютная Фиксация Верхней Панели-Островка

#### [MODIFY] [components/ui/FloatingTopbar.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/components/ui/FloatingTopbar.tsx)
- Изменение спозиционирования на `fixed top-2 left-2 right-2 md:left-... z-40`.

#### [MODIFY] [components/dashboard/DashboardShell.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/components/dashboard/DashboardShell.tsx)
- Добавление отступа `pt-16` / `pt-14` для основного контента.

---

## Verification Plan

### Automated Verification
1. Проверка типов TypeScript: `npx tsc --noEmit`
2. Продашкн сборка Next.js: `npm run build`

### Manual Verification
1. Проверка открытия входящего документа: перейти во "Входящие" под компанией-получателем и открыть любой документ.
2. Проверка мобильной загрузки сканов: прикрепить фото/файл и убедиться, что прогресс 100% и R2 key сгенерирован.
3. Проверка фиксации панели: проскроллить страницу вниз — верхний островок остается намертво вверху.
