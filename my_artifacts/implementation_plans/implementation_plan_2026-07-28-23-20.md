# Implementation Plan — Оптимизация Производительности (Instant UI Feedback) & Адаптация Лендинга

Этот план описывает повышение скорости отклика интерфейса Buhuchet.kg путем создания Skeleton Loader фалов `loading.tsx`, включения Next.js Prefetching в меню навигации, распараллеливания запросов через `Promise.all()`, а также обновление B2B-лендинга с использованием примеров компаний **ОсОО «Альфа»** и **ОсОО «Бета»** и адаптацией для мобильных устройств.

## User Review Required

> [!IMPORTANT]
> - **Скелетоны Загрузки (`loading.tsx`):** Создание Skeleton-компонентов загрузки для роутов `/dashboard`, `/dashboard/documents`, `/dashboard/files`, `/dashboard/partnerships`, `/dashboard/company`.
> - **Prefetching & Promise.all:** Добавление `prefetch={true}` ко всем `Link` в сайдбаре и Bottom Nav Bar, распараллеливание запросов данных в `Promise.all`.
> - **Лендинг:** Замена имён компаний в интерактивном макете лендинга на **ОсОО «Альфа»** и **ОсОО «Бета»**, ликвидация горизонтального скролла (`overflow-x-hidden`).

---

## Proposed Changes

### 1. Производительность & Skeleton Loaders

#### [NEW] [dashboard/loading.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/loading.tsx)
- Скелетон загрузки главной страницы дашборда.

#### [NEW] [documents/loading.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/documents/loading.tsx)
- Скелетон загрузки реестра документов.

#### [NEW] [files/loading.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/files/loading.tsx)
- Скелетон загрузки реестра файлов R2.

#### [NEW] [partnerships/loading.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/partnerships/loading.tsx)
- Скелетон загрузки страницы заявок.

#### [NEW] [company/loading.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/company/loading.tsx)
- Скелетон загрузки профиля организации.

#### [MODIFY] [layout.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/layout.tsx)
- Добавление `prefetch={true}` для мгновенной предзагрузки роутов при наведении на ссылки в сайдбаре и мобильном баре.

---

### 2. Обновление и Адаптация Лендинга

#### [MODIFY] [page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/page.tsx)
- Обновление текстовых примеров организаций на **ОсОО «Альфа»** и **ОсОО «Бета»**.
- Адаптация верстки для смартфона (`overflow-x-hidden`, `text-3xl sm:text-5xl`, полноширинные кнопки).

---

## Verification Plan

### Automated Verification
1. Проверка компиляции TypeScript: `npx tsc --noEmit`
2. Продашкн сборка Next.js: `npm run build`

### Manual Verification
1. Клик по разделам в навигации: проверка мгновенного показа Skeleton-загрузчиков.
2. Просмотр главной страницы (`/`): проверка названий **ОсОО «Альфа»** и **ОсОО «Бета»** и корректного отображения на мобильных.
