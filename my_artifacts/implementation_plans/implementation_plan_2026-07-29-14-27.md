# Implementation Plan — Универсальный Поиск в Верхнем Островке, Исправление Партнерства АлгазТрейд & Пагинация Реестров

Этот план описывает внедрение анимированного выезжающего универсального поиска в верхнем островке, устранение бага несохранения контрагента при принятии заявки (на примере ОсОО "АлгазТрейд"), а также добавление системы пагинации данных во все основные реестры.

## User Review Required

> [!IMPORTANT]
> - **Универсальный Поиск в Шапке:** Иконка лупы в `FloatingTopbar` по клику анимированно выдвигает выпадающую панель поиска (`?search=`), удаляя дублирующие поля из отдельных страниц.
> - **Гарантированное Создание Контрагента (ОсОО "АлгазТрейд"):** В `respondToPartnershipRequestAction()` компании явно извлекаются по `id` без уязвимостей JOIN, гарантируя вставку в контрагенты при одобрении.
> - **Пагинация Реестров:** Добавление системы постраничного вывода (10 элементов на страницу) в `documents`, `counterparties`, `files` и `super-admin`.

---

## Proposed Changes

### 1. Исправление Логики Партнерства

#### [MODIFY] [counterparties/actions.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/counterparties/actions.ts)
- Прямое получение участников партнерства из таблицы `companies` по их `id` при статусе `approved` и принудительный `upsert` в `counterparties`.

---

### 2. Универсальный Адаптивный Поиск

#### [MODIFY] [components/ui/FloatingTopbar.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/components/ui/FloatingTopbar.tsx)
- Кнопка-лупа с выезжающей анимированной строкой ввода, синхронизированная с URL `?search=`.

#### [MODIFY] [documents/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/documents/page.tsx)
#### [MODIFY] [counterparties/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/counterparties/page.tsx)
#### [MODIFY] [files/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/files/page.tsx)
- Прием поискового запроса из URL `?search=` и удаление лишних поисковых полей.

---

### 3. Пагинация в Модулях

#### [MODIFY] [documents/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/documents/page.tsx)
#### [MODIFY] [counterparties/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/counterparties/page.tsx)
#### [MODIFY] [files/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/files/page.tsx)
#### [MODIFY] [super-admin/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/super-admin/page.tsx)
- Внедрение кнопок переключения страниц `← Назад` / `Вперед →` и индикатора `Страница X из Y`.

---

## Verification Plan

### Automated Verification
1. Проверка типов TypeScript: `npx tsc --noEmit`
2. Продашкн сборка Next.js: `npm run build`

### Manual Verification
1. Проверка глобального поиска: клик по лупе в шапке, ввод текста — фильтрация результатов на активной странице.
2. Проверка партнерства АлгазТрейд: одобрить заявку и проверить наличие компании в контрагентах.
3. Проверка пагинации: переключение страниц в реестрах документов и контрагентов.
