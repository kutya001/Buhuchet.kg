# Implementation Plan — Автоматическое Создание Контрагентов & Просмотр Данных и Учредительных Сканов R2

Этот план описывает гарантированную запись связей контрагентов при одобрении заявок партнерства, а также реализацию детального просмотра реквизитов контрагента и его учредительных документов из Cloudflare R2.

## User Review Required

> [!IMPORTANT]
> - **Авто-создание контрагента при принятии заявки:** В `respondToPartnershipRequestAction()` гарантированно прописывается `target_company_id` для обеих сторон при одобрении запроса.
> - **Просмотр Данных & Учредительных Сканов:** В модуль «Контрагенты» добавляется модальное окно (Mobile Bottom Sheet) с полной информацией о компании-партнере (Директор, Юр. адрес, Отрасль, Контакты) и реестром ее **Учредительных документов в Cloudflare R2** с возможностью скачивания и просмотра.

---

## Proposed Changes

### 1. Серверные Экшены Контрагентов

#### [MODIFY] [counterparties/actions.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/counterparties/actions.ts)
- Запись `target_company_id` в `respondToPartnershipRequestAction()`.
- Реализация `getCounterpartyDetailsAndFilesAction(targetCompanyId: string)` с генерацией пресайн ссылок Cloudflare R2 для уставных/юридических сканов.

---

### 2. Интерфейс Контрагентов

#### [MODIFY] [counterparties/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/counterparties/page.tsx)
- Добавление кнопки **«📁 Данные & Учредительные Сканы»** на карточки «Мои Контрагенты».
- Реализация выезжающего окна (Mobile Bottom Sheet) просмотра полной информации о контрагенте и скачивания уставных файлов из R2.

---

## Verification Plan

### Automated Verification
1. Проверка типов TypeScript: `npx tsc --noEmit`
2. Продашкн сборка Next.js: `npm run build`

### Manual Verification
1. Принятие заявки сети: убедиться в появлении контрагента с привязанным `target_company_id`.
2. Просмотр учредительных сканов: открыть профиль контрагента и скачать/просмотреть уставные сканы R2.
