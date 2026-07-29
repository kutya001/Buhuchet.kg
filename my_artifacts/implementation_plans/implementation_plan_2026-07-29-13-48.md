# Implementation Plan — Полноценная SEO Оптимизация Платформы Buhuchet.kg

Этот план описывает внедрение лучшего комплекса SEO (Search Engine Optimization) для платформы Buhuchet.kg: поисковые метатеги Next.js 14, карточки OpenGraph и Twitter, микроразметка Schema.org (JSON-LD), генераторы `sitemap.xml` и `robots.txt`, семантика HTML5 и оптимизация производительности.

## User Review Required

> [!IMPORTANT]
> - **Метатеги и OpenGraph (Next.js 14 Metadata):** Настройка заголовков Title, мета-описаний Description, OpenGraph (`og:title`, `og:image`, `og:type`) и Twitter Cards.
> - **Микроразметка Schema.org (JSON-LD):** Добавление структурированных данных `Organization` и `SoftwareApplication` для отображения красивых расширенных сниппетов в Google и Яндекс.
> - **Автоматическая Карта Сайта (`/sitemap.xml`):** Модуль `app/sitemap.ts` для регулярной индексации поисковиками.
> - **Файл Исключений Индексации (`/robots.txt`):** Модуль `app/robots.ts` с открытием публичных страниц и закрытием приватного личного кабинета `/dashboard/*` от спам-ботов.

---

## Proposed Changes

### 1. Метаданные Проекта & Root Layout

#### [MODIFY] [layout.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/layout.tsx)
- Внедрение объекта Next.js `metadata` с мета-тегами OpenGraph, Twitter Cards, поисковыми ключами и локалью `ru_KG`.

---

### 2. Генерация SEO файлов для поисковиков

#### [NEW] [app/sitemap.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/sitemap.ts)
- Динамический генератор `sitemap.xml` со всеми публичными маршрутами платформы (`/`, `/login`, `/register`, `/onboarding`).

#### [NEW] [app/robots.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/robots.ts)
- Динамический генератор `robots.txt` с правилами разграничения индексации.

---

### 3. Микроразметка Schema.org на Лендинге

#### [MODIFY] [app/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/page.tsx)
- Внедрение структурированных данных JSON-LD `SoftwareApplication` для вывода звезд, отзывов и категории ПО в поиске Google/Яндекс.

---

## Verification Plan

### Automated Verification
1. Проверка типов TypeScript: `npx tsc --noEmit`
2. Продашкн сборка Next.js: `npm run build`

### Manual Verification
1. Проверка работы `/sitemap.xml` и `/robots.txt` во время билда.
2. Валидация микроразметки через Schema.org JSON-LD структурированный формат.
