# Implementation Plan — Очистка Дублирующих Страниц & Переименование в «Контрагенты»

Этот план описывает переименование пункта меню в «Контрагенты», а также полное удаление дублирующих устаревших страниц `/dashboard/companies-catalog` и `/dashboard/partnerships` из проекта и навигации.

## User Review Required

> [!IMPORTANT]
> - **Удаление Устаревших Страниц:** Удаление страниц `app/dashboard/companies-catalog/page.tsx` и `app/dashboard/partnerships/page.tsx`. Весь их функционал теперь консолидирован в едином модуле `/dashboard/counterparties`.
> - **Переименование в Навигации:** Название пункта меню изменено с "Мои Контрагенты" на **"Контрагенты"** во всех сайдбарах, шторках и страницах.

---

## Proposed Changes

### 1. Удаление Устаревших Страниц

#### [DELETE] [companies-catalog/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/companies-catalog/page.tsx)
#### [DELETE] [partnerships/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/partnerships/page.tsx)

---

### 2. Обновление Навигации и Сайдбара

#### [MODIFY] [components/dashboard/DashboardShell.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/components/dashboard/DashboardShell.tsx)
- Оставлен один лаконичный пункт **«Контрагенты»** (`/dashboard/counterparties`).

#### [MODIFY] [components/ui/FloatingTopbar.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/components/ui/FloatingTopbar.tsx)
- В мобильной выезжающей шторке оставлен один пункт **«Контрагенты»** (`/dashboard/counterparties`).

#### [MODIFY] [counterparties/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/counterparties/page.tsx)
- Заголовок модуля обновлен на **«Контрагенты»**.

---

## Verification Plan

### Automated Verification
1. Проверка типов TypeScript: `npx tsc --noEmit`
2. Продашкн сборка Next.js: `npm run build`

### Manual Verification
1. Проверка меню навигации: убедиться, что отображается единый пункт "Контрагенты".
2. Проверка роутов: переход на `/dashboard/counterparties` открывает вкладки контрагентов, заявок и каталога.
