# Implementation Plan — Фикс Кнопки FAB, Переименование Навигации и Полное Редактирование Черновиков

Этот план описывает привязку плавающей мобильной кнопки `+` исключительно к Реестру Файлов, смену названий пунктов меню на «Документы» и «Реестр Файлов», а также реализацию полного редактирования черновиков документов.

## User Review Required

> [!IMPORTANT]
> - **Мобильная Кнопка FAB `+`:** На смартфонах круглая плавающая кнопка `+` теперь показывается **исключительно на странице `/dashboard/files` (Реестр Файлов)**.
> - **Чистые Наименования Меню:** Пункт «B2B Документы» переименован в **«Документы»**, а пункт «Реестр Файлов R2» — в **«Реестр Файлов»**.
> - **Полное Редактирование Черновиков:** Для документов в статусе `draft` добавлены экшен `updateB2BDocumentDraftAction` и модальная форма редактирования всех реквизитов (номер, дата, комментарий, контрагент-получатель) с возможностью сохранения или повторной отправки.

---

## Proposed Changes

### 1. Плавающая Кнопка FAB & Меню Навигации

#### [MODIFY] [MobileFAB.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/components/ui/MobileFAB.tsx)
- Проверка `pathname === '/dashboard/files'`. На остальных страницах возвращать `null`.

#### [MODIFY] [DashboardShell.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/components/dashboard/DashboardShell.tsx)
- Изменение названий: «Документы» и «Реестр Файлов».

#### [MODIFY] [FloatingBottomNav.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/components/ui/FloatingBottomNav.tsx)
- Изменение подписи под левой/правой кнопкой на «Документы».

---

### 2. Серверный Экшен и Редактирование Черновика

#### [MODIFY] [documents/actions.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/documents/actions.ts)
- Реализация `updateB2BDocumentDraftAction(documentId: string, data: any)`.

#### [MODIFY] [documents/[id]/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/documents/%5Bid%5D/page.tsx)
- Добавление кнопки «✏️ Редактировать черновик» для `isSender && document.status === 'draft'`.
- Реализация модального окна полных изменений данных документа (Mobile Bottom Sheet) с возможностью сохранения черновика или мгновенной переотправки.

---

## Verification Plan

### Automated Verification
1. Проверка типов TypeScript: `npx tsc --noEmit`
2. Продашкн сборка Next.js: `npm run build`

### Manual Verification
1. Проверка кнопки FAB `+`: убедиться, что она видна только на странице `/dashboard/files` и отсутствует на Главной и в Документах.
2. Проверка Черновиков: открыть черновик или отозванный документ, изменить номер/комментарий и проверить успешность сохранения.
