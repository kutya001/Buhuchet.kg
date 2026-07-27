# Implementation Plan - Шаг 4: Справочники (Lookups)

Шаг 4 посвящен разработке CRUD-модулей Справочников системы: Справочника Контрагентов (`counterparties`) с валидацией ИНН КР (14 цифр) и плательщика НДС, а также Справочника Номенклатуры товаров/услуг (`nomenclature`) с артикулами 1С, базовыми ценами в сомах и единицами измерения.

## User Review Required

> [!IMPORTANT]
> - Все операции чтения/записи в справочниках строго изолируются по `company_id` текущего авторизованного пользователя через Server Actions и Supabase RLS.
> - ИНН контрагента проверяется на 14 цифр (`^\d{14}$`).
> - Единицы измерения номенклатуры включают преднастроенный выпадающий список: `шт`, `кг`, `литр`, `услуга`, `комплект`, `метр`, `упаковка`.

---

## Proposed Changes

### 1. Схемы Валидации & Типы

#### [NEW] [counterparty.types.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/types/counterparty.types.ts)
- Zod-схема `counterpartySchema`: Название (min 2 символа), ИНН (14 цифр), `is_vat_payer` (boolean), телефон КР (`+996`), примечание.

#### [NEW] [nomenclature.types.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/types/nomenclature.types.ts)
- Zod-схема `nomenclatureSchema`: Наименование, артикул/код 1С, единица измерения (`unit`), базовая цена в сомах (`price >= 0`).

---

### 2. Справочник Контрагентов (`/dashboard/counterparties`)

#### [NEW] [actions.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/(dashboard)/counterparties/actions.ts)
- Server Actions:
  - `createCounterpartyAction(formData)` — создание контрагента с привязкой `company_id`.
  - `updateCounterpartyAction(formData)` — редактирование по `id` и `company_id`.
  - `deleteCounterpartyAction(id)` — удаление контрагента по `id`.

#### [NEW] [page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/(dashboard)/counterparties/page.tsx)
- Страница контрагентов:
  - Табличный вид (Название, ИНН 14 цифр, Статус НДС, Телефон, Примечание).
  - Быстрый поиск и фильтрация по названию или ИНН.
  - Модальное окно Создания / Редактирования контрагента.
  - Подтверждение удаления записи.

---

### 3. Справочник Номенклатуры (`/dashboard/nomenclature`)

#### [NEW] [actions.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/(dashboard)/nomenclature/actions.ts)
- Server Actions:
  - `createNomenclatureAction(formData)` — вставка товара/услуги с привязкой `company_id`.
  - `updateNomenclatureAction(formData)` — редактирование по `id` и `company_id`.
  - `deleteNomenclatureAction(id)` — удаление товара.

#### [NEW] [page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/(dashboard)/nomenclature/page.tsx)
- Страница номенклатуры:
  - Таблица товаров и услуг (Наименование, Код 1С, Единица измерения, Цена сом).
  - Поиск по наименованию и коду 1С.
  - Модальное окно создания и редактирования товара/услуги.

---

### 4. Раздел Справочников (`/dashboard/lookups`)

#### [NEW] [page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/(dashboard)/lookups/page.tsx)
- Главная страница раздела Справочников со счетчиками записей контрагентов и товаров и кнопками перехода.

#### [MODIFY] [layout.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/(dashboard)/layout.tsx)
- Обновление ссылок на Контрагенты и Номенклатуру в сайдбаре.

---

## Verification Plan

### Automated Verification
1. Проверка компилятора TypeScript: `npx tsc --noEmit`
2. Сборка Next.js: `npm run build`

### Manual Verification
1. Переход на `/dashboard/counterparties`: создание нового контрагента `ОсОО "Манас Трейд"` с ИНН `20101202310050`, проверка валидации на 14 цифр и сохранения.
2. Переход на `/dashboard/nomenclature`: создание товара `Вода Легенда 1.5л ПЭТ`, цена `35.00 сом`, код `1C-0042`.
3. Редактирование и удаление записей в обох справочниках.
