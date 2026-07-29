# Implementation Plan — Глубокая Оптимизация Производительности и Скорости Платформы

Этот план описывает комплексное устранение задержек и ускорение платформы Buhuchet.kg за счет устранения Waterfall-запросов (перевод на `Promise.all()`), кеширования статических справочников, оптимизации Next.js SSR/RSC и предзагрузки роутов.

## User Review Required

> [!IMPORTANT]
> - **Распараллеливание Запросов к БД (`Promise.all`):** Устранение последовательных сетевых вызовов `await` на страницах Дашборда, Реестра Документов, Файлов R2, Заявок и Суперадминки.
> - **Кеширование Справочников (React `cache`):** Повторное использование списка категорий и метаданных без постоянных обращений к базе данных.
> - **Предзагрузка и Мгновенный Отклик:** Включение `prefetch={true}` на всех кнопках переходов и оптимизация реактивного стейта через `useMemo`.

---

## Proposed Changes

### 1. Серверная Оптимизация Запросов (`Promise.all()`)

#### [MODIFY] [dashboard/layout.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/layout.tsx)
- Параллельное получение `getUser()` и данных организации пользователя.

#### [MODIFY] [dashboard/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/page.tsx)
- Объединение вызовов метрик статистики, последних документов и файлов R2 в один параллельный `Promise.all()`.

#### [MODIFY] [files/archive-actions.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/files/archive-actions.ts)
- Распараллеливание запросов при получении списка сканов и категорий.

#### [MODIFY] [super-admin/actions.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/super-admin/actions.ts)
- Оптимизация получения модерации, списка компаний, пользователей и всех файлов системы.

---

### 2. Кеширование и Оптимизация Рендеринга

#### [NEW] [lib/cache/lookups.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/lib/cache/lookups.ts)
- Кеширование часто используемых категорий файлов и справочников через React `cache()`.

#### [MODIFY] [company/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/company/page.tsx)
- Параллельная загрузка профиля и уставных документов `getCompanyLegalDocsAction()`.

---

## Verification Plan

### Automated Verification
1. Проверка типов TypeScript: `npx tsc --noEmit`
2. Продашкн сборка Next.js: `npm run build`

### Manual Verification
1. Замер скорости переключения роутов: замерить реакцию интерфейса при переходе между вкладками.
2. Замер времени загрузки списка документов и файлов R2: убедиться в мгновенном отображении страниц.
