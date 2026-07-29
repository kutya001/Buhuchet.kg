# Implementation Plan — Исправление Багов Партнерства & Входящих Документов + Компактный Верхний Островок

Этот план описывает устранение двух критических багов (автоматическое добавление контрагентов при подтверждении партнерства и чтение входящих B2B документов компанией-получателем), а также делает верхний островок более компактным по высоте и неподвижным на мобильных устройствах.

## User Review Required

> [!IMPORTANT]
> - **Баг Партнерства:** При клике «Принять заявку» обе компании автоматически записываются в контрагенты друг друга с помощью `createAdminClient()`.
> - **Баг Входящих Документов:** Выборка B2B документов в `getB2BDocumentsAction()` переведена на `createAdminClient()` с фильтром `.or(sender_company_id.eq.X,receiver_company_id.eq.X)`, благодаря чему входящие документы гарантированно видны получателю.
> - **Компактный Верхний Островок:** Мобильная верхняя панель сделана более низкой по высоте (`h-12 sm:h-14`), не смещается при скролле, а кнопка «...» открывает нативную выезжающую шторку всех страниц.

---

## Proposed Changes

### 1. Исправление Логики Партнерств

#### [MODIFY] [partnerships/actions.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/partnerships/actions.ts)
- Замена `createClient()` на `createAdminClient()` при записи контрагентов в обе стороны при статусе `approved`.

---

### 2. Исправление Входящих B2B Документов

#### [MODIFY] [documents/actions.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/documents/actions.ts)
- Создание серверной функции `getB2BDocumentsAction()` с `createAdminClient()` для гарантированного получения входящих и исходящих документов.

#### [MODIFY] [documents/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/documents/page.tsx)
- Вызов `getB2BDocumentsAction()` вместо прямого клиентского запроса.

---

### 3. Компактный Фиксированный Верхний Островок

#### [MODIFY] [components/ui/FloatingTopbar.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/components/ui/FloatingTopbar.tsx)
- Уменьшение высоты до `h-12 sm:h-14`, надежная фиксация и минималистичные мобильные отступы.

---

## Verification Plan

### Automated Verification
1. Проверка типов TypeScript: `npx tsc --noEmit`
2. Продашкн сборка Next.js: `npm run build`

### Manual Verification
1. Проверка одобрения партнерства: принять заявку и убедиться, что компания появилась в реестре `/dashboard/counterparties`.
2. Проверка отправки документа: отправить документ от Компании А к Компании Б, зайти под Компанией Б в `/dashboard/documents` и убедиться, что документ виден во "Входящих".
