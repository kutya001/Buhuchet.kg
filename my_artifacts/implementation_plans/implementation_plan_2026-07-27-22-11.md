# Implementation Plan - Шаг 1: Развертывание Next.js, Shadcn UI и базовой авторизации Supabase

В рамках первого этапа разработки MVP сервиса автоматизации первичной документации создается базовый каркас веб-приложения на базе Next.js 14/15 (App Router), настраивается стилизация на Tailwind CSS и Shadcn UI, а также подключаются изолированные клиенты Supabase (`@supabase/ssr`) с поддержкой Server Components, Server Actions и Middleware.

## User Review Required

> [!IMPORTANT]
> - Проект создается прямо в текущей директории `d:/Рабочий стол/Code Projects/Buhuchet.kg`.
> - Переменные окружения уже сохранены в `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).
> - Аутентификация будет базироваться на `@supabase/ssr` с поддержкой безопасной работы с куками в Server Components и Server Actions.

---

## 1. Структура проекта и список зависимостей

### Необходимые пакеты к установке:
1. **Core / Auth / Supabase**:
   - `@supabase/supabase-js` — базовый SDK Supabase.
   - `@supabase/ssr` — официальный клиент Supabase для Next.js App Router (куки, серверные клиенты, middleware).
2. **UI & Styling**:
   - `lucide-react` — иконки UI.
   - `clsx`, `tailwind-merge` — утилиты безопасного комбинирования Tailwind классов (`cn()`).
   - `class-variance-authority` — вариантность компонентов.
   - `tailwindcss-animate` — анимации для Shadcn UI.
3. **Формы и Валидация**:
   - `zod` — строгая схематическая валидация.
   - `react-hook-form` — производительное управление формами.
   - `@hookform/resolvers` — связка Zod + React Hook Form.

---

## Proposed Changes

### Configuration & Base Setup

#### [NEW] [package.json](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/package.json)
#### [NEW] [tsconfig.json](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/tsconfig.json)
#### [NEW] [tailwind.config.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/tailwind.config.ts)
#### [NEW] [postcss.config.mjs](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/postcss.config.mjs)
#### [NEW] [components.json](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/components.json)

---

### Supabase Clients Layer (`/lib/supabase/`)

#### [NEW] [client.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/lib/supabase/client.ts)
- Клиент для использования в Client Components (`"use client"`). Использует `createBrowserClient` из `@supabase/ssr`.

#### [NEW] [server.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/lib/supabase/server.ts)
- Клиент для использования в Server Components, Server Actions и Route Handlers. Использует `createServerClient` с асинхронным чтением/записью кук через `cookies()`.

#### [NEW] [admin.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/lib/supabase/admin.ts)
- Клиент Суперадмина с `SUPABASE_SERVICE_ROLE_KEY` для серверных административных операций с обходом RLS (вызывается строго на сервере).

#### [NEW] [middleware.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/lib/supabase/middleware.ts)
- Вспомогательная функция обновления Supabase сессии в Next.js Middleware.

#### [NEW] [middleware.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/middleware.ts)
- Корневой Next.js Middleware для защиты роутов и проверки сессии пользователя.

---

### Types & Database Types

#### [NEW] [database.types.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/types/database.types.ts)
- Строгие TypeScript типы таблицы и сущностей согласно `DATABASE.md` (`companies`, `users`, `subscriptions`, `counterparties`, `nomenclature`, `documents`, `document_items`, `document_logs`).

---

### Design System & Layouts

#### [NEW] [globals.css](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/globals.css)
- CSS переменные, базовые стили, шрифты, dark/light палитра Shadcn UI.

#### [NEW] [utils.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/lib/utils.ts)
- Служебный файл `cn()` для слияния классов Tailwind CSS.

#### [NEW] [layout.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/layout.tsx)
- Корневой Layout приложения (HTML, Body, Inter/Outfit шрифты, стили).

#### [NEW] [auth layout.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/(auth)/layout.tsx)
- Изолированный лаконичный Layout для экранов входа/регистрации.

#### [NEW] [dashboard layout.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/(dashboard)/layout.tsx)
- Базовый каркас защищенного дашборда (Sidebar, Header, User menu).

---

### Auth Pages & Server Actions

#### [NEW] [login page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/(auth)/login/page.tsx)
- Премиальная страница авторизации (Вход по Email и Паролю) со стилизацией Shadcn UI, Zod-валидацией, обработкой ошибок и динамическими визуальными эффектами.

#### [NEW] [actions.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/(auth)/actions.ts)
- Server Actions для выполнения входа (`login`), выхода из системы (`signout`) с валидацией через Zod и корректными ответами `{ success: boolean, error?: string }`.

---

## Verification Plan

### Automated Verification
1. Проверка сборки TypeScript: `npx tsc --noEmit`
2. Проверка сборки Next.js: `npm run build`

### Manual Verification
1. Запуск дев-сервера (`npm run dev`).
2. Открытие страницы `/login` в браузере, проверка рендеринга формы и UI элементов.
3. Проверка поведения валидации при вводе невалидного email/пароля.
